/* Automated "player" strategies for the simulator.
 *
 * A strategy decides what to buy on each simulation step. Each strategy is an
 * object with:
 *   name            string label
 *   decide(ctx)     mutate ctx.state via ctx.E.buy*; return true if it bought
 *                   anything (so the engine recomputes). May loop to spend down.
 *   shouldPrestige? (ctx) => boolean   optional, only used when autoPrestige on
 *   onPrestige?     (ctx, gained)      optional hook after a collapse
 *
 * ctx provides: E (economy module), D, config, state, derived, t (seconds),
 * genCost(id), recompute().
 *
 * Strategies spend greedily within a step but re-check affordability after each
 * purchase, mirroring how a real player clicks repeatedly.
 */

"use strict";

// Return the per-unit production a generator currently yields (after mults).
function perUnitProd(ctx, id) {
  return ctx.derived.genProd[id] || ctx.E.D(ctx.E.genDef(id).baseProd).mul(ctx.derived.coreMult);
}

// Payback time (seconds) to recoup a generator's next-unit cost from its added
// production. Lower is better. Returns Infinity if it produces nothing.
function paybackSeconds(ctx, id) {
  const prod = perUnitProd(ctx, id);
  if (prod.lte(0)) return Infinity;
  const cost = ctx.genCost(id);
  return cost.div(prod).toNumber();
}

/* ---------- Generator-buying helpers ---------- */

// Buy every generator we can afford, cheapest first, until nothing is affordable.
function spendGreedyCheapest(ctx) {
  let bought = false;
  let guard = 100000; // safety against pathological configs
  while (guard-- > 0) {
    let best = null;
    let bestCost = null;
    for (const g of ctx.E.GENERATORS) {
      const cost = ctx.genCost(g.id);
      if (ctx.state.energy.gte(cost) && (bestCost === null || cost.lt(bestCost))) {
        best = g.id;
        bestCost = cost;
      }
    }
    if (!best) break;
    if (!ctx.E.buyGenerator(ctx.state, best)) break;
    bought = true;
    ctx.recompute();
  }
  return bought;
}

// Buy the generator with the best (lowest) payback time, repeatedly.
function spendBestRoi(ctx) {
  let bought = false;
  let guard = 100000;
  while (guard-- > 0) {
    let best = null;
    let bestPb = Infinity;
    for (const g of ctx.E.GENERATORS) {
      const cost = ctx.genCost(g.id);
      if (!ctx.state.energy.gte(cost)) continue;
      const pb = paybackSeconds(ctx, g.id);
      if (pb < bestPb) {
        bestPb = pb;
        best = g.id;
      }
    }
    if (!best) break;
    if (!ctx.E.buyGenerator(ctx.state, best)) break;
    bought = true;
    ctx.recompute();
  }
  return bought;
}

// Buy all affordable upgrades (always good value in this prototype's design).
function spendUpgrades(ctx) {
  let bought = false;
  for (const u of ctx.E.UPGRADES) {
    if (ctx.state.upgrades[u.id]) continue;
    if (ctx.E.buyUpgrade(ctx.state, u.id)) {
      bought = true;
      ctx.recompute();
    }
  }
  return bought;
}

/* ---------- Prestige policies ---------- */

// Prestige when the pending gain would multiply current cores by >= factor,
// i.e. a meaningful jump, and at least `minGain` cores are available.
function makePrestigePolicy(factor, minGain) {
  return function shouldPrestige(ctx) {
    const gain = ctx.E.prestigeGain(ctx.state, ctx.config);
    if (gain.lt(minGain)) return false;
    // If we have no cores yet, prestige as soon as gain >= minGain.
    if (ctx.state.cores.lte(0)) return true;
    return gain.gte(ctx.state.cores.mul(factor));
  };
}

/* ---------- Exported strategies ---------- */

const idle = {
  name: "idle",
  // Pure idle: never buys. Baseline for "do nothing" curves.
  decide() { return false; },
};

const greedyCheapest = {
  name: "greedy-cheapest",
  decide(ctx) {
    // Upgrades first (they're flat-cost and compounding), then cheapest gens.
    const a = spendUpgrades(ctx);
    const b = spendGreedyCheapest(ctx);
    return a || b;
  },
};

const bestRoi = {
  name: "best-roi",
  decide(ctx) {
    const a = spendUpgrades(ctx);
    const b = spendBestRoi(ctx);
    return a || b;
  },
};

// Like best-ROI but keeps a cash buffer, only spending when it can afford the
// best-ROI pick without dropping below a fraction of income (less twitchy).
const patientRoi = {
  name: "patient-roi",
  decide(ctx) {
    spendUpgrades(ctx);
    // Only buy if the cheapest ROI pick costs <= all current energy minus 2s income.
    const buffer = ctx.derived.perSec.mul(2);
    let bought = false;
    let guard = 100000;
    while (guard-- > 0) {
      let best = null, bestPb = Infinity, bestCost = null;
      for (const g of ctx.E.GENERATORS) {
        const cost = ctx.genCost(g.id);
        if (!ctx.state.energy.sub(buffer).gte(cost)) continue;
        const pb = paybackSeconds(ctx, g.id);
        if (pb < bestPb) { bestPb = pb; best = g.id; bestCost = cost; }
      }
      if (!best) break;
      if (!ctx.E.buyGenerator(ctx.state, best)) break;
      bought = true;
      ctx.recompute();
    }
    return bought;
  },
};

// Prestige-focused: best-ROI play plus an automatic collapse policy.
const prestigeRoi = {
  name: "prestige-roi",
  decide(ctx) {
    const a = spendUpgrades(ctx);
    const b = spendBestRoi(ctx);
    return a || b;
  },
  shouldPrestige: makePrestigePolicy(2, 1), // collapse when gain >= 2x current cores
};

const ALL = { idle, greedyCheapest, bestRoi, patientRoi, prestigeRoi };

// Resolve a strategy by its CLI-friendly name (kebab or camel).
function byName(name) {
  if (!name) return null;
  const direct = ALL[name];
  if (direct) return direct;
  for (const s of Object.values(ALL)) {
    if (s.name === name) return s;
  }
  return null;
}

module.exports = {
  idle,
  greedyCheapest,
  bestRoi,
  patientRoi,
  prestigeRoi,
  ALL,
  byName,
  // exported for custom scenarios/tests
  helpers: { perUnitProd, paybackSeconds, spendGreedyCheapest, spendBestRoi, spendUpgrades, makePrestigePolicy },
};
