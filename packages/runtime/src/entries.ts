import type { TemplateEntry } from './catalog.ts';

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
    // Primes gfx0/gfx1 one line ahead, then writes GRP0/GRP1 in horizontal
    // blank at the top of each iteration. Reference ROM: priming happens on
    // frame line 65, first rendered line is 66.
    cost: { entryLines: 1, exitLines: 0 },
  },
  {
    id: 'solid-run',
    summary: 'a run of identical lines with the playfield set once',
    // PF0/PF1/PF2 are written before the loop and are valid from that same
    // line. Reference ROM: the bottom wall's writes and its first rendered
    // line are both frame line 224.
    cost: { entryLines: 0, exitLines: 0 },
  },
  {
    id: 'bcd-score-band',
    summary: 'one BCD digit per player, drawn from a template font',
    // Blank rows, glyph rows and trailing blank rows are all inside the band's
    // authored height; nothing is charged outside it.
    cost: { entryLines: 0, exitLines: 0 },
  },
];

export function entryById(id: string): TemplateEntry | undefined {
  return ENTRIES.find((entry) => entry.id === id);
}
