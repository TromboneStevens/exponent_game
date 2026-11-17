#!/usr/bin/env node
/* Quantum Forge balance simulator — CLI.
 *
 * Runs headless simulations of the game (sharing ../economy.js) to measure how
 * long goals take, compare player strategies, and sweep balance parameters.
 * Outputs a console summary plus optional CSV/JSON files for analysis.
 *
 * Usage:
 *   node sim/run.js <scenario> [options]
 *
 * Scenarios:
 *   single     One strategy, milestone ladder + full time series.   (default)
 *   compare    Several strategies side-by-side on the same goals.
 *   sweep      Vary one CONFIG value; measure time-to-goal for each.
 *   prestige   Long run with auto-prestige; study the meta layer.
 *
 * Common options:
 *   --strategy=<name>        idle | greedy-cheapest | best-roi | patient-roi | prestige-roi
 *   --strategies=a,b,c       (compare) list of strategies
 *   --duration=<spec>        game time to simulate, e.g. 1h, 3d, 90m, 3600 (seconds)
 *   --step=<seconds>         time per step (bigger = faster/coarser). default 1
 *   --taps=<n>               simulated taps/sec (default 0 = pure idle)
 *   --out=<dir>             write CSV/JSON output here (default: sim/out)
 *   --no-files              console only, skip writing files
 *   --json                  also print raw JSON to stdout
 *
 * Sweep options:
 *   --key=<CONFIG field>     e.g. prestigeExponent, corePerCoreBonus
 *   --values=a,b,c           values to try (numbers or strings)
 *   --goal-metric=<metric>   energy|totalEarned|perSec|cores (default totalEarned)
 *   --goal-value=<number>    e.g. 1e12
 *
 * Examples:
 *   node sim/run.js compare --duration=1d
 *   node sim/run.js single --strategy=best-roi --duration=6h --taps=4
 *   node sim/run.js sweep --key=prestigeExponent --values=0.3,0.4,0.5 --goal-value=1e9 --goal-metric=cores
 */

"use strict";

const path = require("path");
const scenarios = require("./scenarios.js");
const report = require("./report.js");

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) args[a.slice(2)] = true;
      else args[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      args._.push(a);
    }
  }
  return args;
}

// Parse a duration spec like "90", "3600s", "90m", "6h", "3d".
function parseDuration(spec, dflt) {
  if (spec == null) return dflt;
  const s = String(spec).trim();
  const m = s.match(/^([0-9.]+)\s*([smhd]?)$/i);
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

// CONFIG values may be numbers or numeric strings (e.g. "1e9"). Keep strings
// that look like big-number exponentials; coerce plain decimals to Number.
function coerceValue(v) {
  const s = String(v);
  if (/e/i.test(s)) return s; // keep "1e9" as a string for Decimal
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenario = args._[0] || "single";
  const duration = parseDuration(args.duration, 86400);
  const step = args.step != null ? Number(args.step) : 1;
  const taps = args.taps != null ? Number(args.taps) : 0;
  const writeFiles = !args["no-files"];
  const outDir = args.out || path.join(__dirname, "out");

  const common = { durationSeconds: duration, stepSeconds: step, tapsPerSecond: taps };

  let bundle;
  try {
    if (scenario === "single" || scenario === "milestones") {
      bundle = scenarios.milestones(Object.assign({ strategy: args.strategy || "best-roi" }, common));
    } else if (scenario === "compare") {
      bundle = scenarios.compare(Object.assign({ strategies: parseList(args.strategies) }, common));
    } else if (scenario === "sweep") {
      const values = (parseList(args.values) || []).map(coerceValue);
      bundle = scenarios.sweep(Object.assign({
        key: args.key,
        values,
        strategy: args.strategy || "best-roi",
        goalLabel: args["goal-label"] || args.key,
        metric: args["goal-metric"] || "totalEarned",
        value: args["goal-value"] || "1e12",
      }, common));
    } else if (scenario === "prestige") {
      bundle = scenarios.prestige(common);
    } else {
      console.error(`Unknown scenario "${scenario}". Try: single | compare | sweep | prestige`);
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

    // Time series CSV for single/prestige (one run). For compare/sweep, write each.
    bundle.results.forEach((r, i) => {
      const tag = bundle.results.length > 1 ? `-${sanitize(r.meta.strategy)}` : "";
      written.push(report.write(`${prefix}${tag}.series.csv`, report.seriesToCsv(r)));
    });
    written.push(report.write(`${prefix}.milestones.csv`, report.milestonesToCsv(bundle.results)));
    written.push(report.write(`${prefix}.json`, JSON.stringify(bundle, null, 2)));

    console.log("\nWrote:");
    for (const w of written) console.log("  " + path.relative(process.cwd(), w));
  }

  if (args.json) {
    console.log("\n" + JSON.stringify(bundle, null, 2));
  }
}

function printReport(scenario, bundle) {
  console.log("=".repeat(64));
  if (bundle.kind === "compare") {
    console.log("STRATEGY COMPARISON — time to reach each milestone\n");
    console.log(report.comparisonTable(bundle.results));
  } else if (bundle.kind === "sweep") {
    const { key, goal, rows } = bundle.extra;
    console.log(`PARAMETER SWEEP — ${key} vs. time to goal: ${goal.label}\n`);
    const w = Math.max(key.length, ...rows.map((r) => String(r.value).length)) + 2;
    console.log(pad(key, w) + " | time-to-goal");
    console.log("-".repeat(w + 16));
    for (const r of rows) {
      console.log(pad(String(r.value), w) + " | " + (r.reached ? report.fmtTime(r.timeSeconds) : "not reached"));
    }
  } else {
    console.log(report.summaryText(bundle.results[0]));
  }
  console.log("=".repeat(64));
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function sanitize(s) {
  return String(s).replace(/[^a-z0-9._-]+/gi, "_");
}

main();
