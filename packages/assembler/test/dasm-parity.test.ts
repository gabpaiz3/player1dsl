import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assembleFile } from '../src/index.ts';

/**
 * The assembler's acceptance criterion, per docs/roadmap.md step 2: it must
 * produce THE SAME BYTES DASM produces.
 *
 * DASM stays a dev-only cross-check and never becomes a runtime or CI
 * dependency -- the .bin files it produced are committed to build/ by the
 * existing build scripts, and these tests compare against them.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));

function dasmOutput(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${root}/build/${name}.bin`));
}

function ours(source: string): Uint8Array {
  return assembleFile(`${root}/${source}`, { includeDirs: [`${root}/kernels/include`] }).rom;
}

function firstDifference(a: Uint8Array, b: Uint8Array): string | null {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      const addr = 0xf000 + i;
      return `byte ${i} ($${addr.toString(16)}): ours $${a[i]?.toString(16)} vs dasm $${b[i]?.toString(16)}`;
    }
  }
  return null;
}

describe('DASM parity', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['wsync-only', 'tests/fixtures/timing/wsync-only.asm'],
    ['timer-only', 'tests/fixtures/timing/timer-only.asm'],
    ['late-write', 'tests/fixtures/timing/late-write.asm'],
    ['tank-arena', 'examples/tank-arena/reference/tank-arena.asm'],
  ];

  for (const [name, source] of cases) {
    it(`assembles ${name} to the same 4096 bytes as DASM`, () => {
      const mine = ours(source);
      expect(mine.length).toBe(4096);
      expect(firstDifference(mine, dasmOutput(name))).toBeNull();
    });
  }
});
