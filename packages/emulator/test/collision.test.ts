import { describe, expect, it } from 'vitest';
import { CX, Tia } from '../src/index.ts';

/** Run one full scanline with whatever object state the caller set up. */
function line(setup: (tia: Tia) => void): Tia {
  const tia = new Tia();
  setup(tia);
  tia.tick(228);
  return tia;
}

describe('collision latches', () => {
  it('sets the P0-P1 bit when two players share a pixel', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    expect(tia.read(CX.CXPPMM) & 0x80).toBe(0x80);
  });

  // THE known-negative, and it is the one that matters: a latch that set
  // unconditionally would pass the test above and tell us nothing.
  it('leaves it clear when the two players do not overlap', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 140);
    });
    expect(tia.read(CX.CXPPMM) & 0x80).toBe(0);
  });

  it('leaves it clear when they overlap but one draws no pixels', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0x00;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    expect(tia.read(CX.CXPPMM) & 0x80).toBe(0);
  });

  // Strobed inside horizontal blank, an object comes to rest at its minimum
  // position -- 3 for a player -- which overlaps PF0 D4's block at pixels 0-3.
  // Written that way rather than with a clock chosen to land somewhere, so that
  // Task 5 correcting PLAYER_STROBE_DELAY cannot silently unmake the overlap.
  it('sets the P0-playfield bit when a player crosses a lit block', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.pf0 = 0x10; // leftmost block, pixels 0-3
      t.objects.strobe('p0', 10);
    });
    expect(tia.read(CX.CXP0FB) & 0x80).toBe(0x80);
  });

  // The position-sensitive negative for the pair above. `presenceAt` is asked
  // where the objects are rather than told, so a latch that ignored position
  // would pass the positive and fail here.
  it('leaves the P0-playfield bit clear when the player misses the block', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.pf0 = 0x10;
      t.objects.p0 = 40;
    });
    expect(tia.read(CX.CXP0FB) & 0x80).toBe(0);
  });

  it('sets the missile-player bits from the right pair', () => {
    const tia = line((t) => {
      t.objects.grp1 = 0xff;
      t.objects.enam0 = 0x02;
      t.objects.nusiz0 = 0x30; // missile width 8, so the pair overlaps
      t.objects.p1 = 40;
      t.objects.m0 = 40;
    });
    // CXM0P D7 is M0-P1. D6 is M0-P0, which has no graphics byte here, so the
    // assertion pins BOTH: the right bit set and its neighbour clear.
    expect(tia.read(CX.CXM0P) & 0xc0).toBe(0x80);
  });

  it('sets the ball-playfield bit', () => {
    const tia = line((t) => {
      t.objects.enabl = 0x02;
      t.objects.pf0 = 0x10;
      t.objects.bl = 2;
    });
    expect(tia.read(CX.CXBLPF) & 0x80).toBe(0x80);
  });

  it('is LEVEL, not edged: the latch survives into the next line', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    tia.objects.grp1 = 0x00; // stop overlapping
    tia.tick(228);
    expect(tia.read(CX.CXPPMM) & 0x80).toBe(0x80);
  });

  it('clears every latch on CXCLR', () => {
    const tia = line((t) => {
      t.objects.grp0 = 0xff;
      t.objects.grp1 = 0xff;
      t.objects.strobe('p0', 100);
      t.objects.strobe('p1', 100);
    });
    tia.write(0x2c, 0); // CXCLR
    expect(tia.read(CX.CXPPMM)).toBe(0);
  });

  // Input registers stay unmodelled, and the comment saying so must now name
  // them rather than covering every read.
  it('still reads INPT4 as not-pressed', () => {
    expect(new Tia().read(0x0c)).toBe(0);
  });

  // Vertical delay is not modelled, and a model that ignored it silently would
  // draw the wrong line's graphics and latch a collision that never happened.
  it('refuses a ROM that enables vertical delay rather than ignoring it', () => {
    expect(() => new Tia().write(0x25, 0x01)).toThrow(/VDEL/);
  });

  it('accepts a VDEL write that turns it off, which ROMs do at reset', () => {
    expect(() => new Tia().write(0x25, 0x00)).not.toThrow();
  });
});
