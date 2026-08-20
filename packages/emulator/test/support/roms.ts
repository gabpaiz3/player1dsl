import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble } from '../../../assembler/src/index.ts';

const root = fileURLToPath(new URL('../../../..', import.meta.url));

/** Source paths for every ROM the test suite uses. */
export const ROM_SOURCES: Readonly<Record<string, string>> = {
  'tank-arena': 'examples/tank-arena/reference/tank-arena.asm',
  'wsync-only': 'tests/fixtures/timing/wsync-only.asm',
  'timer-only': 'tests/fixtures/timing/timer-only.asm',
  'late-write': 'tests/fixtures/timing/late-write.asm',
  'golden-base': 'tests/fixtures/timing/golden-base.asm',
  'golden-late': 'tests/fixtures/timing/golden-late.asm',
};

/**
 * Assemble a ROM with OUR assembler rather than reading DASM's output.
 *
 * This keeps the test suite free of any external binary: CI needs only Node.
 * DASM remains a cross-check in the assembler's parity test, which is the one
 * place it belongs -- if our assembler is wrong, that test fails, so the
 * emulator tests are not silently validating against a shared mistake.
 */
export function romFor(name: string): Uint8Array {
  const source = ROM_SOURCES[name];
  if (!source) throw new Error(`unknown ROM "${name}"`);
  return assemble(`${root}/${source}`, { includeDirs: [`${root}/kernels/include`] }).rom;
}

/** DASM's output for a ROM, or null when DASM has not been run locally. */
export function dasmRom(name: string): Uint8Array | null {
  const path = `${root}/build/${name}.bin`;
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}
