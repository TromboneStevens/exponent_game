/* Infinity Slayer — browser UI layer (combat / autobattler).
 *
 * All combat math lives in combat.js (window.Combat); this file is the DOM,
 * timers, input and persistence glue. The loop is idle: the hero auto-attacks,
 * enemies drop gold on death, and the player spends gold on 5 upgrade tracks.
 * Normal enemies cap (flat income plateau); the boss is a pure DPS-check wall
 * entered on demand (DESIGN §5.1 OQ-3/OQ-4).
 *
 * This is the Stage-1 combat prototype. The idle/prestige economy (economy.js)
 * still exists in the repo for the simulator and as a future prestige layer,
 * but the player-facing game is now the battler.
 */

"use strict";

const C = window.Combat;
const D = C.D;
const { UPGRADES, CONFIG } = C;

const SAVE_KEY = "infinity-slayer-save-v1";
const TICK_MS = 100;
const AUTOSAVE_MS = 15000;

// Stage theming (DESIGN §5.4 ladder). Only Stage 0 is tuned; later stages reuse
// Stage-1 numbers for now (per-stage escalation is a separate task), but we show
// their names/sprites so progression reads as the world changing.
// `art: "slime"` means the enemy/boss uses the animated slime sprite; otherwise
// `sprite`/`bossSprite` emoji are placeholders until real art lands.
const STAGES = [
  { name: "Green Meadows", enemy: "Slime",    art: "slime", boss: "Giant Slime",  bossArt: "slime" },
  { name: "Forest",        enemy: "Wolf",     sprite: "🐺", boss: "Dire Wolf",     bossSprite: "🐺" },
  { name: "Icy Mountain",  enemy: "Yeti",     sprite: "🦍", boss: "Frost Titan",   bossSprite: "🧊" },
  { name: "Caverns",       enemy: "Bat",      sprite: "🦇", boss: "Cave Horror",   bossSprite: "🕷" },
  { name: "Ancient Ruins", enemy: "Wraith",   sprite: "👻", boss: "Lich",          bossSprite: "💀" },
];
function stageTheme(stage) {
  return STAGES[stage % STAGES.length];
}

/* ---------- Slime sprite (enemy) ---------- */

const SLIME_COLORS = ["green", "red", "blue"];
let currentSlimeColor = null;

// Roll a new random slime color and point the CSS vars at that color's sheets.
function rollSlimeColor() {
  currentSlimeColor = SLIME_COLORS[Math.floor(Math.random() * SLIME_COLORS.length)];
  const sprite = document.getElementById("enemySprite");
  if (!sprite) return;
  const base = `assets/enemies/slime/${currentSlimeColor}`;
  sprite.style.setProperty("--slime-idle", `url("${base}/idle.png")`);
  sprite.style.setProperty("--slime-hurt", `url("${base}/hurt.png")`);
  sprite.style.setProperty("--slime-dead", `url("${base}/dead.png")`);
}

/* ---------- State ---------- */

let state = C.freshState();
let lastTickAt = Date.now();

/* ---------- Combat loop ---------- */

function tick() {
  const now = Date.now();
  const dt = Math.min((now - lastTickAt) / 1000, 3600);
  lastTickAt = now;

  const before = { bosses: state.bossesCleared };
  C.damageStep(state, dt, CONFIG);
  if (state.bossesCleared > before.bosses) onBossCleared();

  // Drive the hero's visible swing on its ACTUAL attack cadence (not the 100ms
  // sim tick), so the animation matches the readable swing rate.
  advanceSwings(dt);

  renderDynamic();
}

/* ---------- Swing scheduler (visual) ----------
 * Fires the attack animation + a damage floater once per real swing, paced by
 * effectiveAttackSpeed. Enemy reacts (hit/death flash) on each swing. */
let swingCooldown = 0;

function advanceSwings(dt) {
  const s = C.stats(state, CONFIG);
  const rate = s.effectiveAttackSpeed; // swings/sec (already capped)
  if (rate <= 0) return;
  swingCooldown -= dt;
  let swings = 0;
  // Catch up, but cap bursts so offline/large dt don't spam the DOM.
  while (swingCooldown <= 0 && swings < 4) {
    swingCooldown += 1 / rate;
    swings++;
    const period = 1 / rate;
    playAttack(period);
    const enemyDyingSoon = state.enemyHP && state.enemyHP.lte(C.dps(state, CONFIG).div(rate));
    if (enemyDyingSoon) flashEnemyDeath(); else flashEnemyHit();
    spawnDamageFloater();
  }
}

/* ---------- Actions ---------- */

function buyUpgrade(id) {
  // Buy as many as affordable in one tap? No — single buy per tap is clearer.
  if (C.buyUpgrade(state, id, CONFIG)) {
    renderAll();
    save(false);
  }
}

function attemptBoss() {
  if (C.attemptBoss(state, CONFIG)) {
    renderAll();
    toast("Boss fight! Burn it down.");
  }
}

function onBossCleared() {
  const t = stageTheme(state.stage);
  toast(`Stage cleared! Entering ${t.name}.`);
}

/* ---------- Offline ---------- */

function applyOffline() {
  const now = Date.now();
  const away = Math.min((now - lastTickAt) / 1000, 60 * 60 * 12);
  lastTickAt = now;
  if (away > 5 && C.dps(state, CONFIG).gt(0)) {
    const res = C.damageStep(state, away, CONFIG);
    const mins = Math.floor(away / 60);
    const note = `Welcome back! Away ${mins >= 1 ? mins + "m" : Math.floor(away) + "s"} → +${C.fmt ? C.fmt(res.goldGained) : res.goldGained} gold, ${res.kills} kills.`;
    document.getElementById("offlineNote").textContent = note;
    toast(note);
  } else {
    document.getElementById("offlineNote").textContent = "";
  }
}

/* ---------- Number formatting (local; combat.js has no fmt) ---------- */

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
    return (n.div(D(10).pow(tier * 3)).toNumber()).toFixed(2) + SUFFIXES[tier];
  }
  return n.toExponential(2).replace("e+", "e");
}

/* ---------- Persistence ---------- */

function serialize() {
  return JSON.stringify({
    v: 1,
    gold: state.gold.toString(),
    kills: state.kills,
    stage: state.stage,
    stageKillIndex: state.stageKillIndex,
    bossesCleared: state.bossesCleared,
    enemyIsBoss: state.enemyIsBoss,
    levels: state.levels,
    lastTick: Date.now(),
  });
}

function save(announce) {
  try {
    localStorage.setItem(SAVE_KEY, serialize());
    if (announce) toast("Saved.");
  } catch (e) { toast("Save failed (storage blocked)."); }
}

function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try {
    const o = JSON.parse(raw);
    state = C.freshState();
    state.gold = D(o.gold || 0);
    state.kills = o.kills || 0;
    state.stage = o.stage || 0;
    state.stageKillIndex = o.stageKillIndex || 0;
    state.bossesCleared = o.bossesCleared || 0;
    state.enemyIsBoss = !!o.enemyIsBoss;
    for (const u of UPGRADES) state.levels[u.id] = o.levels?.[u.id] || 0;
    state.enemyHP = null; // respawn current enemy fresh on load
    C.ensureEnemy(state, CONFIG);
    lastTickAt = o.lastTick || Date.now();
    return true;
  } catch (e) {
    toast("Save corrupt — starting fresh.");
    state = C.freshState();
    return false;
  }
}

function exportSave() {
  const data = btoa(unescape(encodeURIComponent(serialize())));
  navigator.clipboard?.writeText(data).then(
    () => toast("Save copied to clipboard."),
    () => prompt("Copy your save:", data)
  );
}

function importSave() {
  const data = prompt("Paste your save string:");
  if (!data) return;
  try {
    localStorage.setItem(SAVE_KEY, decodeURIComponent(escape(atob(data.trim()))));
    load();
    renderAll();
    toast("Save imported.");
  } catch (e) { toast("Invalid save string."); }
}

function hardReset() {
  if (!confirm("Erase all progress? This cannot be undone.")) return;
  localStorage.removeItem(SAVE_KEY);
  state = C.freshState();
  lastTickAt = Date.now();
  renderAll();
  toast("Progress reset.");
}

/* ---------- Rendering ---------- */

function buildUpgradeList() {
  const el = document.getElementById("upgradeList");
  el.innerHTML = "";
  for (const u of UPGRADES) {
    const row = document.createElement("div");
    row.className = "upg";
    row.id = "upg-" + u.id;
    row.innerHTML = `
      <div>
        <div class="upg-name">${u.name} <span class="lvl" id="lvl-${u.id}"></span></div>
        <div class="upg-stat" id="stat-${u.id}"></div>
      </div>
      <button class="buy-btn" id="buy-${u.id}"></button>
    `;
    el.appendChild(row);
    row.querySelector(`#buy-${u.id}`).addEventListener("click", () => buyUpgrade(u.id));
  }
}

// Human-readable current value of an upgrade's stat.
function statReadout(u, s) {
  switch (u.stat) {
    case "attackDamage": return `${fmt(s.attackDamage)} dmg`;
    case "attackSpeed": return `${s.attackSpeed.toFixed(2)}/s${s.speedDamageMult > 1 ? ` (×${s.speedDamageMult.toFixed(1)} dmg)` : ""}`;
    case "goldMult": return `×${fmt(s.goldMult)} gold`;
    case "critChance": return `${(s.critChance * 100).toFixed(0)}% chance`;
    case "critMult": return `×${D(s.critMult).toNumber().toFixed(2)} crit dmg`;
    default: return "";
  }
}

function renderDynamic() {
  const s = C.stats(state, CONFIG);
  document.getElementById("goldValue").textContent = fmt(state.gold);
  document.getElementById("dpsValue").textContent = fmt(C.dps(state, CONFIG));

  // Stage + enemy.
  const theme = stageTheme(state.stage);
  document.getElementById("stageName").textContent = theme.name;
  const ready = C.bossReady(state, CONFIG);
  document.getElementById("stageKills").textContent =
    state.enemyIsBoss ? "BOSS" : `${Math.min(state.stageKillIndex, CONFIG.stageKills)} / ${CONFIG.stageKills}`;

  const enemyEl = document.getElementById("enemy");
  const stageEl = document.getElementById("stage");
  const sprite = document.getElementById("enemySprite");
  const isBoss = state.enemyIsBoss;
  const useSlime = isBoss ? theme.bossArt === "slime" : theme.art === "slime";

  document.getElementById("enemyName").textContent = isBoss ? theme.boss : theme.enemy;
  enemyEl.classList.toggle("boss", isBoss);
  stageEl.classList.toggle("boss-fight", isBoss);

  if (useSlime) {
    // Animated slime sprite: clear any emoji, ensure a color is assigned.
    sprite.classList.add("is-sprite");
    sprite.textContent = "";
    if (!currentSlimeColor) rollSlimeColor();
  } else {
    // Emoji placeholder for stages without real art yet.
    sprite.classList.remove("is-sprite");
    sprite.style.removeProperty("--slime-idle");
    sprite.textContent = isBoss ? theme.bossSprite : theme.sprite;
  }

  // HP bar.
  const hp = state.enemyHP || D(0);
  const maxHp = state.enemyMaxHP || D(1);
  const pct = Math.max(0, Math.min(100, hp.div(maxHp).toNumber() * 100));
  document.getElementById("hpFill").style.width = pct + "%";
  document.getElementById("hpText").textContent = `${fmt(hp)} / ${fmt(maxHp)}`;

  // Boss button + hint.
  const bossBtn = document.getElementById("bossBtn");
  const bossHint = document.getElementById("bossHint");
  if (ready && !state.enemyIsBoss) {
    bossBtn.classList.remove("hidden");
    const check = C.bossDpsCheck(CONFIG);
    const myDps = C.dps(state, CONFIG);
    if (myDps.gte(check)) {
      bossHint.textContent = `Your DPS clears the boss (~${fmt(check)} needed).`;
      bossHint.classList.remove("warn");
    } else {
      bossHint.textContent = `Boss needs ~${fmt(check)} DPS — you have ${fmt(myDps)}. Grind more!`;
      bossHint.classList.add("warn");
    }
  } else if (state.enemyIsBoss) {
    bossBtn.classList.add("hidden");
    bossHint.textContent = "Boss fight in progress — pure DPS race.";
    bossHint.classList.remove("warn");
  } else {
    bossBtn.classList.add("hidden");
    bossHint.textContent = "";
  }

  // Upgrades.
  for (const u of UPGRADES) {
    document.getElementById("lvl-" + u.id).textContent = `Lv ${state.levels[u.id]}`;
    document.getElementById("stat-" + u.id).textContent = statReadout(u, s);
    const btn = document.getElementById("buy-" + u.id);
    const capped = u.cap != null && C.statValue(u, state.levels[u.id]) >= u.cap;
    if (capped) {
      btn.textContent = "MAX";
      btn.classList.add("maxed");
      btn.disabled = true;
    } else {
      const cost = C.upgradeCost(u, state.levels[u.id]);
      btn.classList.remove("maxed");
      btn.innerHTML = `Level Up<small>🪙 ${fmt(cost)}</small>`;
      btn.disabled = state.gold.lt(cost);
    }
  }
}

function renderAll() { renderDynamic(); }

/* ---------- Visual feedback ---------- */

// Play the swordsman's attack animation once, timed to the swing period so it
// finishes before the next swing (clamped so it never looks frantic or sluggish).
function playAttack(periodSeconds) {
  const sprite = document.getElementById("heroSprite");
  if (!sprite) return;
  const dur = Math.max(0.22, Math.min(periodSeconds * 0.9, 1.0));
  sprite.style.setProperty("--atk-dur", dur.toFixed(2) + "s");
  sprite.classList.remove("attacking");
  void sprite.offsetWidth; // restart the animation
  sprite.classList.add("attacking");
}

// When a one-shot animation ends, return the sprite to its idle loop.
function bindSpriteAnimations() {
  const hero = document.getElementById("heroSprite");
  if (hero) hero.addEventListener("animationend", (e) => {
    if (e.animationName === "hero-attack") hero.classList.remove("attacking");
  });
  const enemy = document.getElementById("enemySprite");
  if (enemy) enemy.addEventListener("animationend", (e) => {
    // Hurt returns to idle; Dead is cleared by flashEnemyDeath's timeout.
    if (e.animationName === "slime-hurt") enemy.classList.remove("hurt");
  });
}

// Play the slime's Hurt animation once (sprite enemies only). For emoji
// placeholders, a quick shake via inline transform.
function flashEnemyHit() {
  const sprite = document.getElementById("enemySprite");
  if (!sprite) return;
  if (sprite.classList.contains("is-sprite")) {
    if (sprite.classList.contains("dead")) return; // don't interrupt a death
    sprite.classList.remove("hurt");
    void sprite.offsetWidth;
    sprite.classList.add("hurt");
  } else {
    sprite.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
      { duration: 120 }
    );
  }
}

// Play the slime's Dead animation, then roll a fresh random color for the next
// slime so each spawn can be a different color.
function flashEnemyDeath() {
  const sprite = document.getElementById("enemySprite");
  if (!sprite) return;
  if (sprite.classList.contains("is-sprite")) {
    sprite.classList.remove("hurt");
    sprite.classList.add("dead");
    setTimeout(() => {
      sprite.classList.remove("dead");
      rollSlimeColor(); // next slime is a new random color
    }, 250);
  }
}

function spawnDamageFloater() {
  const box = document.getElementById("floaters");
  const f = document.createElement("div");
  const s = C.stats(state, CONFIG);
  // Show a representative hit (expected per-swing damage).
  const perHit = D(s.attackDamage).mul(s.speedDamageMult).mul(s.critFactor);
  const isCrit = s.critChance > 0 && Math.random() < s.critChance;
  f.className = "floater" + (isCrit ? " crit" : "");
  const shown = isCrit ? perHit.mul(D(s.critMult).div(s.critFactor)) : perHit;
  f.textContent = (isCrit ? "✸ " : "") + fmt(shown);
  f.style.left = (45 + Math.random() * 10) + "%";
  box.appendChild(f);
  setTimeout(() => f.remove(), 700);
}

/* ---------- UI helpers ---------- */

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

/* ---------- Wiring ---------- */

function bindUI() {
  document.getElementById("bossBtn").addEventListener("click", attemptBoss);

  const sheet = document.getElementById("sheet");
  document.getElementById("menuBtn").addEventListener("click", () => sheet.classList.remove("hidden"));
  document.getElementById("closeSheet").addEventListener("click", () => sheet.classList.add("hidden"));
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.classList.add("hidden"); });

  document.getElementById("saveBtn").addEventListener("click", () => save(true));
  document.getElementById("exportBtn").addEventListener("click", exportSave);
  document.getElementById("importBtn").addEventListener("click", importSave);
  document.getElementById("hardResetBtn").addEventListener("click", hardReset);

  document.addEventListener("visibilitychange", () => { if (document.hidden) save(false); });
  window.addEventListener("pagehide", () => save(false));
}

/* ---------- Boot ---------- */

function init() {
  if (typeof Decimal === "undefined" || !window.Combat) {
    document.body.innerHTML =
      '<p style="color:#fff;font-family:sans-serif;padding:24px">Failed to load break_infinity.js (check your network connection).</p>';
    return;
  }
  load();
  C.ensureEnemy(state, CONFIG);
  buildUpgradeList();
  bindSpriteAnimations();
  rollSlimeColor();       // assign the first slime a random color
  applyOffline();
  renderAll();
  bindUI();

  setInterval(tick, TICK_MS);
  setInterval(() => save(false), AUTOSAVE_MS);
}

window.addEventListener("DOMContentLoaded", init);
