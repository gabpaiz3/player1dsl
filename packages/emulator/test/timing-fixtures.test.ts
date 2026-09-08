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
   * VALIDATED against Stella 7.0c: **T = 37** for TIM64T #44. Read first on
   * 2026-08-17, when it corrected the timer model in `riot.ts` from 38 to 37
   * (commit be3fd27), and re-read on 2026-09-07 against three separate Stella
   * launches, all reporting 262 scanlines.
   *
   * 37 is STELLA'S number, not ours, which is the whole point of asserting it.
   * This block used to refuse to pin a value on the grounds that doing so would
   * be tautological -- true while the reading was outstanding, and inverted the
   * moment it arrived. A range assertion cannot tell 37 from 38, so it went on
   * passing after the model was corrected and its comment went on saying the
   * measurement was pending. See docs/session-logs/2026-09-07.md.
   *
   * If a change makes this fail, the timer model is what is wrong -- since
   * wsync-only passes, it is the ONLY thing that can be wrong.
   */
  it('reaches zero after exactly the 37 scanlines Stella measures', () => {
    const first = frameOf('timer-only');
    const second = frameOf('timer-only');
    expect(first.scanlines).toBe(second.scanlines);
    expect(first.scanlines - 225).toBe(37);
  });
});
