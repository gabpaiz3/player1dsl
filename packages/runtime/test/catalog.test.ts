import { TIA_WRITE_NAMES } from '@player1dsl/emulator';
import { describe, expect, it } from 'vitest';
import { ENTRIES } from '../src/entries.ts';
import { type TemplateEntry, validateCatalog } from '../src/index.ts';

/**
 * The authority on which register numbers exist.
 *
 * Deliberately the EMULATOR's table rather than a copy of it. Review 0.2 §1.1's
 * complaint is that a second, disconnected rule table drifts from the first;
 * the runtime therefore owns no register list of its own, and `validateCatalog`
 * takes the authority as a parameter so the one place holding both can supply
 * it. This is a test-only import: `packages/runtime/tsconfig.json` references
 * only `../parser`, and tests are outside `include`, so no project reference and
 * no dependency cycle is created.
 */
const KNOWN_REGISTERS = new Set(Object.keys(TIA_WRITE_NAMES).map(Number));

const SPAN = { file: 'catalog.test.ts', line: 1, column: 1 };

/** A well-formed entry, to mutate one field at a time. */
function wellFormed(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    id: 'test-entry',
    summary: 'a well-formed entry the malformed ones are derived from',
    applies: { kinds: ['run'], objects: 0, copies: 'none' },
    cost: { entryLines: 0, exitLines: 0 },
    perLineData: false,
    writes: [{ register: 0x0d, timing: 'deadline' }],
    ...overrides,
  };
}

describe('catalog invariants', () => {
  it('gives every entry a unique id', () => {
    const ids = ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // An entry that emits no writes cannot render anything. If one appears,
  // either the entry is a stub or `writes` was never filled in -- and a stub
  // that reaches the selector produces a band that draws nothing, silently.
  it('declares at least one write for every entry', () => {
    for (const entry of ENTRIES) {
      expect(entry.writes.length, `${entry.id} declares no writes`).toBeGreaterThan(0);
    }
  });

  // Guards against a typo'd register number silently becoming a real one:
  // $1b is GRP0 and $1a is AUDV1, and both assemble.
  it('only declares registers the emulator knows how to name', () => {
    for (const entry of ENTRIES) {
      for (const write of entry.writes) {
        expect(
          KNOWN_REGISTERS.has(write.register),
          `${entry.id} writes $${write.register.toString(16)}`,
        ).toBe(true);
      }
    }
  });

  it('never claims an entry costs negative lines', () => {
    for (const entry of ENTRIES) {
      expect(entry.cost.entryLines).toBeGreaterThanOrEqual(0);
      expect(entry.cost.exitLines).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('validateCatalog', () => {
  // THE known-negative. Every assertion above passes on an empty catalog, and
  // would keep passing if the entries were deleted. These feed malformed data
  // through the same validator and require it to object, which is the only
  // evidence the four invariants are enforced rather than merely satisfied.
  it('rejects a duplicate id', () => {
    const codes = validateCatalog(
      [wellFormed({ id: 'twice' }), wellFormed({ id: 'twice' })],
      KNOWN_REGISTERS,
      SPAN,
    ).map((d) => d.code);
    expect(codes).toContain('E610');
  });

  it('rejects an entry that declares no writes', () => {
    const diagnostics = validateCatalog([wellFormed({ writes: [] })], KNOWN_REGISTERS, SPAN);
    expect(diagnostics.map((d) => d.code)).toContain('E611');
    expect(diagnostics[0]?.message).toContain('test-entry');
  });

  it('rejects a register the authority does not name', () => {
    const codes = validateCatalog(
      [wellFormed({ writes: [{ register: 0x3f, timing: 'deadline' }] })],
      KNOWN_REGISTERS,
      SPAN,
    ).map((d) => d.code);
    expect(codes).toContain('E612');
  });

  it('rejects a negative line cost', () => {
    const codes = validateCatalog(
      [wellFormed({ cost: { entryLines: -1, exitLines: 0 } })],
      KNOWN_REGISTERS,
      SPAN,
    ).map((d) => d.code);
    expect(codes).toContain('E613');
  });

  // Four separate malformations in one catalog must produce four diagnostics,
  // not one. A validator that returns on its first complaint makes fixing a
  // catalog a round-trip per defect -- the behaviour P1Error exists to avoid.
  it('reports every defect rather than the first', () => {
    const codes = validateCatalog(
      [
        wellFormed({ id: 'twice' }),
        wellFormed({ id: 'twice', writes: [], cost: { entryLines: -1, exitLines: 0 } }),
        wellFormed({ id: 'third', writes: [{ register: 0x3f, timing: 'deadline' }] }),
      ],
      KNOWN_REGISTERS,
      SPAN,
    ).map((d) => d.code);
    expect(new Set(codes)).toEqual(new Set(['E610', 'E611', 'E612', 'E613']));
  });

  it('accepts the well-formed entry it derives the malformed ones from', () => {
    expect(validateCatalog([wellFormed()], KNOWN_REGISTERS, SPAN)).toEqual([]);
  });
});
