import { registerName, timingClass, WRITE_TIMING_CLASS } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { ENTRIES } from '../src/index.ts';

/**
 * The hardware table is the source of truth; templates declare what they think.
 *
 * This is the only thing preventing the two from drifting into the "second,
 * disconnected rule table" review 0.2 §1.1 warns about. It is a test-only
 * import, so no project reference and no dependency cycle: the runtime's src
 * still depends on nothing but the parser.
 */
describe('templates and the emulator agree about write timing', () => {
  it('agrees about every register a template writes', () => {
    for (const entry of ENTRIES) {
      for (const write of entry.writes) {
        expect([entry.id, registerName(write.register), write.timing]).toEqual([
          entry.id,
          registerName(write.register),
          timingClass(write.register),
        ]);
      }
    }
  });

  /**
   * HONEST SCOPE, so this file is not read as broader coverage than it is.
   *
   * No entry declares a RESPx or HMOVE write, because positioning is the
   * runtime's own routine rather than any template's -- `repositionLines`
   * charges it per band boundary. So every declared write today is `deadline`,
   * and the loop above compares 'deadline' with 'deadline' seventeen times.
   *
   * That makes it a REGRESSION test rather than a discovery test: it earns its
   * place the moment a template declares a strobe, and until then the only
   * thing carrying it is the flip check below. This assertion states the
   * situation rather than leaving it to be inferred, and turns red when it
   * changes -- which is when the test above starts doing real work.
   */
  it('declares no beam-sensitive write yet, and says so', () => {
    const classes = new Set(ENTRIES.flatMap((e) => e.writes.map((w) => timingClass(w.register))));
    expect([...classes]).toEqual(['deadline']);
  });

  // Proof the comparison can fail, without needing a deliberate edit to
  // entries.ts: the same assertion shape, fed a class the table contradicts.
  // RESP0 is 'exact' in WRITE_TIMING_CLASS, so a template calling it 'deadline'
  // must be caught.
  it('would catch a template that misdeclared a strobe', () => {
    const misdeclared = { register: 0x10, timing: 'deadline' as const };
    expect(WRITE_TIMING_CLASS[misdeclared.register]).toBe('exact');
    expect(misdeclared.timing).not.toBe(timingClass(misdeclared.register));
  });
});
