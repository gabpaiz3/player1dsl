import type { DeclaredWrite, TemplateEntry } from './catalog.ts';

/**
 * The registers each entry declares, read off `tests/goldens/tank-arena.trace`
 * frame 0 and cross-checked against `examples/tank-arena/reference/tank-arena.asm`.
 *
 * An entry declares the registers ITS OWN rendered lines depend on, not every
 * register the trace shows on its lines. Those differ, and the difference is
 * not sloppiness: setup code shares the line the next loop's first WSYNC ends,
 * so the top wall's first traced line (57) carries `COLUP0`/`COLUP1` written
 * for the FIELD, and the bottom wall's first traced line (224) carries the
 * `GRP0`/`GRP1` clears that end the field. Charging those to `solid-run` would
 * say a wall's appearance depends on the tank colours, which it does not.
 *
 * Timing classes are the hardware's, not a preference --
 * `packages/runtime/test/timing-agreement.test.ts` holds them to the emulator's
 * table.
 */
const PF0: DeclaredWrite = { register: 0x0d, timing: 'deadline' };
const PF1: DeclaredWrite = { register: 0x0e, timing: 'deadline' };
const PF2: DeclaredWrite = { register: 0x0f, timing: 'deadline' };
const COLUP0: DeclaredWrite = { register: 0x06, timing: 'deadline' };
const COLUP1: DeclaredWrite = { register: 0x07, timing: 'deadline' };
const GRP0: DeclaredWrite = { register: 0x1b, timing: 'deadline' };
const GRP1: DeclaredWrite = { register: 0x1c, timing: 'deadline' };

/**
 * The three entries tank-arena's three row-group shapes need.
 *
 * "One catalog entry" in the step-3 design means one GENRE-DEFINING field
 * kernel. The other two are band kernels the same example needs. No fourth
 * entry is added speculatively.
 */
export const ENTRIES: readonly TemplateEntry[] = [
  {
    id: 'two-sprite-static-field',
    summary: 'two players over a playfield that is static within the band',
    applies: { kinds: ['loop'], objects: 2, copies: 'none' },
    // Primes gfx0/gfx1 one line ahead, then writes GRP0/GRP1 in horizontal
    // blank at the top of each iteration. Reference ROM: priming happens on
    // frame line 65, first rendered line is 66.
    cost: { entryLines: 1, exitLines: 0 },
    perLineData: true,
    // PF0/PF1/PF2 draw the side walls (line 65); COLUP0/COLUP1 are the tank
    // colours, written in the top wall's blank (line 57) because that is the
    // blank available; GRP0/GRP1 are the tanks themselves.
    writes: [PF0, PF1, PF2, COLUP0, COLUP1, GRP0, GRP1],
  },
  {
    id: 'solid-run',
    summary: 'a run of identical lines with the playfield set once',
    applies: { kinds: ['run'], objects: 0, copies: 'none' },
    // PF0/PF1/PF2 are written before the loop and are valid from that same
    // line. Reference ROM: the bottom wall's writes and its first rendered
    // line are both frame line 224.
    cost: { entryLines: 0, exitLines: 0 },
    perLineData: false,
    writes: [PF0, PF1, PF2],
  },
  {
    id: 'bcd-score-band',
    summary: 'one BCD digit per player, drawn from a template font',
    applies: { kinds: ['glyphs'], objects: 2, copies: 'none' },
    // Blank rows, glyph rows and trailing blank rows are all inside the band's
    // authored height; nothing is charged outside it. That is why entryLines is
    // 0 despite perLineData being true -- see the note on TemplateEntry.
    cost: { entryLines: 0, exitLines: 0 },
    perLineData: true,
    // PF0/PF1/PF2 are cleared so no arena wall shows behind the score.
    writes: [PF0, PF1, PF2, COLUP0, COLUP1, GRP0, GRP1],
  },
];

export function entryById(id: string): TemplateEntry | undefined {
  return ENTRIES.find((entry) => entry.id === id);
}
