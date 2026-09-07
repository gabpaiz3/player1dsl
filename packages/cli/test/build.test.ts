import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

  /**
   * `--static` was a REQUIRED flag while nothing moved: rejecting the bare form
   * kept "the only thing implemented today" from silently becoming the default.
   * Rules are lowered now, so the bare form is the real build and the flag
   * narrows it.
   */
  it('builds a moving game without the flag', async () => {
    const io = capture();
    const code = await run(['build', example, '-o', join(scratch(), 'rom.bin')]);
    const output = io.out();
    io.restore();

    expect(code).toBe(0);
    expect(output).toMatch(/vertical blank: \d+ of \d+ cycles/);
  });

  // `check` and `build` each call layout -> buildLedger themselves. They cannot
  // disagree today, because both are pure functions of the same scene -- but a
  // build that normalised a row would start emitting a frame `check` never
  // reported, and the ledger is the one artifact a human reads to believe the
  // ROM. Cheap to hold, expensive to notice missing.
  it('prints the same ledger as p1 check', async () => {
    const checkIo = capture();
    await run(['check', example]);
    const checked = checkIo.out();
    checkIo.restore();

    const buildIo = capture();
    await run(['build', '--static', example, '-o', join(scratch(), 'rom.bin')]);
    const built = buildIo.out();
    buildIo.restore();

    const ledger = (text: string) =>
      text.slice(text.indexOf('band'), text.indexOf('visible scanlines'));

    // Assert the slice found something BEFORE comparing. Two empty strings are
    // equal, so without this the comparison passes hardest when it has nothing
    // to compare -- which is what the first version of this test did.
    expect(ledger(built)).toContain('two-sprite-static-field');
    expect(ledger(built)).toContain('158');
    expect(ledger(built)).toBe(ledger(checked));
  });

  it('defaults the output path to build/<name>.bin', async () => {
    const io = capture();
    const code = await run(['build', '--static', example]);
    const output = io.out();
    io.restore();

    expect(code).toBe(0);
    expect(output).toMatch(/wrote build[/\\]tank-arena\.bin: 4096 bytes/);
  });

  /**
   * `p1 build` without the flag now lowers rules, which is what the whole of
   * plan 4 was for.
   */
  it('builds without --static now that rules are lowered', async () => {
    const out = join(scratch(), 'dynamic.bin');
    expect(await run(['build', example, '-o', out])).toBe(0);
    expect(statSync(out).size).toBe(4096);
  });

  /**
   * The static build stays reachable BY NAME. static-build.test.ts compares it
   * against golden frame 0, and a flag that silently started meaning "with
   * rules" would leave that test measuring something else while still passing.
   */
  it('still builds a static image when asked for one', async () => {
    const out = join(scratch(), 'static.bin');
    expect(await run(['build', '--static', example, '-o', out])).toBe(0);
    expect(statSync(out).size).toBe(4096);
  });

  it('emits different bytes with rules than without', async () => {
    const dir = scratch();
    const a = join(dir, 'a.bin');
    const b = join(dir, 'b.bin');
    await run(['build', example, '-o', a]);
    await run(['build', '--static', example, '-o', b]);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(false);
  });
});
