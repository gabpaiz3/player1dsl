import { assembleSource } from '@player1dsl/assembler';
import { describe, expect, it } from 'vitest';
import { Machine } from '../src/index.ts';

/**
 * Three `sta COLUBK` in a row, immediately after a WSYNC so the beam starts at
 * colour clock 0. `sta zp` is three cycles and a 6502 writes on the third, so
 * the writes land at colour clocks 6, 15 and 24 -- not 0, 9 and 18, which is
 * where a model that applies the write at instruction START puts them.
 *
 * An object's position is set by the beam at the RESPx strobe, and a strobe
 * recorded one instruction early puts every object nine pixels from where the
 * hardware puts it.
 */
function writeClocks(body: string): number[] {
  const { rom } = assembleSource(
    `
    processor 6502
VSYNC   = $00
WSYNC   = $02
COLUBK  = $09
    seg code
    org $F000
Reset
    ldx #0
Frame
    lda #2
    sta VSYNC
    sta WSYNC
    lda #0
    sta VSYNC
    sta WSYNC
${body}
    jmp Frame
    org $FFFC
    .word Reset
    .word Reset
`,
    'write-timing.asm',
  );
  const machine = new Machine(rom);
  machine.runFrame();
  const frame = machine.runFrame({ trace: true });
  return (frame.writes ?? []).filter((w) => w.register === 0x09).map((w) => w.clock);
}

describe('a bus access lands on the instruction final cycle', () => {
  it('charges `sta zp` its two cycles of address work before the write', () => {
    expect(writeClocks('    sta COLUBK\n    sta COLUBK\n    sta COLUBK')).toEqual([6, 15, 24]);
  });

  // PosObjectX strobes RESPx with `sta RESP0,x`, which is zp,x: opcode, operand,
  // index add, write. Three cycles of work before the write, not two. This row
  // is the one the whole object-position model calibrates on.
  it('charges `sta zp,x` its three', () => {
    expect(writeClocks('    sta COLUBK,x\n    sta COLUBK,x')).toEqual([9, 21]);
  });

  // Known-positive: an instruction between two stores must push the second one
  // out by its full cost, or the sync is being applied per frame rather than
  // per instruction.
  it('advances the beam across an instruction that touches no register', () => {
    expect(writeClocks('    sta COLUBK\n    nop\n    sta COLUBK')).toEqual([6, 21]);
  });
});
