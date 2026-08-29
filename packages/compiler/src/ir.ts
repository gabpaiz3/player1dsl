/**
 * The game IR: pure semantics.
 *
 * No scanlines, no TIA registers, no cycle costs. Those belong to the layout IR
 * (plan 3), and keeping them out is what makes this layer testable without any
 * hardware model at all. A test asserts the absence, because "no hardware detail
 * leaked in" is the kind of property that erodes one convenient field at a time.
 */

import type { Span } from '@player1dsl/parser';

export type ValueType = 'byte' | 'bool';

/** A named piece of state. Addresses are assigned later, by the RAM allocator. */
export interface Variable {
  readonly name: string;
  readonly type: ValueType;
  readonly initial: number;
}

export interface SpriteIr {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly number[];
}

export interface ActorIr {
  readonly name: string;
  readonly sprite: string;
  /** Colour resolved from the palette to its literal value. */
  readonly color: number;
  readonly x: number;
  readonly y: number;
  readonly controls: string | null;
  /** The band this actor is declared in. */
  readonly band: string;
  /**
   * Where this was written. Not hardware detail -- a source location, so the
   * layout layer can point a diagnostic at the construct that caused it.
   */
  readonly span: Span;
}

export interface ScoreIr {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly digits: number;
  readonly start: number;
  readonly color: number;
  readonly band: string;
  /** Where this was written. See the note on ActorIr.span. */
  readonly span: Span;
}

export interface PlayfieldIr {
  readonly shape: 'border';
  /** Border thickness in scanlines, as authored. */
  readonly thickness: number;
  readonly mode: 'reflect' | 'repeat' | 'asymmetric';
  readonly color: number;
  readonly band: string;
  /** Where this was written. See the note on ActorIr.span. */
  readonly span: Span;
}

export interface BandIr {
  readonly name: string;
  /** Authored height, or null when this band takes the remainder. */
  readonly height: number | null;
  /** Where this was written. See the note on ActorIr.span. */
  readonly span: Span;
}

export interface SceneIr {
  readonly name: string;
  readonly background: number;
  readonly bands: readonly BandIr[];
  readonly actors: readonly ActorIr[];
  readonly scores: readonly ScoreIr[];
  readonly playfields: readonly PlayfieldIr[];
}

/** A movement rule, resolved to the actor and bounds it names. */
export interface MoveRule {
  readonly kind: 'move';
  readonly actor: string;
  readonly control: string;
  readonly speed: number;
  /** The band whose extent bounds this actor. */
  readonly within: string;
}

export interface AddRule {
  readonly kind: 'add';
  readonly variable: string;
  readonly amount: number;
}

export type RuleAction = MoveRule | AddRule;

export interface EveryFrameIr {
  readonly actions: readonly RuleAction[];
}

/**
 * `when A hits B`.
 *
 * The latches are LEVEL, not edge, so scoring once per contact needs a debounce
 * flag in RAM that the compiler generates. `debounce` names the variable that
 * holds it; nothing in the source asked for it.
 */
export interface WhenHitsIr {
  readonly a: string;
  readonly b: string;
  readonly debounce: string;
  readonly actions: readonly RuleAction[];
}

export interface GameIr {
  readonly title: string;
  readonly target: 'ntsc';
  readonly cartridge: '4k';
  readonly sprites: readonly SpriteIr[];
  readonly scene: SceneIr;
  readonly everyFrame: EveryFrameIr;
  readonly collisions: readonly WhenHitsIr[];
  readonly variables: readonly Variable[];
}
