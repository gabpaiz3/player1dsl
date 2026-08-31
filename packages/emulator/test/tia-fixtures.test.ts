import { assembleSource } from '@player1dsl/assembler';
import { describe, expect, it } from 'vitest';
import { Machine } from '../src/index.ts';
import { fixtureSource, romFor } from './support/roms.ts';

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
    // P0 authored at 44 with a fine adjustment of -8 (right 8): the first
    // HMOVE lands it where an authored 44 belongs, and the second call's HMOVE
    // takes it eight further. P1 is positioned last and gets exactly one.
    //
    // Both carry the +3 that collide-playfield.asm measured, which is why these
    // are 55 and 58 rather than 52 and 55. A uniform offset cannot change this
    // fixture's verdict -- that is exactly why it needed the playfield sweep
    // beside it.
    expect(positions('double-hmove')).toEqual([55, 58]);
  });

  /**
   * THE control, and the reason the result above means anything. Identical but
   * for an HMCLR between the two positioning calls. Without it, a red screen
   * from the fixture could equally mean the fixture is always red.
   */
  it('leaves them apart when HMCLR clears the first adjustment', () => {
    expect(verdict('double-hmove-cleared')).toBe(BLACK);
  });

  it('displaces P0 only once when HMCLR is strobed', () => {
    expect(positions('double-hmove-cleared')).toEqual([47, 58]);
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

/**
 * Where a RESP0 strobe actually puts P0, measured ABSOLUTELY.
 *
 * A single lit player column is swept across a playfield block at pixels 0-3.
 * The playfield's position is fixed by the beam and no strobe places it, which
 * is what makes this different from double-hmove.asm above: that one measures a
 * SEPARATION between two objects the same routine placed, so a strobe delay
 * that was uniformly wrong would move both and the flip would land in the same
 * place anyway.
 *
 * MEASURED IN STELLA, 2026-08-30, and it contradicted the model:
 *
 *   authored x = 0   RED    (P0 is inside the block)
 *   authored x = 1   black
 *   authored x = 2   black
 *   authored x = 3   black
 *
 * A strobe delay of 5 puts the flip at 4. Stella put it at 1, so an authored x
 * renders three pixels to the right of x, and `Objects.PLAYER_STROBE_DELAY` is
 * 8. `packages/runtime/src/bounds.ts` carries the same three pixels, and used
 * to assume they were zero.
 */
describe('collide-playfield: where a RESP0 strobe puts P0', () => {
  /** Assemble the fixture with a given authored x and report the latch. */
  function latchedAt(x: number): boolean {
    const source = fixtureSource('collide-playfield').replace(
      'P0_X        = 0',
      `P0_X        = ${x}`,
    );
    const { rom } = assembleSource(source, 'tests/fixtures/tia/collide-playfield.asm', {
      includeDirs: ['kernels/include'],
    });
    const machine = new Machine(rom);
    machine.runFrame();
    machine.runFrame();
    const frame = machine.runFrame({ trace: true });
    return (frame.writes ?? []).filter((w) => w.register === COLUBK).at(-1)?.value === RED;
  }

  it('flips at an authored x of 1, which is where Stella flips', () => {
    const flip = [0, 1, 2, 3, 4, 5, 6, 7].find((x) => !latchedAt(x));
    expect(flip).toBe(1);
  });

  /**
   * The guard that makes the number above mean anything. A sweep whose every
   * value gives the same answer has measured nothing, and a fixture that never
   * latched at all would report a flip of 0 and pass.
   */
  it('is not degenerate: the sweep both sets and clears the latch', () => {
    expect([latchedAt(0), latchedAt(6)]).toEqual([true, false]);
  });
});
