/**
 * RIOT (6532) -- 128 bytes of RAM, the interval timer, and the I/O ports.
 *
 * The timer is the part that matters for step 1's kernel: it is what bounds
 * VBLANK and overscan work, and its write behaviour is what made the derived
 * timer constant wrong by a scanline. See
 * examples/tank-arena/reference/NOTES.md.
 */

export const RIOT = {
  SWCHA: 0x280,
  SWACNT: 0x281,
  SWCHB: 0x282,
  SWBCNT: 0x283,
  INTIM: 0x284,
  TIMINT: 0x285,
  TIM1T: 0x294,
  TIM8T: 0x295,
  TIM64T: 0x296,
  T1024T: 0x297,
} as const;

/** Joystick and console switch lines are ACTIVE LOW: 1 means "not pressed". */
export const SWCHA_IDLE = 0xff;
export const SWCHB_IDLE = 0x3f;

export class Riot {
  readonly ram = new Uint8Array(128);

  /** Remaining timer value as read through INTIM. */
  private timerValue = 0;
  /** CPU cycles per timer decrement: 1, 8, 64 or 1024. */
  private prescaler = 1024;
  /** Cycles accumulated toward the next decrement. */
  private prescalerCount = 0;
  /** Set once the timer passes zero. */
  private timerExpired = false;

  /** Controller inputs, driven by the host. Active low. */
  swcha = SWCHA_IDLE;
  swchb = SWCHB_IDLE;

  read(address: number): number {
    switch (address & 0x29f) {
      case RIOT.SWCHA:
        return this.swcha & 0xff;
      case RIOT.SWCHB:
        return this.swchb & 0xff;
      case RIOT.INTIM:
        this.timerExpired = false;
        return this.timerValue & 0xff;
      case RIOT.TIMINT:
        return this.timerExpired ? 0x80 : 0x00;
      default:
        return 0;
    }
  }

  write(address: number, value: number): void {
    const v = value & 0xff;
    switch (address & 0x29f) {
      case RIOT.TIM1T:
        this.setTimer(v, 1);
        break;
      case RIOT.TIM8T:
        this.setTimer(v, 8);
        break;
      case RIOT.TIM64T:
        this.setTimer(v, 64);
        break;
      case RIOT.T1024T:
        this.setTimer(v, 1024);
        break;
      default:
        break;
    }
  }

  private setTimer(value: number, prescaler: number): void {
    this.timerValue = value & 0xff;
    this.prescaler = prescaler;
    this.timerExpired = false;
    // The first decrement happens on the NEXT cycle, not after a full
    // prescaler interval. Zero is therefore reached at 1 + (N-1)*interval
    // cycles, not N*interval -- for TIM64T #44 that is 2753 rather than 2816,
    // a 63-cycle difference, which is most of a scanline.
    //
    // MEASURED, not assumed: tests/fixtures/timing/timer-only.asm isolates
    // this with no WSYNC in the timed region. Stella 7.0c reports 262
    // scanlines for it (T = 37). Starting the divider at zero instead gave
    // T = 38.
    this.prescalerCount = prescaler - 1;
  }

  /** Advance the timer by CPU cycles. */
  tick(cpuCycles: number): void {
    for (let i = 0; i < cpuCycles; i += 1) {
      this.prescalerCount += 1;
      if (this.prescalerCount >= this.prescaler) {
        this.prescalerCount = 0;
        if (this.timerValue === 0) {
          this.timerExpired = true;
          this.timerValue = 0xff;
          // Once expired the timer counts down every cycle, not every
          // prescaler interval.
          this.prescaler = 1;
        } else {
          this.timerValue -= 1;
        }
      }
    }
  }
}
