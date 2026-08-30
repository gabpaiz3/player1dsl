# TIA Object Model and Collision Latches — Design

**Date:** 2026-08-29
**Increment:** 5c, between plan 3's static build and plan 4's rule lowering.
**Status:** approved, not yet implemented.

## Why this exists

`packages/emulator/src/tia.ts` returns `0` from **every** register read, with a comment saying
collision and input registers are not modelled. So `CXPPMM` never sets, in either ROM.

Plan 4's increment 6 implements `when tank0 hits tank1` and the `hitFlag` debounce, and its
own file structure names `packages/emulator/test/rules-behaviour.test.ts` as the test that
covers them "against both ROMs". That test cannot be written. The mechanism plan 4 names for
covering collision does not exist, and the design's correction of 2026-08-29 —
*"collision and the `hitFlag` debounce are covered nowhere at all"* — understates it: they
cannot be covered by anything in this repository as it stands.

This increment builds the missing mechanism, and it is deliberately placed **before**
increment 6 so that rule lowering arrives with a verification path already in front of it
rather than needing one built mid-task.

## What is in scope

All six things the TIA draws — P0, P1, M0, M1, the ball, and the playfield — tracked at
colour-clock resolution, and all eight collision registers with their fifteen latch bits.

**Not** colour, and not a framebuffer. The presence mask this increment builds is the seam a
framebuffer plugs into: mapping a mask to a colour needs priority resolution and the `COLUPx`
registers and nothing else. That is left for a later increment, and the seam is left in
place deliberately rather than discovered later.

Modelling only P0/P1 was considered and rejected. Missiles and the ball are *cheaper* than
players — an enable bit and a width, no graphics byte — so the step up is small, and stopping
at players would leave thirteen of the fifteen latch bits still returning a lie.

## Part 0 — a bus access lands on the cycle it happens

**This is a prerequisite, and it is a correction to existing behaviour rather than an
addition.**

### Measured

A probe ROM executing three consecutive `sta COLUBK` immediately after `sta WSYNC`:

| write | recorded clock | true clock |
|---|---|---|
| 1st `sta COLUBK` | 0 | 6 |
| 2nd | 9 | 15 |
| 3rd | 18 | 24 |

`Machine.runFrame` runs `cpu.step()` to completion and only then calls `tia.tick(cycles * 3)`,
so `onWrite` observes the beam at **instruction start**. A 6502 `sta zp` writes on its third
cycle. Every TIA write in this repository is therefore recorded, and applied, one instruction
early.

### Why it blocks collisions

An object's horizontal position is set by the beam position at the `RESPx` strobe. Recording
that strobe 9 colour clocks early (a `sta RESPx,x` is 4 cycles, so 3 cycles = 9 clocks before
its write) puts every object 9 pixels from where the hardware puts it.

For `CXPPMM`'s P0–P1 bit alone the error would cancel: both tanks are positioned by the same
routine with the same instruction sequence, so a uniform offset does not change their
*relative* position. It does not cancel against the playfield, whose displayed position is
fixed by the beam and not by when `PF0` was written. Since this increment models all six
objects, the error has to go.

### The change

`Cpu` advances the bus to `cycles - 1` before each access; `Machine` ticks the remainder after
the step. One rule:

> A bus access lands on the instruction's final cycle.

True for `lda`, `sta`, `bit` and their indexed forms, which is every access any ROM in this
repository makes to the TIA. The documented exception is a read-modify-write's **read**, two
cycles earlier than its write; no ROM here reads a TIA register with `inc`, and the exception
is recorded rather than handled.

### Blast radius, accepted before starting

- **`tests/goldens/tank-arena.trace` regenerates.** Every `clock` and `pixel` it records
  shifts. Plan 4 schedules a regeneration anyway.
- **The hoist argument has to be recomputed and may not survive.** Increment 5b hoists the
  field's colour writes onto the previous row group's setup line, and the reason given is
  measured: *"the reference already fills that line's blank to colour clock 66 of 68"*. That
  66 was read off instruction-start timing. Recomputed, the write lands later, and the
  argument either strengthens (the write is even closer to the deadline) or breaks (it was
  already past it, and something else explains the reference's placement). Either outcome is
  a finding and goes in the session log.
- **Documented pixel numbers go stale.** `docs/kernel-measurements.md` and the session logs
  quote specific pixels — GRP0 at pixel 1 and 10, `COLUP1` at colour clock 66. Each has to be
  re-measured or marked as pre-correction.

Nothing here is tuned to make a number come out. The correction is applied first and whatever
it produces is recorded.

## Part 1 — `packages/emulator/src/objects.ts`

The five movable objects and the playfield, as data plus one query.

```ts
/** Which objects are present at one pixel, as a bit per object. */
export const enum Present {
  P0 = 1, P1 = 2, M0 = 4, M1 = 8, BL = 16, PF = 32,
}
```

State per movable object: a start position in `0..159`, a horizontal-motion nibble, and the
object's own graphics — `GRP0/1` for players, `ENAM0/1` for missiles, `ENABL` for the ball.
Shared shape registers: `NUSIZ0/1` (player width and copy count, missile width), `REFP0/1`
(mirror), `VDELP0/1` (vertical delay and its shadow register), `CTRLPF` (`REF`, `SCORE`,
`PFP`, ball size).

**Positioning offsets are parameters, not constants.** Where a `RESPx` strobe at colour clock
`c` puts an object's first pixel is exactly the quantity this repository has never measured —
`packages/runtime/src/bounds.ts` currently assumes it is zero, and says so. The offsets live
in one named table, initialised from a documented reference, and Part 3 measures them. If the
measurement disagrees with the reference the measurement wins, and the disagreement is a
finding.

## Part 2 — `tia.ts` grows a presence mask

`Tia` gains an `Objects` and decodes the ~30 write registers it currently drops on the floor.

`tick(n)` fills a 160-entry `Uint8Array` for the pixels those `n` clocks covered, using the
object state as it stands. That is naturally event-driven and needs no event list: object
state changes only on a write, and Part 0 puts every write between two ticks. At the end of a
line the fifteen latch bits are OR'd out of the mask and the mask is cleared.

`read()` serves `CXM0P`, `CXM1P`, `CXP0FB`, `CXP1FB`, `CXM0FB`, `CXM1FB`, `CXBLPF` and
`CXPPMM` from the latches. `CXCLR` clears them. Input registers `INPT0`-`INPT5` stay
unmodelled and keep returning 0 — but the comment saying so now names them specifically
instead of covering every read.

Cost: 160 bytes a line, 262 lines, 90 frames — under four million byte writes to regenerate
the whole golden. Measured before choosing this shape over per-object interval intersection,
which is faster and cannot express a mid-line `GRP0` rewrite, which is what a kernel *is*.

## Part 3 — validation, which is the point

A collision model checked only against our own emulator is checked against itself. This is the
defect class `docs/kernel-measurements.md` already records under "Our TIA model's systematic
errors": the golden was recorded from this emulator, so an error shared by the model and the
golden is inherited by both ROMs and compares equal.

So:

**Fixture ROMs**, `tests/fixtures/tia/`, each stating its QUESTION and a PREDICTION written
before the run, in the shape `tests/fixtures/kernels/` established. Each places two players at
a known separation and paints the **background** red when `CXPPMM` sets and black when it does
not. A whole-screen colour flip, chosen deliberately: it survives being read off a screenshot
in a way that measuring a sprite's left edge did not.

**A separation sweep** finds the exact clock at which the latch flips from clear to set.

**That threshold is checked in Stella.** One number, from a second implementation, on the one
quantity everything else here rests on. If Stella and our model disagree about where the flip
happens, our positioning offsets are wrong by the difference, and Part 1's table is corrected
from the measurement.

`docs/kernel-measurements.md` gains the result, and `bounds.ts`'s "assume zero" note either
becomes a measured zero or a measured correction.

## Part 4 — what this unblocks and what it does not

**Unblocks:** increment 6's `when A hits B` lowering, the `hitFlag` debounce, and plan 4's
`rules-behaviour.test.ts`. Also plan 4's Task 8, the input script that has to drive the tanks
into real contact — with a working model, "did they touch" is now a question the emulator can
answer instead of a geometric derivation.

**Does not unblock:** anything needing colour. A wrong playfield bit order, wrong `REF`
mirroring, or a sprite one column off in the *picture* still needs Stella and a human eye.
Presence is not colour. The seam is left where the framebuffer would attach.

## Testing

| Level | What it checks |
|---|---|
| `packages/emulator/test/cycle-timing.test.ts` | Part 0: the three-`sta` probe, asserting 6/15/24 rather than 0/9/18 |
| `packages/emulator/test/objects.test.ts` | Position arithmetic, `NUSIZ` widths and copies, `REFP`, `HMOVE`, in isolation |
| `packages/emulator/test/collision.test.ts` | Latch bits OR'd out of a presence mask, including a known-positive per pair |
| `packages/emulator/test/tia-fixtures.test.ts` | The fixture ROMs, prediction beside measurement |
| Stella | The sweep's flip threshold, by eye |

Every existing test keeps running. `packages/emulator/test/static-build.test.ts` compares two
ROMs against each other, so a uniform timing correction moves both sides and it must still
pass; if it does not, the correction is not uniform and that is a finding.
