/**
 * The `p1` command line.
 *
 * `run` returns the exit code and never calls process.exit, so the CLI is
 * testable without spawning a process. `main.ts` is the thin shell that does.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allocateRam, check } from '@player1dsl/compiler';
import { type Diagnostic, format, formatDiagnostic, P1Error, parse } from '@player1dsl/parser';

const USAGE = [
  'usage: p1 <command> [path]',
  '',
  '  check <path>    parse, type-check, and report the RAM budget',
  '  fmt <path>      rewrite the file in canonical form',
  '  fmt --check     report whether formatting would change anything',
].join('\n');

function isP1Error(error: unknown): error is P1Error {
  return error instanceof P1Error;
}

function reportDiagnostics(diagnostics: readonly Diagnostic[], sources: Map<string, string>): void {
  for (const diagnostic of diagnostics) {
    console.error(formatDiagnostic(diagnostic, sources.get(diagnostic.span.file) ?? ''));
    console.error('');
  }
  console.error(`${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}`);
}

/**
 * Resolve a path to a single `.p1` file.
 *
 * More than one candidate is an error rather than a guess: picking one silently
 * means a build that compiles a different file than the author meant.
 */
function resolveSource(path: string): string {
  if (!existsSync(path)) throw new Error(`no such file or directory: ${path}`);
  if (!statSync(path).isDirectory()) return path;

  const candidates = readdirSync(path).filter((f) => f.endsWith('.p1'));
  if (candidates.length === 1) return join(path, candidates[0] as string);
  if (candidates.length === 0) throw new Error(`no .p1 file in ${path}`);
  throw new Error(`E401: ${candidates.length} .p1 files in ${path}; name the one to use`);
}

export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'check' && command !== 'fmt') {
    console.error(USAGE);
    return 2;
  }

  const checkOnly = rest.includes('--check');
  const target = rest.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error(USAGE);
    return 2;
  }

  let path: string;
  try {
    path = resolveSource(target);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const source = readFileSync(path, 'utf8');
  const sources = new Map([[path, source]]);

  try {
    const program = parse(source, path);

    if (command === 'fmt') {
      const formatted = format(program);
      if (checkOnly) {
        if (formatted === source) {
          console.log(`${path} is already formatted`);
          return 0;
        }
        console.error(`${path} would be reformatted`);
        return 1;
      }
      if (formatted !== source) {
        writeFileSync(path, formatted, 'utf8');
        console.log(`formatted ${path}`);
      } else {
        console.log(`${path} is already formatted`);
      }
      return 0;
    }

    const ir = check(program);
    const ram = allocateRam(ir.variables);

    console.log(`${ir.title} -- ${ir.target} ${ir.cartridge}`);
    console.log('');
    console.log('RAM map');
    for (const [name, address] of ram.slots) {
      const variable = ir.variables.find((v) => v.name === name);
      console.log(
        `  $${address.toString(16).toUpperCase()}  ${name.padEnd(16)} ${variable?.type ?? '?'} = ${variable?.initial ?? 0}`,
      );
    }
    console.log('');
    console.log(
      `  ${ram.used} bytes used, ${ram.stackReserved} reserved for the stack, ${ram.free} free`,
    );
    return 0;
  } catch (error) {
    if (isP1Error(error)) {
      reportDiagnostics(error.diagnostics, sources);
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
