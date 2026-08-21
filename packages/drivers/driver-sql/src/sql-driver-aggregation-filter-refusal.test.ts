// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10576] A per-aggregation `filter` (`AggregationNodeSchema.filter`, the
 * contract half of #10413) reaching this compiler DIRECTLY is refused with a
 * wire identity — never silently dropped.
 *
 * Before #10576 this driver's `aggregate()` never read `agg.filter`: the
 * statement it built aggregated EVERY row and reported success, which is the
 * #10413 defect ("won deals" counting every opportunity) at the driver seam.
 * The engine now lowers filtered aggregations in memory and never pushes one
 * down here — so the only caller that can arrive with the key is a direct
 * one, and the honest answers are exactly two: compile a conditional
 * aggregate, or refuse loudly. This backend refuses (NOT_IMPLEMENTED/501, the
 * #5907 class for "declared by the spec, not compiled by this face").
 *
 * Every case asserts `code` AND `status`, never merely "it threw" (#6144): a
 * bare-throw assertion is green before and after the envelope exists.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import type { QueryAST } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#10576] SqlDriver refuses a per-aggregation filter it cannot compile', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          amount: { type: 'number', name: 'amount' },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'closed_won', amount: 500 });
    await driver.create('deal', { id: '2', stage: 'open', amount: 900 });
  });

  it('refuses NOT_IMPLEMENTED/501, naming the aggregation and the engine lowering', async () => {
    const ast = {
      object: 'deal',
      aggregations: [
        { function: 'count', alias: 'won_count', filter: { stage: 'closed_won' } },
      ],
    } as unknown as QueryAST;

    let thrown: WireBearingError | undefined;
    try {
      await driver.aggregate('deal', ast);
    } catch (e) {
      thrown = e as WireBearingError;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('NOT_IMPLEMENTED');
    expect(thrown!.status).toBe(501);
    expect(thrown!.message).toContain(
      'Per-aggregation `filter` on "won_count" is not supported by this backend (driver-sql).',
    );
    // The remedy is named: the engine's in-memory lowering serves this query.
    expect(thrown!.message).toContain('`engine.aggregate` lowers filtered aggregations in memory');
  });

  it('control: the same aggregation WITHOUT a filter still computes (only the refusal was added)', async () => {
    const rows = await driver.aggregate('deal', {
      object: 'deal',
      aggregations: [{ function: 'count', alias: 'n' }],
    } as unknown as QueryAST);
    expect(rows).toEqual([{ n: 2 }]);
  });

  it('control: an EMPTY filter object is vacuous (the where/having convention) and computes', async () => {
    const rows = await driver.aggregate('deal', {
      object: 'deal',
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total', filter: {} }],
    } as unknown as QueryAST);
    expect(rows).toEqual([{ total: 1400 }]);
  });
});
