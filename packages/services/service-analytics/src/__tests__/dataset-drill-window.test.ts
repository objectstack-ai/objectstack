// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27074] A dataset answer whose selection carries a
 * `timeDimensions[].dateRange` window reports that window in `drillRanges`,
 * so a drill list filters by exactly the bounds the query filtered by.
 *
 * MEASURED on `origin/main` `6845035c`, before the change: a query grouped by
 * `stage` with `close_date` windowed to `this_quarter` under `Asia/Shanghai`
 * answered no `drillRanges` at all, so the drill list behind a stage row
 * listed every period's deals; and a month bucket cut by `last_30_days`
 * drilled the whole month.
 *
 * The unit half drives `queryDataset` over a mocked engine aggregate and reads
 * the window the ObjectQL strategy handed the engine beside the answer. The
 * real-engine half (SQLite through the plugin's own composition, both
 * strategies) runs each row's drill filter as the drill list does,
 * `{ field: { $gte, $lt } }` ANDed with the row's raw grouped value, and
 * counts what it lists against what the row counted.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** Frozen: Wednesday 2026-09-09 in both UTC and Shanghai, inside Q3. */
const NOW = new Date('2026-09-09T12:34:56.789Z');
const CTX = { tenantId: 'org_A' } as ExecutionContext;
const SHANGHAI = 'Asia/Shanghai';
/** Q3 2026 in Shanghai: its July and October midnights, as UTC instants. */
const Q3_SHANGHAI = { gte: '2026-06-30T16:00:00.000Z', lt: '2026-09-30T16:00:00.000Z' };

const pipeline = DatasetSchema.parse({
  name: 'pipeline_27074', label: 'Pipeline', object: 'opportunity', include: [],
  dimensions: [
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'month' },
    // A second dimension over the SAME field, bucketed by quarter.
    { name: 'close_quarter', field: 'close_date', type: 'date', dateGranularity: 'quarter' },
  ],
  measures: [{ name: 'cnt', aggregate: 'count' }],
});

/** The ObjectQL face over `rows`, recording the filter each engine aggregate received. */
function service(rows: Array<Record<string, unknown>>, closeDateType: 'datetime' | 'date' | undefined, seen: unknown[] = []) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, opts: { filter?: unknown }) => { seen.push(opts.filter); return rows; },
    sourceFieldMeta: (_o, f) => (f === 'close_date' && closeDateType ? { type: closeDateType } : undefined),
  });
}

/** The `close_date` bound pair a recorded engine filter carries, wherever it sits in the tree. */
function closeDateBounds(filter: unknown): Record<string, unknown> | undefined {
  if (!filter || typeof filter !== 'object') return undefined;
  if (Array.isArray(filter)) {
    for (const f of filter) { const hit = closeDateBounds(f); if (hit) return hit; }
    return undefined;
  }
  const obj = filter as Record<string, unknown>;
  if (obj.close_date && typeof obj.close_date === 'object') return obj.close_date as Record<string, unknown>;
  for (const v of Object.values(obj)) { const hit = closeDateBounds(v); if (hit) return hit; }
  return undefined;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('#27074 — a windowed dataset answer reports the window in drillRanges', () => {
  it('a window on an ungrouped datetime dimension is an entry on every row, at the instants the query filtered by', async () => {
    const seen: unknown[] = [];
    const result = await service(
      [{ stage: 'won', cnt: 3 }, { stage: 'lost', cnt: 2 }],
      'datetime',
      seen,
    ).queryDataset(
      pipeline,
      {
        dimensions: ['stage'],
        measures: ['cnt'],
        timeDimensions: [{ dimension: 'close_date', dateRange: 'this_quarter' }],
        timezone: SHANGHAI,
      },
      CTX,
    );
    const entry = { close_date: { field: 'close_date', ...Q3_SHANGHAI } };
    expect(result.drillRanges).toEqual([entry, entry]);
    // The very bounds the query handed the engine — one window, not two.
    expect(closeDateBounds(seen[0])).toEqual({ $gte: Q3_SHANGHAI.gte, $lt: Q3_SHANGHAI.lt });
    // The equality sidecars are untouched.
    expect(result.dimensionFields).toEqual({ stage: 'stage' });
    expect(result.drillRawRows).toEqual([{ stage: 'won' }, { stage: 'lost' }]);
  });

  it('month buckets cut by last_30_days are narrowed to the window at both edges, the middle untouched', async () => {
    // Shanghai: today 2026-09-09, so the window is [2026-08-10, 2026-09-10) there.
    const result = await service(
      [{ close_date: '2026-08', cnt: 4 }, { close_date: '2026-09', cnt: 1 }],
      'datetime',
    ).queryDataset(
      pipeline,
      {
        dimensions: ['close_date'],
        measures: ['cnt'],
        timeDimensions: [{ dimension: 'close_date', dateRange: 'last_30_days' }],
        timezone: SHANGHAI,
      },
      CTX,
    );
    expect(result.drillRanges).toEqual([
      // August's bucket opens 2026-07-31T16:00Z; the window opens later.
      { close_date: { field: 'close_date', gte: '2026-08-09T16:00:00.000Z', lt: '2026-08-31T16:00:00.000Z' } },
      // September's bucket closes 2026-09-30T16:00Z; the window closes earlier.
      { close_date: { field: 'close_date', gte: '2026-08-31T16:00:00.000Z', lt: '2026-09-09T16:00:00.000Z' } },
    ]);

    const wide = await service(
      [{ close_date: '2026-07', cnt: 4 }, { close_date: '2026-08', cnt: 1 }, { close_date: '2026-09', cnt: 1 }],
      'date',
    ).queryDataset(
      pipeline,
      {
        dimensions: ['close_date'],
        measures: ['cnt'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-07-15', '2026-09-14'] }],
      },
      CTX,
    );
    expect(wide.drillRanges).toEqual([
      { close_date: { field: 'close_date', gte: '2026-07-15', lt: '2026-08-01' } },
      { close_date: { field: 'close_date', gte: '2026-08-01', lt: '2026-09-01' } },
      { close_date: { field: 'close_date', gte: '2026-09-01', lt: '2026-09-15' } },
    ]);
  });

  it('a window on a field a bucket of ANOTHER dimension groups narrows that bucket entry and adds none', async () => {
    // A drill filter keys by field: a second `close_date` entry would replace
    // the quarter bucket's bound instead of meeting it.
    const result = await service([{ close_date: '2026-Q3', cnt: 2 }], 'date').queryDataset(
      pipeline,
      {
        dimensions: ['close_quarter'],
        measures: ['cnt'],
        timeDimensions: [{ dimension: 'close_date', dateRange: 'last_30_days' }],
      },
      CTX,
    );
    expect(result.drillRanges).toEqual([
      { close_quarter: { field: 'close_date', gte: '2026-08-10', lt: '2026-09-10' } },
    ]);
  });

  it('an explicit bare-day window on a datetime field runs to the next UTC midnight, as the shared lowering compiles it', async () => {
    const result = await service([{ stage: 'won', cnt: 1 }], 'datetime').queryDataset(
      pipeline,
      {
        dimensions: ['stage'],
        measures: ['cnt'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-07-01', '2026-09-30'] }],
        timezone: SHANGHAI,
      },
      CTX,
    );
    expect(result.drillRanges).toEqual([
      { close_date: { field: 'close_date', gte: '2026-07-01T00:00:00.000Z', lt: '2026-10-01T00:00:00.000Z' } },
    ]);
  });

  it('a {token} window resolves as the executor resolves it', async () => {
    const result = await service([{ stage: 'won', cnt: 1 }], 'date').queryDataset(
      pipeline,
      {
        dimensions: ['stage'],
        measures: ['cnt'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['{month_start}', '{today}'] }],
      },
      CTX,
    );
    expect(result.drillRanges).toEqual([
      { close_date: { field: 'close_date', gte: '2026-09-01', lt: '2026-09-10' } },
    ]);
  });

  it('a window with no exact half-open spelling gets no entry: an instant end, the last supported day', async () => {
    for (const dateRange of [
      ['2026-07-01T00:00:00Z', '2026-09-30T12:00:00Z'],
      ['2026-07-01', '9999-12-31'],
    ]) {
      const result = await service([{ stage: 'won', cnt: 1 }], 'datetime').queryDataset(
        pipeline,
        { dimensions: ['stage'], measures: ['cnt'], timeDimensions: [{ dimension: 'close_date', dateRange }] },
        CTX,
      );
      expect(result.drillRanges, JSON.stringify(dateRange)).toBeUndefined();
    }
  });

  describe('controls', () => {
    it('a selection with no dateRange is unchanged: no drillRanges for an equality-only grouping', async () => {
      const result = await service([{ stage: 'won', cnt: 3 }], 'datetime').queryDataset(
        pipeline,
        { dimensions: ['stage'], measures: ['cnt'], timezone: SHANGHAI },
        CTX,
      );
      expect(result.drillRanges).toBeUndefined();
      // …nor for a timeDimensions entry that states only a bucket.
      const bucketed = await service([{ close_date: '2026-09', cnt: 3 }], 'datetime').queryDataset(
        pipeline,
        { dimensions: ['close_date'], measures: ['cnt'], timeDimensions: [{ dimension: 'close_date', granularity: 'month' }] },
        CTX,
      );
      expect(bucketed.drillRanges).toEqual([
        { close_date: { field: 'close_date', gte: '2026-09-01T00:00:00.000Z', lt: '2026-10-01T00:00:00.000Z' } },
      ]);
    });

    it('a date field serialises calendar days', async () => {
      const result = await service([{ stage: 'won', cnt: 3 }], 'date').queryDataset(
        pipeline,
        { dimensions: ['stage'], measures: ['cnt'], timeDimensions: [{ dimension: 'close_date', dateRange: 'this_quarter' }] },
        CTX,
      );
      expect(result.drillRanges).toEqual([{ close_date: { field: 'close_date', gte: '2026-07-01', lt: '2026-10-01' } }]);
    });

    it('UTC resolves a datetime window at UTC midnight', async () => {
      const result = await service([{ stage: 'won', cnt: 3 }], 'datetime').queryDataset(
        pipeline,
        { dimensions: ['stage'], measures: ['cnt'], timeDimensions: [{ dimension: 'close_date', dateRange: 'this_quarter' }] },
        CTX,
      );
      expect(result.drillRanges).toEqual([
        { close_date: { field: 'close_date', gte: '2026-07-01T00:00:00.000Z', lt: '2026-10-01T00:00:00.000Z' } },
      ]);
    });

    it('an unknown field type under a non-UTC zone gets no window entry, as it gets no bucket entry', async () => {
      const result = await service([{ stage: 'won', cnt: 3 }], undefined).queryDataset(
        pipeline,
        {
          dimensions: ['stage'],
          measures: ['cnt'],
          timeDimensions: [{ dimension: 'close_date', dateRange: 'this_quarter' }],
          timezone: SHANGHAI,
        },
        CTX,
      );
      expect(result.drillRanges).toBeUndefined();
    });

    it('compareTo is unchanged: the comparison column is computed as before, and the row drills the primary window', async () => {
      const calls: unknown[] = [];
      const svc = new AnalyticsService({
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        executeAggregate: async (_object: string, opts: { filter?: unknown }) => {
          calls.push(opts.filter);
          return calls.length === 1 ? [{ stage: 'won', cnt: 5 }] : [{ stage: 'won', cnt: 2 }];
        },
        sourceFieldMeta: (_o, f) => (f === 'close_date' ? { type: 'datetime' } : undefined),
      });
      const result = await svc.queryDataset(
        pipeline,
        {
          dimensions: ['stage'],
          measures: ['cnt'],
          timeDimensions: [{ dimension: 'close_date', dateRange: 'this_quarter' }],
          compareTo: { kind: 'previousPeriod' },
          timezone: SHANGHAI,
        },
        CTX,
      );
      expect(result.rows).toEqual([{ stage: 'won', cnt: 5, cnt__compare: 2 }]);
      expect(result.drillRanges).toEqual([{ close_date: { field: 'close_date', ...Q3_SHANGHAI } }]);
    });
  });
});

// ── The real engine: the drill list lists what the row counted ───────────────

const OBJECT = 'deal_27074';
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

/**
 * Deals either side of each edge of Q3 2026, in Shanghai and in UTC. Shanghai
 * is UTC+8 with no DST, so its July midnight is `2026-06-30T16:00Z`.
 */
const DEALS: Array<{ id: string; stage: string; closed_at: string; close_on: string }> = [
  { id: 'd1', stage: 'won', closed_at: '2026-06-30T15:59:59.000Z', close_on: '2026-06-30' }, // Shanghai Jun 30 23:59
  { id: 'd2', stage: 'won', closed_at: '2026-06-30T16:00:00.000Z', close_on: '2026-07-01' }, // Shanghai Jul 1 00:00
  { id: 'd3', stage: 'won', closed_at: '2026-07-15T08:00:00.000Z', close_on: '2026-07-15' },
  { id: 'd4', stage: 'lost', closed_at: '2026-09-30T15:59:59.000Z', close_on: '2026-09-30' }, // Shanghai Sep 30 23:59
  { id: 'd5', stage: 'lost', closed_at: '2026-09-30T16:00:00.000Z', close_on: '2026-10-01' }, // Shanghai Oct 1 00:00
  { id: 'd6', stage: 'won', closed_at: '2026-08-10T02:00:00.000Z', close_on: '2026-08-10' },
  { id: 'd7', stage: 'lost', closed_at: '2026-01-05T02:00:00.000Z', close_on: '2026-01-05' },
];

const deals = DatasetSchema.parse({
  name: 'deals_27074', label: 'Deals', object: OBJECT, include: [],
  dimensions: [
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'closed', field: 'closed_at', type: 'date', dateGranularity: 'month' },
    { name: 'closed_on', field: 'close_on', type: 'date', dateGranularity: 'month' },
  ],
  measures: [{ name: 'cnt', aggregate: 'count' }],
});

describe('#27074 — on a real engine, each row drill lists exactly the records the row counted', () => {
  let engine: ObjectQL;
  const faces: Record<'native' | 'objectql', AnalyticsService> = {} as never;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Deal',
      fields: {
        stage: { name: 'stage', type: 'text' },
        closed_at: { name: 'closed_at', type: 'datetime' },
        close_on: { name: 'close_on', type: 'date' },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const d of DEALS) await engine.insert(OBJECT, { ...d } as never);
    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
        getService: (name: string) => (name === 'data' ? engine : registered[name]),
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      faces[face] = registered.analytics as AnalyticsService;
    }
  });
  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /** The ids the drill list for row `i` lists: the row's raw values ANDed with every range, by field. */
  async function drilled(answer: Awaited<ReturnType<AnalyticsService['queryDataset']>>, i: number): Promise<string[]> {
    const where: Record<string, unknown> = {};
    for (const [dim, field] of Object.entries(answer.dimensionFields ?? {})) where[field] = answer.drillRawRows![i][dim];
    for (const r of Object.values(answer.drillRanges?.[i] ?? {})) where[r.field] = { $gte: r.gte, $lt: r.lt };
    const rows = (await engine.find(OBJECT, { where, fields: ['id'] } as never)) as Array<{ id: string }>;
    return rows.map((r) => r.id).sort();
  }

  /** `null`: parity only, the ids the query itself counts being another card's question. */
  const cases: Array<[string, Record<string, unknown>, Record<string, string[]> | null]> = [
    [
      'stage × this_quarter on the datetime field, Shanghai',
      { dimensions: ['stage'], timeDimensions: [{ dimension: 'closed', dateRange: 'this_quarter' }], timezone: SHANGHAI },
      { won: ['d2', 'd3', 'd6'], lost: ['d4'] },
    ],
    [
      'stage × an explicit bare-day window on the datetime field, Shanghai',
      { dimensions: ['stage'], timeDimensions: [{ dimension: 'closed', dateRange: ['2026-07-01', '2026-09-30'] }], timezone: SHANGHAI },
      // The explicit arm keeps the engine's UTC calendar day (ADR-0053 D-D):
      // d2 is Shanghai's July but UTC's June, d5 the other way round.
      { won: ['d3', 'd6'], lost: ['d4', 'd5'] },
    ],
    [
      'month buckets × last_30_days on the datetime field, Shanghai',
      { dimensions: ['closed'], timeDimensions: [{ dimension: 'closed', dateRange: 'last_30_days' }], timezone: SHANGHAI },
      { '2026-08': ['d6'] },
    ],
    [
      'stage × this_quarter on the date field, UTC',
      { dimensions: ['stage'], timeDimensions: [{ dimension: 'closed_on', dateRange: 'this_quarter' }] },
      { won: ['d2', 'd3', 'd6'], lost: ['d4'] },
    ],
    [
      // The query compares a `date` column with the preset's Shanghai-midnight
      // instants read as their leading UTC day (`temporalStorageForm`), so it
      // counts June 30 and not September 30 (measured, both strategies). The
      // drill reports that same storage-form window, so it lists what the row
      // counted; which days the query should count is not this card's.
      'stage × this_quarter on the date field, Shanghai',
      { dimensions: ['stage'], timeDimensions: [{ dimension: 'closed_on', dateRange: 'this_quarter' }], timezone: SHANGHAI },
      null,
    ],
  ];

  for (const face of ['native', 'objectql'] as const) {
    for (const [label, selection, expected] of cases) {
      it(`${label} (${face})`, async () => {
        const answer = await faces[face].queryDataset(deals, { measures: ['cnt'], ...selection } as never, CTX);
        const counted: Record<string, number> = {};
        const listed: Record<string, string[]> = {};
        for (const [i, row] of answer.rows.entries()) {
          const key = String(row[(selection.dimensions as string[])[0]]);
          counted[key] = Number(row.cnt);
          listed[key] = await drilled(answer, i);
        }
        expect(Object.keys(counted).length).toBeGreaterThan(0);
        expect(Object.fromEntries(Object.entries(listed).map(([k, ids]) => [k, ids.length]))).toEqual(counted);
        if (expected) expect(listed).toEqual(expected);
      });
    }
  }
});
