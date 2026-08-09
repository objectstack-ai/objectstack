// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5347 / #5348] The wasm driver refuses out-of-contract filter input too.
 *
 * `SqliteWasmDriver extends SqlDriver`, so both refusals are inherited and
 * nothing here re-implements either. What this pins is that the inheritance
 * actually DELIVERS them end to end: this driver swaps knex's transport for a
 * custom sql.js dialect, and a refusal has to survive that pipeline with its
 * ADR-0112 envelope (`code` / `status`) intact rather than being swallowed,
 * re-wrapped by the wasm error path, or bypassed by an override.
 *
 * "It inherits the compiler, therefore it is fine" is the assumption this
 * driver's temporal / pagination / filter-logic suites exist to disprove
 * (#4405), and #5347 named both drivers as unverified. Measured here before the
 * fix, on one row with `stage: 'won'` (id 1) and one with `stage: null` (id 2):
 *
 * ```
 * { stage: { $null: 'yes' } }   =>  RESOLVED ["2"]   // IS NULL, like driver-sql
 * { $where: 'return true' }     =>  RESOLVED []      // compiled as a column
 * { $or: [{ $where: 'x' }] }    =>  RESOLVED []
 * ```
 *
 * — the same two defects as the base class, confirming the inheritance carried
 * the bugs as faithfully as it now carries the fixes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from './index.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#5347/#5348] driver-sqlite-wasm inherits the out-of-contract filter refusals', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: 'deal', fields: { stage: { type: 'string' }, score: { type: 'number' } } },
    ]);
    await driver.create('deal', { id: '1', stage: 'won', score: 10 }, { bypassTenantAudit: true });
    await driver.create('deal', { id: '2', stage: null, score: 20 }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find(
      'deal',
      { object: 'deal', fields: ['id'], where } as any,
      { bypassTenantAudit: true },
    );
    return (rows as any[]).map((r) => String(r.id)).sort();
  };

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await ids(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  describe('[#5348] undeclared $-keys in a node position', () => {
    for (const [label, where, key] of [
      ['$where at the top level', { $where: 'return true' }, '$where'],
      ['$nor at the top level', { $nor: [{ stage: 'won' }] }, '$nor'],
      ['$where inside $or', { $or: [{ $where: 'x' }] }, '$where'],
    ] as Array<[string, unknown, string]>) {
      it(`refuses ${label} with the base class's envelope`, async () => {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`Unsupported filter combinator "${key}"`);
      });
    }

    it('the three declared combinators still answer', async () => {
      expect(await ids({ $and: [{ $or: [{ stage: 'won' }] }, { $not: { stage: 'lost' } }] })).toEqual(['1']);
    });
  });

  describe('[#5347] a non-boolean $null comparand', () => {
    for (const [label, value] of [
      ["the string 'yes'", 'yes'],
      ['the number 0', 0],
      ["the STRING 'false'", 'false'],
    ] as Array<[string, unknown]>) {
      it(`refuses ${label} with the base class's envelope`, async () => {
        const err = await refusalOf({ stage: { $null: value } });
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain('requires a boolean comparand');
      });
    }

    it('true and false are unchanged', async () => {
      expect(await ids({ stage: { $null: true } })).toEqual(['2']);
      expect(await ids({ stage: { $null: false } })).toEqual(['1']);
    });
  });

  it('legal filters are untouched', async () => {
    expect(await ids({ stage: 'won' })).toEqual(['1']);
    expect(await ids({ score: { $gte: 10 } })).toEqual(['1', '2']);
    expect(await ids({})).toEqual(['1', '2']);
  });
});
