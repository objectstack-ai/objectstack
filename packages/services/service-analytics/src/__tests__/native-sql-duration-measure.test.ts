// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25778] The dataset duration measure on the native-SQL face, as statements,
 * and on the service's gates.
 *
 * `dataset-duration-measure.test.ts` measures the numbers on live SQLite and
 * PostgreSQL. This file pins what that cannot reach: the statement per dialect
 * (MySQL included, which has no live cell in this package), the routing on a
 * dialect nobody named, the presentation of a client's string answer, the
 * draft-preview evaluator, and the service gates a duration measure passes
 * through — the field-level read gate, the measure mint, the inline-dataset
 * door and the compile guards for a dataset that reaches the service unparsed.
 */

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import type { DatasetScope, DurationMeasureSpec } from '../strategies/types.js';
import { durationMeasureIn } from '../duration-measure-sql.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';

const OBJECT = 'ticket';

const CUBE: Cube = {
  name: 'tickets',
  sql: OBJECT,
  measures: { n: { label: 'Rows', type: 'count', sql: '*' } },
  dimensions: { category: { label: 'Category', type: 'string', sql: 'category' } },
  joins: { owner: { name: 'owner_obj', relationship: 'many_to_one', sql: 'owner' } },
  public: true,
} as unknown as Cube;

const AVG_HOURS: DurationMeasureSpec = { aggregate: 'avg', from: 'opened_at', to: 'resolved_at', unit: 'hours' };
const TOTAL_SECONDS: DurationMeasureSpec = { aggregate: 'sum', from: 'opened_at', to: 'resolved_at', unit: 'seconds' };

const SCOPE: DatasetScope = {
  measureDurations: { avg_hours: AVG_HOURS, total_seconds: TOTAL_SECONDS },
  measureFilters: { total_seconds: { priority: 'high' } },
};

function nativeCtx(knobs: {
  dialect?: string;
  rows?: Record<string, unknown>[];
  coerce?: (object: string, field: string, col: string) => string;
} = {}): StrategyContext {
  return {
    getCube: (name: string) => (name === CUBE.name ? CUBE : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    executeRawSql: async () => knobs.rows ?? [],
    getDatasetScope: () => SCOPE,
    ...(knobs.dialect ? { sqlDialect: () => knobs.dialect } : {}),
    ...(knobs.coerce ? { coerceTemporalFilterColumn: knobs.coerce } : {}),
  } as unknown as StrategyContext;
}

const q = (extra: Partial<AnalyticsQuery> = {}): AnalyticsQuery =>
  ({ cube: CUBE.name, measures: ['avg_hours', 'total_seconds'], dimensions: ['category'], ...extra }) as AnalyticsQuery;

describe('[#25778] NativeSQLStrategy — the duration measure as a statement', () => {
  const native = new NativeSQLStrategy();

  it.each([
    [
      'sqlite',
      'AVG(((ROUND((julianday(resolved_at) - julianday(opened_at)) * 86400000.0) / 1000.0) / 3600.0)) AS "avg_hours"',
      'SUM(CASE WHEN priority = $1 THEN (ROUND((julianday(resolved_at) - julianday(opened_at)) * 86400000.0) / 1000.0) END) AS "total_seconds"',
    ],
    [
      'postgres',
      'AVG((CAST(EXTRACT(EPOCH FROM (resolved_at - opened_at)) AS DOUBLE PRECISION) / 3600.0)) AS "avg_hours"',
      'SUM(CASE WHEN priority = $1 THEN CAST(EXTRACT(EPOCH FROM (resolved_at - opened_at)) AS DOUBLE PRECISION) END) AS "total_seconds"',
    ],
    [
      'mysql',
      'AVG(((TIMESTAMPDIFF(MICROSECOND, opened_at, resolved_at) / 1.0E6) / 3600.0)) AS "avg_hours"',
      'SUM(CASE WHEN priority = $1 THEN (TIMESTAMPDIFF(MICROSECOND, opened_at, resolved_at) / 1.0E6) END) AS "total_seconds"',
    ],
  ])('%s: the per-dialect difference, divided by the unit, under the aggregate and its measure filter', async (dialect, avg, filteredSum) => {
    const { sql, params } = await native.generateSql(q(), nativeCtx({ dialect }));
    expect(sql).toBe(`SELECT category AS "category", ${avg}, ${filteredSum} FROM "${OBJECT}" GROUP BY category`);
    expect(params).toEqual(['high']);
  });

  it('a statement that joins qualifies both columns with the base table', async () => {
    const { sql } = await native.generateSql(q({ measures: ['avg_hours'], dimensions: ['owner.region'] }), nativeCtx({ dialect: 'postgres' }));
    expect(sql).toContain(`EXTRACT(EPOCH FROM ("${OBJECT}"."resolved_at" - "${OBJECT}"."opened_at"))`);
    expect(sql).toContain('LEFT JOIN "owner_obj" "owner"');
  });

  it('each column reads through the host\'s temporal repair, as a filter on it does', async () => {
    const seen: string[] = [];
    const coerce = (object: string, field: string, col: string) => {
      seen.push(`${object}.${field}`);
      return `canon(${col})`;
    };
    const { sql } = await native.generateSql(q({ measures: ['avg_hours'] }), nativeCtx({ dialect: 'sqlite', coerce }));
    expect(sql).toContain('julianday(canon(resolved_at)) - julianday(canon(opened_at))');
    expect(seen).toEqual([`${OBJECT}.opened_at`, `${OBJECT}.resolved_at`]);
  });

  it('declines a duration measure on a dialect nobody named, and only then', () => {
    expect(native.canHandle(q(), nativeCtx())).toBe(false);
    expect(native.canHandle(q(), nativeCtx({ dialect: 'oracle' }))).toBe(false);
    expect(native.canHandle(q({ measures: ['n'] }), nativeCtx()), 'CONTROL a query with no duration measure').toBe(true);
    for (const dialect of ['sqlite', 'postgres', 'mysql']) expect(native.canHandle(q(), nativeCtx({ dialect })), dialect).toBe(true);
  });

  it('presents a client string as a number, and folds an empty sum to 0 while an empty avg stays null', async () => {
    const rows = [
      { category: 'a', avg_hours: '12.75', total_seconds: '91800' },
      { category: 'c', avg_hours: null, total_seconds: null },
    ];
    const res = await native.execute(q(), nativeCtx({ dialect: 'postgres', rows }));
    expect(res.rows).toEqual([
      { category: 'a', avg_hours: 12.75, total_seconds: 91800 },
      { category: 'c', avg_hours: null, total_seconds: 0 },
    ]);
    expect(res.fields).toEqual([
      { name: 'category', type: 'string' },
      { name: 'avg_hours', type: 'number' },
      { name: 'total_seconds', type: 'number' },
    ]);
  });

  it('a measure is a duration only by an own key: a name on Object.prototype is never one', () => {
    expect(durationMeasureIn(SCOPE.measureDurations, 'avg_hours')).toBe(AVG_HOURS);
    expect(durationMeasureIn(SCOPE.measureDurations, 'constructor')).toBeUndefined();
    expect(durationMeasureIn(SCOPE.measureDurations, 'toString')).toBeUndefined();
    expect(durationMeasureIn(undefined, 'avg_hours')).toBeUndefined();
  });
});

describe('[#25778] the draft preview computes a duration measure from the rows', () => {
  const rows = [
    { category: 'a', opened_at: '2026-03-01T08:00:00.000Z', resolved_at: '2026-03-01T09:30:00.000Z' },
    { category: 'a', opened_at: '2026-03-02T10:00:00.000Z', resolved_at: '2026-03-03T10:00:00.000Z' },
    { category: 'a', opened_at: '2026-03-04T00:00:00.000Z', resolved_at: null },
    { category: 'b', opened_at: '2026-03-05T12:00:00.250Z', resolved_at: '2026-03-05T12:00:01.000Z' },
    { category: 'c', opened_at: null, resolved_at: '2026-03-07T00:00:00.000Z' },
  ];
  const durations = {
    avg_hours: AVG_HOURS,
    total_seconds: TOTAL_SECONDS,
    fastest_minutes: { ...AVG_HOURS, aggregate: 'min', unit: 'minutes' },
    slowest_days: { ...AVG_HOURS, aggregate: 'max', unit: 'days' },
  } satisfies Record<string, DurationMeasureSpec>;

  it('the native face\'s numbers over the same rows, nulls excluded', () => {
    const res = evaluateAnalyticsQueryOverRows(
      { cube: CUBE.name, measures: Object.keys(durations), dimensions: ['category'] } as AnalyticsQuery,
      CUBE,
      rows,
      undefined,
      durations,
    );
    expect(res.rows).toEqual([
      { category: 'a', avg_hours: 12.75, total_seconds: 91800, fastest_minutes: 90, slowest_days: 1 },
      { category: 'b', avg_hours: 0.75 / 3600, total_seconds: 0.75, fastest_minutes: 0.75 / 60, slowest_days: 0.75 / 86400 },
      { category: 'c', avg_hours: null, total_seconds: 0, fastest_minutes: null, slowest_days: null },
    ]);
  });
});

// ── The service's gates ─────────────────────────────────────────────────────

const FIELDS = ['id', 'category', 'priority', 'opened_at', 'resolved_at', 'effort'];
const MEMBER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;

const DATASET_BASE = {
  name: 'resolution',
  label: 'Resolution',
  object: OBJECT,
  dimensions: [{ name: 'category', field: 'category', type: 'string' }],
  measures: [
    { name: 'tickets', aggregate: 'count' },
    // A name the suffix mint would read as `sum(resolution_seconds)`.
    { name: 'resolution_seconds_sum', aggregate: 'sum', duration: { from: 'opened_at', to: 'resolved_at', unit: 'seconds' } },
  ],
};

function makeService(opts: {
  capabilities?: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };
  readable?: readonly string[];
  draftRows?: Record<string, unknown>[];
} = {}) {
  const executed: string[] = [];
  const service = new AnalyticsService({
    queryCapabilities: opts.capabilities ?? (() => ({ nativeSql: true, objectqlAggregate: true, inMemory: false })),
    getObjectFieldNames: (object: string) => (object === OBJECT ? FIELDS : undefined),
    sourceFieldMeta: (object: string, field: string) =>
      object === OBJECT && FIELDS.includes(field)
        ? { type: field.endsWith('_at') ? 'datetime' : field === 'effort' ? 'number' : 'text' }
        : undefined,
    sqlDialect: () => 'sqlite',
    ...(opts.readable ? { getReadableFields: () => opts.readable } : {}),
    ...(opts.draftRows ? { draftRowsResolver: async () => opts.draftRows } : {}),
    executeRawSql: async (_object: string, sql: string) => {
      executed.push(sql);
      return [];
    },
    executeAggregate: async (object: string) => {
      executed.push(`aggregate:${object}`);
      return [];
    },
  } as never);
  return { service, executed };
}

type Refusal = Error & { code?: string; status?: number; member?: string };
const refusalOf = (run: Promise<unknown>) => run.then(() => undefined, (e: Refusal) => e);

describe('[#25778] AnalyticsService — the gates a duration measure passes through', () => {
  const dataset = DatasetSchema.parse(DATASET_BASE);

  it('is served as a duration, never minted from its name by the suffix rule', async () => {
    const { service, executed } = makeService();
    await service.queryDataset(dataset, { measures: ['resolution_seconds_sum'], dimensions: ['category'] } as never, MEMBER);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain('SUM((ROUND((julianday(resolved_at) - julianday(opened_at))');
    expect(executed[0]).not.toContain('SUM(resolution_seconds)');
  });

  it('the field-level read gate judges both columns: an unreadable one refuses the measure, nothing runs', async () => {
    const { service, executed } = makeService({ readable: FIELDS.filter((f) => f !== 'resolved_at') });
    const err = await refusalOf(service.queryDataset(dataset, { measures: ['resolution_seconds_sum'], dimensions: ['category'] } as never, MEMBER));
    expect(err?.code, err?.message).toBe('PERMISSION_DENIED');
    expect(err?.status).toBe(403);
    expect(err?.message).toContain('resolved_at');
    expect(executed).toEqual([]);

    const control = makeService({ readable: FIELDS });
    await control.service.queryDataset(dataset, { measures: ['resolution_seconds_sum'], dimensions: ['category'] } as never, MEMBER);
    expect(control.executed).toHaveLength(1);
  });

  it('the dry-run door refuses it off the native strategy too', async () => {
    const { service } = makeService({ capabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) });
    service.registerDataset(dataset);
    const err = await refusalOf(service.generateSql({ cube: dataset.name, measures: ['resolution_seconds_sum'], dimensions: ['category'] } as never, MEMBER));
    expect(err?.code, err?.message).toBe('INVALID_FIELD');
    expect(err?.status).toBe(400);
    expect(err?.member).toBe('resolution_seconds_sum');
  });

  it('the draft preview serves it over the drafted rows', async () => {
    const draftRows = [
      { category: 'a', opened_at: '2026-03-01T08:00:00.000Z', resolved_at: '2026-03-01T09:30:00.000Z' },
      { category: 'a', opened_at: '2026-03-02T10:00:00.000Z', resolved_at: null },
    ];
    const { service, executed } = makeService({ draftRows });
    const res = await service.queryDataset(dataset, { measures: ['resolution_seconds_sum'], dimensions: ['category'] } as never, MEMBER, { previewDrafts: true });
    expect(res.rows).toEqual([{ category: 'a', resolution_seconds_sum: 5400 }]);
    expect(executed).toEqual([]);
  });

  it('a dimension sharing its name does not hide its columns from the read gate', async () => {
    const shadowed = DatasetSchema.parse({
      ...DATASET_BASE,
      dimensions: [...DATASET_BASE.dimensions, { name: 'resolution_seconds_sum', field: 'category', type: 'string' }],
    });
    const { service, executed } = makeService({ readable: FIELDS.filter((f) => f !== 'resolved_at') });
    const err = await refusalOf(service.queryDataset(shadowed, { measures: ['resolution_seconds_sum'], dimensions: ['category'] } as never, MEMBER));
    expect(err?.code, err?.message).toBe('PERMISSION_DENIED');
    expect(err?.status).toBe(403);
    expect(err?.message).toContain('resolved_at');
    expect(executed).toEqual([]);
  });

  describe('on the cube door, under the `<cube>.<name>` spelling the discovery surface lists', () => {
    const listed = DatasetSchema.parse({
      ...DATASET_BASE,
      measures: [
        ...DATASET_BASE.measures,
        {
          name: 'high_hours',
          label: 'High-priority hours',
          aggregate: 'avg',
          format: '0.0',
          filter: { priority: 'high' },
          duration: { from: 'opened_at', to: 'resolved_at', unit: 'hours' },
        },
      ],
    });

    it('getMeta lists each duration measure with its aggregate, label and format', async () => {
      const { service } = makeService();
      service.registerDataset(listed);
      const [meta] = await service.getMeta(listed.name);
      expect(meta.measures.filter((m) => m.name !== `${listed.name}.tickets`)).toEqual([
        { name: 'resolution.resolution_seconds_sum', type: 'sum', title: 'resolution_seconds_sum' },
        { name: 'resolution.high_hours', type: 'avg', title: 'High-priority hours', format: '0.0' },
      ]);
    });

    it('the listed spelling is served as the bare one, its scoped filter included, under the name asked', async () => {
      const { service, executed } = makeService();
      service.registerDataset(listed);
      await service.query({ cube: listed.name, measures: ['resolution.high_hours'], dimensions: ['category'] } as never, MEMBER);
      expect(executed).toHaveLength(1);
      expect(executed[0]).toContain('AVG(CASE WHEN priority = $1 THEN ((ROUND((julianday(resolved_at) - julianday(opened_at))');
      expect(executed[0]).toContain('AS "resolution.high_hours"');
    });

    it('the read gate and the strategy refusal know the listed spelling too', async () => {
      const gated = makeService({ readable: FIELDS.filter((f) => f !== 'opened_at') });
      gated.service.registerDataset(listed);
      const denied = await refusalOf(gated.service.query({ cube: listed.name, measures: ['resolution.high_hours'] } as never, MEMBER));
      expect(denied?.code, denied?.message).toBe('PERMISSION_DENIED');
      expect(denied?.status).toBe(403);
      expect(gated.executed).toEqual([]);

      const offNative = makeService({ capabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) });
      offNative.service.registerDataset(listed);
      const refused = await refusalOf(offNative.service.query({ cube: listed.name, measures: ['resolution.high_hours'] } as never, MEMBER));
      expect(refused?.code, refused?.message).toBe('INVALID_FIELD');
      expect(refused?.status).toBe(400);
      expect(refused?.member).toBe('resolution.high_hours');
      expect(offNative.executed).toEqual([]);
    });
  });

  it('a field-to-field filter routes the query off the native strategy, and the measure is refused by name', async () => {
    const { service, executed } = makeService();
    service.registerDataset(dataset);
    const err = await refusalOf(
      service.query({
        cube: dataset.name,
        measures: ['resolution_seconds_sum'],
        where: { resolved_at: { $gt: { $field: 'opened_at' } } },
      } as never, MEMBER),
    );
    expect(err?.code, err?.message).toBe('INVALID_FIELD');
    expect(err?.status).toBe(400);
    expect(err?.member).toBe('resolution_seconds_sum');
    expect(executed).toEqual([]);
  });

  describe('a dataset that reaches the service without meeting the spec\'s parse', () => {
    const stored = (duration: Record<string, unknown>) => ({
      ...DATASET_BASE,
      measures: [{ name: 'leaked', aggregate: 'avg', duration }],
    });

    it('the spec refuses each of these shapes at parse', () => {
      for (const duration of [
        { from: '(SELECT secret FROM other)', to: 'resolved_at', unit: 'hours' },
        { from: 'owner.created_at', to: 'resolved_at', unit: 'hours' },
        { from: 'opened_at', to: 'resolved_at', unit: 'weeks' },
      ]) {
        expect(DatasetSchema.safeParse(stored(duration)).success, JSON.stringify(duration)).toBe(false);
      }
    });

    it('text that is no column reference is refused at the door: PERMISSION_DENIED / 403, nothing runs', async () => {
      const { service, executed } = makeService();
      const err = await refusalOf(
        service.queryDataset(stored({ from: '(SELECT secret FROM other)', to: 'resolved_at', unit: 'hours' }) as never, { measures: ['leaked'] } as never, MEMBER),
      );
      expect(err?.code, err?.message).toBe('PERMISSION_DENIED');
      expect(err?.status).toBe(403);
      expect(err?.member).toBe('leaked');
      expect(err?.message).not.toContain('SELECT');
      expect(executed).toEqual([]);
    });

    it.each([
      [{ from: 'owner.created_at', to: 'resolved_at', unit: 'hours' }, '`duration.from` "owner.created_at", which names no column'],
      [{ from: 'opened_at', unit: 'hours' }, '`duration.to` undefined, which names no column'],
      [{ from: 'opened_at', to: 'resolved_at', unit: 'weeks' }, '`duration.unit` seconds / minutes / hours / days; it declares "weeks"'],
    ])('%j is refused at compile: DATASET_INVALID / 400, nothing runs', async (duration, words) => {
      const { service, executed } = makeService();
      const err = await refusalOf(service.queryDataset(stored(duration) as never, { measures: ['leaked'] } as never, MEMBER));
      expect(err?.code, err?.message).toBe('DATASET_INVALID');
      expect(err?.status).toBe(400);
      expect(err?.message).toContain(words);
      expect(executed).toEqual([]);
      // The configuration door compiles through the same guard.
      expect(() => service.registerDataset(stored(duration) as never)).toThrow(words);
    });
  });
});
