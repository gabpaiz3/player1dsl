import { describe, expect, it } from 'vitest';
import { Machine } from '../src/index.ts';
import { romFor } from './support/roms.ts';

/**
 * Diagnostic fixtures that isolate one timing mechanism each.
 *
 * Debugging against the full tank-arena kernel could not distinguish a WSYNC
 * error from a timer error, because it exercises both at once. These ROMs
 * separate them. Sources live in tests/fixtures/timing/.
 */
function frameOf(name: string) {
  const machine = new Machine(romFor(name));
  machine.runFrame();
  machine.runFrame(); // settle: region state carries across frames
  return machine.runFrame();
}

/**
 * VALIDATED against Stella 7.0c on 2026-08-17: Stella reports 262 scanlines for
 * this ROM, matching this emulator exactly. Two independent implementations
 * agreeing on a ROM built purely from counted WSYNCs establishes that WSYNC is
 * 1:1 with scanlines, and that this emulator's model of it is correct.
 *
 * Consequence for the reference kernel: tank-arena's visible region emits 193
 * WSYNCs, so it really is 193 scanlines -- the 192 in its comments is wrong.
 */
describe('WSYNC semantics (tests/fixtures/timing/wsync-only.asm)', () => {
  // No timer anywhere in this ROM. The frame is 3 + 37 + 192 + 30 = 262
  // counted WSYNCs, so the scanline total is a pure function of that count.
  it('produces exactly one scanline per WSYNC', () => {
    expect(frameOf('wsync-only').scanlines).toBe(262);
  });

  it('places every region boundary where the WSYNC counts say', () => {
    const frame = frameOf('wsync-only');
    expect(frame.vsyncLines).toBe(3);
    expect(frame.vblankLines).toBe(37);
    expect(frame.visibleLines).toBe(192);
    expect(frame.overscanLines).toBe(30);
  });
});

describe('6532 timer write semantics (tests/fixtures/timing/timer-only.asm)', () => {
  /**
   * The timed region has no WSYNCs, so this measures cycles-from-write-to-zero
   * and nothing else. Frame length is 225 + T, so T = total - 225.
   *
   * PENDING a Stella reading. This emulator currently gives T = 38 for
   * TIM64T #44. If Stella disagrees, the timer model is what is wrong -- and
   * since wsync-only passes, it is the ONLY thing that can be wrong.
   *
   * The expected value is deliberately not asserted yet rather than being
   * pinned to this emulator's own output, which would make the test tautological.
   */
  it('reaches zero in a measurable, stable number of scanlines', () => {
    const first = frameOf('timer-only');
    const second = frameOf('timer-only');
    expect(first.scanlines).toBe(second.scanlines);
    const t = first.scanlines - 225;
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThan(45);
  });
});
