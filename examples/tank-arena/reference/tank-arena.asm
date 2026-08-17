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

; --- Layout constants ------------------------------------------------------
HUD_DIGIT0_X    = 60        ; score band digit columns, symmetric about centre
HUD_DIGIT1_X    = 92
HUD_LINES       = 12        ; score band height (SPEC.md 4.4 band model)
FIELD_LINES     = 160       ; open field between the arena walls

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
score0      ds 1            ; $87 BCD, one digit (0-9)
score1      ds 1            ; $88
digit0Ptr   ds 2            ; $89 pointer into DigitFont for score0's glyph
digit1Ptr   ds 2            ; $8B
                            ; 13 bytes used; stack grows down from $FF

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

    lda #3
    sta score0              ; non-zero so both digits are visibly distinct
    lda #5
    sta score1

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

    ; -- resolve each score digit to a font pointer --
    ; Done once per frame in VBLANK so the HUD kernel can use (zp),y and stay
    ; inside horizontal blank.
    lda score0
    asl
    asl
    asl                     ; digit * 8 bytes per glyph
    clc
    adc #<DigitFont
    sta digit0Ptr
    lda #>DigitFont
    adc #0
    sta digit0Ptr+1

    lda score1
    asl
    asl
    asl
    clc
    adc #<DigitFont
    sta digit1Ptr
    lda #>DigitFont
    adc #0
    sta digit1Ptr+1

    ; -- position both players at the HUD digit columns --
    ; P0 and P1 serve the score band first, then get repositioned for the tanks
    ; at the band boundary. Positioning here costs 4 of the 37 VBLANK lines, and
    ; puts the HMOVE comb on an invisible line (spec review 3.3).
    lda #HUD_DIGIT0_X
    ldx #0                  ; object 0 = player 0
    jsr PosObjectX
    lda #HUD_DIGIT1_X
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

    ; ======================= HUD BAND: 12 lines =========================
    ; One BCD digit per player. P0 and P1 are the ONLY movable objects on this
    ; machine, so the score band and the tanks compete for the same two -- the
    ; band is reused vertically, then both objects are repositioned below.
    ;
    ; Deliberately one digit per side, not two. NUSIZ copies cannot help: copies
    ; share graphics, so three copies render the SAME digit three times. Real
    ; multi-digit scores require rewriting GRP0 mid-line between copies, at
    ; precise cycle offsets. That is a separate kernel, and its cost belongs in
    ; its own increment rather than being smuggled into this measurement.
    lda #0
    sta PF0                 ; no arena walls behind the score
    sta PF1
    sta PF2
    lda #$0E
    sta COLUP0              ; white digits
    sta COLUP1

    ldx #2                  ; 2 blank lines above the glyphs
.hudTop
    sta WSYNC
    dex
    bne .hudTop

    ldy #0
.hudDigit                   ; 8 glyph rows
    sta WSYNC
    lda (digit0Ptr),y
    sta GRP0                ; lands ~cycle 8, inside horizontal blank
    lda (digit1Ptr),y
    sta GRP1                ; lands ~cycle 16, still inside blank
    iny
    cpy #8
    bne .hudDigit

    ; Same hazard as the openField -> bottomWall transition: this loop falls
    ; through at cycle 22 with no horizontal blank left, so clearing GRP here
    ; would land at pixel 13 (GRP0) and pixel 22 (GRP1) -- blanking both
    ; players BEFORE the beam reaches the digit columns at x=60 and x=92.
    ; Measured symptom without this WSYNC: row 7 of both digits missing.
    sta WSYNC

    lda #0
    sta GRP0
    sta GRP1
    ldx #1                  ; 1 blank line below; the WSYNC above supplies the other
.hudBottom
    sta WSYNC
    dex
    bne .hudBottom
                            ; 2 + 8 + 2 = HUD_LINES

    ; ==================== BAND TRANSITION: the measurement ===============
    ; THE finding this increment exists to produce. The score band leaves P0/P1
    ; at the HUD digit columns; the field needs them at the tanks' gameplay
    ; columns. Repositioning is not free and cannot happen in VBLANK, because
    ; VBLANK is over -- the HUD has already been drawn.
    ;
    ; PosObjectX costs 2 scanlines per object, so this boundary costs 4 VISIBLE
    ; scanlines. SPEC.md 4.4's band model budgets ZERO for it: 12 + 168 + 12
    ; sums to exactly 192 with nothing left for the transition.
    ;
    ; The HMOVE comb also lands on visible lines here, unlike the VBLANK case.
    lda tank0X
    ldx #0
    jsr PosObjectX
    lda tank1X
    ldx #1
    jsr PosObjectX

    ; -- top wall: 8 solid lines --
    ; Write order matters, and it is ordered by DEADLINE, not by readability.
    ; PosObjectX returns ~9 cycles into a line (HMOVE + rts), leaving only ~13
    ; cycles of horizontal blank. The playfield writes must fit inside it: PF0
    ; is read at pixel 0, so it has the earliest deadline; the colour registers
    ; are not read at all on this line, since no player is drawn over the wall.
    ;
    ; Putting the colour writes first, as reads more naturally, pushed PF0 to
    ; pixel 4 and PF1 to pixel 19 -- a black notch across the left of the first
    ; wall line.
    ;
    ; sta PF2 completes at cycle 22 = colour clock 66, with blank ending at 68.
    ; Two colour clocks of margin: valid, but exactly the "tight but valid" case
    ; SPEC.md 5 proposes warning about below 8 cycles of headroom.
    lda #$F0
    sta PF0                 ; deadline: pixel 0
    lda #$FF
    sta PF1                 ; deadline: pixel 16
    sta PF2                 ; deadline: pixel 48

    lda #$46
    sta COLUP0              ; back to tank colours; no deadline on this line
    lda #$86
    sta COLUP1

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
    ldx #FIELD_LINES
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

    ; A loop exit leaves no horizontal blank: the last iteration falls through
    ; at roughly cycle 55, so the region-transition writes below would land in
    ; the VISIBLE part of that line. Measured symptom without this WSYNC:
    ; `sta PF0` completed at cycle 68 = colour clock 204 = pixel 136, and under
    ; REF the mirrored right half runs PF2, PF1, then PF0 at pixels 144-159 --
    ; so pixels 144-159 turned white for one line, a ~16-pixel sliver at the
    ; bottom right. WSYNC first so every write lands in blank.
    ;
    ; The topWall -> openField transition above needs no such WSYNC because it
    ; already runs immediately after one.
    sta WSYNC

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
; --- Digit font ------------------------------------------------------------
; Ten 8-row glyphs. Page-aligned so `lda (digitPtr),y` never crosses a page
; boundary inside a glyph, keeping the HUD kernel's timing fixed.
    align 256
DigitFont
    .byte %00111100         ; 0
    .byte %01100110
    .byte %01100110
    .byte %01100110
    .byte %01100110
    .byte %01100110
    .byte %01100110
    .byte %00111100
    .byte %00011000         ; 1
    .byte %00111000
    .byte %00011000
    .byte %00011000
    .byte %00011000
    .byte %00011000
    .byte %00011000
    .byte %01111110
    .byte %00111100         ; 2
    .byte %01100110
    .byte %00000110
    .byte %00001100
    .byte %00011000
    .byte %00110000
    .byte %01100000
    .byte %01111110
    .byte %00111100         ; 3
    .byte %01100110
    .byte %00000110
    .byte %00011100
    .byte %00000110
    .byte %00000110
    .byte %01100110
    .byte %00111100
    .byte %00001100         ; 4
    .byte %00011100
    .byte %00111100
    .byte %01101100
    .byte %01111110
    .byte %00001100
    .byte %00001100
    .byte %00001100
    .byte %01111110         ; 5
    .byte %01100000
    .byte %01100000
    .byte %01111100
    .byte %00000110
    .byte %00000110
    .byte %01100110
    .byte %00111100
    .byte %00111100         ; 6
    .byte %01100110
    .byte %01100000
    .byte %01111100
    .byte %01100110
    .byte %01100110
    .byte %01100110
    .byte %00111100
    .byte %01111110         ; 7
    .byte %00000110
    .byte %00001100
    .byte %00011000
    .byte %00110000
    .byte %00110000
    .byte %00110000
    .byte %00110000
    .byte %00111100         ; 8
    .byte %01100110
    .byte %01100110
    .byte %00111100
    .byte %01100110
    .byte %01100110
    .byte %01100110
    .byte %00111100
    .byte %00111100         ; 9
    .byte %01100110
    .byte %01100110
    .byte %00111110
    .byte %00000110
    .byte %00000110
    .byte %01100110
    .byte %00111100

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
