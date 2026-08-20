import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.ts';

const header = 'game "Tank Arena"\ntarget ntsc\ncartridge 4k\n';

describe('parser', () => {
  it('parses the header declarations', () => {
    const program = parse(header, 't.p1');
    expect(program.decls.map((d) => d.kind)).toEqual(['game', 'target', 'cartridge']);
  });

  it('parses a palette block', () => {
    const program = parse(`${header}palette arena:\n  walls = $0E\n  tank0 = $46\n`, 't.p1');
    const palette = program.decls.find((d) => d.kind === 'palette');
    expect(palette?.kind === 'palette' && palette.entries.map((e) => [e.name, e.value])).toEqual([
      ['walls', 0x0e],
      ['tank0', 0x46],
    ]);
  });

  it('parses sprite pixel rows into bytes, MSB leftmost', () => {
    const src = `${header}sprite tank 8x2:\n  X.......\n  ..XX....\n`;
    const sprite = parse(src, 't.p1').decls.find((d) => d.kind === 'sprite');
    expect(sprite?.kind === 'sprite' && sprite.rows).toEqual([0b10000000, 0b00110000]);
  });

  it('rejects a sprite row whose width does not match the declaration', () => {
    expect(() => parse(`${header}sprite tank 8x1:\n  X..\n`, 't.p1')).toThrow(/E1\d\d/);
  });

  it('rejects a sprite whose row count does not match the declared height', () => {
    expect(() => parse(`${header}sprite tank 8x4:\n  X.......\n`, 't.p1')).toThrow(/E1\d\d/);
  });

  it('parses a band with a playfield, an actor and a score', () => {
    const src =
      `${header}scene arena:\n  background sky\n\n` +
      '  band hud height 12:\n    score p0 at (60, 2) digits 1 start 3 color hud\n\n' +
      '  band field:\n' +
      '    playfield border thickness 8, mode reflect, color walls\n' +
      '    actor tank0 uses tank at (40, 120) color red controls joystick1\n';
    const scene = parse(src, 't.p1').decls.find((d) => d.kind === 'scene');
    if (scene?.kind !== 'scene') throw new Error('no scene');
    expect(scene.bands.map((b) => [b.name, b.height])).toEqual([
      ['hud', 12],
      ['field', null],
    ]);
    expect(scene.bands[1]?.items.map((i) => i.kind)).toEqual(['playfield', 'actor']);
  });

  it('reads every playfield attribute regardless of order', () => {
    const src =
      `${header}scene s:\n  background sky\n\n  band f:\n` +
      '    playfield border color walls, mode reflect, thickness 8\n';
    const scene = parse(src, 't.p1').decls.find((d) => d.kind === 'scene');
    const pf = scene?.kind === 'scene' ? scene.bands[0]?.items[0] : undefined;
    expect(pf?.kind === 'playfield' && [pf.thickness, pf.mode, pf.color]).toEqual([
      8,
      'reflect',
      'walls',
    ]);
  });

  it('rejects a repeated attribute rather than silently taking the last', () => {
    const src =
      `${header}scene s:\n  background sky\n\n  band f:\n` +
      '    playfield border thickness 8, thickness 4, mode reflect, color walls\n';
    expect(() => parse(src, 't.p1')).toThrow(/E110/);
  });

  it('parses an actor without a controller', () => {
    const src = `${header}scene s:\n  background sky\n\n  band f:\n    actor rock uses r at (1, 2) color c\n`;
    const scene = parse(src, 't.p1').decls.find((d) => d.kind === 'scene');
    const actor = scene?.kind === 'scene' ? scene.bands[0]?.items[0] : undefined;
    expect(actor?.kind === 'actor' && actor.controls).toBeNull();
  });

  it('parses rules', () => {
    const src =
      `${header}every frame:\n  tank0 moves with joystick1 speed 1 within field\n\n` +
      'when tank0 hits tank1:\n  score p0 += 1\n';
    const kinds = parse(src, 't.p1').decls.map((d) => d.kind);
    expect(kinds).toContain('everyFrame');
    expect(kinds).toContain('whenHits');
  });

  it('parses a move statement into its parts', () => {
    const src = `${header}every frame:\n  tank0 moves with joystick1 speed 2 within field\n`;
    const rule = parse(src, 't.p1').decls.find((d) => d.kind === 'everyFrame');
    const stmt = rule?.kind === 'everyFrame' ? rule.body[0] : undefined;
    expect(stmt?.kind === 'move' && [stmt.actor, stmt.control, stmt.within]).toEqual([
      'tank0',
      'joystick1',
      'field',
    ]);
  });

  it('attaches leading comments to the declaration below them', () => {
    const src = `# first line\n# second line\ngame "T"\ntarget ntsc\ncartridge 4k\n`;
    const game = parse(src, 't.p1').decls[0];
    expect(game?.leading).toEqual(['first line', 'second line']);
  });

  it('keeps comments that follow the last declaration', () => {
    expect(parse(`${header}# afterword\n`, 't.p1').trailing).toEqual(['afterword']);
  });

  it('points a diagnostic at the offending token', () => {
    try {
      parse(`${header}cartridge\n`, 't.p1');
      throw new Error('should have thrown');
    } catch (error) {
      const diagnostics = (error as { diagnostics?: { span: { line: number } }[] }).diagnostics;
      expect(diagnostics?.[0]?.span.line).toBe(4);
    }
  });

  it('reports more than one error in a single run', () => {
    try {
      parse('game\ntarget\n', 't.p1');
      throw new Error('should have thrown');
    } catch (error) {
      const diagnostics = (error as { diagnostics?: unknown[] }).diagnostics ?? [];
      expect(diagnostics.length).toBeGreaterThan(1);
    }
  });
});
