/* Quantum Forge — shared economy module (single source of truth).
 *
 * This module contains ONLY pure game-economy logic and content definitions:
 * generator/upgrade data, cost curves, production math, prestige formula and
 * number formatting. It has no DOM and no timers, so the exact same code runs
 * in the browser game (game.js) and in the headless balance simulator (sim/).
 *
 * UMD-style export: attaches to `window.Economy` in a browser and to
 * `module.exports` under Node. In the browser, `Decimal` is expected as a
 * global (loaded via the break_infinity.js CDN script). In Node, it is
 * require()'d from the break_infinity.js package.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    // Node / CommonJS
    const Decimal = require("break_infinity.js");
    module.exports = factory(Decimal);
  } else {
    // Browser global
    root.Economy = factory(root.Decimal);
  }
})(typeof self !== "undefined" ? self : this, function (Decimal) {
  "use strict";

  const D = (x) => (x instanceof Decimal ? x : new Decimal(x));

  /* ---------- Static content definitions ---------- */

  // Generators: each produces Quantum Energy per second. Unit cost scales by
  // costMul^owned (classic exponential incremental curve).
  const GENERATORS = [
    { id: "qubit",     name: "Qubit",             desc: "A single oscillating quantum bit.",                 baseCost: "15",    baseProd: "0.2",   costMul: 1.12 },
    { id: "entangler", name: "Entangler Pair",    desc: "Linked qubits amplify each other.",                 baseCost: "120",   baseProd: "2",     costMul: 1.13 },
    { id: "condenser", name: "Flux Condenser",    desc: "Condenses stray energy into usable flux.",          baseCost: "1500",  baseProd: "22",    costMul: 1.14 },
    { id: "reactor",   name: "Fusion Reactor",    desc: "Sustained reaction pouring out energy.",            baseCost: "25000", baseProd: "260",   costMul: 1.15 },
    { id: "singular",  name: "Micro Singularity", desc: "Bends spacetime to harvest vacuum energy.",         baseCost: "4.2e5", baseProd: "3400",  costMul: 1.16 },
    { id: "forge",     name: "Quantum Forge",     desc: "The namesake engine. Forges energy from nothing.",  baseCost: "8e6",   baseProd: "48000", costMul: 1.17 },
  ];

  // Upgrades: one-time purchases. Effects are applied in recompute().
  const UPGRADES = [
    { id: "tap2",        name: "Reinforced Tap",  desc: "Tapping yields ×2.",                 cost: "100",  kind: "tapMul",  value: 2 },
    { id: "tap3",        name: "Resonant Tap",    desc: "Tapping yields ×3 more.",            cost: "1e4",  kind: "tapMul",  value: 3 },
    { id: "all2",        name: "Overclock I",     desc: "All generators produce ×2.",         cost: "5000", kind: "allMul",  value: 2 },
    { id: "all3",        name: "Overclock II",    desc: "All generators produce ×3 more.",    cost: "2e6",  kind: "allMul",  value: 3 },
    { id: "qubitx5",     name: "Qubit Array",     desc: "Qubits produce ×5.",                 cost: "2500", kind: "genMul",  target: "qubit",   value: 5 },
    { id: "reactorx4",   name: "Reactor Coolant", desc: "Fusion Reactors produce ×4.",        cost: "3e5",  kind: "genMul",  target: "reactor", value: 4 },
    { id: "tapfromrate", name: "Quantum Siphon",  desc: "Tap also grants 5s of production.",  cost: "1e8",  kind: "tapRate", value: 5 },
  ];

  // Tunable balance constants, grouped so the simulator can override them.
  const CONFIG = {
    prestigeReq: "1e9",     // lifetime energy needed before a collapse pays out
    prestigeDivisor: "1e6", // totalEarned / divisor before the exponent
    prestigeExponent: 0.4,  // (totalEarned / divisor) ^ exponent
    corePerCoreBonus: 0.02, // +2% production & tap per core (additive)
    offlineCapSeconds: 60 * 60 * 12,
  };

  /* ---------- State ---------- */

  function freshState() {
    return {
      energy: D(0),
      totalEarned: D(0), // lifetime energy earned this run (drives prestige)
      cores: D(0),       // prestige currency (persists across collapses)
      generators: Object.fromEntries(GENERATORS.map((g) => [g.id, 0])),
      upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, false])),
    };
  }

  // Deep-ish clone of a state object (Decimals are immutable, so share refs).
  function cloneState(s) {
    return {
      energy: s.energy,
      totalEarned: s.totalEarned,
      cores: s.cores,
      generators: Object.assign({}, s.generators),
      upgrades: Object.assign({}, s.upgrades),
    };
  }

  /* ---------- Number formatting ---------- */

  const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

  function fmt(dec) {
    const n = D(dec);
    if (n.lt(1000)) {
      const num = n.toNumber();
      if (num !== 0 && num < 10 && !Number.isInteger(num)) return num.toFixed(1);
      return Math.floor(num).toString();
    }
    const exp = n.log10(); // break_infinity.js returns a plain number here
    const tier = Math.floor(exp / 3);
    if (tier < SUFFIXES.length) {
      const mantissa = n.div(D(10).pow(tier * 3)).toNumber();
      return mantissa.toFixed(2) + SUFFIXES[tier];
    }
    return n.toExponential(2).replace("e+", "e");
  }

  /* ---------- Cost curves ---------- */

  function genDef(id) {
    return GENERATORS.find((g) => g.id === id);
  }
  function upgradeDef(id) {
    return UPGRADES.find((u) => u.id === id);
  }

  // Cost of the next single unit of generator `g` given `owned` units.
  function genCost(g, owned) {
    return D(g.baseCost).mul(D(g.costMul).pow(owned));
  }

  // Cost to buy `count` units starting from `owned` (geometric series sum).
  function genCostBulk(g, owned, count) {
    const r = D(g.costMul);
    const first = D(g.baseCost).mul(r.pow(owned));
    return first.mul(r.pow(count).sub(1)).div(r.sub(1));
  }

  /* ---------- Production / derived values ---------- */

  // Compute everything derived from a state: production rates, tap gain, and
  // the core multiplier. Returns a plain object; callers cache it.
  function recompute(state, config) {
    const cfg = config || CONFIG;
    const coreMult = D(1).add(state.cores.mul(cfg.corePerCoreBonus));

    let allMul = D(1);
    let tapMul = D(1);
    const genMul = {};
    let tapRateSeconds = 0;

    for (const u of UPGRADES) {
      if (!state.upgrades[u.id]) continue;
      if (u.kind === "allMul") allMul = allMul.mul(u.value);
      else if (u.kind === "tapMul") tapMul = tapMul.mul(u.value);
      else if (u.kind === "genMul") genMul[u.target] = (genMul[u.target] || D(1)).mul(u.value);
      else if (u.kind === "tapRate") tapRateSeconds += u.value;
    }

    const genProd = {};
    let perSec = D(0);
    for (const g of GENERATORS) {
      const owned = state.generators[g.id];
      let per = D(g.baseProd).mul(allMul).mul(coreMult);
      if (genMul[g.id]) per = per.mul(genMul[g.id]);
      genProd[g.id] = per;
      perSec = perSec.add(per.mul(owned));
    }

    return {
      perSec,
      genProd,
      coreMult,
      tapGain: D(1).mul(tapMul).mul(coreMult),
      tapRateSeconds,
    };
  }

  /* ---------- Prestige ---------- */

  function prestigeGain(state, config) {
    const cfg = config || CONFIG;
    if (state.totalEarned.lt(cfg.prestigeReq)) return D(0);
    return state.totalEarned.div(cfg.prestigeDivisor).pow(cfg.prestigeExponent).floor();
  }

  function canPrestige(state, config) {
    return prestigeGain(state, config).gt(0);
  }

  /* ---------- Mutating actions (shared by game + sim) ----------
   * These mutate `state` in place and return true on success so both the UI
   * and the simulator get identical outcomes. Derived values must be
   * recompute()'d by the caller afterwards. */

  function addEnergy(state, amount) {
    state.energy = state.energy.add(amount);
    state.totalEarned = state.totalEarned.add(amount);
  }

  function tapGainFor(derived) {
    let gain = derived.tapGain;
    if (derived.tapRateSeconds > 0) {
      gain = gain.add(derived.perSec.mul(derived.tapRateSeconds));
    }
    return gain;
  }

  function buyGenerator(state, id) {
    const g = genDef(id);
    const owned = state.generators[id];
    const cost = genCost(g, owned);
    if (state.energy.lt(cost)) return false;
    state.energy = state.energy.sub(cost);
    state.generators[id] = owned + 1;
    return true;
  }

  function buyUpgrade(state, id) {
    const u = upgradeDef(id);
    if (state.upgrades[id]) return false;
    const cost = D(u.cost);
    if (state.energy.lt(cost)) return false;
    state.energy = state.energy.sub(cost);
    state.upgrades[id] = true;
    return true;
  }

  // Collapse: bank cores and reset the run. Returns the cores gained.
  function prestige(state, config) {
    const gain = prestigeGain(state, config);
    if (gain.lte(0)) return D(0);
    const keptCores = state.cores.add(gain);
    const fresh = freshState();
    fresh.cores = keptCores;
    // Mutate in place so references held by the caller stay valid.
    Object.assign(state, fresh);
    return gain;
  }

  // Advance the economy by `seconds` of production (continuous accrual).
  function advanceTime(state, derived, seconds) {
    if (seconds > 0 && derived.perSec.gt(0)) {
      addEnergy(state, derived.perSec.mul(seconds));
    }
  }

  return {
    Decimal,
    D,
    GENERATORS,
    UPGRADES,
    CONFIG,
    SUFFIXES,
    freshState,
    cloneState,
    fmt,
    genDef,
    upgradeDef,
    genCost,
    genCostBulk,
    recompute,
    prestigeGain,
    canPrestige,
    addEnergy,
    tapGainFor,
    buyGenerator,
    buyUpgrade,
    prestige,
    advanceTime,
  };
});
