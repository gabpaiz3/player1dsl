import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'p1-build-'));
}

describe('p1 build --static', () => {
  it('writes a 4096-byte ROM for the tank-arena example', async () => {
    const out = join(scratch(), 'tank-arena.bin');
    const io = capture();
    const code = await run(['build', '--static', 'examples/tank-arena', '-o', out]);
    const output = io.out();
    io.restore();

    expect(code).toBe(0);
    expect(readFileSync(out).byteLength).toBe(4096);
    // The ledger is printed, not just computed. A build command that emits a
    // ROM without saying how it spent 192 scanlines gives nobody anything to
    // check it against.
    expect(output).toContain('visible scanlines');
    expect(output).toContain('two-sprite-static-field');
  });

  it('creates the output directory rather than failing on a missing one', async () => {
    const out = join(scratch(), 'nested', 'deeper', 'rom.bin');
    const io = capture();
    const code = await run(['build', '--static', example, '-o', out]);
    io.restore();
    expect(code).toBe(0);
    expect(readFileSync(out).byteLength).toBe(4096);
  });

  // E503 from increment 4, surfacing through a different command. The gate is
  // the gate regardless of which entry point reaches it -- a `build` that
  // bypassed it would emit the short frame `check` refuses.
  it('refuses to build a scene whose ledger does not balance', async () => {
    const dir = scratch();
    const path = join(dir, 'over.p1');
    // The HUD grows by one line with no band left to give it back: the field
    // takes the remainder, so E504 or E503 fires depending on which way it
    // overflows. Here the two bands together demand more than 192.
    writeFileSync(
      path,
      readFileSync(example, 'utf8').replace('band hud height 12:', 'band hud height 200:'),
      'utf8',
    );

    const io = capture();
    const code = await run(['build', '--static', path, '-o', join(dir, 'over.bin')]);
    const errors = io.errors();
    io.restore();

    expect(code).toBe(1);
    expect(errors).toMatch(/E50[34]/);
  });

  it('requires --static, and says what it is waiting for', async () => {
    const io = capture();
    const code = await run(['build', example]);
    const errors = io.errors();
    io.restore();

    expect(code).toBe(2);
    expect(errors).toContain('--static');
    expect(errors).toMatch(/plan 4/);
  });

  it('defaults the output path to build/<name>.bin', async () => {
    const io = capture();
    const code = await run(['build', '--static', example]);
    const output = io.out();
    io.restore();

    expect(code).toBe(0);
    expect(output).toMatch(/wrote build[/\\]tank-arena\.bin: 4096 bytes/);
  });
});
