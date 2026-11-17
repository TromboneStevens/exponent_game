# Quantum Forge

A prototype **mobile idle / incremental game** built around
[`break_infinity.js`](https://github.com/Patashu/break_infinity.js) for
large-number math, with a roguelike idol layer and permanent meta-progression —
plus a **headless balance simulator** for fast, data-driven tuning.

Generation is **idle** (no tapping): you buy generators and upgrades, and energy
accrues on its own. The game layers three progression systems:

1. **Prestige depth (P0, P1, P2 …)** — a *continuous* progress axis. P-levels are
   thresholds along it, so a strong player blows through early tiers in moments
   and plateaus deeper in.
2. **Idols** — a per-run roguelike draft. At the start of every run you're shown
   **3 random idols and pick 1**; its bonus lasts the whole run. Idols define
   your "build" and are cleared on macro-reset.
3. **Meta-progression** — a **permanent** shop bought with **Prestige Points**
   (earned on every macro-reset, scaling exponentially with how deep you got).
   Meta-shop upgrades never reset and drive the overarching loop.

A **macro-reset** is the only hard reset: it banks Prestige Points, redrafts your
idol, and restarts you at P0 with permanent bonuses intact — so each run pushes
deeper than the last.

---

## Repository layout

```
index.html        Mobile-first idle game UI (loads break_infinity.js from CDN)
styles.css        Dark, touch-sized, safe-area-aware styling
economy.js        Shared economy module — the SINGLE SOURCE OF TRUTH
game.js           Browser UI layer (DOM, timers, draft, save/load)
sim/
  simulator.js    Headless simulation engine (idle + idols + meta-resets)
  strategies.js   Automated "player" strategies + idol-build archetypes
  scenarios.js    Predefined experiments (milestones, compare, builds, sweep, metarun)
  run.js          CLI entry point (console + CSV/JSON output)
  report.js       CSV builders, console summaries, comparison tables
  test.js         Economy + simulator sanity tests (npm test)
  dom-smoke.js    Headless browser-UI smoke test via jsdom (run manually)
package.json      Scripts and the break_infinity.js dependency (for the sim)
```

### Why a shared `economy.js`

All game rules — generators, upgrades, idols, the meta-shop, the depth ladder,
the Prestige-Point formula and number formatting — live in `economy.js`. It uses
a UMD wrapper so the **exact same code** runs in the browser (as
`window.Economy`) and in Node (the simulator). The balance numbers the simulator
reports therefore reflect the real game, with no risk of a drifting
re-implementation. The whole balance surface (idols, meta-upgrades, constants)
is data-driven — iterate by editing lists, not logic.

---

## Playing the game

### On the web (GitHub Pages)

Every push to `main` auto-deploys the game via
`.github/workflows/pages.yml`, so the latest changes are playable at:

```
https://trombonestevens.github.io/exponent_game/
```

**One-time setup** (repo owner, in the GitHub UI): **Settings → Pages →
Build and deployment → Source: _GitHub Actions_**. After that the workflow runs
on every push to `main` (and can be re-run from the **Actions** tab). The deploy
publishes only the browser assets (`index.html`, `styles.css`, `economy.js`,
`game.js`); the Node simulator is left out of the published site.

### Locally

The game is a static site. Serve the folder over HTTP (needed so the CDN script
and `localStorage` work against a real origin):

```bash
npx serve .          # or: python3 -m http.server 8000
```

Then open the shown URL on your phone or in a browser. Opening `index.html`
directly from disk mostly works too, but a local server is recommended.

**Features:** idle generation (no tapping), 6 generators with exponential cost
scaling, in-run upgrades, a pick-1-of-3 **idol draft** each run, continuous
**prestige depth** (P0…Pn), **macro-reset** banking exponential **Prestige
Points**, a permanent **meta-shop**, offline progress (capped at 12h), autosave
to `localStorage`, and export/import of saves.

---

## The balance simulator

Runs the economy forward in headless time steps, driven by a pluggable strategy
that plays as an automated player — buying generators/upgrades, drafting idols,
spending Prestige Points, and deciding when to macro-reset. It records
time-to-milestone data plus a full time series, so you can answer "how long to
reach P10?", "which idol build banks the most points?", and "what if I change
the depth curve?" in seconds instead of hours of real play.

Drafts use a **seeded PRNG**, so every run is fully reproducible (`--seed`).

```bash
npm install          # installs break_infinity.js (only needed for the sim)
npm test             # 27 economy + simulator sanity tests
node sim/dom-smoke.js # optional: headless browser-UI check (needs: npm i --no-save jsdom)
```

### Quick start

```bash
# Compare player strategies over one day of game time:
node sim/run.js compare --duration=1d

# Compare idol-build archetypes (same play, different idol preference):
node sim/run.js builds --duration=1d

# One strategy, milestone ladder + full time series:
node sim/run.js single --strategy=meta-runner --duration=6h

# Sweep a balance parameter and measure time-to-goal:
node sim/run.js sweep --key=pDepthMul --values=8,10,12 \
  --goal-metric=prestigeLevel --goal-value=10 --duration=2d

# Long multi-macro-reset run to study meta-progression:
node sim/run.js metarun --duration=3d
```

Each run prints a summary and (unless `--no-files`) writes to `sim/out/`:
- `*.series.csv` — one row per sample: energy, depth, P-level, points, resets,
  active idols, and a column per generator. Ready for a spreadsheet or plot.
- `*.milestones.csv` — time-to-goal per milestone (and per strategy/build/param).
- `*.json` — the full structured result.

### Scenarios

| Scenario   | What it answers |
|------------|-----------------|
| `single`   | How long does one strategy take to hit a ladder of goals? Full time series. |
| `compare`  | Which strategy reaches each goal fastest? Side-by-side table. |
| `builds`   | Which **idol build** progresses deepest / banks the most points? |
| `sweep`    | How does changing one balance constant shift time-to-goal? |
| `metarun`  | How does the permanent meta-layer grow over many macro-resets? |

### Strategies (automated players)

| Name               | Behavior |
|--------------------|----------|
| `idle-only`        | Buys nothing. Baseline (still progresses slowly on the free Qubit). |
| `cheapest`         | Buys all upgrades, then the cheapest affordable generator. |
| `best-roi`         | Buys the generator with the shortest payback time. |
| `meta-runner`      | Best-ROI + greedy meta-shop + stall-based macro-resets + production idols. |
| `build-production` | meta-runner favoring `allMul` / `genMul` idols. |
| `build-compound`   | meta-runner favoring `prodExp` (compounding) idols. |
| `build-thrift`     | meta-runner favoring `costMul` (cheaper) idols. |
| `build-points`     | meta-runner favoring `pointsMul` / `depthMul` idols. |

### CLI options

```
--strategy=<name>      strategy for single/sweep/metarun
--strategies=a,b,c     (compare/builds) list of strategies
--duration=<spec>      game time: 3600, 90m, 6h, 3d
--step=<seconds>       sim step size (bigger = faster/coarser). default 1
--seed=<n>             PRNG seed for idol drafts (reproducible). default 1
--out=<dir>            output directory. default sim/out
--no-files             console only
--json                 also print raw JSON

# sweep only:
--key=<CONFIG field>   e.g. pDepthMul, pointsBase, pDepthBase
--values=a,b,c         values to try
--goal-metric=<m>      energy | totalEarned | perSec | depth | prestigeLevel |
                       points | lifetimePoints | macroResets
--goal-value=<n>       e.g. 10
```

### Tunable balance constants (`economy.js` → `CONFIG`)

- `startEnergy`, `startQubits` — the idle bootstrap (free starting production)
- `pDepthBase`, `pDepthMul` — the prestige **depth ladder** (energy for each P-level)
- `pointsBase`, `pointsCoef`, `pointsMinDepth` — the **Prestige Point** reward curve
- `offlineCapSeconds` — max offline accrual

Sweep any of these with the `sweep` scenario to see its effect on pacing.

### Data-driven content (iterate without touching logic)

- **Idols:** `IDOLS` in `economy.js`. Each is `{ id, name, desc, rarity, mods }`
  where `mods` is a list of typed effects (`allMul`, `genMul`, `costMul`,
  `prodExp`, `startEnergy`, `pointsMul`, `depthMul`, `offlineMul`).
- **Meta-shop:** `META_UPGRADES` — permanent, level-based, same effect types.

---

## Extending

- **New generator/upgrade:** add an entry to `GENERATORS`/`UPGRADES` in
  `economy.js`. Both the game and the simulator pick it up automatically.
- **New idol / meta-upgrade:** add to `IDOLS` / `META_UPGRADES`. The draft,
  meta-shop, UI, and simulator all read these lists.
- **New strategy or idol build:** add an object with a `decide(ctx)` method (and
  optionally `pickIdol`, `spendMeta`, `shouldMacroReset`) to `strategies.js` and
  register it in `ALL`.
- **New experiment:** add a function to `scenarios.js` and wire it into
  `run.js`.

This is a prototype; numbers are placeholders meant to be tuned with the
simulator.
