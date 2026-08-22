/**
 * The line ledger: every visible scanline belongs to exactly one row group.
 *
 * This is a HARD GATE. If the row groups do not sum to exactly the target's
 * visible budget, the build fails with a diagnostic naming the shortfall. A
 * compiler that silently emits 191 or 193 produces the defect class step 2
 * found in the reference kernel itself -- two errors that cancelled in the
 * frame total and survived five rounds of visual verification.
 */

import { type Diagnostic, P1Error } from '@player1dsl/parser';
import type { LayoutIr, LineSource, RowGroupKind } from './layout.ts';

/** SPEC 3: NTSC is 3 VSYNC + 37 VBLANK + 192 visible + 30 overscan. */
export const NTSC_VISIBLE_LINES = 192;
export const NTSC_FIRST_VISIBLE_LINE = 40;

export interface LedgerRow {
  readonly band: string;
  readonly kind: RowGroupKind;
  readonly template: string | null;
  readonly lines: number;
  /** Frame-absolute, so it can be compared against a trace directly. */
  readonly firstLine: number;
  readonly lastLine: number;
  readonly source: LineSource;
  readonly note: string;
}

export interface Ledger {
  readonly rows: readonly LedgerRow[];
  readonly total: number;
  readonly visibleLines: number;
  readonly firstVisibleLine: number;
}

export function buildLedger(ir: LayoutIr): Ledger {
  const groups = ir.rowGroups;
  const remainders = groups.filter((g) => g.lines === 'remainder');
  const diagnostics: Diagnostic[] = [];

  // A ledger with no row groups is a scene with no bands, which the checker
  // rejects long before here. Fail loudly rather than reaching for a `!` that
  // Biome forbids and that would hide the case if it ever became reachable.
  const firstSpan = groups[0]?.span;
  if (!firstSpan) throw new Error('buildLedger was given a layout with no row groups');

  if (remainders.length > 1) {
    for (const group of remainders.slice(1)) {
      diagnostics.push({
        code: 'E502',
        message: `band "${group.band}" also takes the remaining lines, but "${remainders[0]?.band}" already does`,
        span: group.span,
        hint: 'give all but one band an explicit height',
      });
    }
    throw new P1Error(diagnostics);
  }

  const fixed = groups.reduce((sum, g) => sum + (g.lines === 'remainder' ? 0 : g.lines), 0);
  const remainder = remainders[0];

  if (!remainder && fixed !== NTSC_VISIBLE_LINES) {
    const last = groups.at(-1);
    throw new P1Error([
      {
        code: 'E503',
        message:
          `the visible region is ${fixed} scanlines, but NTSC has exactly ${NTSC_VISIBLE_LINES}: ` +
          `${fixed > NTSC_VISIBLE_LINES ? `${fixed - NTSC_VISIBLE_LINES} too many` : `${NTSC_VISIBLE_LINES - fixed} short`}`,
        span: last?.span ?? firstSpan,
        hint:
          'change a band height, or leave one band without a height so it takes ' +
          'whatever the others leave. Band transitions and template entry lines ' +
          'are charged too -- run `p1 check` to see the full ledger.',
      },
    ]);
  }

  const solved = remainder ? NTSC_VISIBLE_LINES - fixed : 0;
  if (remainder && solved <= 0) {
    throw new P1Error([
      {
        code: 'E504',
        message:
          `band "${remainder.band}" has ${solved} scanlines left after the other row groups ` +
          `take ${fixed} of ${NTSC_VISIBLE_LINES}`,
        span: remainder.span,
        hint: 'reduce another band height, or the playfield border thickness',
      },
    ]);
  }

  const rows: LedgerRow[] = [];
  let line = NTSC_FIRST_VISIBLE_LINE;
  for (const group of groups) {
    const lines = group.lines === 'remainder' ? solved : group.lines;
    rows.push({
      band: group.band,
      kind: group.kind,
      template: group.template,
      lines,
      firstLine: line,
      lastLine: line + lines - 1,
      source: group.source,
      note: group.note,
    });
    line += lines;
  }

  const total = rows.reduce((sum, row) => sum + row.lines, 0);

  // Belt and braces: the arithmetic above cannot produce a wrong total, but
  // this gate is the one thing standing between a bug here and a silently
  // short frame, so it asserts rather than trusts.
  if (total !== NTSC_VISIBLE_LINES) {
    throw new P1Error([
      {
        code: 'E503',
        message: `the ledger sums to ${total}, not ${NTSC_VISIBLE_LINES}`,
        span: firstSpan,
      },
    ]);
  }

  return {
    rows,
    total,
    visibleLines: NTSC_VISIBLE_LINES,
    firstVisibleLine: NTSC_FIRST_VISIBLE_LINE,
  };
}

/** The ledger as a table, for `p1 check`. */
export function formatLedger(ledger: Ledger): string {
  const header = ['band', 'kind', 'lines', 'frame lines', 'from', 'note'];
  const body = ledger.rows.map((row) => [
    row.band,
    row.kind,
    String(row.lines),
    `${row.firstLine}-${row.lastLine}`,
    row.source,
    row.note,
  ]);
  const widths = header.map((_, i) =>
    Math.max(header[i]?.length ?? 0, ...body.map((cells) => cells[i]?.length ?? 0)),
  );
  const render = (cells: readonly string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  return [
    render(header),
    render(widths.map((w) => '-'.repeat(w))),
    ...body.map(render),
    '',
    `${ledger.total} of ${ledger.visibleLines} visible scanlines`,
  ].join('\n');
}
