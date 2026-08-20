import { describe, expect, it } from 'vitest';
import type { TiaWrite } from '../src/index.ts';
import {
  expandScript,
  Machine,
  parseGolden,
  SWCHA_IDLE,
  serialiseGolden,
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
