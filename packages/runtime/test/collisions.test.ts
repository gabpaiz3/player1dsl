import { CX, Tia } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { collisionLatch } from '../src/index.ts';

describe('collisionLatch', () => {
  it('reports a player pair through CXPPMM D7', () => {
    expect(collisionLatch('p0', 'p1')).toEqual({ register: 'CXPPMM', bit: 0x80 });
  });

  it('does not care which way round the pair is given', () => {
    expect(collisionLatch('p1', 'p0')).toEqual(collisionLatch('p0', 'p1'));
  });

  it('reports a player against the playfield through CXP0FB D7', () => {
    expect(collisionLatch('p0', 'pf')).toEqual({ register: 'CXP0FB', bit: 0x80 });
  });

  /**
   * The runtime's table and the emulator's are written separately, so this is
   * the only thing that makes agreement mean anything.
   *
   * Driving the emulator to SET each pair and reading the register the runtime
   * names is a stronger check than comparing two tables: it proves the runtime
   * names a register that actually reports that pair, rather than proving that
   * a copy is a copy.
   */
  it('names a register the emulator really sets for a player pair', () => {
    const tia = new Tia();
    tia.objects.grp0 = 0xff;
    tia.objects.grp1 = 0xff;
    tia.objects.p0 = 40;
    tia.objects.p1 = 40;
    tia.tick(228);
    const { register, bit } = collisionLatch('p0', 'p1');
    expect(tia.read(CX[register as keyof typeof CX]) & bit).toBe(bit);
  });

  it('names a register the emulator really sets for a player and the playfield', () => {
    const tia = new Tia();
    tia.objects.grp0 = 0xff;
    tia.objects.pf0 = 0x10;
    tia.objects.p0 = 0;
    tia.tick(228);
    const { register, bit } = collisionLatch('p0', 'pf');
    expect(tia.read(CX[register as keyof typeof CX]) & bit).toBe(bit);
  });

  // The known-negative for the pair above: the same register must NOT report a
  // pair that did not touch, or the check above passes on a latch that is
  // simply always set.
  it('leaves the named register clear when the pair does not touch', () => {
    const tia = new Tia();
    tia.objects.grp0 = 0xff;
    tia.objects.pf0 = 0x10;
    tia.objects.p0 = 40;
    tia.tick(228);
    const { register, bit } = collisionLatch('p0', 'pf');
    expect(tia.read(CX[register as keyof typeof CX]) & bit).toBe(0);
  });

  it('refuses a pair the hardware has no latch for', () => {
    expect(() => collisionLatch('p0', 'p0')).toThrow(/E70\d/);
  });

  // Fifteen bits cover fifteen pairs. A table that dropped one would leave a
  // rule silently unlowerable, so the count is pinned.
  it('covers all fifteen pairs the hardware latches', () => {
    const objects = ['p0', 'p1', 'm0', 'm1', 'ball', 'pf'] as const;
    const found = new Set<string>();
    for (const a of objects) {
      for (const b of objects) {
        try {
          const { register, bit } = collisionLatch(a, b);
          found.add(`${register}:${bit}`);
        } catch {
          // p0 against p0, and the playfield against itself, have no latch.
        }
      }
    }
    expect(found.size).toBe(15);
  });
});
