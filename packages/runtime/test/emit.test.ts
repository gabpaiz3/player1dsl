import { describe, expect, it } from 'vitest';
import type { EmitContext, ObjectDraw, RowGroupCode } from '../src/index.ts';
import {
  digitPointers,
  emitRowGroup,
  emitTransition,
  entryById,
  TIA_REGISTERS,
} from '../src/index.ts';
import { wsyncLines } from './support/wsync.ts';

/** Every TIA register a fragment stores to. WSYNC is structure, not content. */
function registersWritten(code: RowGroupCode): string[] {
  const named = new Set(Object.keys(TIA_REGISTERS));
  const found = new Set<string>();
  for (const line of [...code.hoist, ...code.setup, ...code.body]) {
    const store = /^\s*sta\s+([A-Z0-9]+)\s*(?:;.*)?$/.exec(line);
    const target = store?.[1];
    if (target && target !== 'WSYNC' && named.has(target)) found.add(target);
  }
  return [...found].sort();
}

function template(id: string) {
  const entry = entryById(id);
  if (!entry) throw new Error(`entry ${id} is missing; this test proves nothing`);
  return entry;
}

const TANK: ObjectDraw = {
  object: 'p0',
  color: 0x46,
  table: 'TankSprite',
  height: 8,
  y: 'tank0Y',
  gfx: 'gfx0',
};
const TANK1: ObjectDraw = { ...TANK, object: 'p1', color: 0x86, y: 'tank1Y', gfx: 'gfx1' };
const DIGIT: ObjectDraw = { object: 'p0', color: 0x0e, table: 'Score0Glyph', height: 8 };
const DIGIT1: ObjectDraw = { ...DIGIT, object: 'p1', table: 'Score1Glyph' };

function context(overrides: Partial<EmitContext> = {}): EmitContext {
  return {
    kind: 'run',
    lines: 8,
    bindings: [],
    label: '.r0',
    note: 'a test row group',
    content: { playfield: [0xf0, 0xff, 0xff], objects: [] },
    ...overrides,
  };
}

function loopContext(kind: 'entry' | 'loop', lines: number): EmitContext {
  return context({
    kind,
    lines,
    content: {
      playfield: [0x10, 0x00, 0x00],
      objects: [TANK, TANK1],
      scratch: 'lineTmp',
    },
  });
}

function glyphContext(lines: number, leading: number): EmitContext {
  return context({
    kind: 'glyphs',
    lines,
    content: { playfield: [0, 0, 0], objects: [DIGIT, DIGIT1], leading },
  });
}

describe('scanlines emitted against scanlines the ledger charged', () => {
  it('emits one WSYNC per line for a run row group', () => {
    for (const lines of [1, 8, 30]) {
      const code = emitRowGroup(template('solid-run'), context({ lines }));
      expect([lines, wsyncLines(code.body)]).toEqual([lines, lines]);
    }
  });

  it('emits one WSYNC per line for a glyph band, however it is split', () => {
    for (const leading of [0, 2, 3]) {
      const code = emitRowGroup(template('bcd-score-band'), glyphContext(12, leading));
      expect([leading, wsyncLines(code.body)]).toEqual([leading, 12]);
    }
  });

  // Not one WSYNC per line, and stating why keeps the rule above from being
  // read as universal. The entry row group spends NO WSYNC of its own -- its
  // line is ended by the loop's first WSYNC -- and the loop therefore emits
  // lines + 1. Only the PAIR is exact, and the pair is what the ledger charges:
  // one entry line plus the loop's own.
  it('spends the entry line and the loop between them, not each alone', () => {
    const entry = emitRowGroup(template('two-sprite-static-field'), loopContext('entry', 1));
    const loop = emitRowGroup(template('two-sprite-static-field'), loopContext('loop', 158));

    expect(wsyncLines(entry.body)).toBe(0);
    expect(wsyncLines(loop.body)).toBe(159);
    expect(wsyncLines([...entry.body, ...loop.body])).toBe(1 + 158);
  });

  it('spends five lines repositioning two objects at a visible boundary', () => {
    // Four from the routine, one to absorb the HMOVE comb. The routine's own
    // WSYNCs are inside PosObjectX, so only the comb line is visible here --
    // which is exactly why the count is asserted against the ledger's 5 in
    // static-build.test.ts rather than only here.
    const moves = [
      { object: 'p0' as const, x: 'tank0X' },
      { object: 'p1' as const, x: 'tank1X' },
    ];
    expect(wsyncLines(emitTransition({ moves, visible: true }))).toBe(1);
    expect(wsyncLines(emitTransition({ moves, visible: false }))).toBe(0);
  });
});

describe('emitted registers against declared registers', () => {
  // THE test that keeps the catalog honest. The catalog says what a template
  // writes; Task 13's agreement test then holds those declarations to the
  // hardware timing table. If the code behind an entry writes something the
  // entry never declared, both of those are checking fiction.
  it('emits only the registers the entry declares', () => {
    const cases: ReadonlyArray<[string, EmitContext]> = [
      ['solid-run', context()],
      ['bcd-score-band', glyphContext(12, 2)],
      ['two-sprite-static-field', loopContext('entry', 1)],
      ['two-sprite-static-field', loopContext('loop', 158)],
    ];

    for (const [id, ctx] of cases) {
      const entry = template(id);
      const declared = new Set(
        entry.writes.map((write) => {
          const name = Object.entries(TIA_REGISTERS).find(([, a]) => a === write.register)?.[0];
          if (!name) throw new Error(`no equate for $${write.register.toString(16)}`);
          return name;
        }),
      );
      for (const written of registersWritten(emitRowGroup(entry, ctx))) {
        expect([id, ctx.kind, written, declared.has(written)]).toEqual([
          id,
          ctx.kind,
          written,
          true,
        ]);
      }
    }
  });

  // The other half. Subset alone is satisfied by an emitter that writes
  // nothing, so the entry and loop together must account for every register
  // two-sprite-static-field claims -- otherwise the catalog overstates what the
  // kernel depends on and the ledger's entry line has no evidence behind it.
  it('emits every register the field template declares, across its entry and loop', () => {
    const entry = template('two-sprite-static-field');
    const written = new Set([
      ...registersWritten(emitRowGroup(entry, loopContext('entry', 1))),
      ...registersWritten(emitRowGroup(entry, loopContext('loop', 158))),
    ]);
    expect([...written].sort()).toEqual(['COLUP0', 'COLUP1', 'GRP0', 'GRP1', 'PF0', 'PF1', 'PF2']);
  });

  it('emits every register the wall and score templates declare', () => {
    expect(registersWritten(emitRowGroup(template('solid-run'), context()))).toEqual([
      'PF0',
      'PF1',
      'PF2',
    ]);
    expect(registersWritten(emitRowGroup(template('bcd-score-band'), glyphContext(12, 2)))).toEqual(
      ['COLUP0', 'COLUP1', 'GRP0', 'GRP1', 'PF0', 'PF1', 'PF2'],
    );
  });
});

describe('the colour writes the entry line has no blank left for', () => {
  // The field's colours are hoisted onto the PREVIOUS row group's setup line.
  // The entry line already reaches pixel 1 by its first GRP write, so colour
  // writes added there land around pixel 31 -- safe today only because that
  // line clears GRP to $00, which is a timing nothing in the model constrains.
  it('puts the field colours in the hoist and not on the entry line', () => {
    const code = emitRowGroup(template('two-sprite-static-field'), loopContext('entry', 1));
    expect(code.hoist.join('\n')).toMatch(/sta COLUP0[\s\S]*sta COLUP1/);
    expect(code.body.join('\n')).not.toMatch(/sta COLUP/);
  });

  it('keeps the playfield writes on the entry line, where their deadline is', () => {
    const code = emitRowGroup(template('two-sprite-static-field'), loopContext('entry', 1));
    expect(code.body.join('\n')).toMatch(/sta PF0[\s\S]*sta PF1[\s\S]*sta PF2/);
    expect(code.hoist.join('\n')).not.toMatch(/sta PF/);
  });
});

describe('when a row group cannot be drawn as asked', () => {
  // Known-negative: without it, a band too short for its glyphs emits a
  // negative trailing count, which `wsyncLoop` would have to interpret -- and
  // the honest interpretation of "spend -1 scanlines" is a build failure.
  it('refuses a glyph band too short to hold its glyphs', () => {
    expect(() => emitRowGroup(template('bcd-score-band'), glyphContext(8, 2))).toThrow(
      /cannot hold/,
    );
  });

  it('refuses to draw a transition, which is compiler-derived rather than selected', () => {
    expect(() => emitRowGroup(template('solid-run'), context({ kind: 'transition' }))).toThrow(
      /transition/,
    );
  });

  it('refuses a scanning loop with nowhere to park its counter', () => {
    const ctx = context({
      kind: 'loop',
      lines: 4,
      content: { playfield: [0, 0, 0], objects: [TANK] },
    });
    expect(() => emitRowGroup(template('two-sprite-static-field'), ctx)).toThrow(/counter/);
  });
});

const BREAK = String.fromCharCode(10);

describe('digitPointers', () => {
  it('multiplies the digit by the glyph height and adds the font base', () => {
    const code = digitPointers([{ variable: 'p0_score', pointer: 'digit0Ptr' }], 'DigitFont');
    const joined = code.join(BREAK);
    expect(joined).toContain('lda p0_score');
    expect(joined).toContain('adc #<DigitFont');
    expect(joined).toContain('sta digit0Ptr');
    expect(joined).toContain('lda #>DigitFont');
    expect(joined).toContain('sta digit0Ptr+1');
  });

  // Eight bytes per glyph is three shifts. Two would index the wrong glyph and
  // the HUD would draw a slice of its neighbour.
  it('shifts three times, because a glyph is eight bytes', () => {
    const code = digitPointers([{ variable: 'p0_score', pointer: 'digit0Ptr' }], 'DigitFont');
    expect(code.filter((l) => l.trim().startsWith('asl'))).toHaveLength(3);
  });

  it('carries the high byte, so a font crossing a page still resolves', () => {
    const code = digitPointers([{ variable: 'p0_score', pointer: 'digit0Ptr' }], 'DigitFont');
    const high = code.findIndex((l) => l.includes('lda #>DigitFont'));
    expect(code[high + 1]).toContain('adc #0');
  });

  it('builds one pointer per score', () => {
    const code = digitPointers(
      [
        { variable: 'p0_score', pointer: 'digit0Ptr' },
        { variable: 'p1_score', pointer: 'digit1Ptr' },
      ],
      'DigitFont',
    );
    expect(code.join(BREAK)).toContain('sta digit1Ptr');
  });
});
