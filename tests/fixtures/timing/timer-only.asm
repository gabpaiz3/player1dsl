; ---------------------------------------------------------------------------
; Diagnostic ROM B -- 6532 timer write semantics in isolation.
;
; QUESTION: how many scanlines elapse between writing TIM64T and INTIM
; reading zero?
;
; The timed region contains NO WSYNCs, so nothing competes with the timer and
; nothing halts the CPU while it counts. Every other region is a counted WSYNC
; loop, so the frame length is:
;
;     total = 3 (vsync) + T (timed) + 222 (rest) = 225 + T
;
; Therefore  T = total - 225,  read straight off any emulator's scanline count.
;
; The kernel in examples/tank-arena uses TIM64T #44 and this ROM uses the same
; value, so T is directly comparable with that kernel's VBLANK region.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

TIMER_VALUE = 44            ; same constant the tank-arena kernel uses
REST_LINES  = 222           ; chosen so an ideal T=37 gives a 262-line frame

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

    ; --- TIMED REGION: T scanlines, bounded only by the timer ---
    ; No WSYNC between the write and the poll, so this measures the timer and
    ; nothing else. The trailing WSYNC closes the partial line the timer
    ; expired on, exactly as the tank-arena kernel does.
    lda #2
    sta VBLANK
    lda #TIMER_VALUE
    sta TIM64T
.wait
    lda INTIM
    bne .wait
    sta WSYNC

    ; --- REST: 222 WSYNCs, blanked throughout ---
    ldx #REST_LINES
.rest
    sta WSYNC
    dex
    bne .rest

    jmp MainLoop

    org $FFFC
    .word Reset
    .word Reset
