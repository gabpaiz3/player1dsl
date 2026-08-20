/**
 * AST to canonical source.
 *
 * Driven by the tree rather than by the token stream it came from, which is what
 * makes the round-trip a real test of the parser: if the parser loses something,
 * the formatter cannot put it back.
 *
 * Comments are emitted from the `leading` lists the parser attached. A formatter
 * that deletes comments is not usable, and in this project the comments carry
 * the reasoning.
 *
 * KNOWN LIMIT: blank lines the author wrote are not preserved. The lexer drops
 * them, so nothing downstream can know one was there, and this formatter emits
 * its own spacing -- one blank line between top-level declarations, none inside
 * a block. A comment block therefore always sits flush against the declaration
 * it belongs to.
 *
 * That is a deliberate simplification, not an oversight. Preserving authored
 * blank lines means modelling them, which means deciding whether a comment
 * separated from a declaration by a blank line is a FILE header or a comment on
 * that declaration -- a real design question that the tank-arena subset does not
 * need answered. When a file wants a detached header block, that is the point to
 * answer it.
 */

import type { BandDecl, BandItem, Decl, Expr, Program, SpriteDecl, Stmt } from './ast.ts';

const INDENT = '  ';

function num(value: number, hex: boolean): string {
  return hex ? `$${value.toString(16).toUpperCase().padStart(2, '0')}` : `${value}`;
}

function expr(node: Expr): string {
  switch (node.kind) {
    case 'number':
      return num(node.value, node.hex);
    case 'name':
      return node.name;
    case 'member':
      return node.dotted ? `${node.target}.${node.member}` : `${node.target} ${node.member}`;
    case 'binary':
      return `${expr(node.left)} ${node.op} ${expr(node.right)}`;
    case 'call':
      return `${node.callee}(${node.args.map(expr).join(', ')})`;
  }
}

function comments(leading: readonly string[], depth: number, out: string[]): void {
  for (const line of leading) out.push(`${INDENT.repeat(depth)}# ${line}`.trimEnd());
}

function statement(stmt: Stmt, depth: number, out: string[]): void {
  comments(stmt.leading, depth, out);
  const pad = INDENT.repeat(depth);
  switch (stmt.kind) {
    case 'move':
      out.push(
        `${pad}${stmt.actor} moves with ${stmt.control} speed ${expr(stmt.speed)} within ${stmt.within}`,
      );
      return;
    case 'assign':
      out.push(`${pad}${expr(stmt.target)} = ${expr(stmt.value)}`);
      return;
    case 'addAssign':
      out.push(`${pad}${expr(stmt.target)} += ${expr(stmt.value)}`);
      return;
    case 'if': {
      out.push(`${pad}if ${expr(stmt.condition)}:`);
      for (const inner of stmt.then) statement(inner, depth + 1, out);
      if (stmt.otherwise.length > 0) {
        out.push(`${pad}else:`);
        for (const inner of stmt.otherwise) statement(inner, depth + 1, out);
      }
      return;
    }
  }
}

function sprite(decl: SpriteDecl, out: string[]): void {
  out.push(`sprite ${decl.name} ${decl.width}x${decl.height}:`);
  decl.rows.forEach((byte, index) => {
    comments(decl.rowComments.get(index) ?? [], 1, out);
    let row = '';
    for (let bit = 0; bit < decl.width; bit += 1) {
      row += (byte & (0x80 >> bit)) !== 0 ? 'X' : '.';
    }
    out.push(`${INDENT}${row}`);
  });
}

function bandItem(item: BandItem, out: string[]): void {
  comments(item.leading, 2, out);
  const pad = INDENT.repeat(2);
  switch (item.kind) {
    case 'score':
      out.push(
        `${pad}score ${item.name} at (${item.x}, ${item.y}) digits ${item.digits} start ${item.start} color ${item.color}`,
      );
      return;
    case 'playfield':
      out.push(
        `${pad}playfield ${item.shape} thickness ${item.thickness}, mode ${item.mode}, color ${item.color}`,
      );
      return;
    case 'actor': {
      const controls = item.controls === null ? '' : ` controls ${item.controls}`;
      out.push(
        `${pad}actor ${item.name} uses ${item.sprite} at (${item.x}, ${item.y}) color ${item.color}${controls}`,
      );
      return;
    }
  }
}

function band(decl: BandDecl, out: string[]): void {
  comments(decl.leading, 1, out);
  const height = decl.height === null ? '' : ` height ${decl.height}`;
  out.push(`${INDENT}band ${decl.name}${height}:`);
  for (const item of decl.items) bandItem(item, out);
}

function declaration(decl: Decl, out: string[]): void {
  comments(decl.leading, 0, out);
  switch (decl.kind) {
    case 'game':
      out.push(`game "${decl.title}"`);
      return;
    case 'target':
      out.push(`target ${decl.system}`);
      return;
    case 'cartridge':
      out.push(`cartridge ${decl.size}`);
      return;
    case 'palette': {
      out.push(`palette ${decl.name}:`);
      for (const entry of decl.entries) {
        comments(entry.leading, 1, out);
        out.push(`${INDENT}${entry.name} = ${num(entry.value, entry.hex)}`);
      }
      return;
    }
    case 'sprite':
      sprite(decl, out);
      return;
    case 'scene': {
      out.push(`scene ${decl.name}:`);
      out.push(`${INDENT}background ${decl.background}`);
      for (const b of decl.bands) {
        out.push('');
        band(b, out);
      }
      return;
    }
    case 'everyFrame': {
      out.push('every frame:');
      for (const stmt of decl.body) statement(stmt, 1, out);
      return;
    }
    case 'whenHits': {
      out.push(`when ${decl.a} hits ${decl.b}:`);
      for (const stmt of decl.body) statement(stmt, 1, out);
      return;
    }
  }
}

/**
 * Blank lines between top-level declarations.
 *
 * The three header declarations form one run; everything else stands alone.
 * Grouping them is not cosmetic -- `game`, `target` and `cartridge` are one
 * statement of what is being built, and splitting them reads as three unrelated
 * facts.
 */
const HEADER_KINDS = new Set(['game', 'target', 'cartridge']);

export function format(program: Program): string {
  const out: string[] = [];

  program.decls.forEach((decl, index) => {
    const previous = program.decls[index - 1];
    if (previous) {
      const runsOn = HEADER_KINDS.has(previous.kind) && HEADER_KINDS.has(decl.kind);
      if (!runsOn) out.push('');
    }
    declaration(decl, out);
  });

  if (program.trailing.length > 0) {
    if (out.length > 0) out.push('');
    comments(program.trailing, 0, out);
  }

  return `${out.join('\n')}\n`;
}
