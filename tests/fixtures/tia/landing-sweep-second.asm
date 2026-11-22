; ---------------------------------------------------------------------------
; Diagnostic ROM -- HOW FAR does a second positioning call displace the first
; object?
;
; THIS IS landing-sweep.asm PLUS ONE CALL, exactly as collide-two-objects.asm
; is collide-playfield.asm plus one. The control is not a second ROM but the
; ORIGINAL, which fixes the same object, sweeps the same forty probes, reports
; in the same unit, and whose answer is independently known. A difference
; between the two sweeps is the second call's doing and nothing else's.
;
; WHAT IS ALREADY SETTLED. A second `jsr PosObjectX` displaces the object the
; first call placed; measured 2026-09-12 as a whole-screen colour with a
; known-positive, and our emulator does not model it. Three mechanisms have
; been refuted, each by one extra data point:
;
;   a constant offset          collide-two-objects is black at an authored 0
;                              and a 16-pixel block sweep is red only at 80;
;                              a constant offset makes those two agree
;   P1's fine adjustment       P1_X = 66 has a nibble of 0 and still displaces
;   P0's adjustment, twice     predicts red at an authored 16; measured black
;
; What has never been available is the landing pixel itself. That is what this
; fixture reads, in one capture, to a four-pixel bin -- see landing-sweep.asm's
; header for how the forty bands and the REF half work, and for why the answer
; is a bin rather than a pixel.
;
; READ THE CONTROL FIRST. landing-sweep.asm at the same P0_X puts its red band
; at bin (P0_X + 3) / 4 in both halves. Until that reads true, a band here means
; nothing: the probe tables, the band indexing and the RAM store are all
; untested, and a reversed PF1 or PF2 table still lights exactly one band.
;
; P1_X is 60, whose remainder gives a fine adjustment of six pixels LEFT, and
; is the value collide-two-objects.asm used. A displacement that only appeared
; for a large adjustment would be missed by a P1_X whose adjustment is zero.
;
; P1 IS NEVER DRAWN. GRP1 stays 0, because the question is whether the ACT of
; positioning it moves P0, not where P1 lands.
;
; SWEEP: P0_X is patched by packages/emulator/test/tia-fixtures.test.ts, which
; edits this source and reassembles rather than poking an offset into the image.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

P0_X        = 0
P1_X        = 60

RED         = $44               ; the probe and the object met
BLACK       = $00               ; they did not
NOTRUN      = $84               ; this trial has not happened yet
LABEL_REP   = $0C               ; grey: trials 0-19, REF clear, right half repeats
LABEL_MIR   = $96               ; blue: trials 20-39, REF set, right half mirrors
WHITE       = $0E               ; the probe block and the object, during a trial

Results     = $80               ; 40 verdicts, one per trial, indexed by trial
Trial       = $A8               ; 0..39, advanced once per frame

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

    ; Every band starts as "not yet run". The reset loop above cleared RAM to
    ; zero, which is BLACK -- a verdict, and the wrong one to show for a trial
    ; that has not happened.
    lda #NOTRUN
    ldx #39
.initResults
    sta Results,x
    dex
    bpl .initResults

    lda #WHITE
    sta COLUP0

MainLoop
    ; --- VSYNC: 3 WSYNCs ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 lines = 4 positioning + 32 loop + 1 trial setup ---
    lda #2
    sta VBLANK

    ldx #0
    lda #P0_X
    jsr PosObjectX

    ; The second call. HMCLR on entry is supposed to mean that only P1 may
    ; move when this call strobes HMOVE; it does not.
    ldx #1
    lda #P1_X
    jsr PosObjectX

    ldx #32
.blank
    sta WSYNC
    dex
    bne .blank

    ; The last vertical-blank line, spent arming the trial. It is here rather
    ; than in the first visible line because the setup runs some sixty cycles --
    ; well past horizontal blank -- and the probe block would otherwise appear
    ; partway along the first line it is meant to be drawn on.
    lda #BLACK
    sta COLUBK
    lda #WHITE
    sta COLUPF
    lda #$80
    sta GRP0                ; the object's leftmost column, and only that column

    ldx Trial
    ldy #0                  ; REF clear: the right half repeats the left
    cpx #20
    bcc .armed
    ldy #1                  ; REF set: the right half mirrors it
    txa
    sec
    sbc #20
    tax                     ; the probe tables are indexed by bit, 0..19
.armed
    sty CTRLPF
    lda ProbePF0,x
    sta PF0
    lda ProbePF1,x
    sta PF1
    lda ProbePF2,x
    sta PF2
    sta WSYNC               ; ends vertical blank's 37th line

    lda #0
    sta VBLANK              ; cycle 5, inside horizontal blank

    ; --- VISIBLE: 192 lines = 8 trial + 1 read + 160 report + 23 tail ---
    ldx #8
.trial
    sta WSYNC
    dex
    bne .trial

    ; The read line. The clears land inside horizontal blank, so no part of the
    ; probe or the object reaches the report below.
    lda #0
    sta GRP0
    sta PF0
    sta PF1
    sta PF2
    sta CTRLPF              ; the report's labels sit in the left half either
                            ; way; clearing REF keeps the right half determined
    lda #BLACK
    bit CXP0FB              ; D7 is the P0/playfield pair
    bpl .noContact
    lda #RED
.noContact
    ldx Trial
    sta Results,x
    sta CXCLR
    sta WSYNC

    ; --- the report: 40 bands of 4 lines ---
    ldx #0
.band
    lda Results,x
    sta COLUBK              ; cycle 14, inside horizontal blank
    lda LabelCol,x
    sta COLUPF              ; cycle 21; the playfield is dark on this line, so
                            ; its exact arrival is not observable
    sta WSYNC               ; band line 1: verdict colour, no label
    lda LabelPF0,x
    sta PF0
    lda LabelPF1,x
    sta PF1
    sta WSYNC               ; band line 2: the index, in binary
    sta WSYNC               ; band line 3: the index again
    lda #0
    sta PF0
    sta PF1
    sta WSYNC               ; band line 4: verdict colour, no label
    inx
    cpx #40
    bne .band

    lda #BLACK
    sta COLUBK
    ldx #23
.tail
    sta WSYNC
    dex
    bne .tail

    ; --- OVERSCAN: 30 WSYNCs ---
    lda #2
    sta VBLANK

    ; The report's labels cannot collide with anything -- GRP0 is zero below the
    ; trial strip -- but the next frame's trial reads a latch that must hold
    ; only that trial's contact, and an assumption is what this project keeps
    ; finding wrong.
    sta CXCLR

    ldx Trial
    inx
    cpx #40
    bne .keep
    ldx #0
.keep
    stx Trial

    ldy #30
.overscan
    sta WSYNC
    dey
    bne .overscan

    jmp MainLoop

; ---------------------------------------------------------------------------
; Byte for byte the routine the compiler emits, and the one
; collide-playfield.asm uses. Copied rather than shared because a fixture that
; drifted from the compiler would answer a question about itself.
; ---------------------------------------------------------------------------
PosObjectX subroutine
    sta HMCLR
    sta WSYNC               ; line 1: begin from a known beam position
    sec
.divide
    sbc #15                 ; each iteration advances the beam 15 colour clocks
    bcs .divide
    eor #7                  ; remainder -> fine-adjust nibble
    asl
    asl
    asl
    asl
    sta HMP0,x              ; fine adjustment
    sta RESP0,x             ; coarse: strobe at the current beam position
    sta WSYNC               ; line 2
    sta HMOVE               ; must be strobed in blank; costs the left 8 pixels
    rts

; ---------------------------------------------------------------------------
; The probe: ONE playfield bit lit, bit b covering pixels 4b..4b+3. The bit
; order is not left to right -- PF0 uses D4-D7 with D4 leftmost, PF1 runs D7
; down to D0, PF2 runs D0 up to D7 -- so these are tables rather than a shift,
; generated from the same mapping `packages/emulator/src/objects.ts` decodes
; with. Exactly one of the three is non-zero for any b; the other two are
; written as zero so that no bit survives from the previous trial.
; ---------------------------------------------------------------------------
ProbePF0
    .byte $10, $20, $40, $80, $00, $00, $00, $00, $00, $00
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
ProbePF1
    .byte $00, $00, $00, $00, $80, $40, $20, $10, $08, $04
    .byte $02, $01, $00, $00, $00, $00, $00, $00, $00, $00
ProbePF2
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $00, $00
    .byte $00, $00, $01, $02, $04, $08, $10, $20, $40, $80

; ---------------------------------------------------------------------------
; The label: a band's own index, 0..19 within its half, as five binary cells of
; eight pixels. Most significant cell leftmost, lit = 1.
;
;   cell 4 -> pixels 0-7   -> PF0 D4,D5
;   cell 3 -> pixels 8-15  -> PF0 D6,D7
;   cell 2 -> pixels 16-23 -> PF1 D7,D6
;   cell 1 -> pixels 24-31 -> PF1 D5,D4
;   cell 0 -> pixels 32-39 -> PF1 D3,D2
;
; Forty entries, so the report loop needs no modulo: bands 20-39 carry the same
; five cells as 0-19 and are told apart by LabelCol.
; ---------------------------------------------------------------------------
LabelPF0
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $C0, $C0
    .byte $C0, $C0, $C0, $C0, $C0, $C0, $30, $30, $30, $30
    .byte $00, $00, $00, $00, $00, $00, $00, $00, $C0, $C0
    .byte $C0, $C0, $C0, $C0, $C0, $C0, $30, $30, $30, $30
LabelPF1
    .byte $00, $0C, $30, $3C, $C0, $CC, $F0, $FC, $00, $0C
    .byte $30, $3C, $C0, $CC, $F0, $FC, $00, $0C, $30, $3C
    .byte $00, $0C, $30, $3C, $C0, $CC, $F0, $FC, $00, $0C
    .byte $30, $3C, $C0, $CC, $F0, $FC, $00, $0C, $30, $3C
LabelCol
    .byte LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP
    .byte LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP
    .byte LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP
    .byte LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP, LABEL_REP
    .byte LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR
    .byte LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR
    .byte LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR
    .byte LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR, LABEL_MIR

    org $FFFC
    .word Reset
    .word Reset
