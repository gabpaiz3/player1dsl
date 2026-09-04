import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildStatic, check } from '@player1dsl/compiler';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import type { GoldenFrame, GoldenRecord } from '../src/index.ts';
import { compareGolden, Machine, parseGolden, toGoldenFrame } from '../src/index.ts';

/**
 * The first thing in this plan that can falsify the ledger.
 *
 * Everything before this increment is the compiler asserting what the compiler
 * computes: `expect(ledger.fieldLines).toBe(158)` is true by construction. Here
 * the 158 becomes 158 scanlines in a real 4096-byte image, run through the
 * emulator and compared against the hand-written reference kernel's own trace.
 * If the ledger is wrong, these tests are what says so.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE = `${root}examples/tank-arena/tank-arena.p1`;
const SWCHA_IDLE = 0xff;
const SWCHB_IDLE = 0x3f;

function build(text = readFileSync(SOURCE, 'utf8')) {
  return buildStatic(check(parse(text, SOURCE)));
}

/** Frames 0 and 1 carry reset code and an unset VBLANK; steady state is frame 2. */
function frameOf(rom: Uint8Array) {
  const machine = new Machine(rom);
  machine.runFrame();
  machine.runFrame();
  return machine.runFrame({ trace: true });
}

function tracedFrame(rom: Uint8Array): GoldenFrame {
  return toGoldenFrame(0, SWCHA_IDLE, SWCHB_IDLE, frameOf(rom));
}

function goldenFrame0(): GoldenFrame {
  const frames = parseGolden(readFileSync(`${root}tests/goldens/tank-arena.trace`, 'utf8'));
  const frame = frames[0];
  if (!frame) throw new Error('the golden has no frame 0; these tests prove nothing');
  return frame;
}

const CXCLR = 0x2c;
const FIRST_VISIBLE_LINE = 40;

/**
 * The comparison window, and everything it deliberately leaves out.
 *
 * TWO exclusions, both stated here and in docs/session-logs. A filter that
 * quietly grows is how a golden stops meaning anything.
 *
 * 1. CXCLR. It belongs to collision handling, which is plan 4. Filtered from
 *    BOTH sides so neither can hide behind it.
 *
 * 2. Everything before the first visible line. The reference reads both
 *    joysticks and rebuilds two font pointers in vertical blank; a static build
 *    has no rules and no changing scores, so it reaches the positioning routine
 *    one scanline earlier. Vertical blank line PLACEMENT carries no ledger
 *    claim -- positioning there is free precisely because nothing is drawn --
 *    and padding it to realign would be tuning a constant to make a number come
 *    out. What those writes DO still has to match, and the test below asserts
 *    it: same registers, same values, same beam clocks.
 *
 * Nothing else is excluded. The plan's floor is inside the window and compared
 * exactly: the band-boundary RESP0/RESP1/HMOVE that place the 5-line
 * transition, the wall PF0/PF1/PF2 that place the two 8-line runs, and the HUD
 * GRP0/GRP1 that place the 12-line glyph band.
 */
function visibleRegion(frame: GoldenFrame): GoldenFrame {
  return {
    ...frame,
    records: frame.records.filter(
      (record) => record.line >= FIRST_VISIBLE_LINE && record.register !== CXCLR,
    ),
  };
}

function verticalBlank(frame: GoldenFrame): GoldenRecord[] {
  return frame.records.filter((record) => record.line < FIRST_VISIBLE_LINE);
}

describe('the static build as an image', () => {
  it('writes exactly 4096 bytes', () => {
    expect(build().rom.byteLength).toBe(4096);
  });

  it('runs 262 scanlines split 3/37/192/30', () => {
    const frame = frameOf(build().rom);
    expect([
      frame.scanlines,
      frame.vsyncLines,
      frame.vblankLines,
      frame.visibleLines,
      frame.overscanLines,
    ]).toEqual([262, 3, 37, 192, 30]);
  });

  it('balances a ledger whose visible rows sum to 192', () => {
    const { ledger } = build();
    expect(ledger.total).toBe(192);
    expect(ledger.rows.map((row) => row.lines).reduce((a, b) => a + b, 0)).toBe(192);
  });
});

describe('the static build against the reference kernel', () => {
  // THE assertion this increment exists for. Every record from the first
  // visible line to the end of the frame, in order, from a ROM the compiler
  // emitted against a ROM a human wrote.
  it('reproduces the visible region of golden frame 0', () => {
    const mismatches = compareGolden(
      [visibleRegion(goldenFrame0())],
      [visibleRegion(tracedFrame(build().rom))],
    );
    expect(mismatches.map((m) => `[${m.kind}] ${m.detail}`)).toEqual([]);
  });

  /**
   * The half the window above leaves out, compared on everything except which
   * line it happened on. The beam clock matters here and is asserted: RESP0
   * carries no value, so where it strobed IS what it means, and reusing the
   * reference's positioning routine has to reproduce pixels 61 and 91 exactly.
   *
   * HMCLR is the one exception, and it is compared on register and value only.
   * It is a strobe that zeroes the horizontal-motion registers wherever the
   * beam happens to be, so unlike RESPx its position carries no meaning -- and
   * `PosObjectX` puts it BEFORE the WSYNC that anchors the rest of the routine,
   * precisely so it costs no beam time. The first call therefore inherits the
   * caller's phase, and the static build reaches positioning one scanline
   * earlier than the reference does. Comparing that pixel compares the
   * artifact, which is the argument correction 1 makes about vertical-blank
   * LINE numbers, one field over.
   *
   * Every subsequent HMCLR is at px-1 in both, because by then the previous
   * call's WSYNC has anchored them.
   */
  it('positions both players in vertical blank with the same values and clocks', () => {
    const HMCLR = 0x2b;
    const shape = (records: readonly GoldenRecord[]) =>
      records.map((r) =>
        r.register === HMCLR
          ? `${r.register.toString(16)}=${r.value.toString(16)}@anywhere`
          : `${r.register.toString(16)}=${r.value.toString(16)}@px${r.pixel}`,
      );

    expect(shape(verticalBlank(tracedFrame(build().rom)))).toEqual(
      shape(verticalBlank(goldenFrame0())),
    );
  });

  // Known-positive: without it, every assertion above is also satisfied by a
  // comparison that cannot tell two different scenes apart. Moving one tank one
  // scanline has to show up, because a wrong ledger would move things the same
  // way.
  it('reports a difference when the scene moves a tank one scanline', () => {
    const moved = readFileSync(SOURCE, 'utf8').replace('at (40, 120)', 'at (40, 121)');
    expect(moved).not.toBe(readFileSync(SOURCE, 'utf8'));

    const mismatches = compareGolden(
      [visibleRegion(goldenFrame0())],
      [visibleRegion(tracedFrame(build(moved).rom))],
    );
    expect(mismatches.map((m) => m.kind)).toContain('record');
  });

  // The other known-positive, on the other half. A vertical-blank comparison
  // that ignored the beam clock would pass a ROM drawing the score digits in
  // the wrong columns, which is exactly the gap resp-shift.asm was written for.
  it('reports a difference when a score digit moves along its line', () => {
    const moved = readFileSync(SOURCE, 'utf8').replace('at (60, 2)', 'at (68, 2)');
    const shape = (records: readonly GoldenRecord[]) =>
      records.map((r) => `${r.register.toString(16)}=${r.value.toString(16)}@px${r.pixel}`);

    expect(shape(verticalBlank(tracedFrame(build(moved).rom)))).not.toEqual(
      shape(verticalBlank(goldenFrame0())),
    );
  });
});
