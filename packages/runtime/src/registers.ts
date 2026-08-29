/**
 * The TIA registers the emitter names, and their addresses.
 *
 * This is a PARTIAL second copy of the emulator's `TIA_WRITE_NAMES`, and the
 * duplication is deliberate but not free. The runtime must not import the
 * emulator -- the emulator is the thing our output is checked against, and a
 * generator that took its register addresses from its own checker could emit
 * `sta $99` and still pass. So the addresses are written here independently,
 * and `packages/runtime/test/registers.test.ts` holds every one of them to the
 * emulator's table. Drift fails a test rather than producing a ROM that writes
 * to the wrong register.
 *
 * Only the registers the emitter actually writes are listed. A register with
 * no emitter behind it would be an equate nothing uses and a claim nothing
 * checks.
 */
export const TIA_REGISTERS: Readonly<Record<string, number>> = {
  VSYNC: 0x00,
  VBLANK: 0x01,
  WSYNC: 0x02,
  NUSIZ0: 0x04,
  NUSIZ1: 0x05,
  COLUP0: 0x06,
  COLUP1: 0x07,
  COLUPF: 0x08,
  COLUBK: 0x09,
  CTRLPF: 0x0a,
  PF0: 0x0d,
  PF1: 0x0e,
  PF2: 0x0f,
  RESP0: 0x10,
  RESP1: 0x11,
  GRP0: 0x1b,
  GRP1: 0x1c,
  HMP0: 0x20,
  HMP1: 0x21,
  HMOVE: 0x2a,
  HMCLR: 0x2b,
  CXCLR: 0x2c,
};

const NAME_BY_ADDRESS: ReadonlyMap<number, string> = new Map(
  Object.entries(TIA_REGISTERS).map(([name, address]) => [address, name]),
);

/**
 * The name to write in `sta <name>`, for a register the catalog declared.
 *
 * Throws rather than falling back to a numeric operand. A catalog entry naming
 * a register the emitter has no equate for is a gap between the two, and
 * silently emitting `sta $34` would hide it inside a ROM that assembles fine
 * and draws the wrong thing.
 */
export function registerMnemonic(address: number): string {
  const name = NAME_BY_ADDRESS.get(address);
  if (!name) {
    throw new Error(
      `no equate for TIA register $${address.toString(16).padStart(2, '0')}; ` +
        'add it to TIA_REGISTERS, which registers.test.ts holds to the emulator',
    );
  }
  return name;
}

/** The equates, as assembly lines, so generated source reads like source. */
export function registerEquates(): string[] {
  return Object.entries(TIA_REGISTERS).map(
    ([name, address]) =>
      `${name.padEnd(8)} = $${address.toString(16).padStart(2, '0').toUpperCase()}`,
  );
}
