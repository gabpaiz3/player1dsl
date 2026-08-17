# Running Player1DSL ROMs in Stella

Applies to any ROM this project builds. Today that is the hand-written
`tank-arena` reference kernel; later it will be compiler output.

All key mappings and options below were read from Stella 7.0c's own bundled
documentation at `C:\Users\gabpa\tools\stella\Stella-7.0c\docs\index.html`, not
recalled.

## Build and run

One command — builds, then launches:

```bash
sh examples/tank-arena/reference/run.sh
```

Or the two steps separately:

```bash
sh examples/tank-arena/reference/build.sh
"C:/Users/gabpa/tools/stella/Stella-7.0c/Stella.exe" build/tank-arena.bin
```

`run.sh` honours `P1_EMULATOR`, per SPEC.md §7, so no installation path is
assumed:

```bash
P1_EMULATOR="/c/path/to/Stella.exe" sh examples/tank-arena/reference/run.sh
```

`build.sh` honours `DASM` the same way. It fails loudly if the ROM is not
exactly 4096 bytes.

## What you should see right now

A white mirrored arena outline, a red tank at roughly x=40, a blue tank at
roughly x=110.

**Nothing moves.** Joystick reading is increment 5 of the
[kernel plan](superpowers/plans/2026-08-16-tank-arena-kernel.md) and is not
built — there is no input code in the ROM yet. That is expected, not a fault in
your setup or your controller.

## The measurement that matters

Press **Alt + L** to toggle the frame-stats overlay (scanline count, FPS,
bankswitch type).

Look for **262 scanlines, stable** — the number must not flicker between values
frame to frame. That single reading verifies increment 1's timer constants. Record
it in `examples/tank-arena/reference/NOTES.md`.

## Controls

Default key mappings for the two 2600 controller ports:

| 2600 function | Left controller (player 0) | Right controller (player 1) |
|---|---|---|
| Up | Up arrow, Keypad 8 | Y |
| Down | Down arrow, Keypad 2 | H |
| Left | Left arrow, Keypad 4 | G |
| Right | Right arrow, Keypad 6 | J |
| Fire | Left Control, Space, Keypad 5 | F |

Console switches (Reset, Select, and the difficulty and colour switches) are on
the F-keys; Stella's in-app help lists them.

## Touchscreen as a joystick

**Not natively.** Stella's documentation contains zero occurrences of "touch",
and the 2600 digital joystick is driven by keys or an SDL gamepad only.

The mouse path exists but does not help here. Stella's `-usemouse
<always|analog|never>` option is described in its docs as being for
"analog-type devices (paddles, trackball, etc.)". Touch input on Windows arrives
as synthesized mouse events, so it can reach that analog path — but a 4-way
digital joystick is not an analog device, and `tank-arena` is a joystick game.

Three things that do work, best first:

1. **Windows on-screen keyboard.** `osk.exe`, or the tablet touch keyboard from
   the taskbar. It sends real key events, so tapping its arrow keys and Space is
   indistinguishable from a physical keyboard as far as Stella is concerned.
   This is the direct answer to touch control, and it needs nothing installed.
2. **A gamepad.** Stella auto-detects SDL game controllers over USB or
   Bluetooth, and this is much the nicest way to play a two-player game like
   `tank-arena` — one pad per port.
3. **A touch-to-key mapping utility.** Third-party software that overlays
   on-screen buttons and emits keystrokes. Works, but it is another dependency
   for something the on-screen keyboard already covers.

Worth noting for later: if this project ever wants genuine touch control, the
right place is the browser-based editor in SPEC.md §12 phase 5, where a web
build can map touch directly to the emulated port — not Stella.

## Useful Stella options

| Option | Effect |
|---|---|
| `-fullscreen 0` | force windowed |
| `-debug` | start in the debugger |
| `-usemouse never` | stop the mouse being claimed as a controller |

Stella persists settings between runs, so anything changed in its UI sticks.

## If it looks wrong

- **Scanline count is not 262** → the `TIM64T` constants in `tank-arena.asm`.
  Adjust by one and re-measure; see `NOTES.md`.
- **Tanks are not near x=40 and x=110** → suspect the addressing mode in
  `PosObjectX` first. The canonical routine is sometimes written `sta.wx HMP0,x`
  (absolute,X, 5 cycles) where plain `sta HMP0,x` assembles to zero-page,X
  (4 cycles). One cycle is three colour clocks of beam travel.
- **A black bar down the left edge** → an HMOVE strobed on a visible line. It
  should only ever be strobed during VBLANK.
