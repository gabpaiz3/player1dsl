# Continuation prompt

Paste the block below into a new session. Everything after it is background for whoever
wants more detail than the prompt carries.

---

## The prompt

> I'm continuing work on Player1DSL, a language and compiler that turns readable `.p1`
> source into real Atari 2600 ROMs. Steps 1 and 2 of the foundation roadmap are merged.
> Step 3 runs as four plans; plans 1, 2 and 3 are merged. I want to write and execute
> **plan 4**, which covers increments 6 and 7 and closes step 3.
>
> Read these first, in order:
> - `docs/roadmap.md` — the three-step foundation plan and the step-3 plan table
> - `docs/superpowers/specs/2026-08-19-tank-arena-compiler-design.md` — the step-3 design
> - `docs/kernel-measurements.md` — what four kernels measured, what contradicted a
>   prediction, and **what is still unmeasured**. Nothing in that last list may be
>   treated as zero
> - `docs/testing.md` — the testing disciplines, before writing any test
> - `docs/session-logs/2026-08-29.md`, then `2026-08-23.md` and `2026-08-21.md` — plan 3's
>   three working days, including every difference filtered out of the frame-0 comparison
>
> Current state: `main` is green. `p1 build --static examples/tank-arena` emits a real
> 4096-byte ROM that runs 262 scanlines split 3/37/192/30, and **the visible region of
> golden frame 0 matches record for record** — the HUD glyphs, the 5-line band transition
> with both `RESP` strobes on the same colour clocks, both walls, the entry line, and all
> 158 field lines with both tanks. The compiler independently derives 158 from
> `192 − 12 − 5 − 8 − 1 − 8` and refuses to build a frame that does not sum to 192.
> 233 tests, lint and typecheck clean, DASM byte parity on six ROMs.
>
> **Nothing moves yet.** No input, no collisions, no scoring. That is increment 6 and 7.
>
> ### The first thing to do: shrink the frame-0 filter
>
> Two differences are excluded from the frame-0 comparison, both named in
> `packages/emulator/test/static-build.test.ts`:
>
> 1. **`CXCLR`** — collision handling, which is exactly what plan 4 implements. Once
>    collisions are lowered, this exclusion should disappear and the comparison should
>    cover the whole frame.
> 2. **Everything before the first visible line.** The reference reads two joysticks and
>    rebuilds two font pointers in vertical blank; a static build does neither, so it
>    reaches the positioning routine one scanline earlier. Once plan 4 emits the joystick
>    reads and the per-frame score-pointer arithmetic, this may close on its own — but do
>    **not** pad vertical blank to make it close. Padding is tuning a constant to make a
>    number come out, and the writes' values and beam clocks are already compared.
>
> A filter that quietly grows is how a golden stops meaning anything. Every exclusion goes
> in a comment naming what and why, and in the session log.
>
> ### Constants that are still guesses — measure before spending
>
> - **`DEFAULT_STACK_RESERVED = 16`**, labelled as a guess in `packages/compiler/src/ram.ts`.
>   The moment rule lowering exists, measure the deepest call chain and set it from evidence.
> - **The 6532 timer's T.** `timing-fixtures.test.ts` still marks it PENDING a Stella
>   reading, which is why the frame driver counts WSYNCs instead. The reference kernel's own
>   two timer constants were **both** off by one until a measurement corrected them.
> - **Mid-line `RESPx` multiplexing.** Separation, reload budget and exact-clock requirements
>   are all unmeasured; the selector refuses `copies: 'repositioned'` rather than assuming a
>   cost. An unknown cost the selector can refuse to spend is a fact; an omitted one becomes
>   an assumed zero it will happily spend.
> - **The `within field` clamp asymmetry.** `within field` is parsed and resolved but not
>   interpreted. When plan 4 lowers it, it must reproduce the measured asymmetry: a lower
>   bound rests at `X_MIN - 1` while an upper rests exactly at `Y_MAX`, because `bcc` skips
>   only when *already* below while `bcs` skips at or above. A symmetric clamp puts the tank
>   one pixel off and every later `RESPx`/`HMPx` write in the golden diverges.
> - **Our TIA model's systematic errors.** The emulator is a *timing* model and does not
>   render pixels, so no test in this repo can see a wrong playfield bit order, wrong REF
>   mirroring, or a sprite one column off. The golden cannot either — it was recorded from
>   this same emulator, so a shared error is inherited by both sides and compares equal.
>   Stella is the only check: `sh scripts/stella.sh`.
>
> ### One more thing plan 4 must unify
>
> The static build allocates its **own** zero page — an actor's live position, the graphics
> byte computed one line ahead — separately from `allocateRam`, which assigns the variables
> the `.p1` declares. A rule that moves an actor writes the same byte the kernel reads, so
> those two allocators have to become one.
>
> Working conventions: one session log per day at `docs/session-logs/YYYY-MM-DD.md`; a
> branch per plan; push early, because CI runs on every branch push and not only on pull
> requests; open a PR when ready and merge on green. **npm workspaces, not pnpm.** DASM and
> Stella are **dev-only** and never runtime or CI dependencies — CI needs nothing but Node.
> Third-party ROMs, disassemblies and recovered commercial assets never enter the
> repository.
>
> One principle this project keeps re-earning: **derivation loses to measurement.** Across
> four plans, reasoning that looked sound has been wrong more than a dozen times and only
> running the thing caught it. Don't tune a constant until a number appears — build a
> fixture that isolates the mechanism and measure it.

---

## Background the prompt compresses

### What exists

| Thing | State |
|---|---|
| `examples/tank-arena/reference/` | Hand-written 4 KiB NTSC ROM: 3 / 37 / 192 / 30, two joystick tanks, BCD score, collisions |
| `examples/tank-arena/tank-arena.p1` | The source the compiler must reproduce. States no scanline counts, timer values, or register names — asserted by a test |
| `packages/emulator` | 6507 + TIA + RIOT. A **timing** model, not a renderer. Frame timing matches Stella. TIA write tracing, late-write detection, per-frame controller injection, and a comparator with three write timing classes |
| `packages/assembler` | Byte-identical to DASM on six ROMs. `assembleSource` assembles generated text without touching the filesystem |
| `packages/parser` | Indentation-sensitive lexer, recursive-descent parser, span-carrying AST, `p1 fmt` with a byte-for-byte round-trip |
| `packages/runtime` | **Everything measured.** Template catalog, selector, emitter, NTSC frame driver, digit font, register equates |
| `packages/compiler` | Checker, game IR, RAM allocator, layout IR, line ledger and its hard gate, `buildStatic` |
| `packages/cli` | `p1 check`, `p1 fmt`, `p1 build --static` |
| `tests/goldens/` | 90-frame TIA-write golden of the reference ROM, plus the input script that drives it |
| `tests/fixtures/timing/` | Seven diagnostic ROMs, each isolating one mechanism |
| `tests/fixtures/kernels/` | Three kernel-shape fixtures measured before the catalog vocabulary was committed |

### The split that must hold

**`runtime` owns anything measured; `compiler` owns anything derived.** `runtime` must never
import from `compiler` — which is why `TiaObject`, `ObjectBinding`, `RowGroupKind` and the
NTSC region constants live in the runtime. The compiler owns the binding *decision*; the
runtime owns the vocabulary that decision is expressed in.

If a scanline count appears in `packages/compiler`, it belongs in the runtime as template
data.

### Where the artifacts live

`build/<name>.bin` is where `p1 build` writes the **compiler's** ROM.
`build/reference/<name>.bin` is where DASM writes the **reference**. They were one directory
until a `p1 build` run silently replaced the parity baseline, after which the parity test
reported our assembler disagreeing with DASM about bytes DASM never produced.

### Known gaps worth stating up front

- The emulator does not render pixels, so nothing here can check a picture. See the Stella
  note above.
- Object position tracking (RESPx/HMOVE) is not modelled, so `GRP0`/`GRP1` write deadlines
  use a conservative pixel-0 bound with known-benign false positives.
- Two RESPx strobes at different clocks *inside* horizontal blank compare equal — the golden
  format stores the pixel, and every blank write shares −1. Recording the colour clock is the
  fix and it changes the file format.
- No template declares a beam-sensitive write yet, so the timing-agreement test compares
  `deadline` with `deadline` seventeen times. It carries an assertion saying so, which turns
  red the day that stops being true.
- Trailing same-line comments are dropped by the parser; blank lines are not preserved by the
  formatter. Both are gaps rather than blockers — `tank-arena.p1` is canonical.
- No missiles in `tank-arena`: the field kernel has 5 free cycles per line and a missile needs
  ~24. That needs a two-line kernel — a new catalog entry, not more compiler code.
- The review skill at `.agents/skills/reviewing-player1dsl-changes/` has still never been
  baseline-tested with subagents.

### Outstanding specification debt

From `docs/spec-review-0.1.md`, to fold in as each feature forces the answer: §3.3
positioning costs stated generally, §3.7 RNG, §3.8 `hz` for AUDF, §3.9 `resolution 2` /
`spacing`, and the TypeScript integer-discipline conventions. The diagnostic code ranges are
no longer debt — SPEC §13 now defines `E0xx` through `E6xx`.

Review 0.2 §2.3's catalog fields were deliberately deferred to Task 9 of plan 3 and revised
against measurements rather than against the genre survey's predictions. That is done.

### Toolchain

Installed outside the repo, all dev-only: DASM v2.20.17 at
`C:\Users\gabpa\tools\dasm\dasm.exe` and Stella 7.0c at
`C:\Users\gabpa\tools\stella\Stella-7.0c\Stella.exe`, plus jq and the GitHub CLI. Node 20+
with npm. Neither DASM nor Stella is on `PATH`; the scripts default to those paths and honour
`DASM` and `P1_EMULATOR` overrides.

- `sh scripts/stella.sh` — build `examples/tank-arena` from its `.p1` and open the result
- `sh examples/tank-arena/reference/run.sh` — build the reference with DASM and open that
- `docs/running-in-stella.md` — reading the frame-stats overlay
