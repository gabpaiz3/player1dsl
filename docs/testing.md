# Testing guidelines

How this project tests, what exists today, and the disciplines that were learned by
getting them wrong. Read this before adding a test.

## Toolchain

**One library: [vitest](https://vitest.dev).** Its built-in `expect` covers assertions; no
separate assertion, mocking, or snapshot library is installed. That is deliberate — every
dependency in a compiler toolchain is a determinism and supply-chain surface, and vitest
already provides everything used here.

| Tool | Role |
|---|---|
| `vitest` | Test runner and assertions |
| `tsx` | Runs one-off TypeScript scripts (`npm run golden`) |
| `biome` | Lint and format, gated in pre-commit |
| `tsc --build` | Typecheck, gated in pre-commit |
| DASM | **Dev-only** cross-check for assembler byte parity. Never a runtime or CI dependency; the parity test skips loudly without it. |
| Stella | **Dev-only** reference emulator, used to validate our own emulator by agreement |

Config is `vitest.config.ts` at the repository root; tests are discovered at
`packages/*/test/**/*.test.ts`.

```bash
npm test                 # whole suite
npm run test:watch       # watch mode
npx vitest run packages/parser          # one package
npx vitest run -t 'clamps tank 0'       # one test by name
npm run check            # lint + typecheck + tests, as CI runs them
```

## What exists

116 tests across 14 files. They fall into four layers, and the layering matters: each one
is testable without the layer above it.

### Hardware model — `packages/emulator/test/`

| File | Tests | Covers |
|---|---|---|
| `frame-timing.test.ts` | 4 | The reference ROM is 4096 bytes and produces a stable 262-scanline frame split 3/37/192/30. Validated against Stella independently. |
| `timing-fixtures.test.ts` | 3 | WSYNC and the 6532 timer, each isolated by its own diagnostic ROM |
| `trace.test.ts` | 5 | TIA write tracing and late-write detection |
| `golden.test.ts` | 26 | Controller injection, the golden trace format, and the comparator |
| `tank-arena-behaviour.test.ts` | 3 | Movement clamping and the measured bound asymmetry |

### Assembler — `packages/assembler/test/`

| File | Tests | Covers |
|---|---|---|
| `dasm-parity.test.ts` | 6 | Byte-identical output to DASM on all six ROMs |

### Compiler front end — `packages/parser/test/`, `packages/compiler/test/`

| File | Tests | Covers |
|---|---|---|
| `span.test.ts` | 3 | Diagnostic rendering and multi-error collection |
| `lexer.test.ts` | 13 | Indentation, INDENT/DEDENT, comments, numbers, and the two split bugs below |
| `parser.test.ts` | 15 | Every declaration and rule form, plus error recovery |
| `format.test.ts` | 6 | Idempotency and byte-for-byte round-trip of the example |
| `tank-arena.test.ts` | 6 | The example parses and matches the reference ROM's constants |
| `check.test.ts` | 12 | Name resolution, range checks, and that no hardware detail leaks into the game IR |
| `ram.test.ts` | 8 | Allocation, the stack reservation, and determinism |

### CLI — `packages/cli/test/`

| File | Tests | Covers |
|---|---|---|
| `cli.test.ts` | 6 | `p1 check` and `p1 fmt` exit codes and output |

`run()` returns an exit code and never calls `process.exit`, so the CLI is tested without
spawning a process.

## The disciplines

These are not style preferences. Each one is here because its absence cost something.

### 1. Prove a detector can fail before trusting that it passed

**"Zero problems found" also passes with a detector that never fires.**

Before trusting `findLateWrites` on a clean kernel, `tests/fixtures/timing/late-write.asm`
was written to commit the defect on purpose. Before trusting the golden comparator,
`golden-base.asm` and `golden-late.asm` were written as a pair whose only difference is a
write that misses its deadline.

Every checker, detector, or comparator needs a **known-positive** — an input it must
reject — committed alongside the case it must accept.

### 2. Watch the test fail, by deleting the code it covers

Stronger than a known-positive, and cheap. When the golden comparator's deadline check
landed, the check was temporarily sabotaged (`if (true) continue;`) and the suite re-run to
confirm exactly two tests went red. An assertion nobody has watched fail is not evidence.

### 3. Beware the test that cannot fail

**This has now happened twice, in two consecutive plans.** It is the most likely way a test
in this repository is wrong.

- The golden comparator's deadline half was not isolated by the mutation intended to prove
  it — the record half fired first, so deleting the deadline check would still have left
  the test green. Fixed by comparing a ROM against *its own* trace, where the record half
  matches by construction.
- The sprite cross-check extracted `TankSprite`'s bytes by splitting the assembly on the
  string `TankSprite`, which finds the `lda TankSprite,y` *reference* rather than the label
  definition. It compared `[]` against `[]` and passed.

**The rule that falls out:** when a test asserts equality against data it extracted from
somewhere, assert the extraction found something first.

```ts
const reference = referenceSpriteRows();
expect(reference).toHaveLength(8);   // <- without this the next line is theatre
expect(sprite.rows).toEqual(reference);
```

The same applies to "nothing changed" assertions: `tank-arena-behaviour.test.ts` pairs its
clamp test with a *moves at all* test, because "the position stopped changing" also passes
when it never changed.

### 4. Assert measured truth, not current behaviour

When the emulator and the reference kernel disagreed about the frame split, the test was
written to assert what the hardware actually does and left **red for a commit** while the
kernel was fixed. A test edited to match a bug encodes the bug.

Where a measurement contradicted a derivation, record **both** — in the test comment, the
commit message, and the session log. That contrast is the project's evidence base.

### 5. Never tune a constant to make a number appear

An emulator fitted to one ROM agrees with that ROM and is wrong everywhere else, which
destroys the reason to have built it. If a number is off, build a fixture that isolates the
mechanism and measure it.

### 6. One mechanism per fixture

Debugging 264-vs-262 scanlines against the full kernel could not separate a WSYNC error
from a timer error, because the kernel exercises both. Two fixtures — `wsync-only.asm` and
`timer-only.asm` — separated them in one run each.

### 7. Tests read through the public surface

`tank-arena-behaviour.test.ts` reads tank positions out of the TIA write trace rather than
out of RAM, because the trace is what the compiler's output is judged on. Reach into
internals only when the constant itself is the subject, and say so in a comment.

## Goldens

Goldens live in `tests/goldens/` and are **committed deliberately** — the one exception to
the rule against committing generated artifacts. `.gitignore` carries explicit negation
rules for them, because the ignore patterns for build output would otherwise swallow them
silently. That is the worst failure mode a golden has, and it is the reason
`git add --dry-run` is used to *verify* a new golden is committable rather than assuming it.

- **ROM bytes** are stored as SHA-256 manifests. A ROM diff is unreadable, so storing the
  bytes costs repository size and buys nothing a hash does not.
- **Human-readable artifacts** — TIA write traces, listings, reports — are stored whole,
  because those diff usefully when a test fails.

Regenerate with `npm run golden`. **Never regenerate a golden to make a test pass.** Find
why the two disagree first; the golden is the record of what the hardware did.

Input scripts are committed alongside their goldens and must exercise the rules they claim
to cover. An idle script produces a green golden that proves almost nothing.

See [SPEC §11.1](SPEC.md) for the equivalence contract the golden comparator implements.

## Continuous integration

CI runs on **every branch push**, not only on pull requests, so a broken build surfaces
while the branch is still in progress. Two jobs:

| Job | Runs |
|---|---|
| `check` | `npm run lint`, `npm run typecheck`, `npm test` |
| `dasm-parity` | Installs DASM, assembles every ROM with it, then reruns the suite so the parity tests compare against real DASM output instead of skipping |

### Test results in GitHub

**GitHub has no native test-results view** — there is no tab that understands vitest,
JUnit XML, or any other format on its own. The available surfaces, in the order this
project cares about them:

1. **Workflow annotations — in use.** CI runs vitest with
   `--reporter=default --reporter=github-actions`. The reporter emits
   `::error file=…,line=…,column=…` for each failure, which GitHub renders **inline on the
   pull request diff** and in the run summary. Built into vitest, no third-party action,
   no added dependency. This is the highest value per unit of risk and it is why it was
   chosen.
2. **JUnit XML plus a reporting action.** `vitest --reporter=junit` produces standard XML
   that actions such as `dorny/test-reporter` turn into a rich check run with pass/fail
   tables and history. Not adopted: it needs a third-party action in the CI trust boundary
   for a presentation improvement over annotations we already get. Revisit if the suite
   grows large enough that scanning annotations stops working.
3. **Job summaries** (`$GITHUB_STEP_SUMMARY`). Native and free, but vitest emits no
   markdown summary, so it would mean writing and maintaining a formatter. Not worth it
   while the suite is small.

If you add option 2 or 3, update this section — an out-of-date description of how results
surface is worse than none, because someone will trust it.

## Conventions

- Tests live beside their package at `packages/<name>/test/`, not in a central directory.
  `tests/` holds only fixtures and goldens shared across packages.
- One test file per source module, named after it.
- Test names state the behaviour, not the function: *"clamps tank 0 at the left wall
  instead of wrapping past it"*, not *"tank0Position works"*.
- Comment **why** a test exists when the reason is not obvious from its name — especially
  when it encodes a measurement that contradicted a prediction.
- Add a focused test for every compiler bug, and use deterministic emulator traces for
  rendering regressions rather than screenshots.
- Report any test you did not run, and why.
