import { Bus } from './bus.ts';
import { Cpu } from './cpu.ts';
import { Riot, SWCHA_IDLE, SWCHB_IDLE } from './riot.ts';
import { COLOR_CLOCKS_PER_CPU_CYCLE, Tia } from './tia.ts';
import type { TiaWrite } from './trace.ts';

/**
 * A frame's measured structure.
 *
 * Regions are classified from the VSYNC and VBLANK register state observed at
 * the END of each scanline, which is how a display would see them. The kernel
 * declares its intent as 3 + 37 + 192 + 30; this reports what it actually did.
 */
export interface FrameResult {
  readonly scanlines: number;
  readonly vsyncLines: number;
  readonly vblankLines: number;
  readonly visibleLines: number;
  readonly overscanLines: number;
  readonly cpuCycles: number;
  /** Every TIA write in this frame, present only when tracing was requested. */
  readonly writes?: readonly TiaWrite[];
}

export interface RunFrameOptions {
  /** Collect every TIA write with the beam position it landed on. */
  readonly trace?: boolean;
  /**
   * Controller port A for this frame (both joysticks' directions), active LOW.
   * Defaults to the idle value, so an omitted script frame means "no input".
   */
  readonly swcha?: number;
  /** Console switches for this frame, active LOW. */
  readonly swchb?: number;
}

/** Guard against a ROM that never asserts VSYNC, so tests fail fast. */
const MAX_SCANLINES_PER_FRAME = 1000;

export class Machine {
  readonly tia = new Tia();
  readonly riot = new Riot();
  readonly bus: Bus;
  readonly cpu: Cpu;

  constructor(rom: Uint8Array) {
    this.bus = new Bus(rom, this.tia, this.riot);
    this.cpu = new Cpu(this.bus);
    this.cpu.reset();
  }

  /**
   * Run until the start of the next frame.
   *
   * A frame boundary is the rising edge of VSYNC, which is what Stella counts
   * and therefore what makes the two measurements comparable.
   */
  runFrame(options: RunFrameOptions = {}): FrameResult {
    // Applied before the frame runs, not during it: the kernel samples SWCHA
    // once in VBLANK, and a value that changed mid-frame would make the trace
    // depend on where in the frame the host happened to write it -- exactly the
    // nondeterminism a golden exists to exclude.
    this.riot.swcha = options.swcha ?? SWCHA_IDLE;
    this.riot.swchb = options.swchb ?? SWCHB_IDLE;

    let scanlines = 0;
    let vsyncLines = 0;
    let vblankLines = 0;
    let visibleLines = 0;
    let overscanLines = 0;
    let cpuCycles = 0;

    // Region tracking: once the visible region has been seen, further blanked
    // lines are overscan rather than vertical blank.
    let seenVisible = false;
    let done = false;
    let previousVsync = this.tia.vsync;

    const writes: TiaWrite[] | undefined = options.trace ? [] : undefined;
    const baseLine = this.tia.scanline;
    if (writes) {
      this.tia.onWrite = (register, value, line, clock, pixel) => {
        writes.push({ line: line - baseLine, clock, pixel, register, value });
      };
    }

    this.tia.onScanline = (record) => {
      scanlines += 1;
      if (record.vsync) {
        vsyncLines += 1;
      } else if (record.vblank) {
        if (seenVisible) overscanLines += 1;
        else vblankLines += 1;
      } else {
        visibleLines += 1;
        seenVisible = true;
      }
    };

    try {
      while (!done) {
        if (this.tia.isHalted) {
          // WSYNC: the CPU is stalled, but the rest of the machine is not.
          // The RIOT timer is driven by the system clock, so it MUST keep
          // counting through the halt -- otherwise every WSYNC makes the timer
          // run slow, and a timer-bounded region stretches by exactly the
          // halted time. VBLANK contains 4 halted lines from PosObjectX, and
          // omitting this made the region 3 scanlines too long.
          const clocks = this.tia.clocksToLineEnd();
          this.riot.tick(Math.ceil(clocks / COLOR_CLOCKS_PER_CPU_CYCLE));
          this.tia.tick(clocks);
        } else {
          const cycles = this.cpu.step();
          cpuCycles += cycles;
          this.riot.tick(cycles);
          this.tia.tick(cycles * COLOR_CLOCKS_PER_CPU_CYCLE);
        }

        // Rising edge of VSYNC ends the frame, but only after the frame has
        // actually produced lines -- otherwise the edge that starts this frame
        // would immediately end it.
        const vsyncNow = this.tia.vsync;
        if (vsyncNow && !previousVsync && scanlines > 0) done = true;
        previousVsync = vsyncNow;

        if (scanlines > MAX_SCANLINES_PER_FRAME) {
          throw new Error(
            `no VSYNC after ${MAX_SCANLINES_PER_FRAME} scanlines; the ROM is not producing frames`,
          );
        }
      }
    } finally {
      this.tia.onScanline = undefined;
      this.tia.onWrite = undefined;
    }

    return writes
      ? { scanlines, vsyncLines, vblankLines, visibleLines, overscanLines, cpuCycles, writes }
      : { scanlines, vsyncLines, vblankLines, visibleLines, overscanLines, cpuCycles };
  }
}
