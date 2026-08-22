/**
 * The game IR projected onto hardware.
 *
 * SPEC 5.1's asymmetry becomes concrete here: an actor's x becomes RESPx/HMPx
 * state, while its y becomes a constraint on the selected kernel's per-line
 * comparison, because there is no vertical position register.
 */

import { type Diagnostic, P1Error, type Span } from '@player1dsl/parser';
import type { ObjectBinding, TiaObject } from '@player1dsl/runtime';
import type { SceneIr } from './ir.ts';

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
