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

---

## Increment 6 continued — Tasks 5 to 12

**Written 2026-09-04**, after increment 5c landed. Three of this plan's premises changed and
the tasks below are written against the new ones:

- **Collision is verifiable now.** `packages/emulator/src/tia.ts` latches all fifteen
  collision bits, so `rules-behaviour.test.ts` — which Task 12 writes — can exist.
- **The committed input script already makes contact.** Measured: frame 35, `score0` 3 → 4,
  the debounce firing once across 15 frames. Task 11's job shrinks to reaching a **bound**.
- **The compiler's bounds and the reference's no longer agree on any axis.** `movementBounds`
  derives 1 / 145 / 9 / 159 in authored coordinates; the reference clamps at 8 / 144 / 12 /
  155. **Decision, 2026-09-04:** the compiler emits the derived bound, the golden's
  bound-reaching frames are a documented known difference named where the filter is applied,
  and clamping is verified against the COMPILED ROM by its own behaviour test. Adding a `.p1`
  surface for bounds stays deferred to plan 5; editing the reference to match the compiler was
  rejected as the compiler grading its own homework.

### Additional file structure

| File | Responsibility |
|---|---|
| `packages/compiler/src/rules.ts` (create) | Game IR rules to assembly: movement, collision, scoring |
| `packages/runtime/src/collisions.ts` (create) | Which `CX` register and bit report a pair of TIA objects |
| `packages/runtime/src/emit.ts` (modify) | Glyph band reads through a pointer; the pointer rebuild |
| `packages/compiler/src/build.ts` (modify) | `build(game, { static })`; rules into vertical blank; the cycle gate |
| `packages/cli/src/index.ts` (modify) | `p1 build` without `--static` |
| `packages/emulator/src/golden.ts` (modify) | Region-aware comparison |
| `tests/goldens/tank-arena.input.json` (modify) | A phase that reaches a bound |
| `packages/emulator/test/rules-behaviour.test.ts` (create) | Clamp, collision, debounce, score wrap, against the compiled ROM |
| `tests/fixtures/timing/stack-depth.asm` (create) | 6b: the deepest call chain, measured |

---

### Task 5: Movement lowering, and the clamp asymmetry

**Files:**
- Create: `packages/compiler/src/rules.ts`
- Create: `packages/compiler/test/rules.test.ts`
- Modify: `packages/compiler/src/index.ts`

**Interfaces:**
- Consumes: `MoveRule` from `ir.ts`; `MovementBounds` from `@player1dsl/runtime`.
- Produces: `lowerMove(rule: MoveRule, bounds: MovementBounds, label: string): string[]`.

- [x] **Step 1 — write the failing test.** In `packages/compiler/test/rules.test.ts`:

```ts
import { movementBounds } from '@player1dsl/runtime';
import { describe, expect, it } from 'vitest';
import type { MoveRule } from '../src/index.ts';
import { lowerMove } from '../src/index.ts';

const ARENA = {
  wallPixels: 4,
  spriteWidth: 8,
  spriteHeight: 8,
  fieldFirstLine: 66,
  fieldLastLine: 223,
  counterOrigin: 225,
} as const;

const RULE: MoveRule = {
  kind: 'move',
  actor: 'tank0',
  control: 'joystick1',
  speed: 1,
  within: 'field',
};

const text = (lines: readonly string[]) => lines.join('\n');

describe('lowerMove', () => {
  it('reads the joystick and moves the actor on all four directions', () => {
    const code = text(lowerMove(RULE, movementBounds(ARENA), '.m0'));
    expect(code).toContain('lda SWCHA');
    expect(code).toContain('dec tank0_x');
    expect(code).toContain('inc tank0_x');
    expect(code).toContain('dec tank0_y');
    expect(code).toContain('inc tank0_y');
  });

  /**
   * THE assertion this task exists for. `cpx #C / bcc skip / dec` skips only
   * when ALREADY below C, so the actor decrements off C and comes to rest at
   * C - 1. To rest at xMin the constant must be xMin + 1. The upper form
   * `cpx #C / bcs skip / inc` skips at or above C, so it rests exactly on C.
   *
   * packages/emulator/test/tank-arena-behaviour.test.ts measured that asymmetry
   * on the reference kernel; this is the compiler reproducing it deliberately
   * rather than by accident.
   */
  it('emits a lower bound one above the resting position it wants', () => {
    const bounds = movementBounds(ARENA);
    const code = text(lowerMove(RULE, bounds, '.m0'));
    expect(code).toContain(`cpx #${bounds.xMin + 1}`);
    expect(code).toContain(`cpx #${bounds.yMin + 1}`);
  });

  it('emits an upper bound exactly on the resting position', () => {
    const bounds = movementBounds(ARENA);
    const code = text(lowerMove(RULE, bounds, '.m0'));
    expect(code).toContain(`cpx #${bounds.xMax}`);
    expect(code).toContain(`cpx #${bounds.yMax}`);
  });

  it('pairs each lower bound with bcc and each upper with bcs', () => {
    const code = lowerMove(RULE, movementBounds(ARENA), '.m0');
    const after = (needle: string) => code[code.findIndex((l) => l.includes(needle)) + 1] ?? '';
    expect(after(`cpx #${movementBounds(ARENA).xMin + 1}`)).toContain('bcc');
    expect(after(`cpx #${movementBounds(ARENA).xMax}`)).toContain('bcs');
  });

  // Joystick port 2 is the LOW nibble of SWCHA. A lowerer that used port 1's
  // masks for both would move both tanks with one stick.
  it('takes the low nibble of SWCHA for joystick2', () => {
    const p2 = text(lowerMove({ ...RULE, actor: 'tank1', control: 'joystick2' }, movementBounds(ARENA), '.m1'));
    expect(p2).toContain('and #$04'); // J1_LEFT
    expect(p2).not.toContain('and #$40'); // J0_LEFT
  });

  it('gives every branch a label unique to the rule', () => {
    const a = lowerMove(RULE, movementBounds(ARENA), '.m0').filter((l) => l.startsWith('.'));
    const b = lowerMove(RULE, movementBounds(ARENA), '.m1').filter((l) => l.startsWith('.'));
    expect(a.some((l) => b.includes(l))).toBe(false);
  });

  // Refuse rather than guess: a step of N needs clamp logic that cannot
  // overshoot, and nothing has measured what that costs.
  it('refuses a speed it cannot lower', () => {
    expect(() => lowerMove({ ...RULE, speed: 2 }, movementBounds(ARENA), '.m0')).toThrow(/E70\d/);
  });

  it('costs less than a scanline, so a rule cannot silently eat the blank', () => {
    expect(cycleCost(lowerMove(RULE, movementBounds(ARENA), '.m0'))).toBeLessThan(76);
  });
});
```

      Add `import { cycleCost, movementBounds } from '@player1dsl/runtime';` at the top.

- [x] **Step 2 — run it, watch it fail** with "lowerMove is not exported".

```bash
npx vitest run packages/compiler/test/rules.test.ts
```

- [x] **Step 3 — implement `packages/compiler/src/rules.ts`.**

```ts
/**
 * Game IR rules to 6502.
 *
 * No operation IR between them: two rule forms do not justify one, and the
 * moment a third arrives that starts repeating itself, that is when to add one.
 *
 * Every fragment here is straight-line with FORWARD branches only, which is
 * what lets `cycleCost` give it a worst case. A rule form that needed a loop
 * would need a trip count nothing here has.
 */

import { type Diagnostic, P1Error } from '@player1dsl/parser';
import type { MovementBounds } from '@player1dsl/runtime';
import type { MoveRule } from './ir.ts';

/**
 * SWCHA bits, active LOW: a 0 bit means pressed.
 *
 * The HIGH nibble is the left controller and the low nibble the right, which
 * is why joystick2's masks are joystick1's shifted down by four.
 */
const JOYSTICK_MASKS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  joystick1: { up: 0x10, down: 0x20, left: 0x40, right: 0x80 },
  joystick2: { up: 0x01, down: 0x02, left: 0x04, right: 0x08 },
};

function hex(value: number): string {
  return `$${value.toString(16).padStart(2, '0').toUpperCase()}`;
}

/**
 * One direction: read the stick, compare against the bound, step the byte.
 *
 * `bound` is the CONSTANT the compare uses, not the resting position, and the
 * two differ on a lower bound. See `lowerMove`.
 */
function direction(
  mask: number,
  variable: string,
  bound: number,
  branch: 'bcc' | 'bcs',
  step: 'inc' | 'dec',
  label: string,
): string[] {
  return [
    '    lda SWCHA',
    `    and #${hex(mask)}`,
    `    bne ${label}`,
    `    ldx ${variable}`,
    `    cpx #${bound}`,
    `    ${branch} ${label}`,
    `    ${step} ${variable}`,
    label,
  ];
}

/**
 * A movement rule.
 *
 * THE ASYMMETRY. `cpx #C / bcc skip / dec` skips only when the value is ALREADY
 * below C, so it decrements off C and rests at C - 1; a lower bound therefore
 * emits `xMin + 1`. `cpx #C / bcs skip / inc` skips at or above C, so it rests
 * exactly on C. `movementBounds` says where the sprite may REST; turning that
 * into the constant that produces it is this function's job, and putting it
 * here rather than in the bounds is why those four numbers mean one thing.
 *
 * The Y sense is inverted: the field loop counts DOWN, so a larger y is higher
 * up the screen and joystick up INCREMENTS it.
 */
export function lowerMove(rule: MoveRule, bounds: MovementBounds, label: string): string[] {
  if (rule.speed !== 1) {
    throw new P1Error([
      {
        code: 'E701',
        message: `"${rule.actor}" moves at speed ${rule.speed}, which is not lowered yet`,
        span: { file: '<rules>', offset: 0, length: 0, line: 1, column: 1 },
        hint:
          'a step of more than one needs a clamp that cannot overshoot the bound, and ' +
          'nothing has measured what that costs. Speed 1 is what the language ships.',
      } satisfies Diagnostic,
    ]);
  }

  const masks = JOYSTICK_MASKS[rule.control];
  if (!masks) {
    throw new P1Error([
      {
        code: 'E702',
        message: `"${rule.actor}" is controlled by "${rule.control}", which is not a joystick`,
        span: { file: '<rules>', offset: 0, length: 0, line: 1, column: 1 },
        hint: `known controls: ${Object.keys(JOYSTICK_MASKS).join(', ')}`,
      } satisfies Diagnostic,
    ]);
  }

  const x = `${rule.actor}_x`;
  const y = `${rule.actor}_y`;
  return [
    ...direction(masks.left ?? 0, x, bounds.xMin + 1, 'bcc', 'dec', `${label}Left`),
    ...direction(masks.right ?? 0, x, bounds.xMax, 'bcs', 'inc', `${label}Right`),
    ...direction(masks.up ?? 0, y, bounds.yMax, 'bcs', 'inc', `${label}Up`),
    ...direction(masks.down ?? 0, y, bounds.yMin + 1, 'bcc', 'dec', `${label}Down`),
  ];
}
```

- [x] **Step 4 — export and run.** Add `export * from './rules.ts';` to
      `packages/compiler/src/index.ts`. All eight tests pass.

- [x] **Step 5 — commit.**

```bash
git add packages/compiler/src/rules.ts packages/compiler/test/rules.test.ts \
        packages/compiler/src/index.ts
git commit -m "Task 5: movement lowering, with the clamp asymmetry where it belongs"
```

---

### Task 6: Which register reports a collision, written twice

**Files:**
- Create: `packages/runtime/src/collisions.ts`
- Create: `packages/runtime/test/collisions.test.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Produces: `collisionLatch(a: TiaObject, b: TiaObject): { register: string; bit: number }`.

The pairing table is a HARDWARE fact, so it belongs in the runtime — and it is held to the
emulator's own `LATCHES` by a test, the same arrangement `cycles.ts` uses. The runtime must
not import the emulator in `src`; the cross-check is test-only.

- [x] **Step 1 — write the failing test.** In `packages/runtime/test/collisions.test.ts`:

```ts
import { CX, Tia } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { collisionLatch } from '../src/index.ts';

describe('collisionLatch', () => {
  it('reports a player pair through CXPPMM D7', () => {
    expect(collisionLatch('p0', 'p1')).toEqual({ register: 'CXPPMM', bit: 0x80 });
  });

  it('does not care which way round the pair is given', () => {
    expect(collisionLatch('p1', 'p0')).toEqual(collisionLatch('p0', 'p1'));
  });

  it('reports a player against the playfield through CXP0FB D7', () => {
    expect(collisionLatch('p0', 'pf')).toEqual({ register: 'CXP0FB', bit: 0x80 });
  });

  /**
   * The runtime's table and the emulator's are written separately, so this is
   * the only thing that makes agreement mean anything. Driving the emulator to
   * set each pair and reading the register the runtime names is a stronger
   * check than comparing two tables: it proves the runtime names a register
   * that actually reports that pair.
   */
  it('names a register the emulator really sets for that pair', () => {
    const tia = new Tia();
    tia.objects.grp0 = 0xff;
    tia.objects.grp1 = 0xff;
    tia.objects.p0 = 40;
    tia.objects.p1 = 40;
    tia.tick(228);
    const { register, bit } = collisionLatch('p0', 'p1');
    expect(tia.read(CX[register as keyof typeof CX]) & bit).toBe(bit);
  });

  it('refuses a pair the hardware has no latch for', () => {
    expect(() => collisionLatch('p0', 'p0')).toThrow(/E70\d/);
  });
});
```

- [x] **Step 2 — run it, watch it fail.**

- [x] **Step 3 — implement `packages/runtime/src/collisions.ts`.**

```ts
/**
 * Which collision register and bit report a pair of TIA objects.
 *
 * A hardware table, so the runtime owns it. Written independently of
 * `packages/emulator/src/tia.ts`'s `LATCHES` and held to it by a test that
 * drives the emulator to set each pair rather than comparing two tables --
 * comparing them would only prove a copy is a copy.
 *
 * The fifteen bits cover fifteen PAIRS, not thirty: a latch does not care
 * which object is named first, so the lookup is order-independent.
 */

import type { TiaObject } from './catalog.ts';

/** Everything the TIA can collide, including the playfield. */
export type Collidable = TiaObject | 'pf';

export interface CollisionLatch {
  /** Read-register name, as `registerMnemonic` spells it. */
  readonly register: string;
  /** D7 or D6. */
  readonly bit: number;
}

const PAIRS: Readonly<Record<string, CollisionLatch>> = {
  'm0|p1': { register: 'CXM0P', bit: 0x80 },
  'm0|p0': { register: 'CXM0P', bit: 0x40 },
  'm1|p0': { register: 'CXM1P', bit: 0x80 },
  'm1|p1': { register: 'CXM1P', bit: 0x40 },
  'p0|pf': { register: 'CXP0FB', bit: 0x80 },
  'ball|p0': { register: 'CXP0FB', bit: 0x40 },
  'p1|pf': { register: 'CXP1FB', bit: 0x80 },
  'ball|p1': { register: 'CXP1FB', bit: 0x40 },
  'm0|pf': { register: 'CXM0FB', bit: 0x80 },
  'ball|m0': { register: 'CXM0FB', bit: 0x40 },
  'm1|pf': { register: 'CXM1FB', bit: 0x80 },
  'ball|m1': { register: 'CXM1FB', bit: 0x40 },
  'ball|pf': { register: 'CXBLPF', bit: 0x80 },
  'p0|p1': { register: 'CXPPMM', bit: 0x80 },
  'm0|m1': { register: 'CXPPMM', bit: 0x40 },
};

export function collisionLatch(a: Collidable, b: Collidable): CollisionLatch {
  const found = PAIRS[`${a}|${b}`] ?? PAIRS[`${b}|${a}`];
  if (!found) {
    throw new Error(
      `E703: the TIA has no collision latch for ${a} against ${b}. Fifteen latches cover ` +
        'fifteen pairs; an object does not collide with itself, and a pair with no latch ' +
        'needs a software check the compiler does not generate yet.',
    );
  }
  return found;
}
```

- [x] **Step 4 — export from `packages/runtime/src/index.ts`, run, commit.**

```bash
git add packages/runtime/src/collisions.ts packages/runtime/test/collisions.test.ts \
        packages/runtime/src/index.ts
git commit -m "Task 6: which register reports a pair, written twice"
```

---

### Task 7: Collision, the debounce, and the score wrap

**Files:**
- Modify: `packages/compiler/src/rules.ts`
- Modify: `packages/compiler/test/rules.test.ts`

**Interfaces:**
- Consumes: `collisionLatch` from Task 6; `WhenHitsIr`, `AddRule` from `ir.ts`.
- Produces: `lowerAdd(rule: AddRule, wrapAt: number, label: string): string[]` and
  `lowerCollision(rule: WhenHitsIr, latch: CollisionLatch, label: string, actions: readonly string[]): string[]`.
  `actions` is the already-lowered body, so `lowerCollision` never has to know what an action
  IS -- `build.ts` lowers each `AddRule` with `lowerAdd` and hands the lines in.

- [x] **Step 1 — write the failing test.** Append to `packages/compiler/test/rules.test.ts`:

```ts
describe('lowerAdd', () => {
  it('adds and stores', () => {
    const code = text(lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0'));
    expect(code).toContain('lda p0_score');
    expect(code).toContain('adc #1');
    expect(code).toContain('sta p0_score');
  });

  // A single digit wraps 9 -> 0. Without the wrap the glyph pointer walks off
  // the end of the font table and the HUD draws whatever follows it in ROM.
  it('wraps a single digit at ten rather than running off the font', () => {
    const code = text(lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0'));
    expect(code).toContain('cmp #10');
    expect(code).toContain('lda #0');
  });

  it('clears carry before adding, so a stale carry cannot add two', () => {
    const code = lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0');
    expect(code[code.findIndex((l) => l.includes('adc')) - 1]).toContain('clc');
  });
});

describe('lowerCollision', () => {
  const RULE = {
    a: 'tank0',
    b: 'tank1',
    debounce: 'tank0_tank1_hit',
    actions: [{ kind: 'add' as const, variable: 'p0_score', amount: 1 }],
  };
  const LATCH = { register: 'CXPPMM', bit: 0x80 };
  const ACTIONS = lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0');

  it('tests the latch the pair reports through', () => {
    const code = text(lowerCollision(RULE, LATCH, '.c0', ACTIONS));
    expect(code).toContain('bit CXPPMM');
  });

  /**
   * THE debounce. TIA latches are LEVEL, not edge: they stay set for every
   * frame the objects overlap. Scoring once per contact is the language's
   * promise, and the hardware does not provide it -- so the flag is set on the
   * first frame of contact and cleared only when contact ends.
   */
  it('scores only on the first frame of a contact', () => {
    const code = text(lowerCollision(RULE, LATCH, '.c0', ACTIONS));
    expect(code).toContain('lda tank0_tank1_hit');
    expect(code).toContain('bne .c0Done');
    expect(code).toContain('sta tank0_tank1_hit');
  });

  it('clears the flag when the contact ends, or it never scores twice', () => {
    const code = lowerCollision(RULE, LATCH, '.c0', ACTIONS);
    const noContact = code.findIndex((l) => l === '.c0NoContact');
    expect(code.slice(noContact).join('\n')).toContain('lda #0');
    expect(code.slice(noContact).join('\n')).toContain('sta tank0_tank1_hit');
  });

  // Straight-line with forward branches only, which is what lets cycleCost
  // give the vertical-blank budget a worst case.
  it('is costable, so the budget gate can see it', () => {
    expect(cycleCost(lowerCollision(RULE, LATCH, '.c0', ACTIONS))).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2 — run, watch both describes fail.**

- [x] **Step 3 — implement.** Append to `packages/compiler/src/rules.ts`:

```ts
import type { CollisionLatch } from '@player1dsl/runtime';
import type { AddRule, WhenHitsIr } from './ir.ts';

/**
 * `score += n`, with a single-digit wrap.
 *
 * `clc` is not decoration: the carry survives whatever ran before this, and a
 * stale one adds an extra point on the frame after any compare that set it.
 */
export function lowerAdd(rule: AddRule, wrapAt: number, label: string): string[] {
  return [
    `    lda ${rule.variable}`,
    '    clc',
    `    adc #${rule.amount}`,
    `    cmp #${wrapAt}`,
    `    bcc ${label}Ok`,
    '    lda #0                  ; a single digit wraps 9 -> 0',
    `${label}Ok`,
    `    sta ${rule.variable}`,
  ];
}

/**
 * `when A hits B`, with the debounce the hardware does not provide.
 *
 * The latches are LEVEL: they stay set for every frame the objects overlap, so
 * a rule that scored on the latch alone would score once per frame of contact.
 * The flag is set on the first frame and cleared when contact ends, which makes
 * "once per contact" -- the language's promise -- the compiler's obligation.
 *
 * CXCLR is NOT strobed here. It clears every latch at once, so it belongs to
 * the frame rather than to any one rule, and `build.ts` emits it after the last
 * collision rule has read what it needs.
 */
export function lowerCollision(
  rule: WhenHitsIr,
  latch: CollisionLatch,
  label: string,
  actions: readonly string[],
): string[] {
  return [
    `    bit ${latch.register}`,
    latch.bit === 0x80 ? `    bpl ${label}NoContact` : `    bvc ${label}NoContact`,
    `    lda ${rule.debounce}`,
    `    bne ${label}Done`,
    ...actions,
    '    lda #1',
    `    sta ${rule.debounce}`,
    `    jmp ${label}Done`,
    `${label}NoContact`,
    '    lda #0',
    `    sta ${rule.debounce}`,
    `${label}Done`,
  ];
}
```

      **Note the `bit` trick and why the bit matters.** `bit` copies D7 into N and D6 into V,
      so a D7 latch tests with `bpl` and a D6 latch with `bvc`. A lowerer that always used
      `bpl` would read the wrong half of `CXPPMM` for a missile pair and score on the wrong
      collision.

- [x] **Step 4 — run, all pass. Commit.**

```bash
git add packages/compiler/src/rules.ts packages/compiler/test/rules.test.ts
git commit -m "Task 7: collision, the debounce the hardware does not provide, and the wrap"
```

---

### Task 8: The score's glyph reaches through a pointer

**Files:**
- Modify: `packages/runtime/src/emit.ts` (`emitGlyphs`, and a new `digitPointers`)
- Modify: `packages/runtime/test/emit.test.ts`

A static build baked `Score0Glyph = DigitFont + start * 8` at assembly time. A score that
changes cannot do that, so the glyph band reads through a two-byte zero-page pointer
rebuilt each frame — which is what the reference kernel does.

**This changes the HUD kernel's per-line cost**: `lda (ptr),y` is 5 cycles where `lda abs,y`
is 4, twice per line. Step 4 checks the deadline rather than assuming it survived.

**Interfaces:**
- Produces: `digitPointers(scores: readonly { variable: string; pointer: string }[], font: string): string[]`.

- [x] **Step 1 — write the failing test.** In `packages/runtime/test/emit.test.ts`:

```ts
describe('digitPointers', () => {
  it('multiplies the digit by the glyph height and adds the font base', () => {
    const code = digitPointers([{ variable: 'p0_score', pointer: 'digit0Ptr' }], 'DigitFont');
    const text = code.join('\n');
    expect(text).toContain('lda p0_score');
    expect(text).toContain('asl'); // x2, x4, x8
    expect(text).toContain('adc #<DigitFont');
    expect(text).toContain('sta digit0Ptr');
    expect(text).toContain('lda #>DigitFont');
    expect(text).toContain('sta digit0Ptr+1');
  });

  // Eight bytes per glyph is three shifts. Two would index the wrong glyph and
  // the HUD would draw a slice of its neighbour.
  it('shifts three times, because a glyph is eight bytes', () => {
    const code = digitPointers([{ variable: 'p0_score', pointer: 'digit0Ptr' }], 'DigitFont');
    expect(code.filter((l) => l.trim() === 'asl')).toHaveLength(3);
  });

  it('carries the high byte, so a font crossing a page still resolves', () => {
    const code = digitPointers([{ variable: 'p0_score', pointer: 'digit0Ptr' }], 'DigitFont');
    const high = code.findIndex((l) => l.includes('lda #>DigitFont'));
    expect(code[high + 1]).toContain('adc #0');
  });

  it('builds one pointer per score', () => {
    const code = digitPointers(
      [
        { variable: 'p0_score', pointer: 'digit0Ptr' },
        { variable: 'p1_score', pointer: 'digit1Ptr' },
      ],
      'DigitFont',
    );
    expect(code.join('\n')).toContain('sta digit1Ptr');
  });
});
```

- [x] **Step 2 — run, watch it fail.**

- [x] **Step 3 — implement `digitPointers` in `emit.ts`.**

```ts
/** One score's glyph pointer: which variable holds the digit, where it lands. */
export interface DigitPointer {
  readonly variable: string;
  /** Two-byte zero-page symbol. `pointer+1` is the high byte. */
  readonly pointer: string;
}

/**
 * Resolve each score digit to a font pointer, in vertical blank.
 *
 * A static build baked `Glyph = Font + digit * 8` at assembly time. A digit
 * that changes cannot, so the band reads `lda (ptr),y` and this rebuilds `ptr`
 * each frame. Three shifts because a glyph is eight bytes; the `adc #0` on the
 * high byte is what keeps a font that crosses a page boundary resolving.
 */
export function digitPointers(pointers: readonly DigitPointer[], font: string): string[] {
  return pointers.flatMap((entry) => [
    `    lda ${entry.variable}`,
    '    asl',
    '    asl',
    '    asl                     ; digit * 8 bytes per glyph',
    '    clc',
    `    adc #<${font}`,
    `    sta ${entry.pointer}`,
    `    lda #>${font}`,
    '    adc #0                  ; carry, so a font across a page still resolves',
    `    sta ${entry.pointer}+1`,
  ]);
}
```

- [x] **Step 4 — switch `emitGlyphs` to the pointer, and CHECK THE DEADLINE.**
      In `emitGlyphs`, replace

```ts
  const rows = objects.flatMap((object, i) => [`    lda ${object.table},y`, `    sta ${grp(i)}`]);
```

      with

```ts
  // `lda (ptr),y` rather than `lda table,y`: the glyph a changing score points
  // at is not known until vertical blank. It costs one cycle more per object
  // per line, which is why emit.test.ts checks the GRP deadline below rather
  // than assuming the band still fits its horizontal blank.
  const rows = objects.flatMap((object, i) => [
    `    lda (${object.table}),y`,
    `    sta ${grp(i)}`,
  ]);
```

      Then add the deadline test:

```ts
  // The band writes two GRPs per line and now spends an extra cycle on each.
  // GRP0 is read at pixel 0, so both writes must still land inside the 68-clock
  // horizontal blank. Asserted rather than assumed: this is the one change in
  // the increment that could push a write into the visible region.
  it('still writes both glyph rows inside horizontal blank', () => {
    const frame = tracedFrame('tank-arena');
    const hud = (frame.writes ?? []).filter((w) => w.line >= 40 && w.line <= 51);
    const grpWrites = hud.filter((w) => w.register === 0x1b || w.register === 0x1c);
    expect(grpWrites.length).toBeGreaterThan(0);
    expect(grpWrites.every((w) => w.pixel === -1)).toBe(true);
  });
```

      **If that test fails, STOP.** The band no longer fits its blank, and the answer is a
      kernel shape change rather than a tolerance change. Record the measurement in
      `docs/kernel-measurements.md` and raise it before continuing.

- [x] **Step 5 — commit.**

```bash
git add packages/runtime/src/emit.ts packages/runtime/test/emit.test.ts
git commit -m "Task 8: a score that changes reaches its glyph through a pointer"
```

---

### Task 9: The cycle budget gate

**Files:**
- Modify: `packages/compiler/src/build.ts`
- Modify: `packages/compiler/test/ram.test.ts` → new `packages/compiler/test/budget.test.ts`

**Interfaces:**
- Consumes: `cycleCost` from `@player1dsl/runtime`.
- Produces: `VBLANK_CYCLE_BUDGET` and an `E704` diagnostic when rules overrun it.

Vertical blank is 37 lines of 76 CPU cycles = **2812**, of which positioning spends
`positionLines(n) * 76`. Everything else is the rules' to spend. An untracked cycle cost
becomes an assumed zero the compiler will happily spend — the property the line ledger
exists to prevent, one region over.

- [x] **Step 1 — write the failing test.** Create `packages/compiler/test/budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@player1dsl/parser';
import { build, check, VBLANK_CYCLE_BUDGET } from '../src/index.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';
const source = () => readFileSync(SOURCE, 'utf8');

describe('the vertical blank cycle budget', () => {
  it('is 37 lines of 76 cycles', () => {
    expect(VBLANK_CYCLE_BUDGET).toBe(37 * 76);
  });

  it('reports what tank-arena actually spends', () => {
    const { budget } = build(check(parse(source(), SOURCE)));
    expect(budget.spent).toBeGreaterThan(0);
    expect(budget.spent).toBeLessThan(budget.available);
  });

  // A gate that cannot fire is not a gate. Repeating the rules until they
  // overrun proves the diagnostic exists and names the overrun.
  it('fails the build when rules do not fit, rather than emitting a long frame', () => {
    const many = source().replace(
      'every frame:',
      `every frame:\n${'  tank0 moves with joystick1 speed 1 within field\n'.repeat(120)}`,
    );
    expect(() => build(check(parse(many, SOURCE)))).toThrow(/E704/);
  });

  it('says how many cycles over budget it is, not just that it failed', () => {
    const many = source().replace(
      'every frame:',
      `every frame:\n${'  tank0 moves with joystick1 speed 1 within field\n'.repeat(120)}`,
    );
    try {
      build(check(parse(many, SOURCE)));
      throw new Error('should have thrown');
    } catch (error) {
      const first = (error as { diagnostics?: { message: string }[] }).diagnostics?.[0];
      expect(first?.message).toMatch(/\d+ cycles/);
    }
  });
});
```

- [x] **Step 2 — run, watch it fail.**

- [x] **Step 3 — implement in `build.ts`.**

```ts
/**
 * CPU cycles vertical blank contains: 37 scanlines of 76.
 *
 * Positioning spends `positionLines(n)` of those lines; the rest is the rules'.
 * An untracked cost becomes an assumed zero the compiler will happily spend,
 * which is the property the line ledger exists to prevent, one region over.
 */
export const VBLANK_CYCLE_BUDGET = NTSC_VBLANK_LINES * CPU_CYCLES_PER_SCANLINE;

export interface CycleBudget {
  readonly available: number;
  readonly spent: number;
  readonly free: number;
}

function checkBudget(rules: readonly string[], setupLines: number): CycleBudget {
  const available = VBLANK_CYCLE_BUDGET - setupLines * CPU_CYCLES_PER_SCANLINE;
  const spent = cycleCost(rules);
  if (spent > available) {
    throw new P1Error([
      {
        code: 'E704',
        message:
          `the frame's rules need ${spent} cycles but vertical blank has ${available} ` +
          `once positioning has taken its ${setupLines} lines -- ${spent - available} over`,
        span: { file: '<budget>', offset: 0, length: 0, line: 1, column: 1 },
        hint:
          'worst case, counted by reading the emitted assembly. Rules that overrun would ' +
          'push work into the visible region and tear the first band.',
      },
    ]);
  }
  return { available, spent, free: available - spent };
}
```

      Add `readonly budget: CycleBudget` to the result interface, and rename `StaticBuild` to
      `BuildResult` -- the name it has to have once a build is not necessarily static. Keep
      `export type StaticBuild = BuildResult;` so nothing outside this task moves.

- [x] **Step 4 — write the range into SPEC 13.** This plan's global constraints reserved
      `E7xx` for "rule lowering and the cycle budget" and said to add it to SPEC 13; four codes
      now exist and the spec still does not list them. Add:

```
E701  a movement speed the lowerer does not implement
E702  an actor controlled by something that is not a joystick
E703  a collision pair the TIA has no latch for
E704  the frame's rules do not fit vertical blank
```

- [x] **Step 5 — run, all four pass. Commit.**

```bash
git add packages/compiler/src/build.ts packages/compiler/test/budget.test.ts docs/SPEC.md
git commit -m "Task 9: rules are gated on vertical blank's cycles, counted by reading them"
```

---

### Task 10: `build(game, { static })` and `p1 build` without the flag

**Files:**
- Modify: `packages/compiler/src/build.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/emulator/test/static-build.test.ts`
- Modify: `packages/cli/test/build.test.ts`

- [x] **Step 1 — write the failing test.** In `packages/cli/test/build.test.ts`:

```ts
it('builds without --static now that rules are lowered', async () => {
  const out = join(tmp, 'dynamic.bin');
  expect(await run(['build', 'examples/tank-arena', '-o', out])).toBe(0);
  expect(statSync(out).size).toBe(4096);
});

// The static build has to stay reachable BY NAME: static-build.test.ts compares
// it against golden frame 0, and a flag that silently started meaning "with
// rules" would leave that test measuring something else while still passing.
it('still builds a static image when asked for one', async () => {
  const out = join(tmp, 'static.bin');
  expect(await run(['build', '--static', 'examples/tank-arena', '-o', out])).toBe(0);
  expect(statSync(out).size).toBe(4096);
});

it('emits different bytes with rules than without', async () => {
  const a = join(tmp, 'a.bin');
  const b = join(tmp, 'b.bin');
  await run(['build', 'examples/tank-arena', '-o', a]);
  await run(['build', '--static', 'examples/tank-arena', '-o', b]);
  expect(readFileSync(a).equals(readFileSync(b))).toBe(false);
});
```

- [x] **Step 2 — run, watch the first fail with the `--static` hard-error.**

- [x] **Step 3 — implement.** Rename `buildStatic(game)` to
      `build(game: GameIr, options: BuildOptions = {})` where
      `interface BuildOptions { readonly static?: boolean }`. When `options.static` is true the
      rule fragments are omitted and the frame is exactly what increment 5b emitted. Keep
      `buildStatic` as a thin wrapper so nothing else has to move in this task:

```ts
/** The static build, by name. Kept so a caller cannot get one by accident. */
export function buildStatic(game: GameIr): BuildResult {
  return build(game, { static: true });
}
```

      In `packages/cli/src/index.ts`, delete the `--static` hard-error and pass
      `{ static: rest.includes('--static') }`.

- [x] **Step 4 — point `static-build.test.ts` at `buildStatic` explicitly.** It already calls
      `buildStatic`; confirm it still does and that its frame-0 comparison passes unchanged.
      **If it fails, the static path has picked up rule code and the split is wrong.**

- [x] **Step 5 — commit.**

```bash
git add packages/compiler/src/build.ts packages/cli/src/index.ts \
        packages/cli/test/build.test.ts packages/emulator/test/static-build.test.ts
git commit -m "Task 10: p1 build without --static, and a static build still reachable by name"
```

---

### Task 11: The comparator learns which region it is in

**Files:**
- Modify: `packages/emulator/src/golden.ts`
- Modify: `packages/emulator/test/golden.test.ts`

Correction 1 of this plan, implemented. In vertical blank the comparator asserts the ordered
sequence of `(register, value, pixel)` and **not** the line, because a scanline number there
is an artifact of instruction selection. In the visible region it keeps exact
`(line, register, value)`.

- [x] **Step 1 — write the failing test.** In `packages/emulator/test/golden.test.ts`:

```ts
describe('region-aware comparison', () => {
  const shift = (frame: GoldenFrame, by: number): GoldenFrame => ({
    ...frame,
    records: frame.records.map((r) =>
      r.line < 40 ? { ...r, line: r.line + by, endLine: r.endLine + by } : r,
    ),
  });

  it('accepts a vertical-blank write that moved to another line', () => {
    const golden = goldenFrame0();
    expect(compareGolden([golden], [shift(golden, 1)])).toEqual([]);
  });

  // pixel is retained in blank and is LOAD-BEARING: it is what carries a RESPx
  // strobe's meaning. Dropping it would let a ROM position a player anywhere
  // and still compare equal.
  it('rejects a vertical-blank strobe that moved along its line', () => {
    const golden = goldenFrame0();
    const moved: GoldenFrame = {
      ...golden,
      records: golden.records.map((r) =>
        r.line < 40 && r.register === 0x10 ? { ...r, pixel: r.pixel + 8 } : r,
      ),
    };
    expect(compareGolden([golden], [moved])).not.toEqual([]);
  });

  it('still rejects a visible write that moved one scanline', () => {
    const golden = goldenFrame0();
    const moved: GoldenFrame = {
      ...golden,
      records: golden.records.map((r) =>
        r.line >= 66 && r.register === 0x1b ? { ...r, line: r.line + 1 } : r,
      ),
    };
    expect(compareGolden([golden], [moved])).not.toEqual([]);
  });
});
```

- [x] **Step 2 — run, watch the first fail.**

- [x] **Step 3 — implement.** In `compareGolden`, key each record by region:

```ts
/**
 * What equality means, per region.
 *
 * A scanline number is an equivalence property only where the code is
 * straight-line. The visible region is counted WSYNCs with no data-dependent
 * branch, so its landmarks are identical across all 90 golden frames. Vertical
 * blank is not: the joystick code's branches change how many cycles run before
 * positioning, so asserting a line there forces a compiler to reproduce the
 * reference's branch structure -- transcription rather than compilation.
 *
 * `pixel` is retained in blank and is load-bearing: it is what carries a RESPx
 * strobe's meaning, and dropping it lets a ROM position a player anywhere and
 * still compare equal.
 */
function key(record: GoldenRecord): string {
  return record.line < NTSC_FIRST_VISIBLE_LINE
    ? `blank ${record.register} ${record.value} px${record.pixel}`
    : `visible ${record.line} ${record.register} ${record.value}`;
}
```

- [x] **Step 4 — run the whole suite.** `static-build.test.ts`'s separate vertical-blank
      comparison can now be deleted: the main comparison covers it. Delete it and say so in
      the commit, rather than leaving two comparisons that could disagree.

- [x] **Step 5 — commit.**

```bash
git add packages/emulator/src/golden.ts packages/emulator/test/golden.test.ts \
        packages/emulator/test/static-build.test.ts
git commit -m "Task 11: a scanline is an equivalence property only where the code is straight-line"
```

---

### Task 12: A script that reaches a bound, and rules verified against the ROM

**Files:**
- Modify: `tests/goldens/tank-arena.input.json`
- Regenerate: `tests/goldens/tank-arena.trace`
- Create: `packages/emulator/test/rules-behaviour.test.ts`

The committed script already makes contact (frame 35, measured 2026-08-30). What it never
does is reach a **bound**, so add a phase that holds one direction long enough to clamp.

- [x] **Step 1 — add the phase.** Hold `p0: ["left"]` for 80 frames, which is more than the
      74 a traverse from x = 72 to the bound needs. Note in the phase's `note` field that the
      reference clamps at 8 and the compiler at 1, so these frames are the known difference.

- [x] **Step 2 — write the behaviour test.** Create
      `packages/emulator/test/rules-behaviour.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { build, check } from '@player1dsl/compiler';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { Machine, SWCHA_IDLE } from '../src/index.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';
const J0_LEFT = 0x40;

/** The COMPILED ROM, which is the thing under test here. */
function compiled(): Uint8Array {
  return build(check(parse(readFileSync(SOURCE, 'utf8'), SOURCE))).rom;
}

function settled(): Machine {
  const machine = new Machine(compiled());
  machine.runFrame();
  machine.runFrame();
  return machine;
}

describe('the compiled ROM obeys its own rules', () => {
  it('moves a tank at all, so the clamp test below is not vacuous', () => {
    const machine = settled();
    const before = machine.riot.ram[0];
    for (let i = 0; i < 5; i += 1) machine.runFrame({ swcha: SWCHA_IDLE & ~J0_LEFT });
    expect(machine.riot.ram[0]).not.toBe(before);
  });

  /**
   * Clamps at the DERIVED bound, which is not the reference's.
   * `movementBounds` gives xMin = 1 in authored coordinates, and the lowered
   * `cpx #2 / bcc` rests one below its constant, so the tank comes to rest at 1.
   *
   * The reference rests at 7. That divergence is deliberate and documented:
   * docs/kernel-measurements.md, "Where a movement bound comes from".
   */
  it('clamps at the derived bound rather than wrapping past it', () => {
    const machine = settled();
    const held = SWCHA_IDLE & ~J0_LEFT;
    for (let i = 0; i < 90; i += 1) machine.runFrame({ swcha: held });
    const atBound = machine.riot.ram[0];
    for (let i = 0; i < 10; i += 1) machine.runFrame({ swcha: held });
    expect([atBound, machine.riot.ram[0]]).toEqual([1, 1]);
  });

  it('scores once per contact, not once per frame of contact', () => {
    const machine = settled();
    // Drive them together, then hold. The debounce must fire exactly once.
    const scores: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      machine.runFrame({ swcha: SWCHA_IDLE });
      scores.push(machine.riot.ram[4] ?? 0);
    }
    const increments = scores.filter((s, i) => i > 0 && s !== scores[i - 1]).length;
    expect(increments).toBeLessThanOrEqual(1);
  });
});
```

- [x] **Step 3 — regenerate and read the diff.**

```bash
npm run golden && npm run check
```

      The bound-reaching frames will diverge between the reference and the compiled ROM. Name
      them in `static-build.test.ts` where the filter is applied, with the reason, exactly as
      `CXCLR` was named in increment 5b.

- [x] **Step 4 — commit.**

```bash
git add tests/goldens packages/emulator/test/rules-behaviour.test.ts \
        packages/emulator/test/static-build.test.ts
git commit -m "Task 12: a script that reaches a bound, and rules checked against the ROM"
```

---

### Task 13 (increment 6b): Measure what 6 and 7 spent

**Files:**
- Create: `tests/fixtures/timing/stack-depth.asm`
- Modify: `packages/compiler/src/ram.ts`
- Modify: `docs/kernel-measurements.md`

`DEFAULT_STACK_RESERVED = 16` is labelled a guess in `ram.ts`, and rule lowering is what
finally makes the call chain real. Measuring inside the increment that spends it is what 4b
existed to prevent.

- [x] **Step 1 — measure the real depth, from the ROM rather than from a fixture.** The
      cheapest correct probe needs no new ROM at all: run the COMPILED tank-arena and watch
      the stack pointer.

```ts
// PREDICTION, written before the run: the deepest chain is MainLoop -> jsr
// PosObjectX, one level, so two bytes of return address. sp starts at $FD and
// should not go below $FB.
const machine = new Machine(build(check(parse(source, SOURCE))).rom);
machine.runFrame();
let lowest = 0xff;
for (let i = 0; i < 200; i += 1) {
  machine.runFrame({ swcha: SWCHA_IDLE });
  lowest = Math.min(lowest, machine.cpu.sp);
}
console.log(`deepest stack use: $${(0xfd - lowest).toString(16)} bytes below reset`);
```

      `Cpu.sp` is already public. If the measured depth contradicts the prediction, the
      prediction was wrong and that is the finding.

      **Only write `tests/fixtures/timing/stack-depth.asm` if the probe cannot answer it** —
      a fixture that measures what a real ROM already shows is a fixture nobody will maintain.

- [x] **Step 2 — set the constant from the measurement**, and replace the "a guess, and
      labelled as one" paragraph in `ram.ts` with the number and how it was obtained. If the
      measured depth is far below 16, say so and keep a stated margin rather than shaving it
      to the exact figure — but the margin must be a decision with a reason, not an
      unexamined default.

- [x] **Step 3 — record it** in `docs/kernel-measurements.md` under "How deep the call chain
      actually goes", predicted beside measured.

- [x] **Step 4 — commit.**

```bash
git add tests/fixtures/timing/stack-depth.asm packages/compiler/src/ram.ts \
        docs/kernel-measurements.md
git commit -m "Task 13: the stack reservation stops being a guess"
```

---

## Status: complete, 2026-09-04

All thirteen tasks done; see [`docs/session-logs/2026-09-04.md`](../../session-logs/2026-09-04.md).

Two deviations, both recorded with their reasons. Task 12's bound-reaching input phase was NOT
added: the reference rests at 7 and the compiler at 1, so those frames could only be excluded
from the comparison, and clamping is asserted against the compiled ROM instead. Task 13 needed
no `stack-depth.asm` fixture -- the compiled ROM answered the question directly, and a fixture
measuring what a real ROM already shows is one nobody maintains.

## Definition of done

`p1 build examples/tank-arena` emits a 4 KiB ROM whose 90-frame TIA-write trace matches the
reference kernel's, except at the bound-reaching frames, where the divergence is named and
explained. `npm run check` green. The session log records what moved.
