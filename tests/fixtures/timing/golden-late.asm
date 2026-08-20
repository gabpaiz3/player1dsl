; ---------------------------------------------------------------------------
; Diagnostic ROM E -- golden-base with ONE write moved past its deadline.
;
; Identical to golden-base.asm except for the burn loop below. PF0 is written
; with the same value on the same scanline, so (line, register, value) is
; unchanged and the comparator's equality half sees nothing at all. Only the
; pixel moves, from horizontal blank into the visible region, past PF0's read
; pixel of 0.
;
; If the comparator passes this ROM against golden-base's trace, it is not
; checking deadlines -- and every clean result it has ever produced means
; nothing.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

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

MainLoop
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ldx #37
.vblank
    sta WSYNC
    dex
    bne .vblank
    sta VBLANK              ; A is 0: blanking off

    ldx #192
.visible
    sta WSYNC
    ldy #8                  ; burn ~40 cycles so the beam leaves horizontal blank
.burn
    dey
    bne .burn
    lda #$F0
    sta PF0                 ; SAME line, SAME value -- but now past pixel 0
    dex
    bne .visible

    lda #2
    sta VBLANK
    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

    org $FFFC
    .word Reset
    .word Reset
