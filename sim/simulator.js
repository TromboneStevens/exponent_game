/* Headless simulation engine for Quantum Forge.
 *
 * Runs the SHARED economy (../economy.js) forward in discrete time steps,
 * driven by a pluggable "strategy" that acts as an automated player. Because
 * it imports the exact same economy the browser game uses, timing/balance
 * numbers it reports reflect the real game, not a reimplementation.
 *
 * The engine is deterministic given (strategy, config, step settings), so runs
 * are reproducible. It records a downsampled time series plus milestone
 * timestamps for easy analysis and CSV/JSON export.
 */

"use strict";

const E = require("../economy.js");
const D = E.D;

/**
 * Run a single simulation.
 *
 * @param {object} opts
 * @param {object} opts.strategy        Strategy object (see strategies.js).
 * @param {number} opts.durationSeconds In-game seconds to simulate. Default 1h.
 * @param {number} opts.stepSeconds     Time advanced per step. Larger = faster
 *                                       but coarser. Default 1s.
 * @param {number} opts.tapsPerSecond   Simulated taps/sec during active play.
 *                                       Default 0 (pure idle).
 * @param {number} opts.sampleSeconds   Sampling interval for the time series.
 *                                       Default: ~500 evenly spaced samples.
 * @param {object} opts.config          Economy CONFIG overrides (merged).
 * @param {object[]} opts.milestones    [{ id, label, metric, value }] goals to
 *                                       timestamp. metric: energy|totalEarned|
 *                                       perSec|cores. value: number/string.
 * @param {boolean} opts.autoPrestige   If true, strategy may trigger prestige.
 * @param {number} opts.maxPrestiges    Safety cap on collapses. Default 50.
 * @returns {object} result with { meta, series, milestones, final }.
 */
function simulate(opts) {
  const o = opts || {};
  const strategy = o.strategy;
  if (!strategy || typeof strategy.decide !== "function") {
    throw new Error("simulate() requires opts.strategy with a decide() function");
  }

  const duration = o.durationSeconds != null ? o.durationSeconds : 3600;
  const step = o.stepSeconds != null ? o.stepSeconds : 1;
  const tapsPerSecond = o.tapsPerSecond != null ? o.tapsPerSecond : 0;
  const sampleEvery =
    o.sampleSeconds != null ? o.sampleSeconds : Math.max(step, Math.floor(duration / 500) || step);
  const config = Object.assign({}, E.CONFIG, o.config || {});
  const milestoneDefs = (o.milestones || []).map(normalizeMilestone);
  const autoPrestige = !!o.autoPrestige;
  const maxPrestiges = o.maxPrestiges != null ? o.maxPrestiges : 50;

  const state = E.freshState();
  if (typeof strategy.init === "function") strategy.init(state, { E, D, config });

  let derived = E.recompute(state, config);

  const series = [];
  const milestoneHits = {}; // id -> { timeSeconds, ... }
  let prestiges = 0;
  let totalTaps = 0;
  let lastSampleAt = -Infinity;
  const totalSteps = Math.ceil(duration / step);

  function metricValue(name) {
    switch (name) {
      case "energy": return state.energy;
      case "totalEarned": return state.totalEarned;
      case "cores": return state.cores;
      case "perSec": return derived.perSec;
      case "tapGain": return E.tapGainFor(derived);
      default: return D(0);
    }
  }

  function sample(t) {
    series.push({
      t,
      energy: state.energy.toString(),
      totalEarned: state.totalEarned.toString(),
      perSec: derived.perSec.toString(),
      cores: state.cores.toString(),
      coreMult: derived.coreMult.toNumber(),
      generators: Object.assign({}, state.generators),
      upgradesOwned: E.UPGRADES.filter((u) => state.upgrades[u.id]).length,
      prestiges,
    });
  }

  function checkMilestones(t) {
    for (const m of milestoneDefs) {
      if (milestoneHits[m.id]) continue;
      if (metricValue(m.metric).gte(m.value)) {
        milestoneHits[m.id] = {
          id: m.id,
          label: m.label,
          metric: m.metric,
          target: m.value.toString(),
          timeSeconds: t,
          energy: state.energy.toString(),
          perSec: derived.perSec.toString(),
          cores: state.cores.toString(),
          prestiges,
        };
      }
    }
  }

  // Sample and check at t=0 before any action.
  sample(0);
  checkMilestones(0);
  lastSampleAt = 0;

  for (let i = 0; i < totalSteps; i++) {
    const tStart = i * step;
    const dt = Math.min(step, duration - tStart);
    const t = tStart + dt;

    // 1) Accrue passive production for this step.
    E.advanceTime(state, derived, dt);

    // 2) Apply simulated taps for this step.
    if (tapsPerSecond > 0) {
      const taps = tapsPerSecond * dt;
      const gain = E.tapGainFor(derived).mul(taps);
      E.addEnergy(state, gain);
      totalTaps += taps;
    }

    // 3) Let the strategy spend. It may loop internally; we recompute after.
    const ctx = {
      E, D, config, state, derived,
      t,
      genCost: (id) => E.genCost(E.genDef(id), state.generators[id]),
      recompute: () => { derived = E.recompute(state, config); },
    };
    let changed = strategy.decide(ctx);
    if (changed) derived = E.recompute(state, config);

    // 4) Optional auto-prestige.
    if (autoPrestige && prestiges < maxPrestiges && strategy.shouldPrestige) {
      if (strategy.shouldPrestige(ctx)) {
        const gained = E.prestige(state, config);
        if (gained.gt(0)) {
          prestiges++;
          derived = E.recompute(state, config);
          if (typeof strategy.onPrestige === "function") strategy.onPrestige(ctx, gained);
        }
      }
    }

    // 5) Record.
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
      tapsPerSecond,
      sampleSeconds: sampleEvery,
      autoPrestige,
      config,
      steps: totalSteps,
    },
    final: {
      energy: state.energy.toString(),
      totalEarned: state.totalEarned.toString(),
      perSec: derived.perSec.toString(),
      cores: state.cores.toString(),
      coreMult: derived.coreMult.toNumber(),
      generators: Object.assign({}, state.generators),
      upgrades: Object.assign({}, state.upgrades),
      prestiges,
      totalTaps,
    },
    milestones: milestoneDefs.map((m) => milestoneHits[m.id] || {
      id: m.id, label: m.label, metric: m.metric,
      target: m.value.toString(), timeSeconds: null, reached: false,
    }),
    series,
  };
}

function normalizeMilestone(m, i) {
  return {
    id: m.id || `m${i}`,
    label: m.label || m.id || `milestone ${i}`,
    metric: m.metric || "energy",
    value: D(m.value),
  };
}

module.exports = { simulate };
