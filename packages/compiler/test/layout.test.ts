import { readFileSync } from 'node:fs';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.ts';
import { bindObjects, layout } from '../src/layout.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';

function tankArena() {
  return check(parse(readFileSync(SOURCE, 'utf8'), SOURCE));
}

describe('bindObjects', () => {
  it('gives each band its own claim on the two player objects', () => {
    const bindings = bindObjects(tankArena().scene);

    // The HUD digits and the tanks are DIFFERENT logical holders competing for
    // the SAME two TIA objects -- that competition is exactly why the band
    // boundary costs 5 scanlines. A binding model that gave scores their own
    // objects would compute a boundary cost of zero and a 197-line frame.
    expect(bindings.filter((b) => b.band === 'hud').map((b) => [b.holder, b.object])).toEqual([
      ['score p0', 'p0'],
      ['score p1', 'p1'],
    ]);
    expect(bindings.filter((b) => b.band === 'field').map((b) => [b.holder, b.object])).toEqual([
      ['tank0', 'p0'],
      ['tank1', 'p1'],
    ]);
  });

  it('carries a span on every binding so a diagnostic can point at one', () => {
    const bindings = bindObjects(tankArena().scene);
    expect(bindings).toHaveLength(4); // the extraction found something (testing.md 3)
    for (const binding of bindings) {
      expect(binding.span.file).toBe(SOURCE);
      expect(binding.span.line).toBeGreaterThan(0);
    }
  });

  it('rejects a band needing more movable objects than the hardware has', () => {
    const scene = tankArena().scene;
    const [tank0] = scene.actors;
    if (!tank0) throw new Error('the example lost its actors; this test proves nothing');
    const crowded = { ...scene, actors: [...scene.actors, { ...tank0, name: 'tank2' }] };
    expect(() => bindObjects(crowded)).toThrow(/E501/);
  });
});

describe('layout', () => {
  // The decomposition the ledger consumes. Every line count here comes from
  // template data or from the source; none is arithmetic done in the compiler.
  it('decomposes tank-arena into the row groups the reference kernel has', () => {
    const groups = layout(tankArena().scene).rowGroups;
    expect(groups.map((g) => [g.band, g.kind, g.template, g.lines])).toEqual([
      ['hud', 'glyphs', 'bcd-score-band', 12],
      ['field', 'transition', null, 5],
      ['field', 'run', 'solid-run', 8],
      ['field', 'entry', 'two-sprite-static-field', 1],
      ['field', 'loop', 'two-sprite-static-field', 'remainder'],
      ['field', 'run', 'solid-run', 8],
    ]);
  });

  // The transition is charged to the band being ENTERED, and only when the
  // objects actually have to move. A scene whose first band is also its only
  // band must not be charged one.
  it('charges no transition before the first band', () => {
    const groups = layout(tankArena().scene).rowGroups;
    expect(groups.filter((g) => g.band === 'hud' && g.kind === 'transition')).toEqual([]);
  });

  it('marks exactly one row group as taking the remainder', () => {
    const groups = layout(tankArena().scene).rowGroups;
    expect(groups.filter((g) => g.lines === 'remainder')).toHaveLength(1);
  });

  it('records where each line count came from', () => {
    const byKind = new Map(layout(tankArena().scene).rowGroups.map((g) => [g.kind, g.source]));
    expect(byKind.get('glyphs')).toBe('authored'); // band hud height 12
    expect(byKind.get('run')).toBe('authored'); // playfield border thickness 8
    expect(byKind.get('transition')).toBe('derived'); // repositionLines(2)
    expect(byKind.get('entry')).toBe('template'); // two-sprite-static-field
    expect(byKind.get('loop')).toBe('solved'); // the remainder
  });
});
