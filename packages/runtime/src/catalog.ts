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

import type { Span } from '@player1dsl/parser';

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
   * cost 1 and 0. The discriminator is where the loop writes its per-line
   * registers:
   *
   *   1 -- the loop writes per-line registers in the horizontal blank at the TOP
   *        of each iteration, so its first iteration needs data that already
   *        exists. It renders entry+1 .. entry+N.
   *   0 -- the loop's registers are set once before it runs and are valid from
   *        that same line. It renders entry .. entry+N-1.
   */
  readonly entryLines: number;
  /** Visible scanlines consumed after the last rendered line. */
  readonly exitLines: number;
}

export interface TemplateEntry {
  readonly id: string;
  /** One line on what shape this kernel draws, for the selector's report. */
  readonly summary: string;
  readonly cost: TemplateCost;
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
