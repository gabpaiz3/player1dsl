/**
 * Choosing a kernel template for one row group.
 *
 * The selector is a filter over `applies` followed by a total tie-break. It
 * deliberately does no arithmetic: what a template costs is measured and
 * recorded in `entries.ts`, and the selector's job is only to pick one and to
 * explain itself when it cannot.
 */

import type { Diagnostic } from '@player1dsl/parser';
import type { BandRequirement, CopyMode, TemplateEntry } from './catalog.ts';
import { ENTRIES } from './entries.ts';

export type SelectResult =
  | { readonly ok: true; readonly entry: TemplateEntry }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Copy strategies whose cost a fixture has actually measured.
 *
 * `repositioned` -- mid-line RESPx multiplexing -- is absent, and that absence
 * is the point. `sprite-formation.asm` measured NUSIZ copies and deliberately
 * did not measure this one, so its separation, reload budget and exact-clock
 * requirements are all unknown. Letting it through would mean spending a cost
 * of zero that nobody has checked is zero.
 */
const MEASURED_COPY_MODES: ReadonlySet<CopyMode> = new Set<CopyMode>(['none', 'hardware-nusiz']);

/** Total line cost, the first tie-break key. */
function totalCost(entry: TemplateEntry): number {
  return entry.cost.entryLines + entry.cost.exitLines;
}

export function selectTemplate(
  requirement: BandRequirement,
  entries: readonly TemplateEntry[] = ENTRIES,
): SelectResult {
  if (!MEASURED_COPY_MODES.has(requirement.copies)) {
    return {
      ok: false,
      diagnostic: {
        code: 'E602',
        message:
          `band "${requirement.band}" asks for ${requirement.copies} copies, whose scanline ` +
          'cost has never been measured',
        span: requirement.span,
        hint:
          'no template can be selected for a cost nobody has checked. Add a fixture ' +
          'under tests/fixtures/kernels/ that measures it, then an entry that declares it.',
      },
    };
  }

  const drawsThisKind = entries.filter((entry) => entry.applies.kinds.includes(requirement.kind));
  const candidates = drawsThisKind.filter(
    (entry) =>
      entry.applies.objects >= requirement.objects && entry.applies.copies === requirement.copies,
  );

  // The tie-break, stated so it stays true: lowest total line cost, then id
  // alphabetically. Both keys are total, so the result does not depend on the
  // order entries.ts happens to list them in -- a selector that did would change
  // its output when someone sorted the file.
  const [best] = [...candidates].sort(
    (a, b) => totalCost(a) - totalCost(b) || a.id.localeCompare(b.id),
  );
  if (best) return { ok: true, entry: best };

  return { ok: false, diagnostic: unsatisfied(requirement, drawsThisKind) };
}

/**
 * Say what was asked for AND what is on offer.
 *
 * A diagnostic reading "no template applies" is true and useless: it does not
 * say whether to change the scene, pick a different band shape, or write a
 * template. The two cases below send the reader to different places.
 */
function unsatisfied(
  requirement: BandRequirement,
  drawsThisKind: readonly TemplateEntry[],
): Diagnostic {
  if (drawsThisKind.length === 0) {
    return {
      code: 'E601',
      message: `no kernel template draws a "${requirement.kind}" region`,
      span: requirement.span,
      hint: 'the catalog has entries for glyphs, runs and loops',
    };
  }

  const most = Math.max(...drawsThisKind.map((entry) => entry.applies.objects));
  if (requirement.objects > most) {
    return {
      code: 'E601',
      message:
        `band "${requirement.band}" needs ${requirement.objects} movable objects; the most ` +
        `any template provides is ${most}`,
      span: requirement.span,
      hint: 'split the band, or render some of these with the playfield',
    };
  }

  const offered = drawsThisKind.map((entry) => `${entry.id} (${entry.applies.copies})`).join(', ');
  return {
    code: 'E601',
    message:
      `band "${requirement.band}" asks for ${requirement.copies} copies, which no template ` +
      `drawing a "${requirement.kind}" region provides: ${offered}`,
    span: requirement.span,
    hint: 'the cost is known; what is missing is a template that spends it',
  };
}
