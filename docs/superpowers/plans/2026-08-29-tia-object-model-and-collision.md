# TIA Object Model and Collision Latches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Status: complete, 2026-08-30.** See [`docs/session-logs/2026-08-30.md`](../../session-logs/2026-08-30.md).
Tasks 4 and 5 were executed in the other order and merged: Stella adjudicated the HMOVE
question first, at the user's direction, because everything else rested on it. The
`collide-players` fixture the plan named was replaced by `double-hmove` and its control, which
answer a sharper question; `collide-playfield` is as planned and is the one that measures
absolute position.

**Goal:** `packages/emulator` tracks all six TIA objects at colour-clock resolution and serves
real values from all eight collision registers, so increment 6's `when tank0 hits tank1` has
something that can falsify it.

**Architecture:** A bus access lands on the instruction's final cycle (a correction, landed
alone first). `objects.ts` holds the five movable objects plus the playfield and answers "which
objects are present at this pixel" as a bitmask. `tia.ts` fills a 160-entry presence mask as the
beam advances, ORs fifteen latch bits out of it at end of line, and serves the `CX*` reads from
them. Positioning offsets are parameters measured by fixture ROMs and checked in Stella, not
constants asserted from a datasheet.

**Tech Stack:** TypeScript ESM with explicit `.ts` import extensions, npm workspaces, vitest,
Biome, `tsc --build`. Node 20+. No runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-08-29-tia-object-model-and-collision-design.md`](../specs/2026-08-29-tia-object-model-and-collision-design.md)
— read all of it. The plan argues from the spec; executors read both.

## Global Constraints

- **NTSC only, 4 KiB unbanked.** 262 scanlines split 3 / 37 / 192 / 30.
- **npm workspaces, never pnpm.** The gate is `npm run check` (lint, typecheck, test), run
  unpiped so its exit code is visible.
- **DASM and Stella are dev-only.** Never runtime or CI dependencies; CI needs nothing but
  Node. DASM writes to `build/reference/`; `p1 build` writes to `build/<name>.bin`.
- **Third-party ROMs, disassemblies and recovered commercial assets never enter the
  repository.**
- **`packages/runtime` owns anything MEASURED; `packages/compiler` owns anything DERIVED.**
  `runtime` must never import from `compiler`, and must not import `packages/emulator` in
  `src` — cross-checks are test-only imports.
- **Derivation loses to measurement.** Do not tune a constant until a number appears. Build a
  fixture that isolates the mechanism and measure it.
- **Every fixture states its QUESTION and a PREDICTION written before the run**, in the shape
  `tests/fixtures/kernels/` established.
- Diagnostic ranges are unchanged; nothing in this increment emits a diagnostic.
- Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- One session log per day at `docs/session-logs/YYYY-MM-DD.md`. Branch
  `step3-plan4-rule-lowering`. Push early — CI runs on every branch push.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/emulator/src/bus.ts` (modify) | Sync the beam before an access that reaches the TIA |
| `packages/emulator/src/cpu.ts` (modify) | Expose the current instruction's cycle count |
| `packages/emulator/src/machine.ts` (modify) | Tick the TIA to the access cycle, then the remainder |
| `packages/emulator/src/objects.ts` (create) | The five movable objects and the playfield; presence at a pixel |
| `packages/emulator/src/tia.ts` (modify) | Decode shape registers, fill the presence mask, latch collisions, serve `CX*` |
| `packages/emulator/src/index.ts` (modify) | Export `Present`, `Objects`, `CX` |
| `packages/emulator/test/write-timing.test.ts` (create) | Task 1: the access lands on the final cycle |
| `packages/emulator/test/objects.test.ts` (create) | Position arithmetic, `NUSIZ`, `REFP`, `HMOVE`, playfield bits |
| `packages/emulator/test/collision.test.ts` (create) | Latch bits, one known-positive per pair |
| `tests/fixtures/tia/collide-players.asm` (create) | P0 against P1, separation swept — RELATIVE |
| `tests/fixtures/tia/collide-playfield.asm` (create) | P0 against one playfield block — ABSOLUTE |
| `packages/emulator/test/tia-fixtures.test.ts` (create) | The two fixtures, prediction beside measurement |
| `tests/goldens/tank-arena.trace` (regenerate) | `npm run golden`, twice: after Task 1 and after Task 6 |
| `docs/kernel-measurements.md` (modify) | The write-timing correction and the two thresholds |

`objects.ts` is separate from `tia.ts` for the same reason `catalog.ts` is separate from
`emit.ts`: one holds state and geometry, the other drives it with a beam. The presence mask
lives in `tia.ts` because only the beam knows which pixels have been passed.

---

## Task 1: A bus access lands on the cycle it happens

**This task lands ALONE.** Nothing from Tasks 2 onward may appear in its commit. When the
golden regenerates, every changed clock must have exactly one possible cause.

**Files:**
- Modify: `packages/emulator/src/cpu.ts` (add a getter beside `private cycles = 0`)
- Modify: `packages/emulator/src/bus.ts` (call a sync hook before TIA accesses)
- Modify: `packages/emulator/src/machine.ts:95-125` (the run loop)
- Create: `packages/emulator/test/write-timing.test.ts`
- Regenerate: `tests/goldens/tank-arena.trace`
- Modify: `docs/kernel-measurements.md`

**Interfaces:**
- Produces: `Cpu.pendingCycles: number` — cycles the instruction currently executing will
  consume, final at every bus access.
- Produces: `Bus.onTiaAccess: (() => void) | undefined` — called immediately before an access
  that decodes to the TIA, and at no other time.

- [x] **Step 1 — write the failing test.** Create `packages/emulator/test/write-timing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assembleSource } from '@player1dsl/assembler';
import { Machine } from '../src/index.ts';

/**
 * Three `sta COLUBK` in a row, immediately after a WSYNC so the beam starts at
 * colour clock 0. `sta zp` is three cycles and a 6502 writes on the third, so
 * the writes land at colour clocks 6, 15 and 24 -- not 0, 9 and 18, which is
 * where a model that applies the write at instruction START puts them.
 *
 * This is the whole of Task 1. An object's position is set by the beam at the
 * RESPx strobe, and a strobe recorded one instruction early puts every object
 * nine pixels from where the hardware puts it.
 */
function writeClocks(body: string): number[] {
  const { rom } = assembleSource(
    `
    processor 6502
VSYNC   = $00
WSYNC   = $02
COLUBK  = $09
    seg code
    org $F000
Reset
    ldx #0
Frame
    lda #2
    sta VSYNC
    sta WSYNC
    lda #0
    sta VSYNC
    sta WSYNC
${body}
    jmp Frame
    org $FFFC
    .word Reset
    .word Reset
`,
    'write-timing.asm',
  );
  const machine = new Machine(rom);
  machine.runFrame();
  const frame = machine.runFrame({ trace: true });
  return (frame.writes ?? []).filter((w) => w.register === 0x09).map((w) => w.clock);
}

describe('a bus access lands on the instruction final cycle', () => {
  it('charges `sta zp` its two cycles of address work before the write', () => {
    expect(writeClocks('    sta COLUBK\n    sta COLUBK\n    sta COLUBK')).toEqual([6, 15, 24]);
  });

  // PosObjectX strobes RESPx with `sta RESP0,x`, which is zp,x: opcode, operand,
  // index add, write. Three cycles of work before the write, not two. This row
  // is the one the whole object-position model calibrates on.
  it('charges `sta zp,x` its three', () => {
    expect(writeClocks('    sta COLUBK,x\n    sta COLUBK,x')).toEqual([9, 21]);
  });

  // Known-positive: an instruction between two stores must push the second one
  // out by its full cost, or the sync is being applied per frame rather than
  // per instruction.
  it('advances the beam across an instruction that touches no register', () => {
    expect(writeClocks('    sta COLUBK\n    nop\n    sta COLUBK')).toEqual([6, 21]);
  });
});
```

- [x] **Step 2 — run it, watch all three fail.**

```bash
npx vitest run packages/emulator/test/write-timing.test.ts
```

Expected: `[0, 9, 18]` where `[6, 15, 24]` was asserted.

- [x] **Step 3 — expose the CPU's cycle count.** In `packages/emulator/src/cpu.ts`, beside
      `private cycles = 0`:

```ts
  /**
   * Cycles the instruction currently executing will consume.
   *
   * FINAL at every bus access, which is what lets the machine advance the beam
   * to the access's own cycle. Stores add no page-cross penalty -- they call
   * `addrAbsoluteX(false)` and friends -- and loads add theirs inside the
   * addressing helper, before the access. The only `this.cycles +=` that runs
   * after an access is the branch penalty, and no branch touches the bus.
   */
  get pendingCycles(): number {
    return this.cycles;
  }
```

- [x] **Step 4 — give the bus a sync hook.** In `packages/emulator/src/bus.ts`, add the field
      and call it on both TIA paths:

```ts
  /**
   * Called immediately before an access that decodes to the TIA, and never
   * otherwise.
   *
   * The beam has to be where the hardware would have it WHEN the access lands,
   * not where it was when the instruction started. RIOT accesses do not need
   * this: its timer is read in vertical blank, where three cycles buy nothing.
   */
  onTiaAccess: (() => void) | undefined;
```

      In `read`, replace `return this.tia.read(addr & 0x0f);` with:

```ts
      this.onTiaAccess?.();
      return this.tia.read(addr & 0x0f);
```

      In `write`, replace the `this.tia.write(...)` branch with:

```ts
      this.onTiaAccess?.();
      this.tia.write(addr & 0x3f, v);
      return;
```

- [x] **Step 5 — drive it from the machine.** In `packages/emulator/src/machine.ts`, inside
      `runFrame`, before the `try`:

```ts
    // Colour clocks of the CURRENT instruction already handed to the TIA. A bus
    // access lands on the instruction's final cycle, so the beam is advanced to
    // `pendingCycles - 1` before the access and the remainder afterwards. An
    // instruction with two TIA accesses syncs once: the second call finds the
    // beam already there.
    let ticked = 0;
    this.bus.onTiaAccess = () => {
      const target = Math.max(0, this.cpu.pendingCycles - 1);
      if (target <= ticked) return;
      this.tia.tick((target - ticked) * COLOR_CLOCKS_PER_CPU_CYCLE);
      ticked = target;
    };
```

      Replace the non-halted branch of the run loop:

```ts
        } else {
          const cycles = this.cpu.step();
          cpuCycles += cycles;
          this.riot.tick(cycles);
          this.tia.tick((cycles - ticked) * COLOR_CLOCKS_PER_CPU_CYCLE);
          ticked = 0;
        }
```

      And in the `finally` block, beside the two callback clears:

```ts
      this.bus.onTiaAccess = undefined;
```

- [x] **Step 6 — run the new test.** All three pass.

- [x] **Step 7 — run the gate, and read what moved.**

```bash
npm run check
```

      **`frame-timing.test.ts` and `kernel-fixtures.test.ts` must be UNCHANGED.** They assert
      absolute scanline counts, and a timing correction that moves a scanline boundary is a
      bug rather than a correction. If either fails, STOP: the sync is being applied to
      instructions it should not be, or `pendingCycles` is not final at some access.

      `golden.test.ts` and `static-build.test.ts` compare against the committed golden, which
      has not been regenerated yet, so failures there are expected at this step and are the
      next one's input.

- [x] **Step 8 — regenerate the golden and read the diff.**

```bash
npm run golden
git diff --stat tests/goldens/tank-arena.trace
```

      Then `npm run check` again: everything green. Every changed line must be a `clock` and
      `pixel` shift; a changed `register` or `value` means the correction changed what the ROM
      DOES, which it must not. Check with:

```bash
git diff tests/goldens/tank-arena.trace | grep '^[-+]' | head -40
```

- [x] **Step 9 — recompute the hoist argument, prediction first.** The spec predicts the
      corrected number makes increment 5b's hoist case STRONGER. Read the regenerated golden
      for the reference's `COLUP1` write on line 57 and its `PF0`/`GRP0` writes on line 65,
      and write predicted-beside-measured into `docs/kernel-measurements.md` under a new
      heading **"What the write-timing correction moved"**, including:

      - the three-`sta` table from the spec, now measured rather than derived;
      - `COLUP1`'s old colour clock (66) and its new one;
      - `GRP0`'s old pixels (1 and 10) and its new ones;
      - whether the hoist argument survived, in one sentence, either way.

      Mark the stale numbers already recorded elsewhere in that document as pre-correction
      rather than deleting them — a number that moved is evidence, and deleting it loses the
      finding.

- [x] **Step 10 — commit, alone.**

```bash
git add packages/emulator/src/cpu.ts packages/emulator/src/bus.ts \
        packages/emulator/src/machine.ts packages/emulator/test/write-timing.test.ts \
        tests/goldens/tank-arena.trace docs/kernel-measurements.md
git commit -m "Task 1: a bus access lands on the cycle it happens"
git push
```

---

## Task 2: The movable objects

**Files:**
- Create: `packages/emulator/src/objects.ts`
- Create: `packages/emulator/test/objects.test.ts`
- Modify: `packages/emulator/src/index.ts`

**Interfaces:**
- Produces: `const enum Present { P0 = 1, P1 = 2, M0 = 4, M1 = 8, BL = 16, PF = 32 }`
- Produces: `class Objects` with public mutable register fields, `strobe(object, clock)`,
  `applyHmove()`, and `presenceAt(pixel: number): number`.
- Consumes: nothing from Task 1.

- [x] **Step 1 — write the failing test.** Create `packages/emulator/test/objects.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Objects, Present } from '../src/index.ts';

/** The pixels at which an object is present, as an array of indices. */
function pixels(objects: Objects, bit: number): number[] {
  const on: number[] = [];
  for (let x = 0; x < 160; x += 1) {
    if ((objects.presenceAt(x) & bit) !== 0) on.push(x);
  }
  return on;
}

describe('player position', () => {
  // A RESPx strobe in the VISIBLE region puts the object's first pixel a fixed
  // delay after the beam. The delay is a PARAMETER measured by
  // tests/fixtures/tia/, not a constant this test is entitled to invent -- it
  // asserts the arithmetic around the parameter, and the fixtures assert the
  // parameter.
  it('places a player relative to the beam at the strobe', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.strobe('p0', 68 + 20); // visible pixel 20
    expect(pixels(o, Present.P0)[0]).toBe(20 + Objects.PLAYER_STROBE_DELAY);
  });

  it('parks a player at the left edge when strobed inside horizontal blank', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.strobe('p0', 10);
    expect(pixels(o, Present.P0)[0]).toBe(Objects.PLAYER_HBLANK_POSITION);
  });

  it('draws only the bits the graphics byte sets', () => {
    const o = new Objects();
    o.grp0 = 0b10000001;
    o.strobe('p0', 68);
    const start = Objects.PLAYER_STROBE_DELAY;
    expect(pixels(o, Present.P0)).toEqual([start, start + 7]);
  });

  it('mirrors the graphics byte when REFP is set', () => {
    const o = new Objects();
    o.grp0 = 0b11000000;
    o.refp0 = 0x08;
    o.strobe('p0', 68);
    const start = Objects.PLAYER_STROBE_DELAY;
    expect(pixels(o, Present.P0)).toEqual([start + 6, start + 7]);
  });

  it('draws nothing at all when the graphics byte is zero', () => {
    const o = new Objects();
    o.grp0 = 0;
    o.strobe('p0', 68);
    expect(pixels(o, Present.P0)).toEqual([]);
  });
});

describe('NUSIZ', () => {
  it('doubles a player width at size 5', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.nusiz0 = 5;
    o.strobe('p0', 68);
    expect(pixels(o, Present.P0)).toHaveLength(16);
  });

  it('quadruples it at size 7', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.nusiz0 = 7;
    o.strobe('p0', 68);
    expect(pixels(o, Present.P0)).toHaveLength(32);
  });

  it('draws three close copies at size 3', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.nusiz0 = 3;
    o.strobe('p0', 68);
    const start = Objects.PLAYER_STROBE_DELAY;
    expect(pixels(o, Present.P0)).toHaveLength(24);
    expect(pixels(o, Present.P0)).toContain(start + 16);
    expect(pixels(o, Present.P0)).toContain(start + 32);
  });

  it('sizes a missile from the high NUSIZ bits', () => {
    const o = new Objects();
    o.enam0 = 0x02;
    o.nusiz0 = 0x20; // missile width 4
    o.strobe('m0', 68);
    expect(pixels(o, Present.M0)).toHaveLength(4);
  });
});

describe('HMOVE', () => {
  // HM values are a signed nibble in the HIGH half of the byte, and a POSITIVE
  // value moves the object LEFT. $70 is +7 (left 7), $F0 is -1 (right 1).
  it('moves an object left for a positive nibble', () => {
    const o = new Objects();
    o.grp0 = 0x80;
    o.strobe('p0', 68 + 40);
    o.hmp0 = 0x70;
    o.applyHmove();
    expect(pixels(o, Present.P0)[0]).toBe(40 + Objects.PLAYER_STROBE_DELAY - 7);
  });

  it('moves it right for a negative one', () => {
    const o = new Objects();
    o.grp0 = 0x80;
    o.strobe('p0', 68 + 40);
    o.hmp0 = 0xf0;
    o.applyHmove();
    expect(pixels(o, Present.P0)[0]).toBe(40 + Objects.PLAYER_STROBE_DELAY + 1);
  });

  // Known-positive: HMOVE with every HM register clear must move nothing. A
  // model that applied a constant comb offset would fail here.
  it('moves nothing when every HM register is zero', () => {
    const o = new Objects();
    o.grp0 = 0x80;
    o.strobe('p0', 68 + 40);
    const before = pixels(o, Present.P0)[0];
    o.applyHmove();
    expect(pixels(o, Present.P0)[0]).toBe(before);
  });
});
```

- [x] **Step 2 — run it, watch it fail** with "Objects is not exported".

- [x] **Step 3 — implement `packages/emulator/src/objects.ts`.**

```ts
/**
 * What the TIA draws, as state plus one query.
 *
 * Deliberately knows nothing about the beam. `tia.ts` owns the beam and asks
 * this "which objects are present at pixel N"; keeping the two apart is why a
 * future framebuffer is an addition here rather than a rewrite -- colour is a
 * second query over the same state.
 *
 * No colour and no priority. This increment latches collisions, which need
 * PRESENCE and nothing else.
 */

export const enum Present {
  P0 = 1,
  P1 = 2,
  M0 = 4,
  M1 = 8,
  BL = 16,
  PF = 32,
}

export type MovableName = 'p0' | 'p1' | 'm0' | 'm1' | 'bl';

/** Colour clocks of horizontal blank, repeated here to avoid a cycle. */
const HBLANK = 68;
const VISIBLE = 160;

/** Copy offsets in pixels for each NUSIZ copy mode, and the player's width. */
const NUSIZ_COPIES: readonly (readonly number[])[] = [
  [0], // 0: one copy
  [0, 16], // 1: two copies, close
  [0, 32], // 2: two copies, medium
  [0, 16, 32], // 3: three copies, close
  [0, 64], // 4: two copies, wide
  [0], // 5: one copy, double width
  [0, 32, 64], // 6: three copies, medium
  [0], // 7: one copy, quadruple width
];
const NUSIZ_WIDTH: readonly number[] = [1, 1, 1, 1, 1, 2, 1, 4];

export class Objects {
  /**
   * Where a RESPx strobe puts an object, relative to the beam.
   *
   * PARAMETERS, not constants. `tests/fixtures/tia/` measures them and Stella
   * checks the result; these values are the documented starting point and lose
   * to any measurement that disagrees. `packages/runtime/src/bounds.ts` assumes
   * the player delay makes an authored x land on screen pixel x, which is the
   * assumption those fixtures exist to test.
   */
  static readonly PLAYER_STROBE_DELAY = 5;
  static readonly MISSILE_STROBE_DELAY = 4;
  static readonly PLAYER_HBLANK_POSITION = 3;
  static readonly MISSILE_HBLANK_POSITION = 2;

  // Positions, in visible pixels, of each object's first copy.
  p0 = 0;
  p1 = 0;
  m0 = 0;
  m1 = 0;
  bl = 0;

  // Horizontal motion registers, as written: signed nibble in the high half.
  hmp0 = 0;
  hmp1 = 0;
  hmm0 = 0;
  hmm1 = 0;
  hmbl = 0;

  grp0 = 0;
  grp1 = 0;
  enam0 = 0;
  enam1 = 0;
  enabl = 0;
  nusiz0 = 0;
  nusiz1 = 0;
  refp0 = 0;
  refp1 = 0;

  pf0 = 0;
  pf1 = 0;
  pf2 = 0;
  ctrlpf = 0;

  /**
   * Reset an object's position counter to the beam.
   *
   * Inside horizontal blank the counter has not started, so the object comes to
   * rest at its minimum position rather than somewhere off the left edge.
   */
  strobe(name: MovableName, clock: number): void {
    const player = name === 'p0' || name === 'p1';
    const delay = player ? Objects.PLAYER_STROBE_DELAY : Objects.MISSILE_STROBE_DELAY;
    const minimum = player ? Objects.PLAYER_HBLANK_POSITION : Objects.MISSILE_HBLANK_POSITION;
    const position = clock < HBLANK ? minimum : clock - HBLANK + delay;
    this[name] = position % VISIBLE;
  }

  /** Apply every horizontal-motion register. A POSITIVE nibble moves LEFT. */
  applyHmove(): void {
    const move = (position: number, hm: number): number => {
      const nibble = (hm >> 4) & 0x0f;
      const signed = nibble < 8 ? nibble : nibble - 16;
      return (((position - signed) % VISIBLE) + VISIBLE) % VISIBLE;
    };
    this.p0 = move(this.p0, this.hmp0);
    this.p1 = move(this.p1, this.hmp1);
    this.m0 = move(this.m0, this.hmm0);
    this.m1 = move(this.m1, this.hmm1);
    this.bl = move(this.bl, this.hmbl);
  }

  /** Which objects cover this visible pixel, as a `Present` bitmask. */
  presenceAt(pixel: number): number {
    let mask = 0;
    if (this.playerAt(pixel, this.p0, this.grp0, this.nusiz0, this.refp0)) mask |= Present.P0;
    if (this.playerAt(pixel, this.p1, this.grp1, this.nusiz1, this.refp1)) mask |= Present.P1;
    if (this.blobAt(pixel, this.m0, this.enam0 & 0x02, (this.nusiz0 >> 4) & 3, this.nusiz0)) {
      mask |= Present.M0;
    }
    if (this.blobAt(pixel, this.m1, this.enam1 & 0x02, (this.nusiz1 >> 4) & 3, this.nusiz1)) {
      mask |= Present.M1;
    }
    if (this.blobAt(pixel, this.bl, this.enabl & 0x02, (this.ctrlpf >> 4) & 3, 0)) {
      mask |= Present.BL;
    }
    if (this.playfieldAt(pixel)) mask |= Present.PF;
    return mask;
  }

  private playerAt(
    pixel: number,
    position: number,
    graphics: number,
    nusiz: number,
    refp: number,
  ): boolean {
    if (graphics === 0) return false;
    const mode = nusiz & 0x07;
    const scale = NUSIZ_WIDTH[mode] ?? 1;
    const width = 8 * scale;
    for (const offset of NUSIZ_COPIES[mode] ?? [0]) {
      const start = (position + offset) % VISIBLE;
      const into = (((pixel - start) % VISIBLE) + VISIBLE) % VISIBLE;
      if (into >= width) continue;
      const column = Math.floor(into / scale);
      const bit = (refp & 0x08) !== 0 ? column : 7 - column;
      if ((graphics & (1 << bit)) !== 0) return true;
    }
    return false;
  }

  /**
   * A missile or the ball: no graphics byte, just an enable bit and a width.
   *
   * Missiles take their copy pattern from the same NUSIZ as their player, which
   * is why `nusiz` is passed for them and zero for the ball.
   */
  private blobAt(
    pixel: number,
    position: number,
    enabled: number,
    sizeBits: number,
    nusiz: number,
  ): boolean {
    if (enabled === 0) return false;
    const width = 1 << sizeBits;
    for (const offset of NUSIZ_COPIES[nusiz & 0x07] ?? [0]) {
      const start = (position + offset) % VISIBLE;
      const into = (((pixel - start) % VISIBLE) + VISIBLE) % VISIBLE;
      if (into < width) return true;
    }
    return false;
  }

  /**
   * The playfield: 20 bits across the left half, each 4 pixels wide.
   *
   * The bit order is not left to right. PF0 uses D4-D7 with D4 leftmost, PF1
   * runs D7 down to D0, and PF2 runs D0 up to D7. The right half repeats the
   * left, or mirrors it when CTRLPF D0 (REF) is set.
   */
  private playfieldAt(pixel: number): boolean {
    const half = VISIBLE / 2;
    let index = pixel < half ? pixel : pixel - half;
    if (pixel >= half && (this.ctrlpf & 0x01) !== 0) index = half - 1 - index;
    const bit = Math.floor(index / 4);
    if (bit < 4) return (this.pf0 & (1 << (bit + 4))) !== 0;
    if (bit < 12) return (this.pf1 & (1 << (7 - (bit - 4)))) !== 0;
    return (this.pf2 & (1 << (bit - 12))) !== 0;
  }
}
```

- [x] **Step 4 — export and run.** Add `export { Objects, Present } from './objects.ts';` and
      `export type { MovableName } from './objects.ts';` to `packages/emulator/src/index.ts`.
      All fifteen tests pass.

- [x] **Step 5 — commit.**

```bash
git add packages/emulator/src/objects.ts packages/emulator/test/objects.test.ts \
        packages/emulator/src/index.ts
git commit -m "Task 2: what the TIA draws, as state plus one query"
```

---

## Task 3: The TIA fills a presence mask and latches out of it

**Files:**
- Modify: `packages/emulator/src/tia.ts`
- Create: `packages/emulator/test/collision.test.ts`
- Modify: `packages/emulator/src/index.ts`

**Interfaces:**
- Consumes: `Objects`, `Present` from Task 2.
- Produces: `TIA.CXM0P`…`TIA.CXPPMM` read addresses, `Tia.objects: Objects`,
  `Tia.collisions: Readonly<Uint8Array>` (8 entries, indexed by read address).

- [x] **Step 1 — write the failing test.** Create
      `packages/emulator/test/collision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Tia } from '../src/index.ts';

/** Run one full scanline with whatever object state the caller set up. */
function line(setup: (tia: Tia) => void): Tia {
  const tia = new Tia();
  setup(tia);
  tia.tick(228);
  return tia;
}

const CXPPMM = 0x07;
const CXP0FB = 0x02;

describe('collision latches', () => {
  it('sets the P0-P1 bit when two players share a pixel', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    expect(tia.read(CXPPMM) & 0x80).toBe(0x80);
  });

  // THE known-negative, and it is the one that matters: a latch that set
  // unconditionally would pass the test above and tell us nothing.
  it('leaves it clear when the two players do not overlap', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 140);
    });
    expect(tia.read(CXPPMM) & 0x80).toBe(0);
  });

  it('leaves it clear when they overlap but one draws no pixels', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0x00;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    expect(tia.read(CXPPMM) & 0x80).toBe(0);
  });

  it('sets the P0-playfield bit when a player crosses a lit block', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.pf0 = 0x10; // leftmost block, pixels 0-3
      t.objects.strobe('p0', 68);
    });
    expect(tia.read(CXP0FB) & 0x80).toBe(0x80);
  });

  it('is LEVEL, not edged: the latch survives into the next line', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    tia.objects.grp1 = 0x00; // stop overlapping
    tia.tick(228);
    expect(tia.read(CXPPMM) & 0x80).toBe(0x80);
  });

  it('clears every latch on CXCLR', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    tia.write(0x2c, 0); // CXCLR
    expect(tia.read(CXPPMM)).toBe(0);
  });

  // Input registers stay unmodelled, and the comment saying so must now name
  // them rather than covering every read.
  it('still reads INPT4 as not-pressed', () => {
    expect(new Tia().read(0x0c)).toBe(0);
  });
});
```

- [x] **Step 2 — run it, watch it fail** with "objects is not a property of Tia".

- [x] **Step 3 — implement.** In `packages/emulator/src/tia.ts`:

      Add to the `TIA` constant, after `CXCLR`:

```ts
  /** Write registers this model decodes into object state. */
  NUSIZ0: 0x04,
  NUSIZ1: 0x05,
  CTRLPF: 0x0a,
  REFP0: 0x0b,
  REFP1: 0x0c,
  PF0: 0x0d,
  PF1: 0x0e,
  PF2: 0x0f,
  RESP0: 0x10,
  RESP1: 0x11,
  RESM0: 0x12,
  RESM1: 0x13,
  RESBL: 0x14,
  GRP0: 0x1b,
  GRP1: 0x1c,
  ENAM0: 0x1d,
  ENAM1: 0x1e,
  ENABL: 0x1f,
  HMP0: 0x20,
  HMP1: 0x21,
  HMM0: 0x22,
  HMM1: 0x23,
  HMBL: 0x24,
  HMOVE: 0x2a,
  HMCLR: 0x2b,
```

      Add the read-register addresses:

```ts
/** TIA READ register addresses. Reads decode only four address lines. */
export const CX = {
  CXM0P: 0x00,
  CXM1P: 0x01,
  CXP0FB: 0x02,
  CXP1FB: 0x03,
  CXM0FB: 0x04,
  CXM1FB: 0x05,
  CXBLPF: 0x06,
  CXPPMM: 0x07,
} as const;

/**
 * The fifteen latch bits, as (read address, bit, the two objects that set it).
 *
 * Straight from the hardware's own table. Written as data rather than as
 * fifteen `if`s so the pairs can be read against a reference without reading
 * control flow.
 */
const LATCHES: readonly (readonly [number, number, number, number])[] = [
  [CX.CXM0P, 0x80, Present.M0, Present.P1],
  [CX.CXM0P, 0x40, Present.M0, Present.P0],
  [CX.CXM1P, 0x80, Present.M1, Present.P0],
  [CX.CXM1P, 0x40, Present.M1, Present.P1],
  [CX.CXP0FB, 0x80, Present.P0, Present.PF],
  [CX.CXP0FB, 0x40, Present.P0, Present.BL],
  [CX.CXP1FB, 0x80, Present.P1, Present.PF],
  [CX.CXP1FB, 0x40, Present.P1, Present.BL],
  [CX.CXM0FB, 0x80, Present.M0, Present.PF],
  [CX.CXM0FB, 0x40, Present.M0, Present.BL],
  [CX.CXM1FB, 0x80, Present.M1, Present.PF],
  [CX.CXM1FB, 0x40, Present.M1, Present.BL],
  [CX.CXBLPF, 0x80, Present.BL, Present.PF],
  [CX.CXPPMM, 0x80, Present.P0, Present.P1],
  [CX.CXPPMM, 0x40, Present.M0, Present.M1],
];
```

      Add to the class:

```ts
  readonly objects = new Objects();

  /** Latched collisions, indexed by read address. Level, not edged. */
  private readonly latched = new Uint8Array(8);

  /** Object presence for the line being drawn, one `Present` mask per pixel. */
  private readonly presence = new Uint8Array(VISIBLE_PIXELS);
```

      In `write`, extend the switch with the object registers. `RESP0`/`RESP1`/`RESM0`/
      `RESM1`/`RESBL` call `this.objects.strobe(...)` with `this.clock`; `HMOVE` calls
      `this.objects.applyHmove()`; `HMCLR` zeroes the five HM fields; `CXCLR` calls
      `this.latched.fill(0)`; every other listed register assigns the matching field.

      **`VDELP0`, `VDELP1` and `VDELBL` are NOT modelled, and a non-zero write to one
      THROWS.** Vertical delay swaps an object's graphics for a shadow register written a
      line earlier; no ROM in this repository uses it, and a model that silently ignored it
      would draw the wrong line's graphics and latch a collision that never happened. The
      spec lists them in Part 1's state; this is the correction, and it follows `cycleCost`'s
      rule that a model refuses what it cannot represent rather than guessing:

```ts
      case TIA.VDELP0:
      case TIA.VDELP1:
      case TIA.VDELBL:
        if ((value & 0x01) !== 0) {
          throw new Error(
            `VDEL is not modelled, and this ROM enabled it (register $${reg.toString(16)}). ` +
              'Vertical delay draws the graphics byte written a line EARLIER, so ignoring ' +
              'it would put the wrong row on the screen and latch collisions that never ' +
              'happened. Model it before running a ROM that needs it.',
          );
        }
        break;
```

      Replace `read` with:

```ts
  read(address: number): number {
    const reg = address & 0x0f;
    if (reg < 8) return this.latched[reg] ?? 0;
    // INPT0-INPT5 are not modelled; 0 is "not pressed". Named rather than
    // covered by a blanket `return 0`, so the next unmodelled read is visible.
    return 0;
  }
```

      In `tick`, fill the presence mask for the pixels the step covered, and latch at end of
      line:

```ts
      const from = this.clock - step;
      this.fillPresence(from, this.clock);
```

      immediately after `this.clock += step`, and inside the end-of-line branch, before
      `this.onScanline?.(...)`:

```ts
        this.latchCollisions();
```

      And the two helpers:

```ts
  /**
   * Record which objects covered each pixel the beam just crossed.
   *
   * Event-driven without an event list: object state changes only on a write,
   * and a write lands between two ticks, so "the state as it stands" is the
   * state for exactly these pixels.
   */
  private fillPresence(fromClock: number, toClock: number): void {
    const first = Math.max(fromClock, HBLANK_COLOR_CLOCKS);
    for (let clock = first; clock < toClock; clock += 1) {
      const pixel = clock - HBLANK_COLOR_CLOCKS;
      this.presence[pixel] = this.objects.presenceAt(pixel);
    }
  }

  /** OR the fifteen latch bits out of the finished line and start the next. */
  private latchCollisions(): void {
    for (const pixel of this.presence) {
      if (pixel === 0) continue;
      for (const [reg, bit, a, b] of LATCHES) {
        if ((pixel & a) !== 0 && (pixel & b) !== 0) {
          this.latched[reg] = (this.latched[reg] ?? 0) | bit;
        }
      }
    }
    this.presence.fill(0);
  }
```

- [x] **Step 4 — export `CX`** from `packages/emulator/src/index.ts`, alongside `TIA`.

- [x] **Step 5 — run the whole suite.** All seven new tests pass, and **every existing test
      still passes**. `golden.test.ts` and `static-build.test.ts` are the ones to watch: the
      reference ROM now reads a real `CXPPMM`, so if the two tanks touch in any of the 90
      frames, the score changes and the trace changes with it. That is a real finding either
      way — record which happened for the session log.

- [x] **Step 6 — commit.**

```bash
git add packages/emulator/src/tia.ts packages/emulator/test/collision.test.ts \
        packages/emulator/src/index.ts
git commit -m "Task 3: a presence mask per line, and fifteen latches out of it"
```

---

## Task 4: Fixture ROMs that measure where an object actually lands

**Files:**
- Create: `tests/fixtures/tia/collide-players.asm`
- Create: `tests/fixtures/tia/collide-playfield.asm`
- Create: `packages/emulator/test/tia-fixtures.test.ts`
- Modify: `packages/emulator/test/support/roms.ts`

**Interfaces:**
- Consumes: `Machine`, `CX` from Task 3.

Each fixture paints the **background** — `COLUBK` — red when its latch is set and black when
it is not, and takes the separation from a byte at a fixed ROM offset so the test can sweep it
without reassembling by hand. A whole-screen colour flip is chosen deliberately: it survives
being read off a Stella screenshot in a way that measuring a sprite's left edge did not.

- [x] **Step 1 — write `tests/fixtures/tia/collide-players.asm`.** Header states the QUESTION
      and the PREDICTION before the numbers are known:

```
; QUESTION: at what separation does CXPPMM's P0-P1 bit stop setting?
;
; PREDICTION, written before the run: two 8-pixel-wide players whose graphics
; are $FF overlap while their positions differ by 0..7 and separate at 8. This
; measures RELATIVE position, so it is insensitive to a uniform error in where
; RESPx puts an object -- collide-playfield.asm is the one that is not.
;
; P0 is strobed at a fixed colour clock. P1 is strobed SEPARATION colour clocks
; later, where SEPARATION is the byte at label Sep, patched by the test.
```

      The body: standard 3/37/192/30 frame; in vertical blank set `GRP0`/`GRP1` to `$FF`,
      strobe `RESP0`, spend `Sep` cycles in a counted delay loop, strobe `RESP1`; render 192
      lines with `GRP0`/`GRP1` held; in overscan `bit CXPPMM`, `bpl .clear`, load red,
      `.clear` load black, `sta COLUBK`, `sta CXCLR`.

- [x] **Step 2 — write `tests/fixtures/tia/collide-playfield.asm`.**

```
; QUESTION: at what colour clock does a RESP0 strobe put P0's first pixel?
;
; PREDICTION, written before the run: with one playfield block lit at PF0 D4 --
; screen pixels 0 to 3 -- P0's leftmost column touches it while P0's position is
; 0..3, and CXP0FB clears at 4. Because the playfield's position is fixed by the
; BEAM and not by any strobe, the clock at which the latch flips measures the
; RESPx delay ABSOLUTELY. This is the fixture bounds.ts's "assume zero" note
; depends on.
```

- [x] **Step 3 — register both fixtures** in `packages/emulator/test/support/roms.ts`:

```ts
  'collide-players': 'tests/fixtures/tia/collide-players.asm',
  'collide-playfield': 'tests/fixtures/tia/collide-playfield.asm',
```

- [x] **Step 4 — write the sweep test.** `packages/emulator/test/tia-fixtures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assemble } from '@player1dsl/assembler';
import { Machine } from '../src/index.ts';
import { fixtureSource } from './support/roms.ts';

const COLUBK = 0x09;
const RED = 0x44;

/**
 * Assemble a fixture with its separation byte set, run it, and report whether
 * the latch was set -- which the fixture paints as a red background.
 *
 * The separation is patched in the SOURCE and reassembled rather than poked
 * into the ROM image: a byte offset into an assembled image is a number that
 * goes stale the moment the fixture gains an instruction, and the failure it
 * produces is a wrong colour rather than an error.
 */
function latchedAt(fixture: string, separation: number): boolean {
  const source = fixtureSource(fixture).replace('SEPARATION = 0', `SEPARATION = ${separation}`);
  const { rom } = assemble(source, { includeDirs: [] });
  const machine = new Machine(rom);
  machine.runFrame();
  machine.runFrame();
  const frame = machine.runFrame({ trace: true });
  const background = (frame.writes ?? []).filter((w) => w.register === COLUBK).at(-1);
  return background?.value === RED;
}

/** The first separation at which the latch stops setting. */
function flip(fixture: string, range: number): number {
  for (let separation = 0; separation < range; separation += 1) {
    if (!latchedAt(fixture, separation)) return separation;
  }
  throw new Error(`${fixture} never cleared across ${range} separations`);
}

describe('collide-players: where two players stop overlapping', () => {
  it('separates at 8, the width of a player', () => {
    expect(flip('collide-players', 24)).toBe(8);
  });

  // A sweep whose every value gives the same answer has measured nothing. This
  // is the guard that makes the number above mean something -- without it, a
  // fixture that never latched at all would report a flip of 0 and pass.
  it('is not degenerate: the sweep both sets and clears the latch', () => {
    expect(latchedAt('collide-players', 0)).toBe(true);
    expect(latchedAt('collide-players', 20)).toBe(false);
  });
});

describe('collide-playfield: where a RESP0 strobe puts P0', () => {
  it('clears once P0 has passed the lit block', () => {
    expect(flip('collide-playfield', 24)).toBe(4);
  });

  it('is not degenerate: the sweep both sets and clears the latch', () => {
    expect(latchedAt('collide-playfield', 0)).toBe(true);
    expect(latchedAt('collide-playfield', 20)).toBe(false);
  });
});
```

      `fixtureSource(name)` is a new export in `support/roms.ts` that reads a fixture's text
      without assembling it:

```ts
/** A fixture's source text, for tests that patch a constant before assembling. */
export function fixtureSource(name: string): string {
  const source = ROM_SOURCES[name];
  if (!source) throw new Error(`unknown ROM "${name}"`);
  return readFileSync(`${root}/${source}`, 'utf8');
}
```

      **If the asserted flip is not what the fixture's PREDICTION said, the prediction was
      wrong and that is the finding** — write both numbers into the measurements document and
      do not adjust the fixture to make the prediction come true.

- [x] **Step 5 — record both thresholds** in `docs/kernel-measurements.md`, under "Where a
      RESPx strobe puts an object", predicted beside measured, in the shape the existing
      Results table uses.

- [x] **Step 6 — commit.**

```bash
git add tests/fixtures/tia packages/emulator/test/tia-fixtures.test.ts \
        packages/emulator/test/support/roms.ts docs/kernel-measurements.md
git commit -m "Task 4: two sweeps, one relative and one absolute"
```

---

## Task 5: Stella checks the two thresholds

**Files:**
- Modify: `docs/kernel-measurements.md`
- Modify: `packages/runtime/src/bounds.ts` (only if the measurement disagrees)
- Modify: `scripts/stella.sh` (accept a raw `.bin`)

- [x] **Step 1 — build both fixtures at their threshold separation and one either side.**
      Six ROMs: `flip - 1`, `flip`, `flip + 1` for each fixture, written to `build/fixtures/`.

- [x] **Step 2 — open each in Stella and record the background colour.** Our model says the
      screen is red below the flip and black at or above it. Stella is a second implementation
      and this is the only check in the repository that can catch a wrong `RESPx` delay.

- [x] **Step 3 — if Stella disagrees, correct the parameters, not the tests.**
      `Objects.PLAYER_STROBE_DELAY` and its three neighbours move by the difference Stella
      shows. Then rerun everything: the sweep test's asserted flip clock changes with them,
      and that is the measurement winning over the datasheet, which is the arrangement the
      spec asked for.

- [x] **Step 4 — settle `bounds.ts`'s open assumption.** `docs/kernel-measurements.md` records
      under "Not measured" that the tight bounds assume an authored x lands on screen pixel x.
      Replace that paragraph with the measurement — either a measured zero, or a correction to
      `movementBounds` with the offset applied and `bounds.test.ts` updated to match.

- [x] **Step 5 — regenerate the golden if anything moved, and run the gate.**

```bash
npm run golden && npm run check
```

- [x] **Step 6 — commit and push.**

```bash
git add -A
git commit -m "Task 5: Stella on both thresholds, and bounds.ts stops assuming"
git push
```

---

## Task 6: Write the session log

- [x] **Step 1 — append to `docs/session-logs/2026-08-29.md`**, in the shape the two existing
      sections use: what happened, decisions with rationale, findings that contradicted a
      prediction, what Stella showed, what is still unmeasured.

      It must answer, specifically:

      - Did the hoist argument survive the write-timing correction?
      - Did the reference ROM's 90 golden frames change once `CXPPMM` could set — that is, do
        the two tanks touch after all, or was the "miss by about a pixel" derivation right?
      - What did Stella say about the two thresholds, and did `PLAYER_STROBE_DELAY` move?
      - Is `bounds.ts` still assuming, or measuring?

- [x] **Step 2 — commit and push.**

```bash
git add docs/session-logs/2026-08-29.md
git commit -m "Session log: increment 5c, a TIA that can see a collision"
git push
```
