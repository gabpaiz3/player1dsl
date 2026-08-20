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
  /** Character offset of the first character. */
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
    // The code goes in the message. Anything matching on a thrown error -- a
    // test, a CI log, a caller deciding whether to retry -- has only the
    // message, and a bare sentence is not identifiable.
    const first = diagnostics[0];
    super(
      diagnostics.length === 1 && first
        ? `${first.code}: ${first.message}`
        : `compilation failed with ${diagnostics.length} diagnostics` +
            (first ? ` (first: ${first.code})` : ''),
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
