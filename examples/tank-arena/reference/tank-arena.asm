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
tank0X      ds 1            ; $80 horizontal position, 0-159
tank0Y      ds 1            ; $81 visible-loop counter value at the sprite's top row
tank1X      ds 1            ; $82
tank1Y      ds 1            ; $83
gfx0        ds 1            ; $84 next line's GRP0 byte, computed one line ahead
gfx1        ds 1            ; $85 next line's GRP1 byte
lineTmp     ds 1            ; $86 current visible-loop counter, shared by both players
                            ; 7 bytes used; stack has the rest growing down from $FF

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
    lda #$0E
    sta COLUPF              ; white arena walls
    lda #$01
    sta CTRLPF              ; D0 = REF: the right half MIRRORS the left half.
                            ; There is one bit for this. SPEC.md 4.2 says
                            ; `mode mirror` and 4.4 says `mode reflect` for the
                            ; same thing -- one of the two spellings must go
                            ; (spec review 2.3).
    lda #$46
    sta COLUP0              ; tank 0 red
    lda #$86
    sta COLUP1              ; tank 1 blue

    ; starting positions
    lda #40
    sta tank0X
    lda #120
    sta tank0Y
    lda #110
    sta tank1X
    lda #60
    sta tank1Y

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
; MEASURED, not derived. The arithmetic says #43: 37 lines * 76 = 2812 cycles,
; and 43*64 = 2752 lands 16 cycles into line 37 for the trailing WSYNC to
; finish. Stella measured 261 scanlines with that value -- one short.
;
; The cause is the write to TIM64T itself: the internal prescaler may already
; be partway through a 64-cycle interval, so up to 63 cycles are lost. Sixteen
; cycles of margin does not survive that, and expiry falls back into line 36.
; Overscan's 36 cycles of margin does survive it, which is why VBLANK is the
; constant that moved.
;
; #44 gives 2816 cycles, landing early in line 38 nominally and comfortably
; inside line 37 after the prescaler loss.
    lda #44
    sta TIM64T

    ; -- position both tanks horizontally --
    ; Done here, inside VBLANK, for two reasons: the routine burns 2 scanlines
    ; per object (4 of the 37 available), and HMOVE extends the horizontal blank
    ; by 8 pixels on whatever line it is strobed -- the "HMOVE comb". Strobing
    ; it during VBLANK puts that bar on an invisible line. SPEC.md never
    ; mentions this cost anywhere (spec review 3.3).
    lda tank0X
    ldx #0                  ; object 0 = player 0
    jsr PosObjectX
    lda tank1X
    ldx #1                  ; object 1 = player 1
    jsr PosObjectX

.waitVBlank
    lda INTIM
    bne .waitVBlank
    sta WSYNC
    sta VBLANK              ; A is 0 after the loop: blanking off

; --- VISIBLE: 192 lines ----------------------------------------------------
; The arena is static per region, so the playfield registers are written once
; per region rather than once per line. That costs zero cycles inside the line
; loops and leaves the entire 76-cycle budget for the players added next.
;
; Playfield bit order is not left-to-right: PF0 uses only D4-D7 (D4 leftmost),
; PF1 runs D7->D0, PF2 runs D0->D7. $10 in PF0 is the leftmost 4-pixel block.

    ; -- top wall: 8 solid lines --
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2
    ldx #8
.topWall
    sta WSYNC
    dex
    bne .topWall

    ; -- open field: 176 lines, side walls only --
    lda #$10                ; leftmost block only; REF mirrors it to the right
    sta PF0
    lda #0
    sta PF1
    sta PF2
    sta gfx0
    sta gfx1
    sta GRP0
    sta GRP1

    ; Graphics for each line are computed one line AHEAD and written straight
    ; after WSYNC, so both GRP writes land inside horizontal blank. Computing
    ; them inline instead would push the second write into the visible region
    ; and tear whichever tank sits left of the beam at that moment.
    ; Consequence of computing ahead: a sprite whose top row is computed at
    ; counter N is displayed on line N-1, so tankY is the counter value one
    ; line above the visible top row.
    ldx #176
.openField
    sta WSYNC
    lda gfx0
    sta GRP0
    lda gfx1
    sta GRP1
    stx lineTmp

    lda tank0Y              ; --- player 0, next line ---
    sec
    sbc lineTmp
    cmp #8                  ; unsigned: underflow lands well above 8
    bcs .p0blank
    tay
    lda TankSprite,y
    jmp .p0store
.p0blank
    lda #0
.p0store
    sta gfx0

    lda tank1Y              ; --- player 1, next line ---
    sec
    sbc lineTmp
    cmp #8
    bcs .p1blank
    tay
    lda TankSprite,y
    jmp .p1store
.p1blank
    lda #0
.p1store
    sta gfx1

    dex
    bne .openField          ; worst case ~73 of the 76 cycles in a line

    lda #0
    sta GRP0
    sta GRP1                ; no sprite bleed into the bottom wall

    ; -- bottom wall: 8 solid lines --
    lda #$F0
    sta PF0
    lda #$FF
    sta PF1
    sta PF2
    ldx #8
.bottomWall
    sta WSYNC
    dex
    bne .bottomWall
                            ; 8 + 176 + 8 = 192

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

; ---------------------------------------------------------------------------
; PosObjectX -- set one object's horizontal position.
;   A = target x, 0..159
;   X = object index: 0 = P0, 1 = P1, 2 = M0, 3 = M1, 4 = ball
;
; Costs 2 scanlines, so it belongs in VBLANK. Coarse placement comes from
; strobing RESPx wherever the beam happens to be; the loop body is 5 CPU
; cycles = 15 colour clocks, which is the only reason "15" appears here. The
; HARDWARE granularity is 3 colour clocks -- one CPU cycle. HMPx then trims
; by -8..+7 and HMOVE applies it.
;
; HMP0+x covers $20-$24 and RESP0+x covers $10-$14, so one routine serves all
; five movable objects.
; ---------------------------------------------------------------------------
PosObjectX subroutine
    sta WSYNC               ; line 1: begin from a known beam position
    sec
.divide
    sbc #15
    bcs .divide             ; each iteration advances the beam 15 colour clocks
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

; --- Sprite data -----------------------------------------------------------
; Aligned so the 8-byte table cannot straddle a page boundary, which would add
; an unpredictable cycle to `lda TankSprite,y` inside the visible kernel.
    align 8
TankSprite
    .byte %00011000         ; row 0 -- barrel
    .byte %00011000
    .byte %01111110
    .byte %11111111
    .byte %11111111
    .byte %11111111
    .byte %01111110
    .byte %11000011         ; row 7 -- treads

; --- Vectors ---------------------------------------------------------------
; Top 6 bytes of the 4 KiB bank. Placing data at $FFFC-$FFFF is also what
; makes the emitted binary exactly 4096 bytes.
    org $FFFC
    .word Reset             ; reset vector
    .word Reset             ; IRQ/BRK vector
