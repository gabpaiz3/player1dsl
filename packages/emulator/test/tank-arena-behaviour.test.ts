import { describe, expect, it } from 'vitest';
import { Machine, SWCHA_IDLE } from '../src/index.ts';
import { romFor } from './support/roms.ts';

const J0_LEFT = 0x40;
const J0_UP = 0x10;

function settled(): Machine {
  const machine = new Machine(romFor('tank-arena'));
  machine.runFrame();
  machine.runFrame();
  return machine;
}

/**
 * Tank 0's horizontal position, read the only way the machine exposes it: the
 * HMP0 fine-adjust value and the colour clock at which RESP0 was strobed.
 *
 * Read through the trace rather than through RAM on purpose. The emulator has
 * no RAM inspection API, and adding one to test game logic would verify through
 * a back door the compiler will never use.
 */
function tank0Position(machine: Machine, swcha: number): string {
  const frame = machine.runFrame({ swcha, trace: true });
  const writes = frame.writes ?? [];
  const resp0 = writes.filter((w) => w.register === 0x10).at(-1);
  const hmp0 = writes.filter((w) => w.register === 0x20).at(-1);
  return `${resp0?.clock ?? -1}:${hmp0?.value ?? -1}`;
}

describe('tank-arena movement bounds', () => {
  it('moves the tank at all, so the clamp test below is not vacuous', () => {
    const machine = settled();
    const start = tank0Position(machine, SWCHA_IDLE);
    let moved = start;
    for (let i = 0; i < 5; i += 1) moved = tank0Position(machine, SWCHA_IDLE & ~J0_LEFT);
    expect(moved).not.toBe(start);
  });

  /**
   * X_MIN is 8 and the tank starts at 40, so 32 frames of held left reach the
   * bound. Ten more must change nothing -- an unclamped position would keep
   * decrementing and wrap through zero.
   */
  it('clamps tank 0 at the left wall instead of wrapping past it', () => {
    const machine = settled();
    const held = SWCHA_IDLE & ~J0_LEFT;

    let position = '';
    for (let i = 0; i < 40; i += 1) position = tank0Position(machine, held);

    const atBound = position;
    const after: string[] = [];
    for (let i = 0; i < 10; i += 1) after.push(tank0Position(machine, held));

    expect(new Set(after)).toEqual(new Set([atBound]));
  });

  /**
   * MEASURED, and it contradicted the prediction: the kernel's bounds are
   * ASYMMETRIC. A lower bound rests one past its constant; an upper bound rests
   * exactly on it.
   *
   *   lower: `cpx #X_MIN / bcc skip`  -- skips only when ALREADY below X_MIN,
   *          so x = 8 still decrements and the tank comes to rest at 7.
   *   upper: `cpx #Y_MAX / bcs skip`  -- skips when at or above Y_MAX, so the
   *          tank comes to rest at exactly 155.
   *
   * This matters for step 3 rather than being trivia. `within bounds` in the
   * .p1 has to lower to this exact asymmetry, because a symmetric clamp puts
   * the tank one pixel away and every later RESPx/HMPx write in the trace
   * diverges. Pinned here so that if it changes, someone has to look at why.
   *
   * Read from RIOT RAM rather than through the trace, because the point of this
   * test is the exact constant rather than the rendered result.
   */
  it('rests at X_MIN - 1 on the lower bound but exactly Y_MAX on the upper', () => {
    const left = settled();
    for (let i = 0; i < 60; i += 1) left.runFrame({ swcha: SWCHA_IDLE & ~J0_LEFT });
    expect(left.riot.ram[0]).toBe(7); // tank0X at $80; X_MIN is 8

    const up = settled();
    for (let i = 0; i < 60; i += 1) up.runFrame({ swcha: SWCHA_IDLE & ~J0_UP });
    expect(up.riot.ram[1]).toBe(155); // tank0Y at $81; Y_MAX is 155
  });
});
