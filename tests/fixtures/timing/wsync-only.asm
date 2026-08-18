; ---------------------------------------------------------------------------
; Diagnostic ROM A -- WSYNC semantics in isolation.
;
; QUESTION: does N executions of `sta WSYNC` produce exactly N scanlines?
;
; There is NO timer anywhere in this ROM. Every region boundary is a counted
; WSYNC loop, so the frame length is a pure function of the WSYNC count:
;
;     3 + 37 + 192 + 30 = 262 WSYNCs
;
; If an emulator reports 262 scanlines, WSYNC is 1:1 with scanlines and the
; setup code preceding a loop shares the line the loop's first WSYNC ends.
; Any other number tells us the boundary rule directly.
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
    ; --- VSYNC: 3 WSYNCs ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 WSYNCs ---
    lda #2
    sta VBLANK
    ldx #37
.vblank
    sta WSYNC
    dex
    bne .vblank

    ; --- VISIBLE: 192 WSYNCs ---
    lda #0
    sta VBLANK
    lda #$C4                ; green background, so the region is visible on screen
    sta COLUBK
    ldx #192
.visible
    sta WSYNC
    dex
    bne .visible

    ; --- OVERSCAN: 30 WSYNCs ---
    lda #2
    sta VBLANK
    lda #0
    sta COLUBK
    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

    org $FFFC
    .word Reset
    .word Reset
