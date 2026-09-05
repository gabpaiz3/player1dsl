import { cycleCost, movementBounds } from '@player1dsl/runtime';
import { describe, expect, it } from 'vitest';
import { lowerMove, type MoveRule } from '../src/index.ts';

const ARENA = {
  wallPixels: 4,
  spriteWidth: 8,
  spriteHeight: 8,
  fieldFirstLine: 66,
  fieldLastLine: 223,
  counterOrigin: 225,
} as const;

const RULE: MoveRule = {
  kind: 'move',
  actor: 'tank0',
  control: 'joystick1',
  speed: 1,
  within: 'field',
};

const text = (lines: readonly string[]) => lines.join('\n');

describe('lowerMove', () => {
  it('reads the joystick and moves the actor on all four directions', () => {
    const code = text(lowerMove(RULE, movementBounds(ARENA), '.m0'));
    expect(code).toContain('lda SWCHA');
    expect(code).toContain('dec tank0_x');
    expect(code).toContain('inc tank0_x');
    expect(code).toContain('dec tank0_y');
    expect(code).toContain('inc tank0_y');
  });

  /**
   * THE assertion this task exists for. `cpx #C / bcc skip / dec` skips only
   * when ALREADY below C, so the actor decrements off C and comes to rest at
   * C - 1. To rest at xMin the constant must be xMin + 1. The upper form
   * `cpx #C / bcs skip / inc` skips at or above C, so it rests exactly on C.
   *
   * packages/emulator/test/tank-arena-behaviour.test.ts measured that asymmetry
   * on the reference kernel; this is the compiler reproducing it deliberately
   * rather than by accident.
   */
  it('emits a lower bound one above the resting position it wants', () => {
    const bounds = movementBounds(ARENA);
    const code = text(lowerMove(RULE, bounds, '.m0'));
    expect(code).toContain(`cpx #${bounds.xMin + 1}`);
    expect(code).toContain(`cpx #${bounds.yMin + 1}`);
  });

  it('emits an upper bound exactly on the resting position', () => {
    const bounds = movementBounds(ARENA);
    const code = text(lowerMove(RULE, bounds, '.m0'));
    expect(code).toContain(`cpx #${bounds.xMax}`);
    expect(code).toContain(`cpx #${bounds.yMax}`);
  });

  it('pairs each lower bound with bcc and each upper with bcs', () => {
    const bounds = movementBounds(ARENA);
    const code = lowerMove(RULE, bounds, '.m0');
    const after = (needle: string) => code[code.findIndex((l) => l.includes(needle)) + 1] ?? '';
    expect(after(`cpx #${bounds.xMin + 1}`)).toContain('bcc');
    expect(after(`cpx #${bounds.xMax}`)).toContain('bcs');
  });

  // Joystick port 2 is the LOW nibble of SWCHA. A lowerer that used port 1's
  // masks for both would move both tanks with one stick.
  it('takes the low nibble of SWCHA for joystick2', () => {
    const p2 = text(
      lowerMove({ ...RULE, actor: 'tank1', control: 'joystick2' }, movementBounds(ARENA), '.m1'),
    );
    expect(p2).toContain('and #$04'); // J1_LEFT
    expect(p2).not.toContain('and #$40'); // J0_LEFT
  });

  it('gives every branch a label unique to the rule', () => {
    const a = lowerMove(RULE, movementBounds(ARENA), '.m0').filter((l) => l.startsWith('.'));
    const b = lowerMove(RULE, movementBounds(ARENA), '.m1').filter((l) => l.startsWith('.'));
    expect(a.some((l) => b.includes(l))).toBe(false);
  });

  // Refuse rather than guess: a step of N needs clamp logic that cannot
  // overshoot, and nothing has measured what that costs.
  it('refuses a speed it cannot lower', () => {
    expect(() => lowerMove({ ...RULE, speed: 2 }, movementBounds(ARENA), '.m0')).toThrow(/E70\d/);
  });

  it('refuses a control that is not a joystick', () => {
    expect(() => lowerMove({ ...RULE, control: 'paddle1' }, movementBounds(ARENA), '.m0')).toThrow(
      /E70\d/,
    );
  });

  /**
   * The worst-case cost, pinned exactly.
   *
   * Four directions, each: `lda SWCHA` 4 (ABSOLUTE -- $0282 is not zero page,
   * and charging it as zero page is the under-count that made this assertion
   * fail first time), `and #` 2, `bne` 4 taken-and-crossing, `ldx zp` 3,
   * `cpx #` 2, the bound branch 4, and `inc`/`dec` zp 5. That is 24 a
   * direction and 96 for the rule.
   *
   * Pinned rather than bounded, because Task 9's budget gate is only as honest
   * as this number. A lowering that quietly grew would move it.
   */
  it('costs 96 worst-case cycles, which the budget gate spends', () => {
    const zeroPage = new Set(['tank0_x', 'tank0_y']);
    expect(cycleCost(lowerMove(RULE, movementBounds(ARENA), '.m0'), { zeroPage })).toBe(96);
  });
});
