#!/usr/bin/env node
/* Lightweight sanity tests for the shared economy + simulator.
 * Not a full test framework — just assertions that catch economy regressions
 * and confirm the simulator is deterministic. Run with: npm test
 */

"use strict";

const E = require("../economy.js");
const { simulate } = require("./simulator.js");
const strategies = require("./strategies.js");

let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.error("  ✗ " + name); }
}

function approx(a, b, tol) {
  return Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
}

console.log("economy: cost curves");
{
  const g = E.genDef("qubit");
  ok("first unit costs baseCost", E.genCost(g, 0).eq(E.D("15")));
  ok("second unit = baseCost * costMul", approx(E.genCost(g, 1).toNumber(), 15 * 1.12, 1e-9));
  // Bulk cost of 3 from 0 equals manual sum.
  const bulk = E.genCostBulk(g, 0, 3).toNumber();
  const manual = 15 + 15 * 1.12 + 15 * 1.12 * 1.12;
  ok("bulk cost = geometric sum", approx(bulk, manual, 1e-6));
}

console.log("economy: production + buying");
{
  const s = E.freshState();
  E.addEnergy(s, E.D("1000"));
  ok("totalEarned tracks additions", s.totalEarned.eq(E.D("1000")));
  const bought = E.buyGenerator(s, "qubit");
  ok("can buy affordable generator", bought === true);
  ok("energy deducted", s.energy.eq(E.D("985")));
  const d = E.recompute(s);
  ok("one qubit produces baseProd/s", approx(d.perSec.toNumber(), 0.2, 1e-9));
}

console.log("economy: upgrades affect production");
{
  const s = E.freshState();
  s.generators.qubit = 10;
  const before = E.recompute(s).perSec.toNumber();
  s.upgrades.all2 = true; // ×2 all generators
  const after = E.recompute(s).perSec.toNumber();
  ok("Overclock I doubles production", approx(after, before * 2, 1e-9));
}

console.log("economy: prestige");
{
  const s = E.freshState();
  ok("no prestige below requirement", E.prestigeGain(s).eq(E.D(0)));
  E.addEnergy(s, E.D("1e12"));
  const gain = E.prestigeGain(s);
  ok("prestige gain positive past requirement", gain.gt(0));
  const expected = E.D("1e12").div("1e6").pow(0.4).floor();
  ok("prestige formula matches", gain.eq(expected));
  const banked = E.prestige(s);
  ok("prestige banks cores", s.cores.eq(banked));
  ok("prestige resets energy", s.energy.eq(E.D(0)));
  ok("prestige resets generators", s.generators.qubit === 0);
}

console.log("simulator: determinism + progression");
{
  // The game bootstraps via tapping, so a realistic player taps. With 0 taps
  // and an empty save nothing can ever be bought (energy stays 0).
  const run = () => simulate({
    strategy: strategies.bestRoi,
    durationSeconds: 3600,
    stepSeconds: 1,
    tapsPerSecond: 3,
    milestones: [{ id: "m1", label: "1M", metric: "totalEarned", value: "1e6" }],
  });
  const a = run();
  const b = run();
  ok("deterministic final energy", a.final.energy === b.final.energy);
  ok("deterministic milestone time", a.milestones[0].timeSeconds === b.milestones[0].timeSeconds);
  ok("best-roi outproduces idle (same taps)", (() => {
    const idle = simulate({ strategy: strategies.idle, durationSeconds: 3600, stepSeconds: 1, tapsPerSecond: 3 });
    return E.D(a.final.totalEarned).gt(E.D(idle.final.totalEarned));
  })());
}

console.log("simulator: step size gives comparable results");
{
  // Coarser steps should land within an order of magnitude of fine steps for
  // the same duration (continuous accrual, so not identical, but close-ish).
  const fine = simulate({ strategy: strategies.bestRoi, durationSeconds: 7200, stepSeconds: 1, tapsPerSecond: 3 });
  const coarse = simulate({ strategy: strategies.bestRoi, durationSeconds: 7200, stepSeconds: 10, tapsPerSecond: 3 });
  const rf = E.D(fine.final.totalEarned);
  const rc = E.D(coarse.final.totalEarned);
  const ratio = rf.div(rc).toNumber();
  ok("step=1 vs step=10 within 3x", ratio > 0.33 && ratio < 3);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
