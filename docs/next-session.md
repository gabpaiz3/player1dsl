# Continuation prompt

Paste the block below into a new session. Everything after it is background for
whoever wants more detail than the prompt carries.

---

## The prompt

> I'm continuing work on Player1DSL, a language and compiler that turns readable `.p1`
> source into real Atari 2600 ROMs. Steps 1 and 2 of the foundation roadmap are done and
> merged-ready; I want to pick up where that left off.
>
> Read these first, in order:
> - `docs/roadmap.md` — the three-step foundation plan and why the parser is deliberately last
> - `docs/spec-review-0.1.md` — the review of `docs/SPEC.md`, organised as architectural
>   decisions / contradictions / gaps
> - `examples/tank-arena/reference/NOTES.md` — every measured hardware cost, and the
>   derivations that turned out wrong
> - `docs/session-logs/2026-08-17.md` — what happened and why
>
> Current state: branch `step2-assembler-emulator`, 13 commits ahead of `main`, CI green
> on both jobs. 16 tests, typecheck and lint clean.
>
> Three pieces of work remain, in the order I'd take them:
>
> 1. **Fold the measured findings into `docs/SPEC.md`.** The headline is §4.4: its band
>    model budgets **zero** scanlines for band transitions, which measure at **five**
>    (two per repositioned object, plus one to absorb the HMOVE comb), so its example
>    layout of 12 + 168 + 12 = 192 does not fit on the machine. Also outstanding from the
>    review: §3 promises both 4 KiB and 8 KiB F8 while §12/§13 say 4 KiB only; §3 lists
>    paddles that phase 1 does not include; `mode mirror` (§4.2) and `mode reflect` (§4.4)
>    are two spellings of one CTRLPF bit; §4.3 does not say that collision latches report
>    object *pairs* rather than actors and are *level* rather than edge; §7.1's compact
>    score kernel is far more expensive than implied, because NUSIZ copies share graphics
>    and multi-digit scores need mid-line GRP rewrites; and §10's repo structure is missing
>    `packages/`, `tests/fixtures/timing/`, `tools/`, `.github/workflows/`,
>    `examples/tank-arena/reference/`, `kernels/include/`, and `docs/session-logs/`.
>
> 2. **Merge `step2-assembler-emulator` into `main`** once the spec work is in. Nothing
>    blocks it.
>
> 3. **Step 3: the narrowest possible compiler.** Parser → IR → codegen, with the language
>    surface limited to exactly what `tank-arena.p1` needs. Done when `p1 build` emits a
>    ROM trace-equivalent to `examples/tank-arena/reference/tank-arena.asm`. The golden
>    already exists, and so does the instrument to verify it.
>
> Working conventions that matter: one session log per day at
> `docs/session-logs/YYYY-MM-DD.md` (see AGENTS.md); npm workspaces, not pnpm; DASM and
> Stella are dev-only and never runtime or CI dependencies; the pre-commit hook gates lint
> and typecheck, CI gates the full suite plus DASM byte parity.
>
> One principle this project earned the hard way: **derivation loses to measurement.** Six
> times in one session, arithmetic that looked sound was wrong, and only running the thing
> caught it. Don't tune a constant until a number appears — build a fixture that isolates
> the mechanism and measure it.

---

## Background the prompt compresses

### What exists

| Thing | State |
|---|---|
| `examples/tank-arena/reference/` | Hand-written 4 KiB NTSC ROM: 3 / 37 / 192 / 30, two joystick tanks, BCD score, collisions |
| `packages/emulator` | 6507 + TIA + RIOT. Frame timing matches Stella on all three ROMs. TIA write tracing with late-write detection |
| `packages/assembler` | Byte-identical to DASM on all four ROMs |
| `tests/fixtures/timing/` | Three diagnostic ROMs that isolate one mechanism each |
| `.githooks/pre-commit` | Artifacts, file size, Biome, tsc |
| `.github/workflows/ci.yml` | Two jobs: Node-only suite, and a DASM parity job |

### Why the ordering is what it is

The parser is last on purpose. Its shape depends on what the kernels need; the kernels do
not depend on it at all. Building the reference ROM first produced the golden that step 3
is measured against, and building the emulator before the assembler produced the
instrument that makes any cycle claim checkable — which is the argument in review §1.1.

### Known gaps worth stating up front

- Object position tracking (RESPx/HMOVE) is not modelled, so `GRP0`/`GRP1` write deadlines
  use a conservative pixel-0 bound with two known-benign false positives.
- The assembler is validated on four real ROMs, not a conformance suite. Opcodes those
  ROMs never exercise are untested.
- The review skill at `.agents/skills/reviewing-player1dsl-changes/` was never
  baseline-tested with subagents.
- No missiles in `tank-arena`: the field kernel has 5 free cycles per line and a missile
  needs ~24. That needs a two-line kernel, i.e. a rendering strategy change, not more code.

### Toolchain

Installed outside the repo, all dev-only: DASM v2.20.17 and Stella 7.0c under
`C:\Users\gabpa\tools\`, plus jq. Node 20+ with npm. `sh examples/tank-arena/reference/run.sh`
builds and launches the ROM; `docs/running-in-stella.md` covers reading the frame-stats
overlay.
