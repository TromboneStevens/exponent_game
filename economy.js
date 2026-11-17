/* Quantum Forge — shared economy module (single source of truth).
 *
 * Pure game-economy logic + content definitions, no DOM and no timers, so the
 * exact same code runs in the browser game (game.js) and the headless balance
 * simulator (sim/).
 *
 * DESIGN (post idle+roguelike rework):
 *   - Generation is IDLE. There is no tapping. The player only buys generators
 *     and upgrades; a free starting Qubit seeds the economy.
 *   - PRESTIGE is a continuous DEPTH axis. Levels P0, P1, P2... are thresholds
 *     along it (P_n at pDepthBase * pDepthMul^n of lifetime energy). A strong
 *     player blows through many tiers instantly, then plateaus where they grind.
 *   - A MACRO-RESET is the only hard reset of the run. On macro-reset the player
 *     banks PRESTIGE POINTS (meta-currency, scales exponentially with max depth,
 *     always paid even for partial depth), redrafts idols, and restarts at P0
 *     with permanent meta-shop bonuses intact.
 *   - IDOLS are a per-run roguelike layer: shown 3 random, pick 1, at the start
 *     of every run (cleared on macro-reset). They define the run's "build".
 *   - META-SHOP upgrades are PERMANENT (bought with Prestige Points, never reset)
 *     and form the overarching progression loop.
 *
 * Idols and meta-shop upgrades share one typed-effect system (applyModifiers),
 * so the whole balance surface is data-driven and easy to iterate.
 *
 * UMD export: window.Economy in the browser (Decimal is a global from the CDN),
 * module.exports under Node (Decimal require()'d from break_infinity.js).
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    const Decimal = require("break_infinity.js");
    module.exports = factory(Decimal);
  } else {
    root.Economy = factory(root.Decimal);
  }
})(typeof self !== "undefined" ? self : this, function (Decimal) {
  "use strict";

  const D = (x) => (x instanceof Decimal ? x : new Decimal(x));

  /* ======================================================================
   * Content definitions
   * ==================================================================== */

  // Generators: idle producers of Quantum Energy. Unit cost scales by
  // costMul^owned (classic exponential incremental curve).
  const GENERATORS = [
    { id: "qubit",     name: "Qubit",             desc: "A single oscillating quantum bit.",                 baseCost: "15",    baseProd: "0.2",   costMul: 1.12 },
    { id: "entangler", name: "Entangler Pair",    desc: "Linked qubits amplify each other.",                 baseCost: "120",   baseProd: "2",     costMul: 1.13 },
    { id: "condenser", name: "Flux Condenser",    desc: "Condenses stray energy into usable flux.",          baseCost: "1500",  baseProd: "22",    costMul: 1.14 },
    { id: "reactor",   name: "Fusion Reactor",    desc: "Sustained reaction pouring out energy.",            baseCost: "25000", baseProd: "260",   costMul: 1.15 },
    { id: "singular",  name: "Micro Singularity", desc: "Bends spacetime to harvest vacuum energy.",         baseCost: "4.2e5", baseProd: "3400",  costMul: 1.16 },
    { id: "forge",     name: "Quantum Forge",     desc: "The namesake engine. Forges energy from nothing.",  baseCost: "8e6",   baseProd: "48000", costMul: 1.17 },
  ];

  // In-run upgrades: one-time purchases bought with energy, reset each macro-reset.
  // kind: allMul (all gens ×), genMul (one gen ×).
  const UPGRADES = [
    { id: "all2",      name: "Overclock I",     desc: "All generators produce ×2.",      cost: "5000", kind: "allMul", value: 2 },
    { id: "all3",      name: "Overclock II",    desc: "All generators produce ×3 more.", cost: "2e6",  kind: "allMul", value: 3 },
    { id: "all5",      name: "Overclock III",   desc: "All generators produce ×5 more.", cost: "5e9",  kind: "allMul", value: 5 },
    { id: "qubitx5",   name: "Qubit Array",     desc: "Qubits produce ×5.",              cost: "2500", kind: "genMul", target: "qubit",   value: 5 },
    { id: "reactorx4", name: "Reactor Coolant", desc: "Fusion Reactors produce ×4.",     cost: "3e5",  kind: "genMul", target: "reactor", value: 4 },
    { id: "forgex4",   name: "Forge Resonance", desc: "Quantum Forges produce ×4.",      cost: "5e8",  kind: "genMul", target: "forge",   value: 4 },
  ];

  /* ---- Typed modifier system (shared by idols + meta-shop) ----
   * A "modifier" is { type, ... }. applyModifiers folds a list of them into a
   * Mods accumulator that recompute() and the prestige/points math consult.
   *   allMul      value            multiply all generator production
   *   genMul      target, value    multiply one generator's production
   *   costMul      value            multiply ALL generator/upgrade costs (<1 = cheaper)
   *   prodExp      value            raise total production to this power (compounding)
   *   startEnergy  value (string)   extra starting energy at run start
   *   pointsMul    value            multiply Prestige Points earned on macro-reset
   *   depthMul     value            multiply the effective depth used for points
   *   offlineMul   value            multiply offline earnings
   */

  // Idol pool (per-run roguelike picks). These are first-pass numbers meant to
  // be tuned; the aim is a few distinguishable "build" directions.
  const IDOLS = [
    { id: "idol_flat_prod",  name: "Idol of Abundance",   desc: "All generators produce ×3.",            rarity: "common", mods: [{ type: "allMul", value: 3 }] },
    { id: "idol_thrift",     name: "Idol of Thrift",      desc: "All costs ×0.6 (cheaper).",             rarity: "common", mods: [{ type: "costMul", value: 0.6 }] },
    { id: "idol_qubit",      name: "Idol of the Qubit",   desc: "Qubits produce ×25.",                   rarity: "common", mods: [{ type: "genMul", target: "qubit", value: 25 }] },
    { id: "idol_forge",      name: "Idol of the Forge",   desc: "Quantum Forges produce ×12.",           rarity: "common", mods: [{ type: "genMul", target: "forge", value: 12 }] },
    { id: "idol_kickstart",  name: "Idol of Momentum",    desc: "Start each run with a burst of energy.", rarity: "common", mods: [{ type: "startEnergy", value: "1e5" }] },
    { id: "idol_compound",   name: "Idol of Ascension",   desc: "Total production ^1.08 (compounds).",   rarity: "rare",   mods: [{ type: "prodExp", value: 1.08 }] },
    { id: "idol_greed",      name: "Idol of Greed",       desc: "Prestige Points on reset ×2.5.",        rarity: "rare",   mods: [{ type: "pointsMul", value: 2.5 }] },
    { id: "idol_depth",      name: "Idol of the Abyss",   desc: "Effective depth for points ×1.25.",     rarity: "rare",   mods: [{ type: "depthMul", value: 1.25 }] },
    { id: "idol_glass",      name: "Idol of Glass",       desc: "Production ×8 but costs ×1.5.",          rarity: "rare",   mods: [{ type: "allMul", value: 8 }, { type: "costMul", value: 1.5 }] },
    { id: "idol_patient",    name: "Idol of Patience",    desc: "Offline earnings ×4.",                  rarity: "common", mods: [{ type: "offlineMul", value: 4 }] },
  ];

  // Meta-shop: PERMANENT upgrades bought with Prestige Points. Never reset.
  // `max` levels, cost grows by costMul^level. Effect scales with level.
  const META_UPGRADES = [
    { id: "meta_prod",    name: "Eternal Flux",      desc: "+50% all production per level.",      baseCost: "10",  costMul: 3,   max: 25, effect: { type: "allMul", perLevel: 1.5, mode: "mulPow" } },
    { id: "meta_cost",    name: "Eternal Economy",   desc: "-5% all costs per level.",            baseCost: "25",  costMul: 4,   max: 12, effect: { type: "costMul", perLevel: 0.95, mode: "mulPow" } },
    { id: "meta_points",  name: "Eternal Insight",   desc: "+25% Prestige Points per level.",     baseCost: "50",  costMul: 5,   max: 20, effect: { type: "pointsMul", perLevel: 1.25, mode: "mulPow" } },
    { id: "meta_start",   name: "Eternal Seed",      desc: "x10 starting energy per level.",      baseCost: "40",  costMul: 6,   max: 15, effect: { type: "startEnergyMulPerLevel", perLevel: 10 } },
    { id: "meta_exp",     name: "Eternal Ascension", desc: "+0.01 production exponent per level.", baseCost: "500", costMul: 8,   max: 10, effect: { type: "prodExpAdd", perLevel: 0.01 } },
    { id: "meta_depth",   name: "Eternal Depth",     desc: "+5% depth for points per level.",     baseCost: "250", costMul: 6,   max: 15, effect: { type: "depthMul", perLevel: 1.05, mode: "mulPow" } },
  ];

  /* ---------- Tunable balance constants ---------- */

  const CONFIG = {
    // Starting Qubit lets idle generation begin (enough to also buy one unit of
    // the first generator is handled by startEnergy below).
    startQubits: 1,
    startEnergy: "15",        // enough to buy one Qubit immediately

    // Prestige DEPTH ladder: P_n reached at pDepthBase * pDepthMul^n lifetime energy.
    pDepthBase: "1e3",        // energy for P0 -> start of ladder
    pDepthMul: 10,            // each prestige level is 10x the previous threshold

    // Prestige Points on macro-reset: pointsCoef * pointsBase^effectiveDepth.
    pointsBase: 2,            // exponential growth per depth level
    pointsCoef: 1,            // flat coefficient
    pointsMinDepth: 0.5,      // minimum depth before any points are earned

    offlineCapSeconds: 60 * 60 * 12,
  };

  /* ======================================================================
   * State
   * ==================================================================== */

  // Run state resets on macro-reset. Meta state is persistent and passed
  // separately so the economy can read permanent bonuses.
  function freshRun(meta, config) {
    const cfg = config || CONFIG;
    const generators = Object.fromEntries(GENERATORS.map((g) => [g.id, 0]));
    generators.qubit = cfg.startQubits;

    // Starting energy = base * meta seed multiplier * idol startEnergy bonuses.
    // (Idols are applied once chosen; see applyRunStart.)
    let startEnergy = D(cfg.startEnergy);
    if (meta) {
      const mods = metaMods(meta);
      startEnergy = startEnergy.mul(mods.startEnergyMul);
    }

    return {
      energy: startEnergy,
      totalEarned: startEnergy, // depth is based on lifetime energy this run
      generators,
      upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, false])),
      idols: [],               // chosen idol ids this run
      maxDepth: 0,             // deepest continuous depth reached this run
    };
  }

  function freshMeta() {
    return {
      points: D(0),            // Prestige Points (meta-currency)
      metaLevels: Object.fromEntries(META_UPGRADES.map((m) => [m.id, 0])),
      macroResets: 0,
      lifetimePoints: D(0),
    };
  }

  function cloneRun(s) {
    return {
      energy: s.energy,
      totalEarned: s.totalEarned,
      generators: Object.assign({}, s.generators),
      upgrades: Object.assign({}, s.upgrades),
      idols: s.idols.slice(),
      maxDepth: s.maxDepth,
    };
  }

  /* ======================================================================
   * Modifier accumulation
   * ==================================================================== */

  function emptyMods() {
    return {
      allMul: D(1),
      genMul: {},            // id -> Decimal
      costMul: D(1),
      prodExp: 1,            // number (exponent)
      startEnergyMul: D(1),
      pointsMul: D(1),
      depthMul: 1,           // number
      offlineMul: D(1),
    };
  }

  // Fold a flat list of {type,...} modifiers (idols) into an accumulator.
  function applyModifiers(mods, list) {
    for (const m of list) {
      switch (m.type) {
        case "allMul":      mods.allMul = mods.allMul.mul(m.value); break;
        case "genMul":      mods.genMul[m.target] = (mods.genMul[m.target] || D(1)).mul(m.value); break;
        case "costMul":     mods.costMul = mods.costMul.mul(m.value); break;
        case "prodExp":     mods.prodExp *= Number(m.value); break;
        case "startEnergy": mods._flatStart = (mods._flatStart || D(0)).add(m.value); break;
        case "pointsMul":   mods.pointsMul = mods.pointsMul.mul(m.value); break;
        case "depthMul":    mods.depthMul *= Number(m.value); break;
        case "offlineMul":  mods.offlineMul = mods.offlineMul.mul(m.value); break;
        default: break;
      }
    }
    return mods;
  }

  // Meta-shop levels -> modifier accumulator (permanent bonuses).
  function metaMods(meta) {
    const mods = emptyMods();
    if (!meta) return mods;
    for (const m of META_UPGRADES) {
      const lvl = meta.metaLevels[m.id] || 0;
      if (lvl <= 0) continue;
      const e = m.effect;
      switch (e.type) {
        case "allMul":    mods.allMul = mods.allMul.mul(D(e.perLevel).pow(lvl)); break;
        case "costMul":   mods.costMul = mods.costMul.mul(D(e.perLevel).pow(lvl)); break;
        case "pointsMul": mods.pointsMul = mods.pointsMul.mul(D(e.perLevel).pow(lvl)); break;
        case "depthMul":  mods.depthMul *= Math.pow(e.perLevel, lvl); break;
        case "prodExpAdd": mods.prodExp += e.perLevel * lvl; break;
        case "startEnergyMulPerLevel": mods.startEnergyMul = mods.startEnergyMul.mul(D(e.perLevel).pow(lvl)); break;
        default: break;
      }
    }
    return mods;
  }

  // Idol ids -> modifier accumulator (per-run bonuses).
  function idolMods(idolIds) {
    const mods = emptyMods();
    const list = [];
    for (const id of idolIds || []) {
      const def = idolDef(id);
      if (def) list.push(...def.mods);
    }
    applyModifiers(mods, list);
    return mods;
  }

  // Combine meta + idol modifiers into the effective set for a run.
  function combinedMods(run, meta) {
    const a = metaMods(meta);
    const b = idolMods(run.idols);
    return {
      allMul: a.allMul.mul(b.allMul),
      genMul: mergeGenMul(a.genMul, b.genMul),
      costMul: a.costMul.mul(b.costMul),
      prodExp: a.prodExp * b.prodExp,
      startEnergyMul: a.startEnergyMul.mul(b.startEnergyMul),
      pointsMul: a.pointsMul.mul(b.pointsMul),
      depthMul: a.depthMul * b.depthMul,
      offlineMul: a.offlineMul.mul(b.offlineMul),
      _flatStart: b._flatStart || D(0),
    };
  }

  function mergeGenMul(a, b) {
    const out = {};
    for (const k of Object.keys(a)) out[k] = a[k];
    for (const k of Object.keys(b)) out[k] = (out[k] || D(1)).mul(b[k]);
    return out;
  }

  /* ======================================================================
   * Number formatting
   * ==================================================================== */

  const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

  function fmt(dec) {
    const n = D(dec);
    if (n.lt(1000)) {
      const num = n.toNumber();
      if (num !== 0 && num < 10 && !Number.isInteger(num)) return num.toFixed(1);
      return Math.floor(num).toString();
    }
    const exp = n.log10();
    const tier = Math.floor(exp / 3);
    if (tier < SUFFIXES.length) {
      const mantissa = n.div(D(10).pow(tier * 3)).toNumber();
      return mantissa.toFixed(2) + SUFFIXES[tier];
    }
    return n.toExponential(2).replace("e+", "e");
  }

  /* ======================================================================
   * Cost curves (now modifier-aware)
   * ==================================================================== */

  function genDef(id) { return GENERATORS.find((g) => g.id === id); }
  function upgradeDef(id) { return UPGRADES.find((u) => u.id === id); }
  function idolDef(id) { return IDOLS.find((i) => i.id === id); }
  function metaDef(id) { return META_UPGRADES.find((m) => m.id === id); }

  // Next-unit generator cost, scaled by the combined cost modifier.
  function genCost(g, owned, mods) {
    let c = D(g.baseCost).mul(D(g.costMul).pow(owned));
    if (mods) c = c.mul(mods.costMul);
    return c;
  }

  function upgradeCost(u, mods) {
    let c = D(u.cost);
    if (mods) c = c.mul(mods.costMul);
    return c;
  }

  // Cost of `count` units from `owned` (geometric series), cost-modifier aware.
  function genCostBulk(g, owned, count, mods) {
    const r = D(g.costMul);
    const first = D(g.baseCost).mul(r.pow(owned));
    let sum = first.mul(r.pow(count).sub(1)).div(r.sub(1));
    if (mods) sum = sum.mul(mods.costMul);
    return sum;
  }

  // Meta-shop upgrade cost at its current level.
  function metaCost(m, level) {
    return D(m.baseCost).mul(D(m.costMul).pow(level));
  }

  /* ======================================================================
   * Production / derived values
   * ==================================================================== */

  function recompute(run, meta, config) {
    const mods = combinedMods(run, meta);

    // In-run upgrade effects (energy-bought, reset each run).
    let upAllMul = D(1);
    const upGenMul = {};
    for (const u of UPGRADES) {
      if (!run.upgrades[u.id]) continue;
      if (u.kind === "allMul") upAllMul = upAllMul.mul(u.value);
      else if (u.kind === "genMul") upGenMul[u.target] = (upGenMul[u.target] || D(1)).mul(u.value);
    }

    const allMul = mods.allMul.mul(upAllMul);
    const genProd = {};
    let perSec = D(0);
    for (const g of GENERATORS) {
      const owned = run.generators[g.id];
      let per = D(g.baseProd).mul(allMul);
      if (mods.genMul[g.id]) per = per.mul(mods.genMul[g.id]);
      if (upGenMul[g.id]) per = per.mul(upGenMul[g.id]);
      genProd[g.id] = per;
      perSec = perSec.add(per.mul(owned));
    }

    // Production exponent (compounding idol/meta effect). Applied to the total.
    if (mods.prodExp !== 1 && perSec.gt(1)) {
      perSec = perSec.pow(mods.prodExp);
    }

    return { perSec, genProd, mods };
  }

  /* ======================================================================
   * Prestige depth + Prestige Points
   * ==================================================================== */

  // Continuous depth from lifetime energy. Returns a float: integer part is the
  // highest P-level reached, fractional part is progress toward the next.
  // depth = log(totalEarned / pDepthBase) / log(pDepthMul), clamped at >= 0.
  function depthFromEnergy(totalEarned, config) {
    const cfg = config || CONFIG;
    const t = D(totalEarned);
    const base = D(cfg.pDepthBase);
    // Depth 0 until the P0 threshold (pDepthBase) is reached; then it grows
    // continuously as log_{pDepthMul}(totalEarned / pDepthBase).
    if (t.lte(base)) return 0;
    const d = t.div(base).log10() / Math.log10(cfg.pDepthMul);
    return Math.max(0, d);
  }

  // Integer prestige level (P0, P1, ...) currently reached.
  function prestigeLevel(run, config) {
    return Math.floor(depthFromEnergy(run.totalEarned, config));
  }

  // Energy threshold to reach a given integer P-level.
  function levelThreshold(level, config) {
    const cfg = config || CONFIG;
    return D(cfg.pDepthBase).mul(D(cfg.pDepthMul).pow(level));
  }

  // Prestige Points earned if the player macro-resets NOW. Continuous in depth,
  // exponential in depth, scaled by points/depth modifiers. Always pays once
  // past pointsMinDepth, even for partial-level progress.
  function pointsOnReset(run, meta, config) {
    const cfg = config || CONFIG;
    const mods = combinedMods(run, meta);
    const rawDepth = Math.max(depthFromEnergy(run.totalEarned, config), run.maxDepth);
    const effDepth = rawDepth * mods.depthMul;
    if (effDepth < cfg.pointsMinDepth) return D(0);
    // points = coef * base^effDepth * pointsMul
    const pts = D(cfg.pointsCoef).mul(D(cfg.pointsBase).pow(effDepth)).mul(mods.pointsMul);
    return pts.floor();
  }

  /* ======================================================================
   * Mutating actions (shared by game + sim)
   * ==================================================================== */

  function addEnergy(run, amount) {
    run.energy = run.energy.add(amount);
    run.totalEarned = run.totalEarned.add(amount);
  }

  function buyGenerator(run, meta, id) {
    const g = genDef(id);
    const mods = combinedMods(run, meta);
    const cost = genCost(g, run.generators[id], mods);
    if (run.energy.lt(cost)) return false;
    run.energy = run.energy.sub(cost);
    run.generators[id] += 1;
    return true;
  }

  function buyUpgrade(run, meta, id) {
    const u = upgradeDef(id);
    if (run.upgrades[id]) return false;
    const mods = combinedMods(run, meta);
    const cost = upgradeCost(u, mods);
    if (run.energy.lt(cost)) return false;
    run.energy = run.energy.sub(cost);
    run.upgrades[id] = true;
    return true;
  }

  // Buy one level of a permanent meta-shop upgrade with Prestige Points.
  function buyMeta(meta, id) {
    const m = metaDef(id);
    const lvl = meta.metaLevels[id] || 0;
    if (lvl >= m.max) return false;
    const cost = metaCost(m, lvl);
    if (meta.points.lt(cost)) return false;
    meta.points = meta.points.sub(cost);
    meta.metaLevels[id] = lvl + 1;
    return true;
  }

  // Advance idle production by `seconds`.
  function advanceTime(run, derived, seconds) {
    if (seconds > 0 && derived.perSec.gt(0)) {
      let gained = derived.perSec.mul(seconds);
      addEnergy(run, gained);
    }
    // Track deepest depth reached for points purposes.
    const d = depthFromEnergy(run.totalEarned);
    if (d > run.maxDepth) run.maxDepth = d;
  }

  /* ---------- Idol drafting ----------
   * Draft is 3 random idols; player picks 1. rng is an optional () => [0,1)
   * function for deterministic simulation. */

  function rollIdolChoices(count, rng) {
    const r = rng || Math.random;
    const pool = IDOLS.slice();
    const picks = [];
    const n = Math.min(count || 3, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(r() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    return picks;
  }

  function chooseIdol(run, idolId) {
    if (!idolDef(idolId)) return false;
    run.idols.push(idolId);
    return true;
  }

  // Apply any flat starting-energy idol bonus after idols are chosen (called
  // once at run start, after the draft pick).
  function applyIdolStartBonuses(run, meta) {
    const mods = combinedMods(run, meta);
    if (mods._flatStart && mods._flatStart.gt(0)) {
      addEnergy(run, mods._flatStart);
    }
  }

  /* ---------- Macro-reset ----------
   * Bank points, bump counters, and start a fresh run (at P0). Idols are NOT
   * carried over — the caller runs a new draft. Returns points gained. */

  function macroReset(run, meta, config) {
    const gained = pointsOnReset(run, meta, config);
    meta.points = meta.points.add(gained);
    meta.lifetimePoints = meta.lifetimePoints.add(gained);
    meta.macroResets += 1;
    const next = freshRun(meta, config);
    Object.assign(run, next);
    return gained;
  }

  return {
    Decimal, D,
    GENERATORS, UPGRADES, IDOLS, META_UPGRADES, CONFIG, SUFFIXES,
    // state
    freshRun, freshMeta, cloneRun,
    // modifiers
    emptyMods, applyModifiers, metaMods, idolMods, combinedMods,
    // formatting
    fmt,
    // defs + costs
    genDef, upgradeDef, idolDef, metaDef,
    genCost, upgradeCost, genCostBulk, metaCost,
    // production
    recompute,
    // prestige / depth / points
    depthFromEnergy, prestigeLevel, levelThreshold, pointsOnReset,
    // actions
    addEnergy, buyGenerator, buyUpgrade, buyMeta, advanceTime,
    // idols
    rollIdolChoices, chooseIdol, applyIdolStartBonuses,
    // macro
    macroReset,
  };
});
