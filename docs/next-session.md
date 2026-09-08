# Continuation prompt

Paste the block below into a new session. Everything after it is background for whoever
wants more detail than the prompt carries.

---

## The prompt

> I'm continuing work on Player1DSL, a language and compiler that turns readable `.p1`
> source into real Atari 2600 ROMs. **The foundation is done.** All three steps of
> `docs/roadmap.md` are merged: the hand-written reference kernel, the assembler and
> emulator, and the compiler that reproduces it.
>
> `p1 build examples/tank-arena` emits a 4096-byte ROM whose **entire 90-frame TIA-write
> trace matches the hand-written reference kernel's, with zero mismatches and nothing
> filtered out** — a game that reads two joysticks, clamps four bounds, latches a collision
> and debounces it, compiled from a `.p1` that names no scanline, register or cycle.
> 357 tests, `npm run check` green, DASM byte parity, and Stella confirms the picture.
>
> Everything from here is **widening the language**, not proving the architecture. There is
> no plan for it yet, and choosing what to widen first is the job.
>
> Read these first, in order:
> - `docs/roadmap.md` — the three foundation steps and what closed each
> - `docs/SPEC.md` §12 — the delivery phases; phase 2 is "productive games"
> - `docs/kernel-measurements.md` — what every kernel measured, what contradicted a
>   prediction, and **what is still unmeasured**. Nothing in that last list may be treated
>   as zero
> - `docs/session-logs/2026-09-07.md` — **read this before trusting any "unmeasured" line
>   anywhere in this repository**. One entry on that list had been measured for three weeks
> - `docs/testing.md` — the testing disciplines, before writing any test
> - `docs/session-logs/2026-09-04.md` — plan 4's findings, three of them silent failures
>
> ### What the spec says is next, and what it costs
>
> SPEC §12 phase 2 is *scenes/bands, collision model, 8 KiB F8, feasibility and cycle
> reports, `paddle-duel` and `brick-breaker`*. That is a phase, not a plan. Candidates,
> roughly in increasing order of how much they'd force:
>
> - **`docs/language-reference.md`.** The roadmap deferred this deliberately until one ROM
>   existed, because writing the grammar first encodes assumptions the ROM overturns. That
>   condition is now met, and the tank-arena subset is the grammar. Cheapest, and it is the
>   document a second user would need first.
> - **A second example game.** The strongest possible test of the template catalog, whose
>   applicability vocabulary was revised against three kernel shapes but has only ever
>   compiled *one* game. `paddle-duel` or `brick-breaker` per the spec. Expect it to break
>   things — that is the point, and it is what increment 4b's argument predicts.
> - **Missiles**, which `tank-arena` has none of: the field kernel has 5 free cycles per
>   line and a missile needs ~24, so this needs a two-line kernel — a new catalog entry
>   rather than more compiler code.
> - **8 KiB F8 bankswitching**, which nothing yet needs.
>
> **Recommendation: a second game before the language reference.** A grammar written from
> one example documents that example. A second game is what tells you which parts of the
> catalog vocabulary were general and which were `tank-arena` in disguise — and the answer
> changes what the reference should say.
>
> ### Standing cautions, all of them earned
>
> - **Derivation loses to measurement.** Across four plans, reasoning that looked sound was
>   wrong more than a dozen times and only running the thing caught it. Don't tune a
>   constant until a number appears — build a fixture that isolates the mechanism.
> - **A measured value belongs in an assertion, not a comment.** This is 2026-09-07's
>   lesson: a test asserted `30 < T < 45`, which could not tell 37 from 38, so its comment
>   kept claiming a pending measurement for three weeks after the measurement landed, and
>   four documents cited the comment. Where a value cannot be asserted in CI, make the
>   assertion tight enough that the value moving breaks it.
> - **The emulator cannot see a picture.** It models timing and object presence, not pixels,
>   and the golden was recorded from this same emulator — so a shared error (playfield bit
>   order, REF mirroring, sprite column placement) is inherited by both sides and compares
>   equal. `sh scripts/stella.sh` is the only check, and
>   `scripts/stella-shot.ps1` captures the window without needing focus.
> - **The three silent failures of 2026-09-04** — a frame whose length depended on the
>   joystick, `SWCHA` emitted as `$0282` (SWCHB), and `cycleCost` under-charging exactly as
>   its own comment predicted — all compiled, assembled and ran. Assume the next one will
>   too.
>
> Working conventions: one session log per day at `docs/session-logs/YYYY-MM-DD.md`; a
> branch per plan; push early, because CI runs on every branch push and not only on pull
> requests — **and verify the push landed**, because `rtk git push` has failed silently
> before. Open a PR when ready and merge on green. **npm workspaces, not pnpm.** DASM and
> Stella are **dev-only** and never runtime or CI dependencies — CI needs nothing but Node.
> Third-party ROMs, disassemblies and recovered commercial assets never enter the
> repository.

---

## Background the prompt compresses

### What exists

| Thing | State |
|---|---|
| `examples/tank-arena/reference/` | Hand-written 4 KiB NTSC ROM: 3 / 37 / 192 / 30, two joystick tanks, BCD score, collisions |
| `examples/tank-arena/tank-arena.p1` | The source the compiler reproduces. States no scanline counts, timer values, or register names — asserted by a test |
| `packages/emulator` | 6507 + TIA + RIOT. A **timing** model, not a renderer. Object position tracking and all 15 collision latches; write tracing with late-write detection; per-frame controller injection; a region-aware comparator |
| `packages/assembler` | Byte-identical to DASM on six ROMs. `assembleSource` assembles generated text without touching the filesystem |
| `packages/parser` | Indentation-sensitive lexer, recursive-descent parser, span-carrying AST, `p1 fmt` with a byte-for-byte round-trip |
| `packages/runtime` | **Everything measured.** Template catalog, selector, emitter, NTSC frame driver, movement bounds, collision latch table, cycle table, digit font, register equates |
| `packages/compiler` | Checker, game IR, one RAM allocator, layout IR, line ledger and its hard gate, rule lowering, the vertical-blank cycle budget, `build(game, { static })` |
| `packages/cli` | `p1 check`, `p1 fmt`, `p1 build` (with and without `--static`) |
| `tests/goldens/` | 90-frame TIA-write golden of the reference ROM, plus the input script that drives it |
| `tests/fixtures/timing/` | Seven diagnostic ROMs, each isolating one mechanism |
| `tests/fixtures/kernels/` | Three kernel-shape fixtures measured before the catalog vocabulary was committed |
| `tests/fixtures/tia/` | Three fixtures for the object model: double HMOVE, HMCLR, playfield collision |

### The split that must hold

**`runtime` owns anything measured; `compiler` owns anything derived.** `runtime` must never
import from `compiler` — which is why `TiaObject`, `ObjectBinding`, `RowGroupKind`, the
movement bounds and the NTSC region constants live in the runtime. The compiler owns the
binding *decision*; the runtime owns the vocabulary that decision is expressed in.

If a scanline count appears in `packages/compiler`, it belongs in the runtime as template
data.

### Where the artifacts live

`build/<name>.bin` is where `p1 build` writes the **compiler's** ROM.
`build/reference/<name>.bin` is where DASM writes the **reference**. They were one directory
until a `p1 build` run silently replaced the parity baseline, after which the parity test
reported our assembler disagreeing with DASM about bytes DASM never produced.

### Known gaps worth stating up front

- The emulator does not render pixels. See the Stella caution above.
- No missiles in `tank-arena`: the field kernel has 5 free cycles per line and a missile
  needs ~24. That needs a two-line kernel — a new catalog entry, not more compiler code.
- Movement speed above 1 throws `E701` rather than guessing at a clamp that cannot
  overshoot. `copies: 'repositioned'` throws `E602` for the same reason.
- The compiler emits the **derived** movement bound (1/145/9/159), not the reference's
  hand-chosen 8/144/12/155. Reproducing the latter would be transcription. This is why the
  golden's input script never drives a tank to a bound.
- Two RESPx strobes at different clocks *inside* horizontal blank compare equal — the golden
  format stores the pixel, and every blank write shares −1. Recording the colour clock is the
  fix and it changes the file format.
- No template declares a beam-sensitive write yet, so the timing-agreement test compares
  `deadline` with `deadline` seventeen times. It carries an assertion saying so, which turns
  red the day that stops being true.
- Trailing same-line comments are dropped by the parser; blank lines are not preserved by the
  formatter. Both are gaps rather than blockers — `tank-arena.p1` is canonical.
- The review skill at `.agents/skills/reviewing-player1dsl-changes/` has still never been
  baseline-tested with subagents.

### Outstanding specification debt

From `docs/spec-review-0.1.md`, to fold in as each feature forces the answer: §3.3
positioning costs stated generally, §3.7 RNG, §3.8 `hz` for AUDF, §3.9 `resolution 2` /
`spacing`, and the TypeScript integer-discipline conventions. Diagnostic code ranges are not
debt — SPEC §13 defines `E0xx` through `E7xx`.

### Toolchain

Installed outside the repo, all dev-only: DASM v2.20.17 at
`C:\Users\gabpa\tools\dasm\dasm.exe` and Stella 7.0c at
`C:\Users\gabpa\tools\stella\Stella-7.0c\Stella.exe`, plus jq and the GitHub CLI. Node 20+
with npm. Neither DASM nor Stella is on `PATH`; the scripts default to those paths and honour
`DASM` and `P1_EMULATOR` overrides.

- `sh scripts/stella.sh` — build `examples/tank-arena` from its `.p1` and open the result
- `sh examples/tank-arena/reference/run.sh` — build the reference with DASM and open that
- `scripts/stella-shot.ps1` — capture Stella's window without needing it in the foreground;
  pass `-Extra @("-plr.stats","1")` for the frame-stats overlay
- `docs/running-in-stella.md` — reading that overlay
