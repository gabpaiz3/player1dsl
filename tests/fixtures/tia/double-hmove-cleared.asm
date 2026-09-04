; ---------------------------------------------------------------------------
; Diagnostic ROM -- does one HMOVE strobe move EVERY object, or only the one
; just positioned?
;
; QUESTION: with HMCLR strobed between the two positioning calls, does P0 stay
; where it was put?
;
; PREDICTION, written before the run:
;
;   P0 is authored at x=44 and P1 at x=55. Both are 8 pixels wide and solid.
;
;   x=44 divides as 15*2 remainder 14, so the coarse strobe lands P0 at pixel 36
;   and its fine adjustment is $80 -- signed -8, which moves it RIGHT by 8.
;   x=55 divides as 15*3 remainder 10, coarse 51, fine $C0 -- right by 4.
;
;   If HMOVE moves only the object just positioned, P0 rests at 44 and covers
;   44-51, P1 rests at 55 and covers 55-62. Three clear pixels between them:
;   CXPPMM stays CLEAR and the screen is BLACK.
;
;   If HMOVE moves every object with a non-zero HMxx, P0 is adjusted a second
;   time by the second call's strobe and rests at 52, covering 52-59. That
;   overlaps P1's 55-62 by five pixels: CXPPMM SETS and the screen is RED.
;
; The answer is a whole-screen colour, deliberately. Measuring a sprite's left
; edge off a screenshot is a measurement whose error bars come from window
; management; a screen that is entirely one colour or entirely another is not.
;
; THIS IS THE CONTROL for double-hmove.asm: identical but for an HMCLR between
; the two positioning calls, which clears HMP0 before the second HMOVE can
; re-apply it.
;
; It must be BLACK in BOTH implementations. That is what says the pair is
; capable of reporting black at all -- without it, a red result from
; double-hmove.asm could just as well mean the fixture is always red.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

P0_X        = 44
P1_X        = 55
RED         = $44
BLACK       = $00

    seg.u variables
    org $80
tmp         ds 1

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

    lda #$0E                ; both players white, so the sprite is visible too
    sta COLUP0
    sta COLUP1
    lda #BLACK
    sta COLUBK

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

    ; Positioning, in exactly the shape the reference kernel uses: one call per
    ; object, each ending in its own HMOVE, and NO HMCLR between them. That
    ; omission is the whole question.
    ldx #0
    lda #P0_X
    jsr PosObjectX
    sta HMCLR               ; THE difference from double-hmove.asm
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

    ; --- VISIBLE: 192 WSYNCs, both players solid throughout ---
    lda #$FF
    sta GRP0
    sta GRP1
    ldx #192
.visible
    sta WSYNC
    dex
    bne .visible

    lda #0
    sta GRP0
    sta GRP1

    ; --- OVERSCAN: 30 WSYNCs, and the answer ---
    lda #2
    sta VBLANK

    ; CXPPMM D7 is the P0/P1 pair. Latches are level and accumulate across the
    ; whole visible region, so reading here reports "did they overlap anywhere".
    lda #BLACK
    bit CXPPMM
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
; A = target pixel, X = object index. Byte-for-byte the routine the reference
; kernel and the compiler's emitter both use.
; ---------------------------------------------------------------------------
PosObjectX subroutine
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
