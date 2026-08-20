# Continuation prompt

Paste the block below into a new session. Everything after it is background for whoever
wants more detail than the prompt carries.

---

## The prompt

> I'm continuing work on Player1DSL, a language and compiler that turns readable `.p1`
> source into real Atari 2600 ROMs. Steps 1 and 2 of the foundation roadmap are merged.
> Step 3 runs as four plans; plans 1 and 2 are merged. I want to write and execute plan 3.
>
> Read these first, in order:
> - `docs/roadmap.md` — the three-step foundation plan and the step-3 plan table
> - `docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md` — the step-3 design.
>   Read "The line ledger" and "Why increment 4b exists" carefully; they are what plan 3 is
> - `docs/testing.md` — the testing disciplines, before writing any test
> - `docs/genre-survey.md` — the three vocabulary gaps increment 4b has to resolve
> - `docs/session-logs/2026-08-20.md` and `2026-08-19.md` — what was measured, and what
>   contradicted a prediction
>
> Current state: `main` is green. There is a compiler front end and a runnable acceptance
> criterion, and no back end at all. `p1 check examples/tank-arena` parses `tank-arena.p1`,
> type-checks it, and prints a RAM map; `p1 fmt` round-trips it byte for byte. 116 tests,
> lint and typecheck clean, DASM byte parity on six ROMs.
>
> **Plan 3 covers increments 4, 4b and 5**, and needs writing before it can be executed:
>
> 1. **Increment 4 — the layout IR and the line ledger.** This is the crux of step 3. From
>    `band hud height 12` and a `field` band with no height, the compiler must
>    independently arrive at **158** field lines via `192 − 12 − 5 − 8 − 1 − 8`, using two
>    already-measured rules: a band transition costs `2n + 1` visible lines for *n*
>    repositioned objects, and a region change following a loop exit costs one more because
>    the loop leaves no horizontal blank. The ledger is a **hard gate** — if it does not sum
>    to exactly 192, the build fails. A silently short frame is the defect class that
>    survived five rounds of visual verification in step 1.
> 2. **Increment 4b — three kernel-shape fixtures**, measured before the catalog interface
>    is committed: `scroll-field` (playfield rewritten every line), `ball-and-paddles` (two
>    players plus the ball, no runs, no border), `sprite-formation` (one object multiplexed
>    across a row). The genre survey already predicts three gaps in the applicability
>    vocabulary; these fixtures test those predictions rather than confirming them.
> 3. **Increment 5 — the template catalog and selector**, with applicability conditions and
>    costs declared as data rather than baked into code.
>
> Two things that are easy to lose and expensive to rediscover:
>
> - **`within field` is parsed and resolved but not yet interpreted.** When plan 4 lowers
>   it, it must reproduce the measured asymmetry: a lower bound rests at `X_MIN - 1` while
>   an upper rests exactly at `Y_MAX`, because `bcc` skips only when *already* below while
>   `bcs` skips at or above. A symmetric clamp puts the tank one pixel off and every later
>   `RESPx`/`HMPx` write in the golden trace diverges.
> - **`DEFAULT_STACK_RESERVED = 16` is a guess**, labelled as one in
>   `packages/compiler/src/ram.ts`. The moment codegen exists, measure the deepest call
>   chain and set it from evidence.
>
> Working conventions: one session log per day at `docs/session-logs/YYYY-MM-DD.md`; a
> branch per plan; push early, because CI runs on every branch push and not only on pull
> requests; open a PR when ready and merge on green. npm workspaces, not pnpm. DASM and
> Stella are dev-only and never runtime or CI dependencies.
>
> One principle this project keeps re-earning: **derivation loses to measurement.** Eleven
> times across four plans, reasoning that looked sound was wrong and only running the thing
> caught it. Don't tune a constant until a number appears — build a fixture that isolates
> the mechanism and measure it.

---

## Background the prompt compresses

### What exists

| Thing | State |
|---|---|
| `examples/tank-arena/reference/` | Hand-written 4 KiB NTSC ROM: 3 / 37 / 192 / 30, two joystick tanks, BCD score, collisions |
| `examples/tank-arena/tank-arena.p1` | The source the compiler must reproduce. States no scanline counts, timer values, or register names — asserted by a test |
| `packages/emulator` | 6507 + TIA + RIOT. Frame timing matches Stella. TIA write tracing, late-write detection, per-frame controller injection |
| `packages/assembler` | Byte-identical to DASM on six ROMs |
| `packages/parser` | Indentation-sensitive lexer, recursive-descent parser, span-carrying AST, `p1 fmt` with a byte-for-byte round-trip |
| `packages/compiler` | Checker, game IR (no hardware detail, asserted), RAM allocator with the stack reserved |
| `packages/cli` | `p1 check`, `p1 fmt` |
| `tests/goldens/` | 90-frame TIA-write golden of the reference ROM, plus the input script that drives it |
| `tests/fixtures/timing/` | Five diagnostic ROMs, each isolating one mechanism |

### The acceptance criterion, already runnable

Two ROMs are equivalent when, driven by the same committed input script, they produce the
same sequence of TIA writes: identical register, value and scanline, with a colour clock
that meets that register's deadline. The clock is recorded for diffing but **not asserted**
— it is a function of instruction cycle counts, and asserting it would force the compiler
to reproduce the reference's exact instruction selection, which is transcription rather
than compilation.

The comparator is proved against two known-positives and was verified by deleting the
deadline check to confirm the right tests go red.

### Known gaps worth stating up front

- Object position tracking (RESPx/HMOVE) is not modelled, so `GRP0`/`GRP1` write deadlines
  use a conservative pixel-0 bound with two known-benign false positives.
- Trailing same-line comments are dropped by the parser. Every comment in `tank-arena.p1`
  sits on its own line, so this is a gap rather than a blocker.
- Blank lines are not preserved by the formatter; the example file is canonical instead.
  Preserving them means deciding whether a comment separated by a blank line is a file
  header or a comment on the declaration below it.
- Diagnostic code ranges (`E0xx` lexer, `E1xx` parser, `E2xx` checker, `E3xx` RAM, `E4xx`
  CLI) were invented in plan 2. SPEC §13 only ever defined `E230`.
- No missiles in `tank-arena`: the field kernel has 5 free cycles per line and a missile
  needs ~24. That needs a two-line kernel — a new catalog entry, not more compiler code.
- The review skill at `.agents/skills/reviewing-player1dsl-changes/` has still never been
  baseline-tested with subagents.

### Outstanding specification debt

From `docs/spec-review-0.1.md`, to fold in as each feature forces the answer: §3.3
positioning costs stated generally, §3.7 RNG, §3.8 `hz` for AUDF, §3.9 `resolution 2` /
`spacing` / error-code ranges, and the TypeScript integer-discipline conventions.

### Toolchain

Installed outside the repo, all dev-only: DASM v2.20.17 and Stella 7.0c under
`C:\Users\gabpa\tools\`, plus jq and the GitHub CLI. Node 20+ with npm.
`sh examples/tank-arena/reference/run.sh` builds and launches the reference ROM;
`docs/running-in-stella.md` covers reading the frame-stats overlay.
