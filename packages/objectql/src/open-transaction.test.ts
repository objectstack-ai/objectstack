// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { openTransactionKind } from './open-transaction.js';

function engineWith(ambient: unknown, closed: unknown[] = []) {
  return {
    txStore: { getStore: () => (ambient === undefined ? undefined : { transaction: ambient }) },
    isClosedUnitHandle: (h: unknown) => closed.includes(h),
  };
}

describe('where a write stands with respect to a transaction', () => {
  const a = { tx: 'ambient' };
  const t = { tx: 'threaded' };

  it('answers none with no open transaction', () => {
    expect(openTransactionKind(engineWith(undefined))).toBe('none');
    expect(openTransactionKind(engineWith(a, [a]), a)).toBe('none');
  });

  it('answers joined for the ambient transaction, carried or not', () => {
    expect(openTransactionKind(engineWith(a))).toBe('joined');
    expect(openTransactionKind(engineWith(a), a)).toBe('joined');
  });

  it('answers separate for a carried handle the ambient store does not hold', () => {
    expect(openTransactionKind(engineWith(undefined), t)).toBe('separate');
    expect(openTransactionKind(engineWith(a), t)).toBe('separate');
  });

  it('reads an engine double from the carried handle alone', () => {
    expect(openTransactionKind({}, undefined)).toBe('none');
    expect(openTransactionKind({}, t)).toBe('separate');
  });
});
