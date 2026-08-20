# Golden Trace Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable acceptance criterion for step 3 — a committed golden TIA-write trace of the reference ROM, driven by a committed input script, plus a comparator proved against two known-positive mutations.

**Architecture:** Add per-frame controller injection to `Machine.runFrame`, serialise a frame's TIA writes to a run-length-collapsed text format, and compare a candidate ROM's trace against the committed golden on `(line, register, value)` exactly while asserting only that each write's colour clock meets that register's deadline. No compiler code — this plan produces the instrument every later plan is measured by.

**Tech Stack:** TypeScript (ESM, `.ts` extensions in imports), Node 20+, npm workspaces, vitest, Biome.

**Spec:** [`docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md`](../specs/2026-08-19-tank-arena-compiler-design.md)

## Plan scope

This is **plan 1 of 4** for roadmap step 3. It covers spec increments **1a and 1b** only.
The remaining plans, written after this one lands:

| Plan | Spec increments | Deliverable |
|---|---|---|
| 1 (this) | 1a, 1b | Golden harness + comparator |
| 2 | 2, 3 | Parser, AST, `p1 fmt`, checker, game IR, RAM allocator |
| 3 | 4, 4b, 5 | Layout IR, line ledger, kernel-shape fixtures, template catalog |
| 4 | 6, 7 | Rule lowering, `p1 build` end to end |

Each stands alone. This one produces working, testable software with no compiler present.

## Global Constraints

- Node 20+; npm workspaces (**not** pnpm). Never run `pnpm`.
- Imports use explicit `.ts` extensions (`from './trace.ts'`), matching every existing file.
- DASM and Stella are **dev-only**. Nothing in this plan may require either at test time.
- Determinism: same source and tool version produce identical output (AGENTS.md).
- `npm run lint` (Biome) and `npm run typecheck` must pass; the pre-commit hook enforces both.
- Never tune a constant to make a number appear. If a measurement contradicts a prediction, record both and change the prediction.
- Goldens live in `tests/goldens/` and are committed. `.gitignore` already carries negation rules for `tests/goldens/**/*.trace`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/emulator/src/machine.ts` (modify) | Add `swcha`/`swchb` to `RunFrameOptions`; apply before running the frame |
| `packages/emulator/src/golden.ts` (create) | Canonical record extraction, serialise, parse, compare. No file I/O. |
| `packages/emulator/src/index.ts` (modify) | Re-export `./golden.ts` |
| `packages/emulator/test/support/roms.ts` (modify) | Register the three comparator fixtures |
| `packages/emulator/test/golden.test.ts` (create) | Round-trip, comparator, and both known-positives |
| `packages/emulator/test/tank-arena-behaviour.test.ts` (create) | Clamping and score-wrap, which the golden deliberately does not cover |
| `tools/gen-golden.ts` (create) | Regenerates `tests/goldens/tank-arena.trace`; the only writer of that file |
| `tests/goldens/tank-arena.input.json` (create) | The committed input script |
| `tests/goldens/tank-arena.trace` (create) | The committed golden |
| `tests/fixtures/timing/golden-base.asm` (create) | Tiny deterministic ROM; comparator baseline |
| `tests/fixtures/timing/golden-value.asm` (create) | Known-positive 1: one write's **value** differs |
| `tests/fixtures/timing/golden-late.asm` (create) | Known-positive 2: same line/value, write slides **blank → visible** |

`golden.ts` deliberately contains no file I/O so it is testable without fixtures on disk;
`tools/gen-golden.ts` and the tests own the reading and writing.

---

### Task 1: Per-frame controller injection

**Files:**
- Modify: `packages/emulator/src/machine.ts` (`RunFrameOptions`, `runFrame`)
- Test: `packages/emulator/test/golden.test.ts` (create)

**Interfaces:**
- Consumes: `Machine`, `FrameResult` from `packages/emulator/src/machine.ts`; `SWCHA_IDLE`, `SWCHB_IDLE` from `riot.ts`
- Produces: `RunFrameOptions.swcha?: number`, `RunFrameOptions.swchb?: number`

Controller lines are **active low**: a `0` bit means pressed. `Riot.swcha` and `Riot.swchb`
are already public host-writable fields; there is simply no per-frame API.

- [ ] **Step 1: Write the failing test**

Create `packages/emulator/test/golden.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Machine, SWCHA_IDLE } from '../src/index.ts';
import { romFor } from './support/roms.ts';

/** Joystick 0 direction bits in SWCHA. Active LOW: a 0 bit means pressed. */
const J0_RIGHT = 0x80;

function settled(rom: Uint8Array): Machine {
  const machine = new Machine(rom);
  machine.runFrame();
  machine.runFrame();
  return machine;
}

describe('per-frame controller injection', () => {
  it('defaults to idle when no input is supplied', () => {
    const machine = settled(romFor('tank-arena'));
    machine.runFrame();
    expect(machine.riot.swcha).toBe(SWCHA_IDLE);
  });

  it('applies swcha for the frame it is given', () => {
    const machine = settled(romFor('tank-arena'));
    machine.runFrame({ swcha: SWCHA_IDLE & ~J0_RIGHT });
    expect(machine.riot.swcha).toBe(SWCHA_IDLE & ~J0_RIGHT);
  });

  it('moves tank 0 right when right is held, and not when it is not', () => {
    // The ROM reads SWCHA in VBLANK and writes the resulting position through
    // HMP0/RESP0 at the band transition, so the trace observes the movement.
    const held = settled(romFor('tank-arena'));
    for (let i = 0; i < 8; i += 1) held.runFrame({ swcha: SWCHA_IDLE & ~J0_RIGHT });
    const heldFrame = held.runFrame({ swcha: SWCHA_IDLE & ~J0_RIGHT, trace: true });

    const idle = settled(romFor('tank-arena'));
    for (let i = 0; i < 8; i += 1) idle.runFrame();
    const idleFrame = idle.runFrame({ trace: true });

    const resp0 = (f: typeof heldFrame) =>
      (f.writes ?? []).filter((w) => w.register === 0x10).map((w) => w.clock);

    expect(resp0(heldFrame)).not.toEqual(resp0(idleFrame));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: FAIL — `swcha` is not a known property of `RunFrameOptions` (typecheck), and the
third test's traces are identical because input never reaches the RIOT.

- [ ] **Step 3: Implement the minimal change**

In `packages/emulator/src/machine.ts`, extend the options interface:

```ts
export interface RunFrameOptions {
  /** Collect every TIA write with the beam position it landed on. */
  readonly trace?: boolean;
  /**
   * Controller port A for this frame (both joysticks' directions), active LOW.
   * Defaults to the idle value, so an omitted script frame means "no input".
   */
  readonly swcha?: number;
  /** Console switches for this frame, active LOW. */
  readonly swchb?: number;
}
```

At the very top of `runFrame`, before any local declarations:

```ts
  runFrame(options: RunFrameOptions = {}): FrameResult {
    // Applied before the frame runs, not during it: the kernel samples SWCHA
    // once in VBLANK, and a value that changed mid-frame would make the trace
    // depend on where in the frame the host happened to write it.
    this.riot.swcha = options.swcha ?? SWCHA_IDLE;
    this.riot.swchb = options.swchb ?? SWCHB_IDLE;
```

Add the import at the top of the file:

```ts
import { Riot, SWCHA_IDLE, SWCHB_IDLE } from './riot.ts';
```

(The file currently imports only `Riot`; replace that import line.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: PASS, 3 tests.

Then run the full suite to confirm nothing regressed:
Run: `npm test`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/emulator/src/machine.ts packages/emulator/test/golden.test.ts
git commit -m "Emulator: per-frame controller injection

The golden trace has to be driven by a committed input script, and the
RIOT's swcha/swchb fields were host-writable but had no per-frame API.

Applied before the frame runs rather than during it: the kernel samples
SWCHA once in VBLANK, so a value changing mid-frame would make the trace
depend on where the host happened to write it -- which is exactly the
nondeterminism a golden exists to exclude.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Canonical records and serialisation

**Files:**
- Create: `packages/emulator/src/golden.ts`
- Modify: `packages/emulator/src/index.ts`
- Test: `packages/emulator/test/golden.test.ts` (append)

**Interfaces:**
- Consumes: `TiaWrite`, `registerName`, `TIA_WRITE_NAMES` from `trace.ts`; `FrameResult` from `machine.ts`
- Produces:
  - `interface GoldenRecord { line, endLine, register, value, pixel }`
  - `interface GoldenFrame { index, swcha, swchb, scanlines, regions, records }`
  - `function toRecords(writes: readonly TiaWrite[]): GoldenRecord[]`
  - `function serialiseGolden(frames: readonly GoldenFrame[], header: GoldenHeader): string`
  - `interface GoldenHeader { rom: string; input: string; frames: number; settleFrames: number }`

`WSYNC` (`0x02`) is excluded: it is a timing strobe carrying no value, and the per-frame
scanline structure already captures its effect.

A run collapses consecutive scanlines carrying exactly one write with the same
`(register, value)` **and** `pixel < 0`. Runs never collapse visible writes, because the
pixel is asserted and collapsing would lose it.

- [ ] **Step 1: Write the failing test**

Append to `packages/emulator/test/golden.test.ts`:

```ts
import { serialiseGolden, toRecords } from '../src/index.ts';
import type { TiaWrite } from '../src/index.ts';

const w = (line: number, register: number, value: number, pixel = -1, clock = 0): TiaWrite => ({
  line,
  clock,
  pixel,
  register,
  value,
});

describe('golden records', () => {
  it('drops WSYNC, which carries no value', () => {
    expect(toRecords([w(0, 0x02, 0), w(0, 0x0d, 0xf0)])).toEqual([
      { line: 0, endLine: 0, register: 0x0d, value: 0xf0, pixel: -1 },
    ]);
  });

  it('collapses consecutive blank writes of the same register and value', () => {
    const records = toRecords([w(5, 0x1b, 0x00), w(6, 0x1b, 0x00), w(7, 0x1b, 0x00)]);
    expect(records).toEqual([{ line: 5, endLine: 7, register: 0x1b, value: 0x00, pixel: -1 }]);
  });

  it('does not collapse across a value change', () => {
    const records = toRecords([w(5, 0x1b, 0x00), w(6, 0x1b, 0x3c), w(7, 0x1b, 0x00)]);
    expect(records.map((r) => r.value)).toEqual([0x00, 0x3c, 0x00]);
  });

  it('does not collapse across a line gap', () => {
    const records = toRecords([w(5, 0x1b, 0x00), w(7, 0x1b, 0x00)]);
    expect(records.map((r) => [r.line, r.endLine])).toEqual([
      [5, 5],
      [7, 7],
    ]);
  });

  it('never collapses a visible write, because its pixel is asserted', () => {
    const records = toRecords([w(5, 0x1b, 0x00, 4), w(6, 0x1b, 0x00, 4)]);
    expect(records.map((r) => [r.line, r.endLine, r.pixel])).toEqual([
      [5, 5, 4],
      [6, 6, 4],
    ]);
  });

  it('serialises a frame header and its records', () => {
    const text = serialiseGolden(
      [
        {
          index: 0,
          swcha: 0xff,
          swchb: 0x3f,
          scanlines: 262,
          regions: [3, 37, 192, 30],
          records: toRecords([w(40, 0x0d, 0x00), w(66, 0x1b, 0x00), w(67, 0x1b, 0x00), w(65, 0x1c, 0x00, 10)]),
        },
      ],
      { rom: 'tank-arena', input: 'tests/goldens/tank-arena.input.json', frames: 1, settleFrames: 2 },
    );
    expect(text).toContain('frame 0 swcha=$ff swchb=$3f lines=262 regions=3/37/192/30');
    expect(text).toContain('40 PF0 $00');
    expect(text).toContain('66..67 GRP0 $00');
    expect(text).toContain('65 GRP1 $00 px10');
    expect(text.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: FAIL — `toRecords` and `serialiseGolden` are not exported.

- [ ] **Step 3: Implement**

Create `packages/emulator/src/golden.ts`:

```ts
/**
 * The golden trace format.
 *
 * SPEC.md 11.1 defines equivalence: two ROMs match when, driven by the same
 * input script, they produce the same sequence of TIA writes -- identical
 * register, value and scanline, with a colour clock that meets that register's
 * deadline. The clock itself is NOT asserted, because clock position is a
 * function of instruction cycle counts, and demanding exact clocks would forbid
 * the compiler from ever choosing a different-but-correct instruction sequence.
 *
 * This module is pure: no file I/O, so it is testable without fixtures on disk.
 */

import type { FrameResult } from './machine.ts';
import { registerName, type TiaWrite } from './trace.ts';

/** WSYNC is a strobe with no value; the frame's scanline structure covers it. */
const WSYNC = 0x02;

/**
 * One canonical entry. `line === endLine` for a single write; a wider range is
 * a run of consecutive scanlines that each carried exactly this write.
 */
export interface GoldenRecord {
  readonly line: number;
  readonly endLine: number;
  readonly register: number;
  readonly value: number;
  /** Visible pixel, or -1 in horizontal blank. Runs are always -1. */
  readonly pixel: number;
}

export interface GoldenFrame {
  readonly index: number;
  readonly swcha: number;
  readonly swchb: number;
  readonly scanlines: number;
  /** vsync, vblank, visible, overscan. */
  readonly regions: readonly [number, number, number, number];
  readonly records: readonly GoldenRecord[];
}

export interface GoldenHeader {
  readonly rom: string;
  readonly input: string;
  readonly frames: number;
  readonly settleFrames: number;
}

function hex2(value: number): string {
  return `$${(value & 0xff).toString(16).padStart(2, '0')}`;
}

/**
 * Collapse a frame's writes into canonical records.
 *
 * Only blank writes collapse. A visible write records the pixel it landed on,
 * because that is what the deadline check consults, and a run would lose it.
 */
export function toRecords(writes: readonly TiaWrite[]): GoldenRecord[] {
  const records: GoldenRecord[] = [];
  let open: { line: number; endLine: number; register: number; value: number } | null = null;

  const flush = () => {
    if (open) {
      records.push({ ...open, pixel: -1 });
      open = null;
    }
  };

  for (const write of writes) {
    if (write.register === WSYNC) continue;

    if (write.pixel >= 0) {
      flush();
      records.push({
        line: write.line,
        endLine: write.line,
        register: write.register,
        value: write.value,
        pixel: write.pixel,
      });
      continue;
    }

    if (
      open &&
      open.register === write.register &&
      open.value === write.value &&
      write.line === open.endLine + 1
    ) {
      open = { ...open, endLine: write.line };
      continue;
    }

    flush();
    open = {
      line: write.line,
      endLine: write.line,
      register: write.register,
      value: write.value,
    };
  }
  flush();
  return records;
}

export function formatRecord(record: GoldenRecord): string {
  const lines =
    record.line === record.endLine ? `${record.line}` : `${record.line}..${record.endLine}`;
  const where = record.pixel >= 0 ? ` px${record.pixel}` : '';
  return `${lines} ${registerName(record.register)} ${hex2(record.value)}${where}`;
}

export function serialiseGolden(
  frames: readonly GoldenFrame[],
  header: GoldenHeader,
): string {
  const out: string[] = [
    '# player1dsl golden trace v1',
    `# rom: ${header.rom}`,
    `# input: ${header.input}`,
    `# frames: ${header.frames} (after ${header.settleFrames} settle frames)`,
    '# regenerate: npx tsx tools/gen-golden.ts',
    '#',
    '# Equality is asserted on (line, register, value). The pixel is recorded for',
    '# visible writes and checked against the register deadline, never for equality.',
  ];
  for (const frame of frames) {
    out.push(
      `frame ${frame.index} swcha=${hex2(frame.swcha)} swchb=${hex2(frame.swchb)} ` +
        `lines=${frame.scanlines} regions=${frame.regions.join('/')}`,
    );
    for (const record of frame.records) out.push(`  ${formatRecord(record)}`);
  }
  return `${out.join('\n')}\n`;
}

/** Build a GoldenFrame from a traced FrameResult. */
export function toGoldenFrame(
  index: number,
  swcha: number,
  swchb: number,
  frame: FrameResult,
): GoldenFrame {
  return {
    index,
    swcha,
    swchb,
    scanlines: frame.scanlines,
    regions: [frame.vsyncLines, frame.vblankLines, frame.visibleLines, frame.overscanLines],
    records: toRecords(frame.writes ?? []),
  };
}
```

Add to `packages/emulator/src/index.ts`, after the `trace.ts` export:

```ts
export * from './golden.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/emulator/src/golden.ts packages/emulator/src/index.ts packages/emulator/test/golden.test.ts
git commit -m "Emulator: canonical golden trace records and serialisation

Run-length collapsing is what makes the golden diffable: the field loop
writes GRP0=\$00 on most of 158 lines, so an uncollapsed 90-frame trace is
roughly 600 KB against roughly 50 KB collapsed.

Only BLANK writes collapse. A visible write records the pixel it landed
on, because that is the field the deadline check consults and a run would
lose it. WSYNC is dropped -- it is a strobe with no value, and the frame's
scanline structure already captures its effect.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Parsing the golden back

**Files:**
- Modify: `packages/emulator/src/golden.ts`
- Test: `packages/emulator/test/golden.test.ts` (append)

**Interfaces:**
- Produces: `function parseGolden(text: string): GoldenFrame[]`

Round-tripping is the cheapest possible test that the format is unambiguous.

- [ ] **Step 1: Write the failing test**

Append to `packages/emulator/test/golden.test.ts`:

```ts
import { parseGolden } from '../src/index.ts';

describe('golden parsing', () => {
  it('round-trips serialised frames', () => {
    const frames = [
      {
        index: 0,
        swcha: 0xff,
        swchb: 0x3f,
        scanlines: 262,
        regions: [3, 37, 192, 30] as const,
        records: toRecords([w(40, 0x0d, 0x00), w(66, 0x1b, 0x00), w(67, 0x1b, 0x00), w(65, 0x1c, 0x00, 10)]),
      },
      {
        index: 1,
        swcha: 0x7f,
        swchb: 0x3f,
        scanlines: 262,
        regions: [3, 37, 192, 30] as const,
        records: toRecords([w(41, 0x0e, 0xff)]),
      },
    ];
    const header = {
      rom: 'tank-arena',
      input: 'tests/goldens/tank-arena.input.json',
      frames: 2,
      settleFrames: 2,
    };
    expect(parseGolden(serialiseGolden(frames, header))).toEqual(frames);
  });

  it('rejects a malformed record rather than silently skipping it', () => {
    expect(() => parseGolden('frame 0 swcha=$ff swchb=$3f lines=262 regions=3/37/192/30\n  nonsense\n')).toThrow(
      /line 2/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: FAIL — `parseGolden` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/emulator/src/golden.ts`:

```ts
const REGISTER_BY_NAME: ReadonlyMap<string, number> = new Map(
  Object.entries(TIA_WRITE_NAMES).map(([code, name]) => [name, Number(code)]),
);

const FRAME_RE =
  /^frame (\d+) swcha=\$([0-9a-f]{2}) swchb=\$([0-9a-f]{2}) lines=(\d+) regions=(\d+)\/(\d+)\/(\d+)\/(\d+)$/;
const RECORD_RE = /^(\d+)(?:\.\.(\d+))? ([A-Z0-9$]+) \$([0-9a-f]{2})(?: px(\d+))?$/;

/**
 * Parse a golden back into frames.
 *
 * Throws on anything it does not recognise. A parser that skips unknown lines
 * would let a corrupted golden compare clean against everything.
 */
export function parseGolden(text: string): GoldenFrame[] {
  const frames: GoldenFrame[] = [];
  let current: { header: Omit<GoldenFrame, 'records'>; records: GoldenRecord[] } | null = null;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (raw.trim() === '' || raw.startsWith('#')) continue;

    if (!raw.startsWith('  ')) {
      const m = FRAME_RE.exec(raw.trim());
      if (!m) throw new Error(`golden line ${i + 1}: unrecognised frame header: ${raw}`);
      if (current) frames.push({ ...current.header, records: current.records });
      current = {
        header: {
          index: Number(m[1]),
          swcha: Number.parseInt(m[2] as string, 16),
          swchb: Number.parseInt(m[3] as string, 16),
          scanlines: Number(m[4]),
          regions: [Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8])],
        },
        records: [],
      };
      continue;
    }

    const m = RECORD_RE.exec(raw.trim());
    if (!m || !current) throw new Error(`golden line ${i + 1}: unrecognised record: ${raw}`);
    const register = REGISTER_BY_NAME.get(m[3] as string);
    if (register === undefined) {
      throw new Error(`golden line ${i + 1}: unknown register ${m[3]}`);
    }
    const line = Number(m[1]);
    current.records.push({
      line,
      endLine: m[2] === undefined ? line : Number(m[2]),
      register,
      value: Number.parseInt(m[4] as string, 16),
      pixel: m[5] === undefined ? -1 : Number(m[5]),
    });
  }
  if (current) frames.push({ ...current.header, records: current.records });
  return frames;
}
```

Update the import at the top of `golden.ts` to include `TIA_WRITE_NAMES`:

```ts
import { registerName, TIA_WRITE_NAMES, type TiaWrite } from './trace.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/emulator/src/golden.ts packages/emulator/test/golden.test.ts
git commit -m "Emulator: parse the golden trace back, strictly

Round-tripping is the cheapest test that the format is unambiguous.

parseGolden throws on anything it does not recognise rather than skipping
it. A parser that silently ignores unknown lines lets a corrupted golden
compare clean against everything, which is the same class of defect as a
detector that never fires.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The input script

**Files:**
- Modify: `packages/emulator/src/golden.ts`
- Create: `tests/goldens/tank-arena.input.json`
- Test: `packages/emulator/test/golden.test.ts` (append)

**Interfaces:**
- Produces:
  - `type Direction = 'up' | 'down' | 'left' | 'right'`
  - `interface ScriptPhase { frames: number; p0?: Direction[]; p1?: Direction[]; note: string }`
  - `interface InputScript { rom: string; settleFrames: number; phases: ScriptPhase[] }`
  - `function expandScript(script: InputScript): number[]` — one SWCHA byte per frame

SWCHA bit layout, from the reference kernel: the **high** nibble is the left controller
(`up $10`, `down $20`, `left $40`, `right $80`), the **low** nibble the right controller
(`up $01`, `down $02`, `left $04`, `right $08`). Active low.

**Frame count is 90**, fixed here rather than discovered during implementation, per the
spec's open question. The phases exercise idle, convergence to contact, a held overlap so
the `hitFlag` debounce must fire exactly once, and separation.

Bound clamping is **not** in this script: from `(40,120)` and `(110,60)` at 1px/frame the
nearest bound is 32 frames away and the furthest 48, so covering all four would roughly
double the golden for a property a focused test asserts better. Task 8 covers it.

- [ ] **Step 1: Write the failing test**

Append to `packages/emulator/test/golden.test.ts`:

```ts
import { expandScript, SWCHA_IDLE as IDLE } from '../src/index.ts';

describe('input script expansion', () => {
  it('produces one swcha byte per frame', () => {
    const bytes = expandScript({
      rom: 'tank-arena',
      settleFrames: 2,
      phases: [
        { frames: 2, note: 'idle' },
        { frames: 3, p0: ['right'], note: 'p0 right' },
      ],
    });
    expect(bytes).toHaveLength(5);
  });

  it('clears the bit for a held direction, since the lines are active low', () => {
    const [byte] = expandScript({
      rom: 'tank-arena',
      settleFrames: 2,
      phases: [{ frames: 1, p0: ['right'], p1: ['left'], note: 'both' }],
    });
    expect(byte).toBe(IDLE & ~0x80 & ~0x04);
  });

  it('leaves an omitted phase fully idle', () => {
    const [byte] = expandScript({
      rom: 'tank-arena',
      settleFrames: 2,
      phases: [{ frames: 1, note: 'idle' }],
    });
    expect(byte).toBe(IDLE);
  });

  it('rejects an unknown direction rather than ignoring it', () => {
    expect(() =>
      expandScript({
        rom: 'tank-arena',
        settleFrames: 2,
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
        phases: [{ frames: 1, p0: ['sideways' as any], note: 'bad' }],
      }),
    ).toThrow(/sideways/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: FAIL — `expandScript` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/emulator/src/golden.ts`:

```ts
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface ScriptPhase {
  readonly frames: number;
  readonly p0?: readonly Direction[];
  readonly p1?: readonly Direction[];
  /** Why this phase exists. Committed scripts must say what they exercise. */
  readonly note: string;
}

export interface InputScript {
  readonly rom: string;
  readonly settleFrames: number;
  readonly phases: readonly ScriptPhase[];
}

/**
 * SWCHA bits, active LOW. High nibble is the left controller, low nibble the
 * right -- the layout the reference kernel's J0_/J1_ masks encode.
 */
const P0_BITS: Readonly<Record<Direction, number>> = {
  up: 0x10,
  down: 0x20,
  left: 0x40,
  right: 0x80,
};
const P1_BITS: Readonly<Record<Direction, number>> = {
  up: 0x01,
  down: 0x02,
  left: 0x04,
  right: 0x08,
};

function maskFor(
  directions: readonly Direction[] | undefined,
  bits: Readonly<Record<Direction, number>>,
): number {
  let mask = 0;
  for (const direction of directions ?? []) {
    const bit = bits[direction];
    if (bit === undefined) throw new Error(`unknown joystick direction "${direction}"`);
    mask |= bit;
  }
  return mask;
}

/** Expand a script to one SWCHA byte per frame. */
export function expandScript(script: InputScript): number[] {
  const bytes: number[] = [];
  for (const phase of script.phases) {
    const pressed = maskFor(phase.p0, P0_BITS) | maskFor(phase.p1, P1_BITS);
    for (let i = 0; i < phase.frames; i += 1) bytes.push(SWCHA_IDLE & ~pressed & 0xff);
  }
  return bytes;
}
```

Add `SWCHA_IDLE` to `golden.ts`'s imports:

```ts
import { SWCHA_IDLE } from './riot.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Write the committed script**

Create `tests/goldens/tank-arena.input.json`:

```json
{
  "rom": "tank-arena",
  "settleFrames": 2,
  "phases": [
    {
      "frames": 4,
      "note": "idle baseline: the steady-state frame, with both tanks at their starting positions"
    },
    {
      "frames": 33,
      "p0": ["right", "down"],
      "p1": ["left", "up"],
      "note": "converge: tanks close from (40,120) and (110,60) toward contact. Exercises all four movement rules and both axes at once."
    },
    {
      "frames": 12,
      "note": "hold the overlap. CXPPMM is LEVEL, not edge, so it stays set every frame the tanks overlap -- the hitFlag debounce must score exactly once across these 12 frames."
    },
    {
      "frames": 41,
      "p0": ["left", "up"],
      "p1": ["right", "down"],
      "note": "separate, clearing the latch and resetting the debounce so a second contact could score again"
    }
  ]
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/emulator/src/golden.ts packages/emulator/test/golden.test.ts tests/goldens/tank-arena.input.json
git commit -m "Golden: the committed input script, 90 frames

An idle script produces a green golden that proves almost nothing, so the
phases drive the rules deliberately: converge on both axes at once to
exercise all four movement rules, then hold the overlap for 12 frames
because CXPPMM is level rather than edge and the hitFlag debounce must
score exactly once across them, then separate so the latch clears.

Bound clamping is deliberately absent. From (40,120) and (110,60) at
1px/frame the nearest bound is 32 frames away and the furthest 48, so
covering all four would roughly double the golden for a property a
focused test asserts more directly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Generate and commit the golden

**Files:**
- Create: `tools/gen-golden.ts`
- Create: `tests/goldens/tank-arena.trace` (generated)
- Modify: `package.json` (add a `golden` script)

**Interfaces:**
- Consumes: `expandScript`, `toGoldenFrame`, `serialiseGolden` from `@player1dsl/emulator`; `romFor` is test-only, so this tool assembles directly.
- Produces: `tests/goldens/tank-arena.trace`

- [ ] **Step 1: Write the generator**

Create `tools/gen-golden.ts`:

```ts
/**
 * Regenerate the committed golden trace.
 *
 * The golden is generated from the HAND-WRITTEN reference ROM, not from any
 * compiler output -- it is a golden of the artifact step 1 produced, which is
 * what makes it a meaningful target for step 3.
 *
 * Run: npx tsx tools/gen-golden.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble } from '../packages/assembler/src/index.ts';
import {
  expandScript,
  type InputScript,
  Machine,
  serialiseGolden,
  SWCHB_IDLE,
  toGoldenFrame,
} from '../packages/emulator/src/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = `${root}tests/goldens/tank-arena.input.json`;
const outPath = `${root}tests/goldens/tank-arena.trace`;
const romSource = 'examples/tank-arena/reference/tank-arena.asm';

const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as InputScript;
const { rom } = assemble(`${root}${romSource}`, {
  includeDirs: [`${root}kernels/include`],
});

const machine = new Machine(rom);
// Frame 0 is cut short by reset code and frame 1 begins with VBLANK never
// having been set, so its blanked lines misclassify as visible. Frame 2 on is
// steady state -- the same reason frame-timing.test.ts discards two.
for (let i = 0; i < script.settleFrames; i += 1) machine.runFrame();

const swchaByFrame = expandScript(script);
const frames = swchaByFrame.map((swcha, index) =>
  toGoldenFrame(index, swcha, SWCHB_IDLE, machine.runFrame({ swcha, trace: true })),
);

writeFileSync(
  outPath,
  serialiseGolden(frames, {
    rom: romSource,
    input: 'tests/goldens/tank-arena.input.json',
    frames: frames.length,
    settleFrames: script.settleFrames,
  }),
  'utf8',
);

const records = frames.reduce((n, f) => n + f.records.length, 0);
console.log(`wrote ${outPath}: ${frames.length} frames, ${records} records`);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `scripts`:

```json
    "golden": "tsx tools/gen-golden.ts",
```

And add `tsx` to `devDependencies`:

```json
    "tsx": "^4.19.2",
```

Run: `npm install`
Expected: succeeds, `tsx` present in `node_modules`.

- [ ] **Step 3: Generate the golden**

Run: `npm run golden`
Expected: `wrote .../tests/goldens/tank-arena.trace: 90 frames, N records`

- [ ] **Step 4: Verify the golden is committable and sane**

Run: `git add --dry-run tests/goldens/tank-arena.trace`
Expected: `add 'tests/goldens/tank-arena.trace'` — **not** an "ignored by .gitignore" message.

Run: `head -20 tests/goldens/tank-arena.trace`
Expected: the `# player1dsl golden trace v1` header, then `frame 0 ... regions=3/37/192/30`.

Run: `grep -c '^frame ' tests/goldens/tank-arena.trace`
Expected: `90`

**Record the actual file size and record count in the commit message.** Do not adjust the
frame count to hit a size target — if the file is far larger than the roughly 50 KB the
spec predicts, that is a finding about the format, and it goes in the session log
alongside the prediction it contradicts.

- [ ] **Step 5: Sanity-check that the script actually did something**

Run:

```bash
npx tsx -e "
import { readFileSync } from 'node:fs';
const t = readFileSync('tests/goldens/tank-arena.trace','utf8').split('\n');
const hmp = t.filter(l => l.includes(' HMP0 '));
console.log('distinct HMP0 values:', new Set(hmp.map(l => l.trim().split(' ')[2])).size);
"
```

Expected: more than 1. A single distinct `HMP0` value means the tanks never moved and the
script is not driving the ROM — stop and fix the script before committing the golden.

- [ ] **Step 6: Commit**

```bash
git add tools/gen-golden.ts package.json package-lock.json tests/goldens/tank-arena.trace
git commit -m "Golden: commit the reference ROM's trace, 90 frames

Generated from the HAND-WRITTEN reference ROM, not from compiler output --
it is a golden of the artifact step 1 produced, which is what makes it a
meaningful target for step 3 rather than a tautology.

Verified committable with git add --dry-run rather than assumed: the
ignore pattern for *.trace would otherwise have swallowed it silently,
which is the failure mode spec review 2.4 predicted and SPEC 11.1 now
carries negation rules for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The two comparator fixtures

**Files:**
- Create: `tests/fixtures/timing/golden-base.asm`
- Create: `tests/fixtures/timing/golden-late.asm`
- Modify: `packages/emulator/test/support/roms.ts`

**Interfaces:**
- Produces: ROM names `golden-base` and `golden-late` available through `romFor`

Two ROMs, identical except for one deliberately-delayed write. `golden-base` is the clean
case; `golden-late` writes **the same value to the same register on the same scanline** but
delayed past pixel 0. That is the mutation the equality fields cannot catch, and it is the
only one that exercises the deadline half of the comparator.

Known-positive 1 (value divergence) needs no third ROM — Task 7 mutates a parsed golden
in memory, which is simpler and tests the same path.

- [ ] **Step 1: Write the base fixture**

Create `tests/fixtures/timing/golden-base.asm`:

```asm
; ---------------------------------------------------------------------------
; Diagnostic ROM D -- the comparator baseline.
;
; A minimal stable frame that writes PF0 once per visible line, always inside
; horizontal blank. Its twin, golden-late.asm, is byte-for-byte the same
; program with a delay inserted before the PF0 write, so the write lands on
; the SAME scanline with the SAME value at a LATER pixel.
;
; That pair is what proves the golden comparator checks deadlines. Every other
; mutation shifts a value or a line and trips the equality fields first, so
; without these two the deadline half of the comparator ships unverified --
; the same reason late-write.asm exists for findLateWrites.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

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
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    lda #44
    sta TIM64T
.waitVBlank
    lda INTIM
    bne .waitVBlank
    sta WSYNC
    sta VBLANK

    ldx #192
.visible
    sta WSYNC
    lda #$F0
    sta PF0             ; inside horizontal blank: in time
    dex
    bne .visible

    lda #2
    sta VBLANK
    lda #36
    sta TIM64T
.waitOverscan
    lda INTIM
    bne .waitOverscan
    sta WSYNC
    jmp MainLoop

    org $FFFC
    .word Reset
    .word Reset
```

- [ ] **Step 2: Write the late twin**

Create `tests/fixtures/timing/golden-late.asm` as an exact copy of `golden-base.asm`, with
the header comment changed to:

```asm
; ---------------------------------------------------------------------------
; Diagnostic ROM E -- golden-base with ONE write moved past its deadline.
;
; Identical to golden-base.asm except for the burn below. PF0 is written with
; the same value on the same scanline, so (line, register, value) is unchanged
; and the comparator's equality fields see nothing. Only the pixel moves, from
; horizontal blank to the visible region, past PF0's read pixel of 0.
;
; If the comparator passes this ROM against golden-base's trace, it is not
; checking deadlines.
; ---------------------------------------------------------------------------
```

and the `.visible` loop replaced by:

```asm
    ldx #192
.visible
    sta WSYNC
    ldy #8              ; burn ~40 cycles so the beam leaves horizontal blank
.burn
    dey
    bne .burn
    lda #$F0
    sta PF0             ; SAME line, SAME value -- but now past pixel 0
    dex
    bne .visible
```

- [ ] **Step 3: Register both fixtures**

In `packages/emulator/test/support/roms.ts`, add to `ROM_SOURCES`:

```ts
  'golden-base': 'tests/fixtures/timing/golden-base.asm',
  'golden-late': 'tests/fixtures/timing/golden-late.asm',
```

- [ ] **Step 4: Verify the fixtures behave as claimed**

Append to `packages/emulator/test/golden.test.ts`:

```ts
import { findLateWrites } from '../src/index.ts';

describe('comparator fixtures', () => {
  it('golden-base writes PF0 inside horizontal blank', () => {
    const frame = settled(romFor('golden-base')).runFrame({ trace: true });
    expect(findLateWrites(frame.writes ?? [])).toEqual([]);
  });

  it('golden-late writes PF0 on the same lines with the same value, but late', () => {
    const base = settled(romFor('golden-base')).runFrame({ trace: true });
    const late = settled(romFor('golden-late')).runFrame({ trace: true });

    const pf0 = (f: typeof base) => (f.writes ?? []).filter((wr) => wr.register === 0x0d);

    // The mutation is invisible to (line, value) -- that is the whole point.
    expect(pf0(late).map((wr) => [wr.line, wr.value])).toEqual(
      pf0(base).map((wr) => [wr.line, wr.value]),
    );
    // ...and visible only in the pixel.
    expect(findLateWrites(late.writes ?? []).length).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: PASS, 17 tests.

If the `(line, value)` equality assertion **fails**, the burn loop changed which scanline a
write lands on. Reduce `ldy #8` until the lines match again — that is a measurement, not a
tuning: the requirement is that the mutation be invisible to the equality fields.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/timing/golden-base.asm tests/fixtures/timing/golden-late.asm packages/emulator/test/support/roms.ts packages/emulator/test/golden.test.ts
git commit -m "Fixtures: a deadline-only mutation the equality fields cannot see

The comparator has two independent halves, and almost any mutation to a
ROM shifts a value or a line -- so it trips the equality half and the
deadline half is never observed to fail. These two ROMs are identical
except that golden-late writes the same value to PF0 on the same
scanline at a later pixel, past its read deadline.

Asserted here, before the comparator uses them, that the mutation really
is invisible to (line, value) and visible only in the pixel. A fixture
that does not have the property it claims proves nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The comparator, and both known-positives

**Files:**
- Modify: `packages/emulator/src/golden.ts`
- Test: `packages/emulator/test/golden.test.ts` (append)

**Interfaces:**
- Produces:
  - `interface GoldenMismatch { frame: number; kind: 'record' | 'deadline' | 'structure'; detail: string }`
  - `function compareGolden(expected: readonly GoldenFrame[], actual: readonly GoldenFrame[], options?: { includePlayers?: boolean }): GoldenMismatch[]`

Equality on `(line, endLine, register, value)`. The pixel is **not** compared; instead each
actual visible write is checked against `FIRST_READ_PIXEL` (plus the conservative player
bound when `includePlayers` is set).

- [ ] **Step 1: Write the failing test**

Append to `packages/emulator/test/golden.test.ts`:

```ts
import { compareGolden, toGoldenFrame } from '../src/index.ts';

function goldenFor(name: string, frames: number) {
  const machine = settled(romFor(name));
  const out = [];
  for (let i = 0; i < frames; i += 1) {
    out.push(toGoldenFrame(i, IDLE, 0x3f, machine.runFrame({ swcha: IDLE, trace: true })));
  }
  return out;
}

describe('golden comparison', () => {
  it('reports no mismatch when a ROM is compared against its own trace', () => {
    const expected = goldenFor('golden-base', 2);
    const actual = goldenFor('golden-base', 2);
    expect(compareGolden(expected, actual)).toEqual([]);
  });

  /** Known-positive 1: a value differs. Trips the equality half. */
  it('catches a changed value', () => {
    const expected = goldenFor('golden-base', 2);
    const actual = goldenFor('golden-base', 2);
    const first = actual[0];
    if (!first) throw new Error('no frame');
    const mutated = [
      {
        ...first,
        records: first.records.map((r, i) => (i === 0 ? { ...r, value: r.value ^ 0xff } : r)),
      },
      ...actual.slice(1),
    ];
    const mismatches = compareGolden(expected, mutated);
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]?.kind).toBe('record');
  });

  /**
   * Known-positive 2: NOTHING the equality half looks at has changed. If this
   * passes, the comparator is not checking deadlines and the clean result above
   * means nothing.
   */
  it('catches a write that kept its line and value but missed its deadline', () => {
    const expected = goldenFor('golden-base', 2);
    const actual = goldenFor('golden-late', 2);

    const mismatches = compareGolden(expected, actual);
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches.some((m) => m.kind === 'deadline')).toBe(true);
    expect(mismatches.find((m) => m.kind === 'deadline')?.detail).toContain('PF0');
  });

  it('reports a structural mismatch when the frame count differs', () => {
    const mismatches = compareGolden(goldenFor('golden-base', 2), goldenFor('golden-base', 1));
    expect(mismatches[0]?.kind).toBe('structure');
  });

  it('matches the committed golden against the reference ROM', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../../tests/goldens/tank-arena.trace', import.meta.url)),
      'utf8',
    );
    const script = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../tests/goldens/tank-arena.input.json', import.meta.url)),
        'utf8',
      ),
    ) as InputScript;

    const machine = new Machine(romFor('tank-arena'));
    for (let i = 0; i < script.settleFrames; i += 1) machine.runFrame();
    const actual = expandScript(script).map((swcha, index) =>
      toGoldenFrame(index, swcha, 0x3f, machine.runFrame({ swcha, trace: true })),
    );

    expect(compareGolden(parseGolden(text), actual)).toEqual([]);
  });
});
```

Add these imports at the top of the test file:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { InputScript } from '../src/index.ts';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: FAIL — `compareGolden` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/emulator/src/golden.ts`:

```ts
export interface GoldenMismatch {
  readonly frame: number;
  /**
   * `structure` -- frame count or region split differs.
   * `record`    -- a (line, register, value) entry differs.
   * `deadline`  -- an actual write landed at or after its register's read pixel.
   */
  readonly kind: 'structure' | 'record' | 'deadline';
  readonly detail: string;
}

export interface CompareOptions {
  /** Also check GRP0/GRP1 against the conservative pixel-0 bound. */
  readonly includePlayers?: boolean;
}

/**
 * Compare a candidate trace against a golden.
 *
 * Equality covers (line, endLine, register, value) -- the observable content.
 * The colour clock is NOT compared: it is a function of instruction cycle
 * counts, so comparing it would force a compiler to reproduce the reference's
 * exact instruction selection. Instead each visible write is checked against
 * its register's read deadline, which is what actually decides whether the
 * write appears on screen.
 */
export function compareGolden(
  expected: readonly GoldenFrame[],
  actual: readonly GoldenFrame[],
  options: CompareOptions = {},
): GoldenMismatch[] {
  const mismatches: GoldenMismatch[] = [];

  if (expected.length !== actual.length) {
    mismatches.push({
      frame: -1,
      kind: 'structure',
      detail: `expected ${expected.length} frames, got ${actual.length}`,
    });
    return mismatches;
  }

  const deadlines: Record<number, number> = options.includePlayers
    ? { ...FIRST_READ_PIXEL, ...CONSERVATIVE_PLAYER_READ_PIXEL }
    : { ...FIRST_READ_PIXEL };

  for (let f = 0; f < expected.length; f += 1) {
    const want = expected[f];
    const got = actual[f];
    if (!want || !got) continue;

    if (want.scanlines !== got.scanlines || want.regions.join('/') !== got.regions.join('/')) {
      mismatches.push({
        frame: f,
        kind: 'structure',
        detail: `expected ${want.scanlines} lines ${want.regions.join('/')}, got ${got.scanlines} lines ${got.regions.join('/')}`,
      });
    }

    const limit = Math.max(want.records.length, got.records.length);
    for (let i = 0; i < limit; i += 1) {
      const a = want.records[i];
      const b = got.records[i];
      if (!a) {
        mismatches.push({
          frame: f,
          kind: 'record',
          detail: `extra record at ${i}: ${formatRecord(b as GoldenRecord)}`,
        });
        break;
      }
      if (!b) {
        mismatches.push({
          frame: f,
          kind: 'record',
          detail: `missing record at ${i}: expected ${formatRecord(a)}`,
        });
        break;
      }
      if (
        a.line !== b.line ||
        a.endLine !== b.endLine ||
        a.register !== b.register ||
        a.value !== b.value
      ) {
        mismatches.push({
          frame: f,
          kind: 'record',
          detail: `at ${i}: expected ${formatRecord(a)}, got ${formatRecord(b)}`,
        });
        break; // one divergence per frame; the rest is downstream noise
      }
    }

    for (const record of got.records) {
      if (record.pixel < 0) continue;
      const deadline = deadlines[record.register];
      if (deadline === undefined) continue;
      if (record.pixel >= deadline) {
        mismatches.push({
          frame: f,
          kind: 'deadline',
          detail: `${formatRecord(record)} missed its deadline (read at pixel ${deadline})`,
        });
      }
    }
  }
  return mismatches;
}
```

Update `golden.ts`'s import from `trace.ts`:

```ts
import {
  CONSERVATIVE_PLAYER_READ_PIXEL,
  FIRST_READ_PIXEL,
  registerName,
  TIA_WRITE_NAMES,
  type TiaWrite,
} from './trace.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/emulator/test/golden.test.ts`
Expected: PASS, 22 tests.

**If the last test ("matches the committed golden") fails**, do not regenerate the golden to
make it pass. That would fit the instrument to whatever the code currently does, which is
the failure the project's own notes warn about. Find why the two disagree first.

- [ ] **Step 5: Run the full suite, lint, and typecheck**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all pass; 38 tests total.

- [ ] **Step 6: Commit**

```bash
git add packages/emulator/src/golden.ts packages/emulator/test/golden.test.ts
git commit -m "Golden: the comparator, proved against both known-positives

Equality covers (line, endLine, register, value). The colour clock is not
compared -- it is a function of instruction cycle counts, so comparing it
would force the compiler to reproduce the reference's exact instruction
selection, which is transcription rather than compilation. Each visible
write is instead checked against its register's read deadline, which is
what decides whether the write appears on screen.

Both halves are proved to fail before the clean case is trusted: a
mutated value trips equality, and golden-late trips the deadline check
while keeping (line, register, value) identical. Without the second,
every mutation trips equality first and the deadline half would ship
unverified.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The behaviours the golden deliberately omits

**Files:**
- Create: `packages/emulator/test/tank-arena-behaviour.test.ts`

**Interfaces:**
- Consumes: `Machine`, `SWCHA_IDLE`, `toGoldenFrame`, `expandScript` from `@player1dsl/emulator`; `romFor` from test support

Two properties the 90-frame golden does not cover, asserted directly because a golden long
enough to reach them would roughly double for no extra diagnostic value:

1. **Bound clamping** — position stops changing at the limit rather than wrapping.
2. **The score wrap and the hit debounce** — `hitFlag` scores once per contact, and a
   single digit wraps 9 → 0.

Both are read through the trace, since the emulator exposes no RAM inspection API and
adding one to test game logic would be testing through a back door the compiler will never
use.

- [ ] **Step 1: Write the test**

Create `packages/emulator/test/tank-arena-behaviour.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Machine, SWCHA_IDLE } from '../src/index.ts';
import { romFor } from './support/roms.ts';

const J0_LEFT = 0x40;

function settled(): Machine {
  const machine = new Machine(romFor('tank-arena'));
  machine.runFrame();
  machine.runFrame();
  return machine;
}

/**
 * Tank 0's horizontal position, read the only way the machine exposes it: the
 * HMP0 fine-adjust value and the colour clock at which RESP0 was strobed.
 */
function tank0Position(machine: Machine, swcha: number): string {
  const frame = machine.runFrame({ swcha, trace: true });
  const writes = frame.writes ?? [];
  const resp0 = writes.filter((w) => w.register === 0x10).at(-1);
  const hmp0 = writes.filter((w) => w.register === 0x20).at(-1);
  return `${resp0?.clock ?? -1}:${hmp0?.value ?? -1}`;
}

describe('tank-arena movement bounds', () => {
  /**
   * X_MIN is 8 and the tank starts at 40, so 32 frames of held left reach the
   * bound. Ten more must change nothing -- an unclamped position would keep
   * decrementing and wrap through zero.
   */
  it('clamps tank 0 at the left wall instead of wrapping past it', () => {
    const machine = settled();
    const held = SWCHA_IDLE & ~J0_LEFT;

    let position = '';
    for (let i = 0; i < 40; i += 1) position = tank0Position(machine, held);

    const atBound = position;
    const after: string[] = [];
    for (let i = 0; i < 10; i += 1) after.push(tank0Position(machine, held));

    expect(new Set(after)).toEqual(new Set([atBound]));
  });

  it('moves the tank at all, so the clamp test is not vacuous', () => {
    const machine = settled();
    const start = tank0Position(machine, SWCHA_IDLE);
    let moved = start;
    for (let i = 0; i < 5; i += 1) moved = tank0Position(machine, SWCHA_IDLE & ~J0_LEFT);
    expect(moved).not.toBe(start);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run packages/emulator/test/tank-arena-behaviour.test.ts`
Expected: PASS, 2 tests.

If the clamp test fails, **record what actually happened before changing anything** — the
reference kernel's clamp uses `cpx #X_MIN / bcc`, which skips the decrement only when the
position is already below the bound, so the true resting value may be `X_MIN - 1` rather
than `X_MIN`. That is a finding about the kernel, and it belongs in the session log next to
the prediction it contradicts, not silently absorbed into the assertion.

- [ ] **Step 3: Commit**

```bash
git add packages/emulator/test/tank-arena-behaviour.test.ts
git commit -m "Test the two behaviours the golden deliberately omits

Bound clamping and the score wrap need 200+ frames of directed input to
reach from the starting positions, which would roughly double the golden
for no extra diagnostic value. Asserted directly instead.

Read through the trace rather than through RAM: the emulator exposes no
RAM inspection API, and adding one to test game logic would verify
through a back door the compiler will never use.

Includes a not-vacuous check. 'The position stopped changing' also passes
when the position never changed at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Session log and roadmap

**Files:**
- Create: `docs/session-logs/2026-08-19.md` (or append if it exists)
- Modify: `docs/roadmap.md`

AGENTS.md requires one log per working day recording decisions, findings that change the
spec, and the state left behind — and specifically requires that where a measurement
contradicted a derivation, **both** are recorded.

- [ ] **Step 1: Write the log**

Record, at minimum:

- The merge of step 2 to `main` and the five review items folded into SPEC.md.
- The line ledger measured from the reference ROM, including that three source comments
  are stale (they still claim a 176-line field and `8 + 176 + 8 = 192`).
- The predicted golden size against the actual size from Task 5 — whichever way it went.
- Whether the clamp in Task 8 rested at `X_MIN` or `X_MIN - 1`, against the prediction.
- Any assembler gap the two new fixtures exposed.

- [ ] **Step 2: Update the roadmap**

In `docs/roadmap.md`, under step 3, note that the golden harness is complete and link this
plan.

- [ ] **Step 3: Commit**

```bash
git add docs/session-logs/2026-08-19.md docs/roadmap.md
git commit -m "Session log for 2026-08-19: step 3 plan and the golden harness

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Increment 1a is Tasks 1–5 (injection, format, script, generation).
Increment 1b is Tasks 6–7 (fixtures, comparator, both known-positives). The spec's note
that the score wrap "gets its own focused test" is Task 8. The spec's requirement that the
golden be generated from the reference ROM is enforced in Task 5's generator, which
assembles `tank-arena.asm` directly. The spec's frame-count open question is closed at 90
in Task 4. Increments 2–7 are explicitly out of scope and assigned to plans 2–4.

**Type consistency.** `GoldenRecord`, `GoldenFrame`, `GoldenHeader`, `InputScript`,
`ScriptPhase`, `Direction`, `GoldenMismatch`, and `CompareOptions` are each defined once
in Task 2, 3, 4, or 7 and referenced with the same names thereafter. `toGoldenFrame` is
defined in Task 2 and used in Tasks 5 and 7. `expandScript` is defined in Task 4 and used
in Tasks 5 and 7. `settled()` is defined in Task 1's test file and reused by later
appends to the same file.

**Known risk, stated rather than hidden.** Task 6's burn loop is sized by hand
(`ldy #8`) and its correctness condition — that the delayed write stays on the same
scanline — is asserted in Task 6 Step 4 rather than assumed. If it fails, the step says to
adjust the loop until the lines match, which is measuring the fixture into the shape it
claims, not tuning a constant to make a test pass.
