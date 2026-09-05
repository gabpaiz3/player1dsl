import { RIOT as EMULATOR_RIOT, TIA_WRITE_NAMES } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import {
  ENTRIES,
  RIOT_REGISTERS,
  registerEquates,
  registerMnemonic,
  TIA_REGISTERS,
} from '../src/index.ts';

/**
 * The emitter's equates against the hardware table.
 *
 * The runtime cannot import the emulator in src -- the emulator is what the
 * emitted ROM is checked against, and a generator taking its addresses from its
 * own checker could agree with itself about a wrong number. So the addresses are
 * written independently in registers.ts and pinned here, the same arrangement
 * timing-agreement.test.ts uses for write timing classes.
 */
describe('the emitter equates and the emulator agree', () => {
  it('gives every equate the address the emulator knows it by', () => {
    for (const [name, address] of Object.entries(TIA_REGISTERS)) {
      expect([name, TIA_WRITE_NAMES[address]]).toEqual([name, name]);
    }
  });

  // Proof the comparison can fail without editing registers.ts: the same
  // assertion shape, fed an address the emulator contradicts.
  it('would catch an equate pointing at the wrong register', () => {
    expect(TIA_WRITE_NAMES[0x1b]).toBe('GRP0');
    expect(TIA_WRITE_NAMES[0x1c]).not.toBe('GRP0');
  });

  // The catalog names registers as numbers; the emitter has to turn each one
  // into `sta <name>`. A declared write with no equate would be a gap between
  // the two tables that only shows up as a missing write in a ROM.
  it('can name every register the catalog declares', () => {
    for (const entry of ENTRIES) {
      for (const write of entry.writes) {
        expect(() => registerMnemonic(write.register)).not.toThrow();
      }
    }
  });

  it('refuses to invent an operand for a register it has no equate for', () => {
    expect(TIA_WRITE_NAMES[0x15]).toBe('AUDC0'); // real register, deliberately not emitted
    expect(() => registerMnemonic(0x15)).toThrow(/no equate/);
  });
});

/**
 * The RIOT addresses, held to the emulator's.
 *
 * Written from vcs.h and checked against the chip the ROMs actually run on,
 * because getting one wrong is silent: SWCHA at $0282 is SWCHB, so a movement
 * rule reads the console switches, sees no joystick press, and the tank simply
 * never moves. That is exactly what happened, and this test is what would have
 * caught it in seconds instead of a debugging session.
 */
describe('the RIOT registers a rule can name', () => {
  it('reads joystick directions from SWCHA at $0280, not the console switches', () => {
    expect(RIOT_REGISTERS.SWCHA).toBe(0x0280);
    expect(RIOT_REGISTERS.SWCHB).toBe(0x0282);
  });

  it('agrees with the emulator about every RIOT address', () => {
    expect([RIOT_REGISTERS.SWCHA, RIOT_REGISTERS.SWCHB, RIOT_REGISTERS.INTIM]).toEqual([
      EMULATOR_RIOT.SWCHA,
      EMULATOR_RIOT.SWCHB,
      EMULATOR_RIOT.INTIM,
    ]);
  });

  it('emits an equate for each, so a lowered rule can name them', () => {
    const equates = registerEquates().join(String.fromCharCode(10));
    expect(equates).toContain('SWCHA    = $0280');
    expect(equates).toContain('CXPPMM   = $07');
  });
});
