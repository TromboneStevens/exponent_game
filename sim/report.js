/* Output and analysis helpers for simulation results.
 *
 * Turns the structured result from simulator.simulate() into:
 *   - CSV time series (one row per sample, columns per generator) for spreadsheet/plotting
 *   - a milestones CSV / table (time-to-goal analysis)
 *   - a human-readable console summary
 *   - raw JSON dump
 */

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

/* ---------- CSV builders ---------- */

function seriesToCsv(result) {
  const genIds = E.GENERATORS.map((g) => g.id);
  const header = ["t_seconds", "energy", "totalEarned", "perSec", "cores", "coreMult", "upgradesOwned", "prestiges", ...genIds.map((id) => "gen_" + id)];
  const rows = [header.join(",")];
  for (const row of result.series) {
    const line = [
      row.t,
      row.energy,
      row.totalEarned,
      row.perSec,
      row.cores,
      row.coreMult,
      row.upgradesOwned,
      row.prestiges,
      ...genIds.map((id) => row.generators[id] || 0),
    ];
    rows.push(line.join(","));
  }
  return rows.join("\n") + "\n";
}

function milestonesToCsv(results) {
  // Accepts a single result or an array (for strategy comparisons).
  const list = Array.isArray(results) ? results : [results];
  const header = ["strategy", "milestone", "label", "metric", "target", "time_seconds", "time_human", "reached"];
  const rows = [header.join(",")];
  for (const r of list) {
    for (const m of r.milestones) {
      rows.push([
        csv(r.meta.strategy),
        csv(m.id),
        csv(m.label),
        m.metric,
        m.target,
        m.timeSeconds == null ? "" : m.timeSeconds,
        fmtTime(m.timeSeconds),
        m.timeSeconds != null ? "yes" : "no",
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
  lines.push(`Strategy:   ${m.strategy}`);
  lines.push(`Simulated:  ${fmtTime(m.durationSeconds)} of game time  (step ${m.stepSeconds}s, ${m.tapsPerSecond} taps/s${m.autoPrestige ? ", auto-prestige" : ""})`);
  lines.push(`Final energy:   ${E.fmt(D(f.energy))}   (${E.fmt(D(f.perSec))}/s)`);
  lines.push(`Lifetime earned: ${E.fmt(D(f.totalEarned))}`);
  lines.push(`Cores:      ${E.fmt(D(f.cores))}   (×${f.coreMult.toFixed(2)} boost)   prestiges: ${f.prestiges}`);
  const owned = E.GENERATORS.map((g) => `${g.id}:${f.generators[g.id] || 0}`).join("  ");
  lines.push(`Generators: ${owned}`);
  const ups = E.UPGRADES.filter((u) => f.upgrades[u.id]).map((u) => u.id);
  lines.push(`Upgrades:   ${ups.length ? ups.join(", ") : "(none)"}`);
  if (result.milestones.length) {
    lines.push("Milestones:");
    for (const mi of result.milestones) {
      lines.push(`   ${pad(mi.label, 28)} ${mi.timeSeconds != null ? fmtTime(mi.timeSeconds) : "not reached"}`);
    }
  }
  return lines.join("\n");
}

// Side-by-side milestone table across multiple strategy results.
function comparisonTable(results) {
  const strategies = results.map((r) => r.meta.strategy);
  // Union of milestone ids, preserving first-seen order.
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
  // Final-energy row for a quick power comparison.
  const finals = results.map((r) => pad(E.fmt(D(r.final.perSec)) + "/s", colW));
  rows.push(sep);
  rows.push(pad("final rate", col0) + " | " + finals.join(" | "));
  return rows.join("\n");
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/* ---------- File writing ---------- */

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function write(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
  return filePath;
}

module.exports = {
  fmtTime,
  seriesToCsv,
  milestonesToCsv,
  summaryText,
  comparisonTable,
  write,
  ensureDir,
};
