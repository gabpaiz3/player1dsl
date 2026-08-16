# Player1DSL

Player1DSL is a readable, text-first language and compiler for building original Atari 2600-style games. It will compile `.p1` source into NTSC ROMs playable in Stella and compatible emulators, while explaining the real hardware constraints behind each visual design.

The first milestone is `tank-arena`: a 4 KiB NTSC game with two tanks, projectiles, a mirrored playfield, and an efficient BCD score display.

## Why Player1DSL?

The Atari 2600 has two player graphics objects, two missiles, one ball, and a playfield—not a modern sprite engine or framebuffer. Player1DSL lets authors express logical actors and scenes, then chooses a valid TIA rendering strategy or reports why a design exceeds timing, object, RAM, or ROM limits.

That includes strategies such as player copies, multiplexing, specialized kernels, playfield conversion, and opt-in flicker. Build reports will show scanline resource use and actionable recommendations.

## Status

The project is in specification and scaffolding stage. See [the draft specification](docs/SPEC.md) for the language model, compiler architecture, examples, recovery workflow, and delivery phases.

## Planned workflow

```text
p1 new tank-arena --template tank-arena
p1 check --report
p1 build
p1 run
```

The `p1` CLI is not implemented yet.

## Scope of the first release

- TypeScript/Node.js compiler and CLI that generate 6502/TIA ROM code.
- 4 KiB NTSC target, initially.
- Text DSL as the canonical project format.
- Stella build/run/test integration.
- A low-resource BCD score kernel.
- `tank-arena` as the first executable example.
- An evidence-based ROM recovery workflow: a Codex skill first, then a matching CLI command.

A browser-based beginner editor follows once the textual compiler and examples are proven.

## Development

No build tooling has been installed yet. Before changing architecture or adding dependencies, review [docs/SPEC.md](docs/SPEC.md) and [AGENTS.md](AGENTS.md).

## License

License selection is pending. Do not add third-party ROMs, commercial game assets, or recovered source to this repository without explicit permission.
