/**
 * Which collision register and bit report a pair of TIA objects.
 *
 * A hardware table, so the runtime owns it. Written independently of
 * `packages/emulator/src/tia.ts`'s `LATCHES` and held to it by a test that
 * DRIVES the emulator to set each pair rather than comparing two tables --
 * comparing them would only prove that a copy is a copy, while driving one
 * proves the register named here actually reports that pair.
 *
 * Fifteen bits cover fifteen PAIRS, not thirty: a latch does not care which
 * object is named first, so the lookup is order-independent.
 */

import type { TiaObject } from './catalog.ts';

/** Everything the TIA can collide. The playfield is not a movable object. */
export type Collidable = TiaObject | 'pf';

export interface CollisionLatch {
  /** Read-register name, as `registerMnemonic` spells it. */
  readonly register: string;
  /** D7 or D6. `bit` copies D7 into N and D6 into V, so this picks the branch. */
  readonly bit: number;
}

const PAIRS: Readonly<Record<string, CollisionLatch>> = {
  'm0|p1': { register: 'CXM0P', bit: 0x80 },
  'm0|p0': { register: 'CXM0P', bit: 0x40 },
  'm1|p0': { register: 'CXM1P', bit: 0x80 },
  'm1|p1': { register: 'CXM1P', bit: 0x40 },
  'p0|pf': { register: 'CXP0FB', bit: 0x80 },
  'ball|p0': { register: 'CXP0FB', bit: 0x40 },
  'p1|pf': { register: 'CXP1FB', bit: 0x80 },
  'ball|p1': { register: 'CXP1FB', bit: 0x40 },
  'm0|pf': { register: 'CXM0FB', bit: 0x80 },
  'ball|m0': { register: 'CXM0FB', bit: 0x40 },
  'm1|pf': { register: 'CXM1FB', bit: 0x80 },
  'ball|m1': { register: 'CXM1FB', bit: 0x40 },
  'ball|pf': { register: 'CXBLPF', bit: 0x80 },
  'p0|p1': { register: 'CXPPMM', bit: 0x80 },
  'm0|m1': { register: 'CXPPMM', bit: 0x40 },
};

export function collisionLatch(a: Collidable, b: Collidable): CollisionLatch {
  const found = PAIRS[`${a}|${b}`] ?? PAIRS[`${b}|${a}`];
  if (!found) {
    throw new Error(
      `E703: the TIA has no collision latch for ${a} against ${b}. Fifteen latches cover ` +
        'fifteen pairs; an object does not collide with itself, and a pair with no latch ' +
        'needs a software check the compiler does not generate yet.',
    );
  }
  return found;
}
