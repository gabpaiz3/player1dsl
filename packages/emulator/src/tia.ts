/**
 * TIA -- timing model.
 *
 * This is deliberately a *timing* model first, not a renderer. Step 2's
 * acceptance test is that the reference ROM produces 262 scanlines split into
 * the intended NTSC regions; pixel output is not required for that and is
 * added later for frame-capture goldens.
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
  CXCLR: 0x2c,
} as const;

/** One observed scanline: which region it belonged to, and when it ended. */
export interface ScanlineRecord {
  readonly index: number;
  readonly vsync: boolean;
  readonly vblank: boolean;
}

export class Tia {
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
  onWrite: ((register: number, value: number, line: number, clock: number, pixel: number) => void) | undefined;

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
      default:
        break;
    }
  }

  read(address: number): number {
    // Collision and input registers are not yet modelled; reads return 0,
    // which is the "no collision / not pressed" state for this ROM.
    void address;
    return 0;
  }

  /** Advance the beam by whole colour clocks, emitting scanline events. */
  tick(colorClocks: number): void {
    let remaining = colorClocks;
    while (remaining > 0) {
      const toLineEnd = COLOR_CLOCKS_PER_SCANLINE - this.clock;
      const step = Math.min(remaining, toLineEnd);
      this.clock += step;
      remaining -= step;

      if (this.clock >= COLOR_CLOCKS_PER_SCANLINE) {
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

  /** Colour clocks remaining until the current scanline ends. */
  clocksToLineEnd(): number {
    return COLOR_CLOCKS_PER_SCANLINE - this.clock;
  }
}
