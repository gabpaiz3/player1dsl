import { describe, expect, it } from 'vitest';
import { movementBounds, POSITIONING_OFFSET } from '../src/index.ts';

// The arena as tank-arena declares it: a 4-pixel side wall from one playfield
// block, a field rendering frame lines 66-223, and an 8x8 sprite.
const ARENA = {
  wallPixels: 4,
  spriteWidth: 8,
  spriteHeight: 8,
  fieldFirstLine: 66,
  fieldLastLine: 223,
  /** The loop counter that renders on `fieldLastLine + 2`. See emit.ts. */
  counterOrigin: 225,
} as const;

describe('movementBounds', () => {
  /**
   * In AUTHORED coordinates. The rendered bound is the wall's edge -- 4 and 148
   * -- and the sprite renders POSITIONING_OFFSET pixels right of its authored
   * x, so the authored bound is each of those shifted back by three.
   *
   * MOVED, 2026-08-30. These were 4 and 148 while this file assumed an authored
   * x renders on screen pixel x. tests/fixtures/tia/collide-playfield.asm
   * measured the offset and Stella confirmed it; the y bounds are untouched
   * because vertical placement is a loop counter and no strobe is involved.
   */
  it('keeps the sprite clear of the side walls', () => {
    const b = movementBounds(ARENA);
    expect(b.xMin).toBe(4 - POSITIONING_OFFSET);
    expect(b.xMax).toBe(148 - POSITIONING_OFFSET);
  });

  it('keeps the sprite inside the field the ledger allotted', () => {
    const b = movementBounds(ARENA);
    expect(b.yMin).toBe(9);
    expect(b.yMax).toBe(159);
  });

  // Known-positive. A bounds function that ignored the sprite would return the
  // wall edges themselves, and the tank would draw over the arena.
  it('narrows as the sprite grows', () => {
    const wide = movementBounds({ ...ARENA, spriteWidth: 16 });
    expect(wide.xMax).toBe(movementBounds(ARENA).xMax - 8);
  });

  it('narrows as the wall thickens', () => {
    const thick = movementBounds({ ...ARENA, wallPixels: 8 });
    expect(thick.xMin).toBe(8 - POSITIONING_OFFSET);
  });

  // The offset is a MEASUREMENT, so a test that read it back from the same
  // constant would prove nothing. This pins the number itself, and it is the
  // line a future measurement has to argue with.
  it('applies the three-pixel positioning offset the playfield sweep measured', () => {
    expect(POSITIONING_OFFSET).toBe(3);
  });

  /**
   * The reference kernel's own constants are NOT what this returns, and that is
   * the finding rather than a defect. docs/kernel-measurements.md records the
   * measurement: the reference sits 4/4/3/4 inside the tight bound, and a margin
   * that differs on one side of one axis is not a rule any geometry produces.
   *
   * Pinned so that a later attempt to "fix" movementBounds into reproducing
   * 8/144/12/155 has to argue with the measurement first.
   */
  it('does not reproduce the reference kernel, whose margins are hand-chosen', () => {
    const b = movementBounds(ARENA);
    expect([b.xMin, b.xMax, b.yMin, b.yMax]).not.toEqual([8, 144, 12, 155]);
  });
});
