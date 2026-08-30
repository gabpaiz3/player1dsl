# Kernel measurements

What three diagnostic ROMs measured, and what those numbers force on the template catalog's
vocabulary.

## Why this document exists

Before this increment, every cost in the catalog had been measured against exactly one
kernel: `examples/tank-arena/reference/tank-arena.asm`. A vocabulary fitted to one data point
describes that data point. It cannot tell which of its fields are properties of the class of
kernels and which are properties of the one kernel that happened to be measured.

So three more shapes were measured first, and the vocabulary chosen afterwards. This is the
roadmap's core ordering argument, and it is why
[review 0.2 §2.3](spec-review-0.2.md)'s catalog fields were deliberately deferred until now
rather than adopted when the review was read — see [What the review asked for](#what-review-02-23-asked-for) below.

## Method

Each fixture is a complete ROM in `tests/fixtures/kernels/`, assembled by **our** assembler
and run in **our** emulator, so CI still needs nothing but Node. Each states in its header
the QUESTION it answers and a PREDICTION written down *before* the run. Numbers were read
out of a TIA write trace with `npx tsx tools/dump-trace.ts <name>`, and only then written
into an assertion.

Every fixture builds its regions from counted WSYNCs, per the semantics `wsync-only.asm`
established and Stella confirmed: N executions of `sta WSYNC` produce exactly N scanlines,
and the setup code preceding a loop shares the line that loop's first WSYNC ends.

## Results

| Fixture | Quantity | Predicted | Measured | Verdict |
|---|---|---|---|---|
| `scroll-field` | entry cost, playfield set once before the loop | 0 | **0** | matched |
| `scroll-field` | entry cost, PF1/PF2 written at the top of each pass | 1 | **1** | matched |
| `scroll-field` | entry cost, second region change after a loop exit | 0 | **0** | matched |
| `ball-and-paddles` | band boundary cost at n = 3 | 7 | **7** | matched |
| `tank-arena` | band boundary cost at n = 2 | 5 | **5** | matched |
| `sprite-formation` | extra scanlines for three NUSIZ copies | 0 | **0** | matched |
| `sprite-formation` | extra TIA objects for three NUSIZ copies | 0 | **0** | matched |
| `sprite-formation` | lines rendered by an 8-entry sprite table | 8 | **7** | **contradicted** |
| `tank-arena` | entry line charged to the score band | 0 | **0, but present** | **qualified** |

Trace evidence for each row lives in the test comments in
`packages/emulator/test/kernel-fixtures.test.ts`, next to the assertion it justifies.

## Contradictions

One prediction was wrong, and one *measurement method* was wrong. Both are recorded here
rather than quietly fixed, because a plan that only records its successes is not measuring
anything.

### An 8-entry sprite table renders 7 lines

`sprite-formation` was written to ask whether NUSIZ copies are free. The row-span assertion
was going to be `toBe(8)` — one line per table entry, which is the obvious answer and the
wrong one. The loop primes one line ahead, so its final write lands in the *next* line's
horizontal blank and is overwritten there before it can render.

This is not a defect in the fixture. It is the entry-cost-1 shape showing up a third time,
and it is the most useful result in this document: the corrected entry-cost rule has now
been measured on **PF1/PF2** (`scroll-field`), on **GRP0** (`sprite-formation`), and on
**GRP0/GRP1** (tank-arena's own field kernel). One observation has become a rule.

The measurement takes the **last** write to a register on each line, rather than counting
writes, so the overwritten line falls out of the arithmetic instead of needing a special
case. Counting writes gives 8 and would have been wrong in a way that looked right.

### The obvious way to measure a band boundary is off by one

The first prescribed extraction for `ball-and-paddles` was min..max over the `RESP0`,
`RESP1`, `RESBL` and `HMOVE` writes in the visible region. **That gives 6, not 7.**

Each `PosObjectX` call is `WSYNC / ... / RESPx / WSYNC / HMOVE`, so the *first* of its two
lines carries no traced write at all. The missing line is at the **front**, where nothing
looks for it. Six would have read as falsifying `2n + 1`, when what was actually wrong was
the extraction — and the same error gives 4 instead of 5 on tank-arena, so it would have
looked *consistent*, which is worse than looking wrong.

The boundary is measured instead as the **gap between the bands**:
`firstLineOfNextBand − lastLineOfPreviousBand − 1`. `ball-and-paddles` writes `COLUBK` on
each band's first line so the trace can tell them apart; without those marks nothing
distinguishes a top-band line from a bottom-band line, because both bands emit only WSYNCs.

The wrong extraction is now itself an assertion (`expect(last - first + 1).toBe(6)`), so
nobody reintroduces it believing it agrees with the right one.

### An entry line can hide inside an authored height

Measured while building the catalog's `applies` fields, not by a fixture -- read straight out
of `tests/goldens/tank-arena.trace` frame 0.

`bcd-score-band` has the SAME loop shape as the field kernel. `.hudDigit` is
`sta WSYNC / lda (digit0Ptr),y / sta GRP0 / ...`, so the line its setup runs on renders the
previous region's content, exactly as `.scroll` and `.openField` do. The trace shows the HUD
band as **3 blank lines (40-42), 8 glyph rows (43-50), 1 blank line (51)**.

The reference kernel's own comment says `2 + 8 + 2 = HUD_LINES`. It is off by one in each
direction: the priming line at 42 is counted as a glyph line and the trailing blank is
counted twice. Both errors cancel, the band is 12 lines, and the frame total is right -- which
is the defect class step 2 found in this same kernel, and the reason the ledger gates on the
sum rather than on the author's arithmetic.

**So `entryLines` does not follow from the loop shape.** The score band has the priming shape
and costs **0**, because its entry line falls *inside* the authored height rather than being
charged on top of it. The field's entry line falls *outside* the band's height and is charged.

This is why `perLineData` is a property of the ENTRY describing its loop shape, and
`entryLines` stays a separately measured number per entry. Deriving one from the other would
have given the score band an entry line it does not have, a 193-line frame, and a build that
fails on a scene that works.

## What each result forces on the vocabulary

### Entry cost is a property of the loop shape, not of the register

The step-3 design originally claimed *"a region change immediately following a loop exit
costs one line, because the loop falls through mid-line and leaves no horizontal blank."*
`scroll-field` contains two region changes following a loop exit and they cost **1 and 0**,
so the general rule is dead. `tank-arena` already contained the same pair.

The discriminator is where a loop writes its per-line registers:

- **top of each iteration → 1.** The first pass needs data that does not exist yet, so the
  loop renders `entry+1 … entry+N`.
- **once, before the loop → 0.** The registers are valid from that same line, so the loop
  renders `entry … entry+N-1`.

Measured on three different registers. **The catalog needs one boolean per entry** — call it
`perLineData` — and `entryLines` follows from it. It does **not** need a per-register table.

### `repositionLines` is linear in n

Measured at n = 3 (7) and n = 2 (5). Two points make `2n + 1` a rule rather than a
coincidence fitted to one kernel. The `+1` is the HMOVE comb and is constant; it is the part
that would have shown up wrong first had the cost been linear in `n` alone.

**The catalog needs nothing for this.** It is a property of the positioning routine the
runtime emits, and the compiler derives only `n`.

### `copies` is one field with two values, and only one of them is measured

NUSIZ hardware copies cost zero lines and zero objects. Mid-line `RESPx` multiplexing —
the other way to draw a formation — was **not measured**, so its cost is **unknown**.

**The catalog needs a `copies` field distinguishing `hardware-nusiz` from `repositioned`,
and the second value must carry its cost as unmeasured rather than absent.** A cost recorded
as unknown is a fact the selector can refuse to spend; a cost omitted becomes an assumed
zero it will happily spend.

## Vocabulary for increment 5

The exact fields the catalog may carry, and the measurement justifying each. **Task 10 must
not invent a field this section does not justify.** If a field seems obviously needed and is
not here, the measurement is missing — add the measurement, or leave the field out.

| Field | Type | Justified by |
|---|---|---|
| `id` | string | identity; nothing to measure |
| `summary` | string | the selector's diagnostic must name what it rejected |
| `cost.entryLines` | number | `scroll-field`, `sprite-formation`, tank-arena — three registers |
| `cost.exitLines` | number | `scroll-field`'s bottom band: measured 0, and 0 is a measurement |
| `applies.objects` | number | `bindObjects` must know how many the entry claims |
| `applies.kinds` | `RowGroupKind[]` | structural vocabulary, no measured cost. Needed because `objects` and `perLineData` do NOT separate the HUD from the field -- both bind 2 objects and both prime a line ahead |
| `perLineData` | boolean | the loop-shape fact, measured above. On the ENTRY, not in `applies`: a region cannot request it, and the score band shows `entryLines` does not follow from it |
| `applies.copies` | `'none' \| 'hardware-nusiz' \| 'repositioned'` | `sprite-formation`; `repositioned` carries an unmeasured cost |
| `writes[].register` | number | needed for the emitter/catalog agreement test |
| `writes[].timing` | `'exact' \| 'blank' \| 'deadline'` | hardware fact; asserted against the emulator's table |

Everything else waits for a measurement.

## What review 0.2 §2.3 asked for

The review asked that the three genre-survey gaps become **required** catalog fields
immediately. Now that the measurements exist, each is decided on the evidence:

| Review's proposed field | Decision | Reason |
|---|---|---|
| playfield update rate and asymmetry/scroll support | **adopted, narrowed** to `perLineData` | `scroll-field` measured a per-line playfield loop and found its cost identical to a per-line sprite loop. The axis that matters is *whether* per-line data is rewritten, not *which register* or *at what rate* — a rate field would carry no information any measurement has produced. |
| P0/P1/M0/M1/ball ownership and coupling | **adopted as `applies.objects`** (a count), not ownership | `ball-and-paddles` positioned the ball with the same routine and the same per-object cost as a player: `HMP0,x`/`RESP0,x` with x = 4. Nothing measured distinguishes ball cost from player cost, so a per-object-type ownership model would encode a distinction the hardware did not show. Revisit when a fixture measures one. |
| multiplex separation and per-line reload budget | **deferred, and recorded as unmeasured** | `sprite-formation` deliberately measured only the NUSIZ path. Adding separation and reload-budget fields now would mean inventing their values, and an invented cost is worse than an absent one because the selector cannot tell the difference. `copies: 'repositioned'` marks the hole. |
| score/HUD location and transition cost | **already covered** | the transition cost is `repositionLines(n)`, derived per boundary from the bindings, and measured at two values of n. A per-entry field would duplicate it and could disagree with it. |
| collision identity preserved / degraded / unavailable | **out of scope** | collisions are plan 4. No fixture here measured one. |

Two adopted, one narrowed by evidence, one deferred with the hole marked, one already
covered, one out of scope. Deferring is a legitimate answer; deferring silently is not.

## Where a movement bound comes from

Plan 4's Task 1: measure before spending. `within field` has to lower to four constants, and
the reference kernel already carries four. The question is whether those four are DERIVED
from the arena's geometry -- in which case the compiler computes them -- or hand-chosen, in
which case it must not pretend otherwise.

### Method

`tools/probe-bounds.ts` (throwaway, not committed) holds one joystick direction on the
reference ROM for 200 frames and reads the resting `tank0X`/`tank0Y` out of RIOT RAM, plus
the `RESP0` colour clock and `HMP0` value the trace records for that frame. Two hundred
frames is far more than the 137 a full traverse needs, so a resting value is a clamp rather
than a snapshot mid-travel.

### Predicted, from geometry

The arena is a `border` playfield of one PF0 block: PF0 D4 alone, `$10`, which is 4 screen
pixels, mirrored under REF to pixels 156-159. The sprite is 8x8. The ledger renders the field
loop on frame lines 66-223.

The loop counts DOWN and primes one line ahead, so a sprite whose top row is computed at
counter N appears on line N-1; reading `emitLoop` gives the first rendered line as
`fieldFirstLine + (lines + 1) - y`, which is `fieldLastLine + 2 - y` = `225 - y`. That
constant is DERIVED here rather than measured, from the emitter's own text.

| Bound | Derivation | Predicted |
|---|---|---|
| `xMin` | sprite's left column clears the left wall: `wallPixels` | **4** |
| `xMax` | right column clears the mirrored wall: `160 - wallPixels - spriteWidth` | **148** |
| `yMax` | top row lands on the field's first line: `counterOrigin - fieldFirstLine` | **159** |
| `yMin` | bottom row lands on its last: `counterOrigin - fieldLastLine + spriteHeight - 1` | **9** |

### Measured, from the reference ROM

| Held | Rests at | `RESP0` clock | `HMP0` | Constant it clamps against |
|---|---|---|---|---|
| left | `tank0X` = **7** | 60 | `$F0` | `X_MIN` 8 |
| right | `tank0X` = **144** | 195 | `$D0` | `X_MAX` 144 |
| down | `tank0Y` = **11** | 90 | `$C0` | `Y_MIN` 12 |
| up | `tank0Y` = **155** | 90 | `$C0` | `Y_MAX` 155 |

A resting value is not the constant. The clamp is **asymmetric**, and reading the source says
why: a lower bound is `cpx #MIN / bcc skip`, which skips only when ALREADY below, so the
tank decrements off the constant and rests one below it. An upper bound is `cpx #MAX / bcs
skip`, which skips at or above, so the tank rests exactly on it.
`packages/emulator/test/tank-arena-behaviour.test.ts` pins both.

### Verdict: hand-chosen, and the compiler derives tight instead

| | left | right | bottom | top |
|---|---|---|---|---|
| tight | 4 | 148 | 9 | 159 |
| reference | 8 | 144 | 12 | 155 |
| margin | 4 | 4 | 3 | 4 |

The margins are **not uniform** -- 3 at the bottom, 4 everywhere else -- so no single rule in
the band extent, the border thickness and the sprite size reproduces all four. Task 1's stated
criterion therefore selects its second branch: `movementBounds` derives the **tight** bound,
the sprite may not overlap the wall, and the reference's extra margin is recorded here as a
hand-chosen value the compiler does not reproduce.

Two consequences, both deliberate:

- **The asymmetry belongs to lowering, not to the numbers.** `movementBounds` returns the four
  constants; the `cpx / bcc` shape that makes a lower bound rest one below is what `rules.ts`
  emits. Baking the off-by-one into the constants would give four numbers whose meaning
  depended on which side of the axis they sat on.
- **A compiled ROM will clamp 3-4 pixels wider than the reference.** Nothing observes that
  today -- the committed input script visits `tank0X` 32..73 and `tank0Y` 87..128, so no
  clamp fires in any of the 90 golden frames. It will be observable the moment plan 4's
  Task 8 replaces the script with one that reaches a bound, and at that point the divergence
  is a KNOWN one with a reason, not a mystery.

### Not measured: whether `x` is exactly the sprite's leftmost screen pixel

`PosObjectX` divides by 15 and strobes `RESPx` at the beam, and a `RESPx` strobe takes effect
some clocks after the write. Whether the sprite's leftmost column lands on screen pixel `x`
or on `x + k` for a small fixed `k` is **not** something this repo can measure: our TIA model
does not render pixels and does not track object positions at all
(`packages/emulator/src/tia.ts` returns 0 for every read). The tight bounds above assume
`k = 0`.

This does not change the verdict -- the reference's margins are non-uniform for any `k`,
because a constant offset shifts both horizontal bounds the same way and neither vertical one.
It does mean `xMin`/`xMax` could be off by a fixed amount in the picture, which is exactly the
class of defect [What is still unmeasured](#what-is-still-unmeasured) records as needing a
second implementation or a human eye.

## What is still unmeasured

Carried forward. Nothing in this list may be treated as zero.

- **Mid-line `RESPx` multiplexing.** Separation, reload budget, exact-clock requirements.
  Marked in the catalog as `copies: 'repositioned'`.
- **The HMOVE comb's visual extent.** Our TIA model does not render the 8-pixel blank the
  comb puts on the following line; the `+1` in `2n + 1` is measured as a *line cost*, which
  is what the ledger needs, but the picture is unverified. Stella is the check.
- **`DEFAULT_STACK_RESERVED`.** Still a guess, still labelled as one in
  `packages/compiler/src/ram.ts`. The deepest call chain only exists once rule lowering does.
- **The 6532 timer's T.** `timing-fixtures.test.ts` still marks it PENDING a Stella reading.
  This is why the frame driver in increment 5b uses counted WSYNCs rather than `TIM64T`.
- **Strobes inside horizontal blank.** The golden format stores the pixel, so the comparator's
  new `exact` rule compares two RESPx strobes at different clocks inside blank as equal -- both
  are pixel -1. Coarse positioning happens in the visible region, so nothing in this repo hits
  it, but whether an in-blank clock difference moves an object is untested. Recording the
  colour clock in the golden format is the fix, and it changes the file format.
- **Per-object cost differences.** Ball, missile and player all cost 2 lines through
  `PosObjectX`; no fixture has tried to make them differ.
- **Our TIA model's systematic errors.** Increment 5b's static build reproduces golden frame 0's
  visible region record for record -- but the golden was recorded from *this* emulator, so an
  error shared by the model and the golden (playfield bit order, REF mirroring, sprite column
  placement) is inherited by both sides and compares equal. Record equality cannot see it; only
  a second implementation or a human eye can. That is the reason `docs/testing.md` calls a
  Stella run a compatibility check rather than a formality, and `scripts/stella.sh` exists.
