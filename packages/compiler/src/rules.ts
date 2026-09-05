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
import type { MovementBounds } from '@player1dsl/runtime';
import type { MoveRule } from './ir.ts';

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
