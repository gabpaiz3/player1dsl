# Review of SPEC.md draft 0.1

**Reviewer note:** this is a review artifact, not a spec change. Nothing in `docs/SPEC.md` was modified.

## Summary

The spec is unusually well-grounded for a draft. The hardware claims I checked are correct: the NTSC frame layout (3 + 37 + 192 + 30 = 262), the 20-bit playfield, the two-player/two-missile/one-ball object set, the D0-ignored color values in the `canyon` palette, the `8x12` sprite literal, the band arithmetic in §4.4 summing to exactly 192, and the audio values in §4.4 (AUDC 0–15, AUDF 0–31, AUDV 0–15). The scoping is honest, the non-goals are real non-goals, and §5's strategy table is the right central abstraction.

The findings below are in three tiers: architectural decisions worth settling before code, internal contradictions to fix now, and gaps for the next document.

---

## Tier 1 — Architectural

### 1.1 Own the emulator, and use it to verify the planner's cycle model

This is the highest-leverage decision in the project, and it is really two decisions that collapse into one.

**Own the emulator.** §8 stage 1 requires per-TIA-write traces, frame boundaries, input reads, collision reads, and RAM deltas. §11 makes TIA-write traces a regression artifact. §7's `p1 test` needs deterministic frame-by-frame input injection. No external emulator hands you an instrumented trace stream on demand — this is an *instrumentation* requirement, not a headless-vs-GUI question, and it is independent of what any external emulator's CLI supports. A 6507 + TIA + RIOT core in TypeScript is a well-trodden problem and it is the only way to get those artifacts.

This also makes the spec consistent with itself: §2 already frames the tiering as "target emulators first, then test hardware as a separate compatibility tier." Extend that one notch — the internal emulator is the build gate, Stella is the compatibility tier. As written, §6 step 8 and §11 make an external GUI binary a hard quality gate, which couples CI to a dependency you do not control.

**Then verify the cycle model against it.** This is the payoff. The E230 diagnostic in §5 asserts "51 cycles [available]; 66 cycles are required." That number is the product's core claim — it is what "the compiler remains honest about the machine terms" (§1) actually cashes out to. If it comes from a hand-maintained cost table, it will silently drift from reality on the first code-generation refactor and nobody will notice.

Recommended gate: for every scheduled visible line in the example projects, a test asserts that the planner's predicted free-cycle count equals the count the emulator measures on that line. That single test class is what makes the honesty claim verifiable rather than aspirational.

### 1.2 Write the assembler; don't depend on an external one

§6 says "a deterministic, checked-in assembler toolchain or an internal assembler" and leaves it open. Recommend closing it on the internal assembler:

- Zero native dependencies means `npm i -g player1dsl` works on every platform with no per-OS binary checked into the repo.
- You control the listing and symbol output, which §6 requires for `game.sym`, `game.lst`, and the source-map links from diagnostics to assembly regions. Bending a third-party assembler's output into your source-map format is more work than emitting it directly.
- You are generating the assembly, so the input is a fixed, small subset of 6502 — not a general assembler.

Cheap correctness insurance: a dev-only (not user-facing, not CI-required) test that cross-checks your encodings against DASM. Correctness benefit without the distribution cost.

### 1.3 Make the planner a template catalog, not a solver

§6 step 5 — "solve horizontal timing, object reuse, and cycle budgets" — reads like a general constraint solver. §5 already hints at the better answer ("compiler-selected template"). Commit to the template reading.

The reason is determinism, not TypeScript's lack of a CP-SAT library. AGENTS.md line 19 requires that the same source and tool version produce equivalent ROM, report, and diagnostic output. A heuristic solver with search ordering and timeouts is a determinism hazard: identical input, different machine speed, different plan. Greedy selection over a pre-verified catalog of kernel templates satisfies both the determinism requirement and §11's golden-output regime, and it gives every diagnostic a nameable cause ("no template in the `multiplex` family accepts this layout") instead of "search failed."

---

## Tier 2 — Contradictions to fix now

### 2.1 §3 says 4 KiB *and* 8 KiB F8; everything else says 4 KiB only

§3: "Initial cartridge output: 4 KiB and 8 KiB F8 bankswitching."
§12 phase 2, §13, README, and AGENTS.md line 6: 4 KiB NTSC for v0.1, F8 later.

§3 is the platform contract, so it is the one people will implement against. Fix §3.

### 2.2 §3 includes paddles in initial controller support; phase 1 does not

§3: "Initial controller support: joystick (one button), console switches, and paddles."
§12 phase 1: joystick only.

Paddles are not a small addition to a joystick reader — they are a different mechanism (capacitor charge timing read through INPT ports, with a per-frame timing loop), with its own cycle cost inside the same VBLANK budget §4.3 is already rationing. Either move paddles to a later phase in §3 or add them explicitly to phase 1 with the budget noted.

### 2.3 `mirror` and `reflect` are two spellings of one thing

§4.2 uses `playfield road, mode mirror`. §4.4 uses `playfield terrain, mode reflect`. §5's table calls it "reflect/mirror" as though they were a pair. There is one hardware bit (CTRLPF D0, REF). Pick one keyword and use it everywhere; if both stay, one must be documented as an alias.

### 2.4 `.gitignore` and §10 disagree about goldens — and so do §10 and AGENTS.md

Mechanically: `.gitignore` ignores `*.bin`, `*.frame.png`, `*.frame.json`, and `*.tia-trace.json`. §10 puts "permitted ROM fixtures" in `tests/fixtures/` and "expected ROM/report/assembly outputs" in `tests/goldens/`. As it stands those files cannot be committed — they will be silently swallowed, which is the worst failure mode for a golden.

But the underlying policy is also undecided: AGENTS.md line 22 says "Do not commit generated ROMs," while §10's goldens directory is defined as holding expected ROM outputs. Decide which:

- **Commit golden ROMs** — add negation rules for `tests/goldens/` and `tests/fixtures/`, and soften AGENTS.md line 22 to "do not commit *build output*; goldens are checked in deliberately." Costs repo size on every regeneration.
- **Store hashes only** — goldens are `.json` manifests of SHA-256 digests plus a regeneration command. Keeps the repo small, but a failing test tells you *that* the ROM changed, not *how*, which weakens the diagnostic value §11 is after.

Recommend hashes for ROM bytes, committed artifacts for the human-readable ones (`.lst`, reports, TIA-write traces), since those diff usefully.

---

## Tier 3 — Gaps for the next document

`docs/language-reference.md` is the artifact that should absorb most of this. §10 already declares it, so its absence is a to-do, not a defect. The items below are the ones a reader of the current spec cannot infer.

### 3.1 The rule language must be statically bounded — say so

§4.3 claims "the compiler rejects unbounded work that cannot fit the available non-visible CPU time." That is a worst-case execution time analysis, and it is only tractable if the rule language has no unbounded loops and no recursion.

This is not a new restriction — §2 already declares "arbitrary C/JavaScript extensions in the game runtime" a non-goal, and §4.2's "bounded arrays" points the same way. Make it explicit and give it teeth: every construct in the game layer has a statically computable cycle bound. This is the single most consequential language design decision in the spec and it is currently only implied.

### 3.2 The RIOT timer is the missing link in the frame-budget story

§3 names the "RIOT I/O/timer model" and then never uses it. The mechanism behind §4.3's central claim — that `every frame` work provably fits in non-visible time — is TIM64T/INTIM bounding the VBLANK and overscan periods. One clause in §3 or §4.3 connecting the two makes the budget claim concrete instead of asserted.

### 3.3 Horizontal positioning has a cost the spec never mentions

There is no mention anywhere of RESPx, HMOVE, the 3-color-clock (one CPU cycle) coarse positioning granularity, the −8..+7 fine adjust in HMPx, or the HMOVE black bar on the left 8 pixels of any line where HMOVE is strobed. For a spec whose stated posture is honesty about machine terms, that is a conspicuous gap — repositioning is most of what a 2600 kernel spends its cycles on.

### 3.4 The band model charges nothing for band transitions

This is the sharpest instance of 3.3, and it lands on the flagship example.

`tank-arena` needs both players for the two tanks. §7.1's score kernel also uses player graphics. That resolves fine via vertical reuse — P0/P1 serve the HUD band, then the field band. But the digits sit at HUD x-positions and the tanks at gameplay x-positions, so the transition requires RESPx + HMOVE on both objects: at minimum a WSYNC'd scanline of overhead, plus the HMOVE comb on the left edge.

§4.4's band model has no room for that. `height 12` + `from 12 to 180` + `height 12` sums to exactly 192, with zero lines budgeted for transitions. Either bands need an explicit transition cost in the model, or the spec needs to state that transition lines are drawn from the adjacent band's allocation — but the abstraction has to acknowledge the cost somewhere, or the first real kernel will silently overrun.

### 3.5 Vertical position is kernel structure, not a coordinate

Actors carry `(x, y)` throughout the spec, but on this machine y is not a register — an object's vertical position is *which scanline the kernel writes GRPx on*. That is the actual reason 2600 games look the way they do, and it constrains how many distinct y-positions can coexist in a band far more tightly than §5's horizontal multiplexing table suggests. §5 covers the horizontal axis thoroughly and the vertical axis not at all. Related: VDELP0/VDELP1 is unmentioned, and it is the standard tool for updating objects across the write boundary without tearing.

### 3.6 Multiplexing destroys hardware collision identity

§4.3 says `when A hits B` uses TIA collision latches "when the rendering plan maps the pair to compatible TIA objects." That is the right hedge, but it understates the interaction with §5. Collision latches are per-object-pair (CXM0P and friends), so when one player object is multiplexed across twelve aliens, a P0/M1 latch says *an* alien was hit, not *which* one. So `strategy multiplex` doesn't merely make collisions cost more — it forces the software fallback for any rule that needs to identify the specific actor. Worth stating directly, since it changes the cost model for the exact strategy the spec is most excited about. The read/clear timing contract (latches read after the visible frame, CXCLR during vertical blank) also belongs in the reference.

### 3.7 RNG is used but never specified

§4.3 uses `y random(32..160)`. There is no RNG in the spec. This is not cosmetic: §11's deterministic frame-capture regressions and §7's `p1 test` are impossible if spawn positions are not reproducible. Specify a seeded LFSR (the conventional 2600 approach), state that the seed is fixed per build and overridable in tests, and note that `random(a..b)` on an LFSR is not uniform unless the range is handled deliberately.

### 3.8 `hz` is the wrong unit for TIA audio

§4.1 lists `hz` among the units. TIA audio frequency is AUDF, a 5-bit divider — the reachable pitches are a sparse, non-uniform set, and most Hz values are simply not expressible. Offering `hz` invites authors to write values the hardware cannot produce. Either drop the unit for audio, or define it as "nearest reachable divider" and have the compiler report the actual resulting pitch. §4.4's `for 6 frames` and `loop` also imply a per-frame sound sequencer with a RAM cost that the RAM budget in §6 step 2 should account for.

### 3.9 Smaller items

- **RAM budget must reserve the stack.** 128 bytes of RIOT RAM, with the stack living in the same space growing down from $FF. §6 step 2 says "calculate RAM and ROM use" — it needs a documented stack reservation, or the first deep call chain corrupts variables.
- **`resolution 2`** appears in §4.4 with no definition. Presumably playfield pixel doubling, but the reader can't tell.
- **`spacing (22, 16)` in §5 is not reachable, and the example hides a bigger cost.** NUSIZ offers 1/2/3 copies at 16, 32, or 64 pixel spacing, so 22px horizontal spacing isn't achievable. More importantly, 6 columns via `copies` requires three copies on P0 *and* three on P1 — consuming every player object in the machine, leaving nothing for the ship or its shots. The example is nearly achievable and the spec doesn't flag what it costs. Worth annotating in place, since it's a teaching example.
- **BCD is fine, and it's worth one clause.** The 6507 has working decimal mode (unlike the NES's 2A03), so §7.1's BCD score kernel is grounded rather than assumed. A single sentence saves a reader the doubt.
- **Error-code scheme.** E230 is the only code in the document. Define the numbering ranges alongside the diagnostics in the language reference.
- **Vendor coupling.** §8 and §10 hardcode "Codex skill" and `.codex/skills/`. The skill content — evidence bundle in, constrained proposal schema out — is vendor-neutral. Recommend a neutral home (`skills/reverse-engineer-2600-to-player1dsl/`) with thin per-vendor pointers, so the workflow isn't tied to one assistant.

---

## TypeScript / Node concerns

**The honest headline: TS/Node is a fine choice, and it is not this project's risk.** Compiler workloads at this scale are trivial for Node, and a cycle-accurate 6507/TIA core in JS is comfortably fast enough. The risk is the planner and the emulator, and those are hard in any language. Nothing below is a reason to reconsider the choice.

**Integer discipline is the one real footgun.** Every value in this domain is uint8 or uint16; JS numbers are doubles and bitwise operators coerce to *signed* int32. Establish conventions early and enforce them in review:

- `Uint8Array` for ROM images, RAM, and TIA register files — not number arrays.
- Explicit `& 0xFF` / `& 0xFFFF` at every write boundary, not "wherever it seemed necessary."
- `>>>` for logical shifts; `>>` will sign-extend and the bug will surface as a rare graphics glitch, not an exception.
- No BigInt. Nothing here needs more than 32 bits and it will cost you an order of magnitude in the emulator inner loop.
- Brand your types (`type U8 = number & {__u8: void}`) if you want the checker's help. Optional, but the emulator and assembler are exactly where it pays.

**No floating point in the timing planner, at all.** Cycle counts, scanline indices, and color clocks are integers; keeping them integers removes an entire class of determinism failure. This applies to §4.2's fixed-point `position` type too — implement it as a scaled integer (e.g. 8.8 in two bytes), never as a JS double rounded at the boundary. Rounding behavior is part of the game's semantics and must match the generated 6502 exactly.

**Determinism checklist for AGENTS.md line 19.** No `Date.now()`, no `Math.random()`, no locale-dependent formatting (`toLocaleString`, `Intl`) in any report path, no reliance on `Object.keys` ordering when keys are integer-like (V8 sorts those numerically), and no parallel workers in the planner unless results are merged in a fixed order. `Map` iteration order is spec'd as insertion order and is safe.

**Windows footgun: add `.gitattributes` now.** You're on Windows 11 and the repo has none. Git will convert LF to CRLF on checkout, which breaks byte-exact goldens for `.lst`, `.sym`, reports, and any hash-based determinism check — and it will break for Windows contributors while passing in Linux CI, which is the worst version of this bug. Before any golden exists:

```gitattributes
* text=auto eol=lf
*.bin binary
*.a26 binary
*.png binary
```

Also worth planning for: `\r\n` in `.p1` source files must not change lexer or formatter output.

**Toolchain.** §10's `packages/` layout implies a monorepo but no tooling is named. pnpm workspaces, Node ≥ 20, ESM throughout, vitest, tsc for builds. Keep the dependency tree small — every native dependency you avoid is a platform where `npm i -g` just works, which reinforces 1.1 and 1.2.

**Prior art worth evaluating: 6502.ts / Stellerator** — a TypeScript Atari 2600 emulator. Useful as an existence proof for the approach and potentially as a reference for TIA edge cases. Flagging one thing before anyone assumes reuse: README says "License selection is pending," and vendoring an emulator core into an npm-distributed toolchain is a licensing decision, not just a technical one. Check the license and settle your own before taking a dependency.

**Golden storage.** Frame captures are 160×192 at a small palette. Committing PNGs on every regeneration will bloat the repo quickly. Prefer hashes in the committed golden plus a documented regeneration command that writes the PNG locally for inspection — which the existing `*.frame.png` ignore rule already anticipates.
