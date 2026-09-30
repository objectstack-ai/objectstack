// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20727 — the four drill-through sidecars are set on the declared
 * `AnalyticsResult`, with nothing in between.
 *
 * `AnalyticsResult` (`@objectstack/spec/contracts`) declares `dimensionFields`,
 * `drillRawRows`, `drillRawTotals` and `drillRanges` (#20700). The service once
 * set them through a module-private augmentation of that type; it now sets the
 * declared members directly. That retirement moved no byte of any answer, and
 * this file holds that line.
 *
 * The fixture is the one answer that carries all four at once: a grouping by
 * an equality-drillable dimension (`stage`) beside a month-bucketed date
 * dimension (`close_date`), with a `totals` selection (a per-stage subtotal
 * and the grand total). The answer is read as `AnalyticsResult` with no cast,
 * so each member read below compiles only because the contract declares it.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsResult } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

const DATASET = DatasetSchema.parse({
  name: 'pipe_drill',
  label: 'Pipe',
  object: 'opportunity',
  include: [],
  dimensions: [
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'month' },
  ],
  measures: [{ name: 'cnt', aggregate: 'count' }],
});

/** The grouped field names of one `executeAggregate` call (a date bucket arrives as `{ field, dateGranularity }`). */
function groupedFields(groupBy: unknown[] | undefined): string[] {
  return (groupBy ?? []).map((g) => (typeof g === 'string' ? g : (g as { field: string }).field));
}

/**
 * Granularity bucketing runs through the ObjectQL aggregate path, so the driver
 * answers already-bucketed rows: the main grid (stage × month), the per-stage
 * subtotal, and the grand total, told apart by what each call groups by.
 */
function drillService(): AnalyticsService {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object, { groupBy }) => {
      const grouped = groupedFields(groupBy);
      if (grouped.includes('close_date')) {
        return [
          { stage: 'qualification', close_date: '2026-06', cnt: 3 },
          { stage: 'won', close_date: '2026-07', cnt: 2 },
        ];
      }
      if (grouped.includes('stage')) {
        return [
          { stage: 'qualification', cnt: 3 },
          { stage: 'won', cnt: 2 },
        ];
      }
      return [{ cnt: 5 }];
    },
    getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
  });
}

const DRILL_SIDECARS = ['dimensionFields', 'drillRawRows', 'drillRawTotals', 'drillRanges'];

describe('the drill-through sidecars are emitted on the declared AnalyticsResult (#20727)', () => {
  it('a grouped, date-bucketed answer with totals carries all four, byte for byte', async () => {
    const answer: AnalyticsResult = await drillService().queryDataset(
      DATASET,
      { dimensions: ['stage', 'close_date'], measures: ['cnt'], totals: { groupings: [['stage'], []] } },
      CTX,
    );

    // All four are present, in the order the service sets them.
    expect(Object.keys(answer).filter((k) => DRILL_SIDECARS.includes(k))).toEqual(DRILL_SIDECARS);

    const sidecars = {
      dimensionFields: answer.dimensionFields,
      drillRawRows: answer.drillRawRows,
      drillRawTotals: answer.drillRawTotals,
      drillRanges: answer.drillRanges,
    };
    expect(JSON.stringify(sidecars)).toBe(
      '{"dimensionFields":{"stage":"stage"},' +
        '"drillRawRows":[{"stage":"qualification"},{"stage":"won"}],' +
        '"drillRawTotals":[[{"stage":"qualification"},{"stage":"won"}],[{}]],' +
        '"drillRanges":[' +
        '{"close_date":{"field":"close_date","gte":"2026-06-01","lt":"2026-07-01"}},' +
        '{"close_date":{"field":"close_date","gte":"2026-07-01","lt":"2026-08-01"}}]}',
    );
  });
});
