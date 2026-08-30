import { describe, expect, it } from 'vitest';
import { Objects, Present } from '../src/index.ts';

/** The pixels at which an object is present, as an array of indices. */
function pixels(objects: Objects, bit: number): number[] {
  const on: number[] = [];
  for (let x = 0; x < 160; x += 1) {
    if ((objects.presenceAt(x) & bit) !== 0) on.push(x);
  }
  return on;
}

describe('player position', () => {
  // A RESPx strobe in the VISIBLE region puts the object's first pixel a fixed
  // delay after the beam. The delay is a PARAMETER measured by
  // tests/fixtures/tia/, not a constant this test is entitled to invent -- it
  // asserts the arithmetic around the parameter, and the fixtures assert the
  // parameter.
  it('places a player relative to the beam at the strobe', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.strobe('p0', 68 + 20); // visible pixel 20
    expect(pixels(o, Present.P0)[0]).toBe(20 + Objects.PLAYER_STROBE_DELAY);
  });

  it('parks a player at the left edge when strobed inside horizontal blank', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.strobe('p0', 10);
    expect(pixels(o, Present.P0)[0]).toBe(Objects.PLAYER_HBLANK_POSITION);
  });

  it('draws only the bits the graphics byte sets', () => {
    const o = new Objects();
    o.grp0 = 0b10000001;
    o.strobe('p0', 68);
    const start = Objects.PLAYER_STROBE_DELAY;
    expect(pixels(o, Present.P0)).toEqual([start, start + 7]);
  });

  it('mirrors the graphics byte when REFP is set', () => {
    const o = new Objects();
    o.grp0 = 0b11000000;
    o.refp0 = 0x08;
    o.strobe('p0', 68);
    const start = Objects.PLAYER_STROBE_DELAY;
    expect(pixels(o, Present.P0)).toEqual([start + 6, start + 7]);
  });

  it('draws nothing at all when the graphics byte is zero', () => {
    const o = new Objects();
    o.grp0 = 0;
    o.strobe('p0', 68);
    expect(pixels(o, Present.P0)).toEqual([]);
  });
});

describe('NUSIZ', () => {
  it('doubles a player width at size 5', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.nusiz0 = 5;
    o.strobe('p0', 68);
    expect(pixels(o, Present.P0)).toHaveLength(16);
  });

  it('quadruples it at size 7', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.nusiz0 = 7;
    o.strobe('p0', 68);
    expect(pixels(o, Present.P0)).toHaveLength(32);
  });

  it('draws three close copies at size 3', () => {
    const o = new Objects();
    o.grp0 = 0xff;
    o.nusiz0 = 3;
    o.strobe('p0', 68);
    const start = Objects.PLAYER_STROBE_DELAY;
    expect(pixels(o, Present.P0)).toHaveLength(24);
    expect(pixels(o, Present.P0)).toContain(start + 16);
    expect(pixels(o, Present.P0)).toContain(start + 32);
  });

  it('sizes a missile from the high NUSIZ bits', () => {
    const o = new Objects();
    o.enam0 = 0x02;
    o.nusiz0 = 0x20; // missile width 4
    o.strobe('m0', 68);
    expect(pixels(o, Present.M0)).toHaveLength(4);
  });

  it('leaves a missile absent while its enable bit is clear', () => {
    const o = new Objects();
    o.enam0 = 0x00;
    o.strobe('m0', 68);
    expect(pixels(o, Present.M0)).toEqual([]);
  });
});

describe('HMOVE', () => {
  // HM values are a signed nibble in the HIGH half of the byte, and a POSITIVE
  // value moves the object LEFT. $70 is +7 (left 7), $F0 is -1 (right 1).
  it('moves an object left for a positive nibble', () => {
    const o = new Objects();
    o.grp0 = 0x80;
    o.strobe('p0', 68 + 40);
    o.hmp0 = 0x70;
    o.applyHmove();
    expect(pixels(o, Present.P0)[0]).toBe(40 + Objects.PLAYER_STROBE_DELAY - 7);
  });

  it('moves it right for a negative one', () => {
    const o = new Objects();
    o.grp0 = 0x80;
    o.strobe('p0', 68 + 40);
    o.hmp0 = 0xf0;
    o.applyHmove();
    expect(pixels(o, Present.P0)[0]).toBe(40 + Objects.PLAYER_STROBE_DELAY + 1);
  });

  // Known-positive: HMOVE with every HM register clear must move nothing. A
  // model that applied a constant comb offset would fail here.
  it('moves nothing when every HM register is zero', () => {
    const o = new Objects();
    o.grp0 = 0x80;
    o.strobe('p0', 68 + 40);
    const before = pixels(o, Present.P0)[0];
    o.applyHmove();
    expect(pixels(o, Present.P0)[0]).toBe(before);
  });
});

describe('the playfield', () => {
  // The bit order is not left to right: PF0 uses only D4-D7 with D4 leftmost,
  // PF1 runs D7 to D0, and PF2 runs D0 to D7. tank-arena's side wall is one
  // PF0 block -- $10 -- and its solid rows are $F0/$FF/$FF.
  it('lights the leftmost four pixels for PF0 D4 alone', () => {
    const o = new Objects();
    o.pf0 = 0x10;
    expect(pixels(o, Present.PF).filter((x) => x < 80)).toEqual([0, 1, 2, 3]);
  });

  it('lights the whole left half for $F0/$FF/$FF', () => {
    const o = new Objects();
    o.pf0 = 0xf0;
    o.pf1 = 0xff;
    o.pf2 = 0xff;
    expect(pixels(o, Present.PF)).toHaveLength(160);
  });

  it('mirrors the right half under REF and repeats it without', () => {
    const mirrored = new Objects();
    mirrored.pf0 = 0x10;
    mirrored.ctrlpf = 0x01;
    expect(pixels(mirrored, Present.PF)).toEqual([0, 1, 2, 3, 156, 157, 158, 159]);

    const repeated = new Objects();
    repeated.pf0 = 0x10;
    expect(pixels(repeated, Present.PF)).toEqual([0, 1, 2, 3, 80, 81, 82, 83]);
  });

  it('runs PF1 backwards from D7, which is what makes the bit order load-bearing', () => {
    const o = new Objects();
    o.pf1 = 0x80; // D7 is PF1's FIRST block: pixels 16-19
    expect(pixels(o, Present.PF).filter((x) => x < 80)).toEqual([16, 17, 18, 19]);
  });

  it('runs PF2 forwards from D0', () => {
    const o = new Objects();
    o.pf2 = 0x01; // D0 is PF2's first block: pixels 48-51
    expect(pixels(o, Present.PF).filter((x) => x < 80)).toEqual([48, 49, 50, 51]);
  });
});
