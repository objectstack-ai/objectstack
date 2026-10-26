// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25906] A filtered dataset measure asked on the cube door as `CUBE.MEASURE`,
 * the name `getMeta` lists it under, answers exactly what the bare name does:
 * its scoped filter included, on every reader of `DatasetScope.measureFilters`.
 *
 * The member itself always resolved under both spellings (`lookupMember` strips
 * the `<cube>.` qualifier), but each reader of the measure's filter looked it up
 * by the spelling as asked, so the qualified one missed. Measured on `main`
 * `05f7758f`, native SQL (SQLite dialect), the dataset below:
 *
 * ```
 * measures: ['won_amount']        → SUM(CASE WHEN stage = $1 THEN amount END) AS "won_amount"
 * measures: ['sales.won_amount']  → SUM(amount) AS "sales.won_amount"
 * ```
 *
 * the total of every deal under the won-deals measure's name, with no error.
 * The ObjectQL face dropped the aggregation's `filter` the same way, and the
 * field-level read gate never judged the filter's fields, so a caller who may
 * not read `stage` was refused the bare spelling and answered the qualified one.
 *
 * Every reader now resolves the filter through `scopedMeasureKey`, the one rule
 * the duration measure's lookup (`durationMeasureKey`) already used. The
 * `DatasetExecutor` path is not here: it builds bare names.
 */

import { describe, it, expect } from 'vitest';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { scopedMeasureKey } from '../scoped-measure-key.js';

const OBJECT = 'deal';
const FIELDS = ['id', 'region', 'stage', 'amount'];
const MEMBER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;

const DATASET = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: OBJECT,
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [
    { name: 'deals', aggregate: 'count' },
    { name: 'won_amount', aggregate: 'sum', field: 'amount', filter: { stage: 'won' } },
  ],
});

type Aggregation = { field: string; method: string; alias: string; filter?: Record<string, unknown> };

function makeService(opts: { native?: boolean; readable?: readonly string[] } = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const aggregations: Aggregation[][] = [];
  const service = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: opts.native ?? true, objectqlAggregate: true, inMemory: false }),
    getObjectFieldNames: (object: string) => (object === OBJECT ? FIELDS : undefined),
    sourceFieldMeta: (object: string, field: string) =>
      object === OBJECT && FIELDS.includes(field) ? { type: field === 'amount' ? 'number' : 'text' } : undefined,
    sqlDialect: () => 'sqlite',
    ...(opts.readable ? { getReadableFields: () => opts.readable } : {}),
    executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
      statements.push({ sql, params });
      return [];
    },
    executeAggregate: async (_object: string, options: { aggregations?: Aggregation[] }) => {
      aggregations.push(options.aggregations ?? []);
      return [];
    },
  } as never);
  service.registerDataset(DATASET);
  return { service, statements, aggregations };
}

type Refusal = Error & { code?: string; status?: number };
const refusalOf = (run: Promise<unknown>) => run.then(() => undefined, (e: Refusal) => e);
const ask = (measure: string) => ({ cube: DATASET.name, measures: [measure], dimensions: ['region'] }) as never;

describe('[#25906] the cube door answers `CUBE.MEASURE` as the bare measure, its scoped filter included', () => {
  it('native SQL: the same conditional aggregate and the same bound value, under the name asked', async () => {
    const { service, statements } = makeService();
    await service.query(ask('won_amount'), MEMBER);
    await service.query(ask('sales.won_amount'), MEMBER);
    expect(statements).toHaveLength(2);
    const [bare, qualified] = statements;
    expect(bare.sql).toContain('CASE WHEN stage = $1 THEN amount END');
    expect(qualified.sql).toBe(bare.sql.replace('AS "won_amount"', 'AS "sales.won_amount"'));
    expect(qualified.params).toEqual(bare.params);
    expect(qualified.params).toEqual(['won']);
  });

  it('ObjectQL: the aggregation carries the measure\'s filter under both spellings', async () => {
    const { service, aggregations } = makeService({ native: false });
    await service.query(ask('won_amount'), MEMBER);
    await service.query(ask('sales.won_amount'), MEMBER);
    expect(aggregations).toHaveLength(2);
    const [[bare], [qualified]] = aggregations;
    expect(bare.filter).toBeDefined();
    expect(qualified).toEqual({ ...bare, alias: 'sales.won_amount' });
  });

  it('ObjectQL dry run: the echoed statement renders the conditional aggregate under both spellings', async () => {
    const { service } = makeService({ native: false });
    const bare = await service.generateSql(ask('won_amount'), MEMBER);
    const qualified = await service.generateSql(ask('sales.won_amount'), MEMBER);
    expect(bare.sql).toContain('stage');
    expect(qualified.sql).toBe(bare.sql.replace('AS "won_amount"', 'AS "sales.won_amount"'));
    expect(qualified.params).toEqual(bare.params);
  });

  it('the field-level read gate judges the filter\'s fields under both spellings: unreadable `stage` refuses both, nothing runs', async () => {
    for (const measure of ['won_amount', 'sales.won_amount']) {
      const gated = makeService({ readable: FIELDS.filter((f) => f !== 'stage') });
      const err = await refusalOf(gated.service.query(ask(measure), MEMBER));
      expect({ code: err?.code, status: err?.status }, `${measure}: ${err?.message}`).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
      expect(err?.message).toContain('stage');
      expect(gated.statements, measure).toEqual([]);

      const control = makeService({ readable: FIELDS });
      await control.service.query(ask(measure), MEMBER);
      expect(control.statements, measure).toHaveLength(1);
    }
  });
});

describe('[#25906] NativeSQLStrategy routes on the qualified measure\'s filter as on the bare one', () => {
  const CUBE: Cube = {
    name: 'ledger',
    sql: 'nested_ledger',
    measures: {
      row_count: { label: 'Rows', type: 'count', sql: '*' },
      na_count: { label: 'NA rows', type: 'count', sql: '*' },
    },
    dimensions: { title: { label: 'Title', type: 'string', sql: 'title' } },
    joins: { owner: { name: 'nested_owner', relationship: 'many_to_one', sql: 'owner' } },
    public: true,
  } as unknown as Cube;
  const NESTED: FilterCondition = { owner: { region: 'NA' } };
  const ctx = {
    getCube: (name: string) => (name === CUBE.name ? CUBE : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    executeRawSql: async () => [],
    getDatasetScope: () => ({ measureFilters: { na_count: NESTED } }),
  } as unknown as StrategyContext;
  const q = (measure: string) => ({ cube: CUBE.name, measures: ['row_count', measure], dimensions: ['title'] }) as AnalyticsQuery;

  it('declines a nested-relation condition in the requested measure\'s filter, asked either way', () => {
    const native = new NativeSQLStrategy();
    expect(native.canHandle(q('na_count'), ctx)).toBe(false);
    expect(native.canHandle(q('ledger.na_count'), ctx)).toBe(false);
  });
});

describe('[#25906] scopedMeasureKey', () => {
  const record = { won_amount: 1 };

  it('the bare name, then the name under its own cube\'s qualifier; never another prefix', () => {
    expect(scopedMeasureKey(record, 'won_amount', 'sales')).toBe('won_amount');
    expect(scopedMeasureKey(record, 'sales.won_amount', 'sales')).toBe('won_amount');
    expect(scopedMeasureKey(record, 'other.won_amount', 'sales')).toBeUndefined();
    expect(scopedMeasureKey(record, 'sales.won_amount')).toBeUndefined();
    expect(scopedMeasureKey(undefined, 'won_amount', 'sales')).toBeUndefined();
  });

  it('an own key only: a name on Object.prototype keys nothing', () => {
    expect(scopedMeasureKey(record, 'constructor', 'sales')).toBeUndefined();
    expect(scopedMeasureKey(record, 'sales.toString', 'sales')).toBeUndefined();
  });
});
