import { assembleSource } from '@player1dsl/assembler';
import { describe, expect, it } from 'vitest';
import { Machine, Objects } from '../src/index.ts';
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

/**
 * Does positioning a SECOND object displace the first?
 *
 * MEASURED IN STELLA, 2026-09-12, and our model is wrong about it.
 *
 * `collide-two-objects.asm` is `collide-playfield.asm` plus one more
 * `jsr PosObjectX`, so the original is its control: same object, same block,
 * same graphics, same unit. The verdict is a whole-screen colour, which is the
 * lesson of the retraction in docs/kernel-measurements.md -- the previous
 * attempt at this question read sprite columns off a screenshot and produced a
 * number that did not survive its own method.
 *
 *   collide-playfield (one object)        x=0 RED,   x=1 black
 *   collide-two-objects (P0 first)        x=0..5 ALL BLACK
 *   collide-two-objects-reversed (P0 last) x=0 RED,  x=1 black
 *
 * The reversed ROM is the known-positive. Without it, black everywhere is
 * equally what a broken latch or a mis-set GRP0 would paint, and the result
 * would say nothing.
 *
 * So the object positioned FIRST is displaced by the call that follows it, and
 * the object positioned LAST is not. The compiler emits exactly this shape --
 * one call per object, back to back, in vertical blank -- for every scene whose
 * first band holds more than one object.
 *
 * NOT the double-HMOVE mechanism. With `P1_X = 66`, whose fine adjustment is
 * nibble 0, P0 is displaced just the same. The second call's HMOVE carries no
 * motion in that case, so what disturbs P0 is the act of the call and not the
 * value it moves by. How far, and in which direction, is unmeasured: the
 * playfield repeats every 80 pixels, so a single block locates a landing only
 * modulo 80 and a full sweep needs a second block position to disambiguate.
 */
describe('collide-two-objects: a second positioning call displaces the first object', () => {
  function latchedIn(fixture: string, x: number): boolean {
    const source = fixtureSource(fixture).replace('P0_X        = 0', `P0_X        = ${x}`);
    const { rom } = assembleSource(source, `tests/fixtures/tia/${fixture}.asm`, {
      includeDirs: ['kernels/include'],
    });
    const machine = new Machine(rom);
    machine.runFrame();
    machine.runFrame();
    const frame = machine.runFrame({ trace: true });
    return (frame.writes ?? []).filter((w) => w.register === COLUBK).at(-1)?.value === RED;
  }

  // Both fixtures are whole NTSC frames. Four positioning lines instead of two,
  // so a `.blank` count left at 35 would show here rather than as a colour.
  it('runs both fixtures as 262-line NTSC frames', () => {
    for (const name of ['collide-two-objects', 'collide-two-objects-reversed']) {
      const machine = new Machine(romFor(name));
      machine.runFrame();
      expect(machine.runFrame().scanlines).toBe(262);
    }
  });

  /**
   * The KNOWN-POSITIVE, and our model agrees with Stella here.
   *
   * P0 positioned last lands where one object alone lands, so the flip is at 1
   * and an authored x renders at x + 3.
   */
  it('leaves the LAST-positioned object where a single call would put it', () => {
    expect([0, 1, 2].map((x) => latchedIn('collide-two-objects-reversed', x))).toEqual([
      true,
      false,
      false,
    ]);
  });

  /**
   * THE DISAGREEMENT, pinned deliberately.
   *
   * Stella paints black at every x from 0 to 5. Our emulator paints red at 0,
   * because `Objects.strobe` has no notion of a later call disturbing an
   * earlier one -- it places each object from the beam and nothing else moves
   * it. This assertion pins the model's CURRENT behaviour so that correcting it
   * is a deliberate act that turns this test red, rather than a silent drift
   * that leaves the comment above describing a state the code has left. That is
   * the 2026-09-07 lesson applied to a value we know to be wrong.
   */
  it('MODEL ONLY: treats the first-positioned object as undisturbed, which Stella denies', () => {
    expect([0, 1, 2].map((x) => latchedIn('collide-two-objects', x))).toEqual([
      true, // Stella: false. See the block comment above.
      false,
      false,
    ]);
  });
});

/**
 * Where a RESM0 and a RESBL strobe put a missile and the ball.
 *
 * MEASURED IN STELLA, 2026-09-27, and this time the model was right.
 *
 * `MISSILE_STROBE_DELAY = 7` was set by shifting the player's measured 8 by
 * one, on the assumption that the two share a mechanism -- and the ball had no
 * constant at all, being routed through the missile's on the assumption that
 * one-pixel objects behave alike. Two assumptions stacked, both now tested.
 *
 * Each fixture is `collide-playfield.asm` with one object swapped in: same
 * block at pixels 0-3, same sweep, same whole-screen verdict, object index 2
 * or 4 instead of 0. Nothing else differs, which is what makes the flips
 * comparable with the player's.
 *
 *   collide-playfield (P0)   x=0 RED,  x=1 black          -> lands at x + 3
 *   collide-missile (M0)     x=0 RED,  x=1 RED,  x=2 black -> lands at x + 2
 *   collide-ball (BL)        x=0 RED,  x=1 RED,  x=2 black -> lands at x + 2
 *
 * So the missile's delay is 7, the ball's is the missile's, and the player
 * really is the odd one at 8. Each fixture paints both colours across its own
 * sweep, so neither verdict rests on a ROM that can only say one thing -- the
 * failure mode that made `collide-two-objects.asm` need a separate control.
 *
 * WHAT THIS DOES NOT MEASURE: the hblank positions. Setting
 * `MISSILE_HBLANK_POSITION` to 99 leaves every verdict here unchanged, so these
 * strobes provably land in the visible region and the constant is untouched by
 * them. It stays UNMEASURED, and that is now a checked statement rather than an
 * assumption.
 */
describe('collide-missile and collide-ball: where a one-pixel object lands', () => {
  function flipOf(fixture: string, knob: string): number {
    for (const x of [0, 1, 2, 3, 4]) {
      const source = fixtureSource(fixture).replace(`${knob}        = 0`, `${knob}        = ${x}`);
      const { rom } = assembleSource(source, `tests/fixtures/tia/${fixture}.asm`, {
        includeDirs: ['kernels/include'],
      });
      const machine = new Machine(rom);
      machine.runFrame();
      machine.runFrame();
      const frame = machine.runFrame({ trace: true });
      const painted = (frame.writes ?? []).filter((w) => w.register === COLUBK).at(-1)?.value;
      if (painted !== RED) return x;
    }
    throw new Error(`${fixture} never stopped painting red; the sweep cannot locate a flip`);
  }

  it('runs both fixtures as 262-line NTSC frames', () => {
    for (const name of ['collide-missile', 'collide-ball']) {
      const machine = new Machine(romFor(name));
      machine.runFrame();
      expect(machine.runFrame().scanlines).toBe(262);
    }
  });

  // A flip at 2 puts the landing pixel at x + 2, which is a delay of 7. A flip
  // at 1 would have meant the missile shares the player's 8.
  it('puts a missile two pixels right of its authored x, so its delay is 7', () => {
    expect(flipOf('collide-missile', 'M0_X')).toBe(2);
    expect(Objects.MISSILE_STROBE_DELAY).toBe(7);
  });

  // The ball takes its width from CTRLPF and has no copies, so it is the object
  // the TIA treats least like the others. It lands where the missile lands.
  it('puts the ball where the missile lands, which is why they share a constant', () => {
    expect(flipOf('collide-ball', 'BL_X')).toBe(flipOf('collide-missile', 'M0_X'));
  });

  // The player is the odd one. Asserted here rather than only in the section
  // above, because "the missile differs from the player by one" is the claim
  // these three fixtures together establish.
  it('leaves the player one pixel further right than either', () => {
    expect(Objects.PLAYER_STROBE_DELAY - Objects.MISSILE_STROBE_DELAY).toBe(1);
  });
});

/**
 * WHERE does an object land? The instrument, and its known-positive.
 *
 * `landing-sweep.asm` inverts `collide-playfield.asm`: it fixes the object and
 * sweeps the PROBE across all twenty playfield bits, one trial per frame,
 * keeping each verdict in RAM so that a single Stella capture reports the
 * landing bin instead of a single bit. Trials 20-39 repeat the sweep with
 * CTRLPF REF set, which is what lifts the answer out of modulo 80: for a
 * landing at or past pixel 80 the repeat index (L - 80) and the mirror index
 * (159 - L) sum to 79, and no two numbers summing to 79 share a four-pixel bin.
 *
 * `landing-sweep-second.asm` is the same ROM plus one `jsr PosObjectX`, which
 * is the configuration `collide-two-objects.asm` showed to displace the first
 * object. These two are to each other what `collide-playfield` and
 * `collide-two-objects` are, and for the same reason: the control differs by
 * exactly one call.
 *
 * The answer is a FOUR-PIXEL BIN. A playfield bit is four pixels wide and
 * nothing here subdivides it.
 */
describe('landing-sweep: reading an object landing pixel in one capture', () => {
  /** `Results` lives at $80, and the RIOT mirrors RAM at `address & 0x7f`. */
  const RESULTS = 0x80 & 0x7f;

  /**
   * The red bins of both halves, as the forty bands would show them.
   *
   * Read from RAM rather than from the COLUBK trace: the trace reports the
   * same forty values in the same order, but RAM is what the ROM actually
   * decided, and a band loop that drew the wrong entry would still produce a
   * plausible trace.
   */
  function bins(fixture: string, x: number, mutate?: (source: string) => string) {
    let source = fixtureSource(fixture).replace('P0_X        = 0', `P0_X        = ${x}`);
    if (mutate) source = mutate(source);
    const { rom } = assembleSource(source, `tests/fixtures/tia/${fixture}.asm`, {
      includeDirs: ['kernels/include'],
    });
    const machine = new Machine(rom);
    // Forty trials, plus two frames of slack: the first frame is short, and a
    // sweep read before it completes reports NOTRUN rather than a verdict.
    for (let i = 0; i < 42; i++) machine.runFrame();
    const results = Array.from(machine.riot.ram.slice(RESULTS, RESULTS + 40));
    const red = (half: number[]) => half.flatMap((v, i) => (v === RED ? [i] : []));
    return { repeat: red(results.slice(0, 20)), mirror: red(results.slice(20)) };
  }

  it('runs both fixtures as 262-line NTSC frames', () => {
    for (const name of ['landing-sweep', 'landing-sweep-second']) {
      const machine = new Machine(romFor(name));
      machine.runFrame();
      expect(machine.runFrame().scanlines).toBe(262);
    }
  });

  /**
   * THE KNOWN-POSITIVE, and the reason it is four points rather than one.
   *
   * A single call lands an authored x at x + 3, measured 2026-08-30 by a
   * different fixture, so every bin below is predicted before the run. The four
   * values are chosen to reach different parts of the instrument, because
   * "exactly one band is red" is true of a mis-ordered probe table too:
   *
   *   x =   0  ->  lands at   3, bin  0      PF0
   *   x =  40  ->  lands at  43, bin 10      PF1
   *   x =  60  ->  lands at  63, bin 15      PF2
   *   x = 100  ->  lands at 103, bins 5/14   the right half, and the REF decode
   *
   * The last one is the one that matters most: 5 and 14 DIFFER, and that
   * difference is the whole reason for the second twenty trials. A landing at
   * pixel 23 would report bin 5 in both halves.
   */
  it('reports the landing bin a single call is already known to produce', () => {
    expect(bins('landing-sweep', 0)).toEqual({ repeat: [0], mirror: [0] });
    expect(bins('landing-sweep', 40)).toEqual({ repeat: [10], mirror: [10] });
    expect(bins('landing-sweep', 60)).toEqual({ repeat: [15], mirror: [15] });
    expect(bins('landing-sweep', 100)).toEqual({ repeat: [5], mirror: [14] });
  });

  /**
   * The detector can fail, shown rather than assumed.
   *
   * PF2 runs D0 up to D7 while PF1 runs D7 down to D0, so a table written from
   * the wrong half of that sentence is the likeliest mistake in the fixture --
   * and it would still light exactly one band. Reversing PF2 moves the authored
   * 60 from bin 15 to bin 16, so the assertion above is load-bearing.
   */
  it('would notice a reversed probe table', () => {
    const reversed = bins('landing-sweep', 60, (source) =>
      source.replace(
        '    .byte $00, $00, $01, $02, $04, $08, $10, $20, $40, $80',
        '    .byte $00, $00, $80, $40, $20, $10, $08, $04, $02, $01',
      ),
    );
    expect(reversed).toEqual({ repeat: [16], mirror: [16] });
  });

  /**
   * MODEL ONLY: our emulator puts the first-positioned object where one call
   * alone would put it, so the subject reads identically to its control.
   *
   * Stella does not: `collide-two-objects.asm` is black at every authored x
   * from 0 to 5 where its control is red at 0. This assertion pins the model's
   * CURRENT behaviour so that correcting it turns this test red deliberately,
   * rather than drifting away from a comment that still describes the old
   * state -- the same 2026-09-07 lesson `collide-two-objects` applies.
   *
   * The Stella bins go in docs/kernel-measurements.md when they are measured.
   */
  it('MODEL ONLY: shows no displacement from the second call, which Stella denies', () => {
    expect(bins('landing-sweep-second', 0)).toEqual({ repeat: [0], mirror: [0] });
  });
});
