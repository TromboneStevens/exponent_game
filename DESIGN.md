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

**Open boss-fight forks (carried over, still unresolved):**
- **OQ-2 (currency model):** one currency (damage == the current number) vs. a
  separate "gold" dropped by monsters that you spend on DPS upgrades (true
  Tap-Titans model). Leaning single-currency first (reskin, not rewrite).
- **OQ-3 (boss = what?):** a HP pool you must burn down within a **time limit**
  (DPS × time ≥ bossHP), fail → keep grinding normals, retry on demand. Leaning
  timer-based (that's the actual challenge).
- **OQ-4 (manual gate):** bosses become **manual gates** — normal-monster
  progress **caps just below** the next boss until you beat it via a button.
  This is the main behavioral change vs. today's auto-advancing depth.

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
| 12 | Separate monster-drop currency (gold) vs. single damage number | `considering` | OQ-2 |
| 13 | Parallel (non-backbone) layers | `parked` | §3 / OQ-1 — revisit later |
| 14 | Ordered stage ladder (Meadows → … → Void → Steampunk → TBD) | `considering` | §5.4 — stage == P-level |
| 15 | Element-combining system across the dimension stages (→ Void) | `raw` | §5.4 Act III hook |
| 16 | Stages anchor subsystem unlocks (e.g. Tavern after Forest) | `considering` | §5.4 / §5.6 |

---

## 7. Open questions & dependencies

- **OQ-1 — Layers strictly chained, or allow parallel/optional ones?**
  Decision for now: **chained** (layered by default). Parallel = `parked`.
- **OQ-2 — Combat currency model:** single damage number vs. separate gold drop.
- **OQ-3 — Boss mechanic:** timed HP burn vs. instant DPS check.
- **OQ-4 — Boss gating:** do normals cap just below the next boss (manual gate)?
- **OQ-5 — Themes cosmetic or mechanical?** Start cosmetic; revisit.
- **OQ-6 — Tavern relationship:** `feedback(combat, ×mult)` vs. `self-contained`?
- **OQ-7 — How different must each layer be?** Genuinely new rules vs. reskinned
  generator loop. Affects how many layers are realistic.
- **OQ-8 — Stage ↔ P-level granularity.** Decided: stage == prestige level. Still
  open: is it exactly 1 stage per single P-level, or does a stage span a few
  P-levels once the depth curve is tuned? (Affects how long each theme lasts.)
- **OQ-9 — Per-stage currencies?** Do deep-earth / dimension stages introduce
  their own currencies (gems, elements), or stay on the single combat number
  until a formal subsystem unlocks? Ties into OQ-2 and the currency ladder.

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
- Combat reskin: mostly free — it's the same economy; add boss-attempt modeling
  (DPS vs. HP vs. timer) if OQ-3 goes timer-based.
- Each new currency/layer: needs its own economy functions in `economy.js` and a
  way for strategies to "play" it, so runs spanning multiple layers stay
  measurable.
- Keep the **single-source-of-truth** rule: new systems go in `economy.js`
  (shared), never reimplemented in the sim.
