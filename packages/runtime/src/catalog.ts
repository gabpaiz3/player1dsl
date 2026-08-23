/**
 * The kernel template catalog.
 *
 * Every number in this package was MEASURED, out of a TIA write trace. Nothing
 * here is derived, and nothing here may be tuned to make a total come out
 * right: if the ledger does not balance, the scene is wrong or a measurement is
 * wrong, and either way the build should fail loudly at compile time rather
 * than producing a subtly short frame.
 *
 * Increment 5 widens these types with applicability conditions and the register
 * writes each entry emits. Increment 4 needs only the line costs.
 */

import type { Diagnostic, Span } from '@player1dsl/parser';

/**
 * The movable objects the TIA has. Two players, two missiles, one ball.
 *
 * This is hardware vocabulary, so it lives here rather than in the compiler --
 * and it has to, because `emitRowGroup` needs bindings and lives in this
 * package. Defining it in `layout.ts` would make the runtime depend on the
 * compiler and close a cycle. The compiler owns the binding DECISION; the
 * runtime owns the vocabulary that decision is expressed in.
 */
export type TiaObject = 'p0' | 'p1' | 'm0' | 'm1' | 'ball';

/** One logical thing, bound to one TIA object, for the duration of one band. */
export interface ObjectBinding {
  /** The logical holder: an actor name, or `score p0`. */
  readonly holder: string;
  readonly object: TiaObject;
  readonly band: string;
  readonly span: Span;
}

export interface TemplateCost {
  /**
   * Visible scanlines consumed before the template's first RENDERED line.
   *
   * MEASURED, and deliberately not a general "a region change after a loop exit
   * costs one line" rule -- the reference ROM has two such boundaries and they
   * cost 1 and 0. `perLineData` below is the loop-shape fact behind it:
   *
   *   1 -- the loop's per-line writes follow its WSYNC, so the line the setup
   *        code runs on renders the PREVIOUS region's content. It renders
   *        entry+1 .. entry+N.
   *   0 -- the registers are set before the loop is entered and are valid from
   *        that same line. It renders entry .. entry+N-1.
   *
   * This stays a MEASURED number per entry rather than being computed from
   * `perLineData`, because `bcd-score-band` has the priming shape and still
   * costs 0 -- its entry line falls inside the band's authored height.
   */
  readonly entryLines: number;
  /** Visible scanlines consumed after the last rendered line. */
  readonly exitLines: number;
}

export interface TemplateEntry {
  readonly id: string;
  /** One line on what shape this kernel draws, for the selector's report. */
  readonly summary: string;
  readonly applies: Applicability;
  readonly cost: TemplateCost;
  /**
   * True when the kernel writes per-line data AFTER the WSYNC that begins each
   * line, so the line preceding its first rendered line shows stale content.
   *
   * MEASURED in `scroll-field.asm` and `sprite-formation.asm`, and the reason
   * the field loop costs an entry line. But `entryLines` does NOT simply follow
   * from it: `bcd-score-band` has this shape too, and costs 0, because its
   * priming line sits INSIDE the band's authored height. See
   * docs/kernel-measurements.md, "an entry line can hide inside an authored
   * height".
   */
  readonly perLineData: boolean;
  /** The registers this entry's rendered lines depend on. */
  readonly writes: readonly DeclaredWrite[];
}

/**
 * Visible scanlines charged to reposition `count` movable objects at a band
 * boundary.
 *
 * MEASURED: two scanlines per object for the RESPx strobe, plus one to absorb
 * the HMOVE comb on a line whose background can hide it. The comb cannot be
 * suppressed, only placed.
 *
 * This lives in the runtime rather than the compiler because 2-per-object and
 * the +1 are properties of the positioning routine the runtime emits. The
 * compiler derives only `count`.
 */
export function repositionLines(count: number): number {
  return count === 0 ? 0 : 2 * count + 1;
}

/**
 * The structural kinds a row group can have.
 *
 * Vocabulary rather than a measured cost, which is why it can live in the
 * catalog without a fixture behind it: it names what a region IS, and the
 * compiler decides which kind each region gets. It lives in the runtime for the
 * same reason `TiaObject` does -- `selectTemplate` and, in 5b, `emitRowGroup`
 * both need it, and the runtime must not import from the compiler.
 */
export type RowGroupKind = 'glyphs' | 'run' | 'entry' | 'loop' | 'transition';

/**
 * How an entry draws more than one copy of a sprite.
 *
 * MEASURED for `hardware-nusiz` only: `tests/fixtures/kernels/sprite-formation.asm`
 * showed three NUSIZ copies costing zero extra scanlines and zero extra TIA
 * objects. `repositioned` -- mid-line RESPx multiplexing -- was deliberately NOT
 * measured, and the selector refuses it rather than assuming a cost. An unknown
 * cost the selector can refuse to spend is a fact; an omitted one becomes an
 * assumed zero it will happily spend.
 */
export type CopyMode = 'none' | 'hardware-nusiz' | 'repositioned';

/** When during a scanline a write must land for the picture to be right. */
export type TimingClass = 'exact' | 'blank' | 'deadline';

/** A register a template writes, and the timing the template believes it has. */
export interface DeclaredWrite {
  readonly register: number;
  readonly timing: TimingClass;
}

/**
 * What must be true of a region for an entry to draw it.
 *
 * Every field here comes from docs/kernel-measurements.md's *Vocabulary for
 * increment 5* section, or is structural vocabulary carrying no measured cost.
 * If a field seems obviously needed and neither applies, the measurement is
 * missing -- add the measurement, or leave the field out.
 */
export interface Applicability {
  /**
   * The row-group kinds this entry can be selected to draw.
   *
   * `entry` is absent from every entry's list on purpose: an entry row group is
   * DERIVED from the chosen template's `cost.entryLines`, not selected. Nothing
   * picks a template to draw a priming line.
   */
  readonly kinds: readonly RowGroupKind[];
  /** Movable TIA objects the entry can bind. A region may ask for fewer. */
  readonly objects: number;
  /** The formation strategy the entry draws with. */
  readonly copies: CopyMode;
}

/**
 * What a region asks the selector for.
 *
 * Deliberately NOT `extends Applicability`, though the fields overlap: a
 * request is not a capability, and making them one type makes the nonsense
 * `selectTemplate(entry.applies)` type-check. The scope is a row group rather
 * than a band -- tank-arena's field band selects `solid-run` for its walls and
 * `two-sprite-static-field` for its interior, so one band makes several
 * requests.
 */
export interface BandRequirement {
  readonly band: string;
  readonly kind: RowGroupKind;
  /** Movable TIA objects the region needs drawn. */
  readonly objects: number;
  readonly copies: CopyMode;
  readonly span: Span;
}

/**
 * Check the catalog's own data for the defects a declarative table invites.
 *
 * Returns diagnostics rather than throwing, so a test can feed it deliberately
 * malformed entries and assert it objects. A validator that only ever sees good
 * data is a validator nobody has watched work.
 *
 * `knownRegisters` is INJECTED rather than defined here. The authority on which
 * register numbers exist is the emulator's `TIA_WRITE_NAMES`, and the runtime
 * copying it would create exactly the second, disconnected table review 0.2
 * §1.1 warns about -- one that drifts silently. The caller that has both
 * supplies it.
 *
 * `span` is the location a failure points at. The catalog is source code rather
 * than authored `.p1`, so there is no meaningful span in it; the caller passes
 * whatever context it has.
 */
export function validateCatalog(
  entries: readonly TemplateEntry[],
  knownRegisters: ReadonlySet<number>,
  span: Span,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      diagnostics.push({
        code: 'E610',
        message: `two catalog entries share the id "${entry.id}"`,
        span,
        hint: 'entryById returns the first match, so the second would be unreachable',
      });
    }
    seen.add(entry.id);

    if (entry.writes.length === 0) {
      diagnostics.push({
        code: 'E611',
        message: `catalog entry "${entry.id}" declares no writes, so it cannot render anything`,
        span,
        hint: 'fill in the registers its rendered lines depend on, read off a trace',
      });
    }

    for (const write of entry.writes) {
      if (!knownRegisters.has(write.register)) {
        diagnostics.push({
          code: 'E612',
          message:
            `catalog entry "${entry.id}" writes $${write.register.toString(16).padStart(2, '0')}, ` +
            'which is not a TIA write register',
          span,
        });
      }
    }

    if (entry.cost.entryLines < 0 || entry.cost.exitLines < 0) {
      diagnostics.push({
        code: 'E613',
        message:
          `catalog entry "${entry.id}" costs ${entry.cost.entryLines}/${entry.cost.exitLines} ` +
          'entry/exit lines, and a template cannot give scanlines back',
        span,
      });
    }
  }

  return diagnostics;
}
