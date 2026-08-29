; ---------------------------------------------------------------------------
; Diagnostic ROM F -- the beam-position baseline.
;
; QUESTION: does the golden comparator notice a player MOVING?
;
; RESP0 is a strobe. It carries no value: what it means is entirely WHERE the
; beam was when it landed, because the player's coarse position latches from the
; horizontal counter at that instant. So a ROM that strobes RESP0 at a different
; colour clock draws the player somewhere else while writing the identical
; (line, register, value) triple -- $00 to RESP0 on line 40, both times.
;
; Its twin, resp-shift.asm, is this program with ten more cycles of delay before
; the strobe. Nothing else differs. If the comparator passes that pair, it
; cannot see position at all, and every "these two ROMs are equivalent" result
; it has produced is silent about where anything was drawn.
;
; This is the same argument golden-base/golden-late make for deadlines, applied
; to the half of the rules that deadlines do not cover: PF0 has a read pixel to
; miss, and RESP0 does not.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

DELAY_ITERATIONS = 6        ; resp-shift.asm is this file with 8

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
    sta RESP0               ; A is still 0; only the CLOCK differs from the twin

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
