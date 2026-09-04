/**
 * What the TIA draws, as state plus one query.
 *
 * Deliberately knows nothing about the beam. `tia.ts` owns the beam and asks
 * this "which objects are present at pixel N"; keeping the two apart is why a
 * future framebuffer is an addition here rather than a rewrite -- colour is a
 * second query over the same state.
 *
 * No colour and no priority. This increment latches collisions, which need
 * PRESENCE and nothing else.
 */

export const Present = {
  P0: 1,
  P1: 2,
  M0: 4,
  M1: 8,
  BL: 16,
  PF: 32,
} as const;

export type MovableName = 'p0' | 'p1' | 'm0' | 'm1' | 'bl';

/** Colour clocks of horizontal blank, repeated here to avoid an import cycle. */
const HBLANK = 68;
const VISIBLE = 160;

/**
 * Copy offsets in pixels per NUSIZ copy mode, and the player's width scale.
 *
 * Modes 5 and 7 are one copy at double and quadruple width; every other mode
 * is one, two or three single-width copies. Written as data because it is a
 * hardware table, and a table is easier to read against a reference than eight
 * branches are.
 */
const NUSIZ_COPIES: readonly (readonly number[])[] = [
  [0], // 0: one copy
  [0, 16], // 1: two copies, close
  [0, 32], // 2: two copies, medium
  [0, 16, 32], // 3: three copies, close
  [0, 64], // 4: two copies, wide
  [0], // 5: one copy, double width
  [0, 32, 64], // 6: three copies, medium
  [0], // 7: one copy, quadruple width
];
const NUSIZ_WIDTH: readonly number[] = [1, 1, 1, 1, 1, 2, 1, 4];

export class Objects {
  /**
   * Where a RESPx strobe puts an object, relative to the beam.
   *
   * PARAMETERS, not constants, and the player's is MEASURED.
   *
   * `tests/fixtures/tia/collide-playfield.asm` sweeps a single-pixel P0 across
   * a playfield block at pixels 0-3 -- the playfield's position is fixed by the
   * beam and no strobe places it, so the sweep measures position ABSOLUTELY
   * where a player-versus-player sweep only measures a separation. Stella put
   * the flip at an authored x of 1; a delay of 5 puts it at 4. The measurement
   * won, and 8 is what reproduces every one of Stella's four data points.
   *
   * See docs/kernel-measurements.md, "Where a RESPx strobe puts an object".
   *
   * WHAT THE SWEEP CANNOT SAY: it measures the strobe and the HMOVE that
   * follows it as one composite, because `PosObjectX` always does both. The
   * three pixels could belong to either. Isolating them needs a fixture that
   * strobes RESPx and never strobes HMOVE, which nothing here has yet.
   *
   * The missile and ball delays, and both hblank positions, are NOT measured.
   * They are carried by the same correction on the assumption that the
   * mechanism is shared, and that assumption is untested.
   */
  static readonly PLAYER_STROBE_DELAY = 8;
  /** UNMEASURED. Shifted with the player's, on an untested assumption. */
  static readonly MISSILE_STROBE_DELAY = 7;
  /** UNMEASURED. */
  static readonly PLAYER_HBLANK_POSITION = 3;
  /** UNMEASURED. */
  static readonly MISSILE_HBLANK_POSITION = 2;

  // Positions, in visible pixels, of each object's first copy.
  p0 = 0;
  p1 = 0;
  m0 = 0;
  m1 = 0;
  bl = 0;

  // Horizontal motion registers, as written: signed nibble in the high half.
  hmp0 = 0;
  hmp1 = 0;
  hmm0 = 0;
  hmm1 = 0;
  hmbl = 0;

  grp0 = 0;
  grp1 = 0;
  enam0 = 0;
  enam1 = 0;
  enabl = 0;
  nusiz0 = 0;
  nusiz1 = 0;
  refp0 = 0;
  refp1 = 0;

  pf0 = 0;
  pf1 = 0;
  pf2 = 0;
  ctrlpf = 0;

  /**
   * Reset an object's position counter to the beam.
   *
   * Inside horizontal blank the counter has not started, so the object comes to
   * rest at its minimum position rather than somewhere off the left edge.
   */
  strobe(name: MovableName, clock: number): void {
    const player = name === 'p0' || name === 'p1';
    const delay = player ? Objects.PLAYER_STROBE_DELAY : Objects.MISSILE_STROBE_DELAY;
    const minimum = player ? Objects.PLAYER_HBLANK_POSITION : Objects.MISSILE_HBLANK_POSITION;
    this[name] = (clock < HBLANK ? minimum : clock - HBLANK + delay) % VISIBLE;
  }

  /** Apply every horizontal-motion register. A POSITIVE nibble moves LEFT. */
  applyHmove(): void {
    const move = (position: number, hm: number): number => {
      const nibble = (hm >> 4) & 0x0f;
      const signed = nibble < 8 ? nibble : nibble - 16;
      return (((position - signed) % VISIBLE) + VISIBLE) % VISIBLE;
    };
    this.p0 = move(this.p0, this.hmp0);
    this.p1 = move(this.p1, this.hmp1);
    this.m0 = move(this.m0, this.hmm0);
    this.m1 = move(this.m1, this.hmm1);
    this.bl = move(this.bl, this.hmbl);
  }

  /** Clear every horizontal-motion register, which is what HMCLR strobes. */
  clearHmove(): void {
    this.hmp0 = 0;
    this.hmp1 = 0;
    this.hmm0 = 0;
    this.hmm1 = 0;
    this.hmbl = 0;
  }

  /** Which objects cover this visible pixel, as a `Present` bitmask. */
  presenceAt(pixel: number): number {
    let mask = 0;
    if (this.playerAt(pixel, this.p0, this.grp0, this.nusiz0, this.refp0)) mask |= Present.P0;
    if (this.playerAt(pixel, this.p1, this.grp1, this.nusiz1, this.refp1)) mask |= Present.P1;
    if (this.blobAt(pixel, this.m0, this.enam0 & 0x02, (this.nusiz0 >> 4) & 3, this.nusiz0)) {
      mask |= Present.M0;
    }
    if (this.blobAt(pixel, this.m1, this.enam1 & 0x02, (this.nusiz1 >> 4) & 3, this.nusiz1)) {
      mask |= Present.M1;
    }
    if (this.blobAt(pixel, this.bl, this.enabl & 0x02, (this.ctrlpf >> 4) & 3, 0)) {
      mask |= Present.BL;
    }
    if (this.playfieldAt(pixel)) mask |= Present.PF;
    return mask;
  }

  private playerAt(
    pixel: number,
    position: number,
    graphics: number,
    nusiz: number,
    refp: number,
  ): boolean {
    if (graphics === 0) return false;
    const mode = nusiz & 0x07;
    const scale = NUSIZ_WIDTH[mode] ?? 1;
    const width = 8 * scale;
    for (const offset of NUSIZ_COPIES[mode] ?? [0]) {
      const start = (position + offset) % VISIBLE;
      const into = (((pixel - start) % VISIBLE) + VISIBLE) % VISIBLE;
      if (into >= width) continue;
      const column = Math.floor(into / scale);
      // Unreflected, the leftmost column is D7. REFP0/1 D3 flips that.
      const bit = (refp & 0x08) !== 0 ? column : 7 - column;
      if ((graphics & (1 << bit)) !== 0) return true;
    }
    return false;
  }

  /**
   * A missile or the ball: no graphics byte, just an enable bit and a width.
   *
   * Missiles take their copy pattern from the same NUSIZ as their player, which
   * is why `nusiz` is passed for them and zero for the ball.
   */
  private blobAt(
    pixel: number,
    position: number,
    enabled: number,
    sizeBits: number,
    nusiz: number,
  ): boolean {
    if (enabled === 0) return false;
    const width = 1 << sizeBits;
    for (const offset of NUSIZ_COPIES[nusiz & 0x07] ?? [0]) {
      const start = (position + offset) % VISIBLE;
      const into = (((pixel - start) % VISIBLE) + VISIBLE) % VISIBLE;
      if (into < width) return true;
    }
    return false;
  }

  /**
   * The playfield: 20 bits across the left half, each 4 pixels wide.
   *
   * The bit order is not left to right. PF0 uses D4-D7 with D4 leftmost, PF1
   * runs D7 down to D0, and PF2 runs D0 up to D7. The right half repeats the
   * left, or mirrors it when CTRLPF D0 (REF) is set.
   */
  private playfieldAt(pixel: number): boolean {
    const half = VISIBLE / 2;
    let index = pixel < half ? pixel : pixel - half;
    if (pixel >= half && (this.ctrlpf & 0x01) !== 0) index = half - 1 - index;
    const bit = Math.floor(index / 4);
    if (bit < 4) return (this.pf0 & (1 << (bit + 4))) !== 0;
    if (bit < 12) return (this.pf1 & (1 << (7 - (bit - 4)))) !== 0;
    return (this.pf2 & (1 << (bit - 12))) !== 0;
  }
}
