; ---------------------------------------------------------------------------
; Diagnostic ROM -- collide-two-objects.asm with the two calls swapped.
;
; THE KNOWN-POSITIVE, and the reason the other fixture's result means anything.
; collide-two-objects.asm paints black at every swept x, including x = 0 where
; the one-object control paints red. Black everywhere is also exactly what a
; fixture with a broken latch, a mis-set GRP0 or a wrong block would paint, so
; that result on its own says nothing.
;
; This ROM is identical but for positioning P1 FIRST and P0 SECOND. If the
; effect belongs to the ORDER -- the first object positioned being disturbed by
; the call that follows -- then P0, now last, is undisturbed and this sweep
; flips where the one-object control flips: red at 0, black from 1 up.
;
; So the pair discriminates:
;
;   both black        the fixture cannot paint red; the result is an artefact
;   this one red at 0 the first-positioned object is displaced by the next call
;
; PREDICTION, written before the run: red at 0 and black from 1, matching
; collide-playfield.asm, because HMCLR is strobed on entry to each call and the
; object placed LAST is the one whose fine adjustment the final HMOVE carries.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

P0_X        = 0
P1_X        = 60
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
    sta COLUP1
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

    ; --- VBLANK: 37 WSYNCs, four of them spent positioning ---
    lda #2
    sta VBLANK

    ; P1 FIRST, then P0. The only difference from collide-two-objects.asm.
    ldx #1
    lda #P1_X
    jsr PosObjectX

    ldx #0
    lda #P0_X
    jsr PosObjectX

    ldx #33                 ; 37 less the 4 the two calls spent
.blank
    sta WSYNC
    dex
    bne .blank

    lda #0
    sta VBLANK

    ; --- VISIBLE: 192 WSYNCs ---
    lda #$10
    sta PF0
    lda #$80
    sta GRP0                ; P1 is never drawn; only P0 meets the block
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

    org $FFFC
    .word Reset
    .word Reset
