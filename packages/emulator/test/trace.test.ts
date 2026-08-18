import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Machine, findLateWrites, formatWrite, registerName } from '../src/index.ts';

function tracedFrame(name: string) {
  const url = new URL(`../../../build/${name}.bin`, import.meta.url);
  const machine = new Machine(new Uint8Array(readFileSync(fileURLToPath(url))));
  machine.runFrame();
  machine.runFrame();
  return machine.runFrame({ trace: true });
}

describe('TIA write tracing', () => {
  it('records every write with the beam position it landed on', () => {
    const frame = tracedFrame('tank-arena');
    expect(frame.writes).toBeDefined();
    const writes = frame.writes ?? [];
    expect(writes.length).toBeGreaterThan(400);
    for (const write of writes) {
      expect(write.line).toBeGreaterThanOrEqual(0);
      expect(write.clock).toBeGreaterThanOrEqual(0);
      expect(write.clock).toBeLessThan(228);
      // pixel is -1 in blank, otherwise the visible column
      expect(write.pixel).toBeGreaterThanOrEqual(-1);
      expect(write.pixel).toBeLessThan(160);
    }
  });

  it('resolves register names', () => {
    expect(registerName(0x0d)).toBe('PF0');
    expect(registerName(0x1b)).toBe('GRP0');
    expect(registerName(0x2a)).toBe('HMOVE');
  });

  /**
   * The detector is proved against a KNOWN-POSITIVE case first. "Zero late
   * writes on a clean kernel" is worthless on its own -- a detector that never
   * fires would pass it too.
   */
  it('catches a deliberately late playfield write', () => {
    const frame = tracedFrame('late-write');
    const late = findLateWrites(frame.writes ?? []);
    expect(late.length).toBeGreaterThan(100); // once per visible line
    const example = late[0];
    expect(example).toBeDefined();
    if (example) {
      expect(registerName(example.register)).toBe('PF0');
      expect(example.pixel).toBeGreaterThanOrEqual(example.deadlinePixel);
      expect(formatWrite(example)).toContain('PF0');
    }
  });

  /**
   * And only then is the clean case meaningful. Every band-transition defect in
   * the reference kernel -- the bottom-right sliver, the missing score row, the
   * left-edge notch -- was exactly this, and each took a round of screenshots
   * and human inspection to find. This assertion covers all three in one run.
   */
  it('finds no late playfield writes in the corrected reference kernel', () => {
    const frame = tracedFrame('tank-arena');
    expect(findLateWrites(frame.writes ?? []).map(formatWrite)).toEqual([]);
  });

  /**
   * The conservative player check flags two GRP writes at the topWall -> field
   * boundary. Both are benign: they clear GRP to zero at pixels 1 and 10, and
   * both tanks sit at x=40 and x=110, so nothing was pending. They are late
   * only against the pixel-0 lower bound that stands in for the object position
   * tracking this tracer does not yet do.
   *
   * Asserted explicitly rather than ignored, so that if the count or position
   * changes, someone has to look at why.
   */
  it('flags only the two known-benign GRP clears under the conservative bound', () => {
    const frame = tracedFrame('tank-arena');
    const late = findLateWrites(frame.writes ?? [], { includePlayers: true });
    expect(late.map((w) => `${registerName(w.register)}@pixel${w.pixel}`)).toEqual([
      'GRP0@pixel1',
      'GRP1@pixel10',
    ]);
    expect(late.every((w) => w.value === 0)).toBe(true);
  });
});
