# Review of SPEC.md draft 0.2

**Reviewer note:** this is a review artifact, not a specification change. Nothing in
`docs/SPEC.md` was modified.

## Summary

The specification has a strong hardware-honest foundation. Its central ideas -- logical
actors distinct from TIA objects, bounded game rules, template-selected kernels, and
trace-based regression tests -- are the right ones. The next revision should make the
development feedback loop and visual equivalence contract more precise before widening
the language.

The review considered the repository implementation, the current roadmap and genre
survey, and the local reference images. The images themselves are third-party commercial
screenshots and remain untracked; `docs/genre-survey.md` is the committed evidence record.

Evidence labels below follow `AGENTS.md`:

- **observed** -- directly present in the source, tests, or reference images.
- **inferred** -- a conclusion drawn from the observed evidence.
- **recommended** -- a proposed specification or roadmap change.

## Tier 1 -- correctness and development feedback

### 1.1 Tighten the visual-equivalence contract

**observed:** SPEC §11.1 compares the register, value, and scanline of TIA writes, but
records colour clocks without asserting them. It treats meeting a register deadline as
enough to establish equivalence.

**inferred:** this is not sufficient for beam-position-sensitive strobes. `RESP0`,
`RESP1`, `RESM0`, `RESM1`, and `RESBL` use the beam's position; changing one by a CPU
cycle changes the coarse horizontal placement while preserving register, value, and
scanline. `HMOVE` and `RSYNC` likewise have timing-sensitive visual effects. A candidate
ROM could therefore pass the present comparison while rendering a shifted object.

**recommended:** classify TIA writes in the golden contract:

- Assert the exact colour clock for beam-position-sensitive strobes and any write whose
  effect depends on the current beam position.
- Assert register, value, scanline, and a proven deadline for ordinary display-data writes.
- Make each template declare its writes and whether each needs an exact clock or a
  deadline. The comparator should consume that declaration rather than maintain a second,
  disconnected rule table.

This is the highest-priority spec correction because visual equivalence is the acceptance
criterion for compiler output.

### 1.2 Make deterministic frame capture a product feature

**observed:** `packages/emulator` correctly supplies a 6507/RIOT/TIA timing model,
per-frame controller injection, TIA-write traces, late-write detection, and golden
serialization. Its own module header says the TIA is deliberately a timing model rather
than a renderer. It does not yet track object positions or render pixels; collision and
input-register reads in `Tia.read()` are not modelled.

**inferred:** the present emulator can establish that a ROM boots, produces a stable
262-line frame, and performs a plausible sequence of writes. It cannot establish that
the requested picture, collision behaviour, or gameplay is correct. Trace regression is
necessary but is not a replacement for rasterized-frame regression once code generation
exists.

**recommended:** add a deterministic capture interface to the planned emulator and CLI:

```text
p1 build --report json
p1 test tests/scripts/tank-arena.json
p1 capture --frame 120 --png build/frame-120.png --state build/frame-120.json
```

The PNG is the review artifact for a human or LLM. The JSON sidecar should contain the
frame number, input state, palette/region, source locations, selected template,
actor-to-TIA mapping, TIA writes, collision/input state, and per-line cycle headroom. It
makes every visual conclusion reproducible and lets reports explain *why* an image looks
as it does.

Stella screenshots remain useful manual compatibility evidence. They should not be the
canonical automated artifact: the project owns the instrumentation it needs and requires
deterministic inputs, traces, and reports.

### 1.3 Define what a functional ROM smoke test proves

**observed:** SPEC §11 requires a ROM to load in automated Stella smoke testing. The
roadmap correctly identifies the internal emulator as the instrument needed by compiler
tests, while Stella is the compatibility tier.

**recommended:** replace the vague smoke-test requirement with explicit assertions:

- valid reset vectors and a reached steady frame loop;
- a stable 262-line NTSC frame and valid 3/37/192/30 region split;
- no unsupported CPU instruction or emulator fault;
- scripted input causes declared observable state changes;
- requested collision and audio paths execute under directed scripts;
- at least one deterministic raster capture is produced and compared where a renderer is
  available.

Separate statuses in reports: **timing-functional**, **render-verified**, and
**compatibility-checked in Stella**. This prevents a trace-only result being mistaken for
a visually playable game.

## Tier 2 -- language and scheduling commitments

### 2.1 Specify missing deterministic game semantics

**observed:** SPEC examples use `random(32..160)`, fixed-point positions, input, sound
durations, spawning, destruction, and bounded arrays, but several semantics are not yet
defined.

**recommended:** the language reference should specify:

- a seeded deterministic PRNG, including test seed override and range-bias policy;
- fixed-point representation, rounding, comparison, and overflow semantics;
- byte/int8 arithmetic overflow and score saturation/wrap policy;
- controller sampling and button edge/repeat semantics;
- actor lifecycle, bounded pools, spawn failure, destruction, and iteration order;
- animation frame state and timing;
- room/map state, scene transitions, and persistence;
- the exact grammar and bounds for fixed-trip-count iteration.

These are not cosmetic. They determine whether the same source and input script can
produce equivalent ROM, report, trace, and screenshot output.

### 2.2 Make the expert layer subordinate to scheduling

**observed:** SPEC §4.1 offers an expert layer with named TIA/RIOT operations and scanline
blocks, while the product promise rests on compiler-owned timing validation.

**inferred:** unrestricted register writes or handwritten scanline blocks could bypass
the planner and make an otherwise valid feasibility report untrue.

**recommended:** require expert code to select a named template/escape-hatch profile,
declare RAM use and every TIA/RIOT write with exact timing/deadline metadata, and undergo
the same trace/raster checks as generated code. It must never silently replace a planned
rendering strategy or introduce flicker.

### 2.3 Promote the genre-survey gaps into catalog metadata

**observed:** `docs/genre-survey.md` identifies three missing applicability axes:
playfield writes per line, ball-object use, and multiplex separation/per-line reload
budget. The layout design schedules fixtures to measure these cases.

**recommended:** make these required fields of the template catalog in SPEC §6.1, rather
than leaving them as a future hypothesis:

- playfield update rate and asymmetry/scroll support;
- P0/P1/M0/M1/ball ownership and coupling;
- supported vertical-position model and maximum independent moving rows;
- multiplex event count, minimum separation, reload work, and exact-clock requirements;
- score/HUD location and transition cost;
- collision identity preserved, degraded to software, or unavailable.

The selector can then give actionable diagnostics such as “this template supports a
static reflected field, but the scene writes three playfield registers per line.”

### 2.4 Clarify future-looking syntax versus implemented phase-1 syntax

**observed:** the specification describes scenes, swarms, strategies, sound, timers, and
asset imports. The current parser/checker implements the intentionally narrow
`tank-arena` subset; there is no layout code, rule lowering, code generation, `p1 build`,
or `p1 run` yet.

**recommended:** add a compact “implemented subset” matrix to the README and/or language
reference. Mark every broad syntax example as proposed until it has a parser, checker,
template applicability test, generated-ROM test, and capture/trace regression.

This keeps the language ambitious without suggesting functionality is already available.

## Tier 3 -- reference-image and genre review

The following visual shapes were observed in the local image set and agree with the
committed genre survey. They are requirements for eventual variety, not a request to
support all of them in v0.1.

| Shape | Image examples | Capability the DSL/catalog needs |
|---|---|---|
| Static reflected arena, two independent actors | Combat, Surround, Outlaw | Native player/missile allocation, collision, score band |
| Ball/paddle field | Video Olympics, Breakout, Kaboom! | Paddle profile, ball allocation, bat/paddle templates, dense falling-object kernel |
| Formation shooter | Space Invaders, Berserk, Demon Attack | Grid/formations, animation, copies/multiplexing, identity-aware software collision fallback |
| Scrolling asymmetric terrain | River Raid, Canyon Bomber | Per-line playfield streams, vertical scroll, sparse moving objects, bottom HUD/gauges |
| Room/platform scene | Pitfall!, Adventure | Rooms, transitions, persistent state, layered/static playfield and moving actor templates |
| Racing and competitive layout | Indy 500, Street Racer, Air-Sea Battle, Basketball | Lanes/tracks, two-player policy, independent actors, optional split-screen template |

**recommended:** state that Player1DSL is a catalog of explicitly constrained game shapes,
not a promise that generic `actor at (x, y)` will render arbitrary collections of sprites.
The compiler should report which shape/template was selected and which requested feature
forced a fallback.

The phase order is sound: do not implement these genres speculatively. First measure the
three scheduled diagnostic fixtures (`scroll-field`, `ball-and-paddles`, and
`sprite-formation`), then update catalog vocabulary and add one end-to-end example per
new template family.

## Tier 4 -- concrete wording and consistency fixes

1. **Target wording.** SPEC §1 currently says the compiler creates an “NTSC or PAL” ROM,
while §§3, 12, and 13 make v0.1 NTSC-only. Say “NTSC in v0.1; PAL/PAL60 are future target
profiles.”
2. **Audio units.** §4.1 exposes `hz`, while §4.5 calls the AUDF value “frequency.” TIA
audio uses a 5-bit divider with sparse, non-uniform reachable pitches. Either use a raw
divider unit or define an `hz` request as a deterministic quantization that reports the
actual result.
3. **Copy spacing.** The `spacing (22, 16)` swarm example should say that arbitrary
spacing is layout intent, not a guarantee of NUSIZ copies. Hardware copies are only at
16, 32, or 64 colour-clock separation; a different strategy may be required.
4. **Band boundary accounting.** Keep §4.4's warning, but make exact visible-line ledger
balance a hard build gate before scenes/bands ship. The observed five-line tank-arena
transition is evidence for one template, not a universal constant.
5. **Collision report.** When multiplexing changes a logical collision from hardware to
software, report the changed identity semantics, RAM use, non-visible cycle cost, and
whether the rule remains feasible.

## Implementation assessment

The existing foundation is promising:

- parser, formatter, diagnostics, phase-1 checker, IR, and RAM allocator;
- TypeScript assembler checked against DASM where installed;
- 6507/RIOT/TIA timing model with timer/WSYNC fixtures;
- deterministic controller injection, per-TIA-write traces, late-write detection, and
  committed golden traces.

The missing bridge is layout/template selection, 6502 rule lowering, ROM code generation,
and a pixel-accurate TIA renderer. Until those exist, “functional” means timing/trace
functional only -- not visually or gameplay verified.

## Verification note

`npm.cmd run typecheck` and `npm.cmd run lint` completed successfully during this review.
Vitest could not load its configuration in the restricted review environment because
esbuild was denied directory access; that is an environment limitation, not evidence of a
test failure.
