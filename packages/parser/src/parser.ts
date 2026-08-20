/**
 * Tokens to AST, by recursive descent.
 *
 * Diagnostics accumulate and the parser resynchronises to the next line rather
 * than stopping at the first error, so one run reports everything wrong with a
 * file. A compiler that reports one error per run makes the author round-trip
 * once per mistake.
 */

import type {
  ActorDecl,
  BandDecl,
  BandItem,
  Decl,
  Expr,
  PaletteEntry,
  PlayfieldDecl,
  Program,
  ScoreDecl,
  SpriteDecl,
  Stmt,
} from './ast.ts';
import { lex, type Token } from './lexer.ts';
import { type Diagnostic, P1Error, type Span } from './span.ts';

/** Thrown internally to unwind to the nearest resynchronisation point. */
class Bail extends Error {}

const PLAYFIELD_MODES = new Set(['reflect', 'repeat', 'asymmetric']);

class Parser {
  private index = 0;
  private pending: string[] = [];
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly tokens: readonly Token[]) {}

  // --- token access --------------------------------------------------------

  /**
   * Comments never reach the grammar. They are drained here into `pending` and
   * claimed by whichever construct starts next, which is what lets every rule
   * below stay unaware that comments exist.
   */
  private drain(): void {
    while (this.tokens[this.index]?.kind === 'comment') {
      this.pending.push(this.tokens[this.index]?.text ?? '');
      this.index += 1;
    }
  }

  private peek(offset = 0): Token {
    this.drain();
    return this.tokens[this.index + offset] ?? (this.tokens.at(-1) as Token);
  }

  private next(): Token {
    this.drain();
    const token = this.peek();
    if (token.kind !== 'eof') this.index += 1;
    return token;
  }

  /** Take the comments accumulated above the construct starting here. */
  private takeComments(): string[] {
    this.drain();
    const taken = this.pending;
    this.pending = [];
    return taken;
  }

  private at(kind: Token['kind'], text?: string): boolean {
    const token = this.peek();
    return token.kind === kind && (text === undefined || token.text === text);
  }

  private error(message: string, code: string, span: Span, hint?: string): never {
    this.diagnostics.push(hint ? { code, message, span, hint } : { code, message, span });
    throw new Bail(message);
  }

  private expect(kind: Token['kind'], code: string, text?: string): Token {
    if (!this.at(kind, text)) {
      const token = this.peek();
      this.error(
        `expected ${text ?? kind}, found ${token.kind === 'newline' ? 'end of line' : `"${token.text || token.kind}"`}`,
        code,
        token.span,
      );
    }
    return this.next();
  }

  private name(code = 'E101'): string {
    return this.expect('name', code).text;
  }

  private number(code = 'E102'): { value: number; hex: boolean } {
    const token = this.peek();
    if (token.kind !== 'number' && token.kind !== 'hex') {
      this.error(`expected a number, found "${token.text || token.kind}"`, code, token.span);
    }
    this.next();
    return { value: token.value ?? 0, hex: token.kind === 'hex' };
  }

  private punct(text: string, code = 'E103'): Token {
    return this.expect('punct', code, text);
  }

  private endOfLine(code = 'E104'): void {
    this.expect('newline', code);
  }

  /** Skip forward to the start of the next line, for error recovery. */
  private resync(): void {
    while (!this.at('eof')) {
      const token = this.next();
      if (token.kind === 'newline') return;
    }
  }

  // --- blocks --------------------------------------------------------------

  /** `:` newline INDENT ... DEDENT */
  private openBlock(code = 'E105'): void {
    this.punct(':', code);
    this.endOfLine(code);
    this.expect('indent', code);
  }

  private atBlockEnd(): boolean {
    return this.at('dedent') || this.at('eof');
  }

  private closeBlock(): void {
    if (this.at('dedent')) this.next();
  }

  // --- program -------------------------------------------------------------

  parseProgram(file: string): Program {
    const decls: Decl[] = [];
    const span: Span = { file, offset: 0, length: 0, line: 1, column: 1 };

    while (!this.at('eof')) {
      if (this.at('newline')) {
        this.next();
        continue;
      }
      if (this.at('dedent')) {
        this.next();
        continue;
      }
      try {
        decls.push(this.parseDecl());
      } catch (error) {
        if (!(error instanceof Bail)) throw error;
        this.pending = [];
        this.resync();
      }
    }

    // Anything still pending followed the last declaration.
    const trailing = this.takeComments();
    return { span, decls, trailing };
  }

  private parseDecl(): Decl {
    const leading = this.takeComments();
    const token = this.peek();
    const span = token.span;

    if (token.kind !== 'name') {
      this.error(`expected a declaration, found "${token.text || token.kind}"`, 'E100', span);
    }

    switch (token.text) {
      case 'game': {
        this.next();
        const title = this.expect('string', 'E101').text;
        this.endOfLine();
        return { kind: 'game', span, leading, title };
      }
      case 'target': {
        this.next();
        const system = this.name();
        this.endOfLine();
        return { kind: 'target', span, leading, system };
      }
      case 'cartridge': {
        this.next();
        // `4k` lexes as number(4) then name("k") -- the digit run stops at the
        // suffix. Rejoin them rather than teaching the lexer about sizes, which
        // would put a domain concept in the wrong layer.
        let size: string;
        if (this.at('name')) {
          size = this.name();
        } else {
          const digits = this.number().value;
          size = `${digits}${this.at('name') ? this.name() : ''}`;
        }
        this.endOfLine();
        return { kind: 'cartridge', span, leading, size };
      }
      case 'palette':
        return this.parsePalette(leading, span);
      case 'sprite':
        return this.parseSprite(leading, span);
      case 'scene':
        return this.parseScene(leading, span);
      case 'every':
        return this.parseEveryFrame(leading, span);
      case 'when':
        return this.parseWhenHits(leading, span);
      default:
        this.error(`unknown declaration "${token.text}"`, 'E100', span);
    }
  }

  private parsePalette(leading: string[], span: Span): Decl {
    this.next();
    const name = this.name();
    this.openBlock();

    const entries: PaletteEntry[] = [];
    while (!this.atBlockEnd()) {
      if (this.at('newline')) {
        this.next();
        continue;
      }
      const entryComments = this.takeComments();
      const entrySpan = this.peek().span;
      const entryName = this.name();
      this.punct('=');
      const { value, hex } = this.number();
      this.endOfLine();
      entries.push({ span: entrySpan, leading: entryComments, name: entryName, value, hex });
    }
    this.closeBlock();
    return { kind: 'palette', span, leading, name, entries };
  }

  private parseSprite(leading: string[], span: Span): SpriteDecl {
    this.next();
    const name = this.name();
    const width = this.number().value;
    this.punct('x');
    const height = this.number().value;
    this.openBlock();

    const rows: number[] = [];
    const rowComments = new Map<number, readonly string[]>();
    while (!this.atBlockEnd()) {
      if (this.at('newline')) {
        this.next();
        continue;
      }
      const comments = this.takeComments();
      if (comments.length > 0) rowComments.set(rows.length, comments);
      if (this.atBlockEnd()) break;

      // A pixel row lexes as a run of name and punct tokens (X and .), so it is
      // reassembled from the raw text rather than parsed as a grammar rule.
      const rowSpan = this.peek().span;
      let text = '';
      while (!this.at('newline') && !this.at('eof')) text += this.next().text;

      if (text.length !== width) {
        this.diagnostics.push({
          code: 'E120',
          message: `sprite row is ${text.length} pixels wide, but "${name}" declares ${width}`,
          span: rowSpan,
          hint: 'each row needs exactly one X or . per declared pixel',
        });
      } else {
        let byte = 0;
        for (let bit = 0; bit < width; bit += 1) {
          if (text[bit] === 'X') byte |= 0x80 >> bit;
          else if (text[bit] !== '.') {
            this.diagnostics.push({
              code: 'E121',
              message: `"${text[bit]}" is not a pixel; use X or .`,
              span: rowSpan,
            });
          }
        }
        rows.push(byte);
      }
      this.endOfLine();
    }
    this.closeBlock();

    if (rows.length !== height && this.diagnostics.length === 0) {
      this.diagnostics.push({
        code: 'E122',
        message: `sprite "${name}" declares ${height} rows but has ${rows.length}`,
        span,
      });
    }
    return { kind: 'sprite', span, leading, name, width, height, rows, rowComments };
  }

  private parseScene(leading: string[], span: Span): Decl {
    this.next();
    const name = this.name();
    this.openBlock();

    let background = '';
    const bands: BandDecl[] = [];
    while (!this.atBlockEnd()) {
      if (this.at('newline')) {
        this.next();
        continue;
      }
      const itemComments = this.takeComments();
      const itemSpan = this.peek().span;
      const keyword = this.name();
      if (keyword === 'background') {
        background = this.name();
        this.endOfLine();
        continue;
      }
      if (keyword === 'band') {
        bands.push(this.parseBand(itemComments, itemSpan));
        continue;
      }
      this.error(`unexpected "${keyword}" in scene "${name}"`, 'E106', itemSpan);
    }
    this.closeBlock();
    return { kind: 'scene', span, leading, name, background, bands };
  }

  private parseBand(leading: string[], span: Span): BandDecl {
    const name = this.name();
    let height: number | null = null;
    if (this.at('name', 'height')) {
      this.next();
      height = this.number().value;
    }
    this.openBlock();

    const items: BandItem[] = [];
    while (!this.atBlockEnd()) {
      if (this.at('newline')) {
        this.next();
        continue;
      }
      items.push(this.parseBandItem());
    }
    this.closeBlock();
    return { kind: 'band', span, leading, name, height, items };
  }

  private parseBandItem(): BandItem {
    const leading = this.takeComments();
    const span = this.peek().span;
    const keyword = this.name();
    switch (keyword) {
      case 'score':
        return this.parseScore(leading, span);
      case 'playfield':
        return this.parsePlayfield(leading, span);
      case 'actor':
        return this.parseActor(leading, span);
      default:
        this.error(`unexpected "${keyword}" in a band`, 'E107', span);
    }
  }

  /** `score p0 at (60, 2) digits 1 start 3 color hud` */
  private parseScore(leading: string[], span: Span): ScoreDecl {
    const name = this.name();
    this.expect('name', 'E108', 'at');
    const [x, y] = this.parsePoint();
    let digits = 1;
    let start = 0;
    let color = '';
    while (this.at('name')) {
      const key = this.name();
      if (key === 'digits') digits = this.number().value;
      else if (key === 'start') start = this.number().value;
      else if (key === 'color') color = this.name();
      else this.error(`unknown score attribute "${key}"`, 'E109', span);
    }
    this.endOfLine();
    return { kind: 'score', span, leading, name, x, y, digits, start, color };
  }

  /** `playfield border thickness 8, mode reflect, color walls` -- order-free. */
  private parsePlayfield(leading: string[], span: Span): PlayfieldDecl {
    const shapeName = this.name();
    if (shapeName !== 'border') {
      this.error(`unknown playfield shape "${shapeName}"`, 'E111', span, 'phase 1 supports border');
    }
    let thickness: number | null = null;
    let mode: PlayfieldDecl['mode'] | null = null;
    let color: string | null = null;

    const seen = new Set<string>();
    while (this.at('name')) {
      const keySpan = this.peek().span;
      const key = this.name();
      if (seen.has(key)) {
        this.error(`playfield attribute "${key}" is set twice`, 'E110', keySpan);
      }
      seen.add(key);

      if (key === 'thickness') thickness = this.number().value;
      else if (key === 'mode') {
        const value = this.name();
        if (!PLAYFIELD_MODES.has(value)) {
          this.error(
            `unknown playfield mode "${value}"`,
            'E112',
            keySpan,
            'reflect, repeat or asymmetric',
          );
        }
        mode = value as PlayfieldDecl['mode'];
      } else if (key === 'color') color = this.name();
      else this.error(`unknown playfield attribute "${key}"`, 'E113', keySpan);

      if (this.at('punct', ',')) this.next();
    }
    this.endOfLine();

    if (thickness === null) this.error('playfield border needs a thickness', 'E114', span);
    if (mode === null) this.error('playfield needs a mode', 'E115', span);
    if (color === null) this.error('playfield needs a color', 'E116', span);
    return { kind: 'playfield', span, leading, shape: 'border', thickness, mode, color };
  }

  /** `actor tank0 uses tank at (40, 120) color red controls joystick1` */
  private parseActor(leading: string[], span: Span): ActorDecl {
    const name = this.name();
    this.expect('name', 'E117', 'uses');
    const sprite = this.name();
    this.expect('name', 'E117', 'at');
    const [x, y] = this.parsePoint();
    let color = '';
    let controls: string | null = null;
    while (this.at('name')) {
      const key = this.name();
      if (key === 'color') color = this.name();
      else if (key === 'controls') controls = this.name();
      else this.error(`unknown actor attribute "${key}"`, 'E118', span);
    }
    this.endOfLine();
    return { kind: 'actor', span, leading, name, sprite, x, y, color, controls };
  }

  private parsePoint(): [number, number] {
    this.punct('(');
    const x = this.number().value;
    this.punct(',');
    const y = this.number().value;
    this.punct(')');
    return [x, y];
  }

  // --- rules ---------------------------------------------------------------

  private parseEveryFrame(leading: string[], span: Span): Decl {
    this.next();
    this.expect('name', 'E130', 'frame');
    const body = this.parseStmtBlock();
    return { kind: 'everyFrame', span, leading, body };
  }

  private parseWhenHits(leading: string[], span: Span): Decl {
    this.next();
    const a = this.name();
    this.expect('name', 'E131', 'hits');
    const b = this.name();
    const body = this.parseStmtBlock();
    return { kind: 'whenHits', span, leading, a, b, body };
  }

  private parseStmtBlock(): Stmt[] {
    this.openBlock();
    const body: Stmt[] = [];
    while (!this.atBlockEnd()) {
      if (this.at('newline')) {
        this.next();
        continue;
      }
      body.push(this.parseStmt());
    }
    this.closeBlock();
    return body;
  }

  private parseStmt(): Stmt {
    const leading = this.takeComments();
    const span = this.peek().span;
    const first = this.name('E132');

    // `tank0 moves with joystick1 speed 1 within field`
    if (this.at('name', 'moves')) {
      this.next();
      this.expect('name', 'E133', 'with');
      const control = this.name();
      this.expect('name', 'E133', 'speed');
      const speed = this.parseExpr();
      this.expect('name', 'E133', 'within');
      const within = this.name();
      this.endOfLine();
      return { kind: 'move', span, leading, actor: first, control, speed, within };
    }

    // `score p0 += 1` and `p0.score = 1`
    const target =
      this.at('name') && !this.at('punct')
        ? ({ kind: 'member', span, target: first, member: this.name() } as const)
        : ({ kind: 'name', span, name: first } as const);

    if (this.at('punct', '+')) {
      this.next();
      this.punct('=');
      const value = this.parseExpr();
      this.endOfLine();
      return { kind: 'addAssign', span, leading, target, value };
    }
    this.punct('=', 'E134');
    const value = this.parseExpr();
    this.endOfLine();
    return { kind: 'assign', span, leading, target, value };
  }

  // --- expressions ---------------------------------------------------------

  private parseExpr(): Expr {
    let left = this.parsePrimary();
    while (this.at('punct', '+') || this.at('punct', '-')) {
      const op = this.next().text as '+' | '-';
      const right = this.parsePrimary();
      left = { kind: 'binary', span: left.span, op, left, right };
    }
    return left;
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    if (token.kind === 'number' || token.kind === 'hex') {
      const { value, hex } = this.number();
      return { kind: 'number', span: token.span, value, hex };
    }
    const name = this.name('E135');
    if (this.at('punct', '(')) {
      this.next();
      const args: Expr[] = [];
      while (!this.at('punct', ')')) {
        args.push(this.parseExpr());
        if (this.at('punct', ',')) this.next();
      }
      this.punct(')');
      return { kind: 'call', span: token.span, callee: name, args };
    }
    if (this.at('punct', '.')) {
      this.next();
      return { kind: 'member', span: token.span, target: name, member: this.name() };
    }
    return { kind: 'name', span: token.span, name };
  }
}

export function parse(source: string, file: string): Program {
  const parser = new Parser(lex(source, file));
  const program = parser.parseProgram(file);
  if (parser.diagnostics.length > 0) throw new P1Error(parser.diagnostics);
  return program;
}
