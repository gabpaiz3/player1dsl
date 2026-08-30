/**
 * Base cycle counts for the 6502, indexed by opcode byte.
 *
 * Written independently of `packages/emulator/src/cpu.ts` and held to it by
 * `cycles.test.ts`. Copying that table would make the test assert that a copy is
 * a copy; two people writing the same table from the hardware reference is the
 * only arrangement where agreement means anything.
 *
 * These are BASE counts. Page-crossing indexed reads and taken branches add
 * penalties, which `cycleCost` applies at the call site because they depend on
 * addresses the assembler assigns.
 *
 * A zero is an UNDOCUMENTED opcode. The assembler emits none of them, so a zero
 * is unreachable rather than free -- `opcodeFor` refuses any mnemonic/mode pair
 * the assembler would refuse, which is what keeps a zero from being spent.
 */
// biome-ignore format: sixteen opcodes per row is what makes this table
// auditable against a 6502 reference. Reflowed, it cannot be read against
// anything, and an unreadable table written independently is not independent.
export const BASE_CYCLES: readonly number[] = [
  /* 0x00 */ 7, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 0, 4, 6, 0,
  /* 0x10 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  /* 0x20 */ 6, 6, 0, 0, 3, 3, 5, 0, 4, 2, 2, 0, 4, 4, 6, 0,
  /* 0x30 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  /* 0x40 */ 6, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 3, 4, 6, 0,
  /* 0x50 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  /* 0x60 */ 6, 6, 0, 0, 0, 3, 5, 0, 4, 2, 2, 0, 5, 4, 6, 0,
  /* 0x70 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  /* 0x80 */ 0, 6, 0, 0, 3, 3, 3, 0, 2, 0, 2, 0, 4, 4, 4, 0,
  /* 0x90 */ 2, 6, 0, 0, 4, 4, 4, 0, 2, 5, 2, 0, 0, 5, 0, 0,
  /* 0xA0 */ 2, 6, 2, 0, 3, 3, 3, 0, 2, 2, 2, 0, 4, 4, 4, 0,
  /* 0xB0 */ 2, 5, 0, 0, 4, 4, 4, 0, 2, 4, 2, 0, 4, 4, 4, 0,
  /* 0xC0 */ 2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0,
  /* 0xD0 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  /* 0xE0 */ 2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0,
  /* 0xF0 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
];

export function baseCycles(opcode: number): number {
  return BASE_CYCLES[opcode & 0xff] ?? 0;
}
