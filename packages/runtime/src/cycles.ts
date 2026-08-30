import { isMnemonic, type Mode, OPCODES } from '@player1dsl/assembler';

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

/** Modes whose indexed read can cross a page and cost one more cycle. */
const PAGE_PENALTY_MODES: ReadonlySet<Mode> = new Set<Mode>(['abx', 'aby', 'izy']);

interface Instruction {
  readonly mnemonic: string;
  readonly mode: Mode;
  /** The operand text with any `#`, index suffix or parentheses removed. */
  readonly operand: string;
}

/**
 * The addressing mode an operand's SHAPE implies.
 *
 * Shape, not value: there is no symbol table here, and asking for one would make
 * the cost function depend on the assembler's placement decisions. Two rules
 * cover everything the lowerer emits, and both are chosen so a wrong guess costs
 * MORE rather than less:
 *
 *   - An unindexed symbol is zero page. Every unindexed operand in lowered code
 *     is a TIA register ($00-$3F) or an allocated variable ($80-$FF).
 *   - An indexed symbol is absolute. Indexed reads in lowered code are graphics
 *     tables, which live in ROM; charging `abs,x` where the assembler picks
 *     `zp,x` over-estimates by one, which is the safe direction for a budget.
 */
function classify(mnemonic: string, tail: string): { mode: Mode; operand: string } | null {
  const table = OPCODES[mnemonic];
  if (!table) return null;

  if (tail === '') return { mode: table.imp !== undefined ? 'imp' : 'acc', operand: '' };
  if (table.rel !== undefined) return { mode: 'rel', operand: tail };
  if (tail.startsWith('#')) return { mode: 'imm', operand: tail.slice(1) };

  const izy = /^\(([^)]+)\)\s*,\s*[yY]$/.exec(tail);
  if (izy?.[1]) return { mode: 'izy', operand: izy[1] };
  const izx = /^\(([^,]+)\s*,\s*[xX]\)$/.exec(tail);
  if (izx?.[1]) return { mode: 'izx', operand: izx[1] };
  const ind = /^\(([^)]+)\)$/.exec(tail);
  if (ind?.[1]) return { mode: 'ind', operand: ind[1] };

  const indexed = /^(.+?)\s*,\s*([xXyY])$/.exec(tail);
  if (indexed?.[1] && indexed[2]) {
    const operand = indexed[1];
    const wide = indexed[2].toLowerCase() === 'x' ? 'abx' : 'aby';
    const narrow = indexed[2].toLowerCase() === 'x' ? 'zpx' : 'zpy';
    if (table[wide] !== undefined) return { mode: wide, operand };
    if (table[narrow] !== undefined) return { mode: narrow, operand };
    return null;
  }

  if (table.zp !== undefined) return { mode: 'zp', operand: tail };
  if (table.abs !== undefined) return { mode: 'abs', operand: tail };
  return null;
}

function parseInstruction(text: string): Instruction | null {
  const parts = /^([A-Za-z]{3})(?:\s+(.*))?$/.exec(text);
  if (!parts?.[1]) return null;
  const mnemonic = parts[1].toUpperCase();
  if (!isMnemonic(mnemonic)) return null;
  const classified = classify(mnemonic, (parts[2] ?? '').trim());
  if (!classified) return null;
  return { mnemonic, mode: classified.mode, operand: classified.operand };
}

/** The opcode byte for a mnemonic and mode, or a refusal the assembler shares. */
function opcodeFor(mnemonic: string, mode: Mode): number {
  const opcode = OPCODES[mnemonic]?.[mode];
  if (opcode === undefined) {
    throw new Error(
      `cycleCost cannot cost "${mnemonic}" in ${mode} addressing: the assembler has no ` +
        'opcode for that pair and would reject it too. Failing here says so earlier.',
    );
  }
  return opcode;
}

/**
 * Worst-case CPU cycles for a fragment of emitted assembly.
 *
 * Reads the TEXT rather than modelling what the emitter meant to produce. Two
 * independent routes to one number is the only arrangement where asserting the
 * number proves anything -- the same reason `wsyncLines` re-reads the emitter's
 * output instead of asking it.
 *
 * WORST CASE throughout: a branch is charged as taken and page-crossing, and an
 * indexed read is charged as crossing. A budget that assumed the fast path would
 * pass a scene that overruns on the slow one.
 */
export function cycleCost(lines: readonly string[]): number {
  let total = 0;
  const labels = new Set<string>();

  for (const raw of lines) {
    const text = raw.split(';')[0]?.trim() ?? '';
    if (text === '') continue;

    const parsed = parseInstruction(text);

    // A bare token that is not a mnemonic is a label. Order matters: reading
    // `dex` as a label would cost the whole implied-mode instruction set at
    // zero, and would silently disarm the backward-branch check below.
    if (!parsed) {
      const label = /^([.\w]+)$/.exec(text);
      if (label?.[1]) {
        labels.add(label[1]);
        continue;
      }
      throw new Error(
        `cycleCost cannot cost "${text}". It reads the forms the rule lowerer emits ` +
          'and refuses to guess at another, because a skipped instruction is a budget ' +
          'that passes code it never counted.',
      );
    }

    const { mnemonic, mode, operand } = parsed;
    if (mode === 'rel') {
      if (labels.has(operand)) {
        throw new Error(
          `cycleCost found a backward branch to "${operand}": that is a loop, and a ` +
            'loop needs a trip count this function does not have. Lowered rule code is ' +
            'straight-line with forward branches only.',
        );
      }
      total += baseCycles(opcodeFor(mnemonic, mode)) + 2; // taken, across a page
      continue;
    }

    total += baseCycles(opcodeFor(mnemonic, mode));
    if (PAGE_PENALTY_MODES.has(mode)) total += 1;
  }

  return total;
}
