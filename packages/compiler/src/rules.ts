/**
 * Game IR rules to 6502.
 *
 * No operation IR between them: two rule forms do not justify one, and the
 * moment a third arrives that starts repeating itself, that is when to add one.
 *
 * Every fragment here is straight-line with FORWARD branches only, which is
 * what lets `cycleCost` give it a worst case. A rule form that needed a loop
 * would need a trip count nothing here has, and `cycleCost` refuses rather than
 * guessing.
 */

import { type Diagnostic, P1Error } from '@player1dsl/parser';
import type { CollisionLatch, MovementBounds } from '@player1dsl/runtime';
import type { AddRule, MoveRule, WhenHitsIr } from './ir.ts';

/**
 * SWCHA bits, active LOW: a 0 bit means pressed.
 *
 * The HIGH nibble is the left controller and the low nibble the right, which is
 * why joystick2's masks are joystick1's shifted down by four.
 */
const JOYSTICK_MASKS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  joystick1: { up: 0x10, down: 0x20, left: 0x40, right: 0x80 },
  joystick2: { up: 0x01, down: 0x02, left: 0x04, right: 0x08 },
};

/** No rule carries a span: the IR resolved them away. */
const NOWHERE = { file: '<rules>', offset: 0, length: 0, line: 1, column: 1 };

function hex(value: number): string {
  return `$${value.toString(16).padStart(2, '0').toUpperCase()}`;
}

/**
 * One direction: read the stick, compare against the bound, step the byte.
 *
 * `bound` is the CONSTANT the compare uses, not the resting position, and the
 * two differ on a lower bound. See `lowerMove`.
 */
function direction(
  mask: number,
  variable: string,
  bound: number,
  branch: 'bcc' | 'bcs',
  step: 'inc' | 'dec',
  label: string,
): string[] {
  return [
    '    lda SWCHA',
    `    and #${hex(mask)}`,
    `    bne ${label}`,
    `    ldx ${variable}`,
    `    cpx #${bound}`,
    `    ${branch} ${label}`,
    `    ${step} ${variable}`,
    label,
    // ONE LINE PER DIRECTION, whichever branch was taken.
    //
    // Rule code has no WSYNC of its own, so its cycles advance the beam by an
    // amount that depends on which way the joystick was pushed -- and a frame
    // whose length depends on the input is exactly what the ledger exists to
    // prevent. Ending each direction on a WSYNC makes the cost a whole line
    // regardless of the branch, which the ledger can charge and the frame
    // driver can count.
    //
    // A direction is 24 worst-case cycles, comfortably inside a line's 76.
    '    sta WSYNC',
  ];
}

/**
 * A movement rule.
 *
 * THE ASYMMETRY. `cpx #C / bcc skip / dec` skips only when the value is ALREADY
 * below C, so it decrements off C and rests at C - 1; a lower bound therefore
 * emits `xMin + 1`. `cpx #C / bcs skip / inc` skips at or above C, so it rests
 * exactly on C. `movementBounds` says where the sprite may REST; turning that
 * into the constant that produces it is this function's job, and keeping it
 * here rather than in the bounds is why those four numbers mean one thing
 * instead of two.
 *
 * The Y sense is inverted: the field loop counts DOWN, so a larger y is higher
 * up the screen and joystick up INCREMENTS it.
 */
/**
 * Scanlines one movement rule spends: one per direction.
 *
 * Charged by the caller into `setupLines`, because the frame driver counts
 * WSYNCs and these are four of them.
 */
export const MOVE_RULE_LINES = 4;

export function lowerMove(rule: MoveRule, bounds: MovementBounds, label: string): string[] {
  if (rule.speed !== 1) {
    throw new P1Error([
      {
        code: 'E701',
        message: `"${rule.actor}" moves at speed ${rule.speed}, which is not lowered yet`,
        span: NOWHERE,
        hint:
          'a step of more than one needs a clamp that cannot overshoot the bound, and ' +
          'nothing has measured what that costs. Speed 1 is what the language ships.',
      } satisfies Diagnostic,
    ]);
  }

  const masks = JOYSTICK_MASKS[rule.control];
  if (!masks) {
    throw new P1Error([
      {
        code: 'E702',
        message: `"${rule.actor}" is controlled by "${rule.control}", which is not a joystick`,
        span: NOWHERE,
        hint: `known controls: ${Object.keys(JOYSTICK_MASKS).join(', ')}`,
      } satisfies Diagnostic,
    ]);
  }

  const x = `${rule.actor}_x`;
  const y = `${rule.actor}_y`;
  return [
    `; ${rule.actor} moves with ${rule.control} within ${rule.within}`,
    ...direction(masks.left ?? 0, x, bounds.xMin + 1, 'bcc', 'dec', `${label}Left`),
    ...direction(masks.right ?? 0, x, bounds.xMax, 'bcs', 'inc', `${label}Right`),
    ...direction(masks.up ?? 0, y, bounds.yMax, 'bcs', 'inc', `${label}Up`),
    ...direction(masks.down ?? 0, y, bounds.yMin + 1, 'bcc', 'dec', `${label}Down`),
  ];
}

/**
 * `score += n`, with a single-digit wrap.
 *
 * `clc` is not decoration: the carry survives whatever ran before this, and a
 * stale one adds an extra point on the frame after any compare that set it.
 *
 * The wrap branches FORWARD to a label. `bcc *+4` is what a human writes and is
 * two bytes shorter, but neither our assembler nor `cycleCost` parses a
 * PC-relative operand -- so the budget gate could not see the instruction it
 * skipped.
 */
export function lowerAdd(rule: AddRule, wrapAt: number, label: string): string[] {
  return [
    `    lda ${rule.variable}`,
    '    clc',
    `    adc #${rule.amount}`,
    `    cmp #${wrapAt}`,
    `    bcc ${label}Ok`,
    '    lda #0                  ; a single digit wraps 9 -> 0',
    `${label}Ok`,
    `    sta ${rule.variable}`,
  ];
}

/**
 * `when A hits B`, with the debounce the hardware does not provide.
 *
 * The latches are LEVEL: they stay set for every frame the objects overlap, so
 * a rule that scored on the latch alone would score once per frame of contact.
 * The flag is set on the first frame and cleared when contact ends, which makes
 * "once per contact" -- the language's promise -- the compiler's obligation.
 *
 * `bit` copies D7 into N and D6 into V, so a D7 latch tests with `bpl` and a D6
 * latch with `bvc`. A lowerer that always used `bpl` would read the wrong half
 * of CXPPMM for a missile pair and score on somebody else's collision.
 *
 * CXCLR is NOT strobed here. It clears every latch at once, so it belongs to
 * the frame rather than to any one rule, and `build.ts` emits it after the last
 * collision rule has read what it needs.
 */
export function lowerCollision(
  rule: WhenHitsIr,
  latch: CollisionLatch,
  label: string,
  actions: readonly string[],
): string[] {
  return [
    `; when ${rule.a} hits ${rule.b}`,
    `    bit ${latch.register}`,
    latch.bit === 0x80 ? `    bpl ${label}NoContact` : `    bvc ${label}NoContact`,
    `    lda ${rule.debounce}`,
    `    bne ${label}Done        ; already scored this contact`,
    ...actions,
    '    lda #1',
    `    sta ${rule.debounce}`,
    `    jmp ${label}Done`,
    `${label}NoContact`,
    '    lda #0',
    `    sta ${rule.debounce}`,
    `${label}Done`,
  ];
}

/**
 * Scanlines one collision rule spends, in overscan.
 *
 * The WSYNC is NOT emitted by `lowerCollision`: `CXCLR` has to be strobed
 * before it, so the caller composes body, then CXCLR after the last rule, then
 * the WSYNC. Emitting the WSYNC here put CXCLR a scanline later than the
 * reference kernel strobes it, which was the only divergence in all 90 golden
 * frames.
 */
export const COLLISION_RULE_LINES = 1;
