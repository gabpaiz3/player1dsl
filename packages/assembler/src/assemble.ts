import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MODE_SIZE, type Mode, OPCODES } from './opcodes.ts';

export interface AssembleOptions {
  /** Directories searched by `include`, in order. */
  readonly includeDirs?: readonly string[];
}

export interface AssembleResult {
  /** Raw image from the lowest to the highest emitted address, DASM -f3 style. */
  readonly rom: Uint8Array;
  readonly symbols: ReadonlyMap<string, number>;
  readonly origin: number;
}

export class AssemblyError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line: number,
  ) {
    super(`${file}:${line}: ${message}`);
    this.name = 'AssemblyError';
  }
}

interface SourceLine {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Expand `include` directives depth-first into one flat line list. */
function loadSource(
  path: string,
  includeDirs: readonly string[],
  seen: string[] = [],
): SourceLine[] {
  const resolved = resolve(path);
  if (seen.includes(resolved)) throw new Error(`circular include: ${resolved}`);
  const out: SourceLine[] = [];
  const raw = readFileSync(resolved, 'utf8').split(/\r?\n/);

  raw.forEach((text, index) => {
    const include = /^\s*include\s+"([^"]+)"/i.exec(text);
    const name = include?.[1];
    if (name) {
      const candidates = [
        resolve(dirname(resolved), name),
        ...includeDirs.map((d) => resolve(d, name)),
      ];
      const found = candidates.find((candidate) => {
        try {
          readFileSync(candidate);
          return true;
        } catch {
          return false;
        }
      });
      if (!found) throw new AssemblyError(`include not found: ${name}`, resolved, index + 1);
      out.push(...loadSource(found, includeDirs, [...seen, resolved]));
      return;
    }
    out.push({ file: resolved, line: index + 1, text });
  });
  return out;
}

/** Strip comments. These sources contain no string literals, so this is safe. */
function stripComment(text: string): string {
  const semi = text.indexOf(';');
  return (semi === -1 ? text : text.slice(0, semi)).replace(/\s+$/, '');
}

type Symbols = Map<string, number>;

/**
 * Evaluate a DASM-flavoured expression: $hex, %binary, decimal, symbols,
 * `*` for the current address, `<`/`>` byte selectors, + - * / & | and parens.
 */
function evaluate(expr: string, symbols: Symbols, pc: number, scope: string): number {
  const s = expr.trim();
  let i = 0;

  const peek = (): string => s[i] ?? '';
  const skipSpace = (): void => {
    while (i < s.length && /\s/.test(s[i] ?? '')) i += 1;
  };

  function primary(): number {
    skipSpace();
    const c = peek();
    if (c === '(') {
      i += 1;
      const v = additive();
      skipSpace();
      if (peek() === ')') i += 1;
      return v;
    }
    if (c === '<') {
      i += 1;
      return primary() & 0xff;
    }
    if (c === '>') {
      i += 1;
      return (primary() >> 8) & 0xff;
    }
    if (c === '-') {
      i += 1;
      return -primary();
    }
    if (c === '~') {
      i += 1;
      return ~primary();
    }
    if (c === '$') {
      i += 1;
      const m = /^[0-9a-fA-F]+/.exec(s.slice(i));
      if (!m) throw new Error(`bad hex in "${expr}"`);
      i += m[0].length;
      return parseInt(m[0], 16);
    }
    if (c === '%') {
      i += 1;
      const m = /^[01]+/.exec(s.slice(i));
      if (!m) throw new Error(`bad binary in "${expr}"`);
      i += m[0].length;
      return parseInt(m[0], 2);
    }
    if (c === '*') {
      i += 1;
      return pc;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+/.exec(s.slice(i));
      if (!m) throw new Error(`bad number in "${expr}"`);
      i += m[0].length;
      return parseInt(m[0], 10);
    }
    const m = /^[.A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (!m) throw new Error(`unexpected "${s.slice(i)}" in "${expr}"`);
    i += m[0].length;
    const scoped = m[0].startsWith('.') ? `${scope}${m[0]}` : m[0];
    const value = symbols.has(scoped) ? symbols.get(scoped) : symbols.get(m[0]);
    if (value === undefined) throw new Error(`undefined symbol "${m[0]}"`);
    return value;
  }

  function multiplicative(): number {
    let v = primary();
    for (;;) {
      skipSpace();
      const c = peek();
      if (c === '*') {
        i += 1;
        v *= primary();
      } else if (c === '/') {
        i += 1;
        const d = primary();
        v = d === 0 ? 0 : Math.floor(v / d);
      } else if (c === '&') {
        i += 1;
        v &= primary();
      } else if (c === '|') {
        i += 1;
        v |= primary();
      } else {
        return v;
      }
    }
  }

  function additive(): number {
    let v = multiplicative();
    for (;;) {
      skipSpace();
      const c = peek();
      if (c === '+') {
        i += 1;
        v += multiplicative();
      } else if (c === '-') {
        i += 1;
        v -= multiplicative();
      } else {
        return v;
      }
    }
  }

  const result = additive();
  skipSpace();
  if (i < s.length) throw new Error(`trailing "${s.slice(i)}" in "${expr}"`);
  return result;
}

interface Operand {
  readonly mode: Mode | 'auto';
  readonly expr: string;
  readonly indexed?: 'x' | 'y';
}

/** Classify an operand's addressing mode from its syntax alone. */
function parseOperand(raw: string): Operand {
  const text = raw.trim();
  if (text === '') return { mode: 'imp', expr: '' };
  if (/^[Aa]$/.test(text)) return { mode: 'acc', expr: '' };
  if (text.startsWith('#')) return { mode: 'imm', expr: text.slice(1) };

  const izx = /^\(\s*(.+?)\s*,\s*[Xx]\s*\)$/.exec(text);
  if (izx?.[1]) return { mode: 'izx', expr: izx[1] };
  const izy = /^\(\s*(.+?)\s*\)\s*,\s*[Yy]$/.exec(text);
  if (izy?.[1]) return { mode: 'izy', expr: izy[1] };
  const ind = /^\(\s*(.+?)\s*\)$/.exec(text);
  if (ind?.[1]) return { mode: 'ind', expr: ind[1] };
  const idxX = /^(.+?)\s*,\s*[Xx]$/.exec(text);
  if (idxX?.[1]) return { mode: 'auto', expr: idxX[1], indexed: 'x' };
  const idxY = /^(.+?)\s*,\s*[Yy]$/.exec(text);
  if (idxY?.[1]) return { mode: 'auto', expr: idxY[1], indexed: 'y' };
  return { mode: 'auto', expr: text };
}

const MAX_PASSES = 8;

export function assemble(path: string, options: AssembleOptions = {}): AssembleResult {
  const lines = loadSource(path, options.includeDirs ?? []);
  const symbols: Symbols = new Map();
  /** Instruction sizes by source index, refined across passes. */
  const sizes = new Map<number, number>();
  let emittedFinal = new Map<number, number>();

  // Multi-pass: an operand can shrink from absolute to zero page once its
  // symbol is known, which shifts every later address. Iterate to a fixed point.
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const emitted = new Map<number, number>();
    const lastPass = pass === MAX_PASSES - 1;
    let pc = 0;
    let scope = '';
    let emitting = true; // false inside `seg.u`
    let changed = false;

    const emit = (byte: number): void => {
      if (emitting) emitted.set(pc, byte & 0xff);
      pc = (pc + 1) & 0xffff;
    };

    lines.forEach((source, index) => {
      const text = stripComment(source.text);
      if (text.trim() === '') return;

      const fail = (message: string): never => {
        throw new AssemblyError(message, source.file, source.line);
      };

      // A label must start in column 0; anything indented is an instruction.
      let rest = text;
      let label: string | null = null;
      if (!/^\s/.test(text)) {
        const labelMatch = /^([.A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(text);
        if (labelMatch?.[1]) {
          label = labelMatch[1];
          rest = labelMatch[2] ?? '';
        }
      }

      const words = rest.trim();
      const equate = label ? /^=\s*(.+)$/.exec(words) : null;

      if (label && !equate) {
        const full = label.startsWith('.') ? `${scope}${label}` : label;
        if (!label.startsWith('.')) scope = label;
        if (symbols.get(full) !== pc) changed = true;
        symbols.set(full, pc);
      }

      if (words === '') return;

      const [head = '', ...tailParts] = words.split(/\s+/);
      const tail = tailParts.join(' ').trim();
      const directive = head.toLowerCase();

      try {
        const equateExpr = equate?.[1];
        if (equateExpr && label) {
          const value = evaluate(equateExpr, symbols, pc, scope);
          if (symbols.get(label) !== value) changed = true;
          symbols.set(label, value);
          return;
        }

        switch (directive) {
          case 'processor':
            return;
          case 'subroutine':
            if (label) scope = label;
            return;
          case 'seg':
            emitting = true;
            return;
          case 'seg.u':
            emitting = false;
            return;
          case 'org':
            pc = evaluate(tail, symbols, pc, scope) & 0xffff;
            return;
          case 'align': {
            const n = evaluate(tail, symbols, pc, scope);
            while (n > 0 && pc % n !== 0) emit(0);
            return;
          }
          case 'ds': {
            const n = evaluate(tail, symbols, pc, scope);
            for (let k = 0; k < n; k += 1) emit(0);
            return;
          }
          case '.byte':
          case 'byte':
          case 'dc':
          case 'dc.b': {
            for (const part of tail.split(',')) emit(evaluate(part, symbols, pc, scope));
            return;
          }
          case '.word':
          case 'word':
          case 'dc.w': {
            for (const part of tail.split(',')) {
              const v = evaluate(part, symbols, pc, scope) & 0xffff;
              emit(v & 0xff);
              emit((v >> 8) & 0xff);
            }
            return;
          }
          default:
            break;
        }

        const mnemonic = head.toUpperCase();
        const table = OPCODES[mnemonic];
        if (!table) {
          throw new AssemblyError(
            `unknown instruction or directive "${head}"`,
            source.file,
            source.line,
          );
        }

        const operand = parseOperand(tail);
        let mode: Mode;

        if (operand.mode === 'imp' && table.acc && !table.imp) {
          mode = 'acc';
        } else if (operand.mode !== 'auto') {
          mode = operand.mode;
        } else if (table.rel) {
          mode = 'rel';
        } else {
          // Prefer zero page when the value is known to fit and a zp form
          // exists. This is the rule DASM applies, and byte parity requires it.
          let value: number | null = null;
          try {
            value = evaluate(operand.expr, symbols, pc, scope);
          } catch {
            value = null;
          }
          const zpMode: Mode =
            operand.indexed === 'x' ? 'zpx' : operand.indexed === 'y' ? 'zpy' : 'zp';
          const absMode: Mode =
            operand.indexed === 'x' ? 'abx' : operand.indexed === 'y' ? 'aby' : 'abs';
          mode =
            value !== null && value >= 0 && value <= 0xff && table[zpMode] !== undefined
              ? zpMode
              : absMode;
        }

        const opcode = table[mode];
        if (opcode === undefined) {
          throw new AssemblyError(
            `${mnemonic} does not support ${mode} addressing`,
            source.file,
            source.line,
          );
        }

        const size = MODE_SIZE[mode];
        if (sizes.get(index) !== size) {
          sizes.set(index, size);
          changed = true;
        }

        const instructionPc = pc;
        emit(opcode);
        if (size === 1) return;

        const value = evaluate(operand.expr, symbols, instructionPc, scope);
        if (mode === 'rel') {
          const offset = value - (instructionPc + 2);
          if (offset < -128 || offset > 127) fail(`branch out of range (${offset} bytes)`);
          emit(offset & 0xff);
        } else if (size === 2) {
          emit(value & 0xff);
        } else {
          emit(value & 0xff);
          emit((value >> 8) & 0xff);
        }
      } catch (error) {
        if (error instanceof AssemblyError) throw error;
        // Forward references are expected to be unresolved on early passes.
        if (lastPass) fail((error as Error).message);
        changed = true;
        const assumed = sizes.get(index) ?? 3;
        for (let k = 0; k < assumed; k += 1) emit(0);
      }
    });

    emittedFinal = emitted;
    if (!changed && pass > 0) break;
  }

  const addresses = [...emittedFinal.keys()].sort((a, b) => a - b);
  const first = addresses[0];
  const last = addresses[addresses.length - 1];
  if (first === undefined || last === undefined) throw new Error('assembled nothing');

  // DASM pads unwritten bytes inside the image with $FF, not $00. Byte parity
  // depends on matching that: a 4 KiB cartridge is mostly gap, and $00 would
  // disassemble as BRK where $FF is an unused opcode.
  const image = new Uint8Array(last - first + 1).fill(0xff);
  for (const [address, byte] of emittedFinal) image[address - first] = byte;

  return { rom: image, symbols, origin: first };
}
