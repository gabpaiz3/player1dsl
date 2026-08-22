import { describe, expect, it } from 'vitest';
import type { FrameResult } from '../src/index.ts';
import { Machine } from '../src/index.ts';
import { registerName, type TiaWrite } from '../src/trace.ts';
import { romFor } from './support/roms.ts';

/**
 * Kernel-SHAPE fixtures, as opposed to the timing fixtures beside them.
 *
 * The timing fixtures isolate one hardware mechanism each. These isolate one
 * KERNEL SHAPE each, so the template catalog's applicability and cost
 * vocabulary can be measured against something other than tank-arena before it
 * is committed. A vocabulary fitted to one kernel describes that kernel.
 *
 * Sources live in tests/fixtures/kernels/.
 */
function frameOf(name: string) {
  const machine = new Machine(romFor(name));
  machine.runFrame();
  machine.runFrame(); // settle: region state carries across frames
  return machine.runFrame({ trace: true });
}

/** Every write to one register, in frame order. */
function writesTo(frame: FrameResult, register: string): readonly TiaWrite[] {
  return (frame.writes ?? []).filter((w) => registerName(w.register) === register);
}

/** The scanline a register was first written on at or after `from`. */
function firstLineWriting(frame: FrameResult, register: string, from: number): number {
  const write = writesTo(frame, register).find((w) => w.line >= from);
  if (!write) throw new Error(`no ${register} write at or after line ${from}`);
  return write.line;
}

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

/**
 * The entry-cost measurement this fixture exists for.
 *
 * MEASURED 2026-08-21 from build/scroll-field.trace, and it confirmed the
 * prediction written into the fixture header before the run:
 *
 *   top band     registers set once, before the loop   entry cost 0
 *   scroll band  registers written at the top of each  entry cost 1
 *                iteration
 *   bottom band  registers set once, before the loop   entry cost 0
 *
 * So the discriminator really is the LOOP SHAPE, not the register. The rule was
 * measured on GRP0/GRP1 in tank-arena and holds on PF1/PF2 here, which is what
 * turns one observation into a rule the catalog can carry.
 *
 * Nothing below hard-codes a line number. Each cost is a difference between two
 * lines read out of the trace, so the fixture can be renumbered without
 * rewriting the measurement -- and so a restructured loop changes the ANSWER
 * rather than breaking the arithmetic.
 */
describe('scroll-field entry costs', () => {
  const frame = frameOf('scroll-field');

  it('charges zero entry lines to a band whose playfield is set once', () => {
    // The top band's setup and its first rendered line are the same line: the
    // registers are written in that line's horizontal blank and are valid for
    // it. Same shape, and the same answer, as tank-arena's bottom wall.
    const setup = firstLineWriting(frame, 'PF0', 0);
    const firstData = firstLineWriting(frame, 'PF1', setup);
    expect(firstData - setup).toBe(0);
  });

  it('charges one entry line to a loop that writes per-line data at the top', () => {
    // COLUPF $46 is the scroll band's setup, on the line the loop's first WSYNC
    // ends. The first scroll pattern cannot render until the line after.
    const setup = writesTo(frame, 'COLUPF').find((w) => w.value === 0x46)?.line;
    expect(setup, 'the scroll band never set its colour').toBeDefined();
    // Search from `setup`, not `setup + 1`: searching past the setup line would
    // make this report 1 for a band that DID prime its data on its own first
    // line, which is exactly the case it is supposed to distinguish.
    const firstData = firstLineWriting(frame, 'PF1', setup ?? 0);
    expect(firstData - (setup ?? 0)).toBe(1);
  });

  it('charges zero again on the way out, so the cost is the shape and not the band', () => {
    // The bottom band is the top band's shape again, after 160 lines of the
    // other one. If entry cost were a property of "a region change after a loop
    // exit", as the design originally claimed, this would be 1.
    const lastPf0 = writesTo(frame, 'PF0').at(-1);
    expect(lastPf0, 'the bottom band never set PF0').toBeDefined();
    const setup = lastPf0?.line ?? 0;
    const firstData = firstLineWriting(frame, 'PF1', setup);
    expect(firstData - setup).toBe(0);
  });

  it('lands every playfield write in horizontal blank', () => {
    // The measurement above is only meaningful if no write missed its deadline:
    // a PF store that lands mid-line renders on a different line than the trace
    // implies. This is the guard that the loop-exit restructuring was needed.
    const playfield = (frame.writes ?? []).filter((w) =>
      ['PF0', 'PF1', 'PF2'].includes(registerName(w.register)),
    );
    expect(playfield.length).toBeGreaterThan(100); // the extraction found something
    expect(playfield.filter((w) => w.pixel >= 0)).toEqual([]);
  });
});

describe('ball-and-paddles (tests/fixtures/kernels/ball-and-paddles.asm)', () => {
  it('runs a 262-line frame split 3/37/192/30', () => {
    // The VBLANK count is `37 - 6`, because three PosObjectX calls spend two
    // lines each INSIDE vblank. Getting that subtraction wrong is the most
    // likely bug in the fixture, and this is what catches it.
    const frame = frameOf('ball-and-paddles');
    expect(frame.scanlines).toBe(262);
    expect(frame.vsyncLines).toBe(3);
    expect(frame.vblankLines).toBe(37);
    expect(frame.visibleLines).toBe(192);
    expect(frame.overscanLines).toBe(30);
  });
});

/**
 * The band gap: visible lines between the last line one band renders and the
 * first line the next one does.
 *
 * This is the honest way to measure a band boundary, and the obvious way is
 * wrong. Each PosObjectX call is `WSYNC / ... / RESPx / WSYNC / HMOVE`, so the
 * FIRST of its two lines carries no traced write at all. Taking min..max over
 * the RESPx and HMOVE writes therefore misses a line at the FRONT: it measures
 * 6 for a three-object boundary and 4 for a two-object one, and would read as
 * falsifying 2n + 1 when what is actually wrong is the extraction.
 */
function bandGap(lastLineAbove: number, firstLineBelow: number): number {
  return firstLineBelow - lastLineAbove - 1;
}

/**
 * The reposition rule, measured at two different values of n.
 *
 * MEASURED 2026-08-21:
 *
 *   n = 3  ball-and-paddles  top band renders 40..63, bottom band from 71  -> 7
 *   n = 2  tank-arena        HUD renders 40..51, top wall from 57          -> 5
 *
 * Predicted 2n + 1 for both. Both matched. Two points is what makes it a rule
 * rather than a coincidence fitted to one kernel, and the +1 -- the HMOVE comb,
 * which is a constant -- is the part that would have shown up wrong first if the
 * cost were really linear in n alone.
 */
describe('the reposition cost rule', () => {
  it('spends 2n + 1 visible lines repositioning n objects, at n = 3', () => {
    const frame = frameOf('ball-and-paddles');
    const colubk = writesTo(frame, 'COLUBK').filter((w) => w.line >= 40);
    expect(colubk.map((w) => w.value)).toEqual([0xc4, 0x04]); // the two band marks

    const TOP_LINES = 24; // the fixture's declared top-band height
    const [top, bottom] = colubk;
    expect(bandGap((top?.line ?? 0) + TOP_LINES - 1, bottom?.line ?? 0)).toBe(7);
  });

  it('spends 2n + 1 visible lines repositioning n objects, at n = 2', () => {
    // tank-arena's own boundary, read with the same formula and different marks:
    // the HUD's last glyph write, and the top wall's first PF0 write.
    const frame = frameOf('tank-arena');
    const lastGlyph = writesTo(frame, 'GRP0')
      .filter((w) => w.line >= 40 && w.line < 60)
      .at(-1);
    const firstWall = writesTo(frame, 'PF0').find((w) => w.line > (lastGlyph?.line ?? 0));
    expect(lastGlyph, 'no HUD glyph writes found').toBeDefined();
    expect(firstWall, 'no wall PF0 write found').toBeDefined();
    expect(bandGap(lastGlyph?.line ?? 0, firstWall?.line ?? 0)).toBe(5);
  });

  it('does not measure the boundary as the span of its own writes', () => {
    // The wrong extraction, asserted to be wrong, so nobody reintroduces it
    // believing it agrees. min..max over the positioning writes is one short at
    // both values of n, because the first line of the first call writes nothing.
    const frame = frameOf('ball-and-paddles');
    const moves = (frame.writes ?? []).filter(
      (w) =>
        w.line >= 40 && ['RESP0', 'RESP1', 'RESBL', 'HMOVE'].includes(registerName(w.register)),
    );
    const first = moves[0]?.line ?? 0;
    const last = moves.at(-1)?.line ?? 0;
    expect(last - first + 1).toBe(6);
  });
});

describe('sprite-formation (tests/fixtures/kernels/sprite-formation.asm)', () => {
  it('runs a 262-line frame split 3/37/192/30', () => {
    // VBLANK is `37 - 2` here: one PosObjectX call, two lines. Same arithmetic
    // trap as ball-and-paddles, one object instead of three.
    const frame = frameOf('sprite-formation');
    expect(frame.scanlines).toBe(262);
    expect(frame.vsyncLines).toBe(3);
    expect(frame.vblankLines).toBe(37);
    expect(frame.visibleLines).toBe(192);
    expect(frame.overscanLines).toBe(30);
  });
});

/**
 * Visible lines on which GRP0 actually renders something.
 *
 * The LAST write to a register on a line is what renders, because every write
 * in this fixture lands in horizontal blank. Each row loop's final pass writes
 * sprite row 7 into the NEXT line's blank, and the following `lda #0 / sta GRP0`
 * overwrites it in that same blank -- so that line renders nothing and must not
 * be counted. Taking the last write per line is what makes that fall out
 * instead of having to be special-cased.
 */
function renderedGrp0Lines(frame: FrameResult): number[] {
  const lastPerLine = new Map<number, number>();
  for (const write of writesTo(frame, 'GRP0')) lastPerLine.set(write.line, write.value);
  return [...lastPerLine]
    .filter(([, value]) => value !== 0)
    .map(([line]) => line)
    .sort((a, b) => a - b);
}

/** Split a sorted line list into runs of consecutive lines. */
function splitIntoRuns(lines: readonly number[]): number[][] {
  const runs: number[][] = [];
  for (const line of lines) {
    const current = runs.at(-1);
    if (current && line === (current.at(-1) ?? 0) + 1) current.push(line);
    else runs.push([line]);
  }
  return runs;
}

/**
 * MEASURED 2026-08-21 from build/sprite-formation.trace:
 *
 *   row A  NUSIZ0 $03, three close copies   occupies 48..55, renders 49..55
 *   row B  NUSIZ0 $06, three medium copies  occupies 64..71, renders 65..71
 *
 * Two findings, and the second was not the question the fixture was written to
 * ask:
 *
 * 1. NUSIZ hardware copies are FREE. Three copies cost zero additional
 *    scanlines and zero additional TIA objects -- the only RESP0 strobe in the
 *    ROM is in VBLANK, and the two rows differ in nothing but NUSIZ0.
 * 2. An 8-entry sprite table renders SEVEN lines, not eight. The loop primes one
 *    line ahead and its last write is overwritten in the same blank. That is the
 *    entry-cost-1 shape again, now on GRP0 -- so the rule has been measured on
 *    PF1/PF2 (scroll-field) and GRP0 (here) and in tank-arena's field kernel.
 *
 * NOT measured, and therefore NOT zero: mid-line RESPx multiplexing, the other
 * way to draw a formation. Its cost is unknown. See docs/kernel-measurements.md.
 */
describe('sprite-formation copies and row spans', () => {
  const frame = frameOf('sprite-formation');

  it('draws three copies without repositioning inside the visible region', () => {
    const visible = (frame.writes ?? []).filter((w) => w.line >= 40 && w.line < 232);
    expect(visible.length).toBeGreaterThan(0); // the extraction found something
    expect(visible.filter((w) => registerName(w.register) === 'RESP0')).toEqual([]);
  });

  it('renders both formation rows over the same number of lines', () => {
    // The rows differ ONLY in NUSIZ0. If copies cost lines, they differ. Stated
    // as a comparison rather than against a number, so it stays true whatever
    // the entry cost turns out to be.
    const [a, b] = splitIntoRuns(renderedGrp0Lines(frame));
    expect(a, 'no formation rows found').toBeDefined();
    expect(a?.length).toBe(b?.length);
  });

  it('renders seven lines from an eight-entry sprite table', () => {
    const runs = splitIntoRuns(renderedGrp0Lines(frame));
    expect(runs.map((run) => run.length)).toEqual([7, 7]);
  });
});
