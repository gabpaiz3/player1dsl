import { OPCODES } from '@player1dsl/assembler';
import {
  BASE_CYCLES as EMULATOR_CYCLES,
  CPU_CYCLES_PER_SCANLINE as EMULATOR_CYCLES_PER_SCANLINE,
} from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import {
  BASE_CYCLES,
  baseCycles,
  CPU_CYCLES_PER_SCANLINE,
  cycleCost,
  fragmentCosts,
} from '../src/index.ts';

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

  it('agrees with the CPU about how long a scanline is', () => {
    expect(CPU_CYCLES_PER_SCANLINE).toBe(EMULATOR_CYCLES_PER_SCANLINE);
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

describe('cycleCost', () => {
  it('adds up a straight run of instructions', () => {
    // lda #  2, sta zp 3, inc zp 5  =  10, once the caller says tank0_x is
    // zero page. The allocator knows; this function cannot.
    const zeroPage = new Set(['tank0_x']);
    expect(cycleCost(['    lda #$08', '    sta tank0_x', '    inc tank0_x'], { zeroPage })).toBe(
      10,
    );
  });

  /**
   * An unnamed symbol is ABSOLUTE, which costs one more than zero page.
   *
   * This defaulted the other way until movement lowering broke it on its first
   * line: `lda SWCHA` reads $0282 and was being charged three cycles instead of
   * four, four times per rule. A budget survives over-charging; it does not
   * survive under-charging.
   */
  it('charges an unnamed symbol as absolute rather than assuming zero page', () => {
    expect(cycleCost(['    sta tank0_x', '    inc tank0_x'])).toBe(4 + 6);
  });

  it('reads a hex literal width rather than needing to be told', () => {
    expect(cycleCost(['    sta $80'])).toBe(3);
    expect(cycleCost(['    sta $0282'])).toBe(4);
  });

  it('ignores labels, comments and blank lines', () => {
    expect(cycleCost(['; a comment', '', '.label', '    lda #$08  ; trailing'])).toBe(2);
  });

  // Worst case, not actual: a branch that is taken costs 3, and 4 if it crosses
  // a page. The budget has to hold for the slowest path, so the cost function
  // charges the slowest path.
  it('charges a branch its taken-and-page-crossing cost', () => {
    expect(cycleCost(['    bne .skip'])).toBe(4);
  });

  it('charges an indexed read its page-crossing penalty', () => {
    // lda abs,y is 4 base, 5 across a page.
    expect(cycleCost(['    lda TankSprite,y'])).toBe(5);
  });

  // THE known-positive. A cost function that silently skipped what it could not
  // parse would report a plausible number for code it had not costed -- the
  // "detector that cannot fail" defect, in the one place a wrong number buys a
  // frame that is too long.
  it('throws on an instruction it cannot cost, rather than skipping it', () => {
    expect(() => cycleCost(['    frobnicate #$08'])).toThrow(/frobnicate/);
  });

  // Lowered rule code is straight-line with forward branches. A backward branch
  // is a loop, and a loop needs a trip count nothing here has.
  it('throws on a backward branch, because a loop has no worst case here', () => {
    expect(() => cycleCost(['.loop', '    dex', '    bne .loop'])).toThrow(/loop/i);
  });

  // A mnemonic on its own line is an instruction, not a label. Reading it as a
  // label would cost the whole implied-mode instruction set at zero -- and the
  // backward-branch check above would stop firing, because the loop's body would
  // register as its own label.
  it('costs an implied-mode instruction rather than reading it as a label', () => {
    expect(cycleCost(['    dex', '    sec', '    rts'])).toBe(2 + 2 + 6);
  });

  it('refuses a mnemonic that has no form for the operand it was given', () => {
    expect(() => cycleCost(['    inx #$04'])).toThrow(/inx/i);
  });
});

/**
 * The primitive E706 is built on.
 *
 * Costs are worst case, like `cycleCost`'s, because the question is whether a
 * fragment CAN overrun a line and not whether it usually does.
 */
describe('fragmentCosts', () => {
  const WSYNC = '    sta WSYNC';

  it('splits on WSYNC and costs each fragment on its own', () => {
    const costs = fragmentCosts(['    lda #1', WSYNC, '    lda #2', '    lda #3', WSYNC]);
    expect(costs.fragments.map((f) => f.cycles)).toEqual([2 + 3, 2 + 2 + 3]);
    expect(costs.lines).toBe(2);
  });

  // The lowerer writes `sta WSYNC ; one line per direction`. Matching the raw
  // text would miss it and merge two fragments into one, hiding an overrun.
  it('sees a WSYNC that carries a trailing comment', () => {
    expect(fragmentCosts([`${WSYNC}              ; ends the line`]).fragments).toHaveLength(1);
  });

  /**
   * Trailing code with no WSYNC is reported, not rounded into a line.
   *
   * It spills onto whatever line the NEXT block begins, which this function
   * cannot see. A caller that ignored it would be assuming a zero.
   */
  it('reports trailing cycles separately rather than charging them a line', () => {
    const costs = fragmentCosts([WSYNC, '    lda #1', '    lda #2']);
    expect([costs.fragments.length, costs.lines, costs.remainder]).toEqual([1, 1, 4]);
  });

  it('counts a fragment past one scanline as more than one line', () => {
    const long = [...Array.from({ length: 40 }, () => '    lda #1'), WSYNC];
    expect(fragmentCosts(long).fragments[0]).toEqual({ cycles: 83, lines: 2 });
  });

  it('is empty for code with no WSYNC at all', () => {
    expect(fragmentCosts([]).lines).toBe(0);
    expect(fragmentCosts(['    lda #1']).fragments).toEqual([]);
  });
});
