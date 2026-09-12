import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocateGameRam, check, kernelObjects, layout } from '@player1dsl/compiler';
import { parse } from '@player1dsl/parser';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/index.ts';

const example = 'examples/tank-arena/tank-arena.p1';

function capture() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  return {
    out: () => log.mock.calls.map((c) => c.join(' ')).join('\n'),
    errors: () => err.mock.calls.map((c) => c.join(' ')).join('\n'),
    restore: () => {
      log.mockRestore();
      err.mockRestore();
    },
  };
}

describe('p1 check', () => {
  it('exits 0 and reports the RAM map for a valid project', async () => {
    const io = capture();
    const code = await run(['check', example]);
    const output = io.out();
    io.restore();

    expect(code).toBe(0);
    expect(output).toContain('RAM map');
    expect(output).toContain('reserved for the stack');
    expect(output).toContain('tank0_x');
  });

  /**
   * THE reason `allocateGameRam` is exported at all.
   *
   * `p1 check` printed a map four bytes freer than `p1 build` actually left,
   * because `allocateGameRam`'s `scores` parameter defaulted to 0 and only the
   * build passed it -- so the two digit pointers per score were missing from
   * the map and counted as free. The parameter is required now, which stops
   * the argument being OMITTED; this stops it being wrong.
   *
   * Asserting against the build's own numbers rather than against 4 and 62:
   * a literal here would have to be updated whenever the kernel's scratch
   * changes, and updating it is how the two drift apart again.
   */
  it('reports the same RAM the build actually spends', async () => {
    const ir = check(parse(readFileSync(example, 'utf8'), example));
    const built = allocateGameRam(
      ir,
      kernelObjects(layout(ir.scene), ir.scene),
      ir.scene.scores.length,
    );

    const io = capture();
    await run(['check', example]);
    const output = io.out();
    io.restore();

    expect(output).toContain(`${built.used} bytes used`);
    expect(output).toContain(`${built.free} free`);
    // Named, because "used" and "free" would still agree if BOTH were wrong.
    for (let i = 0; i < ir.scene.scores.length; i += 1) {
      expect(output).toContain(`digit${i}Ptr`);
    }
  });

  it('accepts a directory containing exactly one .p1', async () => {
    const io = capture();
    const code = await run(['check', 'examples/tank-arena']);
    io.restore();
    expect(code).toBe(0);
  });

  it('exits 1 and prints a diagnostic with its code for a bad file', async () => {
    const io = capture();
    const code = await run(['check', 'packages/cli/test/fixtures/bad.p1']);
    const errors = io.errors();
    io.restore();

    expect(code).toBe(1);
    expect(errors).toMatch(/E2\d\d/);
    // The diagnostic must point at the source line, not just name the problem.
    expect(errors).toContain('cartridge 8k');
  });

  it('exits 1 for a path that does not exist', async () => {
    const io = capture();
    const code = await run(['check', 'nope/nothing.p1']);
    io.restore();
    expect(code).toBe(1);
  });

  it('exits 2 on an unknown subcommand', async () => {
    const io = capture();
    const code = await run(['nonsense']);
    io.restore();
    expect(code).toBe(2);
  });
});

describe('p1 fmt', () => {
  it('reports the committed example as already formatted', async () => {
    const io = capture();
    const code = await run(['fmt', '--check', example]);
    const output = io.out();
    io.restore();

    expect(code).toBe(0);
    expect(output).toContain('already formatted');
  });
});

describe('p1 check: the line ledger', () => {
  it('prints a balanced ledger for the example', async () => {
    const io = capture();
    const code = await run(['check', example]);
    const output = io.out();
    io.restore();

    expect(code).toBe(0);
    expect(output).toContain('192 of 192 visible scanlines');
    // The field's 158 is the number the compiler had to earn; the source never
    // states it. Seeing it in the report is the point of printing the ledger.
    expect(output).toContain('158');
    expect(output).toContain('solved');
  });

  // The gate, reached through the CLI rather than through buildLedger directly.
  // A gate that only fires in a unit test is not known to reach the user.
  it('exits 1 with E503 when the frame does not balance', async () => {
    const source = readFileSync(example, 'utf8').replace('band field:', 'band field height 157:');
    expect(source, 'the substitution found nothing').toContain('band field height 157');
    const path = join(mkdtempSync(join(tmpdir(), 'p1-')), 'short.p1');
    writeFileSync(path, source, 'utf8');

    const io = capture();
    const code = await run(['check', path]);
    const errors = io.errors();
    io.restore();

    expect(code).toBe(1);
    expect(errors).toContain('E503');
    expect(errors).toContain('1 short');
  });
});
