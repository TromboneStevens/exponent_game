/* Headless Stage-1 combat simulator.
 *
 * Runs the shared combat economy (../combat.js) forward in time: auto-attacks
 * kill enemies, gold drops, and a pluggable buy-strategy spends it. Reports
 * pacing data (kills over time, where you wall, time-to-upgrade, DPS curve) so
 * HP/gold/cost curves can be tuned with numbers instead of guesses.
 *
 * Deterministic given (strategy, config, step). Crits are modeled as expected
 * value in combat.js, so no RNG is needed here.
 */

"use strict";

const C = require("../combat.js");
const D = C.D;

/**
 * @param {object} opts
 * @param {object} opts.strategy        buy-strategy (see combatStrategies.js)
 * @param {number} opts.durationSeconds sim length. default 600 (10 min)
 * @param {number} opts.stepSeconds     time per step. default 0.25
 * @param {number} opts.sampleSeconds   time-series sampling. default ~400 rows
 * @param {object} opts.config          combat CONFIG overrides (merged)
 * @param {number[]} opts.killGoals     kill counts to timestamp (e.g. [1,10,50])
 * @returns {object} { meta, final, goals, series, walls }
 */
function simulate(opts) {
  const o = opts || {};
  const strategy = o.strategy;
  if (!strategy || typeof strategy.decide !== "function") {
    throw new Error("combat.simulate() requires opts.strategy.decide()");
  }
  const duration = o.durationSeconds != null ? o.durationSeconds : 600;
  const step = o.stepSeconds != null ? o.stepSeconds : 0.25;
  const sampleEvery = o.sampleSeconds != null ? o.sampleSeconds : Math.max(step, duration / 400);
  const config = Object.assign({}, C.CONFIG, o.config || {});
  const killGoals = (o.killGoals || [1, 5, 10, 25, 50, 100, 200]).slice().sort((a, b) => a - b);

  const state = C.freshState(config);
  const series = [];
  const goalHits = {};
  let lastSampleAt = -Infinity;

  // Wall detection: track the longest time spent on a single enemy.
  let currentEnemyStart = 0;
  let worstStall = { kills: 0, seconds: 0 };
  let prevKills = 0;

  function sample(t) {
    const s = C.stats(state, config);
    series.push({
      t: round(t, 2),
      kills: state.kills,
      gold: state.gold.toString(),
      dps: C.dps(state, config).toString(),
      attackDamage: s.attackDamage,
      attackSpeed: s.attackSpeed,
      effectiveAttackSpeed: s.effectiveAttackSpeed,
      critChance: s.critChance,
      critMult: s.critMult,
      goldMult: s.goldMult,
      enemyHP: state.enemyHP ? state.enemyHP.toString() : "0",
      enemyMaxHP: state.enemyMaxHP ? state.enemyMaxHP.toString() : "0",
      levels: Object.assign({}, state.levels),
    });
  }

  function checkGoals(t) {
    for (const g of killGoals) {
      if (goalHits[g] == null && state.kills >= g) {
        goalHits[g] = { kills: g, timeSeconds: round(t, 2), gold: state.gold.toString(), dps: C.dps(state, config).toString() };
      }
    }
  }

  C.ensureEnemy(state, config);
  sample(0);
  checkGoals(0);
  lastSampleAt = 0;
  const totalSteps = Math.ceil(duration / step);

  for (let i = 0; i < totalSteps; i++) {
    const t = Math.min((i + 1) * step, duration);
    const dt = t - i * step;

    // 1) Deal damage / kill / collect gold.
    C.damageStep(state, dt, config);

    // 2) Strategy spends gold.
    const ctx = makeCtx(state, config, t);
    strategy.decide(ctx);

    // 3) Wall tracking: if kills didn't advance, the current enemy is taking long.
    if (state.kills > prevKills) {
      const spent = t - currentEnemyStart;
      // we may have killed several; approximate per-enemy time by the gap.
      currentEnemyStart = t;
      prevKills = state.kills;
    } else {
      const stall = t - currentEnemyStart;
      if (stall > worstStall.seconds) worstStall = { kills: state.kills, seconds: round(stall, 2) };
    }

    // 4) Record.
    checkGoals(t);
    if (t - lastSampleAt >= sampleEvery || i === totalSteps - 1) {
      sample(t);
      lastSampleAt = t;
    }
  }

  const finalStats = C.stats(state, config);
  return {
    meta: {
      strategy: strategy.name || "anonymous",
      durationSeconds: duration,
      stepSeconds: step,
      config,
    },
    final: {
      kills: state.kills,
      gold: state.gold.toString(),
      dps: C.dps(state, config).toString(),
      stats: finalStats,
      levels: Object.assign({}, state.levels),
    },
    goals: killGoals.map((g) => goalHits[g] || { kills: g, timeSeconds: null, reached: false }),
    worstStall,
    series,
  };
}

function makeCtx(state, config, t) {
  return {
    C, D, config, state, t,
    dps: () => C.dps(state, config),
    stats: () => C.stats(state, config),
    cost: (id) => C.upgradeCost(C.upgradeDef(id), state.levels[id]),
    buy: (id) => C.buyUpgrade(state, id, config),
  };
}

function round(x, n) { const f = Math.pow(10, n); return Math.round(x * f) / f; }

module.exports = { simulate };
