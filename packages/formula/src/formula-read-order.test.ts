// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33100 — the order an object's formulas are computed in, and the formulas
 * on a cycle (see `formula-read-order.ts`).
 */
import { describe, expect, it } from 'vitest';
import { formulaCycleMessage, formulaReadOrder } from './index';

const reads = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe('#33100 — formulaReadOrder', () => {
  it('puts each formula after the formulas it reads; the rest keep the order given', () => {
    const { order, cycles } = formulaReadOrder(reads({ f_c: ['f_b'], f_plain: [], f_b: ['f_a'], f_a: [] }));
    expect(order).toEqual(['f_a', 'f_b', 'f_c', 'f_plain']);
    expect(cycles.size).toBe(0);
  });

  it('ignores a read of a name it was not given (a stored field)', () => {
    expect(formulaReadOrder(reads({ f_total: ['quantity', 'f_sibling'], f_sibling: ['quantity'] })).order)
      .toEqual(['f_sibling', 'f_total']);
  });

  it('names a formula reading itself, and every member of a longer cycle; a reader of the cycle is not on it', () => {
    const { order, cycles } = formulaReadOrder(reads({
      f_self: ['f_self'],
      f_x: ['f_y'],
      f_y: ['f_z'],
      f_z: ['f_x'],
      f_reads: ['f_x'],
    }));
    expect([...cycles.keys()].sort()).toEqual(['f_self', 'f_x', 'f_y', 'f_z']);
    expect(cycles.get('f_self')).toBe(formulaCycleMessage('f_self', ['f_self']));
    expect(cycles.get('f_self')).toContain("('f_self' reads 'f_self')");
    expect(cycles.get('f_y')).toContain("('f_y' reads 'f_z', 'f_z' reads 'f_x', 'f_x' reads 'f_y')");
    // Every formula is still listed once: the caller decides what a cycle member does.
    expect([...order].sort()).toEqual(['f_reads', 'f_self', 'f_x', 'f_y', 'f_z']);
  });
});
