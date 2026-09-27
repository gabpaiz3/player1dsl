; ---------------------------------------------------------------------------
; Diagnostic ROM -- does positioning a SECOND object displace the first?
;
; QUESTION: a compiled scene whose first band holds two actors renders them
; where the model does not predict. `PosObjectX` strobes HMCLR on entry so that
; only the object it is placing may move when it strobes HMOVE, and the
; compiler relies on that: it calls the routine once per object, back to back,
; in vertical blank. If the second call disturbs the first object, every such
; scene is wrong and nothing in this repository can see it -- the emulator
; models object positions and the golden was recorded from the emulator.
;
; THIS FIXTURE IS collide-playfield.asm PLUS ONE CALL. That is the whole design.
; The control is not a second ROM but the ORIGINAL, which sweeps the same object
; across the same block with the same graphics and reports in the same unit. A
; difference between the two sweeps is the second call's doing and nothing
; else's, which is what makes the comparison worth more than either number.
;
; WHY NOT MEASURE THE SPRITE. An earlier attempt read both objects' leftmost lit
; columns off a Stella screenshot and converted window pixels to TIA pixels. It
; produced a number that did not survive its own method -- the same conversion
; read an actor authored at 40 as 43 and one authored at 60 as 41 -- and a
; retracted entry in docs/kernel-measurements.md. The verdict here is a
; WHOLE-SCREEN COLOUR, which a human or a script reads without arithmetic.
;
; SETUP: identical to collide-playfield.asm. PF0 D4 alone lights screen pixels
; 0 to 3. GRP0 = $80 lights P0's leftmost column and nothing else, so CXP0FB D7
; reports exactly whether that one column falls inside the block. P0 is
; authored at P0_X and positioned FIRST; P1 is authored at P1_X and positioned
; SECOND. P1 is never drawn -- GRP1 stays 0 -- because the question is whether
; the ACT of positioning it moves P0, not where it lands.
;
; P1_X is deliberately 60, whose remainder gives a fine adjustment of -6, six
; pixels LEFT. A displacement that only appears for a large adjustment would be
; missed by a P1_X whose adjustment is zero.
;
; PREDICTION, written before the run: HMCLR does what its comment says, the
; second call moves only P1, and this sweep flips at exactly the same authored x
; as collide-playfield.asm -- red at 0, black from 1 up. Any other flip f means
; the second call displaces P0 by 1 - f pixels, negative being leftward.
;
; SWEEP: P0_X is patched by packages/emulator/test/tia-fixtures.test.ts, which
; edits this source and reassembles rather than poking an offset into the image.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

P0_X        = 0
P1_X        = 60
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

    lda #$0E                ; player and playfield both white
    sta COLUP0
    sta COLUP1
    sta COLUPF
    lda #BLACK
    sta COLUBK
    lda #0
    sta CTRLPF              ; no REF: the right half repeats, which is off-screen
                            ; of anything this fixture asks about

MainLoop
    ; --- VSYNC: 3 WSYNCs ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 WSYNCs, four of them spent positioning ---
    lda #2
    sta VBLANK

    ; P0 first, then P1. The order is the compiler's: firstBindings in band
    ; order, each call strobing HMCLR so that only its own object may move.
    ldx #0
    lda #P0_X
    jsr PosObjectX

    ldx #1
    lda #P1_X
    jsr PosObjectX

    ldx #33                 ; 37 less the 4 the two calls spent
.blank
    sta WSYNC
    dex
    bne .blank

    lda #0
    sta VBLANK

    ; --- VISIBLE: 192 WSYNCs ---
    lda #$10
    sta PF0
    lda #$80
    sta GRP0                ; P1 is never drawn; only P0 meets the block
    ldx #192
.visible
    sta WSYNC
    dex
    bne .visible

    lda #0
    sta GRP0
    sta PF0

    ; --- OVERSCAN: 30 WSYNCs, and the answer ---
    lda #2
    sta VBLANK

    lda #BLACK
    bit CXP0FB              ; D7 is the P0/playfield pair
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
; Byte for byte the routine the compiler emits, and the one
; collide-playfield.asm uses. Copied rather than shared because a fixture that
; drifted from the compiler would answer a question about itself.
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
