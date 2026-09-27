; ---------------------------------------------------------------------------
; Diagnostic ROM -- where does a RESM0 strobe actually put M0?
;
; QUESTION: `Objects.MISSILE_STROBE_DELAY` is 7 and labelled UNMEASURED. It was
; set by shifting the player's delay -- which WAS measured, at 8 -- on the
; assumption that the two objects share a mechanism and differ by one. Nothing
; has tested that. Every phase-2 game needs a missile or a ball, and a golden
; recorded from our own emulator would bake this constant into the reference the
; compiler is then held to, so it has to be settled before a second game exists
; rather than after.
;
; THIS IS collide-playfield.asm WITH M0 IN PLACE OF P0. Same block, same sweep,
; same verdict, same positioning routine, object index 2 rather than 0. That is
; deliberate: the player number is the only thing worth comparing against, so
; nothing else may differ. A missile is one pixel wide with NUSIZ0 = 0, which
; makes it the natural counterpart to the player's GRP0 = $80 -- a single lit
; column whose collision reports its exact landing pixel.
;
; SETUP: PF0 D4 alone lights screen pixels 0 to 3. M0 is enabled by ENAM0 D1
; and is one pixel wide. CXM0FB D7 is the M0/playfield pair -- confirmed against
; `packages/runtime/src/collisions.ts`, which reaches the same table
; independently -- and is read in overscan, painting the background red on
; contact and black otherwise.
;
; PREDICTION, written before the run. The two hypotheses disagree, which is the
; point of sweeping at all:
;
;   delay 8, as the player measured  ->  M0 lands at x + 3, flip at 1
;   delay 7, as the model carries    ->  M0 lands at x + 2, flip at 2
;
; A flip at 1 says the missile shares the player's mechanism exactly and
; MISSILE_STROBE_DELAY should be 8. A flip at 2 confirms the 7 the model
; already assumes. Any other flip f says the landing pixel is x + (4 - f).
;
; The answer is a whole-screen colour. Measuring a sprite's left edge off a
; screenshot is a measurement whose error bars come from window management --
; see the retraction in docs/kernel-measurements.md for what that costs.
;
; SWEEP: M0_X is patched by packages/emulator/test/tia-fixtures.test.ts, which
; edits this source and reassembles rather than poking an offset into the image.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

M0_X        = 0
RED         = $44
BLACK       = $00

    seg code
    org $F000

Reset
    sei
    cld
    ldx #$FF
    txs
    lda #0
.clear
    sta $00,x
    dex
    bne .clear
    sta $00

    lda #$0E                ; missile and playfield both white
    sta COLUP0              ; M0 takes P0's colour
    sta COLUPF
    lda #BLACK
    sta COLUBK
    lda #0
    sta CTRLPF              ; no REF: the right half repeats, which is off-screen
                            ; of anything this fixture asks about
    sta NUSIZ0              ; missile width 1: a single lit column

MainLoop
    ; --- VSYNC: 3 WSYNCs ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 WSYNCs, two of them spent positioning ---
    lda #2
    sta VBLANK

    ldx #2                  ; object index 2: RESM0 and HMM0
    lda #M0_X
    jsr PosObjectX

    ldx #35                 ; 37 less the 2 the single call spent
.blank
    sta WSYNC
    dex
    bne .blank

    lda #0
    sta VBLANK

    ; --- VISIBLE: 192 WSYNCs ---
    lda #$10
    sta PF0
    lda #$02
    sta ENAM0               ; D1 enables the missile
    ldx #192
.visible
    sta WSYNC
    dex
    bne .visible

    lda #0
    sta ENAM0
    sta PF0

    ; --- OVERSCAN: 30 WSYNCs, and the answer ---
    lda #2
    sta VBLANK

    lda #BLACK
    bit CXM0FB              ; D7 is the M0/playfield pair
    bpl .noContact
    lda #RED
.noContact
    sta COLUBK
    sta CXCLR

    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

; ---------------------------------------------------------------------------
; Byte for byte the routine the compiler emits. Copied rather than shared
; because a fixture that drifted from the compiler would answer a question
; about itself. `sta HMP0,x` and `sta RESP0,x` with x = 2 reach HMM0 and RESM0,
; which is the same indexing the compiler relies on.
; ---------------------------------------------------------------------------
PosObjectX subroutine
    sta HMCLR
    sta WSYNC               ; line 1: begin from a known beam position
    sec
.divide
    sbc #15                 ; each iteration advances the beam 15 colour clocks
    bcs .divide
    eor #7                  ; remainder -> fine-adjust nibble
    asl
    asl
    asl
    asl
    sta HMP0,x              ; fine adjustment
    sta RESP0,x             ; coarse: strobe at the current beam position
    sta WSYNC               ; line 2
    sta HMOVE               ; must be strobed in blank; costs the left 8 pixels
    rts

    org $FFFC
    .word Reset
    .word Reset
