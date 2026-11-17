#!/usr/bin/env node
/* Quantum Forge balance simulator — CLI.
 *
 * Runs headless simulations of the game (sharing ../economy.js) to measure how
 * long goals take, compare player strategies and idol builds, sweep balance
 * parameters, and study the meta-progression loop. Outputs a console summary
 * plus optional CSV/JSON files.
 *
 * Usage:
 *   node sim/run.js <scenario> [options]
 *
 * Scenarios:
 *   single     One strategy: milestone ladder + full time series.   (default)
 *   compare    Several strategies side-by-side on the same goals.
 *   builds     Compare idol-build archetypes over a meta-run.
 *   sweep      Vary one CONFIG value; measure time-to-goal for each.
 *   metarun    Long multi-macro-reset run; study meta-progression.
 *
 * Common options:
 *   --strategy=<name>     idle-only | cheapest | best-roi | meta-runner |
 *                         build-production | build-compound | build-thrift | build-points
 *   --strategies=a,b,c    (compare/builds) list of strategies
 *   --duration=<spec>     game time: 3600, 90m, 6h, 3d
 *   --step=<seconds>      sim step size (bigger = faster/coarser). default 1
 *   --seed=<n>            PRNG seed for idol drafts (reproducible). default 1
 *   --out=<dir>           output dir. default sim/out
 *   --no-files            console only
 *   --json                also print raw JSON
 *
 * Sweep options:
 *   --key=<CONFIG field>  e.g. pDepthMul, pointsBase, pDepthBase
 *   --values=a,b,c        values to try
 *   --goal-metric=<m>     energy|totalEarned|perSec|depth|prestigeLevel|points|lifetimePoints|macroResets
 *   --goal-value=<n>      e.g. 10
 *
 * Examples:
 *   node sim/run.js compare --duration=1d
 *   node sim/run.js builds --duration=1d
 *   node sim/run.js single --strategy=meta-runner --duration=6h
 *   node sim/run.js sweep --key=pDepthMul --values=8,10,12 --goal-metric=prestigeLevel --goal-value=10
 *   node sim/run.js metarun --duration=3d
 */

"use strict";

const path = require("path");
const scenarios = require("./scenarios.js");
const report = require("./report.js");
const combatSim = require("./combat.js");
const combatStrategies = require("./combatStrategies.js");
const combatReport = require("./combatReport.js");

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) args[a.slice(2)] = true;
      else args[a.slice(2, eq)] = a.slice(eq + 1);
    } else args._.push(a);
  }
  return args;
}

function parseDuration(spec, dflt) {
  if (spec == null) return dflt;
  const m = String(spec).trim().match(/^([0-9.]+)\s*([smhd]?)$/i);
  if (!m) return dflt;
  const n = parseFloat(m[1]);
  switch ((m[2] || "s").toLowerCase()) {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3600;
    case "d": return n * 86400;
    default: return n;
  }
}

function parseList(v) {
  if (v == null) return undefined;
  return String(v).split(",").map((x) => x.trim()).filter(Boolean);
}

function coerceValue(v) {
  const s = String(v);
  if (/e/i.test(s)) return s; // keep "1e9" string for Decimal
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenario = args._[0] || "single";
  const writeFiles = !args["no-files"];
  const outDir = args.out || path.join(__dirname, "out");

  // The combat scenario uses a separate economy (combat.js) with its own
  // strategies, config keys, and report shape — handle it independently.
  if (scenario === "combat") { runCombat(args, writeFiles, outDir); return; }

  const duration = parseDuration(args.duration, 86400);
  const step = args.step != null ? Number(args.step) : 1;
  const seed = args.seed != null ? Number(args.seed) : 1;
  const common = { durationSeconds: duration, stepSeconds: step, seed };

  let bundle;
  try {
    if (scenario === "single" || scenario === "milestones") {
      bundle = scenarios.milestones(Object.assign({ strategy: args.strategy || "meta-runner" }, common));
    } else if (scenario === "compare") {
      bundle = scenarios.compare(Object.assign({ strategies: parseList(args.strategies) }, common));
    } else if (scenario === "builds") {
      bundle = scenarios.builds(Object.assign({ strategies: parseList(args.strategies) }, common));
    } else if (scenario === "sweep") {
      const values = (parseList(args.values) || []).map(coerceValue);
      bundle = scenarios.sweep(Object.assign({
        key: args.key, values,
        strategy: args.strategy || "meta-runner",
        metric: args["goal-metric"] || "prestigeLevel",
        value: args["goal-value"] || "10",
      }, common));
    } else if (scenario === "metarun") {
      bundle = scenarios.metarun(Object.assign({ strategy: args.strategy || "meta-runner" }, common));
    } else {
      console.error(`Unknown scenario "${scenario}". Try: single | compare | builds | sweep | metarun`);
      process.exit(1);
    }
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }

  printReport(scenario, bundle);

  if (writeFiles) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const prefix = path.join(outDir, `${scenario}-${stamp}`);
    const written = [];
    bundle.results.forEach((r) => {
      const tag = bundle.results.length > 1 ? `-${sanitize(r.meta.strategy)}` : "";
      written.push(report.write(`${prefix}${tag}.series.csv`, report.seriesToCsv(r)));
    });
    written.push(report.write(`${prefix}.milestones.csv`, report.milestonesToCsv(bundle.results)));
    written.push(report.write(`${prefix}.json`, JSON.stringify(bundle, null, 2)));
    console.log("\nWrote:");
    for (const w of written) console.log("  " + path.relative(process.cwd(), w));
  }

  if (args.json) console.log("\n" + JSON.stringify(bundle, null, 2));
}

function printReport(scenario, bundle) {
  console.log("=".repeat(64));
  if (bundle.kind === "compare") {
    console.log("STRATEGY / BUILD COMPARISON — time to reach each milestone\n");
    console.log(report.comparisonTable(bundle.results));
  } else if (bundle.kind === "sweep") {
    const { key, goal, rows } = bundle.extra;
    console.log(`PARAMETER SWEEP — ${key} vs. time to goal: ${goal.label}\n`);
    const w = Math.max(key.length, ...rows.map((r) => String(r.value).length)) + 2;
    console.log(pad(key, w) + " | time-to-goal");
    console.log("-".repeat(w + 16));
    for (const r of rows) console.log(pad(String(r.value), w) + " | " + (r.reached ? report.fmtTime(r.timeSeconds) : "not reached"));
  } else {
    console.log(report.summaryText(bundle.results[0]));
  }
  console.log("=".repeat(64));
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function sanitize(s) { return String(s).replace(/[^a-z0-9._-]+/gi, "_"); }

/* ---------- Combat scenario (Stage-1 autobattler) ----------
 * node sim/run.js combat [--strategy=..|--strategies=a,b,c] [--duration=10m]
 *   [--step=0.25] [--hpGrowth=1.1] [--goldGrowth=1.08] [--baseHP=4] [--kills=1,10,50]
 * Compares buy-strategies if --strategies is given, else runs one. */
function runCombat(args, writeFiles, outDir) {
  const duration = parseDuration(args.duration, 600);
  const step = args.step != null ? Number(args.step) : 0.25;

  // Allow overriding any combat CONFIG numeric from the CLI.
  const configKeys = ["baseHP", "hpGrowth", "baseGold", "goldGrowth", "bossInterval", "bossHpMult", "bossTimeLimit", "speedSoftCap"];
  const config = {};
  for (const k of configKeys) if (args[k] != null) config[k] = coerceValue(args[k]);

  const killGoals = args.kills ? parseList(args.kills).map(Number) : undefined;

  const names = parseList(args.strategies) || (args.strategy ? [args.strategy] : ["best-dps-per-gold"]);
  const results = names.map((n) => {
    const strat = combatStrategies.byName(n);
    if (!strat) { console.error(`Unknown combat strategy "${n}". Available: ${Object.values(combatStrategies.ALL).map((x) => x.name).join(", ")}`); process.exit(1); }
    return combatSim.simulate({ strategy: strat, durationSeconds: duration, stepSeconds: step, config, killGoals });
  });

  console.log("=".repeat(64));
  if (results.length > 1) {
    console.log("COMBAT STRATEGY COMPARISON — time to each kill goal\n");
    console.log(combatReport.comparisonTable(results));
  } else {
    console.log(combatReport.summaryText(results[0]));
  }
  console.log("=".repeat(64));

  if (writeFiles) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const prefix = path.join(outDir, `combat-${stamp}`);
    const written = [];
    results.forEach((r) => {
      const tag = results.length > 1 ? `-${sanitize(r.meta.strategy)}` : "";
      written.push(combatReport.write(`${prefix}${tag}.series.csv`, combatReport.seriesToCsv(r)));
    });
    written.push(combatReport.write(`${prefix}.goals.csv`, combatReport.goalsToCsv(results)));
    written.push(combatReport.write(`${prefix}.json`, JSON.stringify(results.length === 1 ? results[0] : results, null, 2)));
    console.log("\nWrote:");
    for (const w of written) console.log("  " + path.relative(process.cwd(), w));
  }

  if (args.json) console.log("\n" + JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

main();
