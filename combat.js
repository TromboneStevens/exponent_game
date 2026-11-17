/* Quantum Forge — Stage-1 combat economy (shared source of truth).
 *
 * The autobattler core (DESIGN.md §5.1.1): you auto-attack enemies, they drop
 * gold on death, and you spend gold on 5 upgrade tracks. This is a DIFFERENT
 * economy from the prestige/idle module in economy.js — it models the moment-to-
 * moment combat loop. Pure functions only (no DOM, no timers), so the browser
 * game and the headless combat simulator (sim/combat.js) share it.
 *
 * Effective DPS (expected value, crits folded in):
 *   critFactor = 1 + critChance * (critMult - 1)
 *   dps        = attackDamage * effectiveAttackSpeed * critFactor
 *
 * UMD export: window.Combat in the browser, module.exports under Node.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    const Decimal = require("break_infinity.js");
    module.exports = factory(Decimal);
  } else {
    root.Combat = factory(root.Decimal);
  }
})(typeof self !== "undefined" ? self : this, function (Decimal) {
  "use strict";

  const D = (x) => (x instanceof Decimal ? x : new Decimal(x));

  /* ---------- Upgrade definitions (5 tracks, data-driven) ---------- */
  // stat: which combat stat it raises. mode: how the level maps to the stat.
  //   addPerLevel   stat = base + perLevel * level
  //   mulPerLevel   stat = base * (1 + perLevel)^level     (compounding %)
  // cost(level) = costBase * costMul^level.
  // `unbounded: true` marks additive stats that can grow forever (must be
  // Decimal). Cost multipliers are deliberately steep so upgrade spend keeps
  // pace with exponential enemy HP and Stage 1 lasts a sane while, not minutes.
  const UPGRADES = [
    { id: "atk",      name: "Attack Damage", stat: "attackDamage", mode: "addPerLevel", base: 1,   perLevel: 1,    unbounded: true, costBase: "10", costMul: 1.15 },
    { id: "spd",      name: "Attack Speed",  stat: "attackSpeed",  mode: "addPerLevel", base: 1.0, perLevel: 0.1,  costBase: "50", costMul: 1.5,  softCap: 5.0 },
    { id: "gold",     name: "Gold Drop",     stat: "goldMult",     mode: "mulPerLevel", base: 1,   perLevel: 0.08, costBase: "30", costMul: 1.25 },
    { id: "critchance", name: "Crit Chance", stat: "critChance",   mode: "addPerLevel", base: 0,   perLevel: 0.01, costBase: "100", costMul: 1.4, cap: 0.60 },
    { id: "critdmg",  name: "Crit Damage",   stat: "critMult",     mode: "addPerLevel", base: 1.1, perLevel: 0.05, unbounded: true, costBase: "150", costMul: 1.35 },
  ];

  // Tunable balance constants for Stage 1. The simulator overrides these.
  const CONFIG = {
    // Enemy HP: baseHP tuned so the goblin takes ~4-5 hits at starting damage.
    baseHP: "4",
    hpGrowth: 1.12,     // HP multiplier per enemy killed (THE pacing knob).
                        // Tuned via sim: < goldGrowth keeps you climbing; the
                        // gap sets how gradually the stage walls. See DESIGN §5.1.2.
    // Gold reward per kill.
    baseGold: "4",
    goldGrowth: 1.14,   // gold multiplier per enemy killed
    // Bosses: every bossInterval kills, HP x bossHpMult, with a time limit.
    bossInterval: 10,
    bossHpMult: 8,
    bossTimeLimit: 30,  // seconds (OQ-3, timed burn)
    // Attack-speed soft cap: beyond softCap, extra speed -> damage multiplier.
    speedSoftCap: 5.0,
  };

  function upgradeDef(id) { return UPGRADES.find((u) => u.id === id); }

  /* ---------- State ---------- */

  function freshState(config) {
    return {
      gold: D(0),
      kills: 0,              // enemies killed this stage
      levels: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
      enemyHP: null,         // current enemy's remaining HP (set on spawn)
      enemyMaxHP: null,
    };
  }

  /* ---------- Stat + DPS computation ----------
   * Stats that can grow without bound (attackDamage, goldMult, critMult) are
   * returned as Decimal so they never overflow JS's 1.8e308 float ceiling — the
   * whole reason this project uses break_infinity.js. Bounded/capped stats
   * (attackSpeed, critChance) stay plain numbers. */

  // Returns a Decimal for unbounded stats, a Number for bounded ones.
  function statValue(u, level) {
    if (u.mode === "mulPerLevel") {
      // Unbounded compounding (e.g. goldMult): keep as Decimal.
      return D(u.base).mul(D(1 + u.perLevel).pow(level));
    }
    // addPerLevel
    let v = u.base + u.perLevel * level;
    if (u.cap != null) return Math.min(v, u.cap); // capped => safe as Number
    // Unbounded additive (attackDamage, critMult): Decimal to be overflow-proof.
    if (u.unbounded) return D(v);
    return v;
  }

  // Resolve all combat stats from current upgrade levels.
  function stats(state, config) {
    const cfg = config || CONFIG;
    const s = {};
    for (const u of UPGRADES) s[u.stat] = statValue(u, state.levels[u.id]);

    // Attack-speed soft cap: literal swings capped; overflow becomes a damage
    // multiplier so the stat keeps mattering without impossible animation rates.
    const cap = cfg.speedSoftCap;
    let speedDamageMult = 1;
    if (s.attackSpeed > cap) {
      speedDamageMult = s.attackSpeed / cap;
      s.effectiveAttackSpeed = cap;
    } else {
      s.effectiveAttackSpeed = s.attackSpeed;
    }
    s.speedDamageMult = speedDamageMult;
    // critFactor = 1 + critChance*(critMult-1). critMult is Decimal.
    s.critFactor = D(1).add(D(s.critMult).sub(1).mul(s.critChance));
    return s;
  }

  // Expected damage-per-second (crits as expected value). All-Decimal to stay
  // correct at arbitrarily large damage.
  function dps(state, config) {
    const s = stats(state, config);
    return D(s.attackDamage)
      .mul(s.speedDamageMult)
      .mul(s.effectiveAttackSpeed)
      .mul(s.critFactor);
  }

  /* ---------- Enemy / gold curves ---------- */

  function enemyHP(kills, config) {
    const cfg = config || CONFIG;
    return D(cfg.baseHP).mul(D(cfg.hpGrowth).pow(kills));
  }

  function isBossKill(killIndex, config) {
    const cfg = config || CONFIG;
    return (killIndex + 1) % cfg.bossInterval === 0;
  }

  // HP of the enemy at a given kill index (bosses are beefier).
  function spawnHP(killIndex, config) {
    const cfg = config || CONFIG;
    let hp = enemyHP(killIndex, config);
    if (isBossKill(killIndex, config)) hp = hp.mul(cfg.bossHpMult);
    return hp;
  }

  function goldReward(killIndex, state, config) {
    const cfg = config || CONFIG;
    const s = stats(state, config);
    return D(cfg.baseGold).mul(D(cfg.goldGrowth).pow(killIndex)).mul(s.goldMult);
  }

  /* ---------- Costs + buying ---------- */

  function upgradeCost(u, level) {
    return D(u.costBase).mul(D(u.costMul).pow(level));
  }

  function buyUpgrade(state, id, config) {
    const u = upgradeDef(id);
    // Respect hard caps: don't let players pour gold into a maxed stat.
    if (u.cap != null && statValue(u, state.levels[id]) >= u.cap) return false;
    const cost = upgradeCost(u, state.levels[id]);
    if (state.gold.lt(cost)) return false;
    state.gold = state.gold.sub(cost);
    state.levels[id] += 1;
    return true;
  }

  /* ---------- Combat step ----------
   * Deal `seconds` of damage to the current enemy; when it dies, award gold and
   * spawn the next. Returns { kills, goldGained } for this step. Non-boss model
   * (continuous grind). Boss timed-fights are handled by the simulator/UI since
   * they involve the manual-attempt gate (OQ-4). */

  function ensureEnemy(state, config) {
    if (state.enemyHP == null) {
      state.enemyMaxHP = spawnHP(state.kills, config);
      state.enemyHP = state.enemyMaxHP;
    }
  }

  function damageStep(state, seconds, config) {
    ensureEnemy(state, config);
    let dmg = dps(state, config).mul(seconds);
    let killsThisStep = 0;
    let goldGained = D(0);
    let guard = 1000000;

    while (dmg.gt(0) && guard-- > 0) {
      if (dmg.gte(state.enemyHP)) {
        // Enemy dies; carry remaining damage to the next.
        dmg = dmg.sub(state.enemyHP);
        goldGained = goldGained.add(goldReward(state.kills, state, config));
        state.kills += 1;
        killsThisStep += 1;
        state.enemyMaxHP = spawnHP(state.kills, config);
        state.enemyHP = state.enemyMaxHP;
      } else {
        state.enemyHP = state.enemyHP.sub(dmg);
        dmg = D(0);
      }
    }
    state.gold = state.gold.add(goldGained);
    return { kills: killsThisStep, goldGained };
  }

  return {
    Decimal, D, UPGRADES, CONFIG,
    upgradeDef, freshState,
    statValue, stats, dps,
    enemyHP, isBossKill, spawnHP, goldReward,
    upgradeCost, buyUpgrade,
    ensureEnemy, damageStep,
  };
});
