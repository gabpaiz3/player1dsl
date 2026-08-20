# Genre survey — what kernel shapes real 2600 games need

A working list of the display shapes Player1DSL's kernel catalog will eventually have
to cover, drawn from looking at early and mid-era Atari 2600 titles.

**Why this document exists rather than a folder of screenshots.** The reference images
this was written from are screenshots of copyrighted commercial games, sourced from
[AtariAge's 2600 screenshot archive](https://www.atariage.com/system_items.php?SystemID=2600&itemTypeID=SCREENSHOT).
AGENTS.md forbids adding third-party ROMs or commercial assets to the repository, so
`game-images/` is git-ignored and only this analysis is committed. Nothing here
reproduces the source material; the titles are cited so anyone can look at the same
things.

**Evidence labels.** Per AGENTS.md, conclusions are marked:

- **observed** — visible directly in a screenshot.
- **inferred** — a reasonable reading of the hardware given what is observed, but not
  measured. Every cycle cost below is inferred.
- **unknown** — named so it is not mistaken for settled.

No claim here has been measured in our emulator. That matters: this project is nine for
nine on derivations losing to measurements, so this document sets the *agenda* for
increment 4b's fixtures, and the fixtures — not this file — produce the numbers.

## The shapes

### 1. Two objects on a static reflected playfield — `Combat`, `Surround`, `Outlaw`

**observed** (Combat): two tanks; a maze playfield symmetric about the vertical centre;
a solid border; two score digits in a band at the top of the screen.

**inferred:** this is exactly the shape `examples/tank-arena/reference` implements, which
makes tank-arena the Combat archetype rather than an invented toy. The playfield is
static within the field band, so `PF0/PF1/PF2` are written once per region rather than
per line, leaving most of each line's 76 cycles for the two players.

Covered by the planned `two-sprite-static-field` catalog entry.

### 2. Paddles and a ball, almost no playfield — `Video Olympics`, `Breakout`

**observed** (Video Olympics): paddle bars as player objects, with more bars visible than
there are player objects — so `NUSIZ` copies are in use; a small square ball; a single
horizontal playfield line; a two-digit score band at the top; **no border maze**.

**inferred:** the field band here decomposes into a single loop with **zero `run` row
groups**. This is the concrete case behind the row-group generalisation in the step-3
design — a band is a sequence of `(kernel, line count)` pairs, and `[wall][field][wall]`
is Combat's shape, not a structural fact. Also the first genre that needs the ball object
(`ENABL`/`RESBL`), which tank-arena never uses.

**unknown:** whether paddle input (timing a capacitor charge through `INPT0`-`INPT3`) fits
the VBLANK budget alongside ball physics. SPEC §3 defers paddles from phase 1 for exactly
this reason.

### 3. Vertically scrolling asymmetric terrain — `River Raid`, `Canyon Bomber`

**observed** (River Raid): riverbanks that are *not* left-right symmetric and change shape
every few scanlines; terrain that scrolls vertically; several distinct sprites on screen at
once (aircraft, fuel depots, ships); a multi-digit score and a fuel gauge in a band at the
**bottom** of the screen.

**inferred:** the playfield is rewritten per line, so `CTRLPF` reflect is off and all three
`PF` registers are reloaded inside the loop — which consumes most of the line budget and is
why the sprites are sparse. This is the genre that most stresses the "static playfield
within the band" applicability condition, and the reason increment 4b's `scroll-field`
fixture exists.

**Correction it forces to my own assumption:** the HUD band is at the **bottom**, not the
top. The step-3 design's ledger example puts the HUD first, and the row-group model handles
either order — but nothing in the design should be read as requiring a HUD-first layout.

### 4. One object multiplexed across a row — `Space Invaders`, `Demon Attack`, `Berserk`

**observed:** many more enemies on screen than the two player objects the hardware has,
arranged in rows.

**inferred:** `NUSIZ` copies for the formation, and/or mid-line repositioning. Copies share
graphics, so every enemy in a copied group renders the same bitmap — which SPEC §5.2's
strategy table already states, and which is why identity-dependent collision falls back to
software (§4.3).

Increment 4b's `sprite-formation` fixture targets this.

### 5. Paddle plus a dense falling formation — `Kaboom!`

**observed:** many falling objects and a paddle-controlled catcher.

**inferred:** the densest per-line object budget of anything in this list, and the case most
likely to need a two-line kernel. Named here because if the catalog vocabulary cannot
express it at all, that is worth knowing before the vocabulary is fixed.

## What this means for the catalog

The applicability vocabulary proposed in [SPEC §6.1](SPEC.md) — movable object count,
static-playfield-within-band, maximum sprite height, supported strategies — was derived
from one kernel. Against this list it already looks incomplete in three places:

| Gap | Which genre exposes it |
|---|---|
| "Static playfield" is a boolean; the real axis is closer to **PF writes per line** | River Raid (3) |
| No way to say a band uses the **ball** object | Video Olympics (2) |
| No way to express **multiplex separation** or per-line reload budget | Space Invaders (4) |

These are hypotheses, not conclusions. Increment 4b builds one fixture per shape and
measures what each actually needs; the vocabulary is revised against those measurements
before the catalog interface is committed in increment 5.

## Titles referenced

1977 launch era: Air-Sea Battle, Basic Math, Combat, Indy 500, Star Ship, Street Racer,
Surround, Video Olympics. Other early titles: Basketball, Breakout, Canyon Bomber, Outlaw,
Slot Racers. Later: Berserk, Demon Attack, Kaboom!, Pitfall!, River Raid, Space Invaders.

All are third-party commercial works, referenced here for study only. None of their code,
ROMs, or artwork is in this repository.
