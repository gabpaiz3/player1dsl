/**
 * RAM allocation.
 *
 * SPEC.md 6.2: the 6532 provides 128 bytes, and the STACK lives in those same
 * 128 bytes, growing down from $FF. Without a documented reservation the first
 * sufficiently deep call chain silently corrupts game state -- a defect that
 * shows up as impossible behaviour far from its cause.
 *
 * The reference kernel uses 14 bytes from $80 and lets the stack grow down from
 * $FF, which is the arrangement this reproduces.
 */

import { type Diagnostic, P1Error } from '@player1dsl/parser';
import type { Variable } from './ir.ts';

export const RAM_BASE = 0x80;
export const RAM_SIZE = 128;

/**
 * Bytes held back for the stack.
 *
 * A guess, and labelled as one: nothing has yet measured the deepest call chain
 * the generated code produces. It is deliberately generous, and the moment
 * codegen exists the right move is to measure the true depth and set this from
 * evidence rather than from caution.
 */
export const DEFAULT_STACK_RESERVED = 16;

export interface RamMap {
  /** Variable name to zero-page address, in declaration order. */
  readonly slots: ReadonlyMap<string, number>;
  readonly used: number;
  readonly stackReserved: number;
  readonly free: number;
}

export interface AllocateOptions {
  readonly stackReserved?: number;
}

export function allocateRam(variables: readonly Variable[], options: AllocateOptions = {}): RamMap {
  const stackReserved = options.stackReserved ?? DEFAULT_STACK_RESERVED;
  const budget = RAM_SIZE - stackReserved;
  const diagnostics: Diagnostic[] = [];
  const nowhere = { file: '<ram>', offset: 0, length: 0, line: 1, column: 1 };

  const slots = new Map<string, number>();
  let next = RAM_BASE;

  // Declaration order, never sorted by size or frequency. AGENTS.md requires the
  // same source and tool version to produce equivalent output, and any ordering
  // heuristic needs a documented, stable tiebreak before it can be used here.
  for (const variable of variables) {
    if (slots.has(variable.name)) {
      diagnostics.push({
        code: 'E302',
        message: `"${variable.name}" is allocated twice`,
        span: nowhere,
        hint: 'two variables sharing a name would silently alias one address',
      });
      continue;
    }
    slots.set(variable.name, next);
    next += 1;
  }

  const used = slots.size;
  if (used > budget) {
    const over = used - budget;
    diagnostics.push({
      code: 'E301',
      message: `game state needs ${used} bytes but only ${budget} are available -- ${over} over budget`,
      span: nowhere,
      hint: `${RAM_SIZE} bytes of RAM, less ${stackReserved} reserved for the stack (SPEC 6.2)`,
    });
  }

  if (diagnostics.length > 0) throw new P1Error(diagnostics);
  return { slots, used, stackReserved, free: budget - used };
}
