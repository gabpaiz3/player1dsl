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
import { SWCHA_IDLE } from './riot.ts';
import { registerName, TIA_WRITE_NAMES, type TiaWrite } from './trace.ts';

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

/** One scanline's writes, in the order they happened. */
interface LineGroup {
  readonly line: number;
  readonly writes: TiaWrite[];
  /** Identity for merging: the whole line's (register, value) sequence. */
  readonly signature: string;
  /** A line containing any visible write never merges -- its pixels matter. */
  readonly allBlank: boolean;
}

/**
 * Collapse a frame's writes into canonical records.
 *
 * Collapsing is per-SCANLINE-SIGNATURE, not per-register. That distinction was
 * MEASURED, not designed: the first version merged writes adjacent in the
 * stream, and the first generated golden collapsed nothing at all -- 33390
 * records and 489 KB against a predicted ~50 KB. GRP0 and GRP1 alternate on
 * every line of the field loop, so no two consecutive writes ever share a
 * register and the run detector never fired once in 90 frames.
 *
 * Merging whole scanlines instead matches the actual structure -- the field
 * loop repeats the same pair of writes for most of 158 lines -- and preserves
 * stream order, which the comparator compares positionally.
 *
 * Only all-blank lines merge. A line containing a visible write is emitted
 * write-by-write with its pixel, because that is what the deadline check
 * consults and a run would lose it.
 */
export function toRecords(writes: readonly TiaWrite[]): GoldenRecord[] {
  const groups: LineGroup[] = [];
  for (const write of writes) {
    if (write.register === WSYNC) continue;
    const last = groups.at(-1);
    if (last && last.line === write.line) {
      last.writes.push(write);
      continue;
    }
    groups.push({ line: write.line, writes: [write], signature: '', allBlank: true });
  }

  const sealed = groups.map((group) => ({
    ...group,
    signature: group.writes.map((x) => `${x.register}=${x.value}`).join(','),
    allBlank: group.writes.every((x) => x.pixel < 0),
  }));

  const records: GoldenRecord[] = [];
  for (let i = 0; i < sealed.length; i += 1) {
    const group = sealed[i];
    if (!group) continue;

    if (!group.allBlank) {
      for (const write of group.writes) {
        records.push({
          line: write.line,
          endLine: write.line,
          register: write.register,
          value: write.value,
          pixel: write.pixel,
        });
      }
      continue;
    }

    let end = i;
    while (end + 1 < sealed.length) {
      const next = sealed[end + 1];
      const current = sealed[end];
      if (!next || !current) break;
      if (!next.allBlank || next.signature !== group.signature || next.line !== current.line + 1) {
        break;
      }
      end += 1;
    }

    const endLine = sealed[end]?.line ?? group.line;
    for (const write of group.writes) {
      records.push({
        line: group.line,
        endLine,
        register: write.register,
        value: write.value,
        pixel: -1,
      });
    }
    i = end;
  }
  return records;
}

export function formatRecord(record: GoldenRecord): string {
  const lines =
    record.line === record.endLine ? `${record.line}` : `${record.line}..${record.endLine}`;
  const where = record.pixel >= 0 ? ` px${record.pixel}` : '';
  return `${lines} ${registerName(record.register)} ${hex2(record.value)}${where}`;
}

export function serialiseGolden(frames: readonly GoldenFrame[], header: GoldenHeader): string {
  const out: string[] = [
    '# player1dsl golden trace v1',
    `# rom: ${header.rom}`,
    `# input: ${header.input}`,
    `# frames: ${header.frames} (after ${header.settleFrames} settle frames)`,
    '# regenerate: npm run golden',
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
 * would let a corrupted golden compare clean against everything -- the same
 * class of defect as a detector that never fires.
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
 * SWCHA bits, active LOW. The high nibble is the left controller and the low
 * nibble the right -- the layout the reference kernel's J0_/J1_ masks encode.
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
