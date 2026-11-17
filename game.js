/* Quantum Forge — browser UI layer.
 *
 * All game-economy logic lives in economy.js (window.Economy) so the UI and the
 * headless balance simulator share one source of truth. This file is only the
 * DOM, timers, input and persistence glue around that shared economy.
 */

"use strict";

const E = window.Economy;
const D = E.D;
const { GENERATORS, UPGRADES, CONFIG } = E;

const SAVE_KEY = "quantum-forge-save-v1";
const TICK_MS = 100; // simulation tick
const AUTOSAVE_MS = 15000; // autosave cadence

/* ---------- Game state ---------- */

let state = E.freshState();
state.lastTick = Date.now();
state.lastSave = Date.now();

// Derived values, recomputed whenever something changes.
let derived = E.recompute(state);

function recompute() {
  derived = E.recompute(state);
}

/* ---------- Actions ---------- */

function doTap(clientX, clientY) {
  const gain = E.tapGainFor(derived);
  E.addEnergy(state, gain);
  spawnFloater("+" + E.fmt(gain), clientX, clientY);
  renderDynamic();
}

function buyGenerator(id) {
  if (E.buyGenerator(state, id)) {
    recompute();
    renderAll();
  }
}

function buyUpgrade(id) {
  if (E.buyUpgrade(state, id)) {
    recompute();
    renderAll();
    toast(`Purchased: ${E.upgradeDef(id).name}`);
  }
}

function doPrestige() {
  const gain = E.prestigeGain(state);
  if (gain.lte(0)) return;
  if (!confirm(`Collapse the universe for ${E.fmt(gain)} Cores?\n\nThis resets energy, generators, and upgrades, but Cores boost all future production permanently.`)) {
    return;
  }
  E.prestige(state);
  recompute();
  renderAll();
  toast(`Collapsed! +${E.fmt(gain)} Cores`);
}

/* ---------- Simulation loop ---------- */

function tick() {
  const now = Date.now();
  const dt = Math.min((now - state.lastTick) / 1000, 3600); // seconds, clamp wild gaps
  state.lastTick = now;
  E.advanceTime(state, derived, dt);
  renderDynamic();
}

function applyOffline() {
  const now = Date.now();
  const away = Math.min((now - state.lastTick) / 1000, CONFIG.offlineCapSeconds);
  state.lastTick = now;
  if (away > 5 && derived.perSec.gt(0)) {
    const gained = derived.perSec.mul(away);
    E.addEnergy(state, gained);
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
    energy: state.energy.toString(),
    totalEarned: state.totalEarned.toString(),
    cores: state.cores.toString(),
    generators: state.generators,
    upgrades: state.upgrades,
    lastTick: Date.now(),
  });
}

function save(announce) {
  try {
    localStorage.setItem(SAVE_KEY, serialize());
    state.lastSave = Date.now();
    if (announce) toast("Saved.");
  } catch (e) {
    toast("Save failed (storage blocked).");
  }
}

function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    const o = JSON.parse(raw);
    const loaded = E.freshState();
    loaded.energy = D(o.energy || 0);
    loaded.totalEarned = D(o.totalEarned || 0);
    loaded.cores = D(o.cores || 0);
    for (const g of GENERATORS) loaded.generators[g.id] = o.generators?.[g.id] || 0;
    for (const u of UPGRADES) loaded.upgrades[u.id] = !!o.upgrades?.[u.id];
    loaded.lastTick = o.lastTick || Date.now();
    loaded.lastSave = Date.now();
    state = loaded;
  } catch (e) {
    toast("Save corrupt — starting fresh.");
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
  } catch (e) {
    toast("Invalid save string.");
  }
}

function hardReset() {
  if (!confirm("Erase everything and start over? This cannot be undone.")) return;
  localStorage.removeItem(SAVE_KEY);
  state = E.freshState();
  state.lastTick = Date.now();
  state.lastSave = Date.now();
  recompute();
  renderAll();
  toast("Progress reset.");
}

/* ---------- Rendering ---------- */

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
}

// Fast-updating values (energy, rate, affordability) — runs every tick.
function renderDynamic() {
  document.getElementById("energyValue").textContent = E.fmt(state.energy);
  document.getElementById("energyRate").textContent = E.fmt(derived.perSec) + " / sec";
  document.getElementById("tapGain").textContent = "+" + E.fmt(E.tapGainFor(derived));
  document.getElementById("coresValue").textContent = E.fmt(state.cores);
  document.getElementById("multValue").textContent = derived.coreMult.toNumber().toFixed(2);

  const pg = E.prestigeGain(state);
  document.getElementById("prestigeGain").textContent = E.fmt(pg);
  document.getElementById("prestigeBtn").disabled = pg.lte(0);

  for (let idx = 0; idx < GENERATORS.length; idx++) {
    const g = GENERATORS[idx];
    const owned = state.generators[g.id];
    const cost = E.genCost(g, owned);
    const btn = document.getElementById("buy-" + g.id);
    btn.disabled = state.energy.lt(cost);
    btn.innerHTML = `Buy<small>${E.fmt(cost)}</small>`;
    document.getElementById("owned-" + g.id).textContent = owned > 0 ? `×${owned}` : "";
    const per = derived.genProd[g.id] || D(g.baseProd);
    document.getElementById("meta-" + g.id).textContent =
      `${E.fmt(per)}/s each · total ${E.fmt(per.mul(owned))}/s`;
    const item = document.getElementById("gen-" + g.id);
    // Lock generators until the previous one is owned (simple gating).
    const unlocked =
      idx === 0 ||
      state.generators[GENERATORS[idx - 1].id] > 0 ||
      owned > 0 ||
      state.energy.gte(cost.div(3));
    item.classList.toggle("locked", !unlocked);
  }

  for (const u of UPGRADES) {
    const btn = document.getElementById("buyup-" + u.id);
    const cost = D(u.cost);
    if (state.upgrades[u.id]) {
      btn.textContent = "Owned ✓";
      btn.classList.add("bought");
      btn.disabled = true;
    } else {
      btn.classList.remove("bought");
      btn.innerHTML = `Buy<small>${E.fmt(cost)}</small>`;
      btn.disabled = state.energy.lt(cost);
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

function spawnFloater(text, x, y) {
  if (x == null) {
    const r = document.getElementById("tapBtn").getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const f = document.createElement("div");
  f.className = "floater";
  f.textContent = text;
  f.style.left = x + "px";
  f.style.top = y + "px";
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 800);
}

/* ---------- Wiring ---------- */

function bindUI() {
  const tapBtn = document.getElementById("tapBtn");
  // Use pointer events so it works for touch and mouse; prevent double-fire.
  tapBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    doTap(e.clientX, e.clientY);
  });

  document.getElementById("prestigeBtn").addEventListener("click", doPrestige);

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

  // Persist when the tab is hidden/closed (mobile lifecycle).
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
  load();
  buildLists();
  recompute();
  applyOffline();
  renderAll();
  bindUI();

  setInterval(tick, TICK_MS);
  setInterval(() => save(false), AUTOSAVE_MS);
}

window.addEventListener("DOMContentLoaded", init);
