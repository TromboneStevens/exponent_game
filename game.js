/* Quantum Forge — browser UI layer.
 *
 * All game-economy logic lives in economy.js (window.Economy); this file is the
 * DOM, timers, input and persistence glue. The game is IDLE: no tapping. The
 * player buys generators/upgrades (energy), drafts one idol per run (pick 1 of
 * 3), macro-resets to bank Prestige Points, and spends those on a permanent
 * meta-shop.
 */

"use strict";

const E = window.Economy;
const D = E.D;
const { GENERATORS, UPGRADES, META_UPGRADES, CONFIG } = E;

const SAVE_KEY = "quantum-forge-save-v2";
const TICK_MS = 100;
const AUTOSAVE_MS = 15000;

/* ---------- State: run (resets) + meta (permanent) ---------- */

let meta = E.freshMeta();
let run = E.freshRun(meta);
let derived = E.recompute(run, meta);
let pendingDraft = null; // idol choices awaiting a pick, or null
let lastTickAt = Date.now();

function recompute() { derived = E.recompute(run, meta); }

/* ---------- Idol draft ---------- */

function openDraft() {
  pendingDraft = E.rollIdolChoices(3);
  const box = document.getElementById("draftChoices");
  box.innerHTML = "";
  for (const idol of pendingDraft) {
    const btn = document.createElement("button");
    btn.className = "idol-choice" + (idol.rarity === "rare" ? " rare" : "");
    btn.innerHTML = `
      <div class="ic-name">${idol.name} <span class="ic-rarity">${idol.rarity}</span></div>
      <div class="ic-desc">${idol.desc}</div>
    `;
    btn.addEventListener("click", () => pickIdol(idol.id));
    box.appendChild(btn);
  }
  document.getElementById("draft").classList.remove("hidden");
}

function pickIdol(id) {
  E.chooseIdol(run, id);
  E.applyIdolStartBonuses(run, meta);
  pendingDraft = null;
  document.getElementById("draft").classList.add("hidden");
  recompute();
  renderAll();
  toast(`Idol chosen: ${E.idolDef(id).name}`);
  save(false);
}

/* ---------- Actions ---------- */

function buyGenerator(id) {
  if (E.buyGenerator(run, meta, id)) { recompute(); renderAll(); }
}

function buyUpgrade(id) {
  if (E.buyUpgrade(run, meta, id)) {
    recompute(); renderAll();
    toast(`Purchased: ${E.upgradeDef(id).name}`);
  }
}

function buyMeta(id) {
  if (E.buyMeta(meta, id)) {
    recompute(); renderAll();
    toast(`Upgraded: ${E.metaDef(id).name}`);
    save(false);
  }
}

function doMacroReset() {
  const gain = E.pointsOnReset(run, meta);
  if (gain.lte(0)) return;
  if (!confirm(`Macro-Reset for ${E.fmt(gain)} Prestige Points?\n\nThis resets your run (energy, generators, upgrades, idols) back to P0. Prestige Points and meta-shop upgrades are permanent. You'll draft a new idol.`)) {
    return;
  }
  E.macroReset(run, meta);
  recompute();
  renderAll();
  toast(`Macro-Reset! +${E.fmt(gain)} ◈`);
  save(false);
  openDraft(); // immediately draft a new idol for the fresh run
}

/* ---------- Idle loop ---------- */

function tick() {
  if (pendingDraft) { lastTickAt = Date.now(); return; } // pause while drafting
  const now = Date.now();
  const dt = Math.min((now - lastTickAt) / 1000, 3600);
  lastTickAt = now;
  const prevLevel = E.prestigeLevel(run);
  E.advanceTime(run, derived, dt);
  const newLevel = E.prestigeLevel(run);
  renderDynamic();
  if (newLevel > prevLevel) {
    // A tier was crossed this tick; refresh the macro button eligibility.
    renderDynamic();
  }
}

function applyOffline() {
  const now = Date.now();
  const away = Math.min((now - lastTickAt) / 1000, CONFIG.offlineCapSeconds);
  lastTickAt = now;
  if (away > 5 && derived.perSec.gt(0)) {
    const gained = derived.perSec.mul(away).mul(derived.mods.offlineMul);
    E.addEnergy(run, gained);
    const mins = Math.floor(away / 60);
    const note = `Welcome back! Away ${mins >= 1 ? mins + "m" : Math.floor(away) + "s"} → +${E.fmt(gained)} energy.`;
    document.getElementById("offlineNote").textContent = note;
    toast(note);
  } else {
    document.getElementById("offlineNote").textContent = "";
  }
}

/* ---------- Persistence ---------- */

function serialize() {
  return JSON.stringify({
    v: 2,
    run: {
      energy: run.energy.toString(),
      totalEarned: run.totalEarned.toString(),
      generators: run.generators,
      upgrades: run.upgrades,
      idols: run.idols,
      maxDepth: run.maxDepth,
    },
    meta: {
      points: meta.points.toString(),
      metaLevels: meta.metaLevels,
      macroResets: meta.macroResets,
      lifetimePoints: meta.lifetimePoints.toString(),
    },
    hasDrafted: run.idols.length > 0,
    lastTick: Date.now(),
  });
}

function save(announce) {
  try {
    localStorage.setItem(SAVE_KEY, serialize());
    if (announce) toast("Saved.");
  } catch (e) {
    toast("Save failed (storage blocked).");
  }
}

function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try {
    const o = JSON.parse(raw);
    meta = E.freshMeta();
    meta.points = D(o.meta?.points || 0);
    meta.macroResets = o.meta?.macroResets || 0;
    meta.lifetimePoints = D(o.meta?.lifetimePoints || 0);
    for (const m of META_UPGRADES) meta.metaLevels[m.id] = o.meta?.metaLevels?.[m.id] || 0;

    run = E.freshRun(meta);
    if (o.run) {
      run.energy = D(o.run.energy || 0);
      run.totalEarned = D(o.run.totalEarned || run.energy);
      for (const g of GENERATORS) run.generators[g.id] = o.run.generators?.[g.id] || 0;
      for (const u of UPGRADES) run.upgrades[u.id] = !!o.run.upgrades?.[u.id];
      run.idols = Array.isArray(o.run.idols) ? o.run.idols.filter((id) => E.idolDef(id)) : [];
      run.maxDepth = o.run.maxDepth || 0;
    }
    lastTickAt = o.lastTick || Date.now();
    return true;
  } catch (e) {
    toast("Save corrupt — starting fresh.");
    meta = E.freshMeta();
    run = E.freshRun(meta);
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
    const json = decodeURIComponent(escape(atob(data.trim())));
    localStorage.setItem(SAVE_KEY, json);
    load();
    recompute();
    renderAll();
    toast("Save imported.");
    if (run.idols.length === 0) openDraft();
  } catch (e) {
    toast("Invalid save string.");
  }
}

function hardReset() {
  if (!confirm("Erase EVERYTHING — including permanent Prestige Points and meta-shop upgrades? This cannot be undone.")) return;
  localStorage.removeItem(SAVE_KEY);
  meta = E.freshMeta();
  run = E.freshRun(meta);
  recompute();
  renderAll();
  toast("Progress reset.");
  openDraft();
}

/* ---------- Rendering: static lists ---------- */

function buildLists() {
  const genEl = document.getElementById("tab-generators");
  genEl.innerHTML = "";
  for (const g of GENERATORS) {
    const el = document.createElement("div");
    el.className = "item";
    el.id = "gen-" + g.id;
    el.innerHTML = `
      <div>
        <div class="item-name">${g.name} <span class="item-owned" id="owned-${g.id}"></span></div>
        <div class="item-desc">${g.desc}</div>
        <div class="item-meta" id="meta-${g.id}"></div>
      </div>
      <button class="buy-btn" id="buy-${g.id}">Buy</button>
    `;
    genEl.appendChild(el);
    el.querySelector(`#buy-${g.id}`).addEventListener("click", () => buyGenerator(g.id));
  }

  const upEl = document.getElementById("tab-upgrades");
  upEl.innerHTML = "";
  for (const u of UPGRADES) {
    const el = document.createElement("div");
    el.className = "item";
    el.id = "up-" + u.id;
    el.innerHTML = `
      <div>
        <div class="item-name">${u.name}</div>
        <div class="item-desc">${u.desc}</div>
      </div>
      <button class="buy-btn" id="buyup-${u.id}"></button>
    `;
    upEl.appendChild(el);
    el.querySelector(`#buyup-${u.id}`).addEventListener("click", () => buyUpgrade(u.id));
  }

  const metaEl = document.getElementById("tab-meta");
  metaEl.innerHTML = "";
  for (const m of META_UPGRADES) {
    const el = document.createElement("div");
    el.className = "item";
    el.id = "metaitem-" + m.id;
    el.innerHTML = `
      <div>
        <div class="item-name">${m.name}</div>
        <div class="item-desc">${m.desc}</div>
        <div class="item-level" id="metalvl-${m.id}"></div>
      </div>
      <button class="buy-btn" id="buymeta-${m.id}"></button>
    `;
    metaEl.appendChild(el);
    el.querySelector(`#buymeta-${m.id}`).addEventListener("click", () => buyMeta(m.id));
  }
}

/* ---------- Rendering: dynamic values ---------- */

function renderIdolStrip() {
  const strip = document.getElementById("idolStrip");
  strip.innerHTML = "";
  for (const id of run.idols) {
    const def = E.idolDef(id);
    if (!def) continue;
    const tag = document.createElement("span");
    tag.className = "idol-tag" + (def.rarity === "rare" ? " rare" : "");
    tag.textContent = def.name;
    tag.title = def.desc;
    strip.appendChild(tag);
  }
}

function renderDepth() {
  const depth = E.depthFromEnergy(run.totalEarned);
  const level = Math.floor(depth);
  const frac = depth - level;
  document.getElementById("depthLevel").textContent = "P" + level;
  document.getElementById("depthFill").style.width = (frac * 100).toFixed(1) + "%";
  const nextThreshold = E.levelThreshold(level + 1);
  document.getElementById("depthNext").textContent =
    `next: ${E.fmt(nextThreshold)} (${(frac * 100).toFixed(0)}%)`;
}

function renderDynamic() {
  document.getElementById("energyValue").textContent = E.fmt(run.energy);
  document.getElementById("energyRate").textContent = E.fmt(derived.perSec) + " / sec";
  document.getElementById("pointsValue").textContent = E.fmt(meta.points);
  document.getElementById("resetCount").textContent = meta.macroResets;

  renderDepth();
  renderIdolStrip();

  const pg = E.pointsOnReset(run, meta);
  document.getElementById("pointsGain").textContent = E.fmt(pg);
  document.getElementById("macroBtn").disabled = pg.lte(0);

  for (let idx = 0; idx < GENERATORS.length; idx++) {
    const g = GENERATORS[idx];
    const owned = run.generators[g.id];
    const cost = E.genCost(g, owned, derived.mods);
    const btn = document.getElementById("buy-" + g.id);
    btn.disabled = run.energy.lt(cost);
    btn.innerHTML = `Buy<small>${E.fmt(cost)}</small>`;
    document.getElementById("owned-" + g.id).textContent = owned > 0 ? `×${owned}` : "";
    const per = derived.genProd[g.id] || D(g.baseProd);
    document.getElementById("meta-" + g.id).textContent =
      `${E.fmt(per)}/s each · total ${E.fmt(per.mul(owned))}/s`;
    const item = document.getElementById("gen-" + g.id);
    const unlocked =
      idx === 0 ||
      run.generators[GENERATORS[idx - 1].id] > 0 ||
      owned > 0 ||
      run.energy.gte(cost.div(3));
    item.classList.toggle("locked", !unlocked);
  }

  for (const u of UPGRADES) {
    const btn = document.getElementById("buyup-" + u.id);
    const cost = E.upgradeCost(u, derived.mods);
    if (run.upgrades[u.id]) {
      btn.textContent = "Owned ✓";
      btn.classList.add("bought");
      btn.disabled = true;
    } else {
      btn.classList.remove("bought");
      btn.innerHTML = `Buy<small>${E.fmt(cost)}</small>`;
      btn.disabled = run.energy.lt(cost);
    }
  }

  for (const m of META_UPGRADES) {
    const lvl = meta.metaLevels[m.id] || 0;
    document.getElementById("metalvl-" + m.id).textContent = `Level ${lvl} / ${m.max}`;
    const btn = document.getElementById("buymeta-" + m.id);
    if (lvl >= m.max) {
      btn.textContent = "MAX";
      btn.classList.add("maxed");
      btn.disabled = true;
    } else {
      const cost = E.metaCost(m, lvl);
      btn.classList.remove("maxed");
      btn.innerHTML = `Buy<small>${E.fmt(cost)} ◈</small>`;
      btn.disabled = meta.points.lt(cost);
    }
  }
}

function renderAll() {
  recompute();
  renderDynamic();
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
  document.getElementById("macroBtn").addEventListener("click", doMacroReset);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

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
  if (typeof Decimal === "undefined" || !window.Economy) {
    document.body.innerHTML =
      '<p style="color:#fff;font-family:sans-serif;padding:24px">Failed to load break_infinity.js (check your network connection).</p>';
    return;
  }
  const hadSave = load();
  buildLists();
  recompute();
  applyOffline();
  renderAll();
  bindUI();

  // New player or a fresh run with no idol yet: open the draft.
  if (run.idols.length === 0) openDraft();

  setInterval(tick, TICK_MS);
  setInterval(() => save(false), AUTOSAVE_MS);
}

window.addEventListener("DOMContentLoaded", init);
