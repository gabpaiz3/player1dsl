import { TIA_WRITE_NAMES } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { ENTRIES, entryById, validateCatalog } from '../src/index.ts';

const KNOWN_REGISTERS = new Set(Object.keys(TIA_WRITE_NAMES).map(Number));
const SPAN = { file: 'entries.test.ts', line: 1, column: 1 };

/** Register numbers as names, so a failure says GRP0 rather than 27. */
function writeNames(id: string): string[] {
  const entry = entryById(id);
  if (!entry) throw new Error(`entry ${id} is missing; this test proves nothing`);
  return entry.writes.map((write) => TIA_WRITE_NAMES[write.register] ?? '?').sort();
}

describe('entry costs against the measurements', () => {
  // From docs/kernel-measurements.md: a loop whose per-line writes follow its
  // WSYNC leaves the setup line rendering the previous region's content, and is
  // charged one entry line. Registers set before the loop is entered are valid
  // from that same line and are charged none. Measured on PF1/PF2 in
  // tests/fixtures/kernels/scroll-field.asm, on GRP0 in sprite-formation.asm,
  // and on GRP0/GRP1 in the reference kernel itself.
  it('charges two-sprite-static-field one entry line and solid-run zero', () => {
    expect(entryById('two-sprite-static-field')?.cost.entryLines).toBe(1);
    expect(entryById('solid-run')?.cost.entryLines).toBe(0);
  });

  // The qualification that stops entryLines being computed from perLineData.
  // bcd-score-band has the priming shape -- .hudDigit is `sta WSYNC` then the
  // GRP writes -- and still costs 0, because its entry line falls inside the
  // band's authored 12 rather than on top of it. Frame 0 of the golden trace
  // shows the band as 3 blank / 8 glyph / 1 blank.
  it('gives the score band the priming shape and still charges it nothing', () => {
    expect(entryById('bcd-score-band')?.perLineData).toBe(true);
    expect(entryById('bcd-score-band')?.cost.entryLines).toBe(0);
  });

  it('marks only the run kernel as not rewriting per-line data', () => {
    expect(entryById('solid-run')?.perLineData).toBe(false);
    expect(entryById('two-sprite-static-field')?.perLineData).toBe(true);
  });
});

describe('entry applicability', () => {
  it('binds two objects for two-sprite-static-field and zero for solid-run', () => {
    expect(entryById('two-sprite-static-field')?.applies.objects).toBe(2);
    expect(entryById('solid-run')?.applies.objects).toBe(0);
    expect(entryById('bcd-score-band')?.applies.objects).toBe(2);
  });

  // THE reason applies.kinds exists. objects and perLineData are identical for
  // the HUD and the field, so without kinds the selector's lowest-cost
  // tie-break hands the field to bcd-score-band (cost 0) over
  // two-sprite-static-field (cost 1) -- a field drawn by the score kernel.
  it('separates the score band from the field by kind, since nothing else does', () => {
    const hud = entryById('bcd-score-band');
    const field = entryById('two-sprite-static-field');
    expect(hud?.applies.objects).toBe(field?.applies.objects);
    expect(hud?.perLineData).toBe(field?.perLineData);
    expect(hud?.applies.kinds).not.toEqual(field?.applies.kinds);
  });

  // No entry draws a multi-copy formation yet. sprite-formation.asm measured
  // hardware NUSIZ copies as free but nothing in this catalog uses them, and
  // repositioned copies were never measured at all.
  it('claims no copy strategy, because none has an entry', () => {
    for (const entry of ENTRIES) {
      expect(entry.applies.copies, entry.id).toBe('none');
    }
  });
});

describe('declared writes', () => {
  // Read off tests/goldens/tank-arena.trace frame 0. An entry declares what its
  // OWN rendered lines depend on: the top wall's first traced line carries
  // COLUP0/COLUP1 written for the field, and the bottom wall's carries the GRP
  // clears that end it, because setup code shares the line the next loop's
  // first WSYNC ends. Charging those to solid-run would say a wall's appearance
  // depends on the tank colours.
  it('gives the wall only the playfield registers its own lines depend on', () => {
    expect(writeNames('solid-run')).toEqual(['PF0', 'PF1', 'PF2']);
  });

  it('gives the field its side walls, its tank colours and both sprites', () => {
    expect(writeNames('two-sprite-static-field')).toEqual([
      'COLUP0',
      'COLUP1',
      'GRP0',
      'GRP1',
      'PF0',
      'PF1',
      'PF2',
    ]);
  });

  it('gives the score band the playfield it clears and both digit sprites', () => {
    expect(writeNames('bcd-score-band')).toEqual([
      'COLUP0',
      'COLUP1',
      'GRP0',
      'GRP1',
      'PF0',
      'PF1',
      'PF2',
    ]);
  });
});

// The whole reason validateCatalog returns diagnostics instead of throwing:
// catalog.test.ts feeds it malformed data and requires it to object, and this
// requires it to stay silent on the real thing.
describe('the shipped catalog', () => {
  it('passes its own validator', () => {
    expect(validateCatalog(ENTRIES, KNOWN_REGISTERS, SPAN)).toEqual([]);
  });
});
