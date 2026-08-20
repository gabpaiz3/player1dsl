; ---------------------------------------------------------------------------
; Diagnostic ROM D -- the comparator baseline.
;
; A minimal stable frame that writes PF0 once per visible line, always inside
; horizontal blank. Its twin, golden-late.asm, is the same program with a delay
; inserted before the PF0 write, so the write lands on the SAME scanline with
; the SAME value at a LATER pixel.
;
; That pair is what proves the golden comparator checks deadlines. The
; comparator has two independent halves -- (line, register, value) equality and
; clock-vs-deadline -- and almost any mutation to a ROM shifts a value or a
; line, so it trips the equality half and the deadline half is never observed
; to fail. Without these two ROMs, the novel half of the comparator would ship
; unverified, exactly as findLateWrites would have without late-write.asm.
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
    lda #$F0
    sta PF0                 ; inside horizontal blank: in time
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
