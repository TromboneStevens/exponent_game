/* Predefined simulation scenarios (experiments).
 *
 * Each returns { kind, results, extra } the CLI knows how to report.
 *   single     one strategy: milestone timing + full time series
 *   compare    several strategies side-by-side on the same milestones
 *   builds     compare idol-build archetypes over a meta-run
 *   sweep      vary one CONFIG value; measure time-to-goal
 *   metarun    long multi-macro-reset run; study meta-progression
 */

"use strict";

const { simulate } = require("./simulator.js");
const strategies = require("./strategies.js");

// Default milestone ladder spanning the new progression axes.
const DEFAULT_MILESTONES = [
  { id: "p1",   label: "reach P1",     metric: "prestigeLevel", value: "1" },
  { id: "p3",   label: "reach P3",     metric: "prestigeLevel", value: "3" },
  { id: "p6",   label: "reach P6",     metric: "prestigeLevel", value: "6" },
  { id: "p10",  label: "reach P10",    metric: "prestigeLevel", value: "10" },
  { id: "pts1", label: "1 point",      metric: "points",        value: "1" },
  { id: "pts1k",label: "1K points",    metric: "lifetimePoints",value: "1e3" },
  { id: "reset1", label: "1st reset",  metric: "macroResets",   value: "1" },
];

function milestones(opts) {
  const strategy = resolveStrategy(opts.strategy || "meta-runner");
  const result = simulate(Object.assign({
    strategy,
    durationSeconds: opts.durationSeconds || 86400,
    stepSeconds: opts.stepSeconds || 1,
    seed: opts.seed,
    config: opts.config,
    milestones: opts.milestones || DEFAULT_MILESTONES,
  }));
  return { kind: "single", results: [result] };
}

function compare(opts) {
  const names = opts.strategies || ["idle-only", "cheapest", "best-roi", "meta-runner"];
  const results = names.map((n) =>
    simulate({
      strategy: resolveStrategy(n),
      durationSeconds: opts.durationSeconds || 86400,
      stepSeconds: opts.stepSeconds || 1,
      seed: opts.seed,
      config: opts.config,
      milestones: opts.milestones || DEFAULT_MILESTONES,
    })
  );
  return { kind: "compare", results };
}

// Compare idol-build archetypes. Same economy play, different idol preference.
function builds(opts) {
  const names = opts.strategies || ["build-production", "build-compound", "build-thrift", "build-points"];
  const results = names.map((n) =>
    simulate({
      strategy: resolveStrategy(n),
      durationSeconds: opts.durationSeconds || 86400,
      stepSeconds: opts.stepSeconds || 1,
      seed: opts.seed,
      config: opts.config,
      milestones: opts.milestones || DEFAULT_MILESTONES,
    })
  );
  return { kind: "compare", results };
}

function sweep(opts) {
  const key = opts.key;
  if (!key) throw new Error("sweep requires opts.key (a CONFIG field to vary)");
  const values = opts.values || [];
  const strategy = resolveStrategy(opts.strategy || "meta-runner");
  const metric = opts.metric || "prestigeLevel";
  const value = opts.value || "10";
  const goal = {
    id: "goal",
    label: `${metric} >= ${value}`,
    metric,
    value,
  };

  const results = [];
  const rows = [];
  for (const v of values) {
    const config = Object.assign({}, opts.config, { [key]: v });
    const r = simulate({
      strategy,
      durationSeconds: opts.durationSeconds || 86400 * 3,
      stepSeconds: opts.stepSeconds || 1,
      seed: opts.seed,
      config,
      milestones: [goal],
    });
    r.meta.strategy = `${strategy.name} [${key}=${v}]`;
    results.push(r);
    const hit = r.milestones[0];
    rows.push({ value: v, timeSeconds: hit.timeSeconds, reached: hit.timeSeconds != null });
  }
  return { kind: "sweep", results, extra: { key, goal, rows } };
}

function metarun(opts) {
  const strategy = resolveStrategy(opts.strategy || "meta-runner");
  const result = simulate({
    strategy,
    durationSeconds: opts.durationSeconds || 86400 * 3,
    stepSeconds: opts.stepSeconds || 1,
    seed: opts.seed,
    config: opts.config,
    milestones: opts.milestones || [
      { id: "r1",  label: "1 reset",   metric: "macroResets", value: "1" },
      { id: "r5",  label: "5 resets",  metric: "macroResets", value: "5" },
      { id: "r20", label: "20 resets", metric: "macroResets", value: "20" },
      { id: "pk1k",label: "1K lifetime pts", metric: "lifetimePoints", value: "1e3" },
      { id: "pk1m",label: "1M lifetime pts", metric: "lifetimePoints", value: "1e6" },
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

module.exports = { DEFAULT_MILESTONES, milestones, compare, builds, sweep, metarun, resolveStrategy };
