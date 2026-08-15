// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8690, maintainer ruling 2026-08-15 option B] The raw-SQL bypass the ruling
// names by name:
//
//   > `NativeSQLStrategy.canHandle` must **decline** an uninterpretable
//   > temporal comparand so raw-SQL paths fall through to the engine door.
//
// The refusal itself lives at the ObjectQL engine's filter collection point —
// the only seam holding a comparand and the field's declared type at once.
// `NativeSQLStrategy` never reaches it: it compiles its own `WHERE col >= $N`
// and binds the comparand directly, so without this decline a raw-SQL
// deployment keeps answering the card's silent zero while the same query on an
// engine-path deployment is refused 400. One filter, two answers, decided by
// which driver the deployment happens to run — which is the whole shape this
// card exists to remove.
//
// This suite pins the ROUTING, which is all this package decides. That the
// engine then refuses (`INVALID_FILTER` / 400, with the `{30_days_ago}`
// positive control in the same test) is pinned in `@objectstack/objectql`'s
// `engine-temporal-comparand-door.test.ts`.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const dataset = DatasetSchema.parse({
  name: 'support_cases',
  label: 'Support Cases',
  object: 'support_case',
  dimensions: [
    { name: 'status', field: 'status', type: 'string' },
    // `type: 'date'` compiles to a cube dimension of `type: 'time'` — the
    // declaration this decline classifies on.
    { name: 'created_date', field: 'created_date', type: 'date' },
  ],
  measures: [{ name: 'case_count', aggregate: 'count' }],
});

/** A real SQL deployment: native SQL AND the objectql aggregate path both up. */
const PROD_CAPS = { nativeSql: true, objectqlAggregate: true, inMemory: true };

function buildService() {
  const rawSqlCalls: Array<{ sql: string; params: unknown[] }> = [];
  const aggregateCalls: Array<{ filter?: unknown }> = [];
  const svc = new AnalyticsService({
    queryCapabilities: () => PROD_CAPS,
    executeRawSql: async (_object, sql, params) => {
      rawSqlCalls.push({ sql, params });
      return [{ case_count: 0 }];
    },
    executeAggregate: async (_object, options) => {
      aggregateCalls.push({ filter: options.filter });
      return [{ case_count: 38 }];
    },
  });
  return { svc, rawSqlCalls, aggregateCalls };
}

describe('[#8690] NativeSQLStrategy declines an uninterpretable temporal comparand', () => {
  // The card's own reachable vocabulary: declared preset names in the dashboard
  // schema. The console lowers them to `{N_days_ago}` macros, so the console
  // path is safe — a saved report, an integration or an AI-authored query sends
  // the preset name itself and used to get a silent zero.
  it.each(['last_30_days', 'last_7_days', 'last_90_days', 'not-a-date-at-all'])(
    'routes `%s` on a time dimension to the engine path, never to raw SQL',
    async (comparand) => {
      const { svc, rawSqlCalls, aggregateCalls } = buildService();

      await svc.queryDataset!(dataset, {
        measures: ['case_count'],
        runtimeFilter: { created_date: { $gte: comparand } },
      });

      // The bypass is closed: nothing was bound into a raw statement.
      expect(rawSqlCalls).toHaveLength(0);
      // …and the query went to the path that passes through the engine door.
      expect(aggregateCalls).toHaveLength(1);
    },
  );

  it('does NOT over-decline: an interpretable comparand keeps the raw-SQL fast path', async () => {
    // The control this decline is worthless without — a gate that declined
    // everything would pass the assertions above while destroying the P1 path
    // for every dashboard in the deployment.
    for (const comparand of ['2026-07-15', '2026-07-15T00:00:00.000Z', '{30_days_ago}']) {
      const { svc, rawSqlCalls, aggregateCalls } = buildService();
      await svc.queryDataset!(dataset, {
        measures: ['case_count'],
        runtimeFilter: { created_date: { $gte: comparand } },
      });
      expect(rawSqlCalls, comparand).toHaveLength(1);
      expect(aggregateCalls, comparand).toHaveLength(0);
    }
  });

  it('does NOT decline on a NON-temporal dimension', async () => {
    // `$gte 'last_30_days'` on a string dimension is a legitimate
    // lexicographic bound. Declining it would be an unforced routing loss.
    const { svc, rawSqlCalls, aggregateCalls } = buildService();
    await svc.queryDataset!(dataset, {
      measures: ['case_count'],
      runtimeFilter: { status: { $gte: 'last_30_days' } },
    });
    expect(rawSqlCalls).toHaveLength(1);
    expect(aggregateCalls).toHaveLength(0);
  });

  it('leaves the empty-string cell exactly as it is — that cell is its own card', async () => {
    // Measured: `$gte ""` binds as `''` and every canonical UTC text sorts at
    // or above it, so it returns every non-null row. The ruling scopes B and C
    // to non-empty strings and forbids deciding this one in passing, so it must
    // keep its current routing, not acquire a decline.
    const { svc, rawSqlCalls } = buildService();
    await svc.queryDataset!(dataset, {
      measures: ['case_count'],
      runtimeFilter: { created_date: { $gte: '' } },
    });
    expect(rawSqlCalls).toHaveLength(1);
  });

  it('finds the comparand wherever it sits — nested combinators and list members', async () => {
    for (const runtimeFilter of [
      { $and: [{ status: 'open' }, { created_date: { $lte: 'last_30_days' } }] },
      { $or: [{ status: 'open' }, { created_date: { $gte: 'last_30_days' } }] },
      { created_date: { $in: ['2026-07-15', 'last_30_days'] } },
      { created_date: 'last_30_days' },
    ]) {
      const { svc, rawSqlCalls, aggregateCalls } = buildService();
      await svc.queryDataset!(dataset, { measures: ['case_count'], runtimeFilter });
      expect(rawSqlCalls, JSON.stringify(runtimeFilter)).toHaveLength(0);
      expect(aggregateCalls, JSON.stringify(runtimeFilter)).toHaveLength(1);
    }
  });
});
