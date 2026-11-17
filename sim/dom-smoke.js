#!/usr/bin/env node
/* Headless smoke test of the BROWSER UI (index.html + economy.js + game.js)
 * using jsdom. Verifies the game boots, the idol draft opens for a new player,
 * picking an idol closes it and applies the bonus, lists render, idle rate is
 * positive, and tab switching works — none of which the economy tests cover.
 *
 * jsdom is a dev-only (--no-save) dependency; run manually:
 *   node sim/dom-smoke.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const Decimal = require("break_infinity.js");

let passed = 0, failed = 0;
const ok = (n, c) => (c ? (passed++, console.log("  ✓ " + n)) : (failed++, console.error("  ✗ " + n)));

const root = path.join(__dirname, "..");
const economyJs = fs.readFileSync(path.join(root, "economy.js"), "utf8");
const gameJs = fs.readFileSync(path.join(root, "game.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// Inline economy.js + game.js directly into the HTML (replacing the external
// <script src> tags) and drop the CDN tag — we provide Decimal as a global.
// With runScripts:"dangerously" jsdom executes inline scripts in document order
// and fires DOMContentLoaded naturally, so init() runs exactly as in a browser.
const inlined = html
  .replace(/<script src="https:\/\/cdn[^"]*"><\/script>/, "<script>window.__cdnReady=true;</script>")
  .replace(/<script src="economy.js"><\/script>/, `<script>${economyJs}</script>`)
  .replace(/<script src="game.js"><\/script>/, `<script>${gameJs}</script>`);

const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => console.error("  [jsdom error]", e.message));

// Seed Decimal as a global before scripts run via beforeParse.
const dom = new JSDOM(inlined, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "http://localhost/", // non-opaque origin so localStorage works
  virtualConsole,
  beforeParse(window) {
    window.Decimal = Decimal;
    window.confirm = () => true;
    window.alert = () => {};
  },
});
const { window } = dom;
const $ = (id) => window.document.getElementById(id);

// Let microtasks/DOMContentLoaded settle.
setTimeout(run, 50);

function run() {
  console.log("dom: boot + draft");
  ok("economy attached to window", !!window.Economy);
  // The CDN-failure handler replaces the whole body with a single <p>; detect
  // that specific state rather than substring-matching the handler's text
  // (which also appears verbatim in this file / unrelated nodes).
  ok("game booted (not the CDN-failure fallback)", !!$("app") && !!$("tab-generators"));
  ok("generators listed", $("tab-generators").querySelectorAll(".item").length === window.Economy.GENERATORS.length);
  ok("meta-shop listed", $("tab-meta").querySelectorAll(".item").length === window.Economy.META_UPGRADES.length);
  ok("idol draft opens for a new player", !$("draft").classList.contains("hidden"));
  ok("draft offers 3 choices", $("draftChoices").querySelectorAll(".idol-choice").length === 3);

  console.log("dom: pick an idol");
  const firstChoice = $("draftChoices").querySelector(".idol-choice");
  firstChoice.dispatchEvent(new window.Event("click"));
  ok("draft closes after picking", $("draft").classList.contains("hidden"));
  ok("chosen idol shows in the strip", $("idolStrip").querySelectorAll(".idol-tag").length === 1);

  console.log("dom: starting values");
  ok("energy label present", /\d/.test($("energyValue").textContent));
  ok("rate is positive (idle from free Qubit)", $("energyRate").textContent !== "0 / sec");
  ok("depth starts at P0", $("depthLevel").textContent === "P0");

  console.log("dom: tab switching");
  const metaTab = [...window.document.querySelectorAll(".tab")].find((t) => t.dataset.tab === "meta");
  metaTab.dispatchEvent(new window.Event("click"));
  ok("meta tab becomes active", $("tab-meta").classList.contains("active"));

  console.log(`\n${passed} passed, ${failed} failed`);
  window.close();
  process.exit(failed ? 1 : 0);
}
