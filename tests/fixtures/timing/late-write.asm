; ---------------------------------------------------------------------------
; Diagnostic ROM C -- a deliberately LATE playfield write.
;
; Reproduces the defect class that produced three separate bugs in the
; tank-arena reference kernel: a loop exits mid-scanline, leaving no horizontal
; blank, so the region-transition writes that follow land in the visible part
; of the line and the beam has already passed them.
;
; This ROM commits the bug on purpose so the trace analyser can be tested
; against a known-positive case. Without it, "zero late writes" on a clean
; kernel proves nothing -- the detector might simply never fire.
;
; The burn loop below is sized to leave the beam well into the visible region
; before PF0 is written.
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

    lda #2
    sta VBLANK
    ldx #37
.vblank
    sta WSYNC
    dex
    bne .vblank

    lda #0
    sta VBLANK
    lda #$0E
    sta COLUPF

    ldx #192
.visible
    sta WSYNC

    ; Burn ~30 CPU cycles so the beam is past pixel 20 in the visible region.
    ldy #5
.burn
    dey
    bne .burn

    ; LATE: PF0 is read by the beam at pixel 0, and we are far past it.
    lda #$F0
    sta PF0                 ; <-- the deliberate defect
    lda #0
    sta PF1
    sta PF2

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
