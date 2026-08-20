import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, parse } from '../src/index.ts';

const path = fileURLToPath(new URL('../../../examples/tank-arena/tank-arena.p1', import.meta.url));
const source = () => readFileSync(path, 'utf8');
const round = (src: string) => format(parse(src, 't.p1'));

describe('formatter', () => {
  it('is idempotent', () => {
    const once = round(source());
    expect(round(once)).toBe(once);
  });

  it('reproduces the committed file byte for byte', () => {
    // If this fails, either the file is not canonical or the formatter is wrong.
    // Decide which before changing either -- reformatting the file to match a
    // buggy formatter hides the bug.
    expect(round(source())).toBe(source());
  });

  it("preserves the author's number base", () => {
    const src = 'game "T"\ntarget ntsc\ncartridge 4k\n\npalette p:\n  a = $0E\n  b = 12\n';
    const out = round(src);
    expect(out).toContain('a = $0E');
    expect(out).toContain('b = 12');
  });

  it('keeps comments, including ones between sprite rows', () => {
    const src =
      'game "T"\ntarget ntsc\ncartridge 4k\n\nsprite s 8x2:\n  # top\n  X.......\n  # bottom\n  ......XX\n';
    const out = round(src);
    expect(out).toContain('# top');
    expect(out).toContain('# bottom');
  });

  it('normalises ragged indentation and spacing', () => {
    const messy = 'game "T"\ntarget ntsc\ncartridge 4k\n\npalette p:\n      a   =   $0E\n';
    expect(round(messy)).toContain('  a = $0E');
  });

  it('round-trips a file with no comments at all', () => {
    const src = 'game "T"\ntarget ntsc\ncartridge 4k\n';
    expect(round(src)).toBe(src);
  });
});
