import type { Span } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import type { BandRequirement } from '../src/index.ts';
import { ENTRIES, selectTemplate } from '../src/index.ts';

const SPAN: Span = { file: 'select.test.ts', line: 7, column: 3 };

function request(overrides: Partial<BandRequirement> = {}): BandRequirement {
  return { band: 'field', kind: 'loop', objects: 2, copies: 'none', span: SPAN, ...overrides };
}

/** The id, or the diagnostic code, so a failure reads either way round. */
function selected(req: BandRequirement): string {
  const result = selectTemplate(req);
  return result.ok ? result.entry.id : result.diagnostic.code;
}

describe('selectTemplate', () => {
  // These three are the selections layout.ts hard-coded before the selector
  // existed. They must not move: compiler/test/layout.test.ts asserts the same
  // three ids and compiler/test/ledger.test.ts derives 158 field lines from
  // their costs.
  it('selects two-sprite-static-field for a loop needing two objects', () => {
    expect(selected(request())).toBe('two-sprite-static-field');
  });

  it('selects solid-run for a run needing no objects', () => {
    expect(selected(request({ kind: 'run', objects: 0 }))).toBe('solid-run');
  });

  it('selects bcd-score-band for a glyph region', () => {
    expect(selected(request({ band: 'hud', kind: 'glyphs' }))).toBe('bcd-score-band');
  });

  // THE known-negative for the tie-break. bcd-score-band and
  // two-sprite-static-field are identical in objects and perLineData, and the
  // score band is CHEAPER (0 entry lines against 1). A selector that ranked by
  // cost before filtering by kind would hand the field to the score kernel and
  // still pass every assertion above except this one.
  it('does not let the cheaper score kernel win a region it cannot draw', () => {
    const result = selectTemplate(request());
    expect(result.ok && result.entry.applies.kinds).toContain('loop');
    expect(selected(request({ kind: 'glyphs' }))).not.toBe('two-sprite-static-field');
  });

  // A selector whose result depends on array order changes its output when
  // someone reorders entries.ts. Asking twice would prove nothing -- the same
  // input gives the same answer either way. Feeding the SAME entries in the
  // opposite order is the assertion that actually notices a dropped tie-break.
  it('does not depend on the order entries.ts lists its entries in', () => {
    const reversed = [...ENTRIES].reverse();
    for (const req of [
      request(),
      request({ kind: 'run', objects: 0 }),
      request({ kind: 'glyphs' }),
    ]) {
      const forwards = selectTemplate(req);
      const backwards = selectTemplate(req, reversed);
      expect(forwards.ok && backwards.ok && backwards.entry.id).toBe(
        forwards.ok ? forwards.entry.id : 'unreachable',
      );
    }
  });
});

describe('when nothing applies', () => {
  // The plan's known-positive: a selector that always returns the first entry
  // passes every test above.
  it('reports E601 for a region no entry has enough objects for', () => {
    const result = selectTemplate(request({ objects: 5 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable; narrowed above');
    expect(result.diagnostic.code).toBe('E601');
    expect(result.diagnostic.span).toEqual(SPAN);

    // Assert the TEXT, not just the code. A diagnostic reading "unsatisfiable"
    // passes a code-only assertion and helps nobody: the author needs to know
    // both what was asked for and what is on offer.
    expect(result.diagnostic.message).toContain('field');
    expect(result.diagnostic.message).toContain('5');
    expect(result.diagnostic.message).toContain('2');
  });

  it('reports E601 for a region kind no entry draws', () => {
    const result = selectTemplate(request({ kind: 'transition' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable; narrowed above');
    expect(result.diagnostic.code).toBe('E601');
    expect(result.diagnostic.message).toContain('transition');
  });

  // The distinction the copies field exists to make, and the only thing that
  // stops it being decorative. `repositioned` is not "no entry does this yet" --
  // it is "nobody has measured what it costs", and those send whoever reads the
  // diagnostic to two different places: one to write an entry, one to write a
  // fixture.
  it('reports E602, not E601, for a copy strategy nothing has measured', () => {
    const result = selectTemplate(request({ copies: 'repositioned' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable; narrowed above');
    expect(result.diagnostic.code).toBe('E602');
    expect(result.diagnostic.message).toMatch(/measured/);
  });

  // hardware-nusiz WAS measured -- sprite-formation.asm found it free -- so a
  // request for it is an ordinary unsatisfied request, not an unmeasured one.
  // Without this, E602 could be written to catch every copies value that is not
  // 'none' and still pass the test above.
  it('reports E601 for a measured copy strategy no entry implements', () => {
    const result = selectTemplate(request({ copies: 'hardware-nusiz' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable; narrowed above');
    expect(result.diagnostic.code).toBe('E601');
  });
});
