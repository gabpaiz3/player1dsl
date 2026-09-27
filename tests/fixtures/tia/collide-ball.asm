; ---------------------------------------------------------------------------
; Diagnostic ROM -- where does a RESBL strobe actually put the ball?
;
; QUESTION: the ball has no delay constant of its own. `Objects.strobe` routes
; it through MISSILE_STROBE_DELAY, on the grounds that both are one-pixel
; objects -- an assumption on top of an assumption, since the missile's 7 was
; itself only a shift of the player's measured 8. Every phase-2 game needs the
; ball: pong, brick-breaker and anything with a projectile. A golden recorded
; from our own emulator would bake this into the reference the compiler is then
; held to.
;
; THIS IS collide-missile.asm WITH THE BALL IN PLACE OF M0. Same block, same
; sweep, same verdict, same routine, object index 4 rather than 2. The three
; fixtures -- player, missile, ball -- differ by one object each and nothing
; else, which is what makes their flips comparable.
;
; SETUP: PF0 D4 alone lights screen pixels 0 to 3. The ball is enabled by
; ENABL D1 and is one pixel wide when CTRLPF's size bits are 0, which is the
; same CTRLPF = 0 that keeps the playfield unreflected. CXBLPF D7 is the
; ball/playfield pair -- confirmed against `packages/runtime/src/collisions.ts`
; -- read in overscan, red on contact and black otherwise.
;
; PREDICTION, written before the run:
;
;   the ball matches the missile        ->  same flip as collide-missile.asm
;   the ball matches the player         ->  flip at 1, landing x + 3
;   the ball is its own case            ->  some third flip
;
; The model asserts the first. Nothing has tested it, and the ball is the object
; the TIA treats least like the others -- it takes its width from CTRLPF rather
; than a NUSIZ, and it has no copies at all.
;
; The answer is a whole-screen colour. See the retraction in
; docs/kernel-measurements.md for what reading a sprite off a screenshot costs.
;
; SWEEP: BL_X is patched by packages/emulator/test/tia-fixtures.test.ts.
; ---------------------------------------------------------------------------

    processor 6502
    include "vcs.h"

BL_X        = 0
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

    lda #$0E                ; ball and playfield both white
    sta COLUPF              ; the ball takes the PLAYFIELD's colour, not a player's
    lda #BLACK
    sta COLUBK
    lda #0
    sta CTRLPF              ; no REF, and ball size bits 0: width 1, a single
                            ; lit column. The right half repeats, which is
                            ; off-screen of anything this fixture asks about

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

    ldx #4                  ; object index 4: RESBL and HMBL
    lda #BL_X
    jsr PosObjectX

    ldx #35                 ; 37 less the 2 the single call spent
.blank
    sta WSYNC
    dex
    bne .blank

    lda #0
    sta VBLANK

    ; --- VISIBLE: 192 WSYNCs ---
    lda #$10
    sta PF0
    lda #$02
    sta ENABL               ; D1 enables the ball
    ldx #192
.visible
    sta WSYNC
    dex
    bne .visible

    lda #0
    sta ENABL
    sta PF0

    ; --- OVERSCAN: 30 WSYNCs, and the answer ---
    lda #2
    sta VBLANK

    lda #BLACK
    bit CXBLPF              ; D7 is the ball/playfield pair
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
; Byte for byte the routine the compiler emits. Copied rather than shared
; because a fixture that drifted from the compiler would answer a question
; about itself. `sta HMP0,x` and `sta RESP0,x` with x = 4 reach HMBL and RESBL,
; which is the same indexing the compiler relies on.
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
