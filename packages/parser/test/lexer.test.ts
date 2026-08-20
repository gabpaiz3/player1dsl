import { describe, expect, it } from 'vitest';
import { lex } from '../src/lexer.ts';

const kinds = (src: string) =>
  lex(src, 't.p1')
    .map((t) => t.kind)
    .filter((k) => k !== 'eof');

describe('lexer', () => {
  it('emits indent and dedent around a block', () => {
    expect(kinds('a:\n  b\n')).toEqual([
      'name',
      'punct',
      'newline',
      'indent',
      'name',
      'newline',
      'dedent',
    ]);
  });

  it('closes every open block at end of input', () => {
    expect(kinds('a:\n  b:\n    c\n')).toEqual([
      'name',
      'punct',
      'newline',
      'indent',
      'name',
      'punct',
      'newline',
      'indent',
      'name',
      'newline',
      'dedent',
      'dedent',
    ]);
  });

  it('ignores blank and comment-only lines for indentation', () => {
    // The comment is emitted, but it must not open a block: `indent` still
    // arrives with `b`, not with the comment above it.
    expect(kinds('a:\n\n  # note\n  b\n')).toEqual([
      'name',
      'punct',
      'newline',
      'comment',
      'indent',
      'name',
      'newline',
      'dedent',
    ]);
  });

  it('emits comment text without its hash or surrounding space', () => {
    const comment = lex('#   note here\n', 't.p1').find((t) => t.kind === 'comment');
    expect(comment?.text).toBe('note here');
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

  it('rejects an unterminated string', () => {
    expect(() => lex('game "oops\n', 't.p1')).toThrow(/E003/);
  });

  it('splits a sprite dimension like 8x8 into number, x, number', () => {
    // Without this the digit run stops at "8" and NAME_START swallows "x8" as
    // an identifier, so `sprite tank 8x8:` silently parses as nonsense.
    const tokens = lex('8x8', 't.p1').filter((t) => t.kind !== 'newline' && t.kind !== 'eof');
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ['number', '8'],
      ['punct', 'x'],
      ['number', '8'],
    ]);
  });

  it('still lexes a bare x as a name, not as the dimension separator', () => {
    expect(lex('x', 't.p1')[0]?.kind).toBe('name');
  });

  it('drops a trailing comment without ending the line early', () => {
    expect(kinds('a b # note\n')).toEqual(['name', 'name', 'newline']);
  });
});
