; ---------------------------------------------------------------------------
; Kernel-shape fixture 2 -- three movable objects across one boundary.
;
; QUESTION: does repositioning n objects at a band boundary cost 2n + 1 visible
; scanlines for n = 3, as the rule fitted to tank-arena's n = 2 predicts?
;
; The visible region is 24 + 7 + 161 = 192 counted WSYNCs. The middle 7 are the
; boundary: three PosObjectX calls at two lines each, plus one line to absorb
; the HMOVE comb.
;
; HOW THE 7 IS READ OUT, and why it is not the span of the RESPx writes. Each
; PosObjectX call is `WSYNC / ... / RESPx / WSYNC / HMOVE`: the FIRST of its two
; lines carries no traced write at all. Over three calls plus the comb line, the
; first and last RESPx-or-HMOVE writes are six lines apart, not seven -- the
; seventh line is at the FRONT, where nothing is written. Taking min..max over
; the positioning writes therefore measures 6 and reads as falsifying 2n+1,
; which would be a measurement artifact, not a result.
;
; The boundary is the gap between the two bands, so each band writes COLUBK on
; its own first line to mark itself in the trace. Without those marks nothing in
; the trace distinguishes a top-band line from a bottom-band line: both bands
; emit only WSYNCs, and the graphics and colour registers are set once in
; VBLANK. Cost = bottomColubkLine - topColubkLine - TOP_LINES.
;
; PosObjectX indexes HMP0,x and RESP0,x. x=0 is P0, x=1 is P1, and x=4 reaches
; HMBL/RESBL, so the ball uses the same routine with no second code path.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

TOP_LINES    = 24
BOUNDARY     = 7
BOTTOM_LINES = 161

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
    ; Both paddles and the ball are positioned here first, where the HMOVE comb
    ; falls on a blanked line and costs nothing. The boundary below is the
    ; expensive case, and the contrast is the point.
    lda #2
    sta VBLANK
    lda #$10                    ; CTRLPF: ball size 2 (D4-D5), REF off (D0)
    sta CTRLPF
    lda #$FF
    sta GRP0
    sta GRP1
    lda #$46
    sta COLUP0
    lda #$86
    sta COLUP1
    lda #$0E
    sta COLUPF
    lda #2
    sta ENABL                   ; ball on

    lda #20
    ldx #0
    jsr PosObjectX
    lda #120
    ldx #1
    jsr PosObjectX
    lda #70
    ldx #4
    jsr PosObjectX

    ldx #31                     ; 37 - 6 lines already spent by the three calls
.vblank
    sta WSYNC
    dex
    bne .vblank
    lda #0
    sta VBLANK

    ; --- top band: 24 lines ---
    ; COLUBK marks this band's first line in the trace. It is written in the
    ; horizontal blank the loop's first WSYNC ends, so it renders from that line.
    lda #$C4
    sta COLUBK
    ldx #TOP_LINES
.top
    sta WSYNC
    dex
    bne .top

    ; --- boundary: reposition all three, on VISIBLE lines ---
    lda #60
    ldx #0
    jsr PosObjectX
    lda #90
    ldx #1
    jsr PosObjectX
    lda #40
    ldx #4
    jsr PosObjectX
    sta WSYNC                   ; absorb the comb

    ; --- bottom band: 161 lines ---
    lda #$04                    ; marks this band's first line in the trace
    sta COLUBK
    ldx #BOTTOM_LINES
.bottom
    sta WSYNC
    dex
    bne .bottom

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
    sta WSYNC                   ; line 1
    sec
.divide
    sbc #15
    bcs .divide
    eor #7
    asl
    asl
    asl
    asl
    sta HMP0,x                  ; x=0 P0, x=1 P1, x=4 ball
    sta RESP0,x
    sta WSYNC                   ; line 2
    sta HMOVE
    rts

    org $FFFC
    .word Reset
    .word Reset
