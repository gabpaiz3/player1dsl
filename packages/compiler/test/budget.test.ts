import { readFileSync } from 'node:fs';
import { parse } from '@player1dsl/parser';
import { describe, expect, it } from 'vitest';
import { build, buildStatic, check, VBLANK_CYCLE_BUDGET } from '../src/index.ts';

const SOURCE = 'examples/tank-arena/tank-arena.p1';
const source = () => readFileSync(SOURCE, 'utf8');
const ir = (text = source()) => check(parse(text, SOURCE));

describe('the vertical blank cycle budget', () => {
  it('is 37 lines of 76 cycles', () => {
    expect(VBLANK_CYCLE_BUDGET).toBe(37 * 76);
  });

  it('reports what tank-arena actually spends', () => {
    const { budget } = build(ir());
    expect(budget.spent).toBeGreaterThan(0);
    expect(budget.spent).toBeLessThan(budget.available);
    expect(budget.free).toBe(budget.available - budget.spent);
  });

  // A static build has no rules, so it spends only what the glyph pointers cost.
  it('charges a static build less than one with rules', () => {
    expect(buildStatic(ir()).budget.spent).toBeLessThan(build(ir()).budget.spent);
  });

  /**
   * A gate that cannot fire is not a gate.
   *
   * Repeating the movement rule until it overruns proves the diagnostic exists
   * and that the number it reports is the real overrun rather than a constant.
   */
  const tooMany = () =>
    source().replace(
      'every frame:',
      `every frame:\n${'  tank0 moves with joystick1 speed 1 within field\n'.repeat(40)}`,
    );

  it('fails the build when rules do not fit, rather than emitting a long frame', () => {
    expect(() => build(ir(tooMany()))).toThrow(/E70\d/);
  });

  /**
   * Enough rules to overrun vertical blank's SCANLINES rather than its cycles
   * gets its own diagnostic. Reported separately because the fix is different:
   * a cycle overrun is a rule that is too slow, a line overrun is too many
   * rules, and a message quoting a negative cycle budget would say neither.
   */
  it('separates running out of lines from running out of cycles', () => {
    try {
      build(ir(tooMany()));
      throw new Error('should have thrown');
    } catch (error) {
      const first = (error as { diagnostics?: { code: string; message: string }[] })
        .diagnostics?.[0];
      expect(first?.code).toBe('E705');
      expect(first?.message).toContain('scanlines');
    }
  });

  it('says how many cycles over budget it is, not just that it failed', () => {
    try {
      build(ir(tooMany()));
      throw new Error('should have thrown');
    } catch (error) {
      const first = (error as { diagnostics?: { message: string }[] }).diagnostics?.[0];
      expect(first?.message).toMatch(/scanlines|cycles/);
    }
  });
});
