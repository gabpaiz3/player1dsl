# tank-arena reference kernel — measured costs

This file is the point of the whole exercise. Every row marked **derived** is
arithmetic I reasoned out; every row marked **measured** was observed running.
The Player1DSL compiler will eventually claim numbers like these in diagnostics,
and [the spec review](../../../docs/spec-review-0.1.md) §1.1 argues those claims
are only trustworthy if they are measured against a real machine model.

Nothing here is measured yet. Increments 1–3 are built and assemble clean;
verification is the pending Stella run.

## Status

| Increment | Built | Verified |
|---|---|---|
| 1 — stable 262-line frame | yes | **pending — needs the Alt+L scanline count** |
| 2 — mirrored playfield arena | yes | confirmed by capture ✓ |
| 3 — two tanks via RESPx/HMOVE | yes | confirmed by capture ✓ |
| 4 — score band | not started | — |
| 5 — projectiles and collisions | not started | — |

Increments 4 and 5 are deliberately not started: increment 4's deliverable is a
*measurement* of the band-transition cost that feeds back into SPEC.md §4.4, and
measuring it on an unverified foundation would put a wrong number into the spec.

## How to verify

```sh
sh examples/tank-arena/reference/build.sh
"C:/Users/gabpa/tools/stella/Stella-7.0c/Stella.exe" build/tank-arena.bin
```

Press **Alt+L** in Stella for the frame-stats overlay.

## Measurements to capture

### Frame timing (increment 1) — answers review §3.2

| Quantity | Derived | Measured (Stella 7.0c) |
|---|---|---|
| VBLANK timer constant (`TIM64T`) | `#43` → 2752 cyc | **`#43` gave 261 — corrected to `#44`** |
| Overscan timer constant (`TIM64T`) | `#35` → 2240 cyc | unchanged |
| Total scanlines per frame | 262 | **261** with `#43`; re-measure pending with `#44` |
| Scanline count stable frame to frame | yes | **yes — steady 261, no jitter** ✓ |
| Display format auto-detected | NTSC | `NTSC*` ✓ |
| Bankswitch type / size | 4K unbanked | `4K* (4K)` ✓ |

**The derivation was wrong, and this is why increment 1 exists.** The arithmetic
predicted 262 from `#43`; the machine produced 261.

Cause: writing `TIM64T` does not start a clean 64-cycle interval. The internal
prescaler may already be partway through one, so up to 63 cycles are lost. The
nominal expiry points sit this far into their target line:

| Section | Constant | Cycles | Margin into target line |
|---|---|---|---|
| VBLANK | `#43` | 2752 | **16 cycles** — does not survive prescaler loss |
| Overscan | `#35` | 2240 | 36 cycles — survives |

So VBLANK fell back into line 36 and overscan held at 30. `#44` (2816 cycles)
restores the margin.

That the count was *steady* at 261 rather than fluctuating is the important
detail: the prescaler offset is deterministic for a fixed code path, so this is
a constant to correct, not jitter to chase.

**Implication for the compiler.** A cycle model that computes timer constants
from arithmetic alone will be off by a scanline in exactly this way. The planner
must either model the prescaler write penalty or — better, per review §1.1 —
have its constants verified against a real machine model. This is the first
concrete instance of the honesty problem the review is about.

### Positioning cost (increment 3) — answers review §3.3

| Quantity | Derived | Measured (screen capture, 2026-08-16) |
|---|---|---|
| Scanlines per `PosObjectX` call | 2 | |
| VBLANK lines consumed by positioning both tanks | 4 of 37 | |
| VBLANK lines still free for game logic | 33 | |
| HMOVE blank bar visible on screen | no — strobed during VBLANK | **none visible** ✓ |
| Tank 0 lands at x ≈ 40 | 40 | ~44 |
| Tank 1 lands at x ≈ 110 | 110 | ~110 ✓ |

Measurements are scaled off a screen capture, so treat them as ±3 pixels rather
than exact. Both tanks land within a few pixels of target.

**Resolved:** the canonical positioning routine is sometimes written with
`sta.wx HMP0,x`, forcing absolute,X addressing (5 cycles) where plain
`sta HMP0,x` assembles to zero-page,X (4 cycles) — one cycle, three colour
clocks of beam travel. This kernel uses the plain form, and it places objects
correctly. **The plain form is right; no `.wx` needed.**

### Arena geometry (increment 2) — confirmed

| Quantity | Derived | Measured |
|---|---|---|
| Side wall width | 4 px (`PF0 = $10`, one block) | ~4 px ✓ |
| Top wall height | 8 scanlines | ~8 ✓ |
| Right wall mirrors left | yes (`CTRLPF` D0 = REF) | symmetric ✓ |

Confirms `mode mirror` / `mode reflect` are one CTRLPF bit, and that writing the
playfield once per region costs nothing per line.

### Vertical placement (increment 3) — confirmed

Counter value `C` displays on line `184 - C` (top wall 8 + counter running
176→1).

| Tank | `tankY` | Predicted line | Measured |
|---|---|---|---|
| Red | 120 | 64 | ~63 ✓ |
| Blue | 60 | 124 | ~126 ✓ |

Red above blue confirms the counter inversion. Blue's ~2-line variance is within
capture error and consistent with the documented one-line compute-ahead offset.

### Visible kernel budget (increments 2–3)

| Quantity | Derived | Measured |
|---|---|---|
| Cycles per visible line, worst case | ~73 of 76 | |
| Cycles per line spent on playfield | 0 — written once per region | |
| Free cycles per line | ~3 | |

~3 cycles of headroom is below the 8-cycle warning threshold SPEC.md §5 proposes
for tight-but-valid code. If that survives measurement it is a useful early data
point: a two-player kernel with a static playfield already sits near the limit,
which constrains what increment 4's score band can afford.

## Resolved: white sliver at bottom right — band transitions need a WSYNC

**Symptom.** A ~16-pixel white block at the far right, on one line at the bottom
of the open field. Survived the `#44` timer correction, proving it independent
of frame timing.

**Root cause.** The `openField` loop falls through roughly 55 cycles into a
scanline. A loop exit leaves no horizontal blank, so the bottom-wall transition
writes landed in the *visible* part of that line:

| Write | Cycle | Colour clock | Visible pixel |
|---|---|---|---|
| `sta PF0` | 68 | 204 | **136** |
| `sta PF1` | 73 | 219 | 151 |
| `sta PF2` | 76 | 228 | line end |

Under `CTRLPF` REF the mirrored right half is laid out PF2 (80–111), PF1
(112–143), **PF0 (144–159)**. So `PF0 = $F0` arriving at pixel 136 turned pixels
144–159 white for exactly one line.

The `topWall → openField` transition was correct only by accident: it runs
immediately after a `WSYNC`, so its writes already landed in blank.

**Fix.** `sta WSYNC` before the transition writes.

**This is the finding that generalises.** Every band boundary the compiler emits
has this hazard, and it is invisible in the source — the writes look identical to
the ones that work. A band transition must be scheduled into horizontal blank,
which means the planner has to know where in the line the preceding region's
code leaves the beam. SPEC.md §4.4's band model has no concept of this; it treats
a band boundary as a line number. That is a stronger version of review §3.4:
band transitions do not merely cost scanlines, they impose a *phase* constraint.

### Line-count cost, resolved empirically

Fixing the sliver perturbed the frame, and the measurements settled it faster
than the cycle arithmetic did:

| Version | `openField` count | Extra `WSYNC` | Total scanlines | Sliver |
|---|---|---|---|---|
| A | 176 | no | 262 | present |
| B | 175 | yes | 261 | gone |
| C | 176 | yes | *expected 262* | *expected gone* |

A→B netted −1 across two changes, so the added `WSYNC` contributed **zero** lines
and the removed iteration contributed **−1**. The `WSYNC` costs nothing because in
version A the transition code already overran the line boundary naturally; the
`WSYNC` only replaces that overrun with a controlled one.

Version C is the current build. Third correction where measurement beat
derivation — the running argument for review §1.1.

## Known deviations the compiler must reproduce

- **One-line sprite display offset.** Sprite bytes are computed one line ahead so
  both `GRP0`/`GRP1` writes land inside horizontal blank. As a result `tank0Y` /
  `tank1Y` name the counter value at which a row is *computed*, and the row is
  *displayed* on the following line — the visible top row sits at `tankY - 1`.
  This is deterministic, not a bug, but step 3's compiler must reproduce it
  exactly or trace comparison against this reference will disagree by one line.

## ANSWERED — §3.4: a band transition costs 5 visible scanlines

**SPEC.md §4.4's example band layout does not fit on the machine.** Its bands are
12 + 168 + 12 = exactly 192, leaving nothing for the boundaries between them.

Measured cost of a single HUD → field boundary:

| Component | Scanlines | Why |
|---|---|---|
| Reposition P0 | 2 | `PosObjectX`: one line to place, one to `HMOVE` |
| Reposition P1 | 2 | same |
| Absorb the HMOVE comb | 1 | see below |
| **Total** | **5** | against SPEC.md's implicit 0 |

The reposition is unavoidable: P0 and P1 are the only movable objects, so the
score digits and the tanks contend for the same two. The band is reused
vertically, which is what forces the boundary work.

**The comb is the part no cycle model would predict.** `HMOVE` extends its
line's horizontal blank by 8 pixels. `PosObjectX` ends `sta WSYNC / sta HMOVE /
rts`, so the second call strobes `HMOVE` at the start of the line the wall setup
runs on — putting an 8-pixel black notch down the left of the first white wall
line. Confirmed visually, measured at 8 pixels wide.

It cannot be suppressed, only *placed*. Spending one more scanline drops it onto
a line where the playfield is still 0 from the HUD band: black comb on black
background, invisible.

**Implication for the compiler.** Band transition cost is not a constant. It
depends on how many objects change position, and on whether a line exists whose
background can hide the comb. A planner that models a band boundary as a line
number — which is all SPEC.md §4.4 offers — cannot compute this. It needs to know
which objects cross the boundary, where the beam sits when the previous region
exits, and what colour the absorbing line will be.

## Write ordering is a compiler obligation

Three separate defects in this kernel had one root cause: **a loop exit leaves no
horizontal blank**, so register writes following it land in the visible region.

| Site | Landed at | Symptom |
|---|---|---|
| `openField` → bottom wall | `PF0` at pixel 136 | white sliver, bottom right |
| glyph loop → `GRP` clear | `GRP0` at pixel 13 | score row 7 missing |
| transition → top wall | `PF0` at pixel 4 | black notch, top left |

Only one boundary in the kernel was ever correct — `topWall → openField` — and
only by accident, because it happens to follow a `WSYNC`.

Where a `WSYNC` is too expensive, the writes must be **ordered by deadline**: the
pixel at which each register is first read. `PF0` is read at pixel 0, `PF1` at 16,
`PF2` at 48; `COLUP0`/`COLUP1` are not read at all on a line with no players. A
code generator emitting band transitions has to sort by that and prove the tail
fits inside blank. Nothing in SPEC.md expresses it.

## Still open for increment 5
- **§3.6 — collision identity.** Which of the 15 latch pairs are usable directly,
  and which interactions need a software check because the latch cannot say
  *which* logical actor was involved.
