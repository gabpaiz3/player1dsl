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
> **Read the Known gaps below before believing that paragraph.** It is true of
> `tank-arena` and only of `tank-arena`. An independent review on 2026-09-07 compiled four
> scenes each one edit from the example and got a wrong picture from every one, with no
> diagnostic — and reproduced a frame whose length depends on whether the tanks touched.
> The pipeline holds; the composition layer is fitted to the example.
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
> ### What to do first: three repairs, before any new capability
>
> All three come from the 2026-09-07 review, all are verified, and each gets more expensive
> with every catalog entry and example added on top of it.
>
> 1. **A per-fragment scanline gate.** `checkBudget` (`build.ts:101`) sums *total* rule
>    cycles against *total* vertical blank. The invariant the frame driver actually depends
>    on is per-fragment: `prefix + worstCase(fragment) <= 76`. Nothing checks it, and E704
>    has never fired in any test — all three failure cases in `budget.test.ts` trip E705
>    first, so by this project's own rule the cycle gate is unproven. While fixing it: rule
>    cycles in overscan are charged against vertical blank's budget, and movement rules are
>    charged twice (lines into `setupLines`, cycles into `spent`), so E704's number is not
>    the real number.
> 2. **Delete the silent fallbacks in `build.ts`.** `?? 'p0'` (`:233`, `:250`, `:444`),
>    `?? 0` (`:450`), `sprites[0]` (`:438`), and a ledger row located by matching the
>    human-readable note string `'the open field'` (`:427`). The runtime and lowering refuse
>    rather than guess — E602, E701, E703, `cycleCost` throwing, VDEL throwing. This file
>    does the opposite, and every one of the four broken scenes below goes through one of
>    these lines.
> 3. **Key the emitter by catalog entry.** `emitRowGroup` (`emit.ts:285`) switches on
>    `ctx.kind` and uses its `entry` argument only in an error message, so the id the
>    selector chose does not select code. A second `loop` kernel means a second switch.
>    Half a day at three entries; worse at four.
>
> Then **measure `MISSILE_STROBE_DELAY` and the ball's** (`objects.ts:74-76`, both
> UNMEASURED, and `strobe()` currently uses the missile's for the ball). Every phase-2 game
> needs the ball, and a golden recorded from this emulator would bake an unmeasured constant
> into the reference the compiler is then held to. `tests/fixtures/tia/collide-playfield.asm`
> is the pattern to clone, and `scripts/stella-shot.ps1` is how the sweep gets read.
>
> ### Then a second game — and not either of the two the spec names
>
> SPEC §12 phase 2 is *scenes/bands, collision model, 8 KiB F8, feasibility and cycle
> reports, `paddle-duel` and `brick-breaker`*. That is a phase, not a plan.
>
> `paddle-duel` needs INPT capacitor timing the emulator does not model (`tia.ts:293`
> returns 0) and which SPEC §3 already defers. `brick-breaker` needs per-line playfield
> rewrites *and* ball-vs-playfield collision resting on the unmeasured ball delay.
>
> **Joystick-controlled pong** is the cheapest game that is not `tank-arena` in disguise:
> two players plus a ball, no runs, no border — the exact shape `ball-and-paddles.asm`
> already measured. It forces `ENABL`/`RESBL` emission, a vertical-only `moves`, ball
> velocity and a bounce rule — which means signed state and a conditional, i.e. the
> statement language beyond `move` and `+=`. That is the material a language reference
> actually needs. Call it `paddle-duel` later, when paddles exist.
>
> **`docs/language-reference.md` comes after that, and after coordinate semantics are
> fixed** — see the gap below. Writing it today would mean documenting `x + 3` and a `y`
> that counts upward from below the bottom wall.
>
> **8 KiB F8**: nothing needs it. **Feasibility and cycle reports**: `p1 build` already
> prints the ledger and the budget. What they should print, and what `TemplateEntry` should
> carry, is the selected kernel's per-line free cycles and each fragment's worst case — the
> two numbers that decide whether a missile or a third action fits.
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
> - **Numbers in `src` comments are stale until checked.** The same review found five more:
>   `emit.ts:68` and `:213` give glyph pixels as 1 and 1/10 where `trace.test.ts` pins 7 and
>   16; `rules.ts:67` says 24 worst-case cycles where `rules.test.ts` pins 27;
>   `trace.ts:159` calls object tracking a future increment; `testing.md:35` claims 116
>   tests across 14 files above a 24-row table, against 39 files and 357 tests on disk. A
>   number in a comment should name the test that pins it, or not be a number.
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

**Four scenes one edit from `tank-arena.p1` that compile clean and render wrong.** Balanced
ledger, passing budget, 262-line frame, no diagnostic in any of them. Verified 2026-09-07:

| Scene | What happens |
|---|---|
| Field band only, no HUD | Vertical-blank setup positions both tanks with `lda #0` every frame (`build.ts:450` reads `firstScores[i]?.x`). After 30 frames of joystick-right, `tank0_x` is 71 in RAM and P0 sits at pixel 3. The tank never moves on screen. |
| One score in the HUD, two actors in the field | `layout.ts:225` only repositions objects the *previous* band placed and `build.ts:450` only places the first band's, so P1 is never strobed — it lands wherever the reset clear-loop's `sta $00,x` hit `RESP1`. |
| `within hud` instead of `within field` | Identical `cpx` constants. `rule.within` reaches only a comment (`rules.ts:123`); bounds come from the field row regardless. |
| `tank1` uses a 16-row sprite | `movementBounds` is computed once from `sprites[0]` (`build.ts:438`), so tank1 gets the wrong lower bound and can be driven into the bottom wall. |

**A frame whose length depends on the input, again.** Three `score p0 += 1` actions in the
collision rule: the build passes the budget gate at 351 of 1900 cycles, and frame 35 — the
contact frame — is 263 lines while every other frame is 262. This is the 2026-09-04 finding
in a new disguise; ending each fragment on `sta WSYNC` makes its cost constant across
*branches* but does not bound it within a *line*. `frame.ts`'s "every scanline below is one
`sta WSYNC` that provably executed" is false the moment a fragment overruns 76 cycles.

**Coordinate semantics are kernel internals wearing game-layer clothes.** An actor's `y` is
the field loop's counter — larger is higher, origin at `fieldLastLine + 2` — a score's `y` is
blank lines above the glyph, and `x` renders at `x + 3`. The checker accepts `y` in 0..191 for
all four, while the counter's renderable range is 9..159, so `at (40, 185)` passes and draws
nothing. The `.p1`'s claim to state game-layer intent only is untrue for `(x, y)`. Fix before
documenting; every test pinning 120/9/159 changes with it.

~~**`p1 check` and `p1 build` disagree about RAM.**~~ FIXED 2026-09-08. `p1 check` reported 10
bytes used and 110 free where the build allocated 14, because `allocateGameRam`'s `scores`
parameter defaulted to 0 and only `build` passed it. The parameter is required now, so a
missing argument is a type error rather than an answer, and `cli.test.ts` holds `p1 check`'s
printed totals to the build's own numbers rather than to literals — a literal would need
updating whenever the kernel's scratch changes, and updating it is how the two drift apart
again.

**The `deadline` timing class enforces almost nothing.** `golden.ts` carries deadlines for
PF0/PF1/PF2 only; GRP0/GRP1 are opt-in via `includePlayers`, which the 90-frame comparison
does not pass, and the COLU registers have none. A `GRP0` write at pixel 150 on a visible line
compares equal to the same write in blank. Object positions have been tracked since increment
5c, so exact GRP deadlines are computable now — and `trace.ts:159` still describes that
tracking as "the natural next increment."

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
