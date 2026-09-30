// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20644 — every dataset answer names its base object.
 *
 * `AnalyticsResult.object` (`@objectstack/spec/contracts`) is declared as a
 * producer obligation for `queryDataset`: EVERY dataset answer carries it,
 * whatever dimensions are selected and whether or not rows came back, and a
 * `query` (cube) answer carries none. A consumer keys its record-change
 * refresh on it, so a dimension-less KPI tile whose answer lacks it subscribes
 * to nothing and never re-reads.
 *
 * The service used to set it only inside the two drill-through blocks, which
 * need a drillable dimension AND at least one row. So a dimension-less answer,
 * a zero-row answer, the draft-preview answer (it returns before those blocks)
 * and the degraded "backing object unavailable" answer all went without.
 *
 * One block per exit `queryDataset` has — the main return, the draft-preview
 * return and the degraded return — and the contract's cube-side negative. The
 * main exit is driven through both strategies a dataset query can take, so the
 * answer does not depend on which one served it.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsResult } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

const DATASET = DatasetSchema.parse({
  name: 'pipeline',
  label: 'Pipeline',
  object: 'opportunity',
  include: [],
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

/** A KPI tile: no dimension selected. */
const KPI = { dimensions: [], measures: ['revenue'] };
/** A chart grouped by a drillable (non-date) dimension. */
const GROUPED = { dimensions: ['stage'], measures: ['revenue'] };

type Capabilities = () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };

const STRATEGY_PATHS: ReadonlyArray<{ label: string; capabilities: Capabilities }> = [
  { label: 'NativeSQLStrategy', capabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }) },
  { label: 'ObjectQLStrategy', capabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) },
];

/**
 * A service whose driver answers `rows` to every query, on either strategy.
 * A dimension-less selection gets the rows with their dimension keys dropped,
 * which is what a real `GROUP BY`-less aggregate answers.
 */
function serviceAnswering(capabilities: Capabilities, rows: Record<string, unknown>[], extra: object = {}) {
  const answer = async () => rows.map((r) => ({ ...r }));
  return new AnalyticsService({
    queryCapabilities: capabilities,
    executeRawSql: answer,
    executeAggregate: answer,
    ...extra,
  });
}

describe.each(STRATEGY_PATHS)('the main exit names the base object — $label', ({ capabilities }) => {
  it('`dimensions: []` answers `object`', async () => {
    const answer = await serviceAnswering(capabilities, [{ revenue: 150 }]).queryDataset(DATASET, KPI, CTX);

    expect(answer.rows).toEqual([{ revenue: 150 }]);
    expect(answer.object).toBe('opportunity');
  });

  it('a zero-row answer answers `object` — grouped or not', async () => {
    const svc = serviceAnswering(capabilities, []);

    const grouped = await svc.queryDataset(DATASET, GROUPED, CTX);
    expect(grouped.rows).toEqual([]);
    expect(grouped.object).toBe('opportunity');

    const kpi = await svc.queryDataset(DATASET, KPI, CTX);
    expect(kpi.rows).toEqual([]);
    expect(kpi.object).toBe('opportunity');
  });

  it('a grouped answer is unchanged: `object` beside the drill-through keys it always carried', async () => {
    const answer = await serviceAnswering(capabilities, [{ stage: 'won', revenue: 100 }]).queryDataset(
      DATASET,
      GROUPED,
      CTX,
    );

    expect(answer).toMatchObject({
      rows: [{ stage: 'won', revenue: 100 }],
      object: 'opportunity',
      dimensionFields: { stage: 'stage' },
      drillRawRows: [{ stage: 'won' }],
    });
  });
});

describe('the draft-preview exit names the base object', () => {
  // The preview branch evaluates the selection over the base object's pending
  // seed rows in memory and returns early, ahead of everything the main exit
  // does after the query — so it is the exit a drill-branch-only `object` never
  // reached, grouped or not.
  const SEED = [
    { stage: 'won', amount: 100 },
    { stage: 'lost', amount: 50 },
  ];
  const previewService = () =>
    serviceAnswering(STRATEGY_PATHS[1].capabilities, [], { draftRowsResolver: async () => SEED });

  it('a dimension-less preview answers `object`', async () => {
    const answer = await previewService().queryDataset(DATASET, KPI, CTX, { previewDrafts: true });

    expect(answer.rows).toEqual([{ revenue: 150 }]);
    expect(answer.object).toBe('opportunity');
  });

  it('a grouped preview answers `object`', async () => {
    const answer = await previewService().queryDataset(DATASET, GROUPED, CTX, { previewDrafts: true });

    expect(answer.rows).toHaveLength(2);
    expect(answer.object).toBe('opportunity');
  });
});

describe('the degraded exit names the base object', () => {
  it('"backing object unavailable" answers no rows, and still `object`', async () => {
    const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as any;
    const svc = new AnalyticsService({
      queryCapabilities: STRATEGY_PATHS[0].capabilities,
      executeRawSql: async () => {
        throw new Error('SELECT SUM("amount") FROM "opportunity" - no such table: opportunity');
      },
      logger,
    });

    const answer = await svc.queryDataset(DATASET, KPI, CTX);

    expect(answer).toEqual({ rows: [], fields: [], totals: [], object: 'opportunity' });
    // …and it is the degraded exit that answered, not a main-exit zero-row one.
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('backing object "opportunity" is unavailable'));
  });
});

describe.each(STRATEGY_PATHS)('a cube `query` answer carries no `object` — $label', ({ capabilities }) => {
  // The negative the contract states: a cube answer has no dataset behind it.
  // The hardest case for it is a cube that IS a registered dataset's compiled
  // cube, queried by name through `query()` on a service that has just answered
  // a dataset query for the same dataset — every query `queryDataset` issues
  // runs through the same body as `query()`, so an `object` stamped anywhere
  // on that shared path would surface here.
  it('not on a registered dataset\'s cube, not after a dataset answer on the same service', async () => {
    const svc = serviceAnswering(capabilities, [{ revenue: 150 }], { datasets: [DATASET] });

    // A dataset answer first, from the same service over the same compiled cube.
    await svc.queryDataset(DATASET, KPI, CTX);

    const cube: AnalyticsResult = await svc.query({ cube: 'pipeline', measures: ['revenue'] }, CTX);
    expect(cube.rows).toEqual([{ revenue: 150 }]);
    expect('object' in cube).toBe(false);
  });
});
