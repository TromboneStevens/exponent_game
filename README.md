# Infinity Slayer

A prototype **mobile idle autobattler** built around
[`break_infinity.js`](https://github.com/Patashu/break_infinity.js) for
large-number math — plus a **headless balance simulator** for fast, data-driven
tuning.

> Formerly "Quantum Forge." See `DESIGN.md` for the full vision (escalating
> fantasy stages, roguelike idols, and permanent meta-progression). This
> prototype currently implements the **Stage-1 combat loop**.

## The game (combat loop)

The hero **auto-attacks** enemies; you don't tap. Enemies drop **gold**, which
you spend on 5 upgrade tracks:

- **Attack Damage**, **Attack Speed** (soft-capped), **Gold Drop**,
  **Crit Chance**, **Crit Damage** (separate track).

Each stage is a run of normal enemies, then a **boss**:

- Normal enemy HP and base gold **cap** partway through a stage, so grinding
  becomes flat income — a deliberate plateau that pushes you to upgrade.
- The **boss is a pure DPS check** (no timer): a large fixed-HP wall you *attempt*
  on demand. Enough DPS clears it quickly; under-powered it's a wall. Clearing it
  advances to the next stage.

## Two economies in this repo

The player-facing game is the **combat** autobattler (`combat.js`). The repo also
contains a separate **idle/prestige economy** (`economy.js` — generators, idols,
a meta-shop) that is fully simulated and slated to become a later prestige layer
per `DESIGN.md`, but is **not** currently wired into the UI.

Both are pure, shared, UMD-style modules (`window.Combat` / `window.Economy` in
the browser; `require` in Node), so the simulator exercises the **exact same
code** the game runs — balance numbers never drift from a re-implementation.

---

## Repository layout

```
index.html        Combat UI (Infinity Slayer; loads break_infinity.js from CDN)
styles.css        Dark, touch-sized, safe-area-aware styling
combat.js         Combat economy (gold/DPS/enemies) — shared source of truth
economy.js        Idle/prestige economy (generators/idols/meta) — shared, sim-only for now
game.js           Browser UI layer for the combat game (DOM, loop, save/load)
DESIGN.md         Living design doc: vision, stage ladder, open questions
sim/
  combat.js          Headless combat simulator
  combatStrategies.js  Buy-strategies (no-buy, atk-only, round-robin, best-dps-per-gold)
  combatReport.js    Combat CSV / console reporting
  simulator.js       Idle/prestige simulation engine
  strategies.js      Idle strategies + idol-build archetypes
  scenarios.js       Idle experiments
  report.js          Idle CSV / console reporting
  run.js             CLI entry point for BOTH sims (console + CSV/JSON output)
  test.js            Sanity tests for both economies (npm test)
  dom-smoke.js       Headless browser-UI smoke test via jsdom (run manually)
package.json      Scripts and the break_infinity.js dependency (for the sims)
```

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
publishes only the browser assets (`index.html`, `styles.css`, `combat.js`,
`economy.js`, `game.js`); the Node simulator is left out of the published site.

### Locally

The game is a static site. Serve the folder over HTTP (needed so the CDN script
and `localStorage` work against a real origin):

```bash
npx serve .          # or: python3 -m http.server 8000
```

Then open the shown URL on your phone or in a browser. Opening `index.html`
directly from disk mostly works too, but a local server is recommended.

**Features:** idle auto-attack combat (no tapping), 5 gold-bought upgrade tracks,
scaling enemies that **cap** into a farming plateau, **boss DPS-check** fights,
themed stages, offline progress (capped at 12h), autosave to `localStorage`, and
export/import of saves.

---

## Balance simulators

Two headless simulators share the game's exact economy modules. Run the combat
one to tune the Stage-1 loop:

```bash
npm install
# Compare buy-strategies; see time to clear the Stage-1 boss:
node sim/run.js combat --strategies=no-buy,atk-only,round-robin,best-dps-per-gold
# Tune the pacing knobs:
node sim/run.js combat --hpGrowth=1.13 --goldGrowth=1.14 --duration=30m
```

The idle/prestige simulator (below) drives the not-yet-wired `economy.js` layer.

### The idle/prestige simulator

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
