# Atari 2600 hardware invariants

Checkable facts for reviewing Player1DSL claims. **If a claim isn't here, verify it against a
cited source and add it — don't approve it from memory.** Items marked ⚠️ are the ones most
often misremembered, including by people who know this machine well.

Primary sources: the Stella Programmer's Guide (TIA registers, timing, object model) and the
6507/6532 data sheets.

## Timing

| Fact | Value |
|---|---|
| Color clocks per scanline | 228 (68 horizontal blank + 160 visible) |
| Color clocks per CPU cycle | 3 |
| CPU cycles per scanline | 76 |
| Visible pixels per line | 160 |
| NTSC frame | 262 lines: 3 VSYNC + 37 VBLANK + 192 visible + 30 overscan |
| PAL frame | 312 lines (deferred in v0.1) |
| `WSYNC` | halts the CPU until the start of the next horizontal blank |

Non-visible CPU time per NTSC frame is roughly (37 + 30) × 76 ≈ 5,092 cycles, minus VSYNC and
minus whatever the frame's own housekeeping costs. This is the budget `every frame` rules
compete for.

## Objects

Five movable objects, total, for the whole screen:

- 2 players (P0, P1) — 8 bits of graphics each, via GRP0/GRP1
- 2 missiles (M0, M1) — 1 bit, width 1/2/4/8
- 1 ball (BL) — 1 bit, width 1/2/4/8

Plus the playfield, which is not movable.

**Playfield:** 20 bits — PF0 (upper 4 bits only), PF1 (8), PF2 (8). Each bit is 4 color clocks
wide, covering the left half of the 160-pixel line. CTRLPF: D0 = REF (reflect the right half),
D1 = SCORE (tint each half from COLUP0/COLUP1), D2 = PFP (playfield draws over players).

## NUSIZ copies ⚠️

`NUSIZ0`/`NUSIZ1` low 3 bits control player copies and size. **Maximum 3 copies per player, at
16, 32, or 64 color-clock separation only.**

| Value | Effect |
|---|---|
| 0 | one copy |
| 1 | two copies, 16 apart |
| 2 | two copies, 32 apart |
| 3 | three copies, 16 apart |
| 4 | two copies, 64 apart |
| 5 | one copy, double width |
| 6 | three copies, 32 apart |
| 7 | one copy, quadruple width |

Consequences: arbitrary spacing is not expressible. Copies share graphics, color, and vertical
extent — they are one object drawn repeatedly, not independent sprites. More than 3 objects in a
row means both players (6 total, consuming every player object) or multiplexing.

Bits 5–4 of NUSIZ set missile width; bits 5–4 of CTRLPF set ball width.

## Horizontal positioning ⚠️

This is where most cycle budgets are actually spent, and where the numbers get garbled.

- An object's horizontal position is set by strobing `RESP0`/`RESP1`/`RESM0`/`RESM1`/`RESBL`,
  which places it at the beam's current position.
- **Coarse granularity is 3 color clocks — one CPU cycle.** Not 15. The commonly cited 15 comes
  from the standard divide-by-15 positioning *loop* (a 5-cycle loop body × 3 color clocks per
  cycle = 15 color clocks per iteration), which is a technique, not a hardware limit.
- Fine adjustment comes from HMP0/HMP1/HMM0/HMM1/HMBL, each offsetting **−8 to +7** color clocks,
  applied when `HMOVE` is strobed.
- `HMOVE` must be strobed at the start of a line (in horizontal blank), and doing so **extends
  the blank by 8 pixels on that line** — the black "HMOVE comb" on the left edge. Any kernel that
  repositions mid-screen pays this visibly.
- `HMCLR` zeroes all five fine-adjust registers.

**Vertical position is not a register.** An object's Y is determined by which scanline the kernel
writes GRPx on. This is a property of kernel structure, not a coordinate that can be set freely.

`VDELP0`/`VDELP1`/`VDELBL` delay an object's graphics update by one line, which is how kernels
update two objects across a write boundary without tearing.

## Collision ⚠️

Fifteen object pairs, latched in hardware, read via bits 7 and 6 of eight read-only registers:
`CXM0P`, `CXM1P`, `CXP0FB`, `CXP1FB`, `CXM0FB`, `CXM1FB`, `CXBLPF`, `CXPPMM`. Strobing `CXCLR`
clears all of them.

Latches are **per TIA object pair, not per logical actor.** If one player object is multiplexed
across twelve aliens, a P0 collision latch reports that *an* alien was hit — never which one.
Any rule needing actor identity requires software collision instead, at software cost.

Latches accumulate across the frame, so the conventional contract is: read after the visible
region, clear during vertical blank.

## Audio

Two independent channels. Per channel:

| Register | Bits | Range | Meaning |
|---|---|---|---|
| AUDC0/1 | 4 | 0–15 | distortion / waveform |
| AUDF0/1 | 5 | 0–31 | frequency **divider** |
| AUDV0/1 | 4 | 0–15 | volume |

⚠️ AUDF is a divider, not a frequency. Reachable pitches are a sparse, non-uniform set — most
Hz values are simply not expressible, and the set differs between NTSC and PAL.

## Color

Color registers COLUP0, COLUP1, COLUPF, COLUBK: bits 7–4 select hue (16), bits 3–1 select
luminance (8), **bit 0 is unused** — 128 colors. Odd values are equivalent to the even value
below them. Hue values are region-specific: the same byte is a different color on PAL.

## Memory and CPU

| Fact | Value |
|---|---|
| RAM | **128 bytes** total (6532 RIOT) |
| Stack | ⚠️ shares that same 128 bytes, growing down from the top |
| 6507 address lines | 13 → 8 KiB address space; 4 KiB cartridge at $F000–$FFFF |
| Decimal mode | **supported** — SED/ADC work, unlike the NES's 2A03. BCD scoring is sound. |
| Interrupts | IRQ/NMI pins not bonded out; the frame loop is polled, not interrupt-driven |

Any RAM budget must reserve stack headroom explicitly. There is no memory protection — a deep
call chain silently overwrites variables.

## RIOT timer

Write an interval to `TIM1T`, `TIM8T`, `TIM64T`, or `T1024T` (the name is the prescaler in CPU
cycles); read `INTIM` to poll remaining time. This is the mechanism that bounds VBLANK and
overscan work — the thing that makes "this fits in non-visible time" enforceable at runtime
rather than merely asserted at compile time.

## Cartridge

4 KiB is the unbanked maximum. F8 (8 KiB, two banks) switches via accesses to $1FF8/$1FF9.
Reset and interrupt vectors live in the top 6 bytes of the addressed bank.
