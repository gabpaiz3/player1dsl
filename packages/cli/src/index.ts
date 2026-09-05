/**
 * The `p1` command line.
 *
 * `run` returns the exit code and never calls process.exit, so the CLI is
 * testable without spawning a process. `main.ts` is the thin shell that does.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  allocateGameRam,
  build,
  buildLedger,
  check,
  formatLedger,
  kernelObjects,
  layout,
} from '@player1dsl/compiler';
import { type Diagnostic, format, formatDiagnostic, P1Error, parse } from '@player1dsl/parser';

const USAGE = [
  'usage: p1 <command> [path]',
  '',
  '  check <path>    parse, type-check, and report the RAM and scanline budgets',
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
  if (command !== 'check' && command !== 'fmt' && command !== 'build') {
    console.error(USAGE);
    return 2;
  }

  const checkOnly = rest.includes('--check');
  const outputAt = rest.findIndex((a) => a === '-o' || a === '--output');
  const output = outputAt === -1 ? null : (rest[outputAt + 1] ?? null);
  // `outputAt + 1` is the value of -o, not a positional. Guarded on -1, because
  // an absent flag would otherwise make index 0 the excluded one and silently
  // eat the path argument.
  const positional = rest.filter(
    (a, i) => !a.startsWith('-') && (outputAt === -1 || i !== outputAt + 1),
  );
  const target = positional[0];
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

    if (command === 'build') {
      // `--static` is required rather than assumed. A build flag that defaults
      // `--static` renders the scene's initial state and nothing else. It stays
      // reachable BY NAME rather than becoming the default, because
      // static-build.test.ts compares it against golden frame 0 and a flag that
      // silently started meaning "with rules" would leave that test measuring
      // something else while still passing.
      const { rom, ledger, budget } = build(ir, { static: rest.includes('--static') });
      const out = output ?? join('build', `${basename(path).replace(/\.p1$/, '')}.bin`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, rom);

      console.log(`${ir.title} -- ${ir.target} ${ir.cartridge}`);
      console.log('');
      console.log(formatLedger(ledger));
      console.log('');
      console.log(
        `  vertical blank: ${budget.spent} of ${budget.available} cycles spent, ` +
          `${budget.free} free`,
      );
      console.log('');
      console.log(`wrote ${out}: ${rom.byteLength} bytes`);
      return 0;
    }

    // The SAME allocation the build makes, kernel scratch included. A map that
    // listed only the declared variables would report free bytes `p1 build` has
    // already spent, which is the disagreement one allocator exists to prevent.
    const ir_layout = layout(ir.scene);
    const ram = allocateGameRam(ir, kernelObjects(ir_layout, ir.scene));

    console.log(`${ir.title} -- ${ir.target} ${ir.cartridge}`);
    console.log('');
    console.log('RAM map');
    for (const [name, address] of ram.slots) {
      const variable = ir.variables.find((v) => v.name === name);
      console.log(
        `  $${address.toString(16).toUpperCase()}  ${name.padEnd(16)} ` +
          `${variable?.type ?? 'byte'} = ${variable?.initial ?? 0}` +
          `${variable ? '' : '   (kernel scratch)'}`,
      );
    }
    console.log('');
    console.log(
      `  ${ram.used} bytes used, ${ram.stackReserved} reserved for the stack, ${ram.free} free`,
    );

    // The ledger is a hard gate: buildLedger throws rather than returning a
    // short frame, so reaching this print means the frame balances. The catch
    // below already reports P1Error diagnostics and returns 1, so nothing new
    // is needed here.
    console.log('');
    console.log(formatLedger(buildLedger(ir_layout)));
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
