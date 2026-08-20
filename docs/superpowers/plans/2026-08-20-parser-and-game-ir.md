# Parser and Game IR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `tank-arena.p1` from a file that does not exist to one that parses, formats, type-checks, and produces a game IR with a RAM map — with no hardware knowledge anywhere in the pipeline yet.

**Architecture:** An indentation-sensitive lexer feeds a recursive-descent parser that produces a span-carrying AST. A checker lowers that AST to a game IR of declarations, a RAM allocation, and rules as statement trees. The statement language is general and bounded; genre vocabulary enters as intrinsics over it, not as new node kinds. Nothing in this plan knows what a scanline is.

**Tech Stack:** TypeScript (ESM, `.ts` extensions in imports), Node 20+, npm workspaces, vitest, Biome.

**Spec:** [`docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md`](../specs/2026-08-19-tank-arena-compiler-design.md)

## Plan scope

**Plan 2 of 4** for roadmap step 3, covering spec increments **2 and 3**.

| Plan | Increments | Deliverable | State |
|---|---|---|---|
| [1](2026-08-19-golden-trace-harness.md) | 1a, 1b | Golden trace harness and comparator | done |
| 2 (this) | 2, 3 | Parser, AST, `p1 fmt`, checker, game IR, RAM allocator | — |
| 3 | 4, 4b, 5 | Layout IR, line ledger, kernel-shape fixtures, template catalog | to write |
| 4 | 6, 7 | Rule lowering, `p1 build` end to end | to write |

Done when `p1 check examples/tank-arena` parses `tank-arena.p1`, reports its RAM map with
the stack reserved, and `p1 fmt` round-trips the file byte-for-byte.

**Explicitly not in this plan:** anything that knows about scanlines, TIA registers, cycle
costs, or the line ledger. Those are plan 3. If a task here starts wanting to know how many
lines a band occupies, that is the signal it belongs in plan 3 instead.

## Global Constraints

- Node 20+; npm workspaces (**not** pnpm). Never run `pnpm`.
- Imports use explicit `.ts` extensions (`from './ast.ts'`), matching every existing file.
- `npm run lint` (Biome) and `npm run typecheck` must pass.
- Every AST node carries a source span. Every diagnostic points at one.
- The statement language is **statically bounded** ([SPEC §4.3](../../SPEC.md)): no
  unbounded loops, no recursion, no indirect calls. The parser must have no grammar for
  them, so it is unrepresentable rather than rejected later.
- Never tune a constant to make a number appear. If a measurement contradicts a
  prediction, record both.
- Work on a branch; open a PR when ready. CI runs on every branch push (AGENTS.md).

## Two decisions this plan closes

The step-3 design left these open, to be settled against what actually parses cleanly.
Settled here so implementation has no judgement call to make:

**1. Playfield shape.** `playfield border thickness 8, mode reflect`. Thickness is in
**scanlines** and describes the top and bottom runs. The horizontal border is one `PF0`
block — 4 pixels, the narrowest expressible playfield feature ([SPEC §4.4](../../SPEC.md))
— and the compiler states that in the report rather than letting the author specify a width
the hardware cannot produce. Chosen over pixel-art because the ledger in plan 3 needs the
thickness as a number, and reading it out of a bitmap is indirection with no benefit.

**2. Initial state.** `start` on the declaration that owns the value:
`score p0 ... start 3`, and actor positions from the existing `at (x, y)` in
[SPEC §4.2](../../SPEC.md). The reference ROM begins with `score0 = 3` and `score1 = 5`, so
without this, frame 0 of the trace diverges immediately.

## File Structure

| File | Responsibility |
|---|---|
| `packages/parser/package.json` (create) | Workspace manifest, mirroring `packages/emulator` |
| `packages/parser/src/span.ts` (create) | `Span`, `Diagnostic`, `P1Error`. No dependencies. |
| `packages/parser/src/lexer.ts` (create) | Text → tokens, including INDENT/DEDENT |
| `packages/parser/src/ast.ts` (create) | AST node types only — no logic |
| `packages/parser/src/parser.ts` (create) | Tokens → AST |
| `packages/parser/src/format.ts` (create) | AST → canonical source |
| `packages/parser/src/index.ts` (create) | Public exports |
| `packages/compiler/package.json` (create) | Workspace manifest |
| `packages/compiler/src/ir.ts` (create) | Game IR types |
| `packages/compiler/src/check.ts` (create) | AST → game IR, with diagnostics |
| `packages/compiler/src/ram.ts` (create) | RAM allocation with stack reservation |
| `packages/compiler/src/index.ts` (create) | Public exports |
| `packages/cli/src/main.ts` (create) | `p1 check`, `p1 fmt` |
| `examples/tank-arena/tank-arena.p1` (create) | The source the whole step targets |
| `tsconfig.json` (modify) | Add the three new project references |

`span.ts` has no dependencies so diagnostics can be produced from any layer without a
cycle. `ast.ts` holds types only, so the parser and formatter can both depend on it
without depending on each other.

---

### Task 1: Workspace scaffolding for parser, compiler, and cli

**Files:**
- Create: `packages/parser/package.json`, `packages/parser/tsconfig.json`
- Create: `packages/compiler/package.json`, `packages/compiler/tsconfig.json`
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: the existing `packages/emulator` manifest as the template
- Produces: `@player1dsl/parser`, `@player1dsl/compiler`, `@player1dsl/cli` resolvable

- [ ] **Step 1: Read the existing manifests to copy their shape**

Run: `cat packages/emulator/package.json packages/emulator/tsconfig.json tsconfig.json tsconfig.base.json`

Do not invent a different shape. Match what is there.

- [ ] **Step 2: Create the three manifests**

`packages/parser/package.json`:

```json
{
  "name": "@player1dsl/parser",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Repeat for `@player1dsl/compiler` and `@player1dsl/cli`, changing only `name`.

Create each `packages/*/tsconfig.json` matching `packages/emulator/tsconfig.json` exactly,
adjusting only any relative paths and project references it contains.

- [ ] **Step 3: Add project references**

Add the three new packages to the root `tsconfig.json` `references` array, following the
existing entries' format.

- [ ] **Step 4: Verify the workspace resolves**

```bash
npm install
npm run typecheck
```

Expected: both succeed. `npm install` should report the new workspaces linked.

- [ ] **Step 5: Commit**

```bash
git add packages/parser packages/compiler packages/cli tsconfig.json package-lock.json
git commit -m "Scaffold the parser, compiler and cli workspaces

Three empty packages matching the existing emulator and assembler
manifests. SPEC 10 already declares all three; this makes them real so
later tasks have somewhere to land.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Spans and diagnostics

**Files:**
- Create: `packages/parser/src/span.ts`
- Test: `packages/parser/test/span.test.ts`

**Interfaces:**
- Produces:
  - `interface Span { file: string; offset: number; length: number; line: number; column: number }`
  - `interface Diagnostic { code: string; message: string; span: Span; hint?: string }`
  - `class P1Error extends Error { readonly diagnostics: readonly Diagnostic[] }`
  - `function formatDiagnostic(d: Diagnostic, source: string): string`

Every later layer produces `Diagnostic`, so this lands first and depends on nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/parser/test/span.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDiagnostic, P1Error, type Diagnostic } from '../src/span.ts';

const source = ['game "Tank Arena"', 'target ntsc', 'cartridge 8k'].join('\n');

const diagnostic: Diagnostic = {
  code: 'E101',
  message: 'unsupported cartridge size "8k"',
  span: { file: 'tank-arena.p1', offset: 40, length: 2, line: 3, column: 11 },
  hint: 'phase 1 targets unbanked 4k only',
};

describe('diagnostics', () => {
  it('renders the offending line with a caret under the span', () => {
    const text = formatDiagnostic(diagnostic, source);
    expect(text).toContain('tank-arena.p1:3:11');
    expect(text).toContain('E101');
    expect(text).toContain('cartridge 8k');
    expect(text).toContain('^^');
    expect(text).toContain('phase 1 targets unbanked 4k only');
  });

  it('carries every diagnostic on the error, not just the first', () => {
    const error = new P1Error([diagnostic, { ...diagnostic, code: 'E102' }]);
    expect(error.diagnostics.map((d) => d.code)).toEqual(['E101', 'E102']);
    expect(error.message).toContain('2 diagnostics');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/parser`
Expected: FAIL — module `../src/span.ts` not found.

- [ ] **Step 3: Implement**

Create `packages/parser/src/span.ts`:

```ts
/**
 * Source positions and diagnostics.
 *
 * This module depends on nothing, so any layer can produce a diagnostic without
 * creating a cycle. SPEC.md 6 requires every diagnostic to link the source
 * construct to what it affects, which is only possible if spans survive the
 * whole pipeline -- so every AST and IR node carries one.
 */

export interface Span {
  readonly file: string;
  /** Byte offset of the first character. */
  readonly offset: number;
  readonly length: number;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
}

export interface Diagnostic {
  /** Stable identifier, e.g. E101. Ranges are documented in the language reference. */
  readonly code: string;
  readonly message: string;
  readonly span: Span;
  /** What to do about it. Omitted when there is nothing useful to suggest. */
  readonly hint?: string;
}

/**
 * Carries EVERY diagnostic, not just the first.
 *
 * A compiler that stops at the first error makes the author round-trip once per
 * mistake. Collect, then throw once.
 */
export class P1Error extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(
      diagnostics.length === 1
        ? (diagnostics[0]?.message ?? 'compilation failed')
        : `compilation failed with ${diagnostics.length} diagnostics`,
    );
    this.name = 'P1Error';
  }
}

/** Render a diagnostic with the offending line and a caret under the span. */
export function formatDiagnostic(diagnostic: Diagnostic, source: string): string {
  const { span } = diagnostic;
  const line = source.split('\n')[span.line - 1] ?? '';
  const caret = `${' '.repeat(Math.max(0, span.column - 1))}${'^'.repeat(Math.max(1, span.length))}`;
  const out = [
    `${span.file}:${span.line}:${span.column}: ${diagnostic.code} ${diagnostic.message}`,
    `  ${line}`,
    `  ${caret}`,
  ];
  if (diagnostic.hint) out.push(`  hint: ${diagnostic.hint}`);
  return out.join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/parser`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/span.ts packages/parser/test/span.test.ts
git commit -m "Parser: spans and diagnostics

Depends on nothing, so any layer can produce a diagnostic without a
cycle. Carries every diagnostic rather than the first, because a compiler
that stops at one makes the author round-trip once per mistake.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The lexer, including INDENT and DEDENT

**Files:**
- Create: `packages/parser/src/lexer.ts`
- Test: `packages/parser/test/lexer.test.ts`

**Interfaces:**
- Consumes: `Span`, `Diagnostic`, `P1Error` from `span.ts`
- Produces:
  - `type TokenKind = 'name' | 'string' | 'number' | 'hex' | 'punct' | 'newline' | 'indent' | 'dedent' | 'eof'`
  - `interface Token { kind: TokenKind; text: string; value?: number; span: Span }`
  - `function lex(source: string, file: string): Token[]`

Indentation defines blocks ([SPEC §4.1](../../SPEC.md)), so the lexer owns the indent
stack. Comments start with `#`. Numbers are decimal; `$` prefixes hex, which the palette
and sprite syntax need.

- [ ] **Step 1: Write the failing test**

Create `packages/parser/test/lexer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lex } from '../src/lexer.ts';

const kinds = (src: string) =>
  lex(src, 't.p1')
    .map((t) => t.kind)
    .filter((k) => k !== 'eof');

describe('lexer', () => {
  it('emits indent and dedent around a block', () => {
    expect(kinds('a:\n  b\n')).toEqual(['name', 'punct', 'newline', 'indent', 'name', 'newline', 'dedent']);
  });

  it('closes every open block at end of input', () => {
    expect(kinds('a:\n  b:\n    c\n')).toEqual([
      'name', 'punct', 'newline',
      'indent', 'name', 'punct', 'newline',
      'indent', 'name', 'newline',
      'dedent', 'dedent',
    ]);
  });

  it('ignores blank and comment-only lines for indentation', () => {
    expect(kinds('a:\n\n  # note\n  b\n')).toEqual([
      'name', 'punct', 'newline', 'indent', 'name', 'newline', 'dedent',
    ]);
  });

  it('reads decimal and hex numbers', () => {
    const tokens = lex('12 $0E', 't.p1');
    expect(tokens[0]?.value).toBe(12);
    expect(tokens[1]?.value).toBe(0x0e);
    expect(tokens[1]?.kind).toBe('hex');
  });

  it('reads a quoted string', () => {
    expect(lex('game "Tank Arena"', 't.p1')[1]?.text).toBe('Tank Arena');
  });

  it('records 1-based line and column', () => {
    const tokens = lex('a\n  bb\n', 't.p1');
    const bb = tokens.find((t) => t.text === 'bb');
    expect([bb?.span.line, bb?.span.column, bb?.span.length]).toEqual([2, 3, 2]);
  });

  it('rejects a dedent that matches no open block', () => {
    expect(() => lex('a:\n    b\n  c\n', 't.p1')).toThrow(/E001/);
  });

  it('rejects a tab, which makes indentation ambiguous', () => {
    expect(() => lex('a:\n\tb\n', 't.p1')).toThrow(/E002/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/parser/test/lexer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/parser/src/lexer.ts`:

```ts
/**
 * Text to tokens.
 *
 * Indentation defines blocks (SPEC.md 4.1), so the indent stack lives here
 * rather than in the parser -- the parser then sees explicit INDENT and DEDENT
 * tokens and needs no column arithmetic.
 *
 * Tabs are rejected outright. A file mixing tabs and spaces has an indentation
 * structure that depends on the reader's tab width, and this language uses
 * indentation for meaning.
 */

import { type Diagnostic, P1Error, type Span } from './span.ts';

export type TokenKind =
  | 'name'
  | 'string'
  | 'number'
  | 'hex'
  | 'punct'
  | 'newline'
  | 'indent'
  | 'dedent'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  /** Set for `number` and `hex`. */
  readonly value?: number;
  readonly span: Span;
}

const PUNCT = new Set([':', ',', '(', ')', '+', '-', '=', '.']);
const NAME_START = /[A-Za-z_]/;
const NAME_REST = /[A-Za-z0-9_]/;

export function lex(source: string, file: string): Token[] {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const indents: number[] = [0];
  const lines = source.split('\n');

  let offset = 0;
  const span = (line: number, column: number, length: number): Span => ({
    file,
    offset: offset + column - 1,
    length,
    line,
    column,
  });
  const push = (kind: TokenKind, text: string, s: Span, value?: number) => {
    tokens.push(value === undefined ? { kind, text, span: s } : { kind, text, value, span: s });
  };

  for (let l = 0; l < lines.length; l += 1) {
    const raw = lines[l] ?? '';
    const lineNo = l + 1;

    if (raw.includes('\t')) {
      diagnostics.push({
        code: 'E002',
        message: 'tab in indentation',
        span: span(lineNo, raw.indexOf('\t') + 1, 1),
        hint: 'use spaces; tab width would change what this file means',
      });
      offset += raw.length + 1;
      continue;
    }

    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();

    // Blank and comment-only lines carry no indentation information.
    if (body === '' || body.startsWith('#')) {
      offset += raw.length + 1;
      continue;
    }

    const top = indents.at(-1) ?? 0;
    if (indent > top) {
      indents.push(indent);
      push('indent', '', span(lineNo, 1, indent));
    } else if (indent < top) {
      while ((indents.at(-1) ?? 0) > indent) {
        indents.pop();
        push('dedent', '', span(lineNo, 1, 0));
      }
      if ((indents.at(-1) ?? 0) !== indent) {
        diagnostics.push({
          code: 'E001',
          message: 'dedent does not match any open block',
          span: span(lineNo, 1, indent),
          hint: 'indentation must return to a column an enclosing block opened at',
        });
      }
    }

    let i = indent;
    while (i < raw.length) {
      const ch = raw[i] as string;
      if (ch === ' ') {
        i += 1;
        continue;
      }
      if (ch === '#') break;

      const col = i + 1;
      if (NAME_START.test(ch)) {
        let j = i + 1;
        while (j < raw.length && NAME_REST.test(raw[j] as string)) j += 1;
        const text = raw.slice(i, j);
        push('name', text, span(lineNo, col, text.length));
        i = j;
        continue;
      }
      if (ch === '$') {
        let j = i + 1;
        while (j < raw.length && /[0-9A-Fa-f]/.test(raw[j] as string)) j += 1;
        const text = raw.slice(i, j);
        push('hex', text, span(lineNo, col, text.length), Number.parseInt(text.slice(1), 16));
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < raw.length && /[0-9]/.test(raw[j] as string)) j += 1;
        const text = raw.slice(i, j);
        push('number', text, span(lineNo, col, text.length), Number(text));
        i = j;
        continue;
      }
      if (ch === '"') {
        const end = raw.indexOf('"', i + 1);
        if (end < 0) {
          diagnostics.push({
            code: 'E003',
            message: 'unterminated string',
            span: span(lineNo, col, raw.length - i),
          });
          break;
        }
        const text = raw.slice(i + 1, end);
        push('string', text, span(lineNo, col, end - i + 1));
        i = end + 1;
        continue;
      }
      if (PUNCT.has(ch)) {
        push('punct', ch, span(lineNo, col, 1));
        i += 1;
        continue;
      }
      diagnostics.push({
        code: 'E004',
        message: `unexpected character "${ch}"`,
        span: span(lineNo, col, 1),
      });
      i += 1;
    }

    push('newline', '', span(lineNo, raw.length + 1, 0));
    offset += raw.length + 1;
  }

  const lastLine = lines.length;
  while (indents.length > 1) {
    indents.pop();
    push('dedent', '', { file, offset, length: 0, line: lastLine, column: 1 });
  }
  push('eof', '', { file, offset, length: 0, line: lastLine, column: 1 });

  if (diagnostics.length > 0) throw new P1Error(diagnostics);
  return tokens;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/parser/test/lexer.test.ts`
Expected: PASS, 8 tests.

If the first test fails on a trailing `newline` token, check whether the source's final
`\n` produced an empty last line — the blank-line rule should skip it. Fix the lexer, not
the expectation.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/lexer.ts packages/parser/test/lexer.test.ts
git commit -m "Parser: indentation-sensitive lexer

The indent stack lives in the lexer, so the parser sees explicit INDENT
and DEDENT tokens and needs no column arithmetic.

Tabs are rejected outright rather than normalised. A file mixing tabs and
spaces has an indentation structure that depends on the reader's tab
width, and this language uses indentation for meaning.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The AST

**Files:**
- Create: `packages/parser/src/ast.ts`

**Interfaces:**
- Produces the node types below. Types only — no logic, so the parser and formatter can
  both depend on this without depending on each other.

- [ ] **Step 1: Write the types**

Create `packages/parser/src/ast.ts`:

```ts
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
 */

import type { Span } from './span.ts';

export interface Node {
  readonly span: Span;
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

export type Stmt = Assign | AddAssign | MoveStmt | SoundStmt | IfStmt;

export interface Assign extends Node {
  readonly kind: 'assign';
  readonly target: MemberRef | NameRef;
  readonly value: Expr;
}
export interface AddAssign extends Node {
  readonly kind: 'addAssign';
  readonly target: MemberRef | NameRef;
  readonly value: Expr;
}
/** `tank0 moves with joystick1 speed 1 within field` */
export interface MoveStmt extends Node {
  readonly kind: 'move';
  readonly actor: string;
  readonly control: string;
  readonly speed: Expr;
  readonly within: string;
}
export interface SoundStmt extends Node {
  readonly kind: 'sound';
  readonly name: string;
}
export interface IfStmt extends Node {
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

export interface GameDecl extends Node {
  readonly kind: 'game';
  readonly title: string;
}
export interface TargetDecl extends Node {
  readonly kind: 'target';
  readonly system: string;
}
export interface CartridgeDecl extends Node {
  readonly kind: 'cartridge';
  readonly size: string;
}
export interface PaletteEntry extends Node {
  readonly name: string;
  readonly value: number;
}
export interface PaletteDecl extends Node {
  readonly kind: 'palette';
  readonly name: string;
  readonly entries: readonly PaletteEntry[];
}
export interface SpriteDecl extends Node {
  readonly kind: 'sprite';
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** One byte per row, MSB leftmost. */
  readonly rows: readonly number[];
}

export interface ScoreDecl extends Node {
  readonly kind: 'score';
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly digits: number;
  readonly start: number;
  readonly color: string;
}
export interface PlayfieldDecl extends Node {
  readonly kind: 'playfield';
  readonly shape: 'border';
  /** Border thickness in SCANLINES, for the top and bottom runs. */
  readonly thickness: number;
  readonly mode: 'reflect' | 'repeat' | 'asymmetric';
  readonly color: string;
}
export interface ActorDecl extends Node {
  readonly kind: 'actor';
  readonly name: string;
  readonly sprite: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly controls: string | null;
}
export type BandItem = ScoreDecl | PlayfieldDecl | ActorDecl;

export interface BandDecl extends Node {
  readonly kind: 'band';
  readonly name: string;
  /** Explicit height in scanlines, or null to take the remainder. */
  readonly height: number | null;
  readonly items: readonly BandItem[];
}
export interface SceneDecl extends Node {
  readonly kind: 'scene';
  readonly name: string;
  readonly background: string;
  readonly bands: readonly BandDecl[];
}
export interface EveryFrameDecl extends Node {
  readonly kind: 'everyFrame';
  readonly body: readonly Stmt[];
}
export interface WhenHitsDecl extends Node {
  readonly kind: 'whenHits';
  readonly a: string;
  readonly b: string;
  readonly body: readonly Stmt[];
}

export interface Program extends Node {
  readonly decls: readonly Decl[];
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: passes. No test — this file has no behaviour.

- [ ] **Step 3: Commit**

```bash
git add packages/parser/src/ast.ts
git commit -m "Parser: the AST

Types only, so the parser and formatter both depend on it and neither
depends on the other. That is what keeps p1 fmt honest -- it is driven by
the tree rather than by the token stream the tree came from.

There is deliberately no node for an unbounded loop, recursion, or an
indirect call. SPEC 4.3 requires the game layer to be statically bounded,
and making that unrepresentable is cheaper and more durable than
rejecting it downstream.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The parser

**Files:**
- Create: `packages/parser/src/parser.ts`, `packages/parser/src/index.ts`
- Test: `packages/parser/test/parser.test.ts`

**Interfaces:**
- Consumes: `lex`, `Token` from `lexer.ts`; every type from `ast.ts`; `P1Error` from `span.ts`
- Produces: `function parse(source: string, file: string): Program`

Recursive descent. Collect diagnostics and continue where the next declaration boundary is
findable; throw once at the end.

- [ ] **Step 1: Write the failing test**

Create `packages/parser/test/parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.ts';

const header = 'game "Tank Arena"\ntarget ntsc\ncartridge 4k\n';

describe('parser', () => {
  it('parses the header declarations', () => {
    const program = parse(header, 't.p1');
    expect(program.decls.map((d) => d.kind)).toEqual(['game', 'target', 'cartridge']);
  });

  it('parses a palette block', () => {
    const program = parse(`${header}palette arena:\n  walls = $0E\n  tank0 = $46\n`, 't.p1');
    const palette = program.decls.find((d) => d.kind === 'palette');
    expect(palette?.kind === 'palette' && palette.entries.map((e) => [e.name, e.value])).toEqual([
      ['walls', 0x0e],
      ['tank0', 0x46],
    ]);
  });

  it('parses sprite pixel rows into bytes, MSB leftmost', () => {
    const src = `${header}sprite tank 8x2:\n  X.......\n  ..XX....\n`;
    const sprite = parse(src, 't.p1').decls.find((d) => d.kind === 'sprite');
    expect(sprite?.kind === 'sprite' && sprite.rows).toEqual([0b10000000, 0b00110000]);
  });

  it('rejects a sprite row whose width does not match the declaration', () => {
    expect(() => parse(`${header}sprite tank 8x1:\n  X..\n`, 't.p1')).toThrow(/E1\d\d/);
  });

  it('parses a band with a playfield, an actor and a score', () => {
    const src =
      `${header}scene arena:\n  background sky\n\n` +
      '  band hud height 12:\n    score p0 at (60, 2) digits 1 start 3 color hud\n\n' +
      '  band field:\n' +
      '    playfield border thickness 8, mode reflect, color walls\n' +
      '    actor tank0 uses tank at (40, 120) color red controls joystick1\n';
    const scene = parse(src, 't.p1').decls.find((d) => d.kind === 'scene');
    if (scene?.kind !== 'scene') throw new Error('no scene');
    expect(scene.bands.map((b) => [b.name, b.height])).toEqual([
      ['hud', 12],
      ['field', null],
    ]);
    const field = scene.bands[1];
    expect(field?.items.map((i) => i.kind)).toEqual(['playfield', 'actor']);
  });

  it('parses rules', () => {
    const src =
      `${header}every frame:\n  tank0 moves with joystick1 speed 1 within field\n\n` +
      'when tank0 hits tank1:\n  score p0 += 1\n';
    const kinds = parse(src, 't.p1').decls.map((d) => d.kind);
    expect(kinds).toContain('everyFrame');
    expect(kinds).toContain('whenHits');
  });

  it('points a diagnostic at the offending token', () => {
    try {
      parse(`${header}cartridge\n`, 't.p1');
      throw new Error('should have thrown');
    } catch (error) {
      const diagnostics = (error as { diagnostics?: { span: { line: number } }[] }).diagnostics;
      expect(diagnostics?.[0]?.span.line).toBe(4);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/parser/test/parser.test.ts`
Expected: FAIL — `parse` not exported.

- [ ] **Step 3: Implement**

Write `packages/parser/src/parser.ts` as a recursive-descent parser over the token stream,
with one method per production: `parseProgram`, `parseGame`, `parseTarget`,
`parseCartridge`, `parsePalette`, `parseSprite`, `parseScene`, `parseBand`, `parseBandItem`
(dispatching on `score` / `playfield` / `actor`), `parseEveryFrame`, `parseWhenHits`,
`parseStmt`, and `parseExpr`.

Rules the implementation must follow:

- A block is `punct ':'`, `newline`, `indent`, items, `dedent`.
- Comma-separated attribute lists (`playfield border thickness 8, mode reflect, color walls`)
  parse as `name` followed by its value, repeated after each `,`. Order is not significant;
  a repeated attribute is diagnostic `E110`.
- Sprite rows: `X` is a set pixel, `.` is clear; the row's length must equal the declared
  width or emit `E120`. Bits pack MSB-leftmost.
- `every frame:` and `when A hits B:` open statement blocks.
- Expressions handle `+` and `-` left-associatively; `name(args)` is a `Call`; `a.b` is a
  `MemberRef`.
- Diagnostics accumulate; the parser skips to the next line on error and throws a single
  `P1Error` at the end if any accumulated.

Create `packages/parser/src/index.ts`:

```ts
export * from './ast.ts';
export { lex, type Token, type TokenKind } from './lexer.ts';
export { parse } from './parser.ts';
export * from './span.ts';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/parser`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/parser.ts packages/parser/src/index.ts packages/parser/test/parser.test.ts
git commit -m "Parser: recursive descent over the tank-arena surface

Diagnostics accumulate and the parser skips to the next line rather than
stopping at the first error, so one run reports everything wrong with a
file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `tank-arena.p1`

**Files:**
- Create: `examples/tank-arena/tank-arena.p1`
- Test: `packages/parser/test/tank-arena.test.ts`

**Interfaces:**
- Consumes: `parse` from `@player1dsl/parser`

This is the source the whole step targets. Every value in it comes from the reference
kernel, so a divergence later is a compiler bug rather than a content mismatch.

- [ ] **Step 1: Read the reference kernel's constants**

Run: `sed -n '13,55p' examples/tank-arena/reference/tank-arena.asm`

Copy the values; do not retype them from memory. Sprite bytes come from `TankSprite`:
Run: `grep -A 12 '^TankSprite' examples/tank-arena/reference/tank-arena.asm`

- [ ] **Step 2: Write the file**

Create `examples/tank-arena/tank-arena.p1`. Structure (fill sprite rows from the
`TankSprite` bytes read in Step 1):

```p1
# tank-arena -- the first Player1DSL program.
#
# Every value here comes from examples/tank-arena/reference/tank-arena.asm, so a
# divergence in the golden trace is a compiler defect rather than a content mismatch.
#
# Note what this file does NOT say: no scanline counts, no timer values, no register
# names, no write ordering. Those are what the compiler has to earn.

game "Tank Arena"
target ntsc
cartridge 4k

palette arena:
  background = $00
  walls      = $0E
  hud        = $0E
  red        = $46
  blue       = $86

sprite tank 8x8:
  # rows transcribed from TankSprite in the reference kernel
  ...

scene arena:
  background background

  band hud height 12:
    score p0 at (60, 2) digits 1 start 3 color hud
    score p1 at (92, 2) digits 1 start 5 color hud

  band field:
    playfield border thickness 8, mode reflect, color walls
    actor tank0 uses tank at (40, 120) color red controls joystick1
    actor tank1 uses tank at (110, 60) color blue controls joystick2

every frame:
  tank0 moves with joystick1 speed 1 within field
  tank1 moves with joystick2 speed 1 within field

when tank0 hits tank1:
  score p0 += 1
```

- [ ] **Step 3: Write the test**

Create `packages/parser/test/tank-arena.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.ts';

const path = fileURLToPath(new URL('../../../examples/tank-arena/tank-arena.p1', import.meta.url));

describe('tank-arena.p1', () => {
  it('parses', () => {
    const program = parse(readFileSync(path, 'utf8'), 'tank-arena.p1');
    expect(program.decls.length).toBeGreaterThan(0);
  });

  it('declares the values the reference kernel starts from', () => {
    const program = parse(readFileSync(path, 'utf8'), 'tank-arena.p1');
    const scene = program.decls.find((d) => d.kind === 'scene');
    if (scene?.kind !== 'scene') throw new Error('no scene');

    const actors = scene.bands.flatMap((b) => b.items).filter((i) => i.kind === 'actor');
    expect(actors.map((a) => [a.name, a.x, a.y])).toEqual([
      ['tank0', 40, 120],
      ['tank1', 110, 60],
    ]);

    const scores = scene.bands.flatMap((b) => b.items).filter((i) => i.kind === 'score');
    expect(scores.map((s) => [s.name, s.x, s.start])).toEqual([
      ['p0', 60, 3],
      ['p1', 92, 5],
    ]);
  });

  it('has an 8x8 tank sprite whose rows match the reference kernel', () => {
    const program = parse(readFileSync(path, 'utf8'), 'tank-arena.p1');
    const sprite = program.decls.find((d) => d.kind === 'sprite');
    if (sprite?.kind !== 'sprite') throw new Error('no sprite');
    expect([sprite.width, sprite.height]).toEqual([8, 8]);
    expect(sprite.rows).toHaveLength(8);
  });
});
```

- [ ] **Step 4: Cross-check the sprite against the ROM, do not eyeball it**

The sprite rows must equal `TankSprite`'s bytes. Verify mechanically:

```bash
npx tsx -e "
const { readFileSync } = require('node:fs');
const src = readFileSync('examples/tank-arena/reference/tank-arena.asm','utf8');
const rows = src.split('TankSprite')[1].split('\n').slice(1,20)
  .map(l => l.match(/%([01]{8})/)).filter(Boolean).map(m => parseInt(m[1],2));
console.log('reference:', rows);
"
```

Compare with the parsed rows. **If they differ, fix the `.p1`** — the ROM is the authority.
Record the comparison result in the commit message either way.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/parser`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add examples/tank-arena/tank-arena.p1 packages/parser/test/tank-arena.test.ts
git commit -m "The first Player1DSL program

Every value comes from the reference kernel, so a later divergence in the
golden trace is a compiler defect rather than a content mismatch. Sprite
rows were cross-checked against TankSprite mechanically rather than by
eye.

Note what the file does NOT say: no scanline counts, no timer values, no
register names, no write ordering. Those are exactly what the compiler
has to earn.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `p1 fmt` and round-trip

**Files:**
- Create: `packages/parser/src/format.ts`
- Test: `packages/parser/test/format.test.ts`

**Interfaces:**
- Consumes: every type from `ast.ts`
- Produces: `function format(program: Program): string`

The round-trip is the cheapest possible parser test: format must be idempotent, and
formatting the committed `tank-arena.p1` must reproduce it byte-for-byte.

- [ ] **Step 1: Write the failing test**

Create `packages/parser/test/format.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, parse } from '../src/index.ts';

const path = fileURLToPath(new URL('../../../examples/tank-arena/tank-arena.p1', import.meta.url));
const source = () => readFileSync(path, 'utf8');

describe('formatter', () => {
  it('is idempotent', () => {
    const once = format(parse(source(), 'tank-arena.p1'));
    const twice = format(parse(once, 'tank-arena.p1'));
    expect(twice).toBe(once);
  });

  it('reproduces the committed file byte for byte', () => {
    // If this fails, either the file is not canonical or the formatter is
    // wrong. Decide which before changing either -- reformatting the file to
    // match a buggy formatter hides the bug.
    expect(format(parse(source(), 'tank-arena.p1'))).toBe(source());
  });

  it('preserves the author's number base', () => {
    const src = 'game "T"\ntarget ntsc\ncartridge 4k\npalette p:\n  a = $0E\n  b = 12\n';
    expect(format(parse(src, 't.p1'))).toContain('$0E');
    expect(format(parse(src, 't.p1'))).toContain('= 12');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/parser/test/format.test.ts`
Expected: FAIL — `format` not exported.

- [ ] **Step 3: Implement**

Create `packages/parser/src/format.ts`, emitting canonical source from the AST: two-space
indentation, one declaration per line, palette entries aligned on `=`, sprite rows as `X`
and `.`, and a blank line between top-level declarations and between bands.

`NumberLit.hex` is why the AST records the base — the formatter must not rewrite `$0E` as
`14`.

Add to `packages/parser/src/index.ts`:

```ts
export { format } from './format.ts';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/parser`
Expected: PASS.

The byte-for-byte test will likely fail first. **Decide which side is wrong before
changing either** — if the formatter is right, reformat `tank-arena.p1` and say so in the
commit; if the formatter is wrong, fix it. Reformatting the file to match a buggy formatter
hides the bug.

Comments are not represented in the AST, so the formatter drops them. `tank-arena.p1` has a
header comment, which means one of: teach the AST to carry leading comments, or drop the
byte-for-byte assertion to a structural one. **Prefer carrying the comments** — a formatter
that deletes them is not usable — and record the choice in the commit.

- [ ] **Step 5: Commit**

```bash
git add packages/parser/src/format.ts packages/parser/src/index.ts packages/parser/test/format.test.ts
git commit -m "Parser: p1 fmt, with a byte-for-byte round-trip

Formatting is the cheapest parser test there is: it must be idempotent,
and it must reproduce the committed tank-arena.p1 exactly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The checker and the game IR

**Files:**
- Create: `packages/compiler/src/ir.ts`, `packages/compiler/src/check.ts`, `packages/compiler/src/index.ts`
- Test: `packages/compiler/test/check.test.ts`

**Interfaces:**
- Consumes: `Program`, `Diagnostic`, `P1Error` from `@player1dsl/parser`
- Produces:
  - `interface GameIr { title, target, cartridge, palette, sprites, scene, rules, variables }`
  - `interface Variable { name: string; type: 'byte' | 'bool'; initial: number }`
  - `function check(program: Program): GameIr` (throws `P1Error` on any diagnostic)

The IR is **pure semantics**: no scanlines, no registers. Variables are declared here but
not yet assigned addresses — that is Task 9.

- [ ] **Step 1: Write the failing test**

Create `packages/compiler/test/check.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '../../parser/src/index.ts';
import { check } from '../src/index.ts';

const path = fileURLToPath(new URL('../../../examples/tank-arena/tank-arena.p1', import.meta.url));
const ir = () => check(parse(readFileSync(path, 'utf8'), 'tank-arena.p1'));

const withHeader = (body: string) => `game "T"\ntarget ntsc\ncartridge 4k\n${body}`;
const checkSource = (body: string) => check(parse(withHeader(body), 't.p1'));

describe('checker', () => {
  it('accepts tank-arena.p1', () => {
    expect(ir().title).toBe('Tank Arena');
  });

  it('declares a variable per mutable actor coordinate and per score', () => {
    const names = ir().variables.map((v) => v.name);
    expect(names).toEqual(expect.arrayContaining(['tank0_x', 'tank0_y', 'tank1_x', 'tank1_y']));
    expect(names).toEqual(expect.arrayContaining(['p0_score', 'p1_score']));
  });

  it('carries the declared initial values into the IR', () => {
    const byName = new Map(ir().variables.map((v) => [v.name, v.initial]));
    expect(byName.get('tank0_x')).toBe(40);
    expect(byName.get('tank0_y')).toBe(120);
    expect(byName.get('p0_score')).toBe(3);
    expect(byName.get('p1_score')).toBe(5);
  });

  it('rejects an unknown colour name with a span', () => {
    expect(() =>
      checkSource('scene s:\n  background nope\n\n  band b height 4:\n    playfield border thickness 2, mode reflect, color walls\n'),
    ).toThrow(/E2\d\d/);
  });

  it('rejects an actor referencing an undeclared sprite', () => {
    expect(() =>
      checkSource(
        'palette p:\n  c = $0E\n\nscene s:\n  background c\n\n  band b height 8:\n    actor a uses nosuch at (10, 10) color c\n',
      ),
    ).toThrow(/E2\d\d/);
  });

  it('rejects a value outside its type range', () => {
    expect(() =>
      checkSource('palette p:\n  c = $0E\n\nscene s:\n  background c\n\n  band b height 8:\n    actor a uses t at (300, 10) color c\n'),
    ).toThrow(/E2\d\d/);
  });

  it('reports every diagnostic, not just the first', () => {
    try {
      checkSource('scene s:\n  background nope\n\n  band b height 4:\n    actor a uses nosuch at (10, 10) color alsonope\n');
      throw new Error('should have thrown');
    } catch (error) {
      const diagnostics = (error as { diagnostics?: unknown[] }).diagnostics ?? [];
      expect(diagnostics.length).toBeGreaterThan(1);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/compiler`
Expected: FAIL — `check` not exported.

- [ ] **Step 3: Implement**

`ir.ts` holds the types. `check.ts` walks the AST and:

- resolves every colour name against the palette (`E201` unknown colour);
- resolves every `uses <sprite>` against declared sprites (`E202`);
- resolves every actor and score reference in rules (`E203`);
- range-checks byte values 0–255 and positions against the 160×192 visible field (`E204`);
- rejects a scene with no band, or more than one band without an explicit height (`E205`) —
  the remainder can only be given to one band;
- declares one `byte` variable per mutable actor coordinate and per score, carrying the
  declared initial value.

Every diagnostic accumulates; throw one `P1Error` at the end.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/compiler`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compiler packages/compiler/test
git commit -m "Compiler: the checker and the game IR

The IR is pure semantics -- no scanlines, no registers. Those arrive with
the layout IR in plan 3, and keeping them out here is what makes the
checker testable without any hardware model.

Initial values are carried through, because the reference ROM starts with
scores at 3 and 5 and frame 0 of the golden diverges without them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The RAM allocator, with the stack reserved

**Files:**
- Create: `packages/compiler/src/ram.ts`
- Test: `packages/compiler/test/ram.test.ts`

**Interfaces:**
- Consumes: `GameIr`, `Variable` from `ir.ts`
- Produces:
  - `interface RamMap { readonly slots: ReadonlyMap<string, number>; readonly used: number; readonly stackReserved: number; readonly free: number }`
  - `function allocateRam(variables: readonly Variable[], options?: { stackReserved?: number }): RamMap`
  - `const RAM_BASE = 0x80`, `const RAM_SIZE = 128`, `const DEFAULT_STACK_RESERVED = 16`

[SPEC §6.2](../../SPEC.md): the 6532's 128 bytes hold both variables and the stack, which
grows down from `$FF`. Without a reservation, the first sufficiently deep call chain
silently corrupts game state.

The reference kernel uses 14 bytes from `$80` and lets the stack grow down from `$FF`.

- [ ] **Step 1: Write the failing test**

Create `packages/compiler/test/ram.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allocateRam, DEFAULT_STACK_RESERVED, RAM_BASE, RAM_SIZE } from '../src/index.ts';
import type { Variable } from '../src/index.ts';

const vars = (n: number): Variable[] =>
  Array.from({ length: n }, (_, i) => ({ name: `v${i}`, type: 'byte' as const, initial: 0 }));

describe('RAM allocation', () => {
  it('allocates upward from $80', () => {
    const map = allocateRam(vars(3));
    expect([...map.slots.values()]).toEqual([RAM_BASE, RAM_BASE + 1, RAM_BASE + 2]);
  });

  it('reserves space for the stack, which shares the same 128 bytes', () => {
    const map = allocateRam(vars(3));
    expect(map.stackReserved).toBe(DEFAULT_STACK_RESERVED);
    expect(map.free).toBe(RAM_SIZE - 3 - DEFAULT_STACK_RESERVED);
  });

  it('fails when variables would run into the stack reservation', () => {
    expect(() => allocateRam(vars(RAM_SIZE - DEFAULT_STACK_RESERVED + 1))).toThrow(/E3\d\d/);
  });

  it('fits exactly at the boundary', () => {
    const map = allocateRam(vars(RAM_SIZE - DEFAULT_STACK_RESERVED));
    expect(map.free).toBe(0);
  });

  it('is deterministic: the same variables always get the same addresses', () => {
    const a = allocateRam(vars(8));
    const b = allocateRam(vars(8));
    expect([...a.slots]).toEqual([...b.slots]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/compiler/test/ram.test.ts`
Expected: FAIL — `allocateRam` not exported.

- [ ] **Step 3: Implement**

Create `packages/compiler/src/ram.ts`. Allocate in declaration order — determinism is an
AGENTS.md requirement, so no sorting by size or frequency without a documented, stable
tiebreak. Emit `E301` when the allocation would cross into the stack reservation, naming
how many bytes over it is.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/compiler`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compiler/src/ram.ts packages/compiler/test/ram.test.ts
git commit -m "Compiler: RAM allocation with the stack reserved

SPEC 6.2: the 6532's 128 bytes hold both variables and the stack, which
grows down from \$FF. Without a reservation the first sufficiently deep
call chain silently corrupts game state, which is the worst kind of bug
to find on real hardware.

Allocation is in declaration order. Determinism is an AGENTS.md
requirement, so no sorting by size or frequency without a documented
stable tiebreak.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `p1 check` and `p1 fmt`

**Files:**
- Create: `packages/cli/src/main.ts`, `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json` (add `bin`)
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `parse`, `format`, `formatDiagnostic`, `P1Error` from `@player1dsl/parser`; `check`, `allocateRam` from `@player1dsl/compiler`
- Produces: `function run(argv: readonly string[]): Promise<number>` — the exit code

Keep `main.ts` a thin shell around `run`, so the CLI is testable without spawning a process.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/cli.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/index.ts';

const example = 'examples/tank-arena/tank-arena.p1';

describe('p1 check', () => {
  it('exits 0 and reports the RAM map for a valid project', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run(['check', example]);
    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();

    expect(code).toBe(0);
    expect(output).toMatch(/RAM/i);
    expect(output).toMatch(/stack/i);
  });

  it('exits 1 and prints a diagnostic for a bad file', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run(['check', 'packages/cli/test/fixtures/bad.p1']);
    const output = err.mock.calls.map((c) => c.join(' ')).join('\n');
    err.mockRestore();

    expect(code).toBe(1);
    expect(output).toMatch(/E\d\d\d/);
  });

  it('exits 2 on an unknown subcommand', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run(['nonsense'])).toBe(2);
    vi.restoreAllMocks();
  });
});
```

Also create `packages/cli/test/fixtures/bad.p1` containing a deliberate error:

```p1
game "Bad"
target ntsc
cartridge 8k
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/cli`
Expected: FAIL — `run` not exported.

- [ ] **Step 3: Implement**

`run` dispatches on `argv[0]`:

- `check <path>` — parse, check, allocate; print the RAM map (each variable, its address,
  bytes used, stack reserved, bytes free) and exit 0. On `P1Error`, print every diagnostic
  via `formatDiagnostic` to stderr and exit 1.
- `fmt <path>` — parse and format; write the file back and exit 0. `--check` prints whether
  it would change and exits 1 if so.
- anything else — usage to stderr, exit 2.

If `<path>` is a directory, look for `<path>/tank-arena.p1` first, then any single `.p1`
in it; more than one is `E401`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/cli`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full gates**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "CLI: p1 check and p1 fmt

run() returns the exit code and main is a thin shell around it, so the
CLI is testable without spawning a process.

p1 check reports the RAM map including the stack reservation, which makes
SPEC 6.2's budget visible rather than merely enforced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Session log, spec, and roadmap

**Files:**
- Create/modify: `docs/session-logs/YYYY-MM-DD.md` (today's date)
- Modify: `docs/SPEC.md` §10 (mark `packages/parser`, `packages/compiler`, `packages/cli` as existing)
- Modify: `docs/roadmap.md` (mark plan 2 done)

AGENTS.md requires the spec be updated in the same change as a structural decision, and one
log per working day recording both sides of any contradicted prediction.

- [ ] **Step 1: Update SPEC §10**

The three new packages are currently listed as planned. Mark them `# (exists)` with a
one-line description each, matching the existing entries' style.

- [ ] **Step 2: Write the session log**

Record at minimum:

- The two decisions this plan closed (playfield-shape syntax, `start` for initial state)
  and whether either changed once real source was parsed.
- What the formatter round-trip forced regarding comments in the AST.
- Whether the sprite cross-check in Task 6 Step 4 matched, and if not, what differed.
- Any diagnostic code range that turned out wrong.

- [ ] **Step 3: Update the roadmap**

Mark plan 2 done in the step-3 table and link it.

- [ ] **Step 4: Commit and open a PR**

```bash
git add docs/
git commit -m "Session log, and mark the three new packages as existing in SPEC 10

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --base main --title "Parser, game IR, and the first .p1" --body-file <(...)
```

CI runs on the branch push already; merge once it is green.

---

## Self-review

**Spec coverage.** Increment 2 (lexer, parser, AST, `p1 fmt`) is Tasks 2–7. Increment 3
(checker, game IR, RAM allocator) is Tasks 8–9. Task 10 gives both a runnable surface;
Task 1 is scaffolding folded in front rather than split out. The design's two open
questions are closed in "Two decisions this plan closes" and exercised by Task 6's
committed `.p1`.

**Type consistency.** `Span`, `Diagnostic`, `P1Error` (Task 2) are used by Tasks 3, 5, 8,
10. `Token`/`TokenKind` (Task 3) are used by Task 5. Every AST type (Task 4) is used by
Tasks 5, 7, 8. `GameIr`/`Variable` (Task 8) are used by Tasks 9, 10. `RamMap` (Task 9) is
used by Task 10. Diagnostic codes are partitioned: `E0xx` lexer, `E1xx` parser, `E2xx`
checker, `E3xx` RAM, `E4xx` CLI.

**Known risks, stated rather than hidden.**

1. **Comments and the formatter round-trip (Task 7).** The AST has no comment nodes, and
   `tank-arena.p1` opens with a comment block. The byte-for-byte assertion cannot pass
   until comments are represented. The task says to prefer carrying them and to record the
   choice — a formatter that deletes comments is not usable, so this is a real design
   decision, not a test to weaken.
2. **`within field` is parsed but not interpreted.** The bounds it implies —
   and the measured asymmetry where a lower bound rests at `X_MIN - 1` while an upper
   rests exactly at `Y_MAX` — belong to lowering in plan 4. Task 8 must resolve the name
   and stop there. If a task here starts computing clamp constants, it has drifted into
   plan 4.
3. **Diagnostic code ranges are invented here.** SPEC §13 mentions only `E230`. The ranges
   above are a proposal; if they collide with anything the language reference later wants,
   this plan is where the collision was introduced.
