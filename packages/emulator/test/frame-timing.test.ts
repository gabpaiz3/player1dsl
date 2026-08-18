import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/index.ts';

/**
 * Acceptance test for step 2's emulator.
 *
 * The assertion is not invented: Stella independently measured this ROM at 262
 * scanlines, stable, via its Alt+L frame-stats overlay. Two independent
 * implementations agreeing on the frame structure is what makes the emulator
 * trustworthy as a measuring instrument.
 *
 * See examples/tank-arena/reference/NOTES.md for the measurement history --
 * including the derivation that said 262 while the machine said 261.
 */
const ROM_PATH = fileURLToPath(new URL('../../../build/tank-arena.bin', import.meta.url));

function loadRom(): Uint8Array {
  return new Uint8Array(readFileSync(ROM_PATH));
}

/**
 * Two frames are discarded, not one. Frame 0 is cut short by reset code, so
 * frame 1 begins with VBLANK never having been set -- its blanked lines
 * misclassify as visible. Frame 2 onward is steady state.
 */
function settledFrame() {
  const machine = new Machine(loadRom());
  machine.runFrame();
  machine.runFrame();
  return machine.runFrame();
}

/**
 * VALIDATED against Stella 7.0c on 2026-08-17: 262 scanlines, matching this
 * emulator exactly, as do both diagnostic fixtures in timing-fixtures.test.ts.
 *
 * The region split below was NOT always what the kernel produced. Measurement
 * showed 193 visible and 29 overscan against comments claiming 192 and 30 --
 * the visible region borrowed a scanline from overscan, and the two errors
 * cancelled in the total, which is why neither Stella nor the screen revealed
 * them. The kernel was then corrected (FIELD_LINES 159 -> 158, overscan timer
 * #35 -> #36) so it produces the split SPEC.md 3 specifies.
 */
describe('tank-arena reference ROM frame timing', () => {
  it('is exactly 4096 bytes (4 KiB unbanked)', () => {
    expect(loadRom().length).toBe(4096);
  });

  it('produces 262 scanlines per frame', () => {
    expect(settledFrame().scanlines).toBe(262);
  });

  it('produces a stable scanline count across frames', () => {
    const machine = new Machine(loadRom());
    machine.runFrame();
    machine.runFrame();
    const counts = new Set<number>();
    for (let i = 0; i < 10; i += 1) {
      counts.add(machine.runFrame().scanlines);
    }
    // A fluctuating count is the failure mode the Stella check was watching for.
    expect([...counts]).toEqual([262]);
  });

  it('splits the frame into the NTSC regions SPEC.md 3 specifies', () => {
    const frame = settledFrame();
    expect(frame.vsyncLines).toBe(3);
    expect(frame.vblankLines).toBe(37);
    expect(frame.visibleLines).toBe(192);
    expect(frame.overscanLines).toBe(30);
  });
});
