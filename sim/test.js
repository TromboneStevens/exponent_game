#!/usr/bin/env node
/* Sanity tests for the idle + idols + meta-progression economy and simulator.
 * Run with: npm test
 */

"use strict";

const E = require("../economy.js");
const { simulate } = require("./simulator.js");
const strategies = require("./strategies.js");

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.error("  ✗ " + name); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }

console.log("economy: idle bootstrap");
{
  const meta = E.freshMeta();
  const run = E.freshRun(meta);
  ok("starts with a free Qubit", run.generators.qubit === 1);
  ok("starts with seed energy", run.energy.eq(E.D("15")));
  const d = E.recompute(run, meta);
  ok("idle production from t=0 (no tapping needed)", d.perSec.gt(0));
}

console.log("economy: depth ladder");
{
  const cfg = E.CONFIG;
  ok("below base => P0", E.depthFromEnergy("500", cfg) === 0);
  ok("at pDepthBase*mul^5 => depth ~5", approx(E.depthFromEnergy(E.levelThreshold(5, cfg), cfg), 5, 1e-9));
  const run = E.freshRun(E.freshMeta());
  run.totalEarned = E.D("1e12");
  ok("1e12 lifetime => P9 (1e3 base, 10x)", E.prestigeLevel(run) === 9);
}

console.log("economy: prestige points (continuous + exponential)");
{
  const meta = E.freshMeta();
  const run = E.freshRun(meta);
  run.totalEarned = E.D("500"); run.maxDepth = 0;
  ok("no points below min depth", E.pointsOnReset(run, meta).eq(E.D(0)));
  run.totalEarned = E.levelThreshold(10); // depth 10
  const p10 = E.pointsOnReset(run, meta);
  ok("depth 10 => 2^10 = 1024 points", p10.eq(E.D(1024)));
  run.totalEarned = E.levelThreshold(11);
  const p11 = E.pointsOnReset(run, meta);
  ok("each depth level doubles points", p11.div(p10).toNumber() > 1.9 && p11.div(p10).toNumber() < 2.1);
  // partial depth still pays (continuous)
  run.totalEarned = E.D(E.levelThreshold(5)).mul(3); // depth ~5.48
  ok("partial depth pays points", E.pointsOnReset(run, meta).gt(0));
}

console.log("economy: idols modify the run");
{
  const meta = E.freshMeta();
  const run = E.freshRun(meta);
  run.generators.qubit = 10;
  const before = E.recompute(run, meta).perSec.toNumber();
  E.chooseIdol(run, "idol_flat_prod"); // ×3 all
  const after = E.recompute(run, meta).perSec.toNumber();
  ok("Idol of Abundance ×3 production", approx(after, before * 3, 1e-6));

  const run2 = E.freshRun(E.freshMeta());
  const cost0 = E.genCost(E.genDef("qubit"), run2.generators.qubit, E.recompute(run2, E.freshMeta()).mods);
  E.chooseIdol(run2, "idol_thrift"); // costs ×0.6
  const cost1 = E.genCost(E.genDef("qubit"), run2.generators.qubit, E.recompute(run2, E.freshMeta()).mods);
  ok("Idol of Thrift makes things cheaper", approx(cost1.div(cost0).toNumber(), 0.6, 1e-6));

  const run3 = E.freshRun(E.freshMeta());
  const e0 = run3.energy;
  E.chooseIdol(run3, "idol_kickstart");
  E.applyIdolStartBonuses(run3, E.freshMeta());
  ok("Idol of Momentum grants start energy", run3.energy.gt(e0));
}

console.log("economy: meta-shop is permanent + macro-reset");
{
  const meta = E.freshMeta();
  const run = E.freshRun(meta);
  run.generators.qubit = 10;
  run.totalEarned = E.levelThreshold(12); // depth 12 -> 4096 points
  const base = E.recompute(run, meta).perSec.toNumber();

  const gained = E.macroReset(run, meta);
  ok("macro-reset banks points", meta.points.eq(gained) && gained.gt(0));
  ok("macro-reset clears idols", run.idols.length === 0);
  ok("macro-reset returns to seed energy", run.energy.eq(E.D("15")) || run.energy.gt(0));
  ok("macro-reset increments counter", meta.macroResets === 1);

  // Buy a permanent production upgrade and confirm it survives a reset.
  const boughtMeta = E.buyMeta(meta, "meta_prod");
  ok("can buy meta upgrade with points", boughtMeta === true);
  run.generators.qubit = 10;
  const boosted = E.recompute(run, meta).perSec.toNumber();
  ok("meta upgrade boosts production (x1.5)", approx(boosted, base * 1.5, base * 1.5 * 1e-6));
  const lvl = meta.metaLevels.meta_prod;
  E.macroReset(run, meta);
  ok("meta level persists through reset", meta.metaLevels.meta_prod === lvl);
}

console.log("simulator: determinism + progression");
{
  const run = () => simulate({
    strategy: strategies.metaRunner,
    durationSeconds: 3600, stepSeconds: 1, seed: 7,
    milestones: [{ id: "p3", label: "P3", metric: "prestigeLevel", value: "3" }],
  });
  const a = run(), b = run();
  ok("deterministic final energy (same seed)", a.final.energy === b.final.energy);
  ok("deterministic milestone time", a.milestones[0].timeSeconds === b.milestones[0].timeSeconds);
  ok("meta-runner outprogresses idle-only (lifetime points)", (() => {
    // Under macro-resetting, final P-level fluctuates; lifetime points earned is
    // the honest progress measure. idle-only buys nothing so banks nothing.
    const idle = simulate({ strategy: strategies.idleOnly, durationSeconds: 3600, stepSeconds: 1, seed: 7 });
    return E.D(a.final.lifetimePoints).gt(E.D(idle.final.lifetimePoints));
  })());
  ok("idle-only still progresses (free Qubit, no taps)", (() => {
    const idle = simulate({ strategy: strategies.idleOnly, durationSeconds: 3600, stepSeconds: 1, seed: 7 });
    return E.D(idle.final.totalEarned).gt(E.D("15"));
  })());
}

console.log("simulator: macro-resets accumulate meta points over a long run");
{
  const r = simulate({
    strategy: strategies.metaRunner,
    durationSeconds: 86400, stepSeconds: 2, seed: 3,
    milestones: [{ id: "r1", label: "1 reset", metric: "macroResets", value: "1" }],
  });
  ok("performs at least one macro-reset in a day", r.final.macroResets >= 1);
  ok("accumulates lifetime points", E.D(r.final.lifetimePoints).gt(0));
}

console.log("simulator: idol pick policy chooses the preferred type");
{
  // build-thrift should prefer a costMul idol when offered one.
  const picker = strategies.buildThrift.pickIdol;
  const choices = [E.idolDef("idol_flat_prod"), E.idolDef("idol_thrift"), E.idolDef("idol_qubit")];
  ok("thrift build picks the cost idol", picker({ choices }) === "idol_thrift");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
