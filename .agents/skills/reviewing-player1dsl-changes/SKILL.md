---
name: reviewing-player1dsl-changes
description: Use when reviewing a change, pull request, or draft in Player1DSL — especially edits to docs/SPEC.md, README.md, AGENTS.md, the .p1 language surface, kernel templates, or any claim about Atari 2600 cycle budgets, TIA registers, scanline timing, or RAM/ROM limits.
---

# Reviewing Player1DSL changes

## Overview

Player1DSL's entire value proposition is that the compiler is **honest about the machine** — that when a diagnostic says "51 cycles available, 66 required," the number is real. A review protects two kinds of honesty:

- **Internal** — the documents agree with each other and with the tooling config.
- **External** — every hardware claim agrees with the actual 2600.

Both fail silently. Nothing breaks when `docs/SPEC.md` promises F8 bankswitching that `AGENTS.md` forbids, or when a cycle count is off by four. That is why they need a human-judgment pass.

## Two lanes — don't mix them

| Lane | Examples | Enforced by |
|---|---|---|
| **Mechanical** | build artifacts staged, CRLF in text files, oversized goldens | `.githooks/pre-commit` — already automatic |
| **Judgment** | cross-document drift, unverified hardware claims, budget numbers with no test | **this skill** |

If a check is expressible as a regex or a file-size test, it belongs in the hook, not in a review comment. Reviewing what the hook already catches wastes the pass.

## What to check

**1. Hardware claims — verify, never recall.**
Any assertion about scanlines, cycles, TIA registers, NUSIZ copies, positioning, collision, audio ranges, or RAM/ROM limits gets checked against `hardware-invariants.md`. If the claim isn't listed there, verify it against a cited source and add it — do not wave it through because it sounds right. Plausible-but-wrong is this project's characteristic failure mode: the numbers are close enough that nobody notices.

**2. Cross-document commitments — check all four.**
The canonical set is `docs/SPEC.md`, `README.md`, `AGENTS.md`, and the tooling config (`.gitignore`, `.gitattributes`, workflows). A commitment about cartridge size, target region, controller support, phase ordering, or what may be committed to the repo appears in more than one. Changing it in one place is the default failure. §3 of SPEC.md is the platform *contract* — when it disagrees with the others, it is usually the one that's wrong, and always the one implementers follow.

**3. Budget numbers need a test behind them.**
A cycle count, a scanline allocation, or a RAM figure introduced without a test that measures it is a claim, not a fact. Ask where the measurement is. This is what keeps the honesty claim from rotting as code generation changes.

**4. Terminology stays singular.**
One hardware concept, one keyword. Two spellings for one thing (`mirror` / `reflect` for CTRLPF D0) means one of them is wrong.

**5. Logical actor ≠ physical TIA object.**
Per AGENTS.md, any change that lets a rendering fallback happen without appearing in a report — or that silently introduces flicker — is a defect regardless of how well it works.

## Common mistakes

| Mistake | Why it matters |
|---|---|
| Asserting a hardware fact from memory | The 2600's numbers are memorable and slightly wrong in most people's memory. Look it up. |
| Fixing a contradiction in one document | The contradiction moves; it doesn't resolve. Grep the other three. |
| Accepting a cycle number because the reasoning sounds right | Reasoning about 6502 timing is exactly where confident errors live. |
| Flagging mechanical issues | The hook has them. Spend the pass on judgment. |
| Treating a missing document as a defect | `docs/` declares several files that aren't written yet. Absence of a declared artifact is a to-do. |

## Reference

`hardware-invariants.md` — the checkable Atari 2600 facts (frame timing, object set, NUSIZ, positioning cost, collision, audio, color, memory), with the ones most often misremembered called out.
