/* Buy-strategies for the Stage-1 combat simulator.
 *
 * Each has { name, decide(ctx) } where ctx = { C, D, config, state, t, dps(),
 * stats(), cost(id), buy(id) }. decide() spends gold; the engine recomputes DPS
 * from upgrade levels automatically.
 *
 * The headline strategy is `bestDpsPerGold`: it measures the marginal DPS gain
 * of each affordable upgrade per gold spent and buys the best. Comparing it to
 * naive strategies shows whether the 5 upgrade tracks are balanced (if one
 * upgrade always wins, the others are traps).
 */

"use strict";

// Marginal DPS gain from buying one level of `id` right now, without mutating
// real state (simulate the purchase on a shallow clone of levels).
function marginalDps(ctx, id) {
  const before = ctx.C.dps(ctx.state, ctx.config);
  const saved = ctx.state.levels[id];
  // Respect caps: a capped stat yields no gain.
  const u = ctx.C.upgradeDef(id);
  if (u.cap != null && ctx.C.statValue(u, saved) >= u.cap) return ctx.C.D(0);
  ctx.state.levels[id] = saved + 1;
  const after = ctx.C.dps(ctx.state, ctx.config);
  ctx.state.levels[id] = saved;
  return after.sub(before);
}

// Buy the affordable upgrade with the best marginal DPS per gold, repeatedly.
// `goldMult` is treated specially: it raises income, not DPS, so we value it by
// a proxy (its % income gain) scaled to be comparable to DPS gains.
function spendBestDpsPerGold(ctx) {
  let bought = false;
  let guard = 100000;
  while (guard-- > 0) {
    let best = null, bestRatio = 0;
    for (const u of ctx.C.UPGRADES) {
      const cost = ctx.cost(u.id);
      if (ctx.state.gold.lt(cost)) continue;
      let value;
      if (u.stat === "goldMult") {
        // Economy upgrade: value ~ current DPS * (fractional income gain).
        const s = ctx.stats();
        const gain = u.perLevel; // +10% income per level (mulPerLevel base)
        value = ctx.dps().mul(gain);
      } else {
        value = marginalDps(ctx, u.id);
      }
      if (value.lte(0)) continue;
      const ratio = value.div(cost).toNumber();
      if (ratio > bestRatio) { bestRatio = ratio; best = u.id; }
    }
    if (!best) break;
    if (!ctx.buy(best)) break;
    bought = true;
  }
  return bought;
}

/* ---------- Exported strategies ---------- */

const noBuy = {
  name: "no-buy",
  decide() { return false; }, // baseline: starting stats forever
};

const bestDpsPerGold = {
  name: "best-dps-per-gold",
  decide: spendBestDpsPerGold,
};

// Always dumps everything into attack damage (tests whether atk is overpowered).
const atkOnly = {
  name: "atk-only",
  decide(ctx) {
    let bought = false, guard = 100000;
    while (guard-- > 0 && ctx.buy("atk")) bought = true;
    return bought;
  },
};

// Round-robin: spend evenly across all 5 tracks (tests a "spread" playstyle).
const roundRobin = {
  name: "round-robin",
  decide(ctx) {
    let bought = false, guard = 100000;
    while (guard-- > 0) {
      let any = false;
      for (const u of ctx.C.UPGRADES) {
        if (ctx.state.gold.gte(ctx.cost(u.id)) && ctx.buy(u.id)) { any = true; bought = true; }
      }
      if (!any) break;
    }
    return bought;
  },
};

const ALL = { noBuy, bestDpsPerGold, atkOnly, roundRobin };

function byName(name) {
  if (!name) return null;
  if (ALL[name]) return ALL[name];
  for (const s of Object.values(ALL)) if (s.name === name) return s;
  return null;
}

module.exports = { ...ALL, ALL, byName, helpers: { marginalDps, spendBestDpsPerGold } };
