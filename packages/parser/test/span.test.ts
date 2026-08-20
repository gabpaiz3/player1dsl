import { describe, expect, it } from 'vitest';
import { type Diagnostic, formatDiagnostic, P1Error } from '../src/span.ts';

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

  it('uses the single message when there is only one diagnostic', () => {
    expect(new P1Error([diagnostic]).message).toContain('unsupported cartridge size');
  });
});
