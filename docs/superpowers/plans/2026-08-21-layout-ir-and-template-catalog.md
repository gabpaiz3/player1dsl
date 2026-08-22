# Layout IR, Line Ledger, and Template Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the compiler a hardware-aware layer — bands projected onto TIA objects, a line ledger that independently derives the field's 158 scanlines and fails the build if the frame does not sum to 192, a template catalog whose costs and writes are declared as data, and a still-frame ROM you can load in Stella.

**Architecture:** The game IR is projected onto a layout IR: actors bound to TIA objects, bands decomposed into row groups, each row group carrying a line count that comes from template data rather than from compiler arithmetic. The ledger sums those counts against the target's visible-line budget and is a hard gate. A new `packages/runtime` owns every measured number — line costs, cycle costs, the register writes each template emits and the timing class of each — so the compiler derives only object counts and the one remainder.

**Tech Stack:** TypeScript (ESM, `.ts` extensions in imports), Node 20+, npm workspaces, vitest, Biome. DASM and Stella remain dev-only.

**Spec:** [`docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md`](../specs/2026-08-19-tank-arena-compiler-design.md)

**Second review folded in:** [`docs/spec-review-0.2.md`](../../spec-review-0.2.md)

## Plan scope

**Plan 3 of 4** for roadmap step 3, covering spec increments **4, 4b and 5**, plus one
increment this plan adds (**5b**, the still-frame ROM).

| Plan | Increments | Deliverable | State |
|---|---|---|---|
| [1](2026-08-19-golden-trace-harness.md) | 1a, 1b | Golden trace harness and comparator | done |
| [2](2026-08-20-parser-and-game-ir.md) | 2, 3 | Parser, AST, `p1 fmt`, checker, game IR, RAM allocator | done |
| 3 (this) | 4, 4b, 5, **5b** | Layout IR, line ledger, kernel fixtures, template catalog, still-frame ROM | — |
| 4 | 6, 7 | Rule lowering, `p1 build` end to end | to write |

Done when `p1 check examples/tank-arena` prints a balanced ledger that derives 158 field
lines and rejects an unbalanced scene, three kernel-shape fixtures have been measured and
the catalog vocabulary revised against them, the selector chooses templates from declared
data, and `p1 build --static examples/tank-arena` emits a 4096-byte ROM that runs 262
lines split 3/37/192/30 in our emulator and can be opened in Stella.

**Why increment 5b exists.** It was added during planning, at the user's request, because
`expect(ledger.fieldLines).toBe(158)` asserts only that the compiler computes what the
compiler computes — [testing.md](../../testing.md) discipline 3, the defect class that has
now appeared in two consecutive plans. A ROM built from the ledger and run through our own
emulator is the first thing that can actually falsify it. Stella is the human look; the
emulator assertions are the check.

**Explicitly not in this plan:**

- Rule lowering. No joystick movement, no collisions, no scoring. The still-frame ROM is
  static on purpose — it renders the scene's initial state and nothing animates.
- `within field` interpretation and the measured clamp asymmetry (`X_MIN - 1` lower,
  `Y_MAX` upper). Plan 4.
- Object position tracking in the emulator. `GRP0`/`GRP1` keep the conservative pixel-0
  bound and its two known-benign false positives.
- The deterministic PNG raster capture recommended by [review 0.2 §1.2](../../spec-review-0.2.md).
  That needs a pixel renderer the TIA model does not have; it is plan 4 or later. The
  still-frame ROM gives a Stella picture, which is a *compatibility* artifact, not the
  canonical automated one. Do not conflate them.
- Measuring `DEFAULT_STACK_RESERVED`. It is still a guess, still labelled as one in
  `packages/compiler/src/ram.ts`, and the deepest call chain only exists once rule lowering
  does. Plan 4.

## Global Constraints

- Node 20+; npm workspaces (**not** pnpm). Never run `pnpm`.
- Imports use explicit `.ts` extensions (`from './layout.ts'`), matching every existing file.
- `npm run lint` (Biome), `npm run typecheck` (`tsc --build`) and `npm test` must pass.
- Every diagnostic carries a source span and a code. Layout codes are **`E5xx`**, catalog
  and selector codes are **`E6xx`**, continuing the ranges plan 2 invented (`E0xx` lexer,
  `E1xx` parser, `E2xx` checker, `E3xx` RAM, `E4xx` CLI). SPEC §13 only ever defined `E230`;
  this is where the collision would start if the language reference wants these ranges.
- **`packages/runtime` owns every measured number. `packages/compiler` owns only what it
  derives.** If a task in the compiler starts wanting to know how many scanlines something
  costs, that number belongs in the runtime as template data instead.
- **Never tune a constant to make a number appear.** If a measurement contradicts a
  prediction, record both — in the test comment, the commit message, and the session log.
- Every detector, gate, or comparator ships with a **known-positive**: an input it must
  reject, committed beside the input it must accept ([testing.md](../../testing.md) 1).
- Work on branch `step3-plan3-layout-and-catalog`. Push early — CI runs on every branch
  push, not only on pull requests.

## Three corrections this plan carries

Two are corrections to the approved design; one is a review item folded in. All three are
already applied to the design document, so it and this plan agree.

### 1. The field-setup line is a template entry cost, not a region-change rule

The design originally stated: *"a region change immediately following a loop exit costs one
line, because the loop falls through mid-line and leaves no horizontal blank."*

**The trace contradicts it.** The reference ROM contains **two** region changes following a
loop exit:

| Boundary | Predicted | Measured | Evidence in `tests/goldens/tank-arena.trace`, frame 0 |
|---|---|---|---|
| top wall to field loop | 1 | **1** | wall run 57–64; field setup writes at line 65; field renders from 66 |
| field loop to bottom wall | 1 | **0** | field renders through 223; line 224 carries `PF0/PF1/PF2` *and* is the first of the wall's 8 lines (224–231) |

The general rule predicts 1 for both, so it is wrong. **The discriminator is where a loop
writes its per-line registers:**

- A loop that writes per-line registers in the horizontal blank at the **top of each
  iteration** cannot render its first line without data that already exists, so it renders
  `entry+1 … entry+N` and charges **1** entry line. That is `two-sprite-static-field`:
  `GRP0`/`GRP1` are written right after `WSYNC` from `gfx0`/`gfx1`, primed on line 65.
- A loop whose registers are set **once before** it runs is valid from that same line, so it
  renders `entry … entry+N-1` and charges **0**. That is `solid-run`.

The arithmetic is unchanged — `158 = 192 − 12 − 5 − 8 − 1 − 8` — but the number moves from
compiler-derived to template-declared, which is where the design's own runtime/compiler
split says a measured number belongs. **This also answers the design's open question**
about whether that line is a template cost or a general rule; `solid-run` is the second
catalog entry that was expected to discriminate, and it is already in this ROM.

**Consequence for task design:** the `CostModel` abstraction this plan was originally going
to need does not survive. What is left of "cost rules the compiler applies" is a single
integer — `n`, how many objects a boundary repositions. Do not build an injectable
cost-rule interface for that.

### 2. The colour clock is asserted for beam-position-sensitive strobes

[Review 0.2 §1.1](../../spec-review-0.2.md) is right that the design's blanket "record the
clock, never assert it" is unsound. `RESP0`, `RESP1`, `RESM0`, `RESM1` and `RESBL` take
effect from where the beam is, so a ROM can match `(line, register, value)` *and* its
deadline while drawing the tank somewhere else. Frame 0 of the golden already shows the
clock carrying the position: `5 RESP0 $60 px52`.

Three timing classes, not the review's two:

| Class | Registers | What the comparator asserts |
|---|---|---|
| `exact` | `RESP0`, `RESP1`, `RESM0`, `RESM1`, `RESBL` | the colour clock, exactly |
| `blank` | `HMOVE`, `RSYNC` | the write landed in horizontal blank (`pixel < 0`); clock otherwise free |
| `deadline` | `PF0`–`PF2`, `GRP0`, `GRP1`, `COLUP0`, `COLUP1`, `COLUBK`, everything else | the write precedes the register's first read pixel |

`exact` is a **conservative over-constraint and knowingly so**: final position is
`(coarse clock, HMPx fine value)`, so a different pair encodes the same *x*. Asserting the
clock rejects those alternative encodings — no false negatives, some false positives on
legal-but-different positioning. Object position tracking is the principled fix and is out
of scope. Since `HMPx` values are already compared for equality, the pair pins position
exactly for any ROM positioning the way the reference does. **Do not re-litigate this
during increment 5** — it is settled here with its cost stated.

Review 0.2 asks that *templates* declare the class and the comparator consume the
declaration "rather than maintain a second, disconnected rule table". Which registers are
beam-sensitive is a **hardware fact**, not a template choice, so the table lives in
`packages/emulator/src/trace.ts` beside `FIRST_READ_PIXEL`. Templates declare the writes
they emit *and* the class they believe each has, and **Task 13 asserts the two agree** — one
source of truth, with the disconnection the review warns about made a test failure.

### 3. Review 0.2 §2.3's catalog fields are deferred until after increment 4b — deliberately

Review 0.2 §2.3 asks that the three genre-survey gaps become *required* catalog fields now.
That directly conflicts with why increment 4b exists: the vocabulary is measured against
three shapes before it is committed, which is the roadmap's core ordering argument. This
plan keeps 4b first and revises the vocabulary in **Task 9**, against numbers rather than
against the survey's own predictions. The review recommendation is recorded here so a future
reader sees it was read and consciously sequenced, not missed.

## File Structure

| File | Responsibility |
|---|---|
| `packages/compiler/src/layout.ts` (create) | Game IR to layout IR: object binding, band decomposition into row groups |
| `packages/compiler/src/ledger.ts` (create) | Row groups to ledger; the hard gate and its diagnostics |
| `packages/compiler/src/index.ts` (modify) | Export the two above |
| `packages/runtime/package.json` (create) | Workspace manifest |
| `packages/runtime/src/catalog.ts` (create) | Catalog types: applicability, costs, declared writes |
| `packages/runtime/src/entries.ts` (create) | The three entries, as data |
| `packages/runtime/src/select.ts` (create) | Selector: band requirements to entry, or a diagnostic |
| `packages/runtime/src/emit.ts` (create) | Template to assembly fragment |
| `packages/runtime/src/frame.ts` (create) | Frame driver: VSYNC/VBLANK/overscan, TIM64T, reset vectors |
| `packages/runtime/src/index.ts` (create) | Public exports |
| `packages/compiler/src/build.ts` (create) | Layout + catalog to assembly source to 4096 bytes |
| `packages/emulator/src/trace.ts` (modify) | `WRITE_TIMING_CLASS`, `timingClass()` |
| `packages/emulator/src/golden.ts` (modify) | Comparator consumes timing classes |
| `packages/cli/src/index.ts` (modify) | Ledger in `p1 check`; new `p1 build --static` |
| `tests/fixtures/kernels/scroll-field.asm` (create) | 4b fixture: playfield rewritten per line |
| `tests/fixtures/kernels/ball-and-paddles.asm` (create) | 4b fixture: two players + ball, no runs |
| `tests/fixtures/kernels/sprite-formation.asm` (create) | 4b fixture: one object multiplexed across a row |
| `tests/fixtures/timing/resp-shift.asm` (create) | Known-positive for the `exact` clock class |
| `docs/kernel-measurements.md` (create) | What the three fixtures measured, and the vocabulary revision |
| `docs/session-logs/2026-08-21.md` (create) | This session's log |

`layout.ts` and `ledger.ts` are split because the ledger is the hard gate and deserves its
own test file and its own known-positives; the decomposition that feeds it is ordinary
projection. `catalog.ts` holds types only, so `entries.ts`, `select.ts` and `emit.ts` can
each depend on it without depending on each other.

**Dependency direction:** `runtime` depends only on `@player1dsl/parser`, for `Span` and
`Diagnostic` — the selector has to be able to point at the band it could not satisfy, and
inventing a second diagnostic type so the runtime can avoid one import would be worse than
the import. `compiler` depends on `runtime`. **`runtime` must never import from `compiler`,
which is why `TiaObject` and `ObjectBinding` live in the runtime** (see below). `emulator`
depends on neither — Task 13's agreement test lives in the runtime's test directory and
imports both, so the hardware table stays the source of truth without the emulator learning
what a template is.

**Where `ObjectBinding` lives, and why it is not obvious.** It reads like a compiler concept:
the compiler is what binds an actor to an object. But `emitRowGroup` needs the bindings to
emit a kernel, and it lives in the runtime — so putting the type in `layout.ts` makes the
runtime depend on the compiler and closes a cycle. It belongs in the runtime on this plan's
own rule anyway: *which movable objects exist* is a hardware fact, and `TiaObject` is a
five-element enumeration of what the TIA has. The compiler owns the **binding decision**;
the runtime owns the **vocabulary** the decision is expressed in.

---
## Increment 4 — the layout IR and the line ledger

### Task 1: The runtime package and its first measured numbers

**Files:**
- Create: `packages/runtime/package.json`, `packages/runtime/tsconfig.json`
- Create: `packages/runtime/src/catalog.ts`, `packages/runtime/src/entries.ts`, `packages/runtime/src/index.ts`
- Create: `packages/runtime/test/costs.test.ts`
- Modify: `tsconfig.json` (add the project reference)

**Interfaces:**
- Consumes: `Span` from `@player1dsl/parser`, and nothing else.
- Produces: `TiaObject`, `ObjectBinding`, `TemplateCost`, `TemplateEntry`,
  `repositionLines(count: number): number`, `ENTRIES: readonly TemplateEntry[]`,
  `entryById(id: string): TemplateEntry | undefined`.

This task exists first so that **no line count is ever written into the compiler**. Task 4's
ledger reads every number from here.

- [ ] **Step 1: Read the existing manifests to copy their shape**

Run: `cat packages/compiler/package.json packages/compiler/tsconfig.json tsconfig.json`

Do not invent a different shape. Match what is there.

- [ ] **Step 2: Create the manifest and tsconfig**

`packages/runtime/package.json`:

```json
{
  "name": "@player1dsl/runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@player1dsl/parser": "*"
  }
}
```

Create `packages/runtime/tsconfig.json` matching `packages/compiler/tsconfig.json` exactly,
adjusting only relative paths and references. Add `packages/runtime` to the root
`tsconfig.json` `references` array in the same format as the existing entries.

- [ ] **Step 3: Write the failing test**

`packages/runtime/test/costs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { entryById, repositionLines } from '../src/index.ts';

describe('repositionLines', () => {
  // MEASURED in step 1, and visible in tests/goldens/tank-arena.trace frame 0:
  // the HUD -> field boundary repositions 2 objects and occupies frame lines
  // 52-56, which is 5 lines. Two per object for the RESPx strobe, plus one to
  // absorb the HMOVE comb on a line whose background can hide it.
  it('charges 2n + 1 visible lines to reposition n objects', () => {
    expect(repositionLines(2)).toBe(5);
    expect(repositionLines(1)).toBe(3);
  });

  // A boundary that repositions nothing costs nothing. Without this the ledger
  // would charge a phantom line to every band boundary in a game that has no
  // movable objects in one of its bands.
  it('charges nothing when no object needs repositioning', () => {
    expect(repositionLines(0)).toBe(0);
  });
});

describe('template entry costs', () => {
  // THE correction this plan carries. The step-3 design predicted that every
  // region change following a loop exit costs one line. The trace shows the
  // reference ROM's TWO such boundaries costing 1 and 0, so the cost belongs to
  // the template rather than to a general rule. See the plan's "Three
  // corrections", and the design doc's 2026-08-21 correction note.
  it('charges the field kernel one entry line because it primes data a line ahead', () => {
    expect(entryById('two-sprite-static-field')?.cost.entryLines).toBe(1);
  });

  it('charges a solid run zero entry lines because its registers are valid from its first line', () => {
    expect(entryById('solid-run')?.cost.entryLines).toBe(0);
  });

  it('charges the score band zero entry lines', () => {
    expect(entryById('bcd-score-band')?.cost.entryLines).toBe(0);
  });

  // Guard against the vacuous-pass class from testing.md 3: every assertion
  // above reads through entryById, which returns undefined for a typo and would
  // make `?.cost.entryLines` undefined -- and `expect(undefined).toBe(0)` fails,
  // but `expect(undefined).toBe(undefined)` would not. Assert the lookup works.
  it('resolves every declared entry by id', () => {
    for (const id of ['two-sprite-static-field', 'solid-run', 'bcd-score-band']) {
      expect(entryById(id), `entry ${id} is missing`).toBeDefined();
    }
    expect(entryById('no-such-template')).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `npx vitest run packages/runtime`

Expected: FAIL — cannot resolve `../src/index.ts`.

- [ ] **Step 5: Write `catalog.ts`**

```ts
/**
 * The kernel template catalog.
 *
 * This package owns every number that was MEASURED. The compiler owns only what
 * it derives -- which, after the 2026-08-21 correction, is one integer: how many
 * objects a band boundary has to reposition. A wrong number here fails the line
 * ledger loudly at compile time rather than producing a subtly short frame.
 *
 * Increment 5 widens these types with applicability conditions and the register
 * writes each entry emits. Increment 4 needs only the line costs.
 */

import type { Span } from '@player1dsl/parser';

/**
 * The movable objects the TIA has. Two players, two missiles, one ball.
 *
 * This is hardware vocabulary, so it lives here rather than in the compiler --
 * and it has to, because `emitRowGroup` needs bindings and lives in this
 * package. Defining it in `layout.ts` would make the runtime depend on the
 * compiler and close a cycle. The compiler owns the binding DECISION; the
 * runtime owns the vocabulary that decision is expressed in.
 */
export type TiaObject = 'p0' | 'p1' | 'm0' | 'm1' | 'ball';

/** One logical thing, bound to one TIA object, for the duration of one band. */
export interface ObjectBinding {
  /** The logical holder: an actor name, or `score p0`. */
  readonly holder: string;
  readonly object: TiaObject;
  readonly band: string;
  readonly span: Span;
}

export interface TemplateCost {
  /**
   * Visible scanlines consumed before the template's first RENDERED line.
   *
   * MEASURED, and deliberately not a general "a region change after a loop exit
   * costs one line" rule -- the reference ROM has two such boundaries and they
   * cost 1 and 0. The discriminator is where the loop writes its per-line
   * registers:
   *
   *   1 -- the loop writes per-line registers in the horizontal blank at the TOP
   *        of each iteration, so its first iteration needs data that already
   *        exists. It renders entry+1 .. entry+N.
   *   0 -- the loop's registers are set once before it runs and are valid from
   *        that same line. It renders entry .. entry+N-1.
   */
  readonly entryLines: number;
  /** Visible scanlines consumed after the last rendered line. */
  readonly exitLines: number;
}

export interface TemplateEntry {
  readonly id: string;
  /** One line on what shape this kernel draws, for the selector's report. */
  readonly summary: string;
  readonly cost: TemplateCost;
}

/**
 * Visible scanlines charged to reposition `count` movable objects at a band
 * boundary.
 *
 * MEASURED in step 1: two scanlines per object for the RESPx strobe, plus one
 * to absorb the HMOVE comb on a line whose background can hide it. The comb
 * cannot be suppressed, only placed.
 *
 * This lives in the runtime rather than the compiler because 2-per-object and
 * the +1 are properties of the positioning routine the runtime emits. The
 * compiler derives only `count`.
 */
export function repositionLines(count: number): number {
  return count === 0 ? 0 : 2 * count + 1;
}
```

- [ ] **Step 6: Write `entries.ts`**

```ts
import type { TemplateEntry } from './catalog.ts';

/**
 * The three entries tank-arena's three row-group shapes need.
 *
 * "One catalog entry" in the step-3 design means one GENRE-DEFINING field
 * kernel. The other two are band kernels the same example needs. No fourth
 * entry is added speculatively.
 */
export const ENTRIES: readonly TemplateEntry[] = [
  {
    id: 'two-sprite-static-field',
    summary: 'two players over a playfield that is static within the band',
    // Primes gfx0/gfx1 one line ahead, then writes GRP0/GRP1 in horizontal
    // blank at the top of each iteration. Reference ROM: priming happens on
    // frame line 65, first rendered line is 66.
    cost: { entryLines: 1, exitLines: 0 },
  },
  {
    id: 'solid-run',
    summary: 'a run of identical lines with the playfield set once',
    // PF0/PF1/PF2 are written before the loop and are valid from that same
    // line. Reference ROM: the bottom wall's writes and its first rendered
    // line are both frame line 224.
    cost: { entryLines: 0, exitLines: 0 },
  },
  {
    id: 'bcd-score-band',
    summary: 'one BCD digit per player, drawn from a template font',
    // Blank rows, glyph rows and trailing blank rows are all inside the band's
    // authored height; nothing is charged outside it.
    cost: { entryLines: 0, exitLines: 0 },
  },
];

export function entryById(id: string): TemplateEntry | undefined {
  return ENTRIES.find((entry) => entry.id === id);
}
```

- [ ] **Step 7: Write `index.ts`**

```ts
export * from './catalog.ts';
export * from './entries.ts';
```

- [ ] **Step 8: Run the tests and the gates**

```bash
npx vitest run packages/runtime
npm run lint && npm run typecheck
```

Expected: 5 tests pass; lint and typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/runtime tsconfig.json package-lock.json
git commit -m "runtime: template line costs, with the entry-line rule corrected against the trace"
```

---

### Task 2: Spans on the game IR, and actors bound to TIA objects

**Files:**
- Modify: `packages/compiler/src/ir.ts` (add `span` to `BandIr`, `ActorIr`, `ScoreIr`, `PlayfieldIr`)
- Modify: `packages/compiler/src/check.ts` (populate the new spans)
- Create: `packages/compiler/src/layout.ts`
- Create: `packages/compiler/test/layout.test.ts`

**Interfaces:**
- Consumes: `GameIr`, `SceneIr`, `BandIr` from `./ir.ts`.
- Consumes: `TiaObject` and `ObjectBinding` from `@player1dsl/runtime` — Task 1 declares
  them there, for the reason given under **File Structure**. If Task 1 was implemented
  without them, add them to `packages/runtime/src/catalog.ts` now rather than declaring them
  here; a duplicate definition is the failure mode this ordering exists to prevent.
- Produces: `bindObjects(scene: SceneIr): ObjectBinding[]`.

**Why spans move into the game IR.** Layout diagnostics have to point at a construct — the
band whose height is wrong, the actor that has no object left. The game IR currently carries
no spans, so there is nothing to point at. A span is a *source location*, not hardware
detail, so `check.test.ts`'s "no hardware leaked into the game IR" assertion still holds;
run it and confirm rather than assuming.

- [ ] **Step 1: Write the failing test**

`packages/compiler/test/layout.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.ts';
import { bindObjects } from '../src/layout.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';

function tankArena() {
  return check(parse(readFileSync(SOURCE, 'utf8'), SOURCE));
}

describe('bindObjects', () => {
  it('gives each band its own claim on the two player objects', () => {
    const bindings = bindObjects(tankArena().scene);

    // The HUD digits and the tanks are DIFFERENT logical holders competing for
    // the SAME two TIA objects -- that competition is exactly why the band
    // boundary costs 5 scanlines. A binding model that gave scores their own
    // objects would compute a boundary cost of zero and a 197-line frame.
    expect(bindings.filter((b) => b.band === 'hud').map((b) => [b.holder, b.object])).toEqual([
      ['score p0', 'p0'],
      ['score p1', 'p1'],
    ]);
    expect(bindings.filter((b) => b.band === 'field').map((b) => [b.holder, b.object])).toEqual([
      ['tank0', 'p0'],
      ['tank1', 'p1'],
    ]);
  });

  it('carries a span on every binding so a diagnostic can point at one', () => {
    const bindings = bindObjects(tankArena().scene);
    expect(bindings).toHaveLength(4); // the extraction found something (testing.md 3)
    for (const binding of bindings) {
      expect(binding.span.file).toBe(SOURCE);
      expect(binding.span.line).toBeGreaterThan(0);
    }
  });

  it('rejects a band needing more movable objects than the hardware has', () => {
    const scene = tankArena().scene;
    const crowded = {
      ...scene,
      actors: [
        ...scene.actors,
        { ...scene.actors[0]!, name: 'tank2' },
      ],
    };
    expect(() => bindObjects(crowded)).toThrow(/E501/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run packages/compiler -t bindObjects`

Expected: FAIL — `../src/layout.ts` does not exist.

- [ ] **Step 3: Add spans to the game IR**

In `packages/compiler/src/ir.ts`, add `readonly span: Span;` to `BandIr`, `ActorIr`,
`ScoreIr` and `PlayfieldIr`, importing `Span` from `@player1dsl/parser`. Add this comment
above the first one:

```ts
  /**
   * Where this was written. Not hardware detail -- a source location, so the
   * layout layer can point a diagnostic at the construct that caused it.
   */
```

In `check.ts`, populate each from the declaration's existing `decl.span`.

- [ ] **Step 4: Write `layout.ts`**

```ts
/**
 * The game IR projected onto hardware.
 *
 * SPEC 5.1's asymmetry becomes concrete here: an actor's x becomes RESPx/HMPx
 * state, while its y becomes a constraint on the selected kernel's per-line
 * comparison, because there is no vertical position register.
 */

import { type Diagnostic, P1Error } from '@player1dsl/parser';
import { type ObjectBinding, type TiaObject } from '@player1dsl/runtime';
import type { SceneIr } from './ir.ts';

/** The player objects, in the order bands claim them. */
const PLAYER_OBJECTS: readonly TiaObject[] = ['p0', 'p1'];

/**
 * Bind each band's sprite-bearing declarations to TIA objects.
 *
 * Objects are claimed PER BAND and reused across bands, because that is what
 * the hardware forces: P0 and P1 are the only movable objects on the machine,
 * so a score band and a field band compete for the same two. That competition
 * is what makes a band boundary cost scanlines at all.
 */
export function bindObjects(scene: SceneIr): ObjectBinding[] {
  const bindings: ObjectBinding[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const band of scene.bands) {
    const holders: { name: string; span: Span }[] = [
      ...scene.scores
        .filter((score) => score.band === band.name)
        .map((score) => ({ name: score.name, span: score.span })),
      ...scene.actors
        .filter((actor) => actor.band === band.name)
        .map((actor) => ({ name: actor.name, span: actor.span })),
    ];

    holders.forEach((holder, index) => {
      const object = PLAYER_OBJECTS[index];
      if (!object) {
        diagnostics.push({
          code: 'E501',
          message:
            `band "${band.name}" needs ${holders.length} movable objects, ` +
            `but the TIA has ${PLAYER_OBJECTS.length} player objects`,
          span: holder.span,
          hint:
            'split the band, or render some of these with the playfield. ' +
            'Multiplexing one object across several actors is a separate kernel.',
        });
        return;
      }
      bindings.push({ holder: holder.name, object, band: band.name, span: holder.span });
    });
  }

  if (diagnostics.length > 0) throw new P1Error(diagnostics);
  return bindings;
}
```

- [ ] **Step 5: Run the test and the existing suite**

```bash
npx vitest run packages/compiler
```

Expected: the three new tests pass, and **`check.test.ts`'s "no hardware detail in the game
IR" test still passes**. If it fails, the span field was added wrong — a span must carry no
register name, scanline, or cycle count.

- [ ] **Step 6: Commit**

```bash
git add packages/compiler/src/ir.ts packages/compiler/src/check.ts packages/compiler/src/layout.ts packages/compiler/test/layout.test.ts
git commit -m "compiler: bind band declarations to TIA objects, with spans on the game IR"
```

---

### Task 3: Bands decomposed into row groups

**Files:**
- Modify: `packages/compiler/src/layout.ts`
- Modify: `packages/compiler/test/layout.test.ts`

**Interfaces:**
- Consumes: `bindObjects` from `./layout.ts` (Task 2); `entryById` and `repositionLines`
  from `@player1dsl/runtime`.
- Produces: `type RowGroupKind = 'glyphs' | 'run' | 'entry' | 'loop' | 'transition'`,
  `interface RowGroup { kind, template, lines, band, source, note, span }`,
  `interface LayoutIr { bands, rowGroups, bindings }`,
  `layout(scene: SceneIr): LayoutIr`.

`lines` is `number | 'remainder'`. Exactly one row group across the whole scene may be
`'remainder'`; Task 4's ledger solves it.

- [ ] **Step 1: Write the failing test**

Append to `packages/compiler/test/layout.test.ts`:

```ts
import { layout } from '../src/layout.ts';

describe('layout', () => {
  // The decomposition the ledger consumes. Every line count here comes from
  // template data or from the source; none is arithmetic done in the compiler.
  it('decomposes tank-arena into the row groups the reference kernel has', () => {
    const groups = layout(tankArena().scene).rowGroups;
    expect(groups.map((g) => [g.band, g.kind, g.template, g.lines])).toEqual([
      ['hud', 'glyphs', 'bcd-score-band', 12],
      ['field', 'transition', null, 5],
      ['field', 'run', 'solid-run', 8],
      ['field', 'entry', 'two-sprite-static-field', 1],
      ['field', 'loop', 'two-sprite-static-field', 'remainder'],
      ['field', 'run', 'solid-run', 8],
    ]);
  });

  // The transition is charged to the band being ENTERED, and only when the
  // objects actually have to move. A scene whose first band is also its only
  // band must not be charged one.
  it('charges no transition before the first band', () => {
    const groups = layout(tankArena().scene).rowGroups;
    expect(groups.filter((g) => g.band === 'hud' && g.kind === 'transition')).toEqual([]);
  });

  it('marks exactly one row group as taking the remainder', () => {
    const groups = layout(tankArena().scene).rowGroups;
    expect(groups.filter((g) => g.lines === 'remainder')).toHaveLength(1);
  });

  it('records where each line count came from', () => {
    const byKind = new Map(layout(tankArena().scene).rowGroups.map((g) => [g.kind, g.source]));
    expect(byKind.get('glyphs')).toBe('authored'); // band hud height 12
    expect(byKind.get('run')).toBe('authored'); // playfield border thickness 8
    expect(byKind.get('transition')).toBe('derived'); // repositionLines(2)
    expect(byKind.get('entry')).toBe('template'); // two-sprite-static-field
    expect(byKind.get('loop')).toBe('solved'); // the remainder
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run packages/compiler -t layout`

Expected: FAIL — `layout` is not exported.

- [ ] **Step 3: Add the dependency**

Add `"@player1dsl/runtime": "*"` to `packages/compiler/package.json` dependencies (matching
how `@player1dsl/parser` is declared there), add the project reference to
`packages/compiler/tsconfig.json`, and run `npm install`.

- [ ] **Step 4: Extend `layout.ts`**

```ts
import { entryById, repositionLines } from '@player1dsl/runtime';
import type { BandIr, PlayfieldIr, SceneIr } from './ir.ts';

export type RowGroupKind = 'glyphs' | 'run' | 'entry' | 'loop' | 'transition';

/** Where a row group's line count came from. Printed in the ledger report. */
export type LineSource = 'authored' | 'template' | 'derived' | 'solved';

export interface RowGroup {
  readonly kind: RowGroupKind;
  /** The catalog entry that draws it, or null for compiler-derived groups. */
  readonly template: string | null;
  /** A line count, or 'remainder' for the one group that absorbs the slack. */
  readonly lines: number | 'remainder';
  readonly band: string;
  readonly source: LineSource;
  readonly note: string;
  readonly span: Span;
}

export interface LayoutIr {
  readonly bands: readonly BandIr[];
  readonly rowGroups: readonly RowGroup[];
  readonly bindings: readonly ObjectBinding[];
}

/** The row groups a band decomposes into, before the transition is prepended. */
function decompose(band: BandIr, playfield: PlayfieldIr | undefined): RowGroup[] {
  // A band with an authored height and no playfield is a single glyph run.
  // `[wall][field][wall]` is what an ARENA game decomposes into; most genres
  // do not have it, and nothing below assumes a border exists.
  if (!playfield) {
    return [
      {
        kind: 'glyphs',
        template: 'bcd-score-band',
        lines: band.height ?? 0,
        band: band.name,
        source: 'authored',
        note: `band ${band.name} height ${band.height}`,
        span: band.span,
      },
    ];
  }

  const field = entryById('two-sprite-static-field');
  const run = entryById('solid-run');
  if (!field || !run) throw new Error('catalog is missing an entry the layout needs');

  const wall = (): RowGroup => ({
    kind: 'run',
    template: run.id,
    lines: playfield.thickness,
    band: band.name,
    source: 'authored',
    note: `playfield border thickness ${playfield.thickness}`,
    span: playfield.span,
  });

  const groups: RowGroup[] = [wall()];
  if (field.cost.entryLines > 0) {
    groups.push({
      kind: 'entry',
      template: field.id,
      lines: field.cost.entryLines,
      band: band.name,
      source: 'template',
      note: `${field.id} primes its per-line data one line ahead`,
      span: band.span,
    });
  }
  groups.push({
    kind: 'loop',
    template: field.id,
    lines: band.height ?? 'remainder',
    band: band.name,
    source: band.height === null ? 'solved' : 'authored',
    note: 'the open field',
    span: band.span,
  });
  groups.push(wall());
  return groups;
}

export function layout(scene: SceneIr): LayoutIr {
  const bindings = bindObjects(scene);
  const rowGroups: RowGroup[] = [];
  let previous: readonly ObjectBinding[] = [];

  for (const band of scene.bands) {
    const mine = bindings.filter((b) => b.band === band.name);

    // A boundary costs scanlines only for objects that were already placed
    // somewhere else. The first band positions everything in VBLANK, where it
    // is free -- which is why no transition is charged before it.
    const moved = mine.filter((b) => previous.some((p) => p.object === b.object)).length;
    const lines = repositionLines(moved);
    if (lines > 0) {
      rowGroups.push({
        kind: 'transition',
        template: null,
        lines,
        band: band.name,
        source: 'derived',
        note: `repositioning ${moved} object${moved === 1 ? '' : 's'} entering ${band.name}`,
        span: band.span,
      });
    }

    rowGroups.push(...decompose(band, scene.playfields.find((p) => p.band === band.name)));
    previous = mine;
  }

  return { bands: scene.bands, rowGroups, bindings };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/compiler`

Expected: PASS. If the row-group order differs from the expected array, **do not reorder the
expectation** — the order is the frame's top-to-bottom order and the reference kernel's
order. Fix the code.

- [ ] **Step 6: Commit**

```bash
git add packages/compiler packages/runtime package-lock.json
git commit -m "compiler: decompose bands into row groups, with line counts read from template data"
```

---

### Task 4: The line ledger and its hard gate

**Files:**
- Create: `packages/compiler/src/ledger.ts`
- Create: `packages/compiler/test/ledger.test.ts`
- Modify: `packages/compiler/src/index.ts`

**Interfaces:**
- Consumes: `LayoutIr`, `RowGroup` from `./layout.ts`.
- Produces: `NTSC_VISIBLE_LINES = 192`, `NTSC_FIRST_VISIBLE_LINE = 40`,
  `interface LedgerRow { band, kind, template, lines, firstLine, lastLine, source, note }`,
  `interface Ledger { rows, total, visibleLines, firstVisibleLine }`,
  `buildLedger(layout: LayoutIr): Ledger`, `formatLedger(ledger: Ledger): string`.

**This is the crux of the whole step.** The ledger must independently arrive at 158.

- [ ] **Step 1: Write the failing test**

`packages/compiler/test/ledger.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.ts';
import { buildLedger, formatLedger, NTSC_VISIBLE_LINES } from '../src/ledger.ts';
import { layout } from '../src/layout.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';

function ledgerFor(source: string) {
  return buildLedger(layout(check(parse(source, SOURCE)).scene));
}

function tankArenaSource(): string {
  return readFileSync(SOURCE, 'utf8');
}

describe('the line ledger', () => {
  // THE assertion this increment exists for. The source states a HUD height of
  // 12 and a border thickness of 8 and nothing else; 158 is derived from
  // 192 - 12 - 5 - 8 - 1 - 8. The reference kernel's FIELD_LINES is 158.
  //
  // This test alone cannot falsify the ledger -- it asserts that the compiler
  // computes what the compiler computes. Increment 5b builds a ROM from it and
  // runs it, which can. See the plan's note on why 5b exists.
  it('derives 158 field lines from a HUD height and a border thickness', () => {
    const rows = ledgerFor(tankArenaSource()).rows;
    const loop = rows.find((r) => r.kind === 'loop');
    expect(loop, 'the ledger has no loop row').toBeDefined();
    expect(loop?.lines).toBe(158);
  });

  it('sums to exactly the visible budget', () => {
    const ledger = ledgerFor(tankArenaSource());
    expect(ledger.total).toBe(NTSC_VISIBLE_LINES);
    expect(ledger.total).toBe(192);
  });

  // The frame lines below are READ FROM tests/goldens/tank-arena.trace, frame 0,
  // not predicted. If this test and the golden ever disagree, the golden is the
  // record of what the hardware did.
  it('places every row group on the frame lines the reference kernel uses', () => {
    const rows = ledgerFor(tankArenaSource()).rows;
    expect(rows.map((r) => [r.kind, r.firstLine, r.lastLine])).toEqual([
      ['glyphs', 40, 51],
      ['transition', 52, 56],
      ['run', 57, 64],
      ['entry', 65, 65],
      ['loop', 66, 223],
      ['run', 224, 231],
    ]);
  });
});

describe('the ledger gate', () => {
  // testing.md 1: a gate that has never rejected anything is not known to work.
  // Both directions, because a short frame and a long frame take different
  // branches of the diagnostic.
  function withHudHeight(height: number): string {
    const source = tankArenaSource().replace('band hud height 12:', `band hud height ${height}:`);
    expect(source, 'the substitution found nothing').toContain(`height ${height}`);
    return source;
  }

  it('accepts the balanced scene', () => {
    expect(() => ledgerFor(withHudHeight(12))).not.toThrow();
  });

  // A remainder band absorbs any HUD height, so an UNBALANCED scene needs a
  // band that cannot absorb it. Give the field an explicit height too.
  function bothBandsFixed(fieldHeight: number): string {
    const source = tankArenaSource().replace('band field:', `band field height ${fieldHeight}:`);
    expect(source, 'the substitution found nothing').toContain(`band field height`);
    return source;
  }

  it('rejects a frame that is one line short', () => {
    expect(() => ledgerFor(bothBandsFixed(157))).toThrow(/E503/);
    expect(() => ledgerFor(bothBandsFixed(157))).toThrow(/191/);
  });

  it('rejects a frame that is one line long', () => {
    expect(() => ledgerFor(bothBandsFixed(159))).toThrow(/E503/);
    expect(() => ledgerFor(bothBandsFixed(159))).toThrow(/193/);
  });

  it('names the shortfall so the author knows which way to move', () => {
    try {
      ledgerFor(bothBandsFixed(157));
      expect.unreachable('the gate did not fire');
    } catch (error) {
      expect((error as Error).message).toMatch(/E503/);
    }
  });
});

describe('formatLedger', () => {
  it('renders every row with its line span and where its count came from', () => {
    const text = formatLedger(ledgerFor(tankArenaSource()));
    expect(text).toContain('158');
    expect(text).toContain('solved');
    expect(text).toContain('192');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run packages/compiler -t ledger`

Expected: FAIL — `../src/ledger.ts` does not exist.

- [ ] **Step 3: Write `ledger.ts`**

```ts
/**
 * The line ledger: every visible scanline belongs to exactly one row group.
 *
 * This is a HARD GATE. If the row groups do not sum to exactly the target's
 * visible budget, the build fails with a diagnostic naming the shortfall. A
 * compiler that silently emits 191 or 193 produces the defect class step 2
 * found in the reference kernel itself -- two errors that cancelled in the
 * frame total and survived five rounds of visual verification.
 */

import { type Diagnostic, P1Error } from '@player1dsl/parser';
import type { LayoutIr, LineSource, RowGroupKind } from './layout.ts';

/** SPEC 3: NTSC is 3 VSYNC + 37 VBLANK + 192 visible + 30 overscan. */
export const NTSC_VISIBLE_LINES = 192;
export const NTSC_FIRST_VISIBLE_LINE = 40;

export interface LedgerRow {
  readonly band: string;
  readonly kind: RowGroupKind;
  readonly template: string | null;
  readonly lines: number;
  /** Frame-absolute, so it can be compared against a trace directly. */
  readonly firstLine: number;
  readonly lastLine: number;
  readonly source: LineSource;
  readonly note: string;
}

export interface Ledger {
  readonly rows: readonly LedgerRow[];
  readonly total: number;
  readonly visibleLines: number;
  readonly firstVisibleLine: number;
}

export function buildLedger(ir: LayoutIr): Ledger {
  const groups = ir.rowGroups;
  const remainders = groups.filter((g) => g.lines === 'remainder');
  const diagnostics: Diagnostic[] = [];

  if (remainders.length > 1) {
    for (const group of remainders.slice(1)) {
      diagnostics.push({
        code: 'E502',
        message: `band "${group.band}" also takes the remaining lines, but "${remainders[0]?.band}" already does`,
        span: group.span,
        hint: 'give all but one band an explicit height',
      });
    }
    throw new P1Error(diagnostics);
  }

  const fixed = groups.reduce((sum, g) => sum + (g.lines === 'remainder' ? 0 : g.lines), 0);
  const remainder = remainders[0];

  if (!remainder && fixed !== NTSC_VISIBLE_LINES) {
    const last = groups.at(-1);
    throw new P1Error([
      {
        code: 'E503',
        message:
          `the visible region is ${fixed} scanlines, but NTSC has exactly ${NTSC_VISIBLE_LINES}: ` +
          `${fixed > NTSC_VISIBLE_LINES ? `${fixed - NTSC_VISIBLE_LINES} too many` : `${NTSC_VISIBLE_LINES - fixed} short`}`,
        span: last?.span ?? groups[0]!.span,
        hint:
          'change a band height, or leave one band without a height so it takes ' +
          'whatever the others leave. Band transitions and template entry lines ' +
          'are charged too -- run `p1 check` to see the full ledger.',
      },
    ]);
  }

  const solved = remainder ? NTSC_VISIBLE_LINES - fixed : 0;
  if (remainder && solved <= 0) {
    throw new P1Error([
      {
        code: 'E504',
        message:
          `band "${remainder.band}" has ${solved} scanlines left after the other row groups ` +
          `take ${fixed} of ${NTSC_VISIBLE_LINES}`,
        span: remainder.span,
        hint: 'reduce another band height, or the playfield border thickness',
      },
    ]);
  }

  const rows: LedgerRow[] = [];
  let line = NTSC_FIRST_VISIBLE_LINE;
  for (const group of groups) {
    const lines = group.lines === 'remainder' ? solved : group.lines;
    rows.push({
      band: group.band,
      kind: group.kind,
      template: group.template,
      lines,
      firstLine: line,
      lastLine: line + lines - 1,
      source: group.source,
      note: group.note,
    });
    line += lines;
  }

  const total = rows.reduce((sum, row) => sum + row.lines, 0);

  // Belt and braces: the arithmetic above cannot produce a wrong total, but
  // this gate is the one thing standing between a bug here and a silently
  // short frame, so it asserts rather than trusts.
  if (total !== NTSC_VISIBLE_LINES) {
    throw new P1Error([
      {
        code: 'E503',
        message: `the ledger sums to ${total}, not ${NTSC_VISIBLE_LINES}`,
        span: groups[0]!.span,
      },
    ]);
  }

  return {
    rows,
    total,
    visibleLines: NTSC_VISIBLE_LINES,
    firstVisibleLine: NTSC_FIRST_VISIBLE_LINE,
  };
}

/** The ledger as a table, for `p1 check`. */
export function formatLedger(ledger: Ledger): string {
  const header = ['band', 'kind', 'lines', 'frame lines', 'from', 'note'];
  const body = ledger.rows.map((row) => [
    row.band,
    row.kind,
    String(row.lines),
    `${row.firstLine}-${row.lastLine}`,
    row.source,
    row.note,
  ]);
  const widths = header.map((_, i) =>
    Math.max(header[i]!.length, ...body.map((cells) => cells[i]!.length)),
  );
  const render = (cells: readonly string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd();

  return [
    render(header),
    render(widths.map((w) => '-'.repeat(w))),
    ...body.map(render),
    '',
    `${ledger.total} of ${ledger.visibleLines} visible scanlines`,
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/compiler -t ledger`

Expected: PASS, including 158.

**If the ledger produces 157 or 159, do not adjust a constant to make 158 appear**
([testing.md](../../testing.md) 5). Re-read the row groups against
`tests/goldens/tank-arena.trace` frame 0 and find which group's count is wrong.

- [ ] **Step 5: Watch the gate fail, by deleting the code it covers**

[testing.md](../../testing.md) 2 — stronger than a known-positive and cheap. Temporarily
change the `E503` branch to `if (false)`, re-run, and confirm the two rejection tests go
red. Restore, re-run, confirm green. **Record the number of tests that went red in the
commit message**; if it is not exactly 2, the tests are not isolating the branch they claim.

- [ ] **Step 6: Export and commit**

Add to `packages/compiler/src/index.ts`:

```ts
export * from './layout.ts';
export * from './ledger.ts';
```

```bash
git add packages/compiler
git commit -m "compiler: the line ledger, deriving 158 field lines and gating on 192"
```

---

### Task 5: `p1 check` prints the ledger

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `layout`, `buildLedger`, `formatLedger` from `@player1dsl/compiler`.
- Produces: no new exports; `p1 check` gains ledger output and fails on an unbalanced scene.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/cli.test.ts`, following the capture helper already in that file:

```ts
it('prints the line ledger with the derived field height', async () => {
  const { code, out } = await captureRun(['check', 'examples/tank-arena']);
  expect(code).toBe(0);
  expect(out).toContain('158');
  expect(out).toContain('192 of 192 visible scanlines');
});

it('fails when the bands do not fill the frame', async () => {
  // Written to a temp file so the committed example stays canonical.
  const source = readFileSync('examples/tank-arena/tank-arena.p1', 'utf8')
    .replace('band field:', 'band field height 157:');
  expect(source).toContain('band field height 157');
  const path = join(mkdtempSync(join(tmpdir(), 'p1-')), 'short.p1');
  writeFileSync(path, source);

  const { code, err } = await captureRun(['check', path]);
  expect(code).toBe(1);
  expect(err).toContain('E503');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run packages/cli`

Expected: FAIL — the output has no ledger.

- [ ] **Step 3: Wire the ledger into `run`**

In `packages/cli/src/index.ts`, extend the imports and the `check` branch:

```ts
import { allocateRam, buildLedger, check, formatLedger, layout } from '@player1dsl/compiler';
```

After the RAM map is printed, add:

```ts
    // The ledger is a hard gate: buildLedger throws rather than returning a
    // short frame, so reaching the print means the frame balances.
    const ledger = buildLedger(layout(ir.scene));
    console.log('');
    console.log(formatLedger(ledger));
```

The existing `catch (error) { if (isP1Error(error)) ... }` already reports diagnostics and
returns 1, so the gate needs no new error handling — confirm by reading it rather than
assuming.

- [ ] **Step 4: Run the tests and look at the output**

```bash
npx vitest run packages/cli
node --experimental-strip-types packages/cli/src/main.ts check examples/tank-arena
```

Expected: the ledger table, ending `192 of 192 visible scanlines`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "cli: p1 check prints the line ledger and fails an unbalanced frame"
```

- [ ] **Step 6: Push the branch**

```bash
git push -u origin step3-plan3-layout-and-catalog
```

CI runs on every branch push. Confirm green before starting increment 4b.

---
## Increment 4b: three kernel-shape fixtures

The catalog vocabulary invented in increment 5 has been derived from exactly one kernel.
That is one data point, and a vocabulary fitted to one data point describes that kernel
rather than the class of kernels. This increment measures three *different* shapes first,
so increment 5's fields are chosen against numbers.

Each fixture is a complete ROM answering one QUESTION stated in its header comment, in the
house style of `tests/fixtures/timing/wsync-only.asm`. Constraints that shape the source:

- Our assembler supports `processor`, `subroutine`, `seg`, `seg.u`, `org`, `align`, `ds`,
  `.byte`/`byte`/`dc`/`dc.b`, `.word`/`word`/`dc.w`, `include`, and `label = expr` equates.
  There is **no `REPEAT`/`REPEND` and there are no macros.** Every table is written out.
- Every region boundary is a counted WSYNC, per the semantics `wsync-only.asm` established
  and Stella confirmed: N executions of `sta WSYNC` produce exactly N scanlines, and the
  setup code preceding a loop shares the line that loop's first WSYNC ends.
- Fixtures are assembled by **our** assembler through `romFor`, so CI still needs only Node.

**A note on what these tests may assert.** A test that pins a number this emulator just
printed is [testing.md](../../testing.md)'s test that cannot fail. So each task splits in
two: first a **structural** assertion that can fail today (the frame is 262 lines split
3/37/192/30, and the kernel's own arithmetic sums to 192), then a **measurement** read out
of the trace and only afterwards written into an assertion — with the measured value and
any contradicted prediction recorded in the commit message and in Task 9's document. If a
measurement contradicts the prediction, **record both and change the prediction, never the
kernel**.

---

### Task 6: `scroll-field` — does a per-line playfield loop charge an entry line?

The correction this plan carries (§1) claims the discriminator for a template's entry cost
is *where the loop writes its per-line registers*: at the top of each iteration costs 1, set
once before the loop costs 0. That was measured from a loop writing `GRP0`/`GRP1`. If the
rule is about the register rather than about the loop shape, a playfield loop will behave
differently. This fixture puts both shapes in one ROM — a solid band whose playfield is set
once, and a scroll band whose playfield is rewritten every line — so the two costs are
measured against each other in a single trace.

- [ ] **Step 1 — write the fixture.** Create `tests/fixtures/kernels/scroll-field.asm`:

```asm
; ---------------------------------------------------------------------------
; Kernel-shape fixture 1 -- a playfield rewritten every line.
;
; QUESTION: does a loop that writes its per-line registers at the TOP of each
; iteration charge one entry line, and does a region whose registers are set
; once before it runs charge zero -- when the register is PF1/PF2 rather than
; GRP0/GRP1?
;
; The visible region is 16 + 160 + 16 = 192 counted WSYNCs. The top band sets
; PF0/PF1/PF2 once before its loop; the scroll band rewrites PF1/PF2 from a
; 16-entry table at the top of every iteration; the bottom band sets them once
; again. Whether each band's FIRST line renders its own content or the previous
; band's is then a fact in the trace, not an argument.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

BAND_LINES   = 16
SCROLL_LINES = 160

    seg.u vars
    org $80
Phase       ds 1                ; table index, advanced once per frame

    seg code
    org $F000

Reset
    sei
    cld
    ldx #$FF
    txs
    lda #0
.clear
    sta $00,x
    dex
    bne .clear
    sta $00
    sta Phase

MainLoop
    ; --- VSYNC: 3 lines ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 lines ---
    lda #2
    sta VBLANK
    lda #$01                    ; CTRLPF: REF, so the right half mirrors
    sta CTRLPF
    ldx #37
.vblank
    sta WSYNC
    dex
    bne .vblank
    lda #0
    sta VBLANK

    ; --- top band: 16 lines, playfield set ONCE before the loop ---
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2
    lda #$0E
    sta COLUPF
    ldx #BAND_LINES
.top
    sta WSYNC
    dex
    bne .top

    ; --- scroll band: 160 lines, PF1/PF2 rewritten at the top of each line ---
    ; Deadlines: PF1 is read at pixel 16 (cycle ~27), PF2 at 48 (cycle ~38).
    ; The writes complete at cycles 7 and 14, so neither is late and the loop
    ; body is 24 of the line's 76 cycles.
    lda #$46
    sta COLUPF
    ldy Phase
    ldx #SCROLL_LINES
.scroll
    sta WSYNC
    lda ScrollPF1,y
    sta PF1
    lda ScrollPF2,y
    sta PF2
    iny
    tya
    and #$0F
    tay
    dex
    bne .scroll

    ; --- bottom band: 16 lines, playfield set ONCE, in the loop's first blank ---
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2
    lda #$0E
    sta COLUPF
    ldx #BAND_LINES
.bottom
    sta WSYNC
    dex
    bne .bottom

    ; --- overscan: 30 lines ---
    lda #2
    sta VBLANK
    lda Phase
    clc
    adc #1
    and #$0F
    sta Phase
    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

; --- Scroll table ----------------------------------------------------------
; A single lit block walking left to right across the mirrored half. Sixteen
; entries, page-aligned so `lda ScrollPF1,y` never crosses a page boundary and
; costs a fixed 4 cycles.
    align 256
ScrollPF1
    .byte $80,$40,$20,$10,$08,$04,$02,$01
    .byte $00,$00,$00,$00,$00,$00,$00,$00
ScrollPF2
    .byte $00,$00,$00,$00,$00,$00,$00,$00
    .byte $01,$02,$04,$08,$10,$20,$40,$80

    org $FFFC
    .word Reset
    .word Reset
```

- [ ] **Step 2 — register it.** Add `'scroll-field': 'tests/fixtures/kernels/scroll-field.asm'`
      to `ROM_SOURCES` in `packages/emulator/test/support/roms.ts`.

- [ ] **Step 3 — write the structural test first.** Create
      `packages/emulator/test/kernel-fixtures.test.ts` with the `frameOf` helper copied from
      `timing-fixtures.test.ts` (run three frames, keep the third; region state carries
      across frames) and only this:

```ts
describe('scroll-field (tests/fixtures/kernels/scroll-field.asm)', () => {
  it('runs a 262-line frame split 3/37/192/30', () => {
    const frame = frameOf('scroll-field');
    expect(frame.scanlines).toBe(262);
    expect(frame.vsyncLines).toBe(3);
    expect(frame.vblankLines).toBe(37);
    expect(frame.visibleLines).toBe(192);
    expect(frame.overscanLines).toBe(30);
  });
});
```

- [ ] **Step 4 — watch it fail, then pass.** Run `npm test -w @player1/emulator`. This test
      is not vacuous: it fails if the fixture miscounts a WSYNC, if the assembler mis-assembles
      a directive the fixture is the first to use, or if `align 256` moves the tables somewhere
      the reset vector cannot reach. Fix the fixture until it passes. **Do not change the
      assertion to match the emulator.**

- [ ] **Step 5 — measure, do not predict.** Run the trace and read the decomposition:

```bash
node --experimental-strip-types -e "
import { Machine } from './packages/emulator/src/index.ts';
import { romFor } from './packages/emulator/test/support/roms.ts';
import { formatWrite } from './packages/emulator/src/trace.ts';
const m = new Machine(romFor('scroll-field'));
m.runFrame(); m.runFrame();
const f = m.runFrame({ trace: true });
for (const w of f.writes ?? []) console.log(formatWrite(w));
" | tee /tmp/scroll-field.trace
```
      Write the answers down before writing any assertion:
      - the line the first `PF1` write of the scroll band lands on;
      - the first line whose *rendered* content is a scroll pattern rather than the top
        band's solid `$FF` (the line after the first scroll write, if entry cost is 1);
      - the same two for the bottom band, where the prediction is entry cost 0.

- [ ] **Step 6 — assert the measurement.** Add a second `it` naming the measured line numbers
      as literals, with a comment stating the prediction and whether the measurement matched:

```ts
  // MEASURED <date>: scroll writes begin on visible line <N>; the first line
  // rendering a scroll pattern is <N+1>. Entry cost 1, matching the prediction
  // in the plan's correction 1. The bottom band's writes land on visible line
  // <M> and that same line renders solid. Entry cost 0.
```
      Assert the entry costs, derived from the trace lines, not the raw lines — a test that
      says `expect(scrollEntryCost).toBe(1)` survives the fixture being renumbered.

- [ ] **Step 7 — commit.** `git add -A && git commit` with a message stating the two measured
      entry costs and whether they confirmed or contradicted correction 1. If they
      contradicted it, say so plainly in the message; Task 9 then revises the rule.

---

### Task 7: `ball-and-paddles` — does the reposition rule hold at n = 3?

`repositionLines(n) = 2n + 1` was fitted to a single boundary that moved two objects. The
`+1` is the HMOVE comb and should be constant; the `2n` is the `PosObjectX` idiom and should
be linear. Neither claim is measured. This fixture repositions **three** objects — P0, P1
and the ball — across one boundary, which is the smallest input that can distinguish
`2n + 1` from a constant 5 or from `2n + n`.

The reference's `PosObjectX` indexes `HMP0,x` and `RESP0,x`. Because `HMP0`=$20/`HMBL`=$24
and `RESP0`=$10/`RESBL`=$14, **x = 4 positions the ball with the same routine** — the fixture
needs no second routine, so nothing but `n` changes between the two boundaries it measures.

- [ ] **Step 1 — write the fixture.** Create `tests/fixtures/kernels/ball-and-paddles.asm`:

```asm
; ---------------------------------------------------------------------------
; Kernel-shape fixture 2 -- three movable objects across one boundary.
;
; QUESTION: does repositioning n objects at a band boundary cost 2n + 1 visible
; scanlines for n = 3, as the rule fitted to tank-arena's n = 2 predicts?
;
; The visible region is 24 + 7 + 161 = 192 counted WSYNCs. The middle 7 are the
; boundary: three PosObjectX calls at two lines each, plus one line to absorb
; the HMOVE comb. If the cost were anything other than 7 the WSYNC total would
; still be 192 -- the counted loops guarantee that -- so the measurement is not
; the total but WHICH lines carry RESP0/RESP1/RESBL and HMOVE in the trace.
;
; PosObjectX indexes HMP0,x and RESP0,x. x=0 is P0, x=1 is P1, and x=4 reaches
; HMBL/RESBL, so the ball uses the same routine with no second code path.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

TOP_LINES    = 24
BOUNDARY     = 7
BOTTOM_LINES = 161

    seg code
    org $F000

Reset
    sei
    cld
    ldx #$FF
    txs
    lda #0
.clear
    sta $00,x
    dex
    bne .clear
    sta $00

MainLoop
    ; --- VSYNC: 3 lines ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 lines ---
    ; Both paddles and the ball are positioned here first, where the HMOVE comb
    ; falls on a blanked line and costs nothing. The boundary below is the
    ; expensive case, and the contrast is the point.
    lda #2
    sta VBLANK
    lda #$21                    ; CTRLPF: BALL SIZE 2, reflect off
    sta CTRLPF
    lda #$FF
    sta GRP0
    sta GRP1
    lda #$46
    sta COLUP0
    lda #$86
    sta COLUP1
    lda #$0E
    sta COLUPF
    lda #2
    sta ENABL                   ; ball on

    lda #20
    ldx #0
    jsr PosObjectX
    lda #120
    ldx #1
    jsr PosObjectX
    lda #70
    ldx #4
    jsr PosObjectX

    ldx #31                     ; 37 - 6 lines already spent by the three calls
.vblank
    sta WSYNC
    dex
    bne .vblank
    lda #0
    sta VBLANK

    ; --- top band: 24 lines ---
    ldx #TOP_LINES
.top
    sta WSYNC
    dex
    bne .top

    ; --- boundary: reposition all three, on VISIBLE lines ---
    lda #60
    ldx #0
    jsr PosObjectX
    lda #90
    ldx #1
    jsr PosObjectX
    lda #40
    ldx #4
    jsr PosObjectX
    sta WSYNC                   ; absorb the comb

    ; --- bottom band: 161 lines ---
    ldx #BOTTOM_LINES
.bottom
    sta WSYNC
    dex
    bne .bottom

    ; --- overscan: 30 lines ---
    lda #2
    sta VBLANK
    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

PosObjectX subroutine
    sta WSYNC                   ; line 1
    sec
.divide
    sbc #15
    bcs .divide
    eor #7
    asl
    asl
    asl
    asl
    sta HMP0,x                  ; x=0 P0, x=1 P1, x=4 ball
    sta RESP0,x
    sta WSYNC                   ; line 2
    sta HMOVE
    rts

    org $FFFC
    .word Reset
    .word Reset
```

- [ ] **Step 2 — register it** in `ROM_SOURCES` as `'ball-and-paddles'`.

- [ ] **Step 3 — structural test first.** Add a `describe` to `kernel-fixtures.test.ts`
      asserting 262 / 3 / 37 / 192 / 30, exactly as Task 6 did. This one really can fail:
      the VBLANK count is `37 - 6` because three `PosObjectX` calls spend two lines each
      *inside* VBLANK, and getting that subtraction wrong is the most likely bug in the file.

- [ ] **Step 4 — watch it fail, then pass.** `npm test -w @player1/emulator`. If VBLANK
      comes out at 43 or 31, the subtraction is wrong — fix the **fixture**, not the assertion.

- [ ] **Step 5 — measure the boundary.** Dump the trace as in Task 6 and extract, for the
      visible region only, every write whose register is `RESP0`, `RESP1`, `RESBL` or `HMOVE`.
      Record the first and last such line. The boundary's cost is
      `lastLine - firstLine + 1`, plus the comb-absorbing line if it falls after the last
      HMOVE. Compare against `2 * 3 + 1 = 7`.

- [ ] **Step 6 — assert it, and assert the n = 2 case beside it.** Add:

```ts
  // MEASURED <date>: the visible-region boundary occupies lines <a>..<b>,
  // which is <b-a+1> lines for n = 3. Predicted 2n + 1 = 7. <matched | did not>
  it('spends 2n + 1 visible lines repositioning n objects, at n = 3', () => { ... });
```
      Then, in the same file, assert the same extraction over the **tank-arena** golden ROM
      gives 5 for its n = 2 boundary. Two points on the line is what makes it a rule rather
      than a coincidence, and the second point costs nothing — the ROM is already registered.

- [ ] **Step 7 — the known-positive.** `repositionLines` must reject as well as accept. Add a
      unit test in `packages/runtime/test/costs.test.ts` asserting `repositionLines(0) === 0` —
      a boundary that moves nothing must not be charged the comb line, and the naive
      `2n + 1` returns 1 for it. Confirm the guard exists in Task 1's implementation and that
      deleting the `count === 0` branch turns this test red.

- [ ] **Step 8 — commit,** stating the measured cost at n = 3 and at n = 2 in the message.

---

### Task 8: `sprite-formation` — are hardware copies free, and are they a distinct concept?

The genre survey predicted that a formation of identical sprites is common enough to need
its own catalog entry. There are two ways to draw one and they have nothing in common
except the picture: `NUSIZ` hardware copies (two or three copies of the *same* graphics at
fixed spacings, costing zero extra lines and zero extra objects) and mid-line `RESPx`
multiplexing (arbitrary copies, costing the line's whole cycle budget and forbidding
per-copy graphics). If they cost the same, the catalog needs one `copies` field. If they do
not, it needs two applicability values and the selector must know which one a band can
afford. **This fixture measures only the NUSIZ path**; multiplexing is a kernel whose cost
belongs to a later increment, exactly as the reference kernel's own comment says about
multi-digit scores.

- [ ] **Step 1 — write the fixture.** Create `tests/fixtures/kernels/sprite-formation.asm`:

```asm
; ---------------------------------------------------------------------------
; Kernel-shape fixture 3 -- one object drawn as a row of three.
;
; QUESTION: do NUSIZ hardware copies cost any additional scanlines or any
; additional TIA objects, compared with the same band drawing one copy?
;
; Two formation rows, 8 lines each, from ONE player object: the first at
; NUSIZ0 = $03 (three copies, close) and the second at $06 (three copies,
; medium). Neither row repositions anything. If copies were not free, the trace
; would show extra RESP0 strobes inside the visible region, or the bands would
; not fit their counted WSYNCs.
;
; Visible region: 8 + 8 + 8 + 8 + 160 = 192.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

    seg.u vars
    org $80
Row         ds 1                ; sprite row counter

    seg code
    org $F000

Reset
    sei
    cld
    ldx #$FF
    txs
    lda #0
.clear
    sta $00,x
    dex
    bne .clear
    sta $00

MainLoop
    ; --- VSYNC: 3 lines ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 lines ---
    ; The ONLY positioning in this ROM, and it happens once, in blank.
    lda #2
    sta VBLANK
    lda #$4A
    sta COLUP0
    lda #40
    ldx #0
    jsr PosObjectX
    ldx #35                     ; 37 - 2 spent by the single PosObjectX call
.vblank
    sta WSYNC
    dex
    bne .vblank
    lda #0
    sta VBLANK

    ; --- gap: 8 blank lines ---
    lda #0
    sta GRP0
    sta NUSIZ0
    ldx #8
.gapA
    sta WSYNC
    dex
    bne .gapA

    ; --- formation row A: 8 lines, three CLOSE copies ---
    lda #$03
    sta NUSIZ0
    ldy #0
.rowA
    sta WSYNC
    lda AlienSprite,y
    sta GRP0
    iny
    cpy #8
    bne .rowA

    ; --- gap: 8 blank lines ---
    lda #0
    sta GRP0
    ldx #8
.gapB
    sta WSYNC
    dex
    bne .gapB

    ; --- formation row B: 8 lines, three MEDIUM copies ---
    lda #$06
    sta NUSIZ0
    ldy #0
.rowB
    sta WSYNC
    lda AlienSprite,y
    sta GRP0
    iny
    cpy #8
    bne .rowB

    ; --- rest of the field: 160 lines ---
    lda #0
    sta GRP0
    sta NUSIZ0
    ldx #160
.field
    sta WSYNC
    dex
    bne .field

    ; --- overscan: 30 lines ---
    lda #2
    sta VBLANK
    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

PosObjectX subroutine
    sta WSYNC
    sec
.divide
    sbc #15
    bcs .divide
    eor #7
    asl
    asl
    asl
    asl
    sta HMP0,x
    sta RESP0,x
    sta WSYNC
    sta HMOVE
    rts

; --- Sprite ----------------------------------------------------------------
; Page-aligned so `lda AlienSprite,y` inside the row loops is a fixed 4 cycles.
    align 256
AlienSprite
    .byte %00111100
    .byte %01111110
    .byte %11011011
    .byte %11111111
    .byte %10111101
    .byte %10100101
    .byte %01000010
    .byte %00100100

    org $FFFC
    .word Reset
    .word Reset
```

- [ ] **Step 2 — register it** in `ROM_SOURCES` as `'sprite-formation'`.

- [ ] **Step 3 — structural test first,** the same 262 / 3 / 37 / 192 / 30 assertion. The
      VBLANK arithmetic (`37 - 2`) is again the likely bug, and again the assertion catches it.

- [ ] **Step 4 — watch it fail, then pass.**

- [ ] **Step 5 — assert copies are free, in a way that can fail.** Two assertions over the
      traced frame, both of which a wrong answer breaks:

```ts
  it('draws three copies without repositioning inside the visible region', () => {
    const visible = writesInVisibleRegion(frame);
    expect(visible.filter((w) => registerName(w.register) === 'RESP0')).toHaveLength(0);
  });

  it('spends the same lines per formation row as a one-copy row would', () => {
    // Row A and row B differ ONLY in NUSIZ0. Equal line spans is the measurement.
    expect(rowSpan(frame, 'A')).toBe(8);
    expect(rowSpan(frame, 'B')).toBe(8);
  });
```
      The first fails the moment a formation needs a strobe; the second fails if changing
      `NUSIZ0` between rows perturbs either row's line count. Confirm the first can fail by
      temporarily moving one `PosObjectX` call out of VBLANK and into the gap before row A,
      seeing it go red, and reverting.

- [ ] **Step 6 — record the second cost that is NOT measured here.** In the fixture's header
      and in Task 9's document, state explicitly that mid-line `RESPx` multiplexing was not
      measured and that its cost is therefore unknown. An unmeasured cost recorded as unknown
      is a fact; an unmeasured cost omitted becomes an assumed zero the selector will happily
      spend.

- [ ] **Step 7 — commit,** stating that NUSIZ copies cost 0 lines and 0 additional objects,
      and that multiplexing remains unmeasured.

---

### Task 9: revise the vocabulary against the three measurements

Now, and only now, the catalog's applicability and cost vocabulary is chosen. This task
writes down what the fixtures measured and what that forces the vocabulary to contain,
before increment 5 encodes any of it.

- [ ] **Step 1 — write `docs/kernel-measurements.md`.** Structure:

  - **Why this document exists.** Three shapes were measured before the vocabulary was
    fixed, because a vocabulary fitted to tank-arena alone describes tank-arena.
  - **Method.** Each fixture, its QUESTION, how it was run, and that every number here came
    out of a trace rather than out of arithmetic.
  - **A results table**, one row per measurement, with columns: fixture, quantity, predicted,
    measured, verdict. Every predicted value must be the one written down *before* the run.
  - **What each result forces on the vocabulary**, and specifically:
    - whether entry cost is a property of the loop shape (as correction 1 claims) or of the
      register being written — decided by `scroll-field`;
    - whether `repositionLines` is linear in `n` — decided by `ball-and-paddles` at n = 3
      against tank-arena at n = 2;
    - whether `copies` is one catalog field or two — decided by `sprite-formation`, with the
      multiplexing cost recorded as **unmeasured**.
  - **Contradictions.** A dedicated section. If every prediction matched, say so in one line
    and note that three-for-three is weak evidence, not proof.
  - **What is still unmeasured**, listing at minimum: mid-line multiplexing, the HMOVE comb's
    visual extent (our TIA model does not render it), and `DEFAULT_STACK_RESERVED`.

- [ ] **Step 2 — revise the vocabulary in the plan's own terms.** Add a short section to
      `docs/kernel-measurements.md` titled *Vocabulary for increment 5*, listing the exact
      fields the catalog must carry and the measurement that justifies each. This is the
      input to Task 10; Task 10 must not invent a field this section does not justify.

- [ ] **Step 3 — fold in review 0.2 §2.3.** The review asked that the three genre-survey gaps
      become required catalog fields. Now that the measurements exist, decide each on the
      evidence and record the decision *with its reason* — including any the measurements
      say should stay out for now. Deferring is a legitimate answer; deferring silently is not.

- [ ] **Step 4 — update the design document.** In
      `docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md`, link
      `docs/kernel-measurements.md` from the increment 4b section and mark 4b complete. If
      any measurement contradicted the design, amend the design in place with a dated
      correction block, the same way this session amended cost rule 2 and the colour-clock
      decision. **Do not leave the design saying something the measurements disproved.**

- [ ] **Step 5 — verify.** `npm run lint && npm run typecheck && npm test`. All three
      fixtures pass, the tank-arena golden still passes, and nothing in the emulator changed.

- [ ] **Step 6 — commit and push.**
      `git add -A && git commit && git push` on `step3-plan3-layout-and-catalog`. Confirm CI
      is green on the branch push before starting increment 5 — three new ROMs assembled by
      our assembler is exactly the change that breaks on a machine that is not this one.

---
## Increment 5: the template catalog and selector

Task 1 created `packages/runtime` holding three costs, because the ledger could not be
written without them. This increment turns that seed into a catalog: each entry declares the
band shapes it applies to, what it costs, and **which registers it writes and with what
timing class**. The selector maps a band's requirements to an entry or to a diagnostic. No
kernel text is generated here — that is increment 5b.

The vocabulary comes from `docs/kernel-measurements.md` §*Vocabulary for increment 5*. **Do
not invent a field that section does not justify.** If a field seems obviously needed and is
not there, the measurement is missing; add the measurement or leave the field out.

---

### Task 10: the catalog data model

- [ ] **Step 1 — write the failing test first.** Create
      `packages/runtime/test/catalog.test.ts`. The test is not "the types compile" — that is
      the vacuous class again. It asserts **invariants over the entry data**, which is what a
      declarative catalog can actually get wrong:

```ts
describe('catalog invariants', () => {
  it('gives every entry a unique id', () => { ... });

  it('declares at least one write for every entry', () => {
    // An entry that emits no writes cannot render anything. If one appears,
    // either the entry is a stub or `writes` was never filled in.
  });

  it('only declares registers the emulator knows how to name', () => {
    // Guards against a typo'd register number silently becoming a real one.
  });

  it('never claims an entry costs negative lines', () => { ... });
});
```
      Add the deliberate known-negative: a local malformed entry (duplicate id, empty
      `writes`, `entryLines: -1`) fed through the same validator, asserted to be rejected.
      Without it, all four tests above pass on an empty catalog.

- [ ] **Step 2 — watch it fail.** `npm test -w @player1/runtime`. The validator does not
      exist yet; expect a module-not-found or a type error, then a real failure once the
      import resolves.

- [ ] **Step 3 — extend `packages/runtime/src/catalog.ts`.** Add to the types Task 1 created:

```ts
/** When during a scanline a write must land for the picture to be right. */
export type TimingClass = 'exact' | 'blank' | 'deadline';

/** A register a template writes, and the timing the template believes it has. */
export interface DeclaredWrite {
  readonly register: number;
  readonly timing: TimingClass;
}

/**
 * What must be true of a band for an entry to apply.
 *
 * The fields beyond these two come from docs/kernel-measurements.md's
 * *Vocabulary for increment 5* section, and from nowhere else. If a field seems
 * obviously needed and that section does not justify it, the measurement is
 * missing -- add the measurement, or leave the field out.
 */
export interface Applicability {
  /** Movable TIA objects the entry needs bound to it. */
  readonly objects: number;
  /** Whether the entry rewrites per-line data, and so needs a priming line. */
  readonly perLineData: boolean;
}

/**
 * What a band asks the selector for. Structurally the same shape as
 * `Applicability`, plus the span a failure points at -- deliberately a separate
 * type, because a request is not a capability and conflating them makes
 * `selectTemplate(entry.applies)` type-check.
 */
export interface BandRequirement extends Applicability {
  readonly band: string;
  readonly span: Span;
}

export interface TemplateEntry {
  readonly id: string;
  readonly summary: string;
  readonly applies: Applicability;
  readonly cost: TemplateCost;
  readonly writes: readonly DeclaredWrite[];
}
```
      Add `validateCatalog(entries): Diagnostic[]` implementing the four invariants. It
      returns diagnostics rather than throwing, so the test can feed it malformed data.

- [ ] **Step 4 — run, commit.** `npm test -w @player1/runtime`, then commit.

---

### Task 11: the three entries, as data

- [ ] **Step 1 — extend the test first.** In `packages/runtime/test/entries.test.ts`, assert
      the *content* of the three entries against the measurements, citing them:

```ts
// From docs/kernel-measurements.md: a loop writing per-line data at the top of
// each iteration charges one entry line; registers set once before the loop
// charge zero. Measured in tests/fixtures/kernels/scroll-field.asm.
it('charges two-sprite-static-field one entry line and solid-run zero', () => { ... });

it('binds two objects for two-sprite-static-field and zero for solid-run', () => { ... });
```
      These fail today: `entries.ts` from Task 1 has costs but no `applies` and no `writes`.

- [ ] **Step 2 — fill in `packages/runtime/src/entries.ts`.** Each entry's `writes` list is
      **read off the golden trace**, not recalled: for `two-sprite-static-field`, the
      registers the field loop and its priming line touch; for `solid-run`, the wall's
      `PF0`/`PF1`/`PF2`/`COLUP0`/`COLUP1`; for `bcd-score-band`, the HUD's `GRP0`/`GRP1` and
      colours. Set each write's `timing` from the class table in correction 2 — and expect
      Task 13 to fail if any is guessed wrong.

- [ ] **Step 3 — run `validateCatalog` over the real catalog in a test.** One assertion:
      `expect(validateCatalog(ENTRIES)).toEqual([])`. This is the whole reason Task 10's
      validator returns diagnostics.

- [ ] **Step 4 — run, commit.**

---

### Task 12: the selector

- [ ] **Step 1 — write the failing test first.** Create `packages/runtime/test/select.test.ts`
      with **both** halves from the start:

```ts
it('selects two-sprite-static-field for a band needing two objects and per-line data', ...);
it('selects solid-run for a band needing no objects', ...);

// The known-positive. A selector that always returns the first entry passes
// every test above.
it('reports E601 for a band no entry can satisfy', () => {
  const result = selectTemplate({ band: 'field', objects: 5, perLineData: true, span });
  expect(result.ok).toBe(false);
  expect(result.diagnostic.code).toBe('E601');
  expect(result.diagnostic.span).toEqual(span);
});
```

- [ ] **Step 2 — watch it fail,** then create `packages/runtime/src/select.ts`:

```ts
export type SelectResult =
  | { readonly ok: true; readonly entry: TemplateEntry }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

export function selectTemplate(req: BandRequirement): SelectResult;
```
      Selection is a filter over `applies` followed by a deterministic tie-break. **State the
      tie-break in a comment and make it total** — lowest total cost, then id, alphabetically.
      A selector whose result depends on array order is a selector whose output changes when
      someone reorders `entries.ts`.

- [ ] **Step 3 — the diagnostic must be useful.** `E601`'s message names what the band asked
      for and what the nearest entry offers ("band `field` needs 5 movable objects; the most
      any template provides is 2"). Assert the message text, not just the code — a diagnostic
      whose message is `"unsatisfiable"` passes a code-only assertion and helps nobody.

- [ ] **Step 4 — wire the selector into layout.** `packages/compiler/src/layout.ts` calls
      `selectTemplate` per band instead of hard-coding the ids Task 3 used. Re-run the layout
      and ledger tests: **the decomposition and the 158 must be unchanged.** If either moves,
      the selector disagrees with the hard-coding and one of them is wrong — find out which
      before proceeding.

- [ ] **Step 5 — run the full suite, commit.**

---

### Task 13: timing classes in the comparator, and the agreement test

Correction 2 settles that `RESP0`/`RESP1`/`RESM0`/`RESM1`/`RESBL` are compared on the exact
colour clock, that `HMOVE`/`RSYNC` are compared only for landing in blank, and that
everything else keeps its deadline check. Which registers are beam-sensitive is a **hardware
fact**, so the table lives in the emulator; templates declare what they believe, and this
task makes the disconnection the review warned about into a test failure.

- [ ] **Step 1 — the known-positive comes first.** Create
      `tests/fixtures/timing/resp-shift.asm`: a ROM identical to a baseline except that one
      `RESP0` strobe is delayed by a few cycles, moving the player without changing any
      `(line, register, value)` triple. Register both baseline and shifted in `ROM_SOURCES`.
      Follow `golden-base.asm` / `golden-late.asm`, which are the same pattern for deadlines.

- [ ] **Step 2 — write the failing comparator test.** In `packages/emulator/test/golden.test.ts`:

```ts
it('rejects a ROM that moves a player without changing any written value', () => {
  const expected = traceOf('golden-base');   // whichever baseline resp-shift derives from
  const actual = traceOf('resp-shift');
  const result = compareGolden(expected, actual);
  expect(result.ok).toBe(false);
  expect(result.differences[0].reason).toBe('clock');
});
```
      **Watch it fail before writing the implementation** — today's comparator ignores the
      clock, so this ROM passes, which is precisely review 0.2 §1.1's complaint made concrete.

- [ ] **Step 3 — implement.** In `packages/emulator/src/trace.ts`, add beside
      `FIRST_READ_PIXEL`:

```ts
/**
 * Which registers' writes are sensitive to WHERE the beam is, not just when.
 *
 * `exact` is a deliberate over-constraint: a player's final position is the
 * pair (coarse clock, HMPx fine value), so a different pair can encode the same
 * x. Asserting the clock rejects those alternative encodings -- no false
 * negatives, some false positives on legal-but-different positioning. Object
 * position tracking is the principled fix and is not in this increment.
 */
export const WRITE_TIMING_CLASS: Readonly<Record<number, TimingClass>> = {
  0x10: 'exact', // RESP0
  0x11: 'exact', // RESP1
  0x12: 'exact', // RESM0
  0x13: 'exact', // RESM1
  0x14: 'exact', // RESBL
  0x2a: 'blank', // HMOVE -- must be strobed in horizontal blank
  0x03: 'blank', // RSYNC
};

/** Every register not named above is `deadline`, which is the safe default. */
export function timingClass(register: number): TimingClass;
```
      Then teach `compareGolden` to branch on the class, carrying a `reason` on each
      difference (`'value' | 'clock' | 'blank' | 'deadline'`) so failures say which rule fired.

- [ ] **Step 4 — the regression that matters.** Re-run the tank-arena golden comparison. It
      must still pass: the golden was recorded from this emulator, so the clock in the file
      is the clock the ROM produces. If it now fails, the new rule is wrong, not the golden —
      **do not re-record the golden to make a new assertion pass.**

- [ ] **Step 5 — the agreement test.** Create `packages/runtime/test/timing-agreement.test.ts`:

```ts
// The hardware table is the source of truth. Templates declare what they think
// each write's timing is; this test is the only thing preventing the two from
// drifting into the "second, disconnected rule table" review 0.2 warns about.
it('agrees with the emulator about every register a template writes', () => {
  for (const entry of ENTRIES) {
    for (const write of entry.writes) {
      expect([entry.id, registerName(write.register), write.timing]).toEqual([
        entry.id,
        registerName(write.register),
        timingClass(write.register),
      ]);
    }
  }
});
```
      The array-with-id shape is deliberate: a bare `toBe` failure says `'exact' !== 'deadline'`
      and leaves you grepping for which entry. Confirm the test can fail by flipping one
      entry's declared class, seeing red, and reverting.

- [ ] **Step 6 — verify and commit.** `npm run lint && npm run typecheck && npm test`, then
      commit and push. Increment 5 is done when the catalog validates, the selector produces
      the same layout the hard-coding did, the comparator catches `resp-shift`, and templates
      and hardware agree.

---
## Increment 5b: the still-frame ROM

Everything above is checked by tests the compiler writes about itself. `expect(ledger.fieldLines).toBe(158)` asserts that the compiler computes what the compiler computes. This
increment builds a real 4096-byte ROM from the layout and runs it through the emulator, which
is the first thing in this plan that can falsify the ledger. Stella is the human look; the
emulator assertions are the check. **Nothing moves** — no input, no collisions, no scoring.
The ROM renders the scene's initial state, forever.

**The acceptance target is frame 0 of `tests/goldens/tank-arena.trace`.** Frame 0 is the idle
baseline: 79 records, both tanks at their starting positions, scores 3 and 5, nothing yet
animated. Every TIA write in it comes from init and the kernel rather than from a rule — which
is exactly the subset a static build can be expected to reproduce. `CXCLR` is the one
exception; it belongs to collision handling, which is plan 4. **Filter `CXCLR` out of both
sides and compare the rest exactly**, and say so in a comment where the filter is applied.

---

### Task 14: the frame driver

- [ ] **Step 1 — write the failing test first.** Create `packages/runtime/test/frame.test.ts`.
      The assertion is on the *emitted text's structure*, which is what a code generator can
      get wrong:

```ts
it('emits a reset vector pair at $FFFC', ...);
it('emits exactly three WSYNCs for VSYNC and thirty for overscan', ...);
it('places the caller-supplied kernel between VBLANK end and overscan start', ...);
```

- [ ] **Step 2 — create `packages/runtime/src/frame.ts`.**

```ts
export interface FrameOptions {
  /** Assembly lines for the visible region, in order. */
  readonly kernel: readonly string[];
  /** Assembly lines for one-time setup, run inside VBLANK. */
  readonly setup: readonly string[];
}

/** Wrap a visible-region kernel in a complete NTSC frame loop. */
export function emitFrame(options: FrameOptions): string[];
```
      Use **counted WSYNCs, not the timer.** `wsync-only.asm` is the ROM Stella validated at
      262 lines; `timer-only.asm`'s T is still marked PENDING a Stella reading in
      `timing-fixtures.test.ts`. Building the first compiler-emitted ROM on the unvalidated
      mechanism would put an unmeasured number under everything this increment claims to
      check. `TIM64T` arrives when its measurement does.

      **VBLANK is 37 lines minus whatever `setup` spends.** The three kernel fixtures each hit
      this and it is the most likely bug in the file, so `emitFrame` must take the number of
      lines `setup` consumes as data rather than guessing — the caller knows, because it built
      the setup from templates whose costs are declared.

- [ ] **Step 3 — run, commit.**

---

### Task 15: band kernel emission

- [ ] **Step 1 — write the failing test first.** In `packages/runtime/test/emit.test.ts`,
      assert that emitting a row group produces the declared number of WSYNCs and touches
      exactly the registers the entry's `writes` declares — nothing more:

```ts
it('emits one WSYNC per line for a run row group', ...);
it('emits only the registers the entry declares', () => {
  // The catalog says what a template writes. If the emitter writes something
  // else, the catalog is a lie and Task 13's agreement test is checking fiction.
});
```
      That second test is the one that matters: it is what keeps the catalog honest once
      there is code behind it.

- [ ] **Step 2 — create `packages/runtime/src/emit.ts`.**

```ts
export interface EmitContext {
  /** Object bindings for this band, from the layout IR. */
  readonly bindings: readonly ObjectBinding[];
  /** Line count for this row group, from the ledger. */
  readonly lines: number;
}

export function emitRowGroup(entry: TemplateEntry, ctx: EmitContext): string[];
```
      Emit the `transition` row group with the reference's `PosObjectX` idiom, so the ROM's
      boundary costs the 5 lines the ledger charged it. **The emitted line count must come
      from the ledger row, never be recomputed here** — two places computing the same number
      is two places to disagree, and the ledger is the gate.

- [ ] **Step 3 — sprite and font data.** The static ROM needs a tank sprite and a digit font.
      Take them from `examples/tank-arena/reference/tank-arena.asm`, which is our own file, and
      keep the `align 256` that makes the indexed loads a fixed 4 cycles. **Do not copy any
      table out of a third-party ROM or disassembly** — AGENTS.md forbids it, and there is no
      need: we wrote this one.

- [ ] **Step 4 — run, commit.**

---

### Task 16: `p1 build --static`

- [ ] **Step 1 — write the failing CLI test first.** In `packages/cli/test/build.test.ts`:

```ts
it('writes a 4096-byte ROM for the tank-arena example', async () => {
  const code = await run(['build', '--static', 'examples/tank-arena', '-o', out]);
  expect(code).toBe(0);
  expect(readFileSync(out).byteLength).toBe(4096);
});

it('refuses to build a scene whose ledger does not balance', async () => {
  // E503 from increment 4, surfacing through a different command. The gate is
  // the gate regardless of which entry point reaches it.
});
```

- [ ] **Step 2 — create `packages/compiler/src/build.ts`.** `buildStatic(scene)` runs
      layout → selector → ledger → `emitRowGroup` per row → `emitFrame` → `assemble`, and
      returns the ROM plus the assembly source. Return the source too: when the ROM is wrong,
      reading the text it came from is the entire debugging story.

- [ ] **Step 3 — add the command** to `packages/cli/src/index.ts` beside `check` and `fmt`,
      with `-o/--output` defaulting to `build/<scene>.bin`. `--static` is required for now and
      the error for its absence says why: dynamic builds arrive in plan 4.

- [ ] **Step 4 — the assertion that makes this increment worth doing.** In
      `packages/emulator/test/static-build.test.ts`:

```ts
it('runs 262 scanlines split 3/37/192/30', () => {
  const frame = frameOf(buildStatic(scene).rom);
  expect(frame.scanlines).toBe(262);
  expect(frame.visibleLines).toBe(192);
});

it('reproduces frame 0 of the golden trace', () => {
  // CXCLR is filtered from BOTH sides: it comes from collision handling, which
  // is plan 4. Everything else in frame 0 is init and kernel, which is exactly
  // what a static build emits.
  const expected = goldenFrame(0).filter(notCxclr);
  const actual = traceOf(rom).filter(notCxclr);
  expect(compareGolden(expected, actual).ok).toBe(true);
});
```
      **Expect this to fail the first time and expect the failure to be informative.** The
      comparator now reports a `reason` per difference, so a mismatch says whether the ledger
      put a band on the wrong line, whether a positioning strobe landed on a different clock,
      or whether a write missed a deadline. Work the differences one at a time. If a
      difference turns out to mean the ledger's 158 is wrong, **that is this increment doing
      its job** — fix the ledger and record what the trace said, in the commit message and in
      the session log.

      If a difference is genuinely a plan-4 concern rather than a layout error, widen the
      filter — but add a comment naming what was excluded and why, and list every exclusion in
      the session log. A filter that quietly grows is how a golden stops meaning anything.

- [ ] **Step 5 — the Stella script.** Add `scripts/stella.sh` (and note the Windows
      invocation in its header) that builds the ROM and opens it:

```sh
node packages/cli/bin/p1.js build --static examples/tank-arena -o build/tank-arena.bin
stella build/tank-arena.bin
```
      Document in `docs/testing.md` what a Stella run does and does not prove: it is a
      **compatibility** check against a second implementation, and a human look at the
      picture. It is not the automated check, and a green Stella run never substitutes for a
      red test.

- [ ] **Step 6 — look at it.** Build the ROM and open it in Stella. You should see the arena
      walls, both tanks at their starting positions, and the score band showing 3 and 5, with
      nothing moving. Note in the session log what it actually looked like — including
      anything wrong that the emulator did not catch, because that is a gap in the emulator
      and worth a line in `docs/kernel-measurements.md` §*What is still unmeasured*.

- [ ] **Step 7 — verify and commit.** `npm run lint && npm run typecheck && npm test`.

---

### Task 17: session log, docs, and the pull request

- [ ] **Step 1 — write `docs/session-logs/2026-08-21.md`.** One log per day, as the working
      conventions require. It must contain, at minimum:
      - the two corrections to the approved design (cost rule 2 and the colour clock) and
        that both are now applied to the design document itself;
      - every measurement from increment 4b, with predicted and measured side by side;
      - every difference filtered out of the frame-0 comparison in Task 16, and why;
      - anything Stella showed that the emulator did not;
      - what is still unmeasured, carried forward for plan 4.

- [ ] **Step 2 — update `docs/roadmap.md`.** Mark plan 3 done, increments 4, 4b, 5 and 5b
      complete, and add 5b to the increment table with a one-line note that it was added
      during planning at the user's request so output could be evaluated in Stella.

- [ ] **Step 3 — update the SPEC.** Mark `packages/runtime` as existing, add the `E5xx` and
      `E6xx` diagnostic ranges to §13 beside the `E230` it already defines, and document
      `p1 build --static` in the CLI section.

- [ ] **Step 4 — write `docs/next-session.md` for plan 4.** Replace the current contents. It
      must name: the increments plan 4 covers (6 and 7), the still-unmeasured constants
      (`DEFAULT_STACK_RESERVED`, the timer's T, multiplexing cost, the `within field` clamp
      asymmetry), the frame-0 filter list as the first thing plan 4 should shrink, and the
      conventions that carry (one session log per day, branch per plan, push early, npm
      workspaces not pnpm, DASM and Stella dev-only).

- [ ] **Step 5 — final verification.** `npm run lint && npm run typecheck && npm test` from a
      clean tree. Confirm the branch is pushed and CI is green **before** opening the PR, not
      after.

- [ ] **Step 6 — open the PR.** Title: *Layout IR, line ledger, template catalog, and a
      still-frame ROM*. The body states what is now checkable that was not before — a ledger
      that independently derives 158 and rejects an unbalanced frame, three measured kernel
      shapes, a catalog whose costs and timing classes are data, and a ROM that renders the
      arena — and lists the two design corrections so a reviewer sees them without reading the
      diff. Merge on green.

---

## Self-review checklist

Run before starting Task 1, and again before opening the PR.

- [ ] **Spec coverage.** Every requirement of increments 4, 4b and 5 in
      `docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md` maps to a task here,
      and 5b's scope is written down in this plan because it exists nowhere else.
- [ ] **No placeholders where a task expects a concrete artifact.** Increments 4 and 4b are
      written out in full -- every source file, every assertion -- because nothing they need is
      unknown. Increments 5 and 5b are specified as shapes: signatures, invariants, and the
      test names that must exist, with bodies left open. That is not laziness and not an
      oversight. Their concrete values are the output of Task 9, and writing them now would
      mean predicting the measurements and then being tempted to make the measurements agree.
      **The line between the two styles is Task 9, and it is deliberate.** What must still be
      true of increments 5 and 5b: no `TODO`, no "implement the rest", every type named, and
      every test named -- so the only thing a measurement can change is a number.
- [ ] **Type consistency.** `TemplateCost`, `TemplateEntry`, `TimingClass`, `DeclaredWrite`,
      `Applicability`, `ObjectBinding`, `RowGroup`, `LayoutIr`, `LedgerRow` and `Ledger` are
      each declared in exactly one place and used with the same shape everywhere they appear.
- [ ] **Every gate has a known-positive.** The ledger has an unbalanced scene, the selector
      has an unsatisfiable band, the comparator has `resp-shift`, `repositionLines` has
      `n = 0`, the catalog validator has a malformed entry, and each was watched failing.
- [ ] **No number was tuned.** Every constant in `packages/runtime` traces to a trace, and
      every prediction that a measurement contradicted is recorded in
      `docs/kernel-measurements.md` with both values.
- [ ] **The split held.** `packages/compiler` contains no scanline count. If it does, that
      number belongs in the runtime as template data.
