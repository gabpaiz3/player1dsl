; ---------------------------------------------------------------------------
; Diagnostic ROM G -- resp-base.asm with the player MOVED.
;
; Identical to resp-base.asm except for DELAY_ITERATIONS below: ten more cycles
; before the RESP0 strobe, which walks it thirty colour clocks further right.
;
; The trace records $00 to RESP0 on line 40 in BOTH ROMs. Every other write is
; unchanged, on the same line, with the same value, at the same pixel. Only the
; strobe's own pixel moves -- and with it the player's coarse position, which is
; the only thing a strobe conveys.
;
; If the comparator passes this ROM against resp-base's trace, it is not
; checking beam position, and "equivalent" means nothing about where a sprite
; was drawn. That is review 0.2 section 1.1's complaint, as a ROM.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

DELAY_ITERATIONS = 8        ; resp-base.asm is this file with 6

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
    sta VBLANK              ; A is 0: blanking off. This is visible line 40.

    ; --- the strobe, on visible line 40 ---
    ; The delay walks the beam out of horizontal blank so the strobe lands at a
    ; recorded pixel rather than at -1. A strobe inside blank would compare
    ; equal in either ROM, since the golden format stores the pixel and every
    ; blank write shares -1.
    ldy #DELAY_ITERATIONS
.delay
    dey
    bne .delay
    sta RESP0               ; SAME line, SAME value -- thirty clocks further right

    ; --- the visible loop; its first WSYNC ends line 40, the strobe line ---
    ldx #192
.visible
    sta WSYNC
    lda #$F0
    sta PF0                 ; inside horizontal blank: in time
    lda #0                  ; leave A as the twin leaves it
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
