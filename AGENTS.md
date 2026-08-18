# Contributor guidance

## Product boundaries

- Player1DSL compiles readable `.p1` game projects into real Atari 2600 ROMs; it is not a modern graphics engine that merely imitates the console.
- The initial target is 4 KiB NTSC. Do not add PAL/PAL60, bankswitching, or controller profiles outside the approved milestone without updating the specification and tests.
- Text DSL is canonical. The browser editor must consume and produce the same project format rather than define a second representation.
- Preserve the distinction between a logical actor and a physical TIA object. Any rendering fallback must be explicit in reports and never silently introduce flicker.

## Source of truth

- Read `docs/SPEC.md` before architecture, language, compiler, renderer, or recovery-workflow changes.
- Keep `README.md` concise and user-oriented. Put technical design details in `docs/`.
- When a decision changes, update the specification in the same change.

## Engineering expectations

- Use TypeScript/Node.js for host tooling. Generated game code must remain assembler/ROM code compatible with the selected Atari 2600 target.
- Make compilation deterministic: the same source and tool version must produce equivalent ROM, report, and diagnostic output.
- Treat cycle budgets, scanline schedules, RAM, ROM size, and mapper constraints as compile-time validation—not best-effort runtime behavior.
- Add a focused test for every compiler bug and use deterministic emulator screenshots or TIA-write traces for rendering regressions.
- Do not commit generated ROMs, coverage output, dependency directories, secrets, or local emulator configuration.

## ROM analysis and LLM assistance

- Recovery output is a proposal, not authoritative source. Preserve raw evidence and label conclusions as `observed`, `inferred`, or `unknown`.
- Do not claim semantic certainty from a trace alone. Link pattern matches to their evidence.
- Only analyze ROMs, source, artwork, and recordings that the user is entitled to provide or use. Never add third-party ROMs or recovered commercial assets to the repository.

## Session logs

- Keep one log per working day at `docs/session-logs/YYYY-MM-DD.md`. Start a new file
  for each new date rather than appending to yesterday's.
- Record decisions and their rationale, findings that change the specification, and
  the state left at the end. Do not restate what the diff already shows.
- Where a measurement contradicted a derivation, record both. That contrast is the
  evidence base for treating cycle costs as measured rather than assumed.

## Before completing a change

- Run the smallest relevant formatter, typecheck, unit tests, and emulator/integration checks that exist.
- Report any test not run and why.
- Keep unrelated worktree changes intact.
