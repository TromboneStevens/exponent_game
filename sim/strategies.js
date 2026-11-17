/* Automated "player" strategies for the simulator.
 *
 * A strategy plays the idle + idols + meta-progression game. It can implement:
 *   name                 string label
 *   decide(ctx)          spend ENERGY on generators/upgrades; return true if it bought
 *   spendMeta(ctx)?      spend PRESTIGE POINTS in the meta-shop; return true if it bought
 *   shouldMacroReset(ctx)? => boolean  when to collapse the run
 *   pickIdol({choices,...})? => idolId  which of the 3 drafted idols to take
 *
 * ctx: { E, D, config, run, meta, derived, t, genCost(id), upgradeCost(id),
 *        depth(), prestigeLevel(), pointsOnReset(), recompute() }
 */

"use strict";

/* ---------- Generator / upgrade spending helpers ---------- */

function perUnitProd(ctx, id) {
  return ctx.derived.genProd[id] || ctx.E.D(ctx.E.genDef(id).baseProd);
}

// Payback time (s) for the next unit of a generator. Lower is better.
function paybackSeconds(ctx, id) {
  const prod = perUnitProd(ctx, id);
  if (prod.lte(0)) return Infinity;
  return ctx.genCost(id).div(prod).toNumber();
}

function spendUpgrades(ctx) {
  let bought = false;
  for (const u of ctx.E.UPGRADES) {
    if (ctx.run.upgrades[u.id]) continue;
    if (ctx.E.buyUpgrade(ctx.run, ctx.meta, u.id)) { bought = true; ctx.recompute(); }
  }
  return bought;
}

function spendBestRoi(ctx) {
  let bought = false;
  let guard = 200000;
  while (guard-- > 0) {
    let best = null, bestPb = Infinity;
    for (const g of ctx.E.GENERATORS) {
      if (!ctx.run.energy.gte(ctx.genCost(g.id))) continue;
      const pb = paybackSeconds(ctx, g.id);
      if (pb < bestPb) { bestPb = pb; best = g.id; }
    }
    if (!best) break;
    if (!ctx.E.buyGenerator(ctx.run, ctx.meta, best)) break;
    bought = true;
    ctx.recompute();
  }
  return bought;
}

function spendCheapest(ctx) {
  let bought = false;
  let guard = 200000;
  while (guard-- > 0) {
    let best = null, bestCost = null;
    for (const g of ctx.E.GENERATORS) {
      const cost = ctx.genCost(g.id);
      if (ctx.run.energy.gte(cost) && (bestCost === null || cost.lt(bestCost))) { best = g.id; bestCost = cost; }
    }
    if (!best) break;
    if (!ctx.E.buyGenerator(ctx.run, ctx.meta, best)) break;
    bought = true;
    ctx.recompute();
  }
  return bought;
}

/* ---------- Meta-shop spending ---------- */

// Buy any affordable meta upgrade, cheapest-first, leaving nothing on the table.
function spendMetaGreedy(ctx) {
  let bought = false;
  let guard = 100000;
  while (guard-- > 0) {
    let best = null, bestCost = null;
    for (const m of ctx.E.META_UPGRADES) {
      const lvl = ctx.meta.metaLevels[m.id] || 0;
      if (lvl >= m.max) continue;
      const cost = ctx.E.metaCost(m, lvl);
      if (ctx.meta.points.gte(cost) && (bestCost === null || cost.lt(bestCost))) { best = m.id; bestCost = cost; }
    }
    if (!best) break;
    if (!ctx.E.buyMeta(ctx.meta, best)) break;
    bought = true;
  }
  return bought;
}

/* ---------- Macro-reset policies ---------- */

// Reset once the run has PLATEAUED at a meaningful depth: the player has pushed
// past `minDepth` P-levels and then gone `stallSeconds` without clearing a new
// level (production can no longer keep pace with exponential costs). Resetting
// below minDepth is pointless churn, so the policy refuses to.
function makeStallReset(stallSeconds, minDepth) {
  let lastLevel = -1;
  let lastGainTime = 0;
  let started = false;
  return function shouldMacroReset(ctx) {
    const lvl = ctx.prestigeLevel();
    if (!started) { lastLevel = lvl; lastGainTime = ctx.t; started = true; }
    if (lvl > lastLevel) { lastLevel = lvl; lastGainTime = ctx.t; }
    if (ctx.depth() < minDepth) return false; // haven't earned a worthwhile run yet
    const stalled = ctx.t - lastGainTime >= stallSeconds;
    return stalled && ctx.pointsOnReset().gt(0);
  };
}

/* ---------- Idol-pick policies (define "builds") ---------- */

// Prefer idols whose first modifier matches one of `preferTypes`, in order.
function makeIdolPicker(preferTypes) {
  return function pickIdol({ choices }) {
    for (const type of preferTypes) {
      const match = choices.find((c) => c.mods.some((m) => m.type === type));
      if (match) return match.id;
    }
    return choices[0].id;
  };
}

/* ---------- Exported strategies ---------- */

const idleOnly = {
  name: "idle-only",
  decide() { return false; }, // buys nothing; pure baseline
};

const bestRoi = {
  name: "best-roi",
  decide(ctx) {
    const a = spendUpgrades(ctx);
    const b = spendBestRoi(ctx);
    return a || b;
  },
  spendMeta: spendMetaGreedy,
};

const cheapest = {
  name: "cheapest",
  decide(ctx) {
    const a = spendUpgrades(ctx);
    const b = spendCheapest(ctx);
    return a || b;
  },
  spendMeta: spendMetaGreedy,
};

// A full meta-run player: best-ROI economy, greedy meta-shop, stall-based
// macro-resets, and a production-leaning idol build.
const metaRunner = {
  name: "meta-runner",
  decide(ctx) {
    const a = spendUpgrades(ctx);
    const b = spendBestRoi(ctx);
    return a || b;
  },
  spendMeta: spendMetaGreedy,
  // Only collapse after plateauing past P5 with no new level for 60s.
  shouldMacroReset: makeStallReset(60, 5),
  pickIdol: makeIdolPicker(["allMul", "prodExp", "genMul"]),
};

// Build archetypes — same play, different idol preference, for build comparison.
const buildProduction = Object.assign({}, metaRunner, { name: "build-production", pickIdol: makeIdolPicker(["allMul", "genMul", "prodExp"]) });
const buildCompound   = Object.assign({}, metaRunner, { name: "build-compound",   pickIdol: makeIdolPicker(["prodExp", "allMul"]) });
const buildThrift     = Object.assign({}, metaRunner, { name: "build-thrift",     pickIdol: makeIdolPicker(["costMul", "allMul"]) });
const buildPoints     = Object.assign({}, metaRunner, { name: "build-points",     pickIdol: makeIdolPicker(["pointsMul", "depthMul", "allMul"]) });

const ALL = {
  idleOnly, bestRoi, cheapest, metaRunner,
  buildProduction, buildCompound, buildThrift, buildPoints,
};

function byName(name) {
  if (!name) return null;
  if (ALL[name]) return ALL[name];
  for (const s of Object.values(ALL)) if (s.name === name) return s;
  return null;
}

module.exports = {
  ...ALL,
  ALL,
  byName,
  helpers: { perUnitProd, paybackSeconds, spendUpgrades, spendBestRoi, spendCheapest, spendMetaGreedy, makeStallReset, makeIdolPicker },
};
