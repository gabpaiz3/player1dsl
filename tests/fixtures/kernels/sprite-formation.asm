; ---------------------------------------------------------------------------
; Kernel-shape fixture 3 -- one object drawn as a row of three.
;
; QUESTION: do NUSIZ hardware copies cost any additional scanlines or any
; additional TIA objects, compared with the same band drawing one copy?
;
; SECOND QUESTION, free from the same fixture: an 8-entry sprite table read by a
; loop that writes GRP0 at the top of each iteration renders how many lines? If
; correction 1 is right it renders SEVEN -- the loop's first pass primes, and its
; last pass's write lands on a line the next region has already claimed. That is
; the same entry-cost-1 shape scroll-field measures with PF1/PF2, on a different
; register, which is exactly what would turn one measurement into a rule.
;
; Two formation row loops, 8 iterations each, from ONE player object: the first at
; NUSIZ0 = $03 (three copies, close) and the second at $06 (three copies,
; medium). Neither row repositions anything. If copies were not free, the trace
; would show extra RESP0 strobes inside the visible region, or the bands would
; not fit their counted WSYNCs.
;
; WHAT THIS FIXTURE DOES NOT MEASURE, and therefore what must not be assumed to
; be zero: mid-line RESPx multiplexing, the other way to draw a formation. It
; gives arbitrary copies at arbitrary positions but spends the line's whole cycle
; budget and forbids per-copy graphics. Its cost is UNKNOWN. A catalog that
; records it as unmeasured is honest; one that omits it hands the selector an
; assumed zero it will happily spend.
;
; Visible region: 8 + 8 + 8 + 8 + 160 = 192 counted WSYNCs, so each row loop
; OCCUPIES 8 lines whatever it renders. Occupancy and rendered span are
; different numbers here, and keeping them apart is the point.
;
; PREDICTION, written before the run: row A occupies visible lines 8..15 and
; renders on 9..15; row B occupies 24..31 and renders on 25..31. Seven each.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

    seg.u vars
    org $80
Row         ds 1                ; sprite row counter

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
    ; --- VSYNC: 3 lines ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 lines ---
    ; The ONLY positioning in this ROM, and it happens once, in blank.
    lda #2
    sta VBLANK
    lda #$4A
    sta COLUP0
    lda #40
    ldx #0
    jsr PosObjectX
    ldx #35                     ; 37 - 2 spent by the single PosObjectX call
.vblank
    sta WSYNC
    dex
    bne .vblank
    lda #0
    sta VBLANK

    ; --- gap: 8 blank lines ---
    lda #0
    sta GRP0
    sta NUSIZ0
    ldx #8
.gapA
    sta WSYNC
    dex
    bne .gapA

    ; --- formation row A: 8 lines, three CLOSE copies ---
    lda #$03
    sta NUSIZ0
    ldy #0
.rowA
    sta WSYNC
    lda AlienSprite,y
    sta GRP0
    iny
    cpy #8
    bne .rowA

    ; --- gap: 8 blank lines ---
    lda #0
    sta GRP0
    ldx #8
.gapB
    sta WSYNC
    dex
    bne .gapB

    ; --- formation row B: 8 lines, three MEDIUM copies ---
    lda #$06
    sta NUSIZ0
    ldy #0
.rowB
    sta WSYNC
    lda AlienSprite,y
    sta GRP0
    iny
    cpy #8
    bne .rowB

    ; --- rest of the field: 160 lines ---
    lda #0
    sta GRP0
    sta NUSIZ0
    ldx #160
.field
    sta WSYNC
    dex
    bne .field

    ; --- overscan: 30 lines ---
    lda #2
    sta VBLANK
    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

PosObjectX subroutine
    sta WSYNC
    sec
.divide
    sbc #15
    bcs .divide
    eor #7
    asl
    asl
    asl
    asl
    sta HMP0,x
    sta RESP0,x
    sta WSYNC
    sta HMOVE
    rts

; --- Sprite ----------------------------------------------------------------
; Page-aligned so `lda AlienSprite,y` inside the row loops is a fixed 4 cycles.
    align 256
AlienSprite
    .byte %00111100
    .byte %01111110
    .byte %11011011
    .byte %11111111
    .byte %10111101
    .byte %10100101
    .byte %01000010
    .byte %00100100

    org $FFFC
    .word Reset
    .word Reset
