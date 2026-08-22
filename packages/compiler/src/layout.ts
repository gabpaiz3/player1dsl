/**
 * The game IR projected onto hardware.
 *
 * SPEC 5.1's asymmetry becomes concrete here: an actor's x becomes RESPx/HMPx
 * state, while its y becomes a constraint on the selected kernel's per-line
 * comparison, because there is no vertical position register.
 */

import { type Diagnostic, P1Error, type Span } from '@player1dsl/parser';
import {
  entryById,
  type ObjectBinding,
  repositionLines,
  type TiaObject,
} from '@player1dsl/runtime';
import type { BandIr, PlayfieldIr, SceneIr } from './ir.ts';

/** The player objects, in the order bands claim them. */
const PLAYER_OBJECTS: readonly TiaObject[] = ['p0', 'p1'];

/**
 * Bind each band's sprite-bearing declarations to TIA objects.
 *
 * Objects are claimed PER BAND and reused across bands, because that is what
 * the hardware forces: P0 and P1 are the only movable objects on the machine,
 * so a score band and a field band compete for the same two. That competition
 * is what makes a band boundary cost scanlines at all.
 */
export function bindObjects(scene: SceneIr): ObjectBinding[] {
  const bindings: ObjectBinding[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const band of scene.bands) {
    // Scores before actors, so a band containing both claims objects in the
    // order the kernel draws them.
    const holders: { name: string; span: Span }[] = [
      ...scene.scores
        .filter((score) => score.band === band.name)
        .map((score) => ({ name: `score ${score.name}`, span: score.span })),
      ...scene.actors
        .filter((actor) => actor.band === band.name)
        .map((actor) => ({ name: actor.name, span: actor.span })),
    ];

    holders.forEach((holder, index) => {
      const object = PLAYER_OBJECTS[index];
      if (!object) {
        diagnostics.push({
          code: 'E501',
          message:
            `band "${band.name}" needs ${holders.length} movable objects, ` +
            `but the TIA has ${PLAYER_OBJECTS.length} player objects`,
          span: holder.span,
          hint:
            'split the band, or render some of these with the playfield. ' +
            'Multiplexing one object across several actors is a separate kernel.',
        });
        return;
      }
      bindings.push({ holder: holder.name, object, band: band.name, span: holder.span });
    });
  }

  if (diagnostics.length > 0) throw new P1Error(diagnostics);
  return bindings;
}

export type RowGroupKind = 'glyphs' | 'run' | 'entry' | 'loop' | 'transition';

/** Where a row group's line count came from. Printed in the ledger report. */
export type LineSource = 'authored' | 'template' | 'derived' | 'solved';

export interface RowGroup {
  readonly kind: RowGroupKind;
  /** The catalog entry that draws it, or null for compiler-derived groups. */
  readonly template: string | null;
  /** A line count, or 'remainder' for the one group that absorbs the slack. */
  readonly lines: number | 'remainder';
  readonly band: string;
  readonly source: LineSource;
  readonly note: string;
  readonly span: Span;
}

export interface LayoutIr {
  readonly bands: readonly BandIr[];
  readonly rowGroups: readonly RowGroup[];
  readonly bindings: readonly ObjectBinding[];
}

/** The row groups a band decomposes into, before the transition is prepended. */
function decompose(band: BandIr, playfield: PlayfieldIr | undefined): RowGroup[] {
  // A band with an authored height and no playfield is a single glyph run.
  // `[wall][field][wall]` is what an ARENA game decomposes into; most genres
  // do not have it, and nothing below assumes a border exists.
  if (!playfield) {
    return [
      {
        kind: 'glyphs',
        template: 'bcd-score-band',
        lines: band.height ?? 0,
        band: band.name,
        source: 'authored',
        note: `band ${band.name} height ${band.height}`,
        span: band.span,
      },
    ];
  }

  const field = entryById('two-sprite-static-field');
  const run = entryById('solid-run');
  if (!field || !run) throw new Error('catalog is missing an entry the layout needs');

  const wall = (): RowGroup => ({
    kind: 'run',
    template: run.id,
    lines: playfield.thickness,
    band: band.name,
    source: 'authored',
    note: `playfield border thickness ${playfield.thickness}`,
    span: playfield.span,
  });

  const groups: RowGroup[] = [wall()];
  if (field.cost.entryLines > 0) {
    groups.push({
      kind: 'entry',
      template: field.id,
      lines: field.cost.entryLines,
      band: band.name,
      source: 'template',
      note: `${field.id} primes its per-line data one line ahead`,
      span: band.span,
    });
  }
  groups.push({
    kind: 'loop',
    template: field.id,
    lines: band.height ?? 'remainder',
    band: band.name,
    source: band.height === null ? 'solved' : 'authored',
    note: 'the open field',
    span: band.span,
  });
  groups.push(wall());
  return groups;
}

export function layout(scene: SceneIr): LayoutIr {
  const bindings = bindObjects(scene);
  const rowGroups: RowGroup[] = [];
  let previous: readonly ObjectBinding[] = [];

  for (const band of scene.bands) {
    const mine = bindings.filter((b) => b.band === band.name);

    // A boundary costs scanlines only for objects that were already placed
    // somewhere else. The first band positions everything in VBLANK, where it
    // is free -- which is why no transition is charged before it.
    const moved = mine.filter((b) => previous.some((p) => p.object === b.object)).length;
    const lines = repositionLines(moved);
    if (lines > 0) {
      rowGroups.push({
        kind: 'transition',
        template: null,
        lines,
        band: band.name,
        source: 'derived',
        note: `repositioning ${moved} object${moved === 1 ? '' : 's'} entering ${band.name}`,
        span: band.span,
      });
    }

    const playfield = scene.playfields.find((p) => p.band === band.name);
    rowGroups.push(...decompose(band, playfield));
    previous = mine;
  }

  return { bands: scene.bands, rowGroups, bindings };
}
