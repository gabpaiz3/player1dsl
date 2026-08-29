import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGolden, TIA_WRITE_NAMES } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { DIGIT_FONT, DIGIT_HEIGHT } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const golden = parseGolden(readFileSync(`${root}tests/goldens/tank-arena.trace`, 'utf8'));

/** The value written to `register` on each of `lines`, in order. */
function traced(register: number, lines: readonly number[]): number[] {
  const frame = golden[0];
  if (!frame) throw new Error('the golden has no frame 0; this test proves nothing');
  return lines.map((line) => {
    const record = frame.records.find(
      (r) => r.register === register && line >= r.line && line <= r.endLine,
    );
    if (!record) {
      throw new Error(`no ${TIA_WRITE_NAMES[register]} record covers line ${line}`);
    }
    return record.value;
  });
}

/**
 * The font against the trace it has to reproduce.
 *
 * Comparing it to the reference .asm instead would only prove the copy is a
 * copy. The golden is a MEASUREMENT -- these are the bytes the reference ROM
 * actually put in GRP0 and GRP1 on the HUD lines -- so this is the assertion
 * that fails if a glyph is transcribed wrong.
 *
 * Only digits 3 and 5 appear in tank-arena, so only those two are pinned. The
 * rest are held by shape alone, and this comment says so rather than letting
 * the file read as though all ten were checked.
 */
describe('the digit font against the golden trace', () => {
  const GRP0 = 0x1b;
  const GRP1 = 0x1c;
  const GLYPH_LINES = [43, 44, 45, 46, 47, 48, 49, 50];

  it('draws score p0 with the glyph for 3', () => {
    expect(traced(GRP0, GLYPH_LINES)).toEqual([...(DIGIT_FONT[3] ?? [])]);
  });

  it('draws score p1 with the glyph for 5', () => {
    expect(traced(GRP1, GLYPH_LINES)).toEqual([...(DIGIT_FONT[5] ?? [])]);
  });

  // Proof the comparison can fail: the two digits in the scene are different,
  // so a font whose glyphs were all the same would pass the two tests above
  // only if this one also passed.
  it('gives 3 and 5 different glyphs', () => {
    expect(DIGIT_FONT[3]).not.toEqual(DIGIT_FONT[5]);
  });
});

describe('the font as a whole', () => {
  it('has ten glyphs of eight rows', () => {
    expect(DIGIT_FONT).toHaveLength(10);
    for (const [digit, glyph] of DIGIT_FONT.entries()) {
      expect([digit, glyph.length]).toEqual([digit, DIGIT_HEIGHT]);
    }
  });

  it('holds every row in one byte, because a row is one GRP write', () => {
    for (const [digit, glyph] of DIGIT_FONT.entries()) {
      for (const byte of glyph) {
        expect([digit, byte >= 0 && byte <= 0xff]).toEqual([digit, true]);
      }
    }
  });

  // Two identical glyphs is a real transcription failure and a silent one: the
  // score would render, just as the wrong digit.
  it('gives all ten digits distinct glyphs', () => {
    const seen = new Set(DIGIT_FONT.map((glyph) => glyph.join(',')));
    expect(seen.size).toBe(10);
  });
});
