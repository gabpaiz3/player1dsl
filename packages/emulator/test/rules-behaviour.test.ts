import { readFileSync } from 'node:fs';
import { build, check, DEFAULT_STACK_RESERVED } from '@player1dsl/compiler';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import {
  compareGolden,
  expandScript,
  type InputScript,
  Machine,
  parseGolden,
  SWCHA_IDLE,
  SWCHB_IDLE,
  toGoldenFrame,
} from '../src/index.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';
const J0_LEFT = 0x40;
const J0_RIGHT = 0x80;
const J0_UP = 0x10;
const J0_DOWN = 0x20;

/** The COMPILED ROM, which is the thing under test here. */
function compiled(): Uint8Array {
  return build(check(parse(readFileSync(SOURCE, 'utf8'), SOURCE))).rom;
}

/**
 * Frame 0 is cut short by reset code and frame 1 begins with VBLANK never
 * having been set, so its blanked lines misclassify. Frame 2 on is steady
 * state -- the same reason frame-timing.test.ts discards two.
 */
function settled(): Machine {
  const machine = new Machine(compiled());
  machine.runFrame();
  machine.runFrame();
  return machine;
}

/** Zero page, as the allocator assigns it: $80 is slot 0. */
const TANK0_X = 0;
const TANK0_Y = 1;
const TANK1_Y = 3;
const P0_SCORE = 4;
const HIT_FLAG = 6;

const read = (machine: Machine, slot: number) => machine.riot.ram[slot] ?? -1;

function hold(machine: Machine, mask: number, frames: number): void {
  for (let i = 0; i < frames; i += 1) machine.runFrame({ swcha: SWCHA_IDLE & ~mask });
}

describe('the compiled ROM obeys its own rules', () => {
  it('moves a tank at all, so the clamp tests below are not vacuous', () => {
    const machine = settled();
    const before = read(machine, TANK0_X);
    hold(machine, J0_LEFT, 5);
    expect(read(machine, TANK0_X)).not.toBe(before);
  });

  /**
   * Clamps at the DERIVED bound, which is deliberately not the reference's.
   *
   * `movementBounds` gives xMin = 1 in authored coordinates, and the lowered
   * `cpx #2 / bcc` rests one below its constant -- so the tank comes to rest at
   * exactly 1. The reference kernel rests at 7, because its X_MIN of 8 is a
   * hand-chosen margin the compiler does not reproduce.
   *
   * That divergence is the decision recorded in docs/kernel-measurements.md,
   * "Where a movement bound comes from", and it is why the golden's input
   * script never drives a tank to a bound: those frames could not compare.
   */
  it('clamps at the derived lower bound rather than wrapping past it', () => {
    const machine = settled();
    hold(machine, J0_LEFT, 90);
    const atBound = read(machine, TANK0_X);
    hold(machine, J0_LEFT, 10);
    expect([atBound, read(machine, TANK0_X)]).toEqual([1, 1]);
  });

  it('clamps at the derived upper bound', () => {
    const machine = settled();
    hold(machine, J0_RIGHT, 160);
    const atBound = read(machine, TANK0_X);
    hold(machine, J0_RIGHT, 10);
    expect([atBound, read(machine, TANK0_X)]).toEqual([145, 145]);
  });

  /**
   * Both vertical bounds. The Y sense is inverted -- the field loop counts
   * DOWN, so a larger y is higher up and joystick UP increments it -- and a
   * lowerer that got that backwards would clamp on the wrong ends.
   */
  it('clamps both vertical bounds, with up increasing the counter', () => {
    const up = settled();
    hold(up, J0_UP, 90);
    expect(read(up, TANK0_Y)).toBe(159);

    const down = settled();
    hold(down, J0_DOWN, 200);
    expect(read(down, TANK0_Y)).toBe(9);
  });

  // Port 2 is the low nibble of SWCHA. A lowerer that used port 1's masks for
  // both would move both tanks with one stick.
  it('moves each tank from its own joystick', () => {
    const machine = settled();
    const before = read(machine, TANK1_Y);
    hold(machine, J0_UP, 5);
    expect(read(machine, TANK1_Y)).toBe(before);
  });
});

describe('the compiled ROM scores the way the language promises', () => {
  const script = () =>
    JSON.parse(readFileSync('tests/goldens/tank-arena.input.json', 'utf8')) as InputScript;

  /**
   * THE debounce, end to end.
   *
   * The committed script drives the tanks into contact and holds it. TIA
   * latches are LEVEL, so a rule that scored on the latch alone would score
   * once per frame of overlap. The score must move exactly once.
   */
  it('scores exactly once across a contact that lasts many frames', () => {
    const machine = settled();
    const scores: number[] = [];
    for (const swcha of expandScript(script())) {
      machine.runFrame({ swcha });
      scores.push(read(machine, P0_SCORE));
    }
    const changes = scores.filter((s, i) => i > 0 && s !== scores[i - 1]);
    expect(changes).toEqual([4]);
  });

  it('latches the debounce while the tanks overlap and clears it after', () => {
    const machine = settled();
    const flags: number[] = [];
    for (const swcha of expandScript(script())) {
      machine.runFrame({ swcha });
      flags.push(read(machine, HIT_FLAG));
    }
    expect(flags).toContain(1);
    expect(flags.at(-1)).toBe(0);
  });
});

/**
 * THE assertion plan 4 exists for.
 *
 * `p1 build` without `--static`, against the trace of a ROM a human wrote:
 * every TIA write, in order, for ninety frames, including the score changing
 * on contact. Not a static scene -- a game that reads two joysticks, clamps
 * four bounds, latches a collision and debounces it.
 */
describe('the compiled ROM against the reference kernel', () => {
  it('reproduces all ninety golden frames', () => {
    const script = JSON.parse(
      readFileSync('tests/goldens/tank-arena.input.json', 'utf8'),
    ) as InputScript;
    const golden = parseGolden(readFileSync('tests/goldens/tank-arena.trace', 'utf8'));

    const machine = new Machine(compiled());
    for (let i = 0; i < script.settleFrames; i += 1) machine.runFrame();
    const ours = expandScript(script).map((swcha, index) =>
      toGoldenFrame(index, swcha, SWCHB_IDLE, machine.runFrame({ swcha, trace: true })),
    );

    expect(compareGolden(golden, ours).map((m) => `[${m.frame}] ${m.kind}: ${m.detail}`)).toEqual(
      [],
    );
  });
});

/**
 * THE test the per-fragment line accounting exists for.
 *
 * Ending each rule fragment on `sta WSYNC` makes its cost independent of which
 * BRANCH the code took. It does not make that cost one LINE, and the two were
 * conflated until 2026-09-08: three `score p0 += 1` actions in one collision
 * rule cost 84 worst-case cycles, were charged a single scanline, and produced
 * a 263-line frame on exactly the frames where the tanks touched -- while the
 * cycle budget passed at 351 of 1900.
 *
 * A frame length that depends on the input is what the ledger exists to
 * prevent, and it is the same defect 2026-09-04 recorded as fixed.
 *
 * Driven by the committed script rather than idle frames, because the overrun
 * only appears on a frame where the collision rule's body actually runs.
 */
describe('a rule longer than one scanline still costs whole frames', () => {
  const script = () =>
    JSON.parse(readFileSync('tests/goldens/tank-arena.input.json', 'utf8')) as InputScript;

  function frameLengths(actions: number): number[] {
    const source = readFileSync(SOURCE, 'utf8').replace(
      '  score p0 += 1',
      Array.from({ length: actions }, () => '  score p0 += 1').join('\n'),
    );
    const machine = new Machine(build(check(parse(source, SOURCE))).rom);
    machine.runFrame();
    machine.runFrame();
    return expandScript(script()).map((swcha) => machine.runFrame({ swcha }).scanlines);
  }

  // One and two actions fit inside a scanline, so the frame is constant.
  it.each([1, 2])('holds every frame to 262 lines with %i scoring actions', (actions) => {
    expect([...new Set(frameLengths(actions))]).toEqual([262]);
  });

  /**
   * E706 firing, watched.
   *
   * Three actions is 84 worst-case cycles in one fragment. Charging it two
   * lines was tried and refuted: the branch that skips the actions really does
   * take one line, so the frame came out **261** on every frame without
   * contact. A cost that depends on the input can only be refused.
   *
   * This is the first gate in the E70x range that anything has been seen to
   * trip -- E704 still has not -- so it is asserted by code and by the number
   * it reports, not merely by its existence.
   */
  it.each([3, 4])('refuses %i actions rather than emitting a variable-length frame', (actions) => {
    expect(() => frameLengths(actions)).toThrow(/E706/);
  });

  it('says how long the rule ran and what a scanline holds', () => {
    try {
      frameLengths(3);
      throw new Error('should have thrown');
    } catch (error) {
      const first = (error as { diagnostics?: { code: string; message: string }[] })
        .diagnostics?.[0];
      expect(first?.code).toBe('E706');
      expect(first?.message).toMatch(/\d+ cycles between WSYNCs/);
      expect(first?.message).toContain('76');
    }
  });
});

/**
 * The stack reservation, held to what the ROM actually uses.
 *
 * `DEFAULT_STACK_RESERVED` was a guess for three plans. It is eight now,
 * because the deepest chain measures two -- and this is what keeps that honest:
 * a rule form that nested deeper would fail here rather than quietly corrupting
 * the variables allocated below the stack.
 */
describe('the compiled ROM stays inside its stack reservation', () => {
  it('never pushes deeper than the allocator reserved', () => {
    const machine = settled();
    const cpu = machine.cpu;
    const step = Object.getPrototypeOf(cpu).step;
    let lowest = 0xff;
    let top = 0x00;
    Object.defineProperty(cpu, 'step', {
      value: function patched(this: typeof cpu) {
        const cycles = step.call(this);
        if (this.sp < lowest) lowest = this.sp;
        if (this.sp > top) top = this.sp;
        return cycles;
      },
      writable: true,
    });

    for (let i = 0; i < 20; i += 1) {
      machine.runFrame({ swcha: SWCHA_IDLE & ~(i % 2 ? J0_LEFT : J0_UP) });
    }

    // One `jsr PosObjectX` and no nesting: two bytes of return address.
    expect(top - lowest).toBe(2);
    expect(top - lowest).toBeLessThanOrEqual(DEFAULT_STACK_RESERVED);
  });
});
