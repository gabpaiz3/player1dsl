/**
 * How far a movable object may travel inside a band.
 *
 * This lives in the runtime because it is geometry the HARDWARE and the ledger
 * fix between them: the wall's width is a playfield-bit fact and the field's
 * extent is a ledger row. The compiler owns the DECISION to clamp; the runtime
 * owns the numbers the decision is expressed in.
 *
 * These are the TIGHT bounds -- the sprite may not overlap the wall -- and they
 * are deliberately NOT the reference kernel's 8/144/12/155. That choice was
 * made by measurement: docs/kernel-measurements.md, "Where a movement bound
 * comes from", records the reference sitting 4/4/3/4 inside the tight bound,
 * and a margin that differs on one side of one axis is not a rule that any
 * geometry produces. Reproducing it would be transcription.
 *
 * The POSITIONING OFFSET below is measured, and it is what closed the "assume
 * zero" note this file used to carry.
 *
 * The clamp's ASYMMETRY is not here either. A lower bound rests one below its
 * constant and an upper bound rests exactly on it, because of the `cpx / bcc`
 * versus `cpx / bcs` shape the lowering emits. That belongs to rules.ts: four
 * numbers whose meaning depended on which side of the axis they sat on would be
 * four numbers nobody could reuse.
 */

export interface BoundsInput {
  /** Screen pixels the side wall occupies, from the playfield bits. */
  readonly wallPixels: number;
  readonly spriteWidth: number;
  readonly spriteHeight: number;
  /** Frame-absolute first and last line the field loop renders. */
  readonly fieldFirstLine: number;
  readonly fieldLastLine: number;
  /**
   * Counter value whose sprite row renders on `fieldLastLine + 2`.
   *
   * The field loop counts DOWN and primes one line ahead, so a sprite whose top
   * row is computed at counter N appears on line N-1. `counterOrigin - y` is
   * the top row's frame line; for tank-arena that is 225, which is
   * `fieldLastLine + 2` and is read straight out of `emitLoop`'s text.
   */
  readonly counterOrigin: number;
}

export interface MovementBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** The pixels one playfield bit covers on screen. 40 bits across 160 pixels. */
export const PLAYFIELD_BIT_PIXELS = 4;

/**
 * Screen pixels between an object's AUTHORED x and where it renders.
 *
 * MEASURED, and it was three rather than the zero this file used to assume.
 * `tests/fixtures/tia/collide-playfield.asm` sweeps a single-pixel player
 * across a playfield block whose position the beam fixes, and Stella put the
 * flip three pixels earlier than a zero offset predicts. See
 * docs/kernel-measurements.md, "Where a RESPx strobe puts an object".
 *
 * It is a property of `PosObjectX` -- the strobe and the HMOVE that follows it,
 * measured together -- so it belongs beside the bounds that are expressed in
 * authored coordinates. Every object the compiler places goes through that
 * routine.
 */
export const POSITIONING_OFFSET = 3;

export function movementBounds(input: BoundsInput): MovementBounds {
  const { wallPixels, spriteWidth, spriteHeight, counterOrigin } = input;
  const { fieldFirstLine, fieldLastLine } = input;

  // Horizontal: the sprite starts at x and ends at x + width - 1. Under REF the
  // right wall mirrors the left, so the playfield is 160 pixels wide with a
  // wall at each end.
  // In AUTHORED coordinates, which are what a rule clamps. The sprite renders
  // POSITIONING_OFFSET pixels right of its authored x, so the authored bound is
  // the rendered bound shifted back by it.
  const xMin = wallPixels - POSITIONING_OFFSET;
  const xMax = 160 - wallPixels - spriteWidth - POSITIONING_OFFSET;

  // Vertical, in loop-counter terms, which run OPPOSITE to screen lines: a
  // larger y is higher up. The top row renders at counterOrigin - y, and the
  // bottom row spriteHeight - 1 lines below it.
  const yMax = counterOrigin - fieldFirstLine;
  const yMin = counterOrigin - fieldLastLine + spriteHeight - 1;

  if (xMin > xMax || yMin > yMax) {
    throw new Error(
      `a ${spriteWidth}x${spriteHeight} sprite does not fit between the walls of a band ` +
        `${fieldLastLine - fieldFirstLine + 1} lines tall with a ${wallPixels}-pixel wall: ` +
        `x ${xMin}..${xMax}, y ${yMin}..${yMax}`,
    );
  }

  return { xMin, xMax, yMin, yMax };
}
