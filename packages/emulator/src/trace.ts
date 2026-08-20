/**
 * TIA write tracing.
 *
 * This is the instrument spec review 1.1 argues for. A diagnostic claiming
 * "51 cycles available, 66 required" is only trustworthy if something measures
 * the real line; a trace of every TIA write, with the scanline and pixel it
 * landed on, is what turns that claim into an assertion.
 *
 * It is also SPEC.md 8's evidence stage: per-write records with frame
 * boundaries are exactly what the ROM-recovery workflow needs and what no
 * external emulator hands over on demand.
 */

export interface TiaWrite {
  /** Scanline within the frame, 0-based from the first line after VSYNC rises. */
  readonly line: number;
  /** Colour clock within the scanline, 0..227. */
  readonly clock: number;
  /**
   * Visible pixel the beam was on, or -1 during horizontal blank.
   *
   * This is the field that catches band-transition bugs: a playfield write
   * with pixel >= 0 landed in the visible region, which is how the reference
   * kernel's white sliver, missing score row and left-edge notch all happened.
   */
  readonly pixel: number;
  /** TIA write register address, 0x00..0x3f. */
  readonly register: number;
  readonly value: number;
}

/** Names for TIA write registers, for readable trace output. */
export const TIA_WRITE_NAMES: Readonly<Record<number, string>> = {
  0x00: 'VSYNC',
  0x01: 'VBLANK',
  0x02: 'WSYNC',
  0x03: 'RSYNC',
  0x04: 'NUSIZ0',
  0x05: 'NUSIZ1',
  0x06: 'COLUP0',
  0x07: 'COLUP1',
  0x08: 'COLUPF',
  0x09: 'COLUBK',
  0x0a: 'CTRLPF',
  0x0b: 'REFP0',
  0x0c: 'REFP1',
  0x0d: 'PF0',
  0x0e: 'PF1',
  0x0f: 'PF2',
  0x10: 'RESP0',
  0x11: 'RESP1',
  0x12: 'RESM0',
  0x13: 'RESM1',
  0x14: 'RESBL',
  0x15: 'AUDC0',
  0x16: 'AUDC1',
  0x17: 'AUDF0',
  0x18: 'AUDF1',
  0x19: 'AUDV0',
  0x1a: 'AUDV1',
  0x1b: 'GRP0',
  0x1c: 'GRP1',
  0x1d: 'ENAM0',
  0x1e: 'ENAM1',
  0x1f: 'ENABL',
  0x20: 'HMP0',
  0x21: 'HMP1',
  0x22: 'HMM0',
  0x23: 'HMM1',
  0x24: 'HMBL',
  0x25: 'VDELP0',
  0x26: 'VDELP1',
  0x27: 'VDELBL',
  0x28: 'RESMP0',
  0x29: 'RESMP1',
  0x2a: 'HMOVE',
  0x2b: 'HMCLR',
  0x2c: 'CXCLR',
};

export function registerName(register: number): string {
  return TIA_WRITE_NAMES[register & 0x3f] ?? `$${(register & 0x3f).toString(16).padStart(2, '0')}`;
}

/** Registers whose value the beam reads while drawing a visible line. */
const BEAM_READ_REGISTERS = new Set([
  0x0d,
  0x0e,
  0x0f, // PF0 PF1 PF2
  0x1b,
  0x1c, // GRP0 GRP1
  0x1d,
  0x1e,
  0x1f, // ENAM0 ENAM1 ENABL
  0x06,
  0x07,
  0x08,
  0x09, // COLUP0 COLUP1 COLUPF COLUBK
]);

/**
 * Visible pixel at which the beam first reads each PLAYFIELD register.
 *
 * These deadlines are EXACT: the playfield is drawn at fixed columns, so a
 * write at or after this pixel provably missed the line. Under CTRLPF REF the
 * mirrored right half runs PF2, PF1, then PF0, so PF0 is read again at 144 --
 * the earliest read is the one that matters.
 */
export const FIRST_READ_PIXEL: Readonly<Record<number, number>> = {
  0x0d: 0, // PF0 -- leftmost 4-pixel block
  0x0e: 16, // PF1
  0x0f: 48, // PF2
};

/**
 * Conservative deadlines for the player graphics registers.
 *
 * GRP0/GRP1 are read wherever their object currently sits, which depends on
 * RESPx/HMOVE state this tracer does not yet model. Pixel 0 is therefore a
 * LOWER BOUND: it flags every genuinely late write (no false negatives) but
 * also flags writes that were fine because the object sits further right.
 *
 * Opt in via `findLateWrites(writes, { includePlayers: true })` and expect to
 * triage the results by hand. Making these exact requires object position
 * tracking -- the natural next increment of the emulator.
 */
export const CONSERVATIVE_PLAYER_READ_PIXEL: Readonly<Record<number, number>> = {
  0x1b: 0, // GRP0
  0x1c: 0, // GRP1
};

/** A write that missed its deadline: it landed at or after the read pixel. */
export interface LateWrite extends TiaWrite {
  readonly deadlinePixel: number;
}

export interface LateWriteOptions {
  /**
   * Also check GRP0/GRP1 against the conservative pixel-0 bound. Off by
   * default because it produces false positives until object positions are
   * modelled, and a check that cries wolf gets ignored.
   */
  readonly includePlayers?: boolean;
}

/**
 * Find writes that provably missed their deadline.
 *
 * Every band-transition defect in the reference kernel -- the bottom-right
 * sliver, the missing score row, the left-edge notch -- was exactly this, and
 * each took a round of screenshots and human inspection to find.
 */
export function findLateWrites(
  writes: readonly TiaWrite[],
  options: LateWriteOptions = {},
): LateWrite[] {
  const deadlines: Record<number, number> = options.includePlayers
    ? { ...FIRST_READ_PIXEL, ...CONSERVATIVE_PLAYER_READ_PIXEL }
    : { ...FIRST_READ_PIXEL };

  const late: LateWrite[] = [];
  for (const write of writes) {
    if (write.pixel < 0) continue; // horizontal blank: always in time
    const deadline = deadlines[write.register];
    if (deadline === undefined) continue;
    if (write.pixel >= deadline) late.push({ ...write, deadlinePixel: deadline });
  }
  return late;
}

export function isBeamReadRegister(register: number): boolean {
  return BEAM_READ_REGISTERS.has(register & 0x3f);
}

export function formatWrite(write: TiaWrite): string {
  const where = write.pixel < 0 ? 'blank' : `pixel ${write.pixel}`;
  return `line ${write.line} clk ${write.clock} (${where}): ${registerName(write.register)} = $${write.value.toString(16).padStart(2, '0')}`;
}
