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

    // Bound to a const first: `flush` closes over `open`, which makes TypeScript
    // discard the null-narrowing on the `let` inside this block.
    const run = open;
    if (
      run &&
      run.register === write.register &&
      run.value === write.value &&
      write.line === run.endLine + 1
    ) {
      run.endLine = write.line;
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
