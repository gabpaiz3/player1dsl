import { describe, expect, it } from 'vitest';
import { Machine, SWCHA_IDLE } from '../src/index.ts';
import { romFor } from './support/roms.ts';

/** Joystick 0 direction bits in SWCHA. Active LOW: a 0 bit means pressed. */
const J0_RIGHT = 0x80;

function settled(rom: Uint8Array): Machine {
  const machine = new Machine(rom);
  machine.runFrame();
  machine.runFrame();
  return machine;
}

describe('per-frame controller injection', () => {
  it('defaults to idle when no input is supplied', () => {
    const machine = settled(romFor('tank-arena'));
    machine.runFrame();
    expect(machine.riot.swcha).toBe(SWCHA_IDLE);
  });

  it('applies swcha for the frame it is given', () => {
    const machine = settled(romFor('tank-arena'));
    machine.runFrame({ swcha: SWCHA_IDLE & ~J0_RIGHT });
    expect(machine.riot.swcha).toBe(SWCHA_IDLE & ~J0_RIGHT);
  });

  it('moves tank 0 right when right is held, and not when it is not', () => {
    // The ROM reads SWCHA in VBLANK and writes the resulting position through
    // HMP0/RESP0 at the band transition, so the trace observes the movement.
    const held = settled(romFor('tank-arena'));
    for (let i = 0; i < 8; i += 1) held.runFrame({ swcha: SWCHA_IDLE & ~J0_RIGHT });
    const heldFrame = held.runFrame({ swcha: SWCHA_IDLE & ~J0_RIGHT, trace: true });

    const idle = settled(romFor('tank-arena'));
    for (let i = 0; i < 8; i += 1) idle.runFrame();
    const idleFrame = idle.runFrame({ trace: true });

    const resp0 = (f: typeof heldFrame) =>
      (f.writes ?? []).filter((w) => w.register === 0x10).map((w) => w.clock);

    expect(resp0(heldFrame)).not.toEqual(resp0(idleFrame));
  });
});
