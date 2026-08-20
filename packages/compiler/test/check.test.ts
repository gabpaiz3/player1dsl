import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '../../parser/src/index.ts';
import { check } from '../src/index.ts';

const path = fileURLToPath(new URL('../../../examples/tank-arena/tank-arena.p1', import.meta.url));
const ir = () => check(parse(readFileSync(path, 'utf8'), 'tank-arena.p1'));

const HEADER =
  'game "T"\ntarget ntsc\ncartridge 4k\n\npalette pal:\n  c = $0E\n\nsprite s 8x1:\n  X.......\n';
const checkSource = (body: string) => check(parse(`${HEADER}\n${body}`, 't.p1'));

describe('checker', () => {
  it('accepts tank-arena.p1', () => {
    expect(ir().title).toBe('Tank Arena');
  });

  it('declares a variable per mutable actor coordinate and per score', () => {
    const names = ir().variables.map((v) => v.name);
    expect(names).toEqual(
      expect.arrayContaining(['tank0_x', 'tank0_y', 'tank1_x', 'tank1_y', 'p0_score', 'p1_score']),
    );
  });

  it('carries the declared initial values into the IR', () => {
    const byName = new Map(ir().variables.map((v) => [v.name, v.initial]));
    expect(byName.get('tank0_x')).toBe(40);
    expect(byName.get('tank0_y')).toBe(120);
    expect(byName.get('p0_score')).toBe(3);
    expect(byName.get('p1_score')).toBe(5);
  });

  it('resolves colours to their palette values', () => {
    const actors = ir().scene.actors;
    expect(actors.map((a) => a.color)).toEqual([0x46, 0x86]);
  });

  it('rejects an unknown colour name', () => {
    expect(() =>
      checkSource(
        'scene sc:\n  background nope\n\n  band b height 4:\n    actor a uses s at (1, 2) color c\n',
      ),
    ).toThrow(/E20\d/);
  });

  it('rejects an actor referencing an undeclared sprite', () => {
    expect(() =>
      checkSource(
        'scene sc:\n  background c\n\n  band b height 8:\n    actor a uses nosuch at (1, 2) color c\n',
      ),
    ).toThrow(/E20\d/);
  });

  it('rejects a position outside the visible field', () => {
    expect(() =>
      checkSource(
        'scene sc:\n  background c\n\n  band b height 8:\n    actor a uses s at (200, 2) color c\n',
      ),
    ).toThrow(/E20\d/);
  });

  it('rejects a cartridge size phase 1 does not support', () => {
    expect(() => check(parse('game "T"\ntarget ntsc\ncartridge 8k\n', 't.p1'))).toThrow(/E2\d\d/);
  });

  it('rejects more than one band without an explicit height', () => {
    // The remainder can only be given to one band.
    expect(() =>
      checkSource(
        'scene sc:\n  background c\n\n  band a:\n    actor x uses s at (1, 2) color c\n\n  band b:\n    actor y uses s at (3, 4) color c\n',
      ),
    ).toThrow(/E2\d\d/);
  });

  it('rejects a rule naming an actor that does not exist', () => {
    expect(() =>
      checkSource(
        'scene sc:\n  background c\n\n  band b height 8:\n    actor a uses s at (1, 2) color c\n\nwhen a hits ghost:\n  score p0 += 1\n',
      ),
    ).toThrow(/E2\d\d/);
  });

  it('reports every diagnostic, not just the first', () => {
    try {
      checkSource(
        'scene sc:\n  background nope\n\n  band b height 4:\n    actor a uses nosuch at (1, 2) color alsonope\n',
      );
      throw new Error('should have thrown');
    } catch (error) {
      const diagnostics = (error as { diagnostics?: unknown[] }).diagnostics ?? [];
      expect(diagnostics.length).toBeGreaterThan(1);
    }
  });

  it('keeps no hardware detail in the IR', () => {
    // The game IR is pure semantics. Scanlines, registers and cycle costs arrive
    // with the layout IR in plan 3; if any leak in here, the layering is broken.
    const serialised = JSON.stringify(ir());
    for (const leaked of ['scanline', 'GRP', 'RESP', 'WSYNC', 'cycles']) {
      expect(serialised).not.toContain(leaked);
    }
  });
});
