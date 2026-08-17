; ---------------------------------------------------------------------------
; tank-arena -- hand-written reference kernel
;
; This is the known-good artifact the Player1DSL compiler must eventually
; reproduce. It is written by hand, before any compiler code, so that the
; cycle costs the compiler will later claim are measured rather than assumed.
;
; Target: NTSC, 262 scanlines, 4 KiB unbanked.
; Build:  sh examples/tank-arena/reference/build.sh
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

; --- RAM map ($80-$FF, shared with the stack growing down from $FF) ---------
    seg.u variables
    org $80
; (allocated from increment 3 onward)

; --- Code ------------------------------------------------------------------
    seg code
    org $F000

Reset
    sei                     ; no interrupts (IRQ/NMI are not bonded out anyway)
    cld                     ; the 6507 HAS decimal mode; disable it until BCD scoring
    ldx #$FF
    txs                     ; stack starts at $FF and grows down into the same 128 bytes
    lda #0
.clearMem
    sta $00,x               ; clears TIA registers $00-$7F and RAM $80-$FF
    dex
    bne .clearMem
    sta $00                 ; x wrapped past 0; clear location $00 as well

    lda #$00
    sta COLUBK              ; black background

; ---------------------------------------------------------------------------
; Frame loop -- NTSC 262 lines: 3 VSYNC + 37 VBLANK + 192 visible + 30 overscan
;
; VBLANK and overscan are bounded by the RIOT timer rather than counted in
; WSYNCs. That is what makes "this work fits in non-visible time" enforceable
; at runtime instead of merely asserted -- the mechanism SPEC.md 3 names but
; never connects to the frame budget (spec review 3.2).
; ---------------------------------------------------------------------------
MainLoop

; --- VSYNC: exactly 3 lines ------------------------------------------------
    lda #2
    sta VSYNC
    sta WSYNC               ; VSYNC line 1
    sta WSYNC               ; VSYNC line 2
    sta WSYNC               ; VSYNC line 3
    lda #0
    sta VSYNC

; --- VBLANK: 37 lines ------------------------------------------------------
; 37 lines * 76 cycles = 2812 cycles. TIM64T ticks every 64 cycles, so #43
; gives 43*64 = 2752 -- expiring roughly 16 cycles into line 37, which the
; trailing WSYNC then completes. The ~60 cycles of margin absorb the handful
; of prologue cycles before the timer is armed.
    lda #43
    sta TIM64T
    ; per-frame game logic is added here from increment 3 onward
.waitVBlank
    lda INTIM
    bne .waitVBlank
    sta WSYNC
    sta VBLANK              ; A is 0 after the loop: blanking off

; --- VISIBLE: 192 lines ----------------------------------------------------
    ldx #192
.visibleLine
    sta WSYNC
    dex
    bne .visibleLine

; --- OVERSCAN: 30 lines ----------------------------------------------------
; 30 * 76 = 2280 cycles; #35 gives 35*64 = 2240, expiring ~36 cycles into
; line 30, completed by the trailing WSYNC.
    lda #2
    sta VBLANK              ; blanking on
    lda #35
    sta TIM64T
.waitOverscan
    lda INTIM
    bne .waitOverscan
    sta WSYNC

    jmp MainLoop

; --- Vectors ---------------------------------------------------------------
; Top 6 bytes of the 4 KiB bank. Placing data at $FFFC-$FFFF is also what
; makes the emitted binary exactly 4096 bytes.
    org $FFFC
    .word Reset             ; reset vector
    .word Reset             ; IRQ/BRK vector
