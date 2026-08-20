/**
 * Text to tokens.
 *
 * Indentation defines blocks (SPEC.md 4.1), so the indent stack lives here
 * rather than in the parser -- the parser then sees explicit INDENT and DEDENT
 * tokens and needs no column arithmetic.
 *
 * Tabs are rejected outright rather than normalised. A file mixing tabs and
 * spaces has an indentation structure that depends on the reader's tab width,
 * and this language uses indentation for meaning.
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

  for (let l = 0; l < lines.length; l += 1) {
    const raw = lines[l] ?? '';
    const lineNo = l + 1;
    const lineStart = offset;

    const span = (column: number, length: number): Span => ({
      file,
      offset: lineStart + column - 1,
      length,
      line: lineNo,
      column,
    });
    const push = (kind: TokenKind, text: string, s: Span, value?: number) => {
      tokens.push(value === undefined ? { kind, text, span: s } : { kind, text, value, span: s });
    };

    offset += raw.length + 1;

    if (raw.includes('\t')) {
      diagnostics.push({
        code: 'E002',
        message: 'tab in indentation',
        span: span(raw.indexOf('\t') + 1, 1),
        hint: 'use spaces; tab width would otherwise change what this file means',
      });
      continue;
    }

    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();

    // Blank and comment-only lines carry no indentation information.
    if (body === '' || body.startsWith('#')) continue;

    const top = indents.at(-1) ?? 0;
    if (indent > top) {
      indents.push(indent);
      push('indent', '', span(1, indent));
    } else if (indent < top) {
      while ((indents.at(-1) ?? 0) > indent) {
        indents.pop();
        push('dedent', '', span(1, 0));
      }
      if ((indents.at(-1) ?? 0) !== indent) {
        diagnostics.push({
          code: 'E001',
          message: 'dedent does not match any open block',
          span: span(1, Math.max(1, indent)),
          hint: 'indentation must return to a column that an enclosing block opened at',
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

      if (ch === '$') {
        let j = i + 1;
        while (j < raw.length && /[0-9A-Fa-f]/.test(raw[j] as string)) j += 1;
        const text = raw.slice(i, j);
        push('hex', text, span(col, text.length), Number.parseInt(text.slice(1), 16));
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < raw.length && /[0-9]/.test(raw[j] as string)) j += 1;
        const text = raw.slice(i, j);
        push('number', text, span(col, text.length), Number(text));
        i = j;
        // `8x8` is a sprite dimension, not a number followed by an identifier.
        // Without this the name rule below swallows "x8", so `sprite tank 8x8:`
        // parses as nonsense instead of failing. Only a digit-x-digit sequence
        // qualifies, so a bare `x` is still an ordinary name.
        if (raw[j] === 'x' && /[0-9]/.test(raw[j + 1] ?? '')) {
          push('punct', 'x', span(j + 1, 1));
          i = j + 1;
        }
        continue;
      }
      if (NAME_START.test(ch)) {
        let j = i + 1;
        while (j < raw.length && NAME_REST.test(raw[j] as string)) j += 1;
        const text = raw.slice(i, j);
        push('name', text, span(col, text.length));
        i = j;
        continue;
      }
      if (ch === '"') {
        const end = raw.indexOf('"', i + 1);
        if (end < 0) {
          diagnostics.push({
            code: 'E003',
            message: 'unterminated string',
            span: span(col, raw.length - i),
          });
          break;
        }
        const text = raw.slice(i + 1, end);
        push('string', text, span(col, end - i + 1));
        i = end + 1;
        continue;
      }
      if (PUNCT.has(ch)) {
        push('punct', ch, span(col, 1));
        i += 1;
        continue;
      }
      diagnostics.push({
        code: 'E004',
        message: `unexpected character "${ch}"`,
        span: span(col, 1),
      });
      i += 1;
    }

    push('newline', '', span(raw.length + 1, 0));
  }

  const endSpan: Span = { file, offset, length: 0, line: lines.length, column: 1 };
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ kind: 'dedent', text: '', span: endSpan });
  }
  tokens.push({ kind: 'eof', text: '', span: endSpan });

  if (diagnostics.length > 0) throw new P1Error(diagnostics);
  return tokens;
}
