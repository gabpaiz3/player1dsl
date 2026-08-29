import { describe, expect, it } from 'vitest';
import {
  emitFrame,
  NTSC_OVERSCAN_LINES,
  NTSC_VBLANK_LINES,
  NTSC_VSYNC_LINES,
} from '../src/index.ts';
import { wsyncLines } from './support/wsync.ts';

/** A kernel that spends its lines and writes nothing, so counts stay readable. */
function blankKernel(lines: number): string[] {
  return [`    ldx #${lines}`, '.kernelLine', '    sta WSYNC', '    dex', '    bne .kernelLine'];
}

function frame(overrides: Partial<Parameters<typeof emitFrame>[0]> = {}): string[] {
  return emitFrame({
    init: [],
    setup: [],
    setupLines: 0,
    kernel: blankKernel(192),
    data: [],
    ...overrides,
  });
}

/** The lines between two markers, so a test can count one region at a time. */
function between(lines: readonly string[], from: string, to: string): string[] {
  const start = lines.findIndex((l) => l.includes(from));
  const end = lines.findIndex((l, i) => i > start && l.includes(to));
  expect([from, start >= 0]).toEqual([from, true]);
  expect([to, end > start]).toEqual([to, true]);
  return lines.slice(start, end);
}

describe('emitFrame', () => {
  it('emits a reset vector pair at $FFFC', () => {
    const text = frame().join('\n');
    expect(text).toMatch(/org \$FFFC\s*\n\s*\.word Reset\s*\n\s*\.word Reset/);
  });

  it('emits exactly three WSYNCs for VSYNC and thirty for overscan', () => {
    const lines = frame();
    expect(wsyncLines(between(lines, '--- vertical sync', '--- vertical blank'))).toBe(
      NTSC_VSYNC_LINES,
    );
    expect(wsyncLines(between(lines, '--- overscan', 'jmp MainLoop'))).toBe(NTSC_OVERSCAN_LINES);
  });

  it('places the caller-supplied kernel between VBLANK end and overscan start', () => {
    const lines = frame({ kernel: ['    ; THE KERNEL', ...blankKernel(192)] });
    const blankOff = lines.findIndex((l) => l.includes('sta VBLANK') && l.includes('off'));
    const kernel = lines.findIndex((l) => l.includes('THE KERNEL'));
    const blankOn = lines.findIndex((l) => l.includes('--- overscan'));
    expect(blankOff).toBeGreaterThan(0);
    expect(kernel).toBeGreaterThan(blankOff);
    expect(blankOn).toBeGreaterThan(kernel);
  });

  // THE bug the plan names as most likely in this file. Vertical blank is 37
  // lines TOTAL, and positioning spends four of them inside `setup`. An emitter
  // that writes `ldx #37` after the setup produces a 41-line vertical blank and
  // a 266-line frame -- and every one of the three kernel fixtures hit exactly
  // this.
  it('counts the lines setup already spent against the vertical blank budget', () => {
    const withSetup = frame({
      setup: ['    ldx #4', '.position', '    sta WSYNC', '    dex', '    bne .position'],
      setupLines: 4,
    });
    const vblank = between(withSetup, '--- vertical sync', 'blanking off');
    // Three of these are the VSYNC lines; the rest are vertical blank.
    expect(wsyncLines(vblank)).toBe(NTSC_VSYNC_LINES + NTSC_VBLANK_LINES);
  });

  it('spends the whole vertical blank budget when setup takes none of it', () => {
    expect(wsyncLines(between(frame(), '--- vertical sync', 'blanking off'))).toBe(
      NTSC_VSYNC_LINES + NTSC_VBLANK_LINES,
    );
  });

  // The known-negative. Without it, `ldx #0` would be emitted for a setup that
  // fills vertical blank exactly, and a 6502 down-counter loaded with zero runs
  // 256 times -- a 293-line vertical blank from an off-by-one.
  it('refuses a setup that spends more vertical blank than exists', () => {
    expect(() => frame({ setupLines: NTSC_VBLANK_LINES + 1 })).toThrow(/vertical blank/i);
  });

  it('emits no vertical blank loop at all when setup fills it exactly', () => {
    const exact = frame({ setupLines: NTSC_VBLANK_LINES });
    expect(exact.join('\n')).not.toMatch(/ldx #0\b/);
  });
});
