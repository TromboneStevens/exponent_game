/* Headless simulation engine for Quantum Forge (idle + idols + meta-progression).
 *
 * Runs the SHARED economy (../economy.js) forward in discrete time steps,
 * driven by a pluggable "strategy" that plays as an automated player: buys
 * generators/upgrades, picks idols from each draft, spends Prestige Points in
 * the meta-shop, and decides when to macro-reset.
 *
 * Because it imports the exact economy the browser game uses, the timing and
 * balance numbers it reports reflect the real game.
 *
 * Determinism: given (strategy, config, seed, step settings) a run is fully
 * reproducible. Idol drafts use a seeded PRNG so "random" picks repeat.
 *
 * Two time horizons are modeled:
 *   - within a run: idle production accrues; depth (P-level) climbs.
 *   - across runs: macro-resets bank Prestige Points; meta-shop bonuses persist.
 * A single simulate() call can span many macro-resets (a whole meta-run).
 */

"use strict";

const E = require("../economy.js");
const D = E.D;

// Small deterministic PRNG (mulberry32) so idol drafts are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} opts
 * @param {object} opts.strategy        Strategy (see strategies.js).
 * @param {number} opts.durationSeconds In-game seconds to simulate. Default 1h.
 * @param {number} opts.stepSeconds     Time per step. Default 1.
 * @param {number} opts.sampleSeconds   Time-series sampling interval.
 * @param {object} opts.config          Economy CONFIG overrides (merged).
 * @param {number} opts.seed            PRNG seed for idol drafts. Default 1.
 * @param {object} opts.meta            Starting meta state (for warm-start runs).
 * @param {object[]} opts.milestones    Goals to timestamp: { id, label, metric, value }.
 *                                       metric: energy|totalEarned|perSec|depth|
 *                                       prestigeLevel|points|macroResets.
 * @param {number} opts.maxMacroResets  Safety cap. Default 1000.
 * @returns {object} { meta, final, milestones, series }
 */
function simulate(opts) {
  const o = opts || {};
  const strategy = o.strategy;
  if (!strategy || typeof strategy.decide !== "function") {
    throw new Error("simulate() requires opts.strategy with a decide() function");
  }

  const duration = o.durationSeconds != null ? o.durationSeconds : 3600;
  const step = o.stepSeconds != null ? o.stepSeconds : 1;
  const sampleEvery =
    o.sampleSeconds != null ? o.sampleSeconds : Math.max(step, Math.floor(duration / 500) || step);
  const config = Object.assign({}, E.CONFIG, o.config || {});
  const milestoneDefs = (o.milestones || []).map(normalizeMilestone);
  const maxMacroResets = o.maxMacroResets != null ? o.maxMacroResets : 1000;
  const rng = mulberry32(o.seed != null ? o.seed : 1);

  const meta = o.meta ? cloneMeta(o.meta) : E.freshMeta();
  const run = E.freshRun(meta, config);

  // Initial idol draft for the first run.
  draftAndPick(strategy, run, meta, config, rng);
  E.applyIdolStartBonuses(run, meta);

  let derived = E.recompute(run, meta, config);

  const series = [];
  const milestoneHits = {};
  let macroResets = 0;
  let lastSampleAt = -Infinity;
  const totalSteps = Math.ceil(duration / step);

  function metricValue(name) {
    switch (name) {
      case "energy": return D(run.energy);
      case "totalEarned": return D(run.totalEarned);
      case "perSec": return derived.perSec;
      case "depth": return D(E.depthFromEnergy(run.totalEarned, config));
      case "prestigeLevel": return D(E.prestigeLevel(run, config));
      case "points": return D(meta.points);
      case "lifetimePoints": return D(meta.lifetimePoints);
      case "macroResets": return D(macroResets);
      default: return D(0);
    }
  }

  function sample(t) {
    series.push({
      t,
      energy: run.energy.toString(),
      totalEarned: run.totalEarned.toString(),
      perSec: derived.perSec.toString(),
      depth: E.depthFromEnergy(run.totalEarned, config),
      prestigeLevel: E.prestigeLevel(run, config),
      points: meta.points.toString(),
      lifetimePoints: meta.lifetimePoints.toString(),
      macroResets,
      idols: run.idols.slice(),
      generators: Object.assign({}, run.generators),
    });
  }

  function checkMilestones(t) {
    for (const m of milestoneDefs) {
      if (milestoneHits[m.id]) continue;
      if (metricValue(m.metric).gte(m.value)) {
        milestoneHits[m.id] = {
          id: m.id, label: m.label, metric: m.metric, target: m.value.toString(),
          timeSeconds: t,
          depth: E.depthFromEnergy(run.totalEarned, config),
          points: meta.points.toString(),
          macroResets,
        };
      }
    }
  }

  sample(0);
  checkMilestones(0);
  lastSampleAt = 0;

  for (let i = 0; i < totalSteps; i++) {
    const tStart = i * step;
    const dt = Math.min(step, duration - tStart);
    const t = tStart + dt;

    // 1) Idle accrual.
    E.advanceTime(run, derived, dt);

    // 2) Strategy spends energy (generators/upgrades) and meta points.
    const ctx = makeCtx(run, meta, derived, config, t, () => { derived = E.recompute(run, meta, config); });
    let changed = strategy.decide(ctx);
    if (changed) derived = E.recompute(run, meta, config);

    // Meta-shop spending (permanent). Allowed any time points exist.
    if (typeof strategy.spendMeta === "function") {
      if (strategy.spendMeta(ctx)) derived = E.recompute(run, meta, config);
    }

    // 3) Macro-reset decision.
    if (macroResets < maxMacroResets && typeof strategy.shouldMacroReset === "function") {
      if (strategy.shouldMacroReset(ctx)) {
        E.macroReset(run, meta, config);
        macroResets++;
        // New run => new draft.
        draftAndPick(strategy, run, meta, config, rng);
        E.applyIdolStartBonuses(run, meta);
        derived = E.recompute(run, meta, config);
      }
    }

    // 4) Record.
    checkMilestones(t);
    if (t - lastSampleAt >= sampleEvery || i === totalSteps - 1) {
      sample(t);
      lastSampleAt = t;
    }
  }

  return {
    meta: {
      strategy: strategy.name || "anonymous",
      durationSeconds: duration,
      stepSeconds: step,
      sampleSeconds: sampleEvery,
      seed: o.seed != null ? o.seed : 1,
      config,
      steps: totalSteps,
    },
    final: {
      energy: run.energy.toString(),
      totalEarned: run.totalEarned.toString(),
      perSec: derived.perSec.toString(),
      depth: E.depthFromEnergy(run.totalEarned, config),
      prestigeLevel: E.prestigeLevel(run, config),
      points: meta.points.toString(),
      lifetimePoints: meta.lifetimePoints.toString(),
      macroResets,
      idols: run.idols.slice(),
      generators: Object.assign({}, run.generators),
      metaLevels: Object.assign({}, meta.metaLevels),
    },
    milestones: milestoneDefs.map((m) => milestoneHits[m.id] || {
      id: m.id, label: m.label, metric: m.metric, target: m.value.toString(),
      timeSeconds: null, reached: false,
    }),
    series,
  };
}

// Offer the strategy a draft of 3 and let it pick 1 (default: first choice).
function draftAndPick(strategy, run, meta, config, rng) {
  const choices = E.rollIdolChoices(3, rng);
  let pickId;
  if (typeof strategy.pickIdol === "function") {
    pickId = strategy.pickIdol({ choices, run, meta, config, E, D });
  }
  if (!pickId) pickId = choices[0].id;
  E.chooseIdol(run, pickId);
  return pickId;
}

function makeCtx(run, meta, derived, config, t, recompute) {
  return {
    E, D, config, run, meta, derived, t,
    genCost: (id) => E.genCost(E.genDef(id), run.generators[id], derived.mods),
    upgradeCost: (id) => E.upgradeCost(E.upgradeDef(id), derived.mods),
    depth: () => E.depthFromEnergy(run.totalEarned, config),
    prestigeLevel: () => E.prestigeLevel(run, config),
    pointsOnReset: () => E.pointsOnReset(run, meta, config),
    recompute,
  };
}

function cloneMeta(m) {
  return {
    points: D(m.points),
    metaLevels: Object.assign({}, m.metaLevels),
    macroResets: m.macroResets || 0,
    lifetimePoints: D(m.lifetimePoints || 0),
  };
}

function normalizeMilestone(m, i) {
  return {
    id: m.id || `m${i}`,
    label: m.label || m.id || `milestone ${i}`,
    metric: m.metric || "totalEarned",
    value: D(m.value),
  };
}

module.exports = { simulate, mulberry32 };
