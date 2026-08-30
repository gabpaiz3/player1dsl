import { OPCODES } from '@player1dsl/assembler';
import { BASE_CYCLES as EMULATOR_CYCLES } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { BASE_CYCLES, baseCycles } from '../src/index.ts';

describe('the cost model and the CPU agree', () => {
  // Only opcodes the assembler can emit are compared. The emulator's table has
  // zeroes where an undocumented opcode sits, and asserting on those would be
  // asserting about instructions no generated ROM can contain.
  const emittable = new Set(Object.values(OPCODES).flatMap((modes) => Object.values(modes)));

  it('gives every emittable opcode the cycle count the CPU charges it', () => {
    for (const opcode of emittable) {
      expect([opcode.toString(16), baseCycles(opcode)]).toEqual([
        opcode.toString(16),
        EMULATOR_CYCLES[opcode],
      ]);
    }
  });

  it('covers all 256 opcode slots, so a lookup can never be undefined', () => {
    expect(BASE_CYCLES).toHaveLength(256);
  });

  // Proof the comparison can fail without editing cycles.ts: LDA immediate is 2
  // cycles and LDA absolute is 4, so a table that returned one constant is
  // caught.
  it('would catch a table that charged every instruction the same', () => {
    expect(baseCycles(0xa9)).toBe(2);
    expect(baseCycles(0xad)).toBe(4);
  });

  // The comparison above is only worth anything if it covers the instruction
  // set rather than a handful of opcodes that happen to line up.
  it('compares the whole documented instruction set, not a sample', () => {
    expect(emittable.size).toBeGreaterThan(140);
  });
});
