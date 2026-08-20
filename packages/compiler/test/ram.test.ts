import { describe, expect, it } from 'vitest';
import {
  allocateRam,
  DEFAULT_STACK_RESERVED,
  RAM_BASE,
  RAM_SIZE,
  type Variable,
} from '../src/index.ts';

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
});
