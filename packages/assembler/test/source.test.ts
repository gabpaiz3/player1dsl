import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, assembleSource } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const reference = `${root}examples/tank-arena/reference/tank-arena.asm`;
const includeDirs = [`${root}kernels/include`];

describe('assembleSource', () => {
  // The point of the refactor, asserted rather than assumed: reading a file and
  // being handed its contents must reach the same 4096 bytes. Anything else
  // means the compiler's ROM and the reference ROM are not comparable, which is
  // the whole basis of increment 5b's golden test.
  it('produces the same bytes as assembling the file', () => {
    const fromFile = assemble(reference, { includeDirs });
    const fromText = assembleSource(readFileSync(reference, 'utf8'), reference, { includeDirs });

    expect(fromText.origin).toBe(fromFile.origin);
    expect([...fromText.rom]).toEqual([...fromFile.rom]);
  });

  it('resolves include relative to the name it is given', () => {
    // vcs.h is found through includeDirs here, but a source naming a sibling
    // file has to resolve against `name`'s directory -- which is the only
    // reason assembleSource takes a name at all.
    const { symbols } = assembleSource(
      '    processor 6502\n    include "vcs.h"\n    org $F000\n    lda COLUBK\n',
      reference,
      { includeDirs },
    );
    expect(symbols.get('COLUBK')).toBe(0x09);
  });

  it('reports the supplied name in an error, so generated source is locatable', () => {
    const bad = '    processor 6502\n    org $F000\n    lda\n';
    expect(() => assembleSource(bad, 'generated/tank-arena.asm')).toThrow(
      /generated.tank-arena\.asm:3/,
    );
  });
});
