# Step 3 — the narrowest compiler that reproduces tank-arena

**Status:** design, approved 2026-08-19
**Roadmap step:** 3 of 3 ([roadmap.md](../../roadmap.md))
**Acceptance:** `p1 build examples/tank-arena` emits a ROM whose TIA-write trace matches
the committed golden generated from `examples/tank-arena/reference/tank-arena.asm`.

## What this step is for

Steps 1 and 2 produced the artifact and the instrument: a hand-written 4 KiB NTSC ROM,
and an emulator that can measure what it does. Step 3 closes the walking skeleton by
producing that same ROM from readable source. Everything after step 3 widens the
language; nothing after it re-argues the architecture.

The compiler is deliberately narrow in what it *implements* and general in what it
*expresses*. Those are different axes, and conflating them is the main design risk here.
Player1DSL must eventually support paddle games, canyon-runners, brick-breakers and
shooters, so an IR shaped exclusively around two tanks would have to be thrown away. But
validating six genres is six times the work of validating one, and the roadmap's whole
argument is that one worked example beats six derived ones.

The resolution: **general interfaces, one validated instance.** The IR is a bounded
expression language, not a fixed list of tank-arena operations. The kernel catalog has
declared applicability conditions and costs, not a single hard-coded kernel. Step 3 ships
exactly one catalog entry and one example. The claim that a new genre costs a catalog
entry rather than compiler surgery is left *falsifiable and untested* — which is honest,
and is what step 4 tests.

## Decisions

| Decision | Rationale |
|---|---|
| The `.p1` states game-layer intent only | No scanline counts, no timer values, no write ordering, no register names. Anything the source states is a claim the compiler never has to earn, and the four tricks the reference kernel encodes are exactly what needs earning. |
| Raster kernels are templated; VBLANK/overscan logic is compiled | The raster tricks are hardware-shaped and measured; the rules are ordinary control flow. Synthesising raster code from a cycle model is the general solver [SPEC §6.1](../../SPEC.md) rejects on determinism grounds. |
| Equivalence is judged on the TIA-write trace | Byte-identity would forbid the compiler from ever choosing a different-but-correct instruction sequence, which defeats the catalog. See [SPEC §11.1](../../SPEC.md). |
| The colour clock is recorded but not asserted | Clock position is a function of instruction cycle counts. Asserting it would test transcription fidelity, not compilation. The deadline is what determines what appears on screen. |
| The golden harness is built **first**, before any compiler code | It is the acceptance criterion made runnable. Built last, "equivalent" gets defined during codegen debugging, which is when the definition is least trustworthy. |
| One catalog entry, general catalog interface | See above. The generality is real in the interfaces and untested in practice, and this document says so rather than implying coverage that does not exist. |

## The line ledger

This is the crux of the step, and the one place the design could have been circular.

[SPEC §4.4](../../SPEC.md) states that the band-transition cost is *not* a constant and
defers the cost model to step 3. But the acceptance criterion requires scanline-exact
trace equality, so the compiler must independently arrive at the reference kernel's
`FIELD_LINES = 158`. If deriving 158 required a general boundary cost model, step 3 would
be required to reproduce a number nobody knows how to compute.

It does not. **Measured from the reference ROM** (`Machine.runFrame({ trace: true })` on a
settled frame, region boundaries read from the actual writes rather than from the source
comments — three of which are stale and still claim a 176-line field):

| Row group | Kind | Frame lines | Count | Where the number comes from |
|---|---|---|---|---|
| HUD band | band | 40–51 | 12 | authored: `band hud height 12` |
| Band transition | transition | 52–56 | 5 | derived: `2n + 1` for `n = 2` repositioned objects |
| Top wall | run | 57–64 | 8 | authored: this game's playfield shape |
| Field setup | setup | 65 | 1 | derived: a region change after a loop exit has no horizontal blank |
| Field loop | loop | 66–223 | **158** | **solved: the remainder** |
| Bottom wall | run | 224–231 | 8 | authored: this game's playfield shape |
| **Visible total** | | | **192** | |

So `158 = 192 − 12 − 5 − 8 − 1 − 8`.

**The generalisation, stated because the table above invites the wrong reading.** The two
wall rows are not structural. A band is a sequence of **row groups**, each a
`(kernel, line count)` pair, and the ledger is nothing more than *the row groups sum to the
band's height*. `[wall][field][wall]` is what an arena game happens to decompose into;
most genres do not have it. A paddle game's field is one loop with no runs at all; a
scrolling canyon has no static run anywhere, because its playfield changes every line and
so the whole band is a loop with a much smaller per-line budget. Nothing in the ledger
assumes a border — it assumes only that every visible line belongs to exactly one row
group with a known cost.

The kinds in the table (`band`, `transition`, `run`, `setup`, `loop`) are the vocabulary;
which ones appear, and how many, comes from the scene. Only `transition` and `setup` are
compiler-derived. The rest come from the selected templates.

The compiler needs two cost rules, both already measured in step 1 and both belonging to
the *template*, not to the compiler:

1. A band transition repositioning *n* objects costs `2n + 1` visible scanlines — two per
   object for `RESPx`, plus one to absorb the `HMOVE` comb on a line whose background can
   hide it.
2. A region change immediately following a loop exit costs one line, because a loop falls
   through mid-line and leaves no horizontal blank for the region's register writes.

The source states none of this. It states a HUD height and an arena shape, which is
intent a person genuinely holds.

**The ledger is a hard gate.** If it does not sum to exactly 192, the build fails with a
diagnostic naming the shortfall. A compiler that silently emits 191 or 193 produces the
defect class step 2 found in the reference kernel itself — two errors that cancelled in
the frame total and survived five rounds of visual verification.

## Architecture

```
examples/tank-arena/tank-arena.p1
        ↓  packages/parser        lexer → AST                 (no hardware knowledge)
        ↓  packages/compiler      AST → game IR               (checker, RAM allocator)
        ↓                         game IR → layout IR         (bands, actors → TIA objects)
        ↓                         layout IR → line ledger     ← must balance or the build fails
        ↓  packages/runtime       template catalog → asm fragments
        ↓  packages/compiler      rule lowering → 6502 instruction selection
        ↓  packages/assembler     (exists) → 4096 bytes
        ↓  packages/cli           p1 build / p1 check
```

The split that carries the weight: **`runtime` owns anything whose cost was measured;
`compiler` owns anything derived.** A template carries its own line costs as data, so the
ledger *reads* costs rather than knowing them. A wrong template cost then fails the ledger
loudly at compile time instead of producing a subtly short frame.

### packages/parser

Lexer and recursive-descent parser over the indentation-delimited surface in
[SPEC §4.1](../../SPEC.md). Produces an AST with source spans on every node, because every
diagnostic downstream has to point back at a construct. No hardware knowledge whatsoever —
the parser must not know what a scanline is.

Also hosts the formatter (`p1 fmt`), which is the cheapest possible parser test: format
must round-trip.

### packages/compiler — game IR

Pure semantics: declarations, a RAM allocation, and rules as statement trees. No
scanlines, no registers.

The statement and expression language is **general and bounded**, per
[SPEC §4.3](../../SPEC.md): bounded byte/`int8`/`bool` types, arithmetic and comparison,
`if`/`else`, assignment, and fixed-trip-count iteration. No unbounded loops, no recursion,
no indirect calls — every construct has a statically computable cycle bound.

Genre-specific vocabulary enters as **intrinsics over that language**, not as new IR
node kinds: `joystick(port, direction)`, `hits(a, b)`, `random(lo, hi)`, `move(...)`.
Tank-arena exercises the first two and `move`. A paddle game adds a paddle intrinsic
without reopening the IR — that is the extension point, and it is deliberately not the
statement grammar.

The RAM allocator reserves a documented stack allowance below `$FF`
([SPEC §6.2](../../SPEC.md)) and allocates variables beneath it.

### packages/compiler — layout IR

The game IR projected onto hardware: actors bound to TIA objects, bands ordered, and the
line ledger computed. This is where [SPEC §5.1](../../SPEC.md)'s asymmetry becomes
concrete — an actor's `x` becomes `RESPx`/`HMPx` state, while its `y` becomes a constraint
on the selected kernel's per-line comparison, because there is no vertical position
register.

### packages/runtime — the template catalog

Each entry declares, as data ([SPEC §6.1](../../SPEC.md)):

- **applicability conditions** — movable object count, whether the playfield is static
  within the band, maximum sprite height, supported strategies;
- **costs** — cycles per line, and scanlines charged at band entry and exit;
- **the register writes it emits, each with its deadline**, so the schedule is checkable.

Step 3 ships three entries, all required by tank-arena's three bands: `two-sprite-static-field`
(the field loop), `bcd-score-band` (the HUD glyph loop, with the digit font as template
data), and `solid-run` (the wall runs). "One catalog entry" elsewhere in this document
means one *genre-defining* field kernel; the other two are band kernels the same example
needs. No fourth entry is added speculatively.

The selector matches band declarations against conditions in a fixed documented order and
reports its choice with costs. No match produces a diagnostic naming what would have to
change, in the shape of [SPEC §5.2](../../SPEC.md)'s `E230` example.

### packages/compiler — rule lowering

Game IR statements → 6502. Real instruction selection, not templates.

A property worth recording, because it decides how much the golden can see: the
VBLANK/overscan logic writes almost nothing to the TIA directly. But the trace observes it
sharply *through* the hardware — `HMP0` plus `RESP0`'s clock encodes `tank0X` exactly; the
158 `GRP0` values across the field loop encode `tank0Y` and the sprite bitmap; the HUD
glyph bytes encode the score. So a movement bug, an off-by-one clamp, or a broken hit
debounce all surface as trace divergence, **provided the input script drives those paths**.

Below that, instruction selection is genuinely free. The reference clamps with
`ldx var / cpx #bound`; codegen picking `lda var / cmp #bound` produces an identical trace,
because neither touches the TIA. That freedom is the point of the deadline-class
comparison.

## The golden harness

Built first. Four pieces:

**Input injection.** `Machine.runFrame({ swcha, swchb })`. The fields already exist on
`Riot`; there is no per-frame API yet.

**A committed input script**, `tests/goldens/tank-arena.input.json`. Chosen to drive the
rules, not to idle: frames pushing each tank into all four bounds so clamping fires, then
frames driving them into contact so `CXPPMM` sets, held across several frames so the
`hitFlag` debounce must fire exactly once. An idle script produces a green golden that
proves almost nothing.

The score's 9→0 wrap needs seven separate contacts, which is too many frames to justify in
the main golden; it gets its own focused test.

**The golden trace**, `tests/goldens/tank-arena.trace`, generated from the **reference
ROM** — so it is a golden of the hand-written artifact, not of the compiler's own output.
Text, one record per write, with runs of identical `(register, value)` across consecutive
scanlines collapsed; the field loop writes `GRP0=$00` for most of 158 lines, so this is the
difference between roughly 600 KB and roughly 50 KB. `WSYNC` is excluded — scanline
structure already captures it.

**The comparator.** `(register, value, line)` exact; clock asserted only against
`deadline(register)`, reusing the existing `findLateWrites` deadline table rather than
inventing a second one. `GRP0`/`GRP1` keep their conservative pixel-0 bound and its two
known-benign false positives until object position tracking exists.

## Increments

Each ends in something independently testable, following step 1's discipline.

| # | Increment | Done when |
|---|---|---|
| 1a | Input injection + trace format + golden | `runFrame({ swcha })` drives a committed input script; golden generated from the reference ROM and committed; `.gitignore` no longer swallows it |
| 1b | Comparator + **two** known-positives | Both positives below fail the comparator, and the unmutated ROM passes |
| 2 | Lexer, parser, AST, `p1 fmt` | `p1 fmt` round-trips `tank-arena.p1` |
| 3 | Checker, game IR, RAM allocator | RAM map computed with the stack reserved; types and bounds checked; over-budget RAM is a compile error |
| 4 | Layout IR + line ledger | `p1 check` prints the ledger and **fails** if it does not sum to 192 |
| 4b | Kernel-shape fixtures | Three diagnostic kernels measured; the applicability vocabulary revised against what they need (see below) |
| 5 | Template catalog + selector | Selector matches declarations against declared conditions; a deliberately unsatisfiable band produces a diagnostic |
| 6 | Rule lowering + instruction selection | VBLANK/overscan code generated from rules |
| 7 | `p1 build` end to end | 4096 bytes; golden trace matches |

Increment 4 is where the design holds or does not: the ledger is derived arithmetic that
must independently land on 158.

### Why increment 4b exists

The catalog's applicability vocabulary is to step 3 what the band model was to step 1. If
it is derived from one kernel and validated at step 4, that repeats precisely the mistake
the roadmap's ordering argument exists to avoid — committing to an interface before the
thing it must describe has been measured.

Unlike a cycle cost, a vocabulary cannot be checked with a fixture that isolates it. It is
tested by trying to express something it was not designed for. So increment 4b writes three
diagnostic kernels — each a fixture in the `tests/fixtures/` tradition, not a game — and
asks whether the vocabulary can state what each one needs:

| Fixture | Shape it isolates | Question it answers |
|---|---|---|
| `scroll-field` | playfield rewritten every line | Is "static playfield within the band" the right axis, or should it be "PF writes per line"? |
| `ball-and-paddles` | two players + ball, no runs, no border | Does a band with zero `run` row groups work, and what does the ball object cost? |
| `sprite-formation` | one player object multiplexed across a row | Does the vocabulary express multiplex separation and per-line reload budget at all? |

These are diagnostics: the step-2 timing fixtures are 40–90 lines each and this is the same
scale. They produce measured numbers we own outright, and they run through our own
assembler and emulator, which incidentally stresses the assembler against opcodes the four
existing ROMs never exercise — a known open item from step 2.

**On third-party sources.** Complete commercial games are not usable here. Disassemblies of
Combat, Adventure, Pitfall and River Raid circulate widely and are typically unlicensed
derivative works of copyrighted code; AGENTS.md already forbids adding third-party ROMs or
recovered commercial assets. The specific hazard for this project is that kernel structure
copied from such a source would land in `packages/runtime`, which ships inside every
generated ROM. Properly-licensed homebrew remains an option later, with each licence
verified individually — but for the vocabulary question a fixture is the better instrument
regardless, because it isolates one shape instead of bundling a whole game's decisions.

### Why increment 1b needs two known-positives, not one

For the same reason step 2 proved `findLateWrites` against `late-write.asm` before
trusting a clean result: "the golden matches" also passes with a comparator that never
fires. But one mutation is not enough here, because the comparator has two independent
halves and the obvious mutation only exercises the easy one.

1. **Trace divergence.** Change a sprite byte or a starting position. This trips the
   `(register, value, line)` equality — which is just equality, and the half least likely
   to be wrong.
2. **Deadline-only.** A mutation that holds `(register, value, line)` *constant* and moves
   a write later within its scanline, from horizontal blank into the visible region. Delay
   cycles inserted before a wall-setup `PF0` write do exactly this: same line, same value,
   pixel slides from `-1` to positive.

Without the second, every mutation trips the equality fields first and the deadline check
is never observed to fail — so the one genuinely novel part of the comparator ships
unverified. `findLateWrites` already computes the deadline; 1b verifies that the
comparator actually consults it.

## What this step does not do

- **No second genre.** The catalog interface is general; only one entry exists.
- **No object position tracking.** `GRP` deadlines keep the conservative bound from step 2.
- **No missiles.** The field kernel has 5 free cycles per line and a missile needs ~24;
  that is a two-line kernel, i.e. a new catalog entry, not more compiler code.
- **No multi-digit score.** One digit per player, as the reference ROM has, for the reason
  [SPEC §7.1](../../SPEC.md) records: `NUSIZ` copies share graphics.
- **No `docs/language-reference.md`.** Step 3 produces the grammar for the tank-arena
  subset; the full reference follows it, per the roadmap.

## Open questions carried into implementation

- The exact `.p1` surface for the arena playfield shape. The wall thickness must be
  readable from the declaration, since the ledger consumes it, but whether that is a
  pixel-art block, a named shape, or `border thickness 8` is not yet settled. Increment 2
  decides it against what actually parses cleanly. Whatever it becomes, it must be a
  property of *this game's playfield*, not a first-class band concept — see the row-group
  note above.
- **What the applicability vocabulary becomes.** "Movable object count, static playfield
  within the band, maximum sprite height, supported strategies" is derived from exactly one
  kernel, and it is the interface every future genre must fit through. Increment 4b exists
  to revise it against three measured shapes before increment 5 commits to it, so this is
  an open question with a scheduled answer rather than a deferred risk. What 4b cannot do
  is prove the vocabulary complete — only that it survives three shapes it was not designed
  for.
- Whether the field-setup line (ledger row 4) is best modelled as a template entry cost or
  as a general "region change after loop exit" rule in the layout IR. It is one line either
  way for tank-arena; the second catalog entry will discriminate.
- **Initial-state syntax.** The reference starts `score0 = 3`, `score1 = 5`, tanks at
  `(40, 120)` and `(110, 60)`. All four must be expressible or frame 0 of the trace
  diverges immediately. Actor positions have an obvious home (`at (40, 120)`, already in
  [SPEC §4.2](../../SPEC.md)); a non-zero starting score does not, and `score p0 start 3`
  is a guess until increment 2 parses it.
- **Frame count for the golden.** Unspecified here on purpose, but it must be a number
  before increment 1a, not during it: the tanks are 70px apart horizontally and 60
  vertically at 1px/frame, so directed contact needs roughly 60+ frames, and the count
  decides whether run-length collapsing is necessary or merely tidy. The implementation
  plan fixes it.
