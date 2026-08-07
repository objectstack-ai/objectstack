// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4436] The memory driver's filter refusals carry the SAME wire identity as
 * driver-sql's.
 *
 * #3948 made the two backends agree that an uncompilable filter is a refusal
 * rather than a silent match-everything. The refusal's ENVELOPE has to agree
 * too, or a suite that swaps the memory driver for SQLite sees a coded 400 on
 * one backend and a bare `{ error }` on the other — and the cross-driver parity
 * this driver exists to provide would be false exactly where it is load-bearing.
 *
 * Twin of `driver-sql/src/sql-driver-filter-refusal-envelope.test.ts`; the
 * rationale lives there.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import type { FilterCondition } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

describe('[#4436] InMemoryDriver filter refusals carry INVALID_FILTER and leak no driver prefix', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('deal', {
      fields: {
        id: { type: 'text', name: 'id' },
        stage: { type: 'text', name: 'stage' },
        amount: { type: 'number', name: 'amount' },
      },
    });
    await driver.create('deal', { id: '1', stage: 'won', amount: 10 });
  });

  const find = (where: unknown) =>
    driver.find('deal', { fields: ['id'], where: where as FilterCondition });

  const cases: Array<[string, unknown, string]> = [
    ['unsupported operator in a condition array', [['stage', 'sounds_like', 'won']], 'sounds_like'],
    ['bare comparison triple', ['close_date', 'before', '2024-01-01'], 'close_date'],
    // [#5158] The message names the ARRAY, not the offending element's typeof:
    // the driver no longer walks a filter array, so it has no element to
    // describe. `42` is the caller's own value, echoed back.
    ['filter element of the wrong type', [42], '42'],
    ['`between` with a bad operand', [['amount', 'between', 5]], 'between'],
  ];

  for (const [name, where, needle] of cases) {
    it(`${name} → 400 INVALID_FILTER, no prefix`, async () => {
      const err = await refusalOf(() => find(where));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).not.toContain('[driver-memory]');
      expect(err.message).toContain(needle);
    });
  }

  it('a compilable filter is unaffected', async () => {
    const rows = await find({ stage: 'won' });
    expect(rows.map((r: any) => r.id)).toEqual(['1']);
  });
});
