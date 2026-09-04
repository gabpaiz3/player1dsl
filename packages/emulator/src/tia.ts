import { type MovableName, Objects, Present } from './objects.ts';

/**
 * TIA -- timing and object model.
 *
 * A timing model first: the region structure a ROM produces is what most of
 * this repository checks. Since increment 5c it also tracks WHERE each object
 * is, fills a per-line presence mask as the beam crosses it, and latches the
 * fifteen collision bits out of that mask -- because `when A hits B` cannot be
 * verified against a machine that reports no collisions.
 *
 * Still not a renderer: presence is not colour. `objects.ts` holds the state
 * and answers "which objects cover this pixel"; adding "and what colour is it"
 * is where a framebuffer would attach.
 *
 * Every quantity here is an integer. Colour clocks, CPU cycles and scanline
 * indices are counted exactly -- no floating point anywhere in the timing path,
 * so the model is reproducible bit-for-bit across machines.
 */

export const COLOR_CLOCKS_PER_SCANLINE = 228;
export const COLOR_CLOCKS_PER_CPU_CYCLE = 3;
export const CPU_CYCLES_PER_SCANLINE = COLOR_CLOCKS_PER_SCANLINE / COLOR_CLOCKS_PER_CPU_CYCLE; // 76
export const HBLANK_COLOR_CLOCKS = 68;
export const VISIBLE_PIXELS = 160;

/** TIA write register addresses, mirroring kernels/include/vcs.h. */
export const TIA = {
  VSYNC: 0x00,
  VBLANK: 0x01,
  WSYNC: 0x02,
  RSYNC: 0x03,
  NUSIZ0: 0x04,
  NUSIZ1: 0x05,
  CTRLPF: 0x0a,
  REFP0: 0x0b,
  REFP1: 0x0c,
  PF0: 0x0d,
  PF1: 0x0e,
  PF2: 0x0f,
  RESP0: 0x10,
  RESP1: 0x11,
  RESM0: 0x12,
  RESM1: 0x13,
  RESBL: 0x14,
  GRP0: 0x1b,
  GRP1: 0x1c,
  ENAM0: 0x1d,
  ENAM1: 0x1e,
  ENABL: 0x1f,
  HMP0: 0x20,
  HMP1: 0x21,
  HMM0: 0x22,
  HMM1: 0x23,
  HMBL: 0x24,
  VDELP0: 0x25,
  VDELP1: 0x26,
  VDELBL: 0x27,
  HMOVE: 0x2a,
  HMCLR: 0x2b,
  CXCLR: 0x2c,
} as const;

/** TIA READ register addresses. A read decodes only four address lines. */
export const CX = {
  CXM0P: 0x00,
  CXM1P: 0x01,
  CXP0FB: 0x02,
  CXP1FB: 0x03,
  CXM0FB: 0x04,
  CXM1FB: 0x05,
  CXBLPF: 0x06,
  CXPPMM: 0x07,
} as const;

/**
 * The fifteen latch bits, as (read address, bit, the two objects that set it).
 *
 * Straight from the hardware's own table, and written as DATA rather than as
 * fifteen branches so the pairs can be read against a reference without
 * reading control flow.
 */
const LATCHES: readonly (readonly [number, number, number, number])[] = [
  [CX.CXM0P, 0x80, Present.M0, Present.P1],
  [CX.CXM0P, 0x40, Present.M0, Present.P0],
  [CX.CXM1P, 0x80, Present.M1, Present.P0],
  [CX.CXM1P, 0x40, Present.M1, Present.P1],
  [CX.CXP0FB, 0x80, Present.P0, Present.PF],
  [CX.CXP0FB, 0x40, Present.P0, Present.BL],
  [CX.CXP1FB, 0x80, Present.P1, Present.PF],
  [CX.CXP1FB, 0x40, Present.P1, Present.BL],
  [CX.CXM0FB, 0x80, Present.M0, Present.PF],
  [CX.CXM0FB, 0x40, Present.M0, Present.BL],
  [CX.CXM1FB, 0x80, Present.M1, Present.PF],
  [CX.CXM1FB, 0x40, Present.M1, Present.BL],
  [CX.CXBLPF, 0x80, Present.BL, Present.PF],
  [CX.CXPPMM, 0x80, Present.P0, Present.P1],
  [CX.CXPPMM, 0x40, Present.M0, Present.M1],
];

/** Which object a RESxx strobe resets. */
const STROBE_NAMES: Readonly<Record<number, MovableName>> = {
  0x10: 'p0',
  0x11: 'p1',
  0x12: 'm0',
  0x13: 'm1',
  0x14: 'bl',
};

/** The `Objects` fields a plain register write assigns. */
type ObjectField =
  | 'nusiz0'
  | 'nusiz1'
  | 'ctrlpf'
  | 'refp0'
  | 'refp1'
  | 'pf0'
  | 'pf1'
  | 'pf2'
  | 'grp0'
  | 'grp1'
  | 'enam0'
  | 'enam1'
  | 'enabl'
  | 'hmp0'
  | 'hmp1'
  | 'hmm0'
  | 'hmm1'
  | 'hmbl';

/** Write registers that assign an `Objects` field directly. */
const OBJECT_FIELDS: Readonly<Record<number, ObjectField>> = {
  0x04: 'nusiz0',
  0x05: 'nusiz1',
  0x0a: 'ctrlpf',
  0x0b: 'refp0',
  0x0c: 'refp1',
  0x0d: 'pf0',
  0x0e: 'pf1',
  0x0f: 'pf2',
  0x1b: 'grp0',
  0x1c: 'grp1',
  0x1d: 'enam0',
  0x1e: 'enam1',
  0x1f: 'enabl',
  0x20: 'hmp0',
  0x21: 'hmp1',
  0x22: 'hmm0',
  0x23: 'hmm1',
  0x24: 'hmbl',
};

/** One observed scanline: which region it belonged to, and when it ended. */
export interface ScanlineRecord {
  readonly index: number;
  readonly vsync: boolean;
  readonly vblank: boolean;
}

export class Tia {
  /** Where every object is and what it draws. */
  readonly objects = new Objects();

  /** Latched collisions, indexed by read address. LEVEL, not edged. */
  private readonly latched = new Uint8Array(8);

  /** Object presence for the line being drawn: one `Present` mask per pixel. */
  private readonly presence = new Uint8Array(VISIBLE_PIXELS);

  /** Colour clock within the current scanline, 0..227. */
  private clock = 0;
  /** Scanlines completed since the machine started. */
  private line = 0;

  private vsyncOn = false;
  private vblankOn = false;

  /** Set when WSYNC is strobed; cleared when the next scanline begins. */
  private halted = false;

  /** Written registers, for trace assertions. Index is the write address. */
  readonly registers = new Uint8Array(0x40);

  /** Callback fired at the completion of every scanline. */
  onScanline: ((record: ScanlineRecord) => void) | undefined;

  /**
   * Callback fired on every TIA register write, before the write takes effect.
   * Receives the beam position at the moment of the write, which is what makes
   * a missed band-transition deadline visible without looking at a screen.
   */
  onWrite:
    | ((register: number, value: number, line: number, clock: number, pixel: number) => void)
    | undefined;

  get isHalted(): boolean {
    return this.halted;
  }

  get scanline(): number {
    return this.line;
  }

  get colorClock(): number {
    return this.clock;
  }

  get vsync(): boolean {
    return this.vsyncOn;
  }

  get vblank(): boolean {
    return this.vblankOn;
  }

  /** The visible pixel the beam is on, or -1 during horizontal blank. */
  get pixel(): number {
    return this.clock < HBLANK_COLOR_CLOCKS ? -1 : this.clock - HBLANK_COLOR_CLOCKS;
  }

  write(address: number, value: number): void {
    const reg = address & 0x3f;
    this.onWrite?.(reg, value & 0xff, this.line, this.clock, this.pixel);
    this.registers[reg] = value & 0xff;

    switch (reg) {
      case TIA.VSYNC:
        this.vsyncOn = (value & 0x02) !== 0;
        break;
      case TIA.VBLANK:
        this.vblankOn = (value & 0x02) !== 0;
        break;
      case TIA.WSYNC:
        // Halt the CPU until the start of the next scanline. Note this halts
        // even when the beam is already at clock 0: WSYNC waits for the NEXT
        // horizontal sync, which is what makes a loop of bare WSYNCs advance
        // one line per iteration.
        this.halted = true;
        break;
      case TIA.RSYNC:
        this.clock = 0;
        break;

      // --- object state -----------------------------------------------------
      case TIA.RESP0:
      case TIA.RESP1:
      case TIA.RESM0:
      case TIA.RESM1:
      case TIA.RESBL: {
        const name = STROBE_NAMES[reg];
        if (name) this.objects.strobe(name, this.clock);
        break;
      }
      case TIA.HMOVE:
        this.objects.applyHmove();
        break;
      case TIA.HMCLR:
        this.objects.clearHmove();
        break;
      case TIA.CXCLR:
        this.latched.fill(0);
        break;
      case TIA.VDELP0:
      case TIA.VDELP1:
      case TIA.VDELBL:
        // Vertical delay draws the graphics byte written a line EARLIER. It is
        // not modelled, and silently ignoring it would draw the wrong row and
        // latch a collision that never happened, so an ENABLING write is
        // refused rather than guessed at. A write that turns it off is fine,
        // and ROMs make one at reset.
        if ((value & 0x01) !== 0) {
          throw new Error(
            'VDEL is not modelled and this ROM enabled it (register $' +
              reg.toString(16) +
              '). Vertical delay draws the graphics byte written a line earlier, so ' +
              'ignoring it would draw the wrong row and latch a collision that never ' +
              'happened. Model it before running a ROM that needs it.',
          );
        }
        break;

      default: {
        const field = OBJECT_FIELDS[reg];
        if (field) this.objects[field] = value & 0xff;
        break;
      }
    }
  }

  read(address: number): number {
    const reg = address & 0x0f;
    if (reg < 8) return this.latched[reg] ?? 0;
    // INPT0-INPT5 are not modelled; 0 is "not pressed". Named rather than
    // covered by a blanket `return 0`, so the next unmodelled read is visible
    // instead of being absorbed into a comment about collisions.
    return 0;
  }

  /** Advance the beam by whole colour clocks, emitting scanline events. */
  tick(colorClocks: number): void {
    let remaining = colorClocks;
    while (remaining > 0) {
      const toLineEnd = COLOR_CLOCKS_PER_SCANLINE - this.clock;
      const step = Math.min(remaining, toLineEnd);
      const from = this.clock;
      this.clock += step;
      remaining -= step;
      this.fillPresence(from, this.clock);

      if (this.clock >= COLOR_CLOCKS_PER_SCANLINE) {
        this.latchCollisions();
        this.clock = 0;
        this.onScanline?.({
          index: this.line,
          vsync: this.vsyncOn,
          vblank: this.vblankOn,
        });
        this.line += 1;
        this.halted = false; // WSYNC releases at the start of a scanline
      }
    }
  }

  /**
   * Record which objects covered each pixel the beam just crossed.
   *
   * Event-driven without an event list: object state changes only on a write,
   * and since increment 5c's timing correction a write lands between two ticks,
   * so "the state as it stands" is the state for exactly these pixels.
   */
  private fillPresence(fromClock: number, toClock: number): void {
    const first = Math.max(fromClock, HBLANK_COLOR_CLOCKS);
    for (let clock = first; clock < toClock; clock += 1) {
      const pixel = clock - HBLANK_COLOR_CLOCKS;
      this.presence[pixel] = this.objects.presenceAt(pixel);
    }
  }

  /** OR the fifteen latch bits out of the finished line, and start the next. */
  private latchCollisions(): void {
    for (const mask of this.presence) {
      if (mask === 0) continue;
      for (const [reg, bit, a, b] of LATCHES) {
        if ((mask & a) !== 0 && (mask & b) !== 0) {
          this.latched[reg] = (this.latched[reg] ?? 0) | bit;
        }
      }
    }
    this.presence.fill(0);
  }

  /** Colour clocks remaining until the current scanline ends. */
  clocksToLineEnd(): number {
    return COLOR_CLOCKS_PER_SCANLINE - this.clock;
  }
}
