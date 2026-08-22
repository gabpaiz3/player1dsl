import { readFileSync } from 'node:fs';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { check } from '../src/check.ts';
import { bindObjects } from '../src/layout.ts';

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
