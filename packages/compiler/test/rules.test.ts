import { cycleCost, movementBounds } from '@player1dsl/runtime';
import { describe, expect, it } from 'vitest';
import { lowerAdd, lowerCollision, lowerMove, type MoveRule } from '../src/index.ts';

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

describe('lowerAdd', () => {
  it('adds and stores', () => {
    const code = text(lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0'));
    expect(code).toContain('lda p0_score');
    expect(code).toContain('adc #1');
    expect(code).toContain('sta p0_score');
  });

  // A single digit wraps 9 -> 0. Without the wrap the glyph pointer walks off
  // the end of the font table and the HUD draws whatever follows it in ROM.
  it('wraps a single digit at ten rather than running off the font', () => {
    const code = text(lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0'));
    expect(code).toContain('cmp #10');
    expect(code).toContain('lda #0');
  });

  it('clears carry before adding, so a stale carry cannot add two', () => {
    const code = lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0');
    expect(code[code.findIndex((l) => l.includes('adc')) - 1]).toContain('clc');
  });

  // The wrap branches FORWARD to a label. `bcc *+4` would be shorter and is
  // what a human writes, but neither our assembler nor cycleCost parses a
  // PC-relative operand, so the budget gate could not see it.
  it('branches forward to a label, which cycleCost can cost', () => {
    const code = lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0');
    expect(code).toContain('.s0Ok');
    expect(() => cycleCost(code)).not.toThrow();
  });
});

describe('lowerCollision', () => {
  const RULE = {
    a: 'tank0',
    b: 'tank1',
    debounce: 'tank0_tank1_hit',
    actions: [{ kind: 'add' as const, variable: 'p0_score', amount: 1 }],
  };
  const LATCH = { register: 'CXPPMM', bit: 0x80 };
  const ACTIONS = lowerAdd({ kind: 'add', variable: 'p0_score', amount: 1 }, 10, '.s0');

  it('tests the latch the pair reports through', () => {
    expect(text(lowerCollision(RULE, LATCH, '.c0', ACTIONS))).toContain('bit CXPPMM');
  });

  /**
   * THE debounce. TIA latches are LEVEL, not edge: they stay set for every
   * frame the objects overlap. Scoring once per contact is the language's
   * promise, and the hardware does not provide it -- so the flag is set on the
   * first frame of contact and cleared only when contact ends.
   */
  it('scores only on the first frame of a contact', () => {
    const code = text(lowerCollision(RULE, LATCH, '.c0', ACTIONS));
    expect(code).toContain('lda tank0_tank1_hit');
    expect(code).toContain('bne .c0Done');
    expect(code).toContain('sta tank0_tank1_hit');
  });

  it('clears the flag when the contact ends, or it never scores twice', () => {
    const code = lowerCollision(RULE, LATCH, '.c0', ACTIONS);
    const noContact = code.findIndex((l) => l === '.c0NoContact');
    expect(noContact).toBeGreaterThan(0);
    expect(code.slice(noContact).join('\n')).toContain('lda #0');
    expect(code.slice(noContact).join('\n')).toContain('sta tank0_tank1_hit');
  });

  /**
   * `bit` copies D7 into N and D6 into V, so a D7 latch tests with `bpl` and a
   * D6 latch with `bvc`. A lowerer that always used `bpl` would read the wrong
   * half of CXPPMM for a missile pair and score on somebody else's collision.
   */
  it('branches on V rather than N for a D6 latch', () => {
    const d6 = text(lowerCollision(RULE, { register: 'CXPPMM', bit: 0x40 }, '.c0', ACTIONS));
    expect(d6).toContain('bvc .c0NoContact');
    expect(d6).not.toContain('bpl .c0NoContact');
  });

  // Straight-line with forward branches only, which is what lets cycleCost
  // give the vertical-blank budget a worst case.
  it('is costable, so the budget gate can see it', () => {
    expect(cycleCost(lowerCollision(RULE, LATCH, '.c0', ACTIONS))).toBeGreaterThan(0);
  });
});
