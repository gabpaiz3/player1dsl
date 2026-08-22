# Foundation roadmap

Three steps from the current specification-and-scaffolding stage to a compiler that
provably reproduces a known-good ROM. Each step ends in working, testable software.

**Ordering principle:** the parser is deliberately *not* first. SPEC.md §6 lists Parse as
phase 1, so an implementer following the spec literally spends weeks on a lexer and still
does not know whether the band model in §4.4 is buildable. The dependency runs one way —
the parser's shape depends on what the kernels turn out to need; the kernels do not depend
on the parser at all. So the kernel comes first.

## Step 1 — Hand-write the tank-arena ROM in 6502 assembly

Before any compiler code. This produces the known-good artifact every later golden test
compares against, and it is where the 2600 assembly knowledge gets built — not incidental,
but the prerequisite for every cycle claim the compiler will later make.

Built in five increments, each independently a golden and each answering an open question
from [the spec review](spec-review-0.1.md):

| # | Increment | Answers |
|---|---|---|
| 1 | Stable 262-line frame, VBLANK/overscan bounded by TIM64T | review §3.2 — the RIOT timer gap |
| 2 | Mirrored playfield arena | what `mode reflect` and `resolution 2` actually mean |
| 3 | Two players positioned via RESPx/HMOVE | review §3.3 — real positioning cycle costs |
| 4 | **Score band above field, both players repositioned across the boundary** | **review §3.4 — the band transition cost** |
| 5 | Projectiles and collisions | review §3.6 — collision latch behaviour in practice |

Increment 4 is the payoff. SPEC.md §4.4's bands sum to exactly 192 with zero transition
budget; only a real kernel reveals whether that costs one scanline or three.

**Detailed plan:** [superpowers/plans/2026-08-16-tank-arena-kernel.md](superpowers/plans/2026-08-16-tank-arena-kernel.md)

## Step 2 — Assembler and emulator, validated against that ROM

Both are "own it" decisions from the review (§1.1, §1.2). Each gets a concrete acceptance
criterion tied to the step-1 artifact:

- **Assembler** (TypeScript): assembles the hand-written source to *the same bytes DASM
  produces*. DASM stays a **dev-only** cross-check — never a runtime or CI dependency, or
  the native-binary problem the internal assembler exists to avoid is reintroduced.
- **Emulator** (TypeScript, 6507 + TIA + RIOT): runs the ROM to exactly 262 lines with TIA
  writes landing on the scanlines the kernel intends. That is the instrument *working*, not
  merely running.

Together these make review §1.1 possible: once the kernel's cycle costs are known and the
emulator can measure them, the planner's claims become regression-testable. That is the
difference between honesty as a design goal and honesty as a verified property.

Monorepo plumbing (npm workspaces, vitest, tsc) is about an hour at the front of this step,
not a step of its own.

## Step 3 — The narrowest compiler that reproduces that exact ROM

Parser → IR → codegen, with the language surface limited to exactly what `tank-arena.p1`
needs. Done when `p1 build` emits a ROM trace-equivalent to the hand-written one — and the
golden already exists from step 1.

This closes the walking skeleton. Everything after is widening the language, not proving the
architecture.

**Design:** [superpowers/specs/2026-08-19-tank-arena-compiler-design.md](superpowers/specs/2026-08-19-tank-arena-compiler-design.md)

Step 3 runs as four plans, each producing working software on its own:

| Plan | Increments | Deliverable | State |
|---|---|---|---|
| [1](superpowers/plans/2026-08-19-golden-trace-harness.md) | 1a, 1b | Golden trace harness and comparator | **done** |
| [2](superpowers/plans/2026-08-20-parser-and-game-ir.md) | 2, 3 | Parser, AST, `p1 fmt`, checker, game IR, RAM allocator | **done** |
| [3](superpowers/plans/2026-08-21-layout-ir-and-template-catalog.md) | 4, 4b, 5, **5b** | Layout IR, line ledger, kernel-shape fixtures, template catalog, still-frame ROM | in progress: 4 and 4b done |
| 4 | 6, 7 | Rule lowering, `p1 build` end to end | to write |

Increment **5b** was added while plan 3 was being written, at the user's request: it makes
`p1 build --static` emit a real 4 KiB ROM at the end of plan 3, so the compiler's output can
be looked at in Stella rather than waiting for the end of plan 4. It also gives the line
ledger its first falsifiable check — a test asserting `ledger.fieldLines === 158` only
asserts that the compiler computes what the compiler computes, while a ROM built from that
ledger and run in the emulator can actually be wrong.

`docs/language-reference.md` is the next *document* but not the next *step*: writing the
grammar before one ROM exists encodes assumptions the ROM will overturn. Step 3 produces the
grammar for the tank-arena subset; the full reference follows it.

## Toolchain

Installed outside the repository at `C:\Users\gabpa\tools\` (dev-only, per the review):

| Tool | Version | Path | Role |
|---|---|---|---|
| DASM | v2.20.17 | `tools\dasm\dasm.exe` | assembles step 1; cross-check for our assembler in step 2 |
| Stella | 7.0c | `tools\stella\Stella-7.0c\Stella.exe` | plays step-1 ROMs; compatibility tier thereafter |

Neither is a runtime or CI dependency.

## Specification alignment

Steps 1 and 2 are folded into SPEC.md: §10 lists the directories they added, and the
measured findings (the band-transition cost, collision latch semantics, the real cost of
the score kernel) are recorded where they belong. The five review items step 3 depends on
— the goldens policy, the statically bounded rule language, vertical position as kernel
structure, the template catalog, and the stack reservation — landed before step 3's code.

Still outstanding from [the review](spec-review-0.1.md), to fold in as each feature forces
the answer: §3.3 positioning costs stated generally, §3.7 RNG, §3.8 `hz` for AUDF,
§3.9 `resolution 2` / `spacing` / error-code ranges, and the TypeScript integer-discipline
conventions.

**Design for step 3:** [superpowers/specs/2026-08-19-tank-arena-compiler-design.md](superpowers/specs/2026-08-19-tank-arena-compiler-design.md)
