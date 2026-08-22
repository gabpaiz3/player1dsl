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
