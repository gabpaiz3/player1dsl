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
 * KNOWN GAP (step 2, in progress).
 *
 * The emulator currently reports 264 scanlines: 3 vsync + 38 vblank +
 * 193 visible + 30 overscan. vsync, visible and overscan match the ROM's WSYNC
 * counts exactly; VBLANK is two scanlines long.
 *
 * The gap is isolated to 6532 timer write semantics -- how many cycles elapse
 * between writing TIM64T and INTIM reading zero. Overscan is bounded by the
 * same mechanism and lands correctly, so the model is not globally wrong.
 *
 * These assertions deliberately encode the TRUTH (Stella's independently
 * measured 262), not the current behaviour. Adjusting the timer constant until
 * 262 appeared would make the emulator agree with Stella on this ROM while
 * being wrong in general -- destroying the only reason to build it.
 */
describe('tank-arena reference ROM frame timing', () => {
  it('is exactly 4096 bytes (4 KiB unbanked)', () => {
    expect(loadRom().length).toBe(4096);
  });

  it('produces 262 scanlines per frame', () => {
    const machine = new Machine(loadRom());
    machine.runFrame(); // discard the first frame: reset code runs during it
    const frame = machine.runFrame();
    expect(frame.scanlines).toBe(262);
  });

  it('produces a stable scanline count across frames', () => {
    const machine = new Machine(loadRom());
    machine.runFrame();
    const counts = new Set<number>();
    for (let i = 0; i < 10; i += 1) {
      counts.add(machine.runFrame().scanlines);
    }
    // A fluctuating count is the failure mode the Stella check was watching for.
    expect([...counts]).toEqual([262]);
  });

  it('splits the frame into the NTSC regions the kernel intends', () => {
    const machine = new Machine(loadRom());
    machine.runFrame();
    const frame = machine.runFrame();
    expect(frame.vsyncLines).toBe(3);
    expect(frame.vblankLines).toBe(37);
    expect(frame.visibleLines).toBe(192);
    expect(frame.overscanLines).toBe(30);
  });
});
