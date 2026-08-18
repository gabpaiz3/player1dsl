; ---------------------------------------------------------------------------
; TIA and RIOT register equates for Player1DSL reference kernels.
;
; Written from the register map in
; .agents/skills/reviewing-player1dsl-changes/hardware-invariants.md
; rather than copied from a third-party vcs.h, per AGENTS.md.
;
; This is the ONLY place hardware addresses are named. Step 2's TypeScript
; emulator and assembler consume the same map.
;
; Note: TIA read addresses overlap TIA write addresses. They are different
; register files selected by the read/write line, not aliases.
; ---------------------------------------------------------------------------

; --- TIA write registers ---------------------------------------------------
VSYNC           = $00   ; vertical sync set/clear      (D1)
VBLANK          = $01   ; vertical blank set/clear     (D1 blank, D6/D7 input ctrl)
WSYNC           = $02   ; strobe: halt CPU until horizontal blank
RSYNC           = $03   ; strobe: reset horizontal sync counter
NUSIZ0          = $04   ; player 0 copies/size, missile 0 width
NUSIZ1          = $05   ; player 1 copies/size, missile 1 width
COLUP0          = $06   ; colour/luminance player 0 + missile 0
COLUP1          = $07   ; colour/luminance player 1 + missile 1
COLUPF          = $08   ; colour/luminance playfield + ball
COLUBK          = $09   ; colour/luminance background
CTRLPF          = $0A   ; D0 REF, D1 SCORE, D2 PFP, D4-5 ball size
REFP0           = $0B   ; reflect player 0             (D3)
REFP1           = $0C   ; reflect player 1             (D3)
PF0             = $0D   ; playfield register 0         (D4-D7 only)
PF1             = $0E   ; playfield register 1
PF2             = $0F   ; playfield register 2
RESP0           = $10   ; strobe: reset player 0 to current beam position
RESP1           = $11   ; strobe: reset player 1
RESM0           = $12   ; strobe: reset missile 0
RESM1           = $13   ; strobe: reset missile 1
RESBL           = $14   ; strobe: reset ball
AUDC0           = $15   ; audio control 0              (0-15 distortion)
AUDC1           = $16   ; audio control 1
AUDF0           = $17   ; audio frequency 0            (0-31 DIVIDER, not Hz)
AUDF1           = $18   ; audio frequency 1
AUDV0           = $19   ; audio volume 0               (0-15)
AUDV1           = $1A   ; audio volume 1
GRP0            = $1B   ; graphics player 0
GRP1            = $1C   ; graphics player 1
ENAM0           = $1D   ; enable missile 0             (D1)
ENAM1           = $1E   ; enable missile 1             (D1)
ENABL           = $1F   ; enable ball                  (D1)
HMP0            = $20   ; horizontal motion player 0   (D4-D7, -8..+7)
HMP1            = $21   ; horizontal motion player 1
HMM0            = $22   ; horizontal motion missile 0
HMM1            = $23   ; horizontal motion missile 1
HMBL            = $24   ; horizontal motion ball
VDELP0          = $25   ; vertical delay player 0      (D0)
VDELP1          = $26   ; vertical delay player 1      (D0)
VDELBL          = $27   ; vertical delay ball          (D0)
RESMP0          = $28   ; reset missile 0 to player 0  (D1)
RESMP1          = $29   ; reset missile 1 to player 1  (D1)
HMOVE           = $2A   ; strobe: apply horizontal motion (extends blank 8px)
HMCLR           = $2B   ; strobe: clear all horizontal motion registers
CXCLR           = $2C   ; strobe: clear all collision latches

; --- TIA read registers ----------------------------------------------------
; Collision latches report in D7 and D6. They accumulate across the frame;
; read after the visible region, then CXCLR during vertical blank.
CXM0P           = $00   ; D7 M0-P1, D6 M0-P0
CXM1P           = $01   ; D7 M1-P0, D6 M1-P1
CXP0FB          = $02   ; D7 P0-PF, D6 P0-BL
CXP1FB          = $03   ; D7 P1-PF, D6 P1-BL
CXM0FB          = $04   ; D7 M0-PF, D6 M0-BL
CXM1FB          = $05   ; D7 M1-PF, D6 M1-BL
CXBLPF          = $06   ; D7 BL-PF
CXPPMM          = $07   ; D7 P0-P1, D6 M0-M1
INPT0           = $08   ; paddle 0 dumped input
INPT1           = $09   ; paddle 1 dumped input
INPT2           = $0A   ; paddle 2 dumped input
INPT3           = $0B   ; paddle 3 dumped input
INPT4           = $0C   ; player 0 fire button (D7, active low)
INPT5           = $0D   ; player 1 fire button (D7, active low)

; --- RIOT (6532) -----------------------------------------------------------
SWCHA           = $0280 ; joystick directions both players
SWACNT          = $0281 ; port A data direction register
SWCHB           = $0282 ; console switches
SWBCNT          = $0283 ; port B data direction register
INTIM           = $0284 ; timer read
TIMINT          = $0285 ; timer interrupt flag
TIM1T           = $0294 ; set timer, 1 cycle per tick
TIM8T           = $0295 ; set timer, 8 cycles per tick
TIM64T          = $0296 ; set timer, 64 cycles per tick
T1024T          = $0297 ; set timer, 1024 cycles per tick
