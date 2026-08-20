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
