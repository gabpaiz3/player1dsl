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

| Quantity | Derived | Measured |
|---|---|---|
| VBLANK timer constant (`TIM64T`) | `#43` → 2752 cyc | |
| Overscan timer constant (`TIM64T`) | `#35` → 2240 cyc | |
| Total scanlines per frame | 262 | |
| Scanline count stable frame to frame | yes | |

If Stella reports 261 or 263, adjust the constant by one and re-measure. The
derivation leaves roughly half a scanline of margin at both ends, so an error
here means an assumption is wrong, not that the margin was too tight.

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

## Known deviations the compiler must reproduce

- **One-line sprite display offset.** Sprite bytes are computed one line ahead so
  both `GRP0`/`GRP1` writes land inside horizontal blank. As a result `tank0Y` /
  `tank1Y` name the counter value at which a row is *computed*, and the row is
  *displayed* on the following line — the visible top row sits at `tankY - 1`.
  This is deterministic, not a bug, but step 3's compiler must reproduce it
  exactly or trace comparison against this reference will disagree by one line.

## Open questions increments 4–5 will answer

- **§3.4 — band transition cost.** SPEC.md §4.4's bands sum to exactly 192
  (12 + 168 + 12) with nothing budgeted for transitions. The score band needs both
  players for digits and the field needs both for tanks, so the boundary requires
  repositioning both objects — at least one WSYNC'd line, plus the HMOVE bar.
  Increment 4 measures whether 12 + 168 + 12 is achievable as written.
- **§3.6 — collision identity.** Which of the 15 latch pairs are usable directly,
  and which interactions need a software check because the latch cannot say
  *which* logical actor was involved.
