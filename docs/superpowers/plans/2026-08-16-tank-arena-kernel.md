# tank-arena Reference Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand-write a working 4 KiB NTSC `tank-arena` ROM in 6502 assembly, to serve as the known-good artifact every later compiler golden compares against.

**Architecture:** A single-file DASM kernel built in five verifiable increments. Each increment produces a bootable ROM, is checked in Stella, and records the measured hardware cost that the specification currently only asserts. No compiler code is written in this plan.

**Tech Stack:** 6502 assembly, DASM v2.20.17, Stella 7.0c. No Node.js.

**Spec:** [docs/SPEC.md](../../SPEC.md); open questions from [docs/spec-review-0.1.md](../../spec-review-0.1.md); ordering rationale in [docs/roadmap.md](../../roadmap.md)

## Global Constraints

- Target: **NTSC, 262 scanlines** — 3 VSYNC + 37 VBLANK + 192 visible + 30 overscan (SPEC §3).
- Cartridge: **4 KiB unbanked**, origin `$F000`, reset/interrupt vectors in the top 6 bytes.
- RAM: **128 bytes** at `$80–$FF`, shared with the stack growing down from `$FF`. Variables start at `$80`; keep at least 16 bytes of stack headroom.
- Movable objects available: **2 players, 2 missiles, 1 ball**. Nothing else.
- Colour values must have **bit 0 clear** (D0 unused; odd values alias to the even value below).
- No third-party assembly, ROMs, or `vcs.h` copied into the repo — hardware equates are written from the register map in `.agents/skills/reviewing-player1dsl-changes/hardware-invariants.md`.
- Generated `.bin` output is gitignored and blocked by the pre-commit hook outside `tests/goldens/`.

**Toolchain paths** (installed outside the repo):
- DASM: `C:\Users\gabpa\tools\dasm\dasm.exe`
- Stella: `C:\Users\gabpa\tools\stella\Stella-7.0c\Stella.exe`

---

## File Structure

| File | Responsibility |
|---|---|
| `kernels/include/vcs.h` | TIA write/read and RIOT register equates. Shared; the only place addresses are named. |
| `examples/tank-arena/reference/tank-arena.asm` | The hand-written kernel. Grows across increments; stays one file. |
| `examples/tank-arena/reference/build.sh` | Assembles to `build/tank-arena.bin`, emits `.lst` and `.sym`. Honours `P1_EMULATOR` (SPEC §7). |
| `examples/tank-arena/reference/NOTES.md` | Measured costs per increment — the answers to the review's open questions. |

`vcs.h` is separate from the kernel because step 2's TypeScript emulator and assembler need the same register map; it is the one file with two future consumers.

---

### Task 1: Hardware equates and build script

**Files:**
- Create: `kernels/include/vcs.h`
- Create: `examples/tank-arena/reference/build.sh`
- Create: `examples/tank-arena/reference/tank-arena.asm` (minimal boot stub)

**Interfaces:**
- Produces: symbolic names `VSYNC VBLANK WSYNC NUSIZ0 NUSIZ1 COLUP0 COLUP1 COLUPF COLUBK CTRLPF REFP0 REFP1 PF0 PF1 PF2 RESP0 RESP1 RESM0 RESM1 RESBL AUDC0 AUDC1 AUDF0 AUDF1 AUDV0 AUDV1 GRP0 GRP1 ENAM0 ENAM1 ENABL HMP0 HMP1 HMM0 HMM1 HMBL VDELP0 VDELP1 VDELBL RESMP0 RESMP1 HMOVE HMCLR CXCLR` (write), `CXM0P CXM1P CXP0FB CXP1FB CXM0FB CXM1FB CXBLPF CXPPMM INPT0..INPT5` (read), `SWCHA SWACNT SWCHB SWBCNT INTIM TIMINT TIM1T TIM8T TIM64T T1024T` (RIOT).
- Produces: `build.sh` writing `build/tank-arena.bin`, `build/tank-arena.lst`, `build/tank-arena.sym`.

- [ ] **Step 1: Write `kernels/include/vcs.h`** — equates only, no code, values from `hardware-invariants.md`.

- [ ] **Step 2: Write the boot stub** that clears RAM/TIA and halts in an infinite loop, with vectors at `$FFFC`.

- [ ] **Step 3: Write `build.sh`**

```sh
#!/bin/sh
set -eu
DASM="${DASM:-C:/Users/gabpa/tools/dasm/dasm.exe}"
root=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$root/build"
"$DASM" "$root/examples/tank-arena/reference/tank-arena.asm" \
  -I"$root/kernels/include" \
  -f3 -v0 \
  -o"$root/build/tank-arena.bin" \
  -l"$root/build/tank-arena.lst" \
  -s"$root/build/tank-arena.sym"
size=$(wc -c < "$root/build/tank-arena.bin")
[ "$size" -eq 4096 ] || { echo "FAIL: ROM is $size bytes, expected 4096" >&2; exit 1; }
echo "OK: build/tank-arena.bin ($size bytes)"
```

- [ ] **Step 4: Run it — expect a 4096-byte ROM**

Run: `sh examples/tank-arena/reference/build.sh`
Expected: `OK: build/tank-arena.bin (4096 bytes)`

- [ ] **Step 5: Commit** — `git add kernels/ examples/ && git commit -m "Add TIA/RIOT equates and reference kernel build"`

---

### Task 2: Increment 1 — stable 262-line frame

Answers review §3.2: the RIOT timer is the mechanism that makes "this work fits in non-visible time" enforceable, and SPEC.md never connects the two.

**Files:**
- Modify: `examples/tank-arena/reference/tank-arena.asm`
- Create: `examples/tank-arena/reference/NOTES.md`

**Interfaces:**
- Produces: labels `Reset`, `MainLoop`; the four-phase frame structure every later increment hangs work off.

- [ ] **Step 1: Replace the boot stub's halt loop with the frame skeleton**

```asm
MainLoop
    ; ---- VSYNC: 3 lines ----
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; ---- VBLANK: 37 lines (37*76 = 2812 cyc; 43*64 = 2752, WSYNC absorbs remainder)
    lda #43
    sta TIM64T
    ; game logic goes here in later increments
.waitVBlank
    lda INTIM
    bne .waitVBlank
    sta WSYNC
    sta VBLANK              ; A == 0 here: blanking off

    ; ---- VISIBLE: 192 lines ----
    ldx #192
.visibleLine
    sta WSYNC
    dex
    bne .visibleLine

    ; ---- OVERSCAN: 30 lines (30*76 = 2280 cyc; 35*64 = 2240)
    lda #2
    sta VBLANK              ; blanking on
    lda #35
    sta TIM64T
.waitOverscan
    lda INTIM
    bne .waitOverscan
    sta WSYNC

    jmp MainLoop
```

- [ ] **Step 2: Build** — `sh examples/tank-arena/reference/build.sh`, expect 4096 bytes.

- [ ] **Step 3: Verify the scanline count in Stella — this is the real test**

Run: `"C:/Users/gabpa/tools/stella/Stella-7.0c/Stella.exe" build/tank-arena.bin`
In Stella, press **Alt+L** to toggle the frame-stats overlay.
Expected: **262 scanlines, stable** — the number must not fluctuate frame to frame.

If it reads 261 or 263, adjust the `#43` / `#35` timer constants by one and rebuild. The arithmetic above is derived, not measured; this step is what makes it true. Record the final values in `NOTES.md`.

- [ ] **Step 4: Record the measurement** in `NOTES.md` — final timer constants, measured scanline count, and cycles left over in VBLANK and overscan (from the `.lst` file) as the budget later increments draw against.

- [ ] **Step 5: Commit** — `git commit -m "tank-arena: stable 262-line NTSC frame"`

---

### Task 3: Increment 2 — mirrored playfield arena

Answers what `mode reflect` and `resolution 2` in SPEC §4.4 actually mean, and settles the `mirror`/`reflect` terminology contradiction (review §2.3) with a hardware fact: there is one bit, CTRLPF D0.

**Files:**
- Modify: `examples/tank-arena/reference/tank-arena.asm`
- Modify: `examples/tank-arena/reference/NOTES.md`

**Interfaces:**
- Consumes: the frame skeleton from Task 2.
- Produces: `ArenaPF0`/`ArenaPF1`/`ArenaPF2` data tables indexed by a scanline counter.

- [ ] **Step 1: Set playfield colour and reflect mode** during VBLANK: `lda #$0E / sta COLUPF`, `lda #$01 / sta CTRLPF` (D0 = REF, so the right half mirrors the left).

- [ ] **Step 2: Replace the visible loop** with one that drives PF0/PF1/PF2 from tables — a solid border on the top and bottom rows and along the left edge, open in the middle.

- [ ] **Step 3: Build and view in Stella.** Expected: a symmetric arena outline; the right half is the mirror image of the left, not a repeat. Confirm scanline count is still 262.

- [ ] **Step 4: Record in `NOTES.md`** — cycles consumed per visible line by the playfield writes, and how much of the 76-cycle line budget remains. This is the number increment 3 has to fit players into.

- [ ] **Step 5: Commit** — `git commit -m "tank-arena: mirrored playfield arena"`

---

### Task 4: Increment 3 — two players positioned via RESPx/HMOVE

Answers review §3.3 — SPEC.md never mentions RESPx, HMOVE, the ±8 fine adjust, or the HMOVE blank bar, and these are where kernel cycles actually go.

**Files:**
- Modify: `examples/tank-arena/reference/tank-arena.asm`
- Modify: `examples/tank-arena/reference/NOTES.md`

**Interfaces:**
- Consumes: arena playfield from Task 3.
- Produces: `PosObjectX` subroutine (A = target x pixel, X = object index 0–4); RAM `tank0X tank0Y tank1X tank1Y` at `$80–$83`; `TankSprite` 8×8 data.

- [ ] **Step 1: Write the horizontal positioning subroutine.** Coarse position via a 5-cycle divide-by-15 loop, then fine adjust via `HMPx`, then strobe `HMOVE` during horizontal blank. Note in a comment that the *hardware* granularity is 3 colour clocks (one CPU cycle) — the 15 comes from the loop body, not the machine.

- [ ] **Step 2: Draw both tanks** in the visible kernel by comparing the scanline counter against `tank0Y`/`tank1Y` and writing `GRP0`/`GRP1` from the sprite table.

- [ ] **Step 3: Build and view.** Expected: two 8-pixel-wide tanks at distinct horizontal positions inside the arena, no vertical tearing.

- [ ] **Step 4: Record in `NOTES.md`** — cycles per `PosObjectX` call, whether the HMOVE blank bar is visible on the left 8 pixels, and the remaining per-line budget. **These are the first real numbers for the spec's cycle claims.**

- [ ] **Step 5: Commit** — `git commit -m "tank-arena: two players positioned via RESPx/HMOVE"`

---

### Task 5: Increment 4 — score band above the field

**The payoff task.** Answers review §3.4: SPEC §4.4's bands sum to exactly 192 with zero budget for transitions, but the score band uses both players for digits and the field uses both players for tanks — so the boundary requires repositioning both objects. Only a real kernel reveals the cost.

**Files:**
- Modify: `examples/tank-arena/reference/tank-arena.asm`
- Modify: `examples/tank-arena/reference/NOTES.md`

**Interfaces:**
- Consumes: `PosObjectX` from Task 4.
- Produces: RAM `score0 score1` (BCD, `$84–$85`); `DigitGfx` table, 8 rows per digit × 10 digits.

- [ ] **Step 1: Split the visible kernel into three bands** — HUD (12 lines), field (168), footer (12) — matching SPEC §4.4, and count the actual lines each consumes.

- [ ] **Step 2: Render two BCD digits per side** in the HUD band using `GRP0`/`GRP1`, with `NUSIZ` set for three close copies so one player object covers three digit columns.

- [ ] **Step 3: Reposition both players at the band boundary** for the tanks' gameplay x-positions, and **count the scanlines this costs.**

- [ ] **Step 4: Build and view.** Expected: score digits above a clean arena, tanks unaffected, still 262 scanlines total.

- [ ] **Step 5: Record the answer in `NOTES.md`** — how many scanlines the HUD-to-field transition costs, and whether 12 + 168 + 12 = 192 is achievable as written or whether the bands must be shortened to pay for the transition. **This is the finding that feeds back into SPEC §4.4.**

- [ ] **Step 6: Commit** — `git commit -m "tank-arena: BCD score band with cross-band player reuse"`

---

### Task 6: Increment 5 — projectiles and collisions

Answers review §3.6 — collision latches are per TIA object pair, not per logical actor.

**Files:**
- Modify: `examples/tank-arena/reference/tank-arena.asm`
- Modify: `examples/tank-arena/reference/NOTES.md`

**Interfaces:**
- Consumes: everything above.
- Produces: RAM `shot0X shot0Y shot1X shot1Y` (`$86–$89`); joystick read from `SWCHA`, fire from `INPT4`/`INPT5`.

- [ ] **Step 1: Read joystick 0 and 1** from `SWCHA` during VBLANK and move `tank0X`/`tank1X`, clamped to the arena walls.

- [ ] **Step 2: Fire missiles** on `INPT4`/`INPT5`, enabling `ENAM0`/`ENAM1` and advancing the shot each frame.

- [ ] **Step 3: Read collisions** after the visible region — `CXPPMM` for tank-to-tank, `CXM1P`/`CXM0P` for missile-to-player — increment the BCD score, then strobe `CXCLR` during vertical blank.

- [ ] **Step 4: Build and play.** Expected: both tanks move under joystick control, missiles fire and travel, a hit increments the score.

- [ ] **Step 5: Record in `NOTES.md`** which collision pairs were usable directly and which needed a software check, as the evidence base for SPEC §4.3's claim about mapping `when A hits B` to latches.

- [ ] **Step 6: Commit** — `git commit -m "tank-arena: joystick control, missiles, and collisions"`

---

## Definition of done

- `sh examples/tank-arena/reference/build.sh` produces a 4096-byte ROM.
- Stella shows a stable 262 scanlines with both tanks playable via joystick.
- `NOTES.md` records measured answers to review items §3.2, §3.3, §3.4, and §3.6.
- The ROM and its `.lst` are the golden inputs step 2's assembler and emulator are validated against.
