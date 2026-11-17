/* Output + analysis for Stage-1 combat simulations. */

"use strict";

const fs = require("fs");
const path = require("path");
const C = require("../combat.js");
const D = C.D;

function fmtTime(seconds) {
  if (seconds == null) return "—";
  const s = Math.round(seconds * 10) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = Math.round(s % 60);
  return `${m}m${rs ? " " + rs + "s" : ""}`;
}

function fmt(dec) {
  const n = D(dec);
  if (n.lt(1000)) {
    const num = n.toNumber();
    return Number.isInteger(num) ? String(num) : num.toFixed(2);
  }
  const suf = ["", "K", "M", "B", "T", "Qa", "Qi"];
  const tier = Math.floor(n.log10() / 3);
  if (tier < suf.length) return (n.div(D(10).pow(tier * 3)).toNumber()).toFixed(2) + suf[tier];
  return n.toExponential(2).replace("e+", "e");
}

function seriesToCsv(result) {
  const upIds = C.UPGRADES.map((u) => u.id);
  const header = ["t_seconds", "kills", "gold", "dps", "attackDamage", "attackSpeed", "effectiveAttackSpeed", "critChance", "critMult", "goldMult", "enemyMaxHP", ...upIds.map((id) => "lvl_" + id)];
  const rows = [header.join(",")];
  for (const r of result.series) {
    rows.push([
      r.t, r.kills, r.gold, r.dps,
      r.attackDamage, r.attackSpeed, r.effectiveAttackSpeed,
      r.critChance, r.critMult, r.goldMult, r.enemyMaxHP,
      ...upIds.map((id) => r.levels[id] || 0),
    ].join(","));
  }
  return rows.join("\n") + "\n";
}

function goalsToCsv(results) {
  const list = Array.isArray(results) ? results : [results];
  const header = ["strategy", "kill_goal", "time_seconds", "time_human", "gold_at", "dps_at", "reached"];
  const rows = [header.join(",")];
  for (const r of list) {
    for (const g of r.goals) {
      rows.push([
        csv(r.meta.strategy), g.kills,
        g.timeSeconds == null ? "" : g.timeSeconds,
        fmtTime(g.timeSeconds),
        g.gold != null ? g.gold : "",
        g.dps != null ? g.dps : "",
        g.timeSeconds != null ? "yes" : "no",
      ].join(","));
    }
  }
  return rows.join("\n") + "\n";
}

function csv(v) { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }

function num(x) { return D(x).toNumber(); }

function summaryText(result) {
  const m = result.meta, f = result.final;
  const lines = [];
  lines.push(`Strategy:   ${m.strategy}`);
  lines.push(`Simulated:  ${fmtTime(m.durationSeconds)}  (step ${m.stepSeconds}s)  hpGrowth=${m.config.hpGrowth} goldGrowth=${m.config.goldGrowth} cap@kill${m.config.hpCapKill}`);
  lines.push(`Result:     stage ${f.stage} · ${f.bossesCleared} boss(es) cleared · ${f.kills} kills`);
  lines.push(`Combat:     ${fmt(f.dps)} DPS  (boss DPS-check ≈ ${fmt(f.bossDpsCheck)})  ·  ${fmt(f.gold)} gold banked`);
  lines.push(`Stats:      dmg ${num(f.stats.attackDamage).toFixed(1)} · spd ${f.stats.attackSpeed.toFixed(2)} (eff ${f.stats.effectiveAttackSpeed.toFixed(2)}) · crit ${(f.stats.critChance * 100).toFixed(0)}%@${num(f.stats.critMult).toFixed(2)}x · gold ×${fmt(f.stats.goldMult)}`);
  lines.push(`Levels:     ${C.UPGRADES.map((u) => `${u.id}:${f.levels[u.id]}`).join("  ")}`);
  lines.push(`Worst stall: ${result.worstStall.seconds}s on a single enemy (around kill ${result.worstStall.kills})`);
  lines.push("Kill goals:");
  for (const g of result.goals) {
    lines.push(`   ${pad("kill " + g.kills, 12)} ${g.timeSeconds != null ? fmtTime(g.timeSeconds) : "not reached"}`);
  }
  if (result.stageGoals && result.stageGoals.some((g) => g.timeSeconds != null)) {
    lines.push("Stage clears:");
    for (const g of result.stageGoals) {
      if (g.timeSeconds != null) lines.push(`   ${pad("boss " + g.stage, 12)} ${fmtTime(g.timeSeconds)}`);
    }
  }
  return lines.join("\n");
}

function comparisonTable(results) {
  const strategies = results.map((r) => r.meta.strategy);
  const goals = [];
  for (const r of results) for (const g of r.goals) if (!goals.includes(g.kills)) goals.push(g.kills);
  goals.sort((a, b) => a - b);
  const col0 = 14, colW = Math.max(16, ...strategies.map((s) => s.length));
  const head = pad("Kill goal", col0) + " | " + strategies.map((s) => pad(s, colW)).join(" | ");
  const rows = [head, "-".repeat(head.length)];
  for (const k of goals) {
    const cells = results.map((r) => {
      const g = r.goals.find((x) => x.kills === k);
      return pad(g && g.timeSeconds != null ? fmtTime(g.timeSeconds) : "—", colW);
    });
    rows.push(pad("kill " + k, col0) + " | " + cells.join(" | "));
  }
  rows.push("-".repeat(head.length));
  rows.push(pad("final kills", col0) + " | " + results.map((r) => pad(String(r.final.kills), colW)).join(" | "));
  rows.push(pad("final DPS", col0) + " | " + results.map((r) => pad(fmt(r.final.dps), colW)).join(" | "));
  return rows.join("\n");
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function write(filePath, contents) { ensureDir(path.dirname(filePath)); fs.writeFileSync(filePath, contents); return filePath; }

module.exports = { fmtTime, fmt, seriesToCsv, goalsToCsv, summaryText, comparisonTable, write };
