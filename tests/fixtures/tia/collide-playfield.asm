; ---------------------------------------------------------------------------
; Diagnostic ROM -- where does a RESP0 strobe actually put P0?
;
; QUESTION: `packages/runtime/src/bounds.ts` derives its movement bounds from
; the assumption that an object authored at x lands on screen pixel x. Nothing
; has ever measured that. Does it?
;
; WHY AGAINST THE PLAYFIELD. double-hmove.asm collides P0 against P1, and both
; are placed by the same routine, so a strobe delay that was uniformly wrong
; would move both and the overlap would happen at the same separation anyway --
; Stella would agree with a model that is wrong. The playfield's position is
; fixed by the BEAM and no strobe places it, so a player collided against a
; playfield block measures position ABSOLUTELY.
;
; SETUP: one playfield block is lit -- PF0 D4, which is screen pixels 0 to 3 --
; and P0 is a single lit pixel, GRP0 = $80, so its leftmost column is its only
; column. P0 is authored at P0_X. CXP0FB D7 is read in overscan and the
; background is painted red on contact, black otherwise.
;
; PREDICTION, written before the run: if an authored x lands on screen pixel x,
; the single lit column touches the block for x = 0, 1, 2, 3 and misses from
; x = 4 upward. The sweep's flip is therefore at 4, and any other flip value f
; says the true landing pixel is x + (4 - f).
;
; The answer is a whole-screen colour. Measuring a sprite's left edge off a
; screenshot is a measurement whose error bars come from window management.
;
; SWEEP: P0_X is patched by packages/emulator/test/tia-fixtures.test.ts, which
; edits this source and reassembles rather than poking an offset into the image
; -- a byte offset goes stale the moment this file gains an instruction, and
; the failure it produces is a wrong colour rather than an error.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

P0_X        = 0
RED         = $44
BLACK       = $00

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

    lda #$0E                ; player and playfield both white
    sta COLUP0
    sta COLUPF
    lda #BLACK
    sta COLUBK
    lda #0
    sta CTRLPF              ; no REF: the right half repeats, which is off-screen
                            ; of anything this fixture asks about

MainLoop
    ; --- VSYNC: 3 WSYNCs ---
    lda #2
    sta VSYNC
    sta WSYNC
    sta WSYNC
    sta WSYNC
    lda #0
    sta VSYNC

    ; --- VBLANK: 37 WSYNCs, two of them spent positioning ---
    lda #2
    sta VBLANK

    ldx #0
    lda #P0_X
    jsr PosObjectX

    ldx #35                 ; 37 less the 2 the single call spent
.blank
    sta WSYNC
    dex
    bne .blank

    lda #0
    sta VBLANK

    ; --- VISIBLE: 192 WSYNCs ---
    ; PF0 D4 alone lights screen pixels 0-3. GRP0 $80 lights P0's leftmost
    ; column and nothing else, so the latch reports exactly whether that one
    ; column falls inside the block.
    lda #$10
    sta PF0
    lda #$80
    sta GRP0
    ldx #192
.visible
    sta WSYNC
    dex
    bne .visible

    lda #0
    sta GRP0
    sta PF0

    ; --- OVERSCAN: 30 WSYNCs, and the answer ---
    lda #2
    sta VBLANK

    lda #BLACK
    bit CXP0FB              ; D7 is the P0/playfield pair
    bpl .noContact
    lda #RED
.noContact
    sta COLUBK
    sta CXCLR

    ldx #30
.overscan
    sta WSYNC
    dex
    bne .overscan

    jmp MainLoop

; ---------------------------------------------------------------------------
; A = target pixel, X = object index. The corrected routine: HMCLR first, and
; before the WSYNC, so one HMOVE moves only the object this call positioned.
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

    org $FFFC
    .word Reset
    .word Reset
