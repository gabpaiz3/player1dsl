import { describe, expect, it } from 'vitest';
import { entryById, repositionLines } from '../src/index.ts';

describe('repositionLines', () => {
  // MEASURED, and visible in tests/goldens/tank-arena.trace frame 0: the
  // HUD -> field boundary repositions 2 objects and occupies frame lines
  // 52-56, which is 5 lines. Two per object for the RESPx strobe, plus one to
  // absorb the HMOVE comb on a line whose background can hide it.
  it('charges 2n + 1 visible lines to reposition n objects', () => {
    expect(repositionLines(2)).toBe(5);
    expect(repositionLines(1)).toBe(3);
  });

  // A boundary that repositions nothing costs nothing. Without this the ledger
  // would charge a phantom line to every band boundary in a game that has no
  // movable objects in one of its bands.
  it('charges nothing when no object needs repositioning', () => {
    expect(repositionLines(0)).toBe(0);
  });
});

describe('template entry costs', () => {
  // THE correction this plan carries. The step-3 design predicted that every
  // region change following a loop exit costs one line. The trace shows the
  // reference ROM's TWO such boundaries costing 1 and 0, so the cost belongs to
  // the template rather than to a general rule. See the design doc's
  // 2026-08-21 correction note.
  it('charges the field kernel one entry line because it primes data a line ahead', () => {
    expect(entryById('two-sprite-static-field')?.cost.entryLines).toBe(1);
  });

  it('charges a solid run zero entry lines because its registers are valid from its first line', () => {
    expect(entryById('solid-run')?.cost.entryLines).toBe(0);
  });

  it('charges the score band zero entry lines', () => {
    expect(entryById('bcd-score-band')?.cost.entryLines).toBe(0);
  });

  // Guard against the vacuous-pass class from testing.md 3: every assertion
  // above reads through entryById, which returns undefined for a typo and would
  // make `?.cost.entryLines` undefined -- and `expect(undefined).toBe(0)` fails,
  // but a future `toBe(undefined)` would not. Assert the lookup works.
  it('resolves every declared entry by id', () => {
    for (const id of ['two-sprite-static-field', 'solid-run', 'bcd-score-band']) {
      expect(entryById(id), `entry ${id} is missing`).toBeDefined();
    }
    expect(entryById('no-such-template')).toBeUndefined();
  });
});
