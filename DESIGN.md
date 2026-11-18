# Quantum Forge — Design Doc

> Living design document. Code is the source of truth for what *exists*; this is
> the source of truth for what we *intend* and what's still open. Nothing here is
> built until it moves to `planned` and we scope it. Keep it honest: mark
> speculation as speculation.

**Status key:** `live` (built & shipped) · `planned` (agreed, not built) ·
`considering` (actively weighing) · `raw` (brain-dump, unexamined) · `parked`
(good idea, deliberately deferred).

---

## 1. Vision

An idle/incremental game where **progression carries you through escalating,
changing contexts.** You don't just watch one number grow — climbing the
prestige ladder pushes you through shifting *themes*, unlocks whole new
*subsystems* to play, and hands you a chain of *currencies* that each balloon and
then give way to the next. The feel: a battler with character that keeps
reinventing what you're actually doing, so it never settles into one loop.

North star phrase: **"the game keeps becoming a new game as you go deeper."**

---

## 2. The core pattern — the Layer Loop

Everything new hangs off one reusable template. Every subsystem ("layer") the
game introduces should follow this lifecycle:

```
unlock  →  build  →  balloon  →  automate  →  feed forward
```

1. **Unlock** — a prestige/progress threshold opens a new layer (new screen, new
   currency, new rules).
2. **Build** — you grind that layer's currency up from scratch; it's the active
   focus for a while.
3. **Balloon** — like every incremental currency, it eventually grows
   exponentially and trivializes its own challenges.
4. **Automate** — once ballooned, the layer becomes automatable so it no longer
   needs hands-on attention.
5. **Feed forward** — the (now passive) layer either feeds the *next* layer or
   loops a bonus back into an earlier one (see §3), and attention moves on.

> This is the genre's "layered currencies" idea: each new resource eventually
> dwarfs and automates the last. Writing the loop down once means every proposed
> subsystem has to answer the same five questions.

**Decision (current):** the game is **layered by default** — a backbone chain of
subsystems, one leading into the next. Parallel/optional layers are allowed later
but are not the default (see §3, Open Question OQ-1).

---

## 3. Core concept — a layer's relationship to the rest of the game

A layer is NOT required to be an island. Each layer declares how it relates to
what came before. This is a **per-layer property**, chosen deliberately:

- **`self-contained`** — progresses on its own, mainly for variety/content. Its
  currency and challenges stay within the layer.
- **`feedback(target, kind)`** — produces a bonus that flows **back** into an
  earlier layer (usually the combat core). Example: a tavern that, once built,
  grants a ×N multiplier to combat DPS — letting you break a plateau you were
  stuck at.

The **feedback** type is what makes the chain feel connected instead of being a
pile of disconnected mini-games: a wall in combat becomes the *reason* to go
build the next layer, because that layer hands you the multiplier that breaks the
wall. We want most backbone layers to be `feedback`, with the occasional
`self-contained` layer for flavor.

Tagging every layer with this attribute is a hard requirement in this doc — no
subsystem gets added without answering "self-contained, or feedback into what?"

---

## 4. Pillars

1. **Combat / battler core (Layer 0)** — the permanent spine. Idle DPS vs.
   enemies; bosses gate prestige tiers. Everything else hangs off this.
2. **Theme escalation** — the setting visibly changes as you climb (medieval
   fantasy → steampunk → dark fantasy → …). Aesthetic reward for depth.
3. **Subsystem layers** — new mini-games unlocked at thresholds, each following
   the Layer Loop (§2) and tagged by relationship (§3).
4. **Currency ladder** — a sequence of currencies, each ballooning and giving way
   to the next, realized *through* the layers.

---

## 5. Systems

### 5.1 Combat / battler core — Layer 0 — `live`-economy, `planned`-combat skin

**Status:** the *economy* underneath is live; the *combat presentation* is
proposed (this is the autobattler reskin we were mid-discussion on).

The existing economy already maps cleanly onto combat, so this is largely a
reskin + one new gating rule, not an economy rewrite:

| Combat concept | Existing economy |
|---|---|
| Your DPS | `perSec` (generator production) |
| Damage dealt / progress | energy accrued (`totalEarned`) |
| Normal monsters | passive damage tick advancing toward the next threshold |
| Boss at each tier | the P-level threshold (`levelThreshold(n)`) |
| Beating a boss → next tier | crossing into P_n |
| Idols / meta-shop / macro-reset | unchanged, reflavored (relics, hero upgrades) |

Generators become **DPS sources** (summons/weapons/party members). Prestige depth
becomes **how far you've fought**.

**Open boss-fight forks:**
- **OQ-2 (currency model): DECIDED → gold.** Monsters drop **gold**; gold buys
  DPS/economy upgrades (true Tap-Titans model). This supersedes the energy model
  for the combat layer. See §5.1.1.
- **OQ-3 (boss = what?): DECIDED → pure DPS check, no timer.** A boss is a large
  fixed-HP wall. No fail state and no clock: you *can* always grind it down, but
  under-powered it takes an absurd amount of time, so in practice you farm
  upgrades until your DPS clears it quickly. Built in `combat.js` (`attemptBoss`,
  `bossDpsCheck`).
- **OQ-4 (enemy cap): DECIDED → capped normals, manual boss attempt.** Normal
  enemy HP and *base* gold scale per kill but **cap** (`hpCapKill`/`goldCapKill`);
  past the cap every normal is identical, so grinding yields flat income — a
  deliberate plateau. (The player's gold-drop upgrade still scales gold.) Normals
  auto-loop; the boss is entered only when the player chooses to attempt it.

### 5.1.1 Stage-1 combat loop (Green Meadows) — `planned`

The concrete initial gameplay loop. First enemy: a **Goblin**.

```
auto-attack → damage enemy → enemy dies → gold drops
   → spend gold on upgrades → kill faster → next enemy (more HP) → …
```

**Effective DPS model.** A hit lands every `1/attackSpeed` seconds for
`attackDamage`, with crits scaling by `critMult`:

```
critFactor = 1 + critChance * (critMult - 1)      # expected-value of crits
dps        = attackDamage * attackSpeed * critFactor
timeToKill = enemyHP / dps
```

**Upgrades (5 tracks).** Each is a level-based buy; cost rises per level.

| # | Upgrade | Lever | First-pass base / per-level | Cost (base, mult) |
|---|---------|-------|------------------------------|-------------------|
| 1 | Attack Damage | `attackDamage` | base 1, +1 per level (×? TBD) | 10, ×1.07 |
| 2 | Attack Speed | `attackSpeed` (hits/s) | base 1.0, +0.1/level, **soft-cap** | 25, ×1.12 |
| 3 | Gold Drop | gold per kill ×  | base ×1, +10%/level | 20, ×1.10 |
| 4 | Crit Chance | `critChance` | base 0, +2%/level (cap ~50–75%?) | 40, ×1.15 |
| 5 | Crit Damage | `critMult` | **base 1.1×**, +0.1/level | 60, ×1.18 |

> **Crit split (user):** crit *chance* and crit *damage* are separate tracks (#4,
> #5). Crit damage starts small at **1.1×** and climbs. Chance alone does nothing
> until there's crit damage above 1×, so early on #5 gates #4's value.

**Starting feel (user):** with only the first upgrade, the Goblin takes **~4–5
hits** to kill. So `goblinHP ≈ 4–5 × base attackDamage` at level 1.

**Enemy HP scaling.** `enemyHP(n) = baseHP × hpGrowth^n` where `n` = enemies
killed this stage. `hpGrowth` is THE pacing knob (see §5.1.2 findings). Bosses
(every K kills) get an HP multiplier and the timed fight (OQ-3).

**Gold reward.** `gold(n) = baseGold × goldGrowth^n × goldDropMult`. Must grow
slower than HP×cost so upgrades stay meaningful but you don't stall.

**Attack-speed soft cap (OQ-10):** past a cap (e.g. 5 hits/s) extra speed becomes
a flat damage multiplier instead of literal swings (engine can't show 50/s).

**Open sub-questions:**
- **OQ-10** attack-speed cap value + overflow-to-damage conversion.
- **OQ-11** crit-chance cap (avoid 100% trivializing the EV model).
- **OQ-12** does gold also feed prestige/depth, or is depth = stage/kills only?
  (Lean: depth = stage reached; gold is in-stage only. Keeps layers clean.)

### 5.1.2 Stage-1 balance findings (from the simulator)

Tuned with `node sim/run.js combat` (see §8). **First-pass defaults** now in
`combat.js`:

- Upgrade cost multipliers raised (atk ×1.15, spd ×1.5, gold ×1.25, critChance
  ×1.4, critDmg ×1.35) so spend keeps pace with exponential HP.
- `baseHP 4`, `hpGrowth 1.12`; `baseGold 4`, `goldGrowth 1.14`.
- **Attack speed lowered for animation readability** (OQ-10 resolved): base
  `0.8/s` (was 1.0), soft cap `2.5/s` (was 5.0). This keeps the hero's 8-frame
  attack sprite legible rather than blurring; starting DPS is 0.8 (goblin dies in
  ~5s / ~4 swings). The sim confirmed pacing holds (boss still clears Stage 1 in
  ~4 min) — the DPS once supplied by raw speed now comes from the overflow-damage
  multiplier and the other stats.

Now also models the boss/cap decisions (OQ-3/OQ-4): `stageKills 40`, HP/gold cap
at kill 40, boss HP = capped-stage-end HP × 25 (DPS-check ≈ 465 at Stage 1).

**Findings:**
- **Starting feel is right:** 1st goblin dies in **~5s**, kill 10 ~39s — a calm,
  readable opening (one swing every 1.25s at base speed).
- **`hpGrowth` vs `goldGrowth` is THE pre-cap knob.** The gap sets how fast DPS
  climbs vs enemies before the cap. Picked `hpGrowth 1.12` under `goldGrowth 1.14`.
- **The cap (OQ-4) creates the intended plateau.** Past kill 40, normals are flat,
  so DPS snowballs on fixed targets — you farm gold at a steady rate to push DPS
  toward the boss wall.
- **Boss is a real but fair wall.** `best-dps-per-gold` farms ~100 normals (~3–4
  min) to reach the ~465 DPS check, then clears Stage 1. Clearing is gated on
  *build quality*, not raw time.
- **No single-stat dominance — and it gates the boss.** `atk-only` farms 400+
  normals but its DPS (~81) never approaches the boss check, so it **cannot clear
  the boss**. Spreading across the 5 tracks (crit, speed, gold) is required to
  cross the DPS check — the upgrades genuinely complement each other.
- **`no-buy` never threatens the boss** (DPS 1, ~35 kills). Buying matters.

**Not yet modeled — per-stage escalation (OQ-8).** The sim currently tunes ONE
stage; `combat.js` can advance stages but every stage reuses Stage 1's curve, so
later bosses aren't tougher yet. Multi-stage scaling (each stage ramps baseHP/
gold) is the next combat task. The combat sim defaults to `stopAtStage: 1`.

**Bug caught by the sim (now fixed):** multiplicative stats (`goldMult`,
`critMult`) were plain-float `Math.pow`, so after thousands of levels `goldMult`
overflowed to `Infinity` — the exact failure `break_infinity.js` exists to
prevent. Unbounded stats are now `Decimal`. Regression-tested in `sim/test.js`.

**Still open:** OQ-8 (per-stage escalation — next combat task), OQ-10 (speed cap
overflow value), OQ-11 (crit-chance cap — set to 60% for now), OQ-12 (does gold
feed depth?).

### 5.2 Idols (per-run roguelike draft) — `live`

Draft 3, pick 1 at run start; bonus lasts the run; cleared on macro-reset.
Data-driven typed-modifier pool. Will be reflavored to fit the combat theme
(e.g. "relics" / "blessings"). No mechanical change planned yet.

### 5.3 Meta-progression (permanent shop) — `live`

Prestige Points earned on macro-reset (exponential in depth, continuous); spent
in a permanent shop that never resets. Reflavor as a persistent "hero"/"legacy"
track. No mechanical change planned yet.

### 5.4 Stage / theme ladder — `considering`

**Decision:** a **stage == a prestige level**. The stage list below *is* the
P-ladder — clearing a boss advances you one named stage (Green Meadows = P0,
Forest = P1, …). Theme and depth are the same axis; no separate layer.

**Decision:** stages are **thematic for now**, but any stage may later carry a
**mechanical hook** — a subsystem unlock or a new rule, if a stage inspires one.
So a stage is the natural anchor for *where* subsystem layers (§5.5/§5.6) unlock.
Each stage is therefore either purely cosmetic or tagged with a `mechanicalHook`.

Stages are grouped into **acts** (my proposed grouping; order is the user's exact
list). P-numbers are placeholders — the ladder may not be 1 stage per single
P-level once tuned (see OQ-8). **All art is placeholder for now.**

**Act I — Overworld descent** (classic fantasy start)

| # | Stage | P (sketch) | Candidate mechanical hook |
|---|-------|-----------|---------------------------|
| 1 | Green Meadows | P0 | — (start) |
| 2 | Forest | P1 | **After Forest:** unlock **Tavern** sim (§5.6) |
| 3 | Icy Mountain | P2 | — |
| 4 | Caverns | P3 | — |
| 5 | Underground Ancient Ruins | P4 | — |

**Act II — Deep earth**

| # | Stage | P (sketch) | Candidate mechanical hook |
|---|-------|-----------|---------------------------|
| 6 | Gem Mines | P5 | — (gem/resource currency?) |
| 7 | Lava Caverns | P6 | — (bridges into the elemental dimensions) |

**Act III — Elemental dimensions** (a themed set of 5; Void is the capstone)

| # | Stage | P (sketch) | Candidate mechanical hook |
|---|-------|-----------|---------------------------|
| 8  | Flame Elemental Dimension | P7  | Unlock **element-combining** system (see below) |
| 9  | Earth Dimension | P8  | element system continues |
| 10 | Water Dimension | P9  | element system continues |
| 11 | Air Dimension   | P10 | element system continues |
| 12 | Void Dimension  | P11 | **capstone:** combine all elements to break into Void |

> **Element-combining hook (user idea):** across the dimension stages you collect
> elements and combine them to boost score, with reaching Void as the payoff.
> This is a candidate `feedback`-type subsystem (§3) gated across stages 8–12.
> Tagged `raw` — a real system to design later, not a reskin.

**Act IV+ — Multiverse** (theme stops being natural-world; goes unique)

| # | Stage | P (sketch) | Notes |
|---|-------|-----------|-------|
| 13 | Steampunk | P12 | "jumping multiverses" — first non-natural theme |
| 14+ | TBD | P13+ | dark fantasy / cosmic / sci-fi / beyond |

**Scope note:** cheapest version of the whole ladder is cosmetic (palette, enemy
art, stage name swap per stage). Mechanical hooks (Tavern, element system) are
opt-in per stage and are the expensive part. Start cosmetic; add hooks only where
a stage genuinely inspires one. **OQ-5:** which stages (if any) change *rules* vs.
just looks?

### 5.5 Subsystem framework — `planned` (framework), `raw` (each instance)

A reusable framework so each new layer isn't bespoke scaffolding: a registry of
layers, each with `{ id, unlockThreshold, currency, relationship (§3), screen,
automationRule }`. Building this once is what makes "constantly unlocking new
areas" tractable instead of N one-off features.

**Dependency:** worth building the framework only after we've prototyped **one**
layer by hand (the Tavern, §5.6) and learned the shape. Don't frameworkize
before we have one real example.

### 5.6 Worked example — Tavern management sim — `raw`

First candidate subsystem layer, to learn the pattern on.

- **Unlock:** **after the Forest stage (P1→P2)** — see §5.4 ladder.
- **Currency:** e.g. "Coin," separate from combat energy.
- **Build:** run a tavern — micro-progression (buy tables/staff/menu, serve
  patrons) grinding Coin.
- **Balloon → automate:** hire a manager that runs it passively.
- **Relationship (§3):** proposed **`feedback` → combat DPS ×N**, so building the
  tavern breaks a combat plateau. (Could instead be `self-contained`; decide when
  we scope it.)

**Honest flag:** a tavern sim is a genuinely new mini-game (new UI, economy,
content, balance, and simulator support) — NOT a reskin. It's the single biggest
piece of net-new work on the table. Prototype it small first.

---

## 6. Idea backlog (raw dump, nothing lost)

| # | Idea | Tag | Notes / where it lives |
|---|------|-----|------------------------|
| 1 | Battler/autobattler theme for the incremental core | `considering` | §5.1 |
| 2 | D&D / fantasy styling | `considering` | §5.1 / §5.4 |
| 3 | Theme shifts with depth (medieval → steampunk → dark fantasy → …) | `considering` | §5.4 |
| 4 | Higher prestige unlocks unique *gameplay stages*, not just bigger upgrades | `planned` (as framework) | §5.5 |
| 5 | Tavern management sim as an unlocked subsystem with its own currency | `raw` | §5.6 |
| 6 | Subsystems: unlock → micro-progress → **automate** → move on | `planned` | §2 Layer Loop |
| 7 | Endless currency ladder: each balloons, forcing a jump to a new currency/area | `planned` | §2 / §4 pillar 4 |
| 8 | Some subsystems feed huge multipliers back to combat to break plateaus | `considering` | §3 feedback type |
| 9 | Tap-Titans-style layout: hero attacking monsters, scaling health bars | `considering` | §5.1 |
| 10 | Bosses at thresholds with bigger health bars | `considering` | §5.1 / OQ-3 |
| 11 | Manual boss attempt button; fail → back to normals; retry on demand | `considering` | §5.1 / OQ-4 |
| 12 | Separate monster-drop currency (gold) vs. single damage number | `planned` (gold chosen) | §5.1.1, combat.js |
| 17 | Stage-1 combat loop: 5 upgrades (dmg/spd/gold/crit%/critDmg) | `planned` | §5.1.1 — built in combat.js |
| 13 | Parallel (non-backbone) layers | `parked` | §3 / OQ-1 — revisit later |
| 14 | Ordered stage ladder (Meadows → … → Void → Steampunk → TBD) | `considering` | §5.4 — stage == P-level |
| 15 | Element-combining system across the dimension stages (→ Void) | `raw` | §5.4 Act III hook |
| 16 | Stages anchor subsystem unlocks (e.g. Tavern after Forest) | `considering` | §5.4 / §5.6 |

---

## 7. Open questions & dependencies

- **OQ-1 — Layers strictly chained, or allow parallel/optional ones?**
  Decision for now: **chained** (layered by default). Parallel = `parked`.
- **OQ-2 — Combat currency model: DECIDED → gold drop** (Tap-Titans model). Built
  in `combat.js` / `sim/combat.js`.
- **OQ-3 — Boss mechanic: DECIDED → pure DPS check, no timer.** Large fixed-HP
  wall; grindable but absurdly slow when under-powered. Built in `combat.js`.
- **OQ-4 — Boss gating: DECIDED → capped normals + manual boss attempt.** Normal
  HP/base-gold cap (flat income plateau); boss entered only on player choice.
  Built in `combat.js`.
- **OQ-5 — Themes cosmetic or mechanical?** Start cosmetic; revisit.
- **OQ-6 — Tavern relationship:** `feedback(combat, ×mult)` vs. `self-contained`?
- **OQ-7 — How different must each layer be?** Genuinely new rules vs. reskinned
  generator loop. Affects how many layers are realistic.
- **OQ-8 — Stage ↔ P-level granularity.** Decided: stage == prestige level. Still
  open: is it exactly 1 stage per single P-level, or does a stage span a few
  P-levels once the depth curve is tuned? (Affects how long each theme lasts.)
- **OQ-9 — Per-stage currencies?** Do deep-earth / dimension stages introduce
  their own currencies (gems, elements), or stay on gold until a formal subsystem
  unlocks? Ties into the currency ladder.
- **OQ-10 — Attack-speed soft cap: RESOLVED → 2.5/s** (base 0.8/s). Lowered from
  5/s so the hero attack animation stays readable; overflow past the cap still
  becomes a damage multiplier. Historical note below.
- **OQ-10 (orig) — Attack-speed soft cap.** Current: literal swings cap at 5/s, overflow
  becomes a flat damage multiplier. Cap value TBD.
- **OQ-11 — Crit-chance cap.** Set to 60% for now so the EV model stays sane.
- **OQ-12 — Does gold feed depth/prestige,** or is depth = stage/kills only?
  (Lean: depth = stage reached; gold is in-stage only. Keeps layers clean.)

**Build-order dependencies:**
1. Settle the combat forks (OQ-2/3/4) → reskin Layer 0 into the battler. *(First
   buildable step; mostly reskins the existing economy.)*
2. Theme escalation, cosmetic version (OQ-5) → cheap, high-character win.
3. Prototype **one** subsystem by hand (Tavern, §5.6) → learn the pattern.
4. Only then: generalize into the subsystem framework (§5.5).

---

## 8. Simulator implications (don't let balance tooling fall behind)

The headless simulator (`sim/`) is how we keep this balanced. As systems land it
must keep pace, or we lose the ability to answer "how long does X take?":

**Two economies, two sims (both shared source-of-truth):**
- `economy.js` + `sim/{simulator,strategies,scenarios}.js` — the prestige / idle /
  idols / meta layer.
- `combat.js` + `sim/{combat,combatStrategies,combatReport}.js` — the Stage-1
  autobattler (gold / DPS / enemies).

**Combat sim usage:**
```
node sim/run.js combat                         # one strategy, default tuning
node sim/run.js combat --strategies=no-buy,atk-only,round-robin,best-dps-per-gold
node sim/run.js combat --hpGrowth=1.13 --goldGrowth=1.14 --duration=30m
node sim/run.js combat --strategy=best-dps-per-gold --kills=1,10,50,100
```
Overridable combat CONFIG via flags: `baseHP, hpGrowth, baseGold, goldGrowth,
bossInterval, bossHpMult, bossTimeLimit, speedSoftCap`. Buy-strategies:
`no-buy, atk-only, round-robin, best-dps-per-gold`. Output: kill-goal timings,
a per-sample series CSV (DPS/gold/stats/levels), and JSON.

**Still to add:** boss timed-fight modeling (OQ-3/4); eventually connect the
combat layer to prestige so a full run spans both. Keep the
**single-source-of-truth** rule: new systems go in the shared economy modules,
never reimplemented inside `sim/`.
