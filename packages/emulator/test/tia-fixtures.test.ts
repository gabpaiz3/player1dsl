import { describe, expect, it } from 'vitest';
import { Machine } from '../src/index.ts';
import { romFor } from './support/roms.ts';

const COLUBK = 0x09;
const RED = 0x44;
const BLACK = 0x00;

/**
 * The background colour a fixture painted, which is how it reports its answer.
 *
 * A whole-screen colour rather than a sprite position, deliberately: this pair
 * is checked against Stella by eye, and measuring a sprite's left edge off a
 * screenshot is a measurement whose error bars come from window management.
 */
function verdict(name: string): number {
  const machine = new Machine(romFor(name));
  machine.runFrame();
  machine.runFrame();
  const frame = machine.runFrame({ trace: true });
  const background = (frame.writes ?? []).filter((w) => w.register === COLUBK).at(-1);
  return background?.value ?? -1;
}

/** Where the fixture's two players came to rest, in visible pixels. */
function positions(name: string): [number, number] {
  const machine = new Machine(romFor(name));
  machine.runFrame();
  machine.runFrame();
  return [machine.tia.objects.p0, machine.tia.objects.p1];
}

/**
 * ONE HMOVE strobe moves EVERY object whose HMxx is set, not just the object
 * that was positioned last.
 *
 * `PosObjectX` ends `sta WSYNC / sta HMOVE / rts` and the reference kernel calls
 * it once per object with no HMCLR between, so the second call's HMOVE
 * re-applies the first object's fine adjustment. P0 is displaced twice.
 *
 * CONFIRMED IN STELLA, 2026-08-30, which is what makes it a finding rather than
 * a property of our own model:
 *
 *   double-hmove.bin          red screen, ONE merged white bar
 *   double-hmove-cleared.bin  black screen, TWO separated white bars
 *
 * See docs/kernel-measurements.md, "One HMOVE moves every object".
 */
describe('HMOVE applies every horizontal-motion register, not just the last', () => {
  it('overlaps two players that their authored positions would keep apart', () => {
    expect(verdict('double-hmove')).toBe(RED);
  });

  it('displaces P0 by its own fine adjustment a second time', () => {
    // P0 authored at 44 with a fine adjustment of -8 (right 8): the coarse
    // strobe lands it at 36, the first HMOVE takes it to 44, and the second
    // call's HMOVE takes it to 52. P1 is positioned last and gets exactly one.
    expect(positions('double-hmove')).toEqual([52, 55]);
  });

  /**
   * THE control, and the reason the result above means anything. Identical but
   * for an HMCLR between the two positioning calls. Without it, a red screen
   * from the fixture could equally mean the fixture is always red.
   */
  it('leaves them apart when HMCLR clears the first adjustment', () => {
    expect(verdict('double-hmove-cleared')).toBe(BLACK);
  });

  it('puts P0 exactly where it was authored once HMCLR is strobed', () => {
    expect(positions('double-hmove-cleared')).toEqual([44, 55]);
  });

  // Both fixtures are whole NTSC frames, so a structural mistake in either
  // would show here rather than as a mysterious colour.
  it('runs both fixtures as 262-line NTSC frames', () => {
    for (const name of ['double-hmove', 'double-hmove-cleared']) {
      const machine = new Machine(romFor(name));
      machine.runFrame();
      expect(machine.runFrame().scanlines).toBe(262);
    }
  });

  /**
   * The colour and the positions, tied together by the stated rule rather than
   * agreeing by coincidence. Both fixtures draw 8-pixel-wide solid players, so
   * they overlap exactly when their positions differ by less than 8.
   *
   * Reading CXPPMM after the frame would not do: both ROMs strobe CXCLR in
   * overscan, which is the correct thing for a game to do and leaves the latch
   * clear by the time `runFrame` returns.
   */
  it('paints red exactly when the two positions are less than a player apart', () => {
    for (const name of ['double-hmove', 'double-hmove-cleared']) {
      const [p0, p1] = positions(name);
      expect([name, verdict(name) === RED]).toEqual([name, Math.abs(p1 - p0) < 8]);
    }
  });
});
