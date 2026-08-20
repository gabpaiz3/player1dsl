import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.ts';

const root = new URL('../../../', import.meta.url);
const p1Path = fileURLToPath(new URL('examples/tank-arena/tank-arena.p1', root));
const asmPath = fileURLToPath(new URL('examples/tank-arena/reference/tank-arena.asm', root));

const program = () => parse(readFileSync(p1Path, 'utf8'), 'tank-arena.p1');

/** TankSprite's bytes, read out of the reference kernel rather than retyped. */
function referenceSpriteRows(): number[] {
  // Anchored to the LABEL DEFINITION at column 0. The kernel also reads the
  // table via `lda TankSprite,y`, and a plain split on the name finds that
  // reference first and returns nothing.
  const lines = readFileSync(asmPath, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^TankSprite\b/.test(l));
  if (start < 0) throw new Error('TankSprite label not found in the reference kernel');

  const rows: number[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /\.byte\s+%([01]{8})/.exec(line);
    if (!match) break;
    rows.push(Number.parseInt(match[1] as string, 2));
  }
  return rows;
}

describe('tank-arena.p1', () => {
  it('parses', () => {
    expect(program().decls.length).toBeGreaterThan(0);
  });

  it('declares the values the reference kernel starts from', () => {
    const scene = program().decls.find((d) => d.kind === 'scene');
    if (scene?.kind !== 'scene') throw new Error('no scene');

    const items = scene.bands.flatMap((b) => b.items);
    expect(items.filter((i) => i.kind === 'actor').map((a) => [a.name, a.x, a.y])).toEqual([
      ['tank0', 40, 120],
      ['tank1', 110, 60],
    ]);
    expect(items.filter((i) => i.kind === 'score').map((s) => [s.name, s.x, s.start])).toEqual([
      ['p0', 60, 3],
      ['p1', 92, 5],
    ]);
  });

  it('gives the HUD an explicit height and lets the field take the remainder', () => {
    const scene = program().decls.find((d) => d.kind === 'scene');
    if (scene?.kind !== 'scene') throw new Error('no scene');
    expect(scene.bands.map((b) => [b.name, b.height])).toEqual([
      ['hud', 12],
      ['field', null],
    ]);
  });

  it('has a tank sprite whose rows match the reference kernel byte for byte', () => {
    // Cross-checked mechanically. Transcribing eight bytes of pixel art by eye is
    // exactly the kind of step that looks obviously right and is not.
    const sprite = program().decls.find((d) => d.kind === 'sprite');
    if (sprite?.kind !== 'sprite') throw new Error('no sprite');
    const reference = referenceSpriteRows();
    expect(reference).toHaveLength(8);
    expect(sprite.rows).toEqual(reference);
  });

  it('states no scanline counts, timer values, or register names', () => {
    // The whole point of the file. If any of these appear, the compiler is being
    // told an answer it is supposed to derive.
    const source = readFileSync(p1Path, 'utf8');
    const code = source
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    for (const forbidden of [
      'scanline',
      'TIM64T',
      'WSYNC',
      'GRP0',
      'RESP',
      'HMOVE',
      '158',
      '192',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('keeps the header comment', () => {
    expect(program().decls[0]?.leading[0]).toContain('the first Player1DSL program');
  });
});
