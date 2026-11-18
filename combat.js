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
    { id: "spd",      name: "Attack Speed",  stat: "attackSpeed",  mode: "addPerLevel", base: 0.8, perLevel: 0.1,  costBase: "50", costMul: 1.5,  softCap: 2.5 },
    { id: "gold",     name: "Gold Drop",     stat: "goldMult",     mode: "mulPerLevel", base: 1,   perLevel: 0.08, costBase: "30", costMul: 1.25 },
    { id: "critchance", name: "Crit Chance", stat: "critChance",   mode: "addPerLevel", base: 0,   perLevel: 0.01, costBase: "100", costMul: 1.4, cap: 0.60 },
    { id: "critdmg",  name: "Crit Damage",   stat: "critMult",     mode: "addPerLevel", base: 1.1, perLevel: 0.05, unbounded: true, costBase: "150", costMul: 1.35 },
  ];

  // Tunable balance constants for Stage 1. The simulator overrides these.
  const CONFIG = {
    // Normal enemy HP: baseHP tuned so the first goblin takes ~4 hits.
    baseHP: "4",
    hpGrowth: 1.12,     // HP multiplier per normal kill (pacing knob)
    hpCapKill: 40,      // OQ-4: normal HP stops scaling past this stage-local kill

    // Gold reward per kill.
    baseGold: "4",
    goldGrowth: 1.14,   // gold multiplier per normal kill
    goldCapKill: 40,    // OQ-4: base gold stops scaling past this kill

    // Stage shape: `stageKills` normal enemies, then a boss at stage end.
    stageKills: 40,
    // Boss (OQ-3: pure DPS check, no timer). HP = capped stage-end HP × this.
    bossHpMult: 25,
    bossGoldMult: 20,   // lump gold bonus for clearing the boss
    bossRefWindow: 20,  // "reasonable" clear time (s) used for the DPS-check readout

    // Attack-speed soft cap: beyond softCap, extra speed -> damage multiplier.
    // Lowered 5.0 -> 2.5 so the hero's attack animation (8 frames) stays
    // readable rather than blurring; overflow past the cap still boosts damage.
    speedSoftCap: 2.5,
  };

  function upgradeDef(id) { return UPGRADES.find((u) => u.id === id); }

  /* ---------- State ---------- */

  function freshState(config) {
    return {
      gold: D(0),
      kills: 0,              // total normal+boss kills this run (lifetime)
      stage: 0,              // current stage number (0 = Green Meadows)
      stageKillIndex: 0,     // position within the current stage (0..stageKills = boss)
      bossesCleared: 0,      // stages fully cleared via boss
      levels: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
      enemyHP: null,         // current enemy's remaining HP (set on spawn)
      enemyMaxHP: null,
      enemyIsBoss: false,
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

  /* ---------- Enemy / gold curves ----------
   *
   * Progression model (DESIGN OQ-3/OQ-4):
   *   - A stage is a FIXED number of normal enemies (`stageKills`), then a BOSS.
   *   - Normal enemy HP and *base* gold scale per kill but CAP at `hpCapKill` /
   *     `goldCapKill` (OQ-4): past the cap, every normal enemy has identical HP
   *     and identical base gold, so grinding yields flat income — a deliberate
   *     plateau. The player can still grow gold via the gold-drop upgrade.
   *   - The BOSS is a pure DPS check (OQ-3): a large FIXED-HP wall, no timer. You
   *     can always eventually grind it down, but under-powered it takes absurdly
   *     long, so in practice you grind the capped normals for upgrades first,
   *     then attempt the boss when your DPS is high enough to kill it quickly.
   *
   * `killIndex` is the enemy's position within the current stage (0-based). */

  // Where this kill index sits: a normal enemy or the stage boss.
  function isBoss(stageKillIndex, config) {
    const cfg = config || CONFIG;
    return stageKillIndex >= cfg.stageKills;
  }

  // Normal-enemy HP at a stage-local kill index, capped per OQ-4.
  function normalHP(stageKillIndex, config) {
    const cfg = config || CONFIG;
    const effIndex = Math.min(stageKillIndex, cfg.hpCapKill);
    return D(cfg.baseHP).mul(D(cfg.hpGrowth).pow(effIndex));
  }

  // HP of whatever spawns at this stage-local kill index (normal or boss).
  function spawnHP(stageKillIndex, config) {
    const cfg = config || CONFIG;
    if (isBoss(stageKillIndex, config)) {
      // Boss HP keyed to the (capped) normal HP at stage end, times a big mult.
      return normalHP(cfg.stageKills, config).mul(cfg.bossHpMult);
    }
    return normalHP(stageKillIndex, config);
  }

  // Base gold for a kill, capped per OQ-4; multiplied by the player's goldMult.
  // Bosses pay a lump bonus (bossGoldMult × the capped base).
  function goldReward(stageKillIndex, state, config) {
    const cfg = config || CONFIG;
    const s = stats(state, config);
    const effIndex = Math.min(stageKillIndex, cfg.goldCapKill);
    let base = D(cfg.baseGold).mul(D(cfg.goldGrowth).pow(effIndex));
    if (isBoss(stageKillIndex, config)) base = base.mul(cfg.bossGoldMult);
    return base.mul(s.goldMult);
  }

  // Minimum DPS to clear the current boss "reasonably" (within refWindow secs).
  // Pure reference for the UI / balance — not a hard gate.
  function bossDpsCheck(config) {
    const cfg = config || CONFIG;
    return spawnHP(cfg.stageKills, config).div(cfg.bossRefWindow);
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
   *
   * Normal enemies auto-loop: you fight them continuously, and once you reach
   * the stage's normal count (`stageKills`) you HOLD at the final capped normal
   * (farm it for gold) instead of auto-spawning the boss. The BOSS is entered
   * only by the player choosing to attempt it (`attemptBoss`) — a pure DPS check
   * (OQ-3). Clearing the boss advances to the next stage and resets the stage
   * kill index. This matches "grind freely, then press to attempt the boss."
   */

  function ensureEnemy(state, config) {
    if (state.enemyHP == null) spawnNext(state, config);
  }

  // Spawn whatever the current stageKillIndex points at. If we're at/over
  // stageKills and NOT in a boss attempt, hold at the last capped normal.
  function spawnNext(state, config) {
    const cfg = config || CONFIG;
    if (state.enemyIsBoss) {
      state.enemyMaxHP = spawnHP(cfg.stageKills, config);
    } else {
      const idx = Math.min(state.stageKillIndex, cfg.stageKills - 1);
      state.enemyMaxHP = normalHP(idx, config);
    }
    state.enemyHP = state.enemyMaxHP;
  }

  // Player chooses to fight the boss. Only valid once normals are cleared.
  function attemptBoss(state, config) {
    const cfg = config || CONFIG;
    if (state.stageKillIndex < cfg.stageKills) return false; // not ready
    if (state.enemyIsBoss) return true; // already fighting it
    state.enemyIsBoss = true;
    spawnNext(state, config);
    return true;
  }

  // True once the player has farmed enough normals to attempt the boss.
  function bossReady(state, config) {
    const cfg = config || CONFIG;
    return state.stageKillIndex >= cfg.stageKills;
  }

  function damageStep(state, seconds, config) {
    const cfg = config || CONFIG;
    ensureEnemy(state, config);
    let dmg = dps(state, config).mul(seconds);
    let killsThisStep = 0;
    let goldGained = D(0);
    let guard = 1000000;

    while (dmg.gt(0) && guard-- > 0) {
      if (dmg.gte(state.enemyHP)) {
        dmg = dmg.sub(state.enemyHP);

        if (state.enemyIsBoss) {
          // Boss down: award its gold, clear the stage, advance.
          goldGained = goldGained.add(goldReward(cfg.stageKills, state, config));
          state.kills += 1;
          killsThisStep += 1;
          state.bossesCleared += 1;
          state.stage += 1;
          state.stageKillIndex = 0;
          state.enemyIsBoss = false;
          spawnNext(state, config);
        } else {
          // Normal down: award gold. Advance stage index until the cap, then
          // HOLD (repeat the final capped normal) pending a boss attempt.
          goldGained = goldGained.add(goldReward(state.stageKillIndex, state, config));
          state.kills += 1;
          killsThisStep += 1;
          if (state.stageKillIndex < cfg.stageKills) state.stageKillIndex += 1;
          spawnNext(state, config);
        }
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
    isBoss, normalHP, spawnHP, goldReward, bossDpsCheck,
    upgradeCost, buyUpgrade,
    ensureEnemy, spawnNext, attemptBoss, bossReady, damageStep,
  };
});
