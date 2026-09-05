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
 * MEASURED, 2026-09-04, and it stopped being a guess. The compiled tank-arena's
 * deepest chain is `MainLoop -> jsr PosObjectX`: one level, **two bytes** of
 * return address, with the stack pointer never dropping below $FD from its
 * $FF. See docs/kernel-measurements.md, "How deep the call chain actually
 * goes".
 *
 * Eight rather than two, and the margin is a decision rather than caution left
 * over. Two bytes buys one level; eight buys four. The language forbids
 * recursion and indirect calls (SPEC 4.3), so depth is bounded by nesting the
 * compiler can see -- but nothing yet nests, so four levels is headroom for a
 * rule form that does, not a number anybody has spent.
 *
 * `rules-behaviour.test.ts` runs the compiled ROM and asserts the real depth
 * stays inside this, so a deeper chain fails loudly instead of quietly
 * corrupting the variables below it.
 */
export const DEFAULT_STACK_RESERVED = 8;

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

/**
 * The kernel's own working bytes.
 *
 * No source line asks for these: `gfxN` holds the graphics byte a scanning loop
 * computed one line ahead, and `lineTmp` is where it parks its counter. They go
 * through `allocateRam` with the declared variables because they compete for the
 * same 128 bytes, and a second allocator is a second answer to which byte is
 * free.
 */
export function kernelScratch(objects: number, scores = 0): Variable[] {
  const scratch: Variable[] = [];
  for (let i = 0; i < objects; i += 1) {
    scratch.push({ name: `gfx${i}`, type: 'byte', initial: 0 });
  }
  scratch.push({ name: 'lineTmp', type: 'byte', initial: 0 });

  // Two bytes per score, ADJACENT and in this order: the glyph band reads
  // `lda (digitNPtr),y`, and the 6502 takes the high byte from the very next
  // address. `ram.test.ts` asserts the adjacency rather than trusting that the
  // allocator keeps declaration order forever.
  for (let i = 0; i < scores; i += 1) {
    scratch.push({ name: `digit${i}Ptr`, type: 'byte', initial: 0 });
    scratch.push({ name: `digit${i}PtrHi`, type: 'byte', initial: 0 });
  }
  return scratch;
}
