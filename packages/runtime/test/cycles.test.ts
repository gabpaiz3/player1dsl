import { OPCODES } from '@player1dsl/assembler';
import { BASE_CYCLES as EMULATOR_CYCLES } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { BASE_CYCLES, baseCycles, cycleCost } from '../src/index.ts';

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

describe('cycleCost', () => {
  it('adds up a straight run of instructions', () => {
    // lda #  2, sta zp 3, inc zp 5  =  10
    expect(cycleCost(['    lda #$08', '    sta tank0_x', '    inc tank0_x'])).toBe(10);
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
