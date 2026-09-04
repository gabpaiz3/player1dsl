# Rule Lowering and `p1 build` End to End — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `p1 build examples/tank-arena` emits a 4 KiB ROM whose 90-frame TIA-write trace
matches the hand-written reference kernel's, closing step 3 and the walking skeleton.

**Architecture:** Game IR rules lower directly to 6502 in `packages/compiler/src/rules.ts` —
no operation IR, because two rule forms do not justify one. Their worst-case cycle cost is
computed by **reading the emitted assembly** against a 6502 cycle table that lives in
`packages/runtime` and is held to the emulator's CPU by a test, and the build fails when
rules plus positioning exceed vertical blank's budget. The comparator learns that a scanline
number is an equivalence property in the visible region and an artifact of instruction
selection in vertical blank.

**Tech Stack:** TypeScript ESM with explicit `.ts` import extensions, npm workspaces, vitest,
Biome, `tsc --build`. Node 20+. No runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md`](../specs/2026-08-19-tank-arena-compiler-design.md)
— read "The golden harness" and "packages/compiler — rule lowering", including the four
corrections dated 2026-08-29. The plan argues from the spec; executors read both.

## Global Constraints

- **NTSC only, 4 KiB unbanked.** 262 scanlines split 3 / 37 / 192 / 30. The emitted image is
  exactly 4096 bytes.
- **npm workspaces, never pnpm.** `npm run lint && npm run typecheck && npm test`.
- **DASM and Stella are dev-only.** Never runtime or CI dependencies; CI needs nothing but
  Node. DASM writes to `build/reference/`; `p1 build` writes to `build/<name>.bin`.
- **Third-party ROMs, disassemblies and recovered commercial assets never enter the
  repository.** Commercial game screenshots stay in git-ignored `game-images/`.
- **`packages/runtime` owns anything MEASURED; `packages/compiler` owns anything DERIVED.**
  `runtime` must never import from `compiler`. If a scanline count or a cycle count appears
  in `packages/compiler`, it belongs in the runtime as data.
- **`packages/runtime` must not import `packages/emulator` in `src`.** The emulator is what
  generated ROMs are checked against; a generator taking its numbers from its own checker can
  be wrong in both places at once. Cross-checks are test-only imports.
- **Derivation loses to measurement.** Do not tune a constant until a number appears. Build a
  fixture that isolates the mechanism and measure it.
- Diagnostic ranges: `E0xx` lexer, `E1xx` parser, `E2xx` checker, `E3xx` RAM, `E4xx` CLI,
  `E5xx` layout and ledger, `E6xx` catalog and selector, **`E7xx` rule lowering and the cycle
  budget** (new in this plan; add it to SPEC §13).
- Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- One session log per day at `docs/session-logs/YYYY-MM-DD.md`. Branch `step3-plan4-rule-lowering`.
  Push early — CI runs on every branch push, not only on pull requests.

---

## Four corrections this plan carries

All four are already applied to the design document, so it and this plan agree.

### 1. A scanline number is an equivalence property only where the code is straight-line

**Measured.** The visible region's landmarks — lines 40, 57, 65, 224, 232, 262 — are
identical across all 90 golden frames, because the kernel is counted WSYNCs with no
data-dependent branch. Vertical blank is not: the reference's own positioning lands on

| Frame | 0 | 5 | 20 | 40 | 50 | 80 |
|---|---|---|---|---|---|---|
| `RESP0` line | 5 | 6 | 6 | 5 | 6 | 6 |

because the joystick code's branches change how many cycles run before it. Asserting those
numbers forces a compiler to reproduce the reference's branch structure — transcription, not
compilation, and the same argument the spec already makes about the colour clock.

**So:** in vertical blank the comparator asserts the ordered sequence of
`(register, value, pixel)` and **not** the line. In the visible region it keeps exact
`(line, register, value)`. `pixel` is retained in blank and is load-bearing — it is what
carries a `RESPx` strobe's meaning, and dropping it lets a ROM position a player anywhere and
still compare equal.

This **replaces** increment 5b's test-level exclusion of everything before line 40, which 5b
recorded as a static-build artifact. It is not one; it is structural.

### 2. The committed input script drives none of the rules

**Measured.** `tank0X` travels 40 → 73 → 32 and `tank0Y` 120 → 87 → 128, so no tank comes
near `X_MIN 8`, `X_MAX 144`, `Y_MIN 12` or `Y_MAX 155` and **no clamp ever fires.** The two
sprites miss contact by about a pixel on line 139, so `CXPPMM` never sets: `GRP0` on line 43
is `$3c` — the glyph for 3 — in **all 90 frames**.

Movement clamping is covered by `packages/emulator/test/tank-arena-behaviour.test.ts`, so
that half was caught by other means. **Collision and the `hitFlag` debounce are covered
nowhere at all**, and they are exactly what increment 6 implements.

The design already carried the proviso *"provided the input script drives those paths"* and
nothing ever asserted it. A condition stated in a design and never checked is
indistinguishable from one that does not hold.

### 3. Rule cycle cost is gated, and counted by reading the emitted text

Vertical blank is 37 lines ≈ 2812 cycles, of which positioning already spends 304. An
untracked cycle cost becomes an assumed zero the compiler will happily spend — the property
the line ledger exists to prevent, one region over.

`cycleCost()` reads the emitted assembly against a 6502 cycle table. Two independent routes
to one number, exactly as `wsyncLines` already does for scanlines in the emitter's tests.
Worst-case is tractable because lowered rule code is straight-line with forward branches
only; if a rule form ever introduces a loop, the cost function **throws** rather than
guessing.

### 4. Increment 6b measures what 6 and 7 spend

`DEFAULT_STACK_RESERVED = 16` is labelled a guess in `packages/compiler/src/ram.ts`, and rule
lowering is what finally makes the call chain real. `TIM64T`'s T is still PENDING in
`timing-fixtures.test.ts`. Measuring inside the increment that spends them is what 4b existed
to prevent.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/runtime/src/cycles.ts` (create) | 6502 base cycle table and `cycleCost()` over emitted assembly |
| `packages/runtime/src/bounds.ts` (create) | `MovementBounds`, and the sprite-versus-wall geometry that produces it |
| `packages/emulator/src/cpu.ts` (modify) | Export `BASE_CYCLES` so a test can hold the runtime's copy to it |
| `packages/compiler/src/rules.ts` (create) | Game IR rules to assembly: movement, collision, scoring, digit pointers |
| `packages/compiler/src/build.ts` (modify) | One RAM allocator; `buildStatic` becomes `build({ static })` |
| `packages/compiler/src/ram.ts` (modify) | Kernel scratch joins the declared variables; measured stack reservation |
| `packages/emulator/src/golden.ts` (modify) | Region-aware comparison: ordered in blank, exact in the visible region |
| `packages/cli/src/index.ts` (modify) | `p1 build` without `--static` |
| `tests/goldens/tank-arena.input.json` (modify) | A script that reaches a bound and makes contact |
| `tests/goldens/tank-arena.trace` (regenerate) | `npm run golden` |
| `tests/fixtures/timing/stack-depth.asm` (create) | 6b: the deepest call chain, measured |
| `packages/emulator/test/rules-behaviour.test.ts` (create) | Collision, the debounce, and the score wrap — against both ROMs |

`bounds.ts` is separate from `rules.ts` because the bound geometry is a **hardware and layout
fact** the runtime owns, while *applying* a bound is lowering the compiler does. `cycles.ts`
is separate from `emit.ts` for the same reason the catalog is separate from the emitter: one
holds numbers, the other produces text.

---

## Increment 6 — rule lowering

### Task 1: Where `within field`'s bounds come from

This is the plan's 4b: **an open question with a scheduled answer, resolved by measurement
before anything depends on it.** Do not skip to Task 5 and pick a number.

The reference clamps at `X_MIN 8`, `X_MAX 144`, `Y_MIN 12`, `Y_MAX 155`. Preliminary
geometry says those are hand-chosen rather than derived: with a 4-pixel side wall and an
8-pixel sprite, the tight bounds are `x ∈ [4, 148]`, and with the field rendering lines
66–223 and a sprite top row at `225 − y`, the tight bounds are `y ∈ [9, 159]`. The reference
sits 3–4 units inside each, and not uniformly.

**Files:**
- Create: `packages/runtime/src/bounds.ts`
- Create: `packages/runtime/test/bounds.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces: `interface MovementBounds { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number }` and
  `movementBounds(input: BoundsInput): MovementBounds`.

- [x] **Step 1 — measure, before writing any assertion.** Write a throwaway probe that reads
      `tests/goldens/tank-arena.trace` and, for the reference ROM driven to each bound by
      `Machine.runFrame`, records the resting `RESP0` clock and `HMP0` value. Compare against
      the tight geometry above. **Write the four numbers and the two derivations into
      `docs/kernel-measurements.md` under a new "Where a movement bound comes from" heading,
      predicted beside measured, before choosing.**

- [x] **Step 2 — choose, on this stated criterion.** If a single rule expressed in the band
      extent, the border thickness and the sprite size reproduces all four reference numbers,
      bounds stay **derived** and `movementBounds` implements that rule. If it does not —
      which the preliminary geometry suggests — bounds are **derived tight** (the sprite may
      not overlap the wall) and the reference's extra margin is recorded as a hand-chosen
      value the compiler does not reproduce.

      **Do not add a `.p1` surface for bounds in this plan.** Authoring them is a language
      change, and the trace cannot tell the two apart until a tank reaches a bound. Write the
      option down in the session log and leave it for plan 5.

- [x] **Step 3 — write the failing test.** In `packages/runtime/test/bounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { movementBounds } from '../src/index.ts';

// The arena as tank-arena declares it: a 4-pixel side wall from one playfield
// block, a field rendering frame lines 66-223, and an 8x8 sprite.
const ARENA = {
  wallPixels: 4,
  spriteWidth: 8,
  spriteHeight: 8,
  fieldFirstLine: 66,
  fieldLastLine: 223,
  /** The loop counter that renders on `fieldLastLine + 2`. See emit.ts. */
  counterOrigin: 225,
} as const;

describe('movementBounds', () => {
  it('keeps the sprite clear of the side walls', () => {
    const b = movementBounds(ARENA);
    expect(b.xMin).toBe(4);
    expect(b.xMax).toBe(148);
  });

  it('keeps the sprite inside the field the ledger allotted', () => {
    const b = movementBounds(ARENA);
    expect(b.yMin).toBe(9);
    expect(b.yMax).toBe(159);
  });

  // Known-positive. A bounds function that ignored the sprite would return the
  // wall edges themselves, and the tank would draw over the arena.
  it('narrows as the sprite grows', () => {
    const wide = movementBounds({ ...ARENA, spriteWidth: 16 });
    expect(wide.xMax).toBe(movementBounds(ARENA).xMax - 8);
  });

  it('narrows as the wall thickens', () => {
    const thick = movementBounds({ ...ARENA, wallPixels: 8 });
    expect(thick.xMin).toBe(8);
  });
});
```

      **If Step 2 chose "derived to reproduce the reference", replace the four constants above
      with 8 / 144 / 12 / 155 and keep the two known-positives unchanged.** The test names do
      not move; only the numbers a measurement decided can.

- [x] **Step 4 — run it, watch it fail** with "movementBounds is not exported".

- [x] **Step 5 — implement `packages/runtime/src/bounds.ts`.**

```ts
/**
 * How far a movable object may travel inside a band.
 *
 * This lives in the runtime because it is geometry the HARDWARE and the ledger
 * fix between them: the wall's width is a playfield-bit fact and the field's
 * extent is a ledger row. The compiler owns the DECISION to clamp; the runtime
 * owns the numbers the decision is expressed in.
 */
export interface BoundsInput {
  /** Screen pixels the side wall occupies, from the playfield bits. */
  readonly wallPixels: number;
  readonly spriteWidth: number;
  readonly spriteHeight: number;
  /** Frame-absolute first and last line the field loop renders. */
  readonly fieldFirstLine: number;
  readonly fieldLastLine: number;
  /**
   * Counter value whose sprite row renders on `fieldLastLine + 2`.
   *
   * The field loop counts DOWN and primes one line ahead, so a sprite whose top
   * row is computed at counter N appears on line N-1. `counterOrigin - y` is
   * the top row's frame line; increment 5b measured 225 for tank-arena.
   */
  readonly counterOrigin: number;
}

export interface MovementBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export function movementBounds(input: BoundsInput): MovementBounds {
  const { wallPixels, spriteWidth, spriteHeight, counterOrigin } = input;
  const { fieldFirstLine, fieldLastLine } = input;

  // Horizontal: the sprite starts at x and ends at x + width - 1. Under REF the
  // right wall mirrors the left, so the playfield is 160 pixels wide with a
  // wall at each end.
  const xMin = wallPixels;
  const xMax = 160 - wallPixels - spriteWidth;

  // Vertical, in loop-counter terms, which run OPPOSITE to screen lines: a
  // larger y is higher up. The top row renders at counterOrigin - y, and the
  // bottom row spriteHeight - 1 lines below it.
  const yMax = counterOrigin - fieldFirstLine;
  const yMin = counterOrigin - fieldLastLine + spriteHeight - 1;

  return { xMin, xMax, yMin, yMax };
}
```

- [x] **Step 6 — export it** from `packages/runtime/src/index.ts` and run the tests.

- [x] **Step 7 — commit.**

```bash
git add packages/runtime/src/bounds.ts packages/runtime/test/bounds.test.ts \
        packages/runtime/src/index.ts docs/kernel-measurements.md
git commit -m "Task 1: where a movement bound comes from, measured before it is spent"
```

---

### Task 2: One RAM allocator

Increment 5b's `buildStatic` allocates `tank0X`, `tank0Y`, `gfx0`, `gfx1`, `lineTmp` itself,
beside `allocateRam`, which already assigns `tank0_x`, `tank0_y`, `p0_score` and the
debounce flag from `ir.variables`. **A rule that moves an actor writes the byte the kernel
reads**, so the two must become one before Task 5.

**Files:**
- Modify: `packages/compiler/src/ram.ts`
- Modify: `packages/compiler/src/build.ts:87-116` (`scratchFor`)
- Modify: `packages/compiler/test/ram.test.ts`

**Interfaces:**
- Consumes: `allocateRam(variables, options?): RamMap` — unchanged signature.
- Produces: `kernelScratch(objects: number): Variable[]` in `ram.ts`, returning the kernel's
  own working bytes as ordinary `Variable`s so one allocator sees everything.

- [x] **Step 1 — write the failing test.** In `packages/compiler/test/ram.test.ts`:

```ts
// The kernel's working bytes are not declared by any source line, but they
// occupy the same 128 bytes as the ones that are. Two allocators mean two
// answers to "which byte is free", and the symptom is a sprite whose graphics
// change when a rule fires.
it('allocates the kernel scratch out of the same zero page as declared variables', () => {
  const scratch = kernelScratch(2);
  const map = allocateRam([...IR_VARIABLES, ...scratch]);
  const addresses = [...map.slots.values()];
  expect(new Set(addresses).size).toBe(addresses.length);
  expect(map.slots.has('gfx0')).toBe(true);
  expect(map.slots.has('tank0_x')).toBe(true);
});

it('gives the kernel one graphics byte per bound object and one shared counter', () => {
  expect(kernelScratch(2).map((v) => v.name)).toEqual(['gfx0', 'gfx1', 'lineTmp']);
  expect(kernelScratch(1).map((v) => v.name)).toEqual(['gfx0', 'lineTmp']);
});
```

- [x] **Step 2 — run it, watch it fail** with "kernelScratch is not exported".

- [x] **Step 3 — implement `kernelScratch` in `ram.ts`.**

```ts
/**
 * The kernel's own working bytes.
 *
 * No source line asks for these: `gfxN` holds the graphics byte a scanning loop
 * computed one line ahead, and `lineTmp` is where it parks its counter. They go
 * through `allocateRam` with the declared variables because they compete for the
 * same 128 bytes, and a second allocator is a second answer to which byte is
 * free.
 */
export function kernelScratch(objects: number): Variable[] {
  const scratch: Variable[] = [];
  for (let i = 0; i < objects; i += 1) {
    scratch.push({ name: `gfx${i}`, type: 'byte', initial: 0 });
  }
  scratch.push({ name: 'lineTmp', type: 'byte', initial: 0 });
  return scratch;
}
```

- [x] **Step 4 — rewrite `scratchFor` in `build.ts` to consume the RAM map.** Delete the
      local `ram`/`init` construction and take addresses from `allocateRam`. The emitted
      assembly stops declaring `seg.u variables` per-name and emits equates instead:

```ts
/** Zero-page equates, from the one allocator that assigned them. */
function ramEquates(map: RamMap): string[] {
  return [...map.slots].map(
    ([name, address]) => `${name.padEnd(12)}= $${address.toString(16).toUpperCase()}`,
  );
}
```

      `emitFrame`'s `ram` option now takes these equates instead of `ds` lines. Update its
      doc comment to say so, and update `packages/runtime/test/frame.test.ts` only if it
      asserts on `ds`.

- [x] **Step 5 — the actor symbols change name.** `build.ts` used `tank0X`; the allocator
      calls it `tank0_x`. Take the allocator's name everywhere, so the assembly a human reads
      and the RAM map `p1 check` prints use one spelling.

- [x] **Step 6 — run the whole suite.** `packages/emulator/test/static-build.test.ts` must
      still pass: the ROM's *behaviour* has not changed, only which symbol table named its
      bytes. If frame 0 diverges, a byte moved — read the assembly, do not adjust the test.

- [x] **Step 7 — commit.**

```bash
git add packages/compiler/src/ram.ts packages/compiler/src/build.ts \
        packages/compiler/test/ram.test.ts packages/runtime/src/frame.ts
git commit -m "Task 2: one zero page, one allocator"
```

---

### Task 3: The 6502 cycle table, held to the emulator

**Files:**
- Create: `packages/runtime/src/cycles.ts`
- Modify: `packages/emulator/src/cpu.ts` (export `BASE_CYCLES`)
- Create: `packages/runtime/test/cycles.test.ts`

**Interfaces:**
- Produces: `BASE_CYCLES: readonly number[]` (256 entries, indexed by opcode byte) and
  `baseCycles(opcode: number): number`.

- [x] **Step 1 — export the emulator's table.** In `packages/emulator/src/cpu.ts`, change
      `const BASE_CYCLES` to `export const BASE_CYCLES` and add:

```ts
/**
 * Exported for `packages/runtime/test/cycles.test.ts`, which holds the runtime's
 * independent copy to this one. The runtime must not import it in `src`: the
 * emulator is what generated ROMs are checked against, and a cost model taking
 * its numbers from its own checker could be wrong in both places and pass.
 */
```

- [x] **Step 2 — write the failing test.** In `packages/runtime/test/cycles.test.ts`:

```ts
import { BASE_CYCLES as EMULATOR_CYCLES } from '@player1dsl/emulator';
import { OPCODES } from '@player1dsl/assembler';
import { describe, expect, it } from 'vitest';
import { baseCycles, BASE_CYCLES } from '../src/index.ts';

describe('the cost model and the CPU agree', () => {
  // Only opcodes the assembler can emit are compared. The emulator's table has
  // zeroes where an undocumented opcode sits, and asserting on those would be
  // asserting about instructions no generated ROM can contain.
  const emittable = new Set(
    Object.values(OPCODES).flatMap((modes) => Object.values(modes)),
  );

  it('gives every emittable opcode the cycle count the CPU charges it', () => {
    for (const opcode of emittable) {
      expect([opcode.toString(16), baseCycles(opcode)]).toEqual([
        opcode.toString(16),
        EMULATOR_CYCLES[opcode],
      ]);
    }
  });

  it('covers all 256 opcode slots, so a lookup can never be undefined', () => {
    expect(BASE_CYCLES).toHaveLength(256);
  });

  // Proof the comparison can fail without editing cycles.ts: LDA immediate is 2
  // cycles and LDA absolute is 4, so a table that returned one constant is
  // caught.
  it('would catch a table that charged every instruction the same', () => {
    expect(baseCycles(0xa9)).toBe(2);
    expect(baseCycles(0xad)).toBe(4);
  });
});
```

- [x] **Step 3 — run it, watch it fail.**

- [x] **Step 4 — implement `packages/runtime/src/cycles.ts`.** Write the 256-entry table out
      independently from a 6502 reference — **do not copy it from `cpu.ts`**, or the test in
      Step 2 asserts that a copy is a copy. The header comment must say so:

```ts
/**
 * Base cycle counts for the 6502, indexed by opcode byte.
 *
 * Written independently of `packages/emulator/src/cpu.ts` and held to it by
 * `cycles.test.ts`. Copying that table would make the test assert that a copy is
 * a copy; two people writing the same table from the hardware reference is the
 * only arrangement where agreement means anything.
 *
 * These are BASE counts. Page-crossing indexed reads and taken branches add
 * penalties, which `cycleCost` applies at the call site because they depend on
 * addresses the assembler assigns.
 */
export const BASE_CYCLES: readonly number[] = [
  /* 0x00 */ 7, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 0, 4, 6, 0,
  /* 0x10 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  // ... the remaining 14 rows, written from the reference
];

export function baseCycles(opcode: number): number {
  return BASE_CYCLES[opcode & 0xff] ?? 0;
}
```

- [x] **Step 5 — run the tests, export from `index.ts`, commit.**

```bash
git add packages/runtime/src/cycles.ts packages/runtime/test/cycles.test.ts \
        packages/emulator/src/cpu.ts packages/runtime/src/index.ts
git commit -m "Task 3: a cycle table written twice, so agreeing means something"
```

---

### Task 4: `cycleCost()` over emitted assembly

**Files:**
- Modify: `packages/runtime/src/cycles.ts`
- Modify: `packages/runtime/test/cycles.test.ts`

**Interfaces:**
- Produces: `cycleCost(lines: readonly string[]): number` — worst-case CPU cycles.

- [x] **Step 1 — write the failing test.**

```ts
describe('cycleCost', () => {
  it('adds up a straight run of instructions', () => {
    // lda #  2, sta zp 3, inc zp 5  =  10
    expect(cycleCost(['    lda #$08', '    sta tank0_x', '    inc tank0_x'])).toBe(10);
  });

  it('ignores labels, comments and blank lines', () => {
    expect(cycleCost(['; a comment', '', '.label', '    lda #$08  ; trailing'])).toBe(2);
  });

  // Worst case, not actual: a branch that is taken costs 3, and 4 if it crosses
  // a page. The budget has to hold for the slowest path, so the cost function
  // charges the slowest path.
  it('charges a branch its taken-and-page-crossing cost', () => {
    expect(cycleCost(['    bne .skip'])).toBe(4);
  });

  it('charges an indexed read its page-crossing penalty', () => {
    // lda abs,y is 4 base, 5 across a page.
    expect(cycleCost(['    lda TankSprite,y'])).toBe(5);
  });

  // THE known-positive. A cost function that silently skipped what it could not
  // parse would report a plausible number for code it had not costed -- the
  // "detector that cannot fail" defect, in the one place a wrong number buys a
  // frame that is too long.
  it('throws on an instruction it cannot cost, rather than skipping it', () => {
    expect(() => cycleCost(['    frobnicate #$08'])).toThrow(/frobnicate/);
  });

  // Lowered rule code is straight-line with forward branches. A backward branch
  // is a loop, and a loop needs a trip count nothing here has.
  it('throws on a backward branch, because a loop has no worst case here', () => {
    expect(() => cycleCost(['.loop', '    dex', '    bne .loop'])).toThrow(/loop/i);
  });
});
```

- [x] **Step 2 — run, watch all six fail.**

- [x] **Step 3 — implement.** Append to `cycles.ts`:

```ts
/** Modes whose indexed read can cross a page and cost one more cycle. */
const PAGE_PENALTY_MODES: ReadonlySet<Mode> = new Set<Mode>(['abx', 'aby', 'izy']);

/**
 * Worst-case CPU cycles for a fragment of emitted assembly.
 *
 * Reads the TEXT rather than modelling what the emitter meant to produce. Two
 * independent routes to one number is the only arrangement where asserting the
 * number proves anything -- the same reason `wsyncLines` re-reads the emitter's
 * output instead of asking it.
 *
 * WORST CASE throughout: a branch is charged as taken and page-crossing, and an
 * indexed read is charged as crossing. A budget that assumed the fast path would
 * pass a scene that overruns on the slow one.
 */
export function cycleCost(lines: readonly string[]): number {
  let total = 0;
  const labels = new Set<string>();

  for (const raw of lines) {
    const text = raw.split(';')[0]?.trim() ?? '';
    if (text === '') continue;

    const label = /^([.\w]+)$/.exec(text);
    if (label?.[1]) {
      labels.add(label[1]);
      continue;
    }

    const parsed = parseInstruction(text);
    if (!parsed) {
      throw new Error(
        `cycleCost cannot cost "${text}". It reads the two forms the rule lowerer ` +
          'emits and refuses to guess at a third, because a skipped instruction is a ' +
          'budget that passes code it never counted.',
      );
    }

    const { mnemonic, mode, operand } = parsed;
    if (mode === 'rel') {
      if (labels.has(operand)) {
        throw new Error(
          `cycleCost found a backward branch to "${operand}": that is a loop, and a ` +
            'loop needs a trip count this function does not have. Lowered rule code is ' +
            'straight-line with forward branches only.',
        );
      }
      total += baseCycles(opcodeFor(mnemonic, mode)) + 2; // taken, across a page
      continue;
    }

    total += baseCycles(opcodeFor(mnemonic, mode));
    if (PAGE_PENALTY_MODES.has(mode)) total += 1;
  }

  return total;
}
```

      `parseInstruction` and `opcodeFor` are small local helpers: split the mnemonic from the
      operand, classify the mode from the operand's shape (`#` immediate, `,y` indexed, a
      bare symbol as `abs` or `zp`, a branch mnemonic as `rel`), and look the pair up in the
      assembler's `OPCODES`. **`opcodeFor` throws when the pair is not in `OPCODES`** — the
      assembler would have rejected it too, and failing here says so earlier.

      `Mode` and `OPCODES` come from `@player1dsl/assembler`. That is a new runtime → assembler
      dependency; add `{ "path": "../assembler" }` to `packages/runtime/tsconfig.json`. It does
      not violate the split — the assembler is not the checker.

- [x] **Step 4 — run, all pass. Commit.**

```bash
git add packages/runtime/src/cycles.ts packages/runtime/test/cycles.test.ts \
        packages/runtime/tsconfig.json
git commit -m "Task 4: cost the code by reading it, and refuse what it cannot read"
```
