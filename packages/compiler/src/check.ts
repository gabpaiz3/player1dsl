/**
 * AST to game IR, with diagnostics.
 *
 * Every diagnostic accumulates; one P1Error is thrown at the end. A checker that
 * stops at the first problem makes the author round-trip once per mistake, and
 * the second error is often the one that explains the first.
 */

import {
  type ActorDecl,
  type Diagnostic,
  P1Error,
  type PaletteDecl,
  type PlayfieldDecl,
  type Program,
  type SceneDecl,
  type ScoreDecl,
  type Span,
  type SpriteDecl,
  type Stmt,
} from '@player1dsl/parser';
import type {
  ActorIr,
  BandIr,
  GameIr,
  PlayfieldIr,
  RuleAction,
  ScoreIr,
  SpriteIr,
  Variable,
  WhenHitsIr,
} from './ir.ts';

/** The visible field, in pixels and scanlines. SPEC 3. */
const VISIBLE_WIDTH = 160;
const VISIBLE_HEIGHT = 192;
const BYTE_MAX = 255;

class Checker {
  readonly diagnostics: Diagnostic[] = [];

  private report(code: string, message: string, span: Span, hint?: string): void {
    this.diagnostics.push(hint ? { code, message, span, hint } : { code, message, span });
  }

  check(program: Program): GameIr {
    let title = '';
    let target: 'ntsc' = 'ntsc';
    const palette = new Map<string, number>();
    const sprites: SpriteIr[] = [];
    let scene: SceneDecl | null = null;
    const everyFrameStmts: Stmt[] = [];
    const whenHits: { decl: { a: string; b: string; span: Span }; body: readonly Stmt[] }[] = [];

    for (const decl of program.decls) {
      switch (decl.kind) {
        case 'game':
          title = decl.title;
          break;
        case 'target':
          if (decl.system !== 'ntsc') {
            this.report(
              'E210',
              `unsupported target "${decl.system}"`,
              decl.span,
              'phase 1 is NTSC only',
            );
          } else target = 'ntsc';
          break;
        case 'cartridge':
          if (decl.size !== '4k') {
            this.report(
              'E211',
              `unsupported cartridge size "${decl.size}"`,
              decl.span,
              'phase 1 targets unbanked 4k only; F8 banking is phase 2 (SPEC 3)',
            );
          }
          break;
        case 'palette':
          this.collectPalette(decl, palette);
          break;
        case 'sprite':
          sprites.push(this.collectSprite(decl));
          break;
        case 'scene':
          if (scene) this.report('E212', 'a project declares one scene in phase 1', decl.span);
          else scene = decl;
          break;
        case 'everyFrame':
          everyFrameStmts.push(...decl.body);
          break;
        case 'whenHits':
          whenHits.push({ decl: { a: decl.a, b: decl.b, span: decl.span }, body: decl.body });
          break;
      }
    }

    if (!scene) {
      const span: Span = program.span;
      this.report('E213', 'a project needs a scene', span);
      throw new P1Error(this.diagnostics);
    }

    const spriteNames = new Set(sprites.map((s) => s.name));
    const sceneIr = this.collectScene(scene, palette, spriteNames);
    const variables = this.collectVariables(sceneIr);
    const known = new Set(variables.map((v) => v.name));
    const actorNames = new Set(sceneIr.actors.map((a) => a.name));
    const bandNames = new Set(sceneIr.bands.map((b) => b.name));

    const everyFrame = {
      actions: everyFrameStmts.flatMap((stmt) =>
        this.lowerStmt(stmt, actorNames, bandNames, known),
      ),
    };

    const collisions: WhenHitsIr[] = whenHits.map(({ decl, body }) => {
      for (const name of [decl.a, decl.b]) {
        if (!actorNames.has(name)) {
          this.report('E204', `no actor named "${name}"`, decl.span);
        }
      }
      const debounce = `${decl.a}_${decl.b}_hit`;
      variables.push({ name: debounce, type: 'bool', initial: 0 });
      known.add(debounce);
      return {
        a: decl.a,
        b: decl.b,
        debounce,
        actions: body.flatMap((stmt) => this.lowerStmt(stmt, actorNames, bandNames, known)),
      };
    });

    if (this.diagnostics.length > 0) throw new P1Error(this.diagnostics);
    return {
      title,
      target,
      cartridge: '4k',
      sprites,
      scene: sceneIr,
      everyFrame,
      collisions,
      variables,
    };
  }

  private collectPalette(decl: PaletteDecl, into: Map<string, number>): void {
    for (const entry of decl.entries) {
      if (into.has(entry.name)) {
        this.report('E214', `colour "${entry.name}" is defined twice`, entry.span);
      }
      if (entry.value > BYTE_MAX) {
        this.report('E205', `colour value ${entry.value} does not fit in a byte`, entry.span);
      }
      into.set(entry.name, entry.value);
    }
  }

  private collectSprite(decl: SpriteDecl): SpriteIr {
    if (decl.width !== 8) {
      this.report(
        'E215',
        `sprite "${decl.name}" is ${decl.width} pixels wide`,
        decl.span,
        'a TIA player object is exactly 8 pixels wide',
      );
    }
    return { name: decl.name, width: decl.width, height: decl.height, rows: decl.rows };
  }

  private colour(name: string, palette: Map<string, number>, span: Span): number {
    const value = palette.get(name);
    if (value === undefined) {
      this.report('E201', `no colour named "${name}" in the palette`, span);
      return 0;
    }
    return value;
  }

  private position(x: number, y: number, span: Span): void {
    if (x < 0 || x >= VISIBLE_WIDTH) {
      this.report(
        'E203',
        `x position ${x} is outside the visible field`,
        span,
        `0 to ${VISIBLE_WIDTH - 1}`,
      );
    }
    if (y < 0 || y >= VISIBLE_HEIGHT) {
      this.report(
        'E203',
        `y position ${y} is outside the visible field`,
        span,
        `0 to ${VISIBLE_HEIGHT - 1}`,
      );
    }
  }

  private collectScene(
    decl: SceneDecl,
    palette: Map<string, number>,
    spriteNames: Set<string>,
  ): GameIr['scene'] {
    const bands: BandIr[] = [];
    const actors: ActorIr[] = [];
    const scores: ScoreIr[] = [];
    const playfields: PlayfieldIr[] = [];

    for (const band of decl.bands) {
      bands.push({ name: band.name, height: band.height });
      for (const item of band.items) {
        if (item.kind === 'actor')
          actors.push(this.collectActor(item, band.name, palette, spriteNames));
        else if (item.kind === 'score') scores.push(this.collectScore(item, band.name, palette));
        else playfields.push(this.collectPlayfield(item, band.name, palette));
      }
    }

    // The remainder can only be given to one band, so two open bands is not a
    // preference the compiler can resolve -- it is an ambiguity.
    const open = bands.filter((b) => b.height === null);
    if (open.length > 1) {
      this.report(
        'E216',
        `${open.length} bands have no height; only one can take the remainder`,
        decl.span,
        `give a height to all but one of: ${open.map((b) => b.name).join(', ')}`,
      );
    }

    return {
      name: decl.name,
      background: this.colour(decl.background, palette, decl.span),
      bands,
      actors,
      scores,
      playfields,
    };
  }

  private collectActor(
    decl: ActorDecl,
    band: string,
    palette: Map<string, number>,
    spriteNames: Set<string>,
  ): ActorIr {
    if (!spriteNames.has(decl.sprite)) {
      this.report('E202', `no sprite named "${decl.sprite}"`, decl.span);
    }
    this.position(decl.x, decl.y, decl.span);
    return {
      name: decl.name,
      sprite: decl.sprite,
      color: this.colour(decl.color, palette, decl.span),
      x: decl.x,
      y: decl.y,
      controls: decl.controls,
      band,
    };
  }

  private collectScore(decl: ScoreDecl, band: string, palette: Map<string, number>): ScoreIr {
    if (decl.digits !== 1) {
      this.report(
        'E217',
        `score "${decl.name}" asks for ${decl.digits} digits`,
        decl.span,
        'phase 1 renders one digit per score; NUSIZ copies share graphics, so extra digits need a mid-line GRP rewrite kernel (SPEC 7.1)',
      );
    }
    if (decl.start > 9) {
      this.report('E205', `a one-digit score cannot start at ${decl.start}`, decl.span);
    }
    return {
      name: decl.name,
      x: decl.x,
      y: decl.y,
      digits: decl.digits,
      start: decl.start,
      color: this.colour(decl.color, palette, decl.span),
      band,
    };
  }

  private collectPlayfield(
    decl: PlayfieldDecl,
    band: string,
    palette: Map<string, number>,
  ): PlayfieldIr {
    if (decl.thickness <= 0) {
      this.report('E218', 'playfield border thickness must be at least 1 scanline', decl.span);
    }
    return {
      shape: decl.shape,
      thickness: decl.thickness,
      mode: decl.mode,
      color: this.colour(decl.color, palette, decl.span),
      band,
    };
  }

  private collectVariables(scene: GameIr['scene']): Variable[] {
    const variables: Variable[] = [];
    for (const actor of scene.actors) {
      variables.push({ name: `${actor.name}_x`, type: 'byte', initial: actor.x });
      variables.push({ name: `${actor.name}_y`, type: 'byte', initial: actor.y });
    }
    for (const score of scene.scores) {
      variables.push({ name: `${score.name}_score`, type: 'byte', initial: score.start });
    }
    return variables;
  }

  private lowerStmt(
    stmt: Stmt,
    actors: Set<string>,
    bands: Set<string>,
    variables: Set<string>,
  ): RuleAction[] {
    switch (stmt.kind) {
      case 'move': {
        if (!actors.has(stmt.actor)) {
          this.report('E204', `no actor named "${stmt.actor}"`, stmt.span);
        }
        if (!bands.has(stmt.within)) {
          this.report('E206', `no band named "${stmt.within}" to bound movement`, stmt.span);
        }
        const speed = stmt.speed.kind === 'number' ? stmt.speed.value : 0;
        if (stmt.speed.kind !== 'number') {
          this.report('E207', 'movement speed must be a literal number', stmt.span);
        }
        return [
          { kind: 'move', actor: stmt.actor, control: stmt.control, speed, within: stmt.within },
        ];
      }
      case 'addAssign': {
        const name = this.variableName(stmt.target);
        if (!variables.has(name)) {
          this.report('E208', `no state named "${name}"`, stmt.span);
        }
        const amount = stmt.value.kind === 'number' ? stmt.value.value : 0;
        if (stmt.value.kind !== 'number') {
          this.report('E207', 'the amount added must be a literal number', stmt.span);
        }
        return [{ kind: 'add', variable: name, amount }];
      }
      default:
        this.report('E209', `"${stmt.kind}" is not supported in phase 1 rules`, stmt.span);
        return [];
    }
  }

  /** `score p0` and `p0.score` both name the same state. */
  private variableName(target: {
    kind: string;
    name?: string;
    target?: string;
    member?: string;
  }): string {
    if (target.kind === 'member') return `${target.member}_${target.target}`;
    return target.name ?? '';
  }
}

export function check(program: Program): GameIr {
  return new Checker().check(program);
}
