import { readFileSync } from 'node:fs';
import { P1Error, parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.ts';
import { layout } from '../src/layout.ts';
import { buildLedger, formatLedger, NTSC_VISIBLE_LINES } from '../src/ledger.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';

function ledgerFor(source: string) {
  return buildLedger(layout(check(parse(source, SOURCE)).scene));
}

function tankArenaSource(): string {
  return readFileSync(SOURCE, 'utf8');
}

describe('the line ledger', () => {
  // THE assertion this increment exists for. The source states a HUD height of
  // 12 and a border thickness of 8 and nothing else; 158 is derived from
  // 192 - 12 - 5 - 8 - 1 - 8. The reference kernel's FIELD_LINES is 158.
  //
  // This test alone cannot falsify the ledger -- it asserts that the compiler
  // computes what the compiler computes. Increment 5b builds a ROM from it and
  // runs it, which can. See the plan's note on why 5b exists.
  it('derives 158 field lines from a HUD height and a border thickness', () => {
    const rows = ledgerFor(tankArenaSource()).rows;
    const loop = rows.find((r) => r.kind === 'loop');
    expect(loop, 'the ledger has no loop row').toBeDefined();
    expect(loop?.lines).toBe(158);
  });

  it('sums to exactly the visible budget', () => {
    const ledger = ledgerFor(tankArenaSource());
    expect(ledger.total).toBe(NTSC_VISIBLE_LINES);
    expect(ledger.total).toBe(192);
  });

  // The frame lines below are READ FROM tests/goldens/tank-arena.trace, frame 0,
  // not predicted. If this test and the golden ever disagree, the golden is the
  // record of what the hardware did.
  it('places every row group on the frame lines the reference kernel uses', () => {
    const rows = ledgerFor(tankArenaSource()).rows;
    expect(rows.map((r) => [r.kind, r.firstLine, r.lastLine])).toEqual([
      ['glyphs', 40, 51],
      ['transition', 52, 56],
      ['run', 57, 64],
      ['entry', 65, 65],
      ['loop', 66, 223],
      ['run', 224, 231],
    ]);
  });
});

describe('the ledger gate', () => {
  // testing.md 1: a gate that has never rejected anything is not known to work.
  // Both directions, because a short frame and a long frame read differently to
  // whoever has to fix the scene.
  function withHudHeight(height: number): string {
    const source = tankArenaSource().replace('band hud height 12:', `band hud height ${height}:`);
    expect(source, 'the substitution found nothing').toContain(`height ${height}`);
    return source;
  }

  it('accepts the balanced scene', () => {
    expect(() => ledgerFor(withHudHeight(12))).not.toThrow();
  });

  // A remainder band absorbs any HUD height, so an UNBALANCED scene needs a
  // band that cannot absorb it. Give the field an explicit height too.
  function bothBandsFixed(fieldHeight: number): string {
    const source = tankArenaSource().replace('band field:', `band field height ${fieldHeight}:`);
    expect(source, 'the substitution found nothing').toContain('band field height');
    return source;
  }

  it('rejects a frame that is one line short', () => {
    expect(() => ledgerFor(bothBandsFixed(157))).toThrow(/E503/);
    expect(() => ledgerFor(bothBandsFixed(157))).toThrow(/191/);
  });

  it('rejects a frame that is one line long', () => {
    expect(() => ledgerFor(bothBandsFixed(159))).toThrow(/E503/);
    expect(() => ledgerFor(bothBandsFixed(159))).toThrow(/193/);
  });

  // MEASURED, not predicted: replacing the primary E503 branch with `if (false)`
  // turns exactly ONE test red -- this one. The other two still pass, because the
  // belt-and-braces total check at the end of buildLedger catches the same
  // imbalance and its message happens to contain both "E503" and the wrong total.
  //
  // That is worth knowing rather than papering over. There really are two gates,
  // and what the primary one uniquely provides is not detection but an ACTIONABLE
  // diagnostic: which direction to move and by how much. This test is the only
  // thing covering that, so it is the only one that can notice the primary gate
  // going missing.
  it('names the shortfall so the author knows which way to move', () => {
    expect(() => ledgerFor(bothBandsFixed(157))).toThrow(/1 short/);
    expect(() => ledgerFor(bothBandsFixed(159))).toThrow(/1 too many/);

    // The hint is on the diagnostic, not in Error.message, so `toThrow` cannot
    // see it. Read it where it lives -- an unhelpful hint is a real defect and
    // this is the only place that would notice one.
    try {
      ledgerFor(bothBandsFixed(157));
      expect.unreachable('the gate did not fire');
    } catch (error) {
      expect(error).toBeInstanceOf(P1Error);
      const [diagnostic] = (error as P1Error).diagnostics;
      expect(diagnostic?.code).toBe('E503');
      expect(diagnostic?.hint).toMatch(/leave one band without a height/);
    }
  });
});

describe('formatLedger', () => {
  it('renders every row with its line span and where its count came from', () => {
    const text = formatLedger(ledgerFor(tankArenaSource()));
    expect(text).toContain('158');
    expect(text).toContain('solved');
    expect(text).toContain('192');
  });
});
