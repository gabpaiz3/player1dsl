; ---------------------------------------------------------------------------
; Kernel-shape fixture 1 -- a playfield rewritten every line.
;
; QUESTION: does a loop that writes its per-line registers at the TOP of each
; iteration charge one entry line, and does a region whose registers are set
; once before it runs charge zero -- when the register is PF1/PF2 rather than
; GRP0/GRP1?
;
; The visible region is 16 + 160 + 16 = 192 counted WSYNCs. The top band sets
; PF0/PF1/PF2 once before its loop; the scroll band rewrites PF1/PF2 from a
; 16-entry table at the top of every iteration; the bottom band sets them once
; again. Whether each band's FIRST line renders its own content or the previous
; band's is then a fact in the trace, not an argument.
;
; PREDICTION, written before the run: the scroll band occupies visible lines
; 16..175 but renders scroll patterns only on 17..175, so its entry cost is 1.
; The bottom band occupies 176..191 and renders solid from 176, so its entry
; cost is 0.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

BAND_LINES   = 16
SCROLL_LINES = 160

    seg.u vars
    org $80
Phase       ds 1                ; table index, advanced once per frame

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
    sta Phase

MainLoop
    ; --- VSYNC: 3 lines ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 lines ---
    lda #2
    sta VBLANK
    lda #$01                    ; CTRLPF: REF, so the right half mirrors
    sta CTRLPF
    ldx #37
.vblank
    sta WSYNC
    dex
    bne .vblank
    lda #0
    sta VBLANK

    ; --- top band: 16 lines, playfield set ONCE before the loop ---
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2
    lda #$0E
    sta COLUPF
    ldx #BAND_LINES
.top
    sta WSYNC
    dex
    bne .top

    ; --- scroll band: 160 lines, PF1/PF2 rewritten at the top of each line ---
    ; Deadlines: PF1 is read at pixel 16 (cycle ~27), PF2 at 48 (cycle ~38).
    ; The writes complete at cycles 7 and 14, so neither is late and the loop
    ; body is 24 of the line's 76 cycles.
    ; The counter is tested at the TOP, so the 160th pass does its WSYNC and
    ; then exits WITHOUT writing. That matters: if the last pass wrote, its
    ; PF1/PF2 stores would burn ~24 cycles of the bottom band's first horizontal
    ; blank, pushing the bottom band's own PF0 store past cycle 22 -- past
    ; FIRST_READ_PIXEL[PF0] = 0 -- and putting a late-write notch on the exact
    ; line whose "renders solid" this fixture exists to measure. Skipping the
    ; final write costs nothing: that pass's data would have rendered on line
    ; 176, which belongs to the bottom band.
    lda #$46
    sta COLUPF
    ldy Phase
    ldx #SCROLL_LINES
.scroll
    sta WSYNC
    dex
    beq .scrollDone
    lda ScrollPF1,y             ; cycle 4 -> PF1 stored by cycle 11 (deadline ~27)
    sta PF1
    lda ScrollPF2,y
    sta PF2                     ; stored by cycle 18 (deadline ~38)
    iny
    tya
    and #$0F
    tay
    jmp .scroll
.scrollDone

    ; --- bottom band: 16 lines, playfield set ONCE, in the loop's first blank ---
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2
    lda #$0E
    sta COLUPF
    ldx #BAND_LINES
.bottom
    sta WSYNC
    dex
    bne .bottom

    ; --- overscan: 30 lines ---
    lda #2
    sta VBLANK
    lda Phase
    clc
    adc #1
    and #$0F
    sta Phase
    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

; --- Scroll table ----------------------------------------------------------
; A single lit block walking left to right across the mirrored half. Sixteen
; entries, page-aligned so `lda ScrollPF1,y` never crosses a page boundary and
; costs a fixed 4 cycles.
    align 256
ScrollPF1
    .byte $80,$40,$20,$10,$08,$04,$02,$01
    .byte $00,$00,$00,$00,$00,$00,$00,$00
ScrollPF2
    .byte $00,$00,$00,$00,$00,$00,$00,$00
    .byte $01,$02,$04,$08,$10,$20,$40,$80

    org $FFFC
    .word Reset
    .word Reset
