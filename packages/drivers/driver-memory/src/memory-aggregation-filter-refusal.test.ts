// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10576] A per-aggregation `filter` (`AggregationNodeSchema.filter`, the
 * contract half of #10413) reaching this driver's own aggregation faces is
 * refused with the ADR-0112 envelope — never silently answered with the
 * UNFILTERED aggregate, which is the #10413 defect at the driver seam.
 *
 * This driver has TWO doors into `performAggregation` — `aggregate(AST)` (the
 * one objectql's engine uses) and `find()` with aggregations — so both are
 * pinned: a guard on one door alone re-opens the drop through the other. The
 * engine itself never pushes a filtered aggregation down (it lowers in
 * memory); the refusal exists for direct callers. Evaluating the predicate
 * here instead would be a capability build-out, which the #5499 family freeze
 * rules out — the refusal path is the sanctioned scope.
 *
 * Every case asserts `code` AND `status`, never merely "it threw" (#6144).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { InMemoryDriver } from './memory-driver.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const TABLE = 'deal';

describe('[#10576] InMemoryDriver refuses a per-aggregation filter it does not evaluate', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.connect();
    await driver.create(TABLE, { id: '1', stage: 'closed_won', amount: 500 });
    await driver.create(TABLE, { id: '2', stage: 'open', amount: 900 });
  });

  const filteredQuery = (): DriverQuery => ({
    aggregations: [{ function: 'count', alias: 'won_count', filter: { stage: 'closed_won' } }],
  }) as unknown as DriverQuery;

  it('the aggregate(AST) door answers NOT_IMPLEMENTED / 501, naming the aggregation and the engine lowering', async () => {
    let thrown: WireBearingError | undefined;
    try {
      await driver.aggregate(TABLE, filteredQuery());
    } catch (e) {
      thrown = e as WireBearingError;
    }
    expect(thrown, 'a filter this face does not evaluate must not be silently dropped').toBeDefined();
    expect(thrown!.code).toBe('NOT_IMPLEMENTED');
    expect(thrown!.status).toBe(501);
    expect(thrown!.message).toContain(
      'Per-aggregation `filter` on "won_count" is not supported by this backend (driver-memory).',
    );
    expect(thrown!.message).toContain('`engine.aggregate` lowers filtered aggregations in memory');
  });

  it('the find()-with-aggregations door refuses identically — one guard covers both doors', async () => {
    let thrown: WireBearingError | undefined;
    try {
      await driver.find(TABLE, filteredQuery());
    } catch (e) {
      thrown = e as WireBearingError;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('NOT_IMPLEMENTED');
    expect(thrown!.status).toBe(501);
    expect(thrown!.message).toContain('Per-aggregation `filter` on "won_count"');
  });

  it('control: the same aggregation WITHOUT a filter still computes through both doors', async () => {
    const bare = { aggregations: [{ function: 'count', alias: 'n' }] } as unknown as DriverQuery;
    await expect(driver.aggregate(TABLE, bare)).resolves.toEqual([{ n: 2 }]);
    await expect(driver.find(TABLE, bare)).resolves.toEqual([{ n: 2 }]);
  });

  it('control: an EMPTY filter object is vacuous (the where/having convention) and computes', async () => {
    const vacuous = {
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total', filter: {} }],
    } as unknown as DriverQuery;
    await expect(driver.aggregate(TABLE, vacuous)).resolves.toEqual([{ total: 1400 }]);
  });
});
