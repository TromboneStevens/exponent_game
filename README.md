# Quantum Forge

A prototype **mobile incremental / idle game** built around
[`break_infinity.js`](https://github.com/Patashu/break_infinity.js) for
large-number math, plus a **headless balance simulator** for fast, data-driven
tuning.

Tap to earn Quantum Energy, buy generators that produce energy per second, spend
upgrades to multiply output, and *collapse* (prestige) to earn permanent Cores
that boost everything.

---

## Repository layout

```
index.html        Mobile-first game UI (loads break_infinity.js from CDN)
styles.css        Dark, touch-sized, safe-area-aware styling
economy.js        Shared economy module — the SINGLE SOURCE OF TRUTH
game.js           Browser UI layer (DOM, input, timers, save/load)
sim/
  simulator.js    Headless simulation engine
  strategies.js   Automated "player" strategies (idle, best-ROI, ...)
  scenarios.js    Predefined experiments (milestones, compare, sweep, prestige)
  run.js          CLI entry point (console + CSV/JSON output)
  report.js       CSV builders, console summaries, comparison tables
  test.js         Economy + simulator sanity tests
package.json      Scripts and the break_infinity.js dependency (for the sim)
```

### Why a shared `economy.js`

All game rules — generator costs, production, upgrades, the prestige formula and
number formatting — live in `economy.js`. It uses a UMD wrapper so the **exact
same code** runs in the browser (as `window.Economy`) and in Node (the
simulator). The balance numbers the simulator reports therefore reflect the real
game, with no risk of a drifting re-implementation.

---

## Playing the game

The game is a static site. Serve the folder over HTTP (needed so the CDN script
and `localStorage` work against a real origin):

```bash
npx serve .          # or: python3 -m http.server 8000
```

Then open the shown URL on your phone or in a browser. Opening `index.html`
directly from disk mostly works too, but a local server is recommended.

**Features:** tap-to-earn, 6 generators with exponential cost scaling, 7
upgrades, a prestige/Cores meta-layer, offline progress (capped at 12h),
autosave to `localStorage`, and export/import of saves.

---

## The balance simulator

Runs the economy forward in headless time steps, driven by a pluggable strategy,
and records time-to-milestone data plus a full time series — so you can answer
"how long does X take?" and "what happens if I change Y?" in seconds instead of
hours of real play.

```bash
npm install          # installs break_infinity.js (only needed for the sim)
npm test             # run the sanity tests
```

### Quick start

```bash
# Compare player strategies over one day of game time (3 taps/sec):
node sim/run.js compare --duration=1d --taps=3

# One strategy, milestone ladder + full time series:
node sim/run.js single --strategy=best-roi --duration=6h --taps=4

# Sweep a balance parameter and measure time-to-goal:
node sim/run.js sweep --key=prestigeExponent --values=0.3,0.4,0.5 \
  --goal-metric=cores --goal-value=10 --duration=2d --taps=3

# Long auto-prestige run to study the meta layer:
node sim/run.js prestige --duration=3d --taps=3
```

Each run prints a summary and (unless `--no-files`) writes to `sim/out/`:
- `*.series.csv` — one row per time sample, a column per generator, ready for a
  spreadsheet or plotting tool.
- `*.milestones.csv` — time-to-goal per milestone (and per strategy/parameter).
- `*.json` — the full structured result.

### Scenarios

| Scenario   | What it answers |
|------------|-----------------|
| `single`   | How long does one strategy take to hit a ladder of goals? Full time series. |
| `compare`  | Which strategy reaches each goal fastest? Side-by-side table. |
| `sweep`    | How does changing one balance constant shift time-to-goal? |
| `prestige` | How does the Cores meta-layer progress over a long auto-prestiging run? |

### Strategies (automated players)

| Name              | Behavior |
|-------------------|----------|
| `idle`            | Never buys. Baseline "do nothing" curve. |
| `greedy-cheapest` | Buys all upgrades, then the cheapest affordable generator, repeatedly. |
| `best-roi`        | Buys the generator with the shortest payback time. |
| `patient-roi`     | Best-ROI but keeps a small income buffer. |
| `prestige-roi`    | Best-ROI plus an automatic collapse policy (used by `prestige`/cores sweeps). |

> The game bootstraps through tapping. With `--taps=0` and a fresh save, nothing
> can ever be bought, so pass a realistic `--taps` value for active-play
> analysis.

### CLI options

```
--strategy=<name>        strategy for single/sweep
--strategies=a,b,c       (compare) list of strategies
--duration=<spec>        game time: 3600, 90m, 6h, 3d
--step=<seconds>         sim step size (bigger = faster/coarser). default 1
--taps=<n>               simulated taps/sec. default 0
--out=<dir>              output directory. default sim/out
--no-files               console only
--json                   also print raw JSON

# sweep only:
--key=<CONFIG field>     e.g. prestigeExponent, corePerCoreBonus, prestigeReq
--values=a,b,c           values to try
--goal-metric=<metric>   energy | totalEarned | perSec | cores
--goal-value=<number>    e.g. 1e12
```

### Tunable balance constants (`economy.js` → `CONFIG`)

- `prestigeReq` — lifetime energy before a collapse pays out
- `prestigeDivisor`, `prestigeExponent` — shape of the prestige-gain curve
- `corePerCoreBonus` — production/tap bonus per Core
- `offlineCapSeconds` — max offline accrual

Sweep any of these with the `sweep` scenario to see its effect on pacing.

---

## Extending

- **New generator/upgrade:** add an entry to `GENERATORS`/`UPGRADES` in
  `economy.js`. Both the game and the simulator pick it up automatically.
- **New strategy:** add an object with a `decide(ctx)` method to
  `strategies.js` and register it in `ALL`.
- **New experiment:** add a function to `scenarios.js` and wire it into
  `run.js`.

This is a prototype; numbers are placeholders meant to be tuned with the
simulator.
