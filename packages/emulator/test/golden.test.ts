import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InputScript, TiaWrite } from '../src/index.ts';
import {
  compareGolden,
  expandScript,
  findLateWrites,
  Machine,
  parseGolden,
  SWCHA_IDLE,
  serialiseGolden,
  toGoldenFrame,
  toRecords,
} from '../src/index.ts';
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

  it('collapses interleaved registers, which alternate on every field-loop line', () => {
    // MEASURED, not assumed: the first generated golden collapsed NOTHING --
    // 33390 records, 489 KB, zero runs. GRP0 and GRP1 alternate on every line
    // of the field loop, so a run detector that only merges writes adjacent in
    // the stream never sees two consecutive writes of the same register.
    // Collapsing is therefore per-SCANLINE-signature, not per-register.
    const writes = [];
    for (let line = 10; line < 15; line += 1) {
      writes.push(w(line, 0x1b, 0x00), w(line, 0x1c, 0x00));
    }
    expect(toRecords(writes)).toEqual([
      { line: 10, endLine: 14, register: 0x1b, value: 0x00, pixel: -1 },
      { line: 10, endLine: 14, register: 0x1c, value: 0x00, pixel: -1 },
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
          records: toRecords([
            w(40, 0x0d, 0x00),
            w(66, 0x1b, 0x00),
            w(67, 0x1b, 0x00),
            w(65, 0x1c, 0x00, 10),
          ]),
        },
      ],
      {
        rom: 'tank-arena',
        input: 'tests/goldens/tank-arena.input.json',
        frames: 1,
        settleFrames: 2,
      },
    );
    expect(text).toContain('frame 0 swcha=$ff swchb=$3f lines=262 regions=3/37/192/30');
    expect(text).toContain('40 PF0 $00');
    expect(text).toContain('66..67 GRP0 $00');
    expect(text).toContain('65 GRP1 $00 px10');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('golden parsing', () => {
  it('round-trips serialised frames', () => {
    const frames = [
      {
        index: 0,
        swcha: 0xff,
        swchb: 0x3f,
        scanlines: 262,
        regions: [3, 37, 192, 30] as [number, number, number, number],
        records: toRecords([
          w(40, 0x0d, 0x00),
          w(66, 0x1b, 0x00),
          w(67, 0x1b, 0x00),
          w(65, 0x1c, 0x00, 10),
        ]),
      },
      {
        index: 1,
        swcha: 0x7f,
        swchb: 0x3f,
        scanlines: 262,
        regions: [3, 37, 192, 30] as [number, number, number, number],
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
    expect(() =>
      parseGolden('frame 0 swcha=$ff swchb=$3f lines=262 regions=3/37/192/30\n  nonsense\n'),
    ).toThrow(/line 2/);
  });

  it('rejects an unrecognised frame header', () => {
    expect(() => parseGolden('frame nonsense\n')).toThrow(/line 1/);
  });
});

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
    expect(byte).toBe(SWCHA_IDLE & ~0x80 & ~0x04);
  });

  it('leaves an omitted phase fully idle', () => {
    const [byte] = expandScript({
      rom: 'tank-arena',
      settleFrames: 2,
      phases: [{ frames: 1, note: 'idle' }],
    });
    expect(byte).toBe(SWCHA_IDLE);
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

function goldenFor(name: string, frames: number) {
  const machine = settled(romFor(name));
  const out = [];
  for (let i = 0; i < frames; i += 1) {
    out.push(
      toGoldenFrame(i, SWCHA_IDLE, 0x3f, machine.runFrame({ swcha: SWCHA_IDLE, trace: true })),
    );
  }
  return out;
}

describe('golden comparison', () => {
  it('reports no mismatch when a ROM is compared against its own trace', () => {
    expect(compareGolden(goldenFor('golden-base', 2), goldenFor('golden-base', 2))).toEqual([]);
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
    const mismatches = compareGolden(goldenFor('golden-base', 2), goldenFor('golden-late', 2));
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches.some((m) => m.kind === 'deadline')).toBe(true);
    expect(mismatches.find((m) => m.kind === 'deadline')?.detail).toContain('PF0');
  });

  /**
   * The airtight form of known-positive 2. golden-late compared against
   * golden-BASE trips the record half too, because moving a write from blank
   * into the visible region also changes whether it collapses into a run --
   * so that test alone does not prove the deadline half in isolation.
   *
   * Compared against ITS OWN trace, the record half matches perfectly by
   * construction. Any mismatch left can only have come from the deadline
   * check, so this is the one assertion that fails if that check is deleted.
   */
  it('flags a late write even when the trace matches itself exactly', () => {
    const mismatches = compareGolden(goldenFor('golden-late', 2), goldenFor('golden-late', 2));
    expect(mismatches.every((m) => m.kind === 'deadline')).toBe(true);
    expect(mismatches.length).toBeGreaterThan(100);
    expect(mismatches[0]?.detail).toContain('PF0');
  });

  /**
   * Known-positive 3: the player MOVED and nothing the other two halves look at
   * changed. resp-shift writes $00 to RESP0 on line 40 exactly as resp-base
   * does, on the same line, at the same position in the stream, and RESP0 has
   * no deadline to miss -- so both the equality half and the deadline half are
   * silent by construction. Only a beam-position rule can see this.
   *
   * Until that rule exists this test fails, which is the point: it is review
   * 0.2 section 1.1's complaint expressed as two ROMs.
   */
  it('catches a player moved without any written value changing', () => {
    const mismatches = compareGolden(goldenFor('resp-base', 2), goldenFor('resp-shift', 2));
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]?.kind).toBe('clock');
    expect(mismatches[0]?.detail).toContain('RESP0');
  });

  /**
   * ...and the pair really is identical everywhere else. Without this, the test
   * above could be passing because the ROMs differ in some way nobody checked,
   * and the new rule would be credited for a mismatch it did not find.
   */
  it('finds nothing else to complain about in the moved-player pair', () => {
    const mismatches = compareGolden(goldenFor('resp-base', 2), goldenFor('resp-shift', 2));
    expect(mismatches.every((m) => m.kind === 'clock')).toBe(true);
    expect(compareGolden(goldenFor('resp-base', 2), goldenFor('resp-base', 2))).toEqual([]);
  });

  /**
   * The `blank` half of the timing rules, which no ROM in this repo exercises:
   * all 360 HMOVE writes in the tank-arena golden are already inside horizontal
   * blank. That proves the rule causes no regression, NOT that it can fire --
   * the same gap golden-late.asm exists to close for deadlines.
   *
   * golden.ts is pure, so this needs no ROM. HMOVE strobed in the visible
   * region extends that line by 8 pixels and produces hardware behaviour this
   * emulator does not model, so a comparison that ignored it would be reporting
   * on a frame it cannot actually predict.
   */
  it('catches a blank-only strobe that left horizontal blank', () => {
    const record = { line: 5, endLine: 5, register: 0x2a, value: 0x00 };
    const frame = (pixel: number) => [
      {
        index: 0,
        swcha: SWCHA_IDLE,
        swchb: 0x3f,
        scanlines: 262,
        regions: [3, 37, 192, 30] as const,
        records: [{ ...record, pixel }],
      },
    ];

    const mismatches = compareGolden(frame(-1), frame(12));
    expect(mismatches.map((m) => m.kind)).toEqual(['blank']);
    expect(mismatches[0]?.detail).toContain('HMOVE');

    // ...and the same pair, both in blank, is silent. Without this the test
    // above would pass on a rule that flagged every HMOVE unconditionally.
    expect(compareGolden(frame(-1), frame(-1))).toEqual([]);
  });

  it('surrounds a record divergence with context from both sides', () => {
    // Record comparison is positional, so one missing write shifts every later
    // record. The detail string is the whole diagnostic a codegen divergence
    // gets from a 6990-record golden -- "differs at 412" is not workable.
    const expected = goldenFor('golden-base', 1);
    const first = expected[0];
    if (!first) throw new Error('no frame');
    const dropped = [{ ...first, records: first.records.filter((_, i) => i !== 4) }];

    const detail = compareGolden(expected, dropped).find((m) => m.kind === 'record')?.detail ?? '';
    expect(detail).toContain('>> [4]'); // the divergence itself, marked
    expect(detail).toContain('[2]'); // context before
    expect(detail).toContain('[5]'); // context after
    // The shift is what the context makes visible: everything after the drop is
    // one record behind, and the last expected record has no counterpart.
    expect(detail).toContain('got (none)');
    expect(detail.split(String.fromCharCode(10)).length).toBeGreaterThan(4);
  });

  it('reports a structural mismatch when the frame count differs', () => {
    expect(compareGolden(goldenFor('golden-base', 2), goldenFor('golden-base', 1))[0]?.kind).toBe(
      'structure',
    );
  });

  it('matches the committed golden against the reference ROM', () => {
    const root = new URL('../../../', import.meta.url);
    const text = readFileSync(
      fileURLToPath(new URL('tests/goldens/tank-arena.trace', root)),
      'utf8',
    );
    const script = JSON.parse(
      readFileSync(fileURLToPath(new URL('tests/goldens/tank-arena.input.json', root)), 'utf8'),
    ) as InputScript;

    const machine = new Machine(romFor('tank-arena'));
    for (let i = 0; i < script.settleFrames; i += 1) machine.runFrame();
    const actual = expandScript(script).map((swcha, index) =>
      toGoldenFrame(index, swcha, 0x3f, machine.runFrame({ swcha, trace: true })),
    );

    expect(compareGolden(parseGolden(text), actual)).toEqual([]);
  });
});

/**
 * Correction 1 of plan 4, implemented: a scanline number is an equivalence
 * property only where the code is straight-line.
 */
describe('region-aware comparison', () => {
  /**
   * A frame with one write in each region: a RESP0 strobe in vertical blank,
   * whose pixel IS its meaning, and a GRP0 in the visible region, whose line
   * is. Hand-built rather than read from the committed golden, so the test
   * says exactly what it is varying.
   */
  const goldenFrame0 = (): GoldenFrame => ({
    index: 0,
    swcha: 0xff,
    swchb: 0x3f,
    scanlines: 262,
    regions: [3, 37, 192, 30],
    records: [
      { line: 5, endLine: 5, register: 0x20, value: 0x60, pixel: 40 },
      { line: 5, endLine: 5, register: 0x10, value: 0x60, pixel: 52 },
      { line: 66, endLine: 66, register: 0x1b, value: 0x3c, pixel: -1 },
      { line: 67, endLine: 67, register: 0x1b, value: 0x66, pixel: -1 },
    ],
  });

  const shiftBlank = (frame: GoldenFrame, by: number): GoldenFrame => ({
    ...frame,
    records: frame.records.map((r) =>
      r.line < 40 ? { ...r, line: r.line + by, endLine: r.endLine + by } : r,
    ),
  });

  it('accepts a vertical-blank write that moved to another line', () => {
    const golden = goldenFrame0();
    expect(compareGolden([golden], [shiftBlank(golden, 1)])).toEqual([]);
  });

  /**
   * A strobe's pixel is load-bearing -- it carries RESPx's whole meaning -- and
   * relaxing the LINE must not relax it. Caught by positionMismatch rather than
   * by the key, which is why it is reported as a `clock` mismatch: a better
   * diagnostic than "record differs".
   */
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

  it('still rejects a vertical-blank write whose value changed', () => {
    const golden = goldenFrame0();
    const moved: GoldenFrame = {
      ...golden,
      records: golden.records.map((r) =>
        r.line < 40 && r.register === 0x20 ? { ...r, value: r.value ^ 0x10 } : r,
      ),
    };
    expect(compareGolden([golden], [moved])).not.toEqual([]);
  });

  // The visible region keeps EXACT lines, because it is counted WSYNCs with no
  // data-dependent branch. Relaxing it there would stop the ledger meaning
  // anything.
  it('still rejects a visible write that moved one scanline', () => {
    const golden = goldenFrame0();
    const moved: GoldenFrame = {
      ...golden,
      records: golden.records.map((r) =>
        r.line >= 66 && r.register === 0x1b
          ? { ...r, line: r.line + 1, endLine: r.endLine + 1 }
          : r,
      ),
    };
    expect(compareGolden([golden], [moved])).not.toEqual([]);
  });
});
