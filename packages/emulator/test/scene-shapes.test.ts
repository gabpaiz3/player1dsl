import { readFileSync } from 'node:fs';
import { build, check } from '@player1dsl/compiler';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { Machine } from '../src/index.ts';

/**
 * Scenes ONE EDIT from `tank-arena.p1`.
 *
 * An independent review on 2026-09-07 compiled four of these and got a balanced
 * ledger, a passing cycle budget, a 262-line frame and a WRONG PICTURE from
 * every one, with no diagnostic anywhere. The pipeline -- parser, IR, layout,
 * ledger, catalog, emitter -- was never the problem. The composer in `build.ts`
 * was, because it reached for a fallback wherever the example happened to make
 * one unnecessary: `?? 'p0'`, `?? 0`, `sprites[0]`, and a ledger row found by
 * matching a human-readable note string.
 *
 * The runtime and the lowering refuse rather than guess -- E602, E701, E703,
 * `cycleCost` throwing, VDEL throwing. These tests hold the composer to the
 * same standard: it must be RIGHT for these scenes, or REFUSE them. What it may
 * not do is emit a ROM that runs and lies.
 *
 * Positions are read from the emulator's object tracking. An authored x renders
 * at x + 3 (`POSITIONING_OFFSET`, measured against Stella), so the committed
 * example's tanks at 40 and 110 sit at 43 and 113.
 */

const SOURCE = 'examples/tank-arena/tank-arena.p1';
const base = () => readFileSync(SOURCE, 'utf8');

/** Object positions after the frame has drawn, which is where the field puts them. */
function positionsOf(text: string): { p0: number; p1: number } {
  const machine = new Machine(build(check(parse(text, SOURCE))).rom);
  machine.runFrame();
  machine.runFrame();
  machine.runFrame();
  return { p0: machine.tia.objects.p0, p1: machine.tia.objects.p1 };
}

/** The HUD band, its two scores, and the rule that scores into them, removed. */
function fieldOnly(): string {
  return base()
    .replace(/\n {2}# One digit per player[\s\S]*?start 5 color hud\n/, '\n')
    .replace(/\n# The TIA collision latches[\s\S]*$/, '\n');
}

describe('a scene whose first band holds the actors', () => {
  /**
   * THE first broken scene.
   *
   * Vertical-blank setup positioned the first band's objects at the first
   * band's SCORES' x, paired by index -- `firstScores[i]?.x ?? 0`. With no HUD,
   * the first band is the field, its holders are the tanks, and there are no
   * scores: both tanks were positioned with `lda #0`.
   *
   * The tank still MOVED in RAM. After thirty frames of joystick-right its
   * `tank0_x` read 71 while the sprite sat at pixel 3, because the position the
   * kernel draws and the byte the rule writes had come apart.
   */
  it('positions each actor where the source puts it, with no HUD to borrow from', () => {
    expect(positionsOf(fieldOnly())).toEqual({ p0: 43, p1: 113 });
  });
});

describe('a scene with fewer scores than the band has objects', () => {
  /**
   * THE second broken scene, and a different failure from the first.
   *
   * With one score in the HUD and two actors in the field, the index pairing
   * runs out: the second object had no score to take an x from. It was never
   * strobed at all, and came to rest wherever the reset clear-loop's
   * `sta $00,x` happened to hit RESP1.
   */
  it('positions the second actor rather than leaving it where reset left it', () => {
    const oneScore = base().replace(/\n {4}score p1 at .*\n/, '\n');
    expect(positionsOf(oneScore)).toEqual({ p0: 43, p1: 113 });
  });
});

describe('a movement bound named by the rule', () => {
  /**
   * THE third broken scene.
   *
   * `within field` and `within hud` produced IDENTICAL `cpx` constants. The
   * checker validated that the band exists (E206) and the lowerer put the name
   * in a comment; the bounds came from a ledger row found by matching the note
   * string 'the open field', regardless of what the rule said.
   *
   * REFUSED rather than interpreted, and that is a deliberate choice about what
   * `within` means. A band is a horizontal strip drawn by its own kernel, and
   * an actor is drawn by the kernel of the band it lives in -- so clamping
   * tank0 to the HUD's scanlines would confine it to lines nothing draws it on.
   * There is no sensible picture to emit, so the compiler refuses instead of
   * choosing one.
   *
   * This is what makes `within` mean something. Naming the actor's own band is
   * the only coherent use of it today, and a rule that says otherwise is now a
   * diagnostic rather than a word the compiler skips.
   */
  it('refuses a bound naming a band the actor does not live in', () => {
    const inHud = base().replace(/within field/g, 'within hud');
    expect(() => build(check(parse(inHud, SOURCE)))).toThrow(/E219/);
  });

  // The coherent case still compiles, so the check above is a constraint and
  // not a ban on the keyword.
  it('accepts a bound naming the actor own band', () => {
    expect(() => build(check(parse(base(), SOURCE)))).not.toThrow();
  });
});

describe('actors drawn from different sprites', () => {
  /**
   * THE fourth broken scene.
   *
   * `movementBounds` was computed ONCE, from `sprites[0]`, and both actors were
   * clamped by it. An actor whose sprite is taller reaches its bound too late
   * and can be driven that many rows into the bottom wall.
   *
   * A sprite twice as tall is the clearest case, but any difference in height
   * or width moves a bound.
   */
  it('clamps each actor by the sprite it actually uses', () => {
    const tall = base()
      .replace(
        /\nscene arena:/,
        [
          '',
          'sprite tall 8x16:',
          ...Array.from({ length: 16 }, () => '  XXXXXXXX'),
          '',
          'scene arena:',
        ].join('\n'),
      )
      .replace('actor tank1 uses tank', 'actor tank1 uses tall');

    // tank1's own clamp constants, before and after its sprite got taller.
    // A 16-row sprite reaches the bottom wall eight rows earlier, so its lower
    // y bound must move. Sharing one `movementBounds` left them identical.
    const clampsForTank1 = (text: string) =>
      build(check(parse(text, SOURCE)))
        .source.split('\n')
        .filter((line) => line.includes('cpx #'))
        .slice(4); // the second movement rule: four directions apiece

    expect(clampsForTank1(tall)).not.toEqual(clampsForTank1(base()));
  });
});

describe('a scene with more than one playfield', () => {
  /**
   * The same class as the four above, found by reading rather than reported.
   *
   * `COLUPF` is written ONCE, in one-time setup, from `scene.playfields[0]`.
   * Layout already lets each band carry its own playfield and decomposes them
   * independently -- so a second one in a different colour draws in the FIRST
   * one's colour, with a balanced ledger and no diagnostic.
   *
   * Refused rather than fixed. Rendering it properly means a per-band COLUPF
   * write, which is a kernel change with a line cost nothing has measured, and
   * inventing that cost here is exactly the assumed zero the ledger exists to
   * prevent. A refusal is honest about the limit; a silent wrong colour is not.
   */
  it('refuses a second playfield rather than drawing it in the first colour', () => {
    const twoPlayfields = base().replace(
      '  band hud height 12:',
      '  band hud height 12:\n    playfield border thickness 2, mode reflect, color red',
    );
    expect(() => build(check(parse(twoPlayfields, SOURCE)))).toThrow(/E507/);
  });
});
