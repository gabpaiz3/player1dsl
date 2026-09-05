import { describe, expect, it } from 'vitest';
import {
  allocateRam,
  DEFAULT_STACK_RESERVED,
  kernelScratch,
  RAM_BASE,
  RAM_SIZE,
  type Variable,
} from '../src/index.ts';

/** tank-arena's declared variables, in the order the .p1 declares them. */
const IR_VARIABLES: Variable[] = [
  { name: 'tank0_x', type: 'byte', initial: 40 },
  { name: 'tank0_y', type: 'byte', initial: 120 },
  { name: 'tank1_x', type: 'byte', initial: 110 },
  { name: 'tank1_y', type: 'byte', initial: 60 },
  { name: 'p0_score', type: 'byte', initial: 3 },
  { name: 'p1_score', type: 'byte', initial: 5 },
  { name: 'tank0_tank1_hit', type: 'bool', initial: 0 },
];

const vars = (n: number): Variable[] =>
  Array.from({ length: n }, (_, i) => ({ name: `v${i}`, type: 'byte' as const, initial: 0 }));

describe('RAM allocation', () => {
  it('allocates upward from $80', () => {
    expect([...allocateRam(vars(3)).slots.values()]).toEqual([
      RAM_BASE,
      RAM_BASE + 1,
      RAM_BASE + 2,
    ]);
  });

  it('reserves space for the stack, which shares the same 128 bytes', () => {
    const map = allocateRam(vars(3));
    expect(map.stackReserved).toBe(DEFAULT_STACK_RESERVED);
    expect(map.free).toBe(RAM_SIZE - 3 - DEFAULT_STACK_RESERVED);
  });

  it('fails when variables would run into the stack reservation', () => {
    expect(() => allocateRam(vars(RAM_SIZE - DEFAULT_STACK_RESERVED + 1))).toThrow(/E30\d/);
  });

  it('fits exactly at the boundary', () => {
    expect(allocateRam(vars(RAM_SIZE - DEFAULT_STACK_RESERVED)).free).toBe(0);
  });

  it('says how many bytes over budget it is, not just that it failed', () => {
    try {
      allocateRam(vars(RAM_SIZE - DEFAULT_STACK_RESERVED + 5));
      throw new Error('should have thrown');
    } catch (error) {
      const first = (error as { diagnostics?: { message: string }[] }).diagnostics?.[0];
      expect(first?.message).toContain('5');
    }
  });

  it('is deterministic: the same variables always get the same addresses', () => {
    expect([...allocateRam(vars(8)).slots]).toEqual([...allocateRam(vars(8)).slots]);
  });

  it('keeps declaration order rather than sorting', () => {
    const declared: Variable[] = [
      { name: 'zebra', type: 'byte', initial: 0 },
      { name: 'apple', type: 'byte', initial: 0 },
    ];
    expect([...allocateRam(declared).slots.keys()]).toEqual(['zebra', 'apple']);
  });

  it('rejects a duplicate name rather than silently aliasing two variables', () => {
    const dup: Variable[] = [
      { name: 'a', type: 'byte', initial: 0 },
      { name: 'a', type: 'byte', initial: 1 },
    ];
    expect(() => allocateRam(dup)).toThrow(/E30\d/);
  });

  // The kernel's working bytes are not declared by any source line, but they
  // occupy the same 128 bytes as the ones that are. Two allocators mean two
  // answers to "which byte is free", and the symptom is a sprite whose graphics
  // change when a rule fires.
  it('allocates the kernel scratch out of the same zero page as declared variables', () => {
    const scratch = kernelScratch(2);
    const map = allocateRam([...IR_VARIABLES, ...scratch]);
    const addresses = [...map.slots.values()];
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(map.slots.has('gfx0')).toBe(true);
    expect(map.slots.has('tank0_x')).toBe(true);
  });

  it('gives the kernel one graphics byte per bound object and one shared counter', () => {
    expect(kernelScratch(2).map((v) => v.name)).toEqual(['gfx0', 'gfx1', 'lineTmp']);
    expect(kernelScratch(1).map((v) => v.name)).toEqual(['gfx0', 'lineTmp']);
  });

  /**
   * A glyph pointer's high byte must live at `pointer + 1`, because that is
   * where `lda (ptr),y` reads it from. Nothing in the allocator's contract
   * promises adjacency -- it promises declaration order -- so the thing that
   * depends on it asserts it.
   */
  it('places each glyph pointer high byte immediately after its low byte', () => {
    const map = allocateRam([...IR_VARIABLES, ...kernelScratch(2, 2)]);
    for (const i of [0, 1]) {
      const low = map.slots.get(`digit${i}Ptr`);
      const high = map.slots.get(`digit${i}PtrHi`);
      expect([i, high]).toEqual([i, (low ?? 0) + 1]);
    }
  });

  it('asks for no glyph pointers when a scene has no scores', () => {
    expect(kernelScratch(2, 0).some((v) => v.name.startsWith('digit'))).toBe(false);
  });
});
