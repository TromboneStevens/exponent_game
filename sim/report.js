/* Output and analysis helpers for simulation results. */

"use strict";

const fs = require("fs");
const path = require("path");
const E = require("../economy.js");
const D = E.D;

function fmtTime(seconds) {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m${rs ? " " + rs + "s" : ""}`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return `${h}h${rm ? " " + rm + "m" : ""}`;
  const dd = Math.floor(h / 24), rh = h % 24;
  return `${dd}d${rh ? " " + rh + "h" : ""}`;
}

/* ---------- CSV ---------- */

function seriesToCsv(result) {
  const genIds = E.GENERATORS.map((g) => g.id);
  const header = ["t_seconds", "energy", "totalEarned", "perSec", "depth", "prestigeLevel", "points", "lifetimePoints", "macroResets", "idols", ...genIds.map((id) => "gen_" + id)];
  const rows = [header.join(",")];
  for (const row of result.series) {
    rows.push([
      row.t, row.energy, row.totalEarned, row.perSec,
      row.depth.toFixed(4), row.prestigeLevel, row.points, row.lifetimePoints, row.macroResets,
      csv((row.idols || []).join("|")),
      ...genIds.map((id) => row.generators[id] || 0),
    ].join(","));
  }
  return rows.join("\n") + "\n";
}

function milestonesToCsv(results) {
  const list = Array.isArray(results) ? results : [results];
  const header = ["strategy", "milestone", "label", "metric", "target", "time_seconds", "time_human", "reached", "depth_at", "points_at"];
  const rows = [header.join(",")];
  for (const r of list) {
    for (const m of r.milestones) {
      rows.push([
        csv(r.meta.strategy), csv(m.id), csv(m.label), m.metric, m.target,
        m.timeSeconds == null ? "" : m.timeSeconds,
        fmtTime(m.timeSeconds),
        m.timeSeconds != null ? "yes" : "no",
        m.depth != null ? m.depth.toFixed(3) : "",
        m.points != null ? m.points : "",
      ].join(","));
    }
  }
  return rows.join("\n") + "\n";
}

function csv(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------- Console summaries ---------- */

function summaryText(result) {
  const m = result.meta;
  const f = result.final;
  const lines = [];
  lines.push(`Strategy:    ${m.strategy}   (seed ${m.seed})`);
  lines.push(`Simulated:   ${fmtTime(m.durationSeconds)} of game time (step ${m.stepSeconds}s)`);
  lines.push(`Final:       P${f.prestigeLevel} (depth ${f.depth.toFixed(2)})   ${E.fmt(D(f.perSec))}/s`);
  lines.push(`Energy:      ${E.fmt(D(f.energy))}   (lifetime ${E.fmt(D(f.totalEarned))})`);
  lines.push(`Points:      ${E.fmt(D(f.points))} now   ${E.fmt(D(f.lifetimePoints))} lifetime   |   ${f.macroResets} macro-resets`);
  lines.push(`Idols (run): ${f.idols.length ? f.idols.map((id) => E.idolDef(id)?.name || id).join(", ") : "(none)"}`);
  const metaLvls = E.META_UPGRADES.filter((u) => (f.metaLevels[u.id] || 0) > 0).map((u) => `${u.id}:${f.metaLevels[u.id]}`);
  lines.push(`Meta-shop:   ${metaLvls.length ? metaLvls.join("  ") : "(none)"}`);
  const owned = E.GENERATORS.map((g) => `${g.id}:${f.generators[g.id] || 0}`).join("  ");
  lines.push(`Generators:  ${owned}`);
  if (result.milestones.length) {
    lines.push("Milestones:");
    for (const mi of result.milestones) {
      lines.push(`   ${pad(mi.label, 24)} ${mi.timeSeconds != null ? fmtTime(mi.timeSeconds) : "not reached"}`);
    }
  }
  return lines.join("\n");
}

function comparisonTable(results) {
  const strategies = results.map((r) => r.meta.strategy);
  const ids = [];
  const labels = {};
  for (const r of results) {
    for (const m of r.milestones) {
      if (!ids.includes(m.id)) { ids.push(m.id); labels[m.id] = m.label; }
    }
  }
  const col0 = Math.max(18, ...ids.map((id) => labels[id].length));
  const colW = Math.max(12, ...strategies.map((s) => s.length));
  const head = pad("Milestone", col0) + " | " + strategies.map((s) => pad(s, colW)).join(" | ");
  const sep = "-".repeat(head.length);
  const rows = [head, sep];
  for (const id of ids) {
    const cells = results.map((r) => {
      const m = r.milestones.find((x) => x.id === id);
      return pad(m && m.timeSeconds != null ? fmtTime(m.timeSeconds) : "—", colW);
    });
    rows.push(pad(labels[id], col0) + " | " + cells.join(" | "));
  }
  rows.push(sep);
  rows.push(pad("final P-level", col0) + " | " + results.map((r) => pad("P" + r.final.prestigeLevel, colW)).join(" | "));
  rows.push(pad("lifetime pts", col0) + " | " + results.map((r) => pad(E.fmt(D(r.final.lifetimePoints)), colW)).join(" | "));
  rows.push(pad("macro-resets", col0) + " | " + results.map((r) => pad(String(r.final.macroResets), colW)).join(" | "));
  return rows.join("\n");
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }

/* ---------- File writing ---------- */

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function write(filePath, contents) { ensureDir(path.dirname(filePath)); fs.writeFileSync(filePath, contents); return filePath; }

module.exports = { fmtTime, seriesToCsv, milestonesToCsv, summaryText, comparisonTable, write, ensureDir };
