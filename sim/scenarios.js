/* Predefined simulation scenarios (experiments).
 *
 * Each scenario is a function that runs one or more simulations and returns a
 * { kind, results, extra } object the CLI knows how to report. Scenarios are
 * the reusable "questions" you ask of the balance model:
 *   - milestones:  how long to hit a ladder of energy goals, per strategy
 *   - compare:     side-by-side strategy comparison on the same milestones
 *   - sweep:       vary one CONFIG value and measure time-to-goal (balancing)
 *   - prestige:    long run with auto-prestige to study the meta layer
 */

"use strict";

const { simulate } = require("./simulator.js");
const strategies = require("./strategies.js");
const E = require("../economy.js");

// A default milestone ladder spanning the prototype's progression.
const DEFAULT_MILESTONES = [
  { id: "e1k",  label: "1K energy",        metric: "totalEarned", value: "1e3" },
  { id: "e1m",  label: "1M energy",        metric: "totalEarned", value: "1e6" },
  { id: "e1b",  label: "1B energy",        metric: "totalEarned", value: "1e9" },
  { id: "e1t",  label: "1T energy",        metric: "totalEarned", value: "1e12" },
  { id: "e1qa", label: "1Qa energy",       metric: "totalEarned", value: "1e15" },
  { id: "firstPrestige", label: "prestige unlocked", metric: "totalEarned", value: "1e9" },
  { id: "rate1m", label: "1M/sec rate",    metric: "perSec",      value: "1e6" },
];

// ---- Scenario: milestones for a single strategy ----
function milestones(opts) {
  const strategy = resolveStrategy(opts.strategy || "best-roi");
  const result = simulate({
    strategy,
    durationSeconds: opts.durationSeconds || 86400, // 1 day default
    stepSeconds: opts.stepSeconds || 1,
    tapsPerSecond: opts.tapsPerSecond || 0,
    config: opts.config,
    milestones: opts.milestones || DEFAULT_MILESTONES,
  });
  return { kind: "single", results: [result] };
}

// ---- Scenario: compare several strategies on the same milestones ----
function compare(opts) {
  const names = opts.strategies || ["idle", "greedy-cheapest", "best-roi", "patient-roi"];
  const results = names.map((n) =>
    simulate({
      strategy: resolveStrategy(n),
      durationSeconds: opts.durationSeconds || 86400,
      stepSeconds: opts.stepSeconds || 1,
      tapsPerSecond: opts.tapsPerSecond || 0,
      config: opts.config,
      milestones: opts.milestones || DEFAULT_MILESTONES,
    })
  );
  return { kind: "compare", results };
}

// ---- Scenario: parameter sweep (core balancing tool) ----
// Varies one CONFIG key across values and measures time-to-goal for each.
function sweep(opts) {
  const key = opts.key;
  if (!key) throw new Error("sweep requires opts.key (a CONFIG field to vary)");
  const values = opts.values || [];
  const strategy = resolveStrategy(opts.strategy || "best-roi");
  const metric = opts.metric || "totalEarned";
  const value = opts.value || "1e12";
  // A cores goal only makes sense with prestige enabled, otherwise cores never grow.
  const needsPrestige = metric === "cores" || opts.autoPrestige;
  const goal = opts.goal || {
    id: "goal",
    label: opts.goalLabel ? `${opts.goalLabel} (${metric} >= ${value})` : `${metric} >= ${value}`,
    metric,
    value,
  };

  const results = [];
  const rows = [];
  for (const v of values) {
    const config = Object.assign({}, opts.config, { [key]: v });
    const r = simulate({
      strategy: needsPrestige ? strategies.prestigeRoi : strategy,
      durationSeconds: opts.durationSeconds || 86400 * 7, // allow long runs
      stepSeconds: opts.stepSeconds || 1,
      tapsPerSecond: opts.tapsPerSecond || 0,
      autoPrestige: needsPrestige,
      maxPrestiges: opts.maxPrestiges || 100,
      config,
      milestones: [goal],
    });
    const usedName = needsPrestige ? strategies.prestigeRoi.name : strategy.name;
    r.meta.strategy = `${usedName} [${key}=${v}]`;
    results.push(r);
    const hit = r.milestones[0];
    rows.push({ value: v, timeSeconds: hit.timeSeconds, reached: hit.timeSeconds != null });
  }
  return { kind: "sweep", results, extra: { key, goal, rows } };
}

// ---- Scenario: long prestige / meta-layer run ----
function prestige(opts) {
  const strategy = strategies.prestigeRoi;
  const result = simulate({
    strategy,
    durationSeconds: opts.durationSeconds || 86400 * 3,
    stepSeconds: opts.stepSeconds || 1,
    tapsPerSecond: opts.tapsPerSecond || 0,
    autoPrestige: true,
    maxPrestiges: opts.maxPrestiges || 50,
    config: opts.config,
    milestones: opts.milestones || [
      { id: "p1",  label: "1 core",    metric: "cores", value: "1" },
      { id: "p10", label: "10 cores",  metric: "cores", value: "10" },
      { id: "p100",label: "100 cores", metric: "cores", value: "100" },
      { id: "p1k", label: "1K cores",  metric: "cores", value: "1e3" },
    ],
  });
  return { kind: "single", results: [result] };
}

function resolveStrategy(name) {
  const s = strategies.byName(name);
  if (!s) {
    throw new Error(`Unknown strategy "${name}". Available: ${Object.values(strategies.ALL).map((x) => x.name).join(", ")}`);
  }
  return s;
}

module.exports = {
  DEFAULT_MILESTONES,
  milestones,
  compare,
  sweep,
  prestige,
  resolveStrategy,
};
