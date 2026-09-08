import { isMnemonic, type Mode, OPCODES } from '@player1dsl/assembler';

import { TIA_READ_REGISTERS, TIA_REGISTERS } from './registers.ts';

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

/**
 * CPU cycles in one scanline: 228 colour clocks at three per cycle.
 *
 * The runtime's own copy, because `packages/runtime` must not import the
 * emulator in `src` -- a cost model taking its numbers from its own checker
 * could be wrong in both places and pass. `cycles.test.ts` holds it to the
 * emulator's.
 */
export const CPU_CYCLES_PER_SCANLINE = 76;

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
 * the cost function depend on the assembler's placement decisions. Two rules,
 * and both now cost MORE rather than less when they guess wrong:
 *
 *   - An indexed symbol is absolute. Indexed reads in lowered code are graphics
 *     tables, which live in ROM. Where the assembler picks `zp,x` instead, this
 *     over-estimates by one -- the safe direction for a budget.
 *   - An unindexed symbol is absolute UNLESS the caller names it as zero page.
 *     A hex literal is classified by its own width.
 *
 * The second rule used to assume the opposite -- that an unindexed symbol was
 * zero page, because TIA registers are $00-$3F and allocated variables are
 * $80-$FF. Movement lowering broke it on its first line: `lda SWCHA` reads
 * $0282, which is absolute, and the cost model was charging it three cycles
 * instead of four, four times per movement rule. Defaulting to absolute makes a
 * wrong guess expensive rather than cheap, which is the only direction a budget
 * can survive.
 */
function classify(
  mnemonic: string,
  tail: string,
  zeroPage: ReadonlySet<string>,
): { mode: Mode; operand: string } | null {
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

  // Zero page when the caller says so, when a hex literal says so itself, or
  // when it is a TIA register -- those are $00-$3F, which the runtime already
  // knows and the caller should not have to repeat. RIOT registers are NOT:
  // SWCHA is $0282, and charging it as zero page is the under-count that
  // movement lowering caught.
  const literal = /^\$([0-9a-fA-F]+)$/.exec(tail);
  const narrow =
    zeroPage.has(tail) ||
    tail in TIA_REGISTERS ||
    tail in TIA_READ_REGISTERS ||
    (literal?.[1] !== undefined && literal[1].length <= 2);
  if (narrow && table.zp !== undefined) return { mode: 'zp', operand: tail };
  if (table.abs !== undefined) return { mode: 'abs', operand: tail };
  if (table.zp !== undefined) return { mode: 'zp', operand: tail };
  return null;
}

function parseInstruction(text: string, zeroPage: ReadonlySet<string>): Instruction | null {
  const parts = /^([A-Za-z]{3})(?:\s+(.*))?$/.exec(text);
  if (!parts?.[1]) return null;
  const mnemonic = parts[1].toUpperCase();
  if (!isMnemonic(mnemonic)) return null;
  const classified = classify(mnemonic, (parts[2] ?? '').trim(), zeroPage);
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
export interface CycleCostOptions {
  /**
   * Symbols the caller knows are in zero page.
   *
   * The compiler's RAM allocator assigns them, and the runtime's register table
   * names the TIA's. Anything absent is charged as absolute.
   */
  readonly zeroPage?: ReadonlySet<string>;
}

export function cycleCost(lines: readonly string[], options: CycleCostOptions = {}): number {
  const zeroPage = options.zeroPage ?? new Set<string>();
  let total = 0;
  const labels = new Set<string>();

  for (const raw of lines) {
    const text = raw.split(';')[0]?.trim() ?? '';
    if (text === '') continue;

    const parsed = parseInstruction(text, zeroPage);

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

/**
 * One WSYNC-delimited fragment of emitted code, and what it really costs.
 *
 * `sta WSYNC` halts the CPU until the start of the next scanline, so a
 * fragment ending on one costs a whole number of lines whichever branch the
 * code took -- but the number is `ceil(cycles / 76)`, not 1. A fragment of 84
 * cycles spends two lines, and code that charged it one produced a frame a
 * line longer than the ledger said.
 */
export interface Fragment {
  /** Worst-case cycles from the start of the line through this fragment's WSYNC. */
  readonly cycles: number;
  /** Whole scanlines consumed: `ceil(cycles / 76)`. */
  readonly lines: number;
}

export interface FragmentCosts {
  readonly fragments: readonly Fragment[];
  /** Scanlines every WSYNC-terminated fragment consumes together. */
  readonly lines: number;
  /**
   * Cycles of trailing code with no WSYNC after it.
   *
   * NOT a line, and deliberately not rounded into one: it spills onto whatever
   * line the NEXT block begins, and this function cannot see that block. A
   * caller with a non-zero remainder owns the question of where it lands; one
   * that silently ignored it would be assuming a zero, which is the failure
   * this whole module exists to make impossible.
   */
  readonly remainder: number;
}

/**
 * Split emitted assembly on `sta WSYNC` and cost each fragment separately.
 *
 * THE INVARIANT THIS EXISTS FOR. Ending every rule fragment on a WSYNC makes
 * its cost independent of which BRANCH the code took -- that was the
 * 2026-09-04 fix. It does not make the cost one LINE, and the two were
 * conflated: three `score += 1` actions in one collision rule cost 84 cycles,
 * were charged a single line, and produced a 263-line frame on exactly the
 * frames where the tanks touched.
 *
 * Reads the text, like `cycleCost`, and shares its worst-case discipline.
 */
export function fragmentCosts(
  lines: readonly string[],
  options: CycleCostOptions = {},
): FragmentCosts {
  const fragments: Fragment[] = [];
  let current: string[] = [];

  for (const raw of lines) {
    current.push(raw);
    // The comment is stripped before matching: `sta WSYNC ; one line per
    // direction` is the form the lowerer emits, and matching the raw line
    // would miss it and merge two fragments into one.
    if ((raw.split(';')[0]?.trim() ?? '') === 'sta WSYNC') {
      const cycles = cycleCost(current, options);
      fragments.push({ cycles, lines: Math.ceil(cycles / CPU_CYCLES_PER_SCANLINE) });
      current = [];
    }
  }

  return {
    fragments,
    lines: fragments.reduce((total, f) => total + f.lines, 0),
    remainder: cycleCost(current, options),
  };
}
