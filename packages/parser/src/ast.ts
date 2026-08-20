/**
 * The AST.
 *
 * Types only. The parser and the formatter both depend on this module and
 * neither depends on the other, which is what keeps `p1 fmt` honest: it is
 * driven by the tree rather than by the token stream it came from.
 *
 * There is deliberately NO node for an unbounded loop, recursion, or an
 * indirect call. SPEC.md 4.3 requires the game layer to be statically bounded,
 * and the cheapest way to guarantee that is to make it unrepresentable rather
 * than to reject it downstream.
 *
 * On comments: every declaration and band item carries the comment lines that
 * preceded it. A formatter that deletes comments is not usable, and comments in
 * this language carry the reasoning -- which is most of what the project values.
 * Attaching them to nodes rather than keeping a line-keyed side table means they
 * survive any transformation that preserves nodes.
 */

import type { Span } from './span.ts';

export interface Node {
  readonly span: Span;
}

/** Comment lines immediately above a construct, without their leading `#`. */
export interface Commented {
  readonly leading: readonly string[];
}

// --- expressions -----------------------------------------------------------

export type Expr = NumberLit | NameRef | MemberRef | Binary | Call;

export interface NumberLit extends Node {
  readonly kind: 'number';
  readonly value: number;
  /** True when written as $XX, so the formatter can preserve the author's base. */
  readonly hex: boolean;
}
export interface NameRef extends Node {
  readonly kind: 'name';
  readonly name: string;
}
export interface MemberRef extends Node {
  readonly kind: 'member';
  readonly target: string;
  readonly member: string;
  /**
   * True for `a.b`, false for the space-separated `score p0`.
   *
   * Two surface forms reach this one node, and the formatter has to reproduce
   * the one the author wrote -- rendering `score p0` as `score.p0` produces a
   * file that no longer parses. Same reason NumberLit records its base.
   */
  readonly dotted: boolean;
}
export interface Binary extends Node {
  readonly kind: 'binary';
  readonly op: '+' | '-';
  readonly left: Expr;
  readonly right: Expr;
}
/** An intrinsic: joystick(...), random(...), and friends. */
export interface Call extends Node {
  readonly kind: 'call';
  readonly callee: string;
  readonly args: readonly Expr[];
}

// --- statements ------------------------------------------------------------

export type Stmt = Assign | AddAssign | MoveStmt | IfStmt;

export interface Assign extends Node, Commented {
  readonly kind: 'assign';
  readonly target: MemberRef | NameRef;
  readonly value: Expr;
}
export interface AddAssign extends Node, Commented {
  readonly kind: 'addAssign';
  readonly target: MemberRef | NameRef;
  readonly value: Expr;
}
/** `tank0 moves with joystick1 speed 1 within field` */
export interface MoveStmt extends Node, Commented {
  readonly kind: 'move';
  readonly actor: string;
  readonly control: string;
  readonly speed: Expr;
  readonly within: string;
}
export interface IfStmt extends Node, Commented {
  readonly kind: 'if';
  readonly condition: Expr;
  readonly then: readonly Stmt[];
  readonly otherwise: readonly Stmt[];
}

// --- declarations ----------------------------------------------------------

export type Decl =
  | GameDecl
  | TargetDecl
  | CartridgeDecl
  | PaletteDecl
  | SpriteDecl
  | SceneDecl
  | EveryFrameDecl
  | WhenHitsDecl;

export interface GameDecl extends Node, Commented {
  readonly kind: 'game';
  readonly title: string;
}
export interface TargetDecl extends Node, Commented {
  readonly kind: 'target';
  readonly system: string;
}
export interface CartridgeDecl extends Node, Commented {
  readonly kind: 'cartridge';
  readonly size: string;
}
export interface PaletteEntry extends Node, Commented {
  readonly name: string;
  readonly value: number;
  readonly hex: boolean;
}
export interface PaletteDecl extends Node, Commented {
  readonly kind: 'palette';
  readonly name: string;
  readonly entries: readonly PaletteEntry[];
}
export interface SpriteDecl extends Node, Commented {
  readonly kind: 'sprite';
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** One byte per row, MSB leftmost. */
  readonly rows: readonly number[];
  /** Comments interleaved among the pixel rows, keyed by row index. */
  readonly rowComments: ReadonlyMap<number, readonly string[]>;
}

export interface ScoreDecl extends Node, Commented {
  readonly kind: 'score';
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly digits: number;
  readonly start: number;
  readonly color: string;
}
export interface PlayfieldDecl extends Node, Commented {
  readonly kind: 'playfield';
  readonly shape: 'border';
  /** Border thickness in SCANLINES, for the top and bottom runs. */
  readonly thickness: number;
  readonly mode: 'reflect' | 'repeat' | 'asymmetric';
  readonly color: string;
}
export interface ActorDecl extends Node, Commented {
  readonly kind: 'actor';
  readonly name: string;
  readonly sprite: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly controls: string | null;
}
export type BandItem = ScoreDecl | PlayfieldDecl | ActorDecl;

export interface BandDecl extends Node, Commented {
  readonly kind: 'band';
  readonly name: string;
  /** Explicit height in scanlines, or null to take the remainder. */
  readonly height: number | null;
  readonly items: readonly BandItem[];
}
export interface SceneDecl extends Node, Commented {
  readonly kind: 'scene';
  readonly name: string;
  readonly background: string;
  readonly bands: readonly BandDecl[];
}
export interface EveryFrameDecl extends Node, Commented {
  readonly kind: 'everyFrame';
  readonly body: readonly Stmt[];
}
export interface WhenHitsDecl extends Node, Commented {
  readonly kind: 'whenHits';
  readonly a: string;
  readonly b: string;
  readonly body: readonly Stmt[];
}

export interface Program extends Node {
  readonly decls: readonly Decl[];
  /** Comments after the last declaration, which no node could otherwise carry. */
  readonly trailing: readonly string[];
}
