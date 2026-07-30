// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A measure emits what it declares (#4157).
 *
 * `resolveMeasureSql` answered `COUNT(*)` to three questions it could not
 * otherwise answer, each time aliased under the name the caller asked for:
 *
 *   1. a measure the cube does not declare — a typo returned a row count;
 *   2. a `number`/`string`/`boolean` metric — a custom SQL *expression*, per
 *      `AggregationMetricType` — whose expression was discarded;
 *   3. an unrecognised `type`.
 *
 * And `qualifyAndRegisterJoin` treated any dot as a relationship hop, so an
 * expression like `SUM(account.amount)` was split into `"SUM(account"."amount)"`
 * plus a `LEFT JOIN "SUM(account"` — invalid SQL naming a table that does not
 * exist. That damage was invisible while the result was thrown away for
 * `COUNT(*)`; emitting the expression makes it matter.
 */
import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

/** A cube whose measures cover both aggregate and custom-expression types. */
const cube: Cube = {
  name: 'orders',
  title: 'Orders',
  sql: 'orders',
  measures: {
    count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
    total: { name: 'total', label: 'Total', type: 'sum', sql: 'amount' },
    // The three custom-expression types. `sql` IS the computation.
    margin: {
      name: 'margin', label: 'Margin', type: 'number',
      sql: 'SUM(revenue) / NULLIF(SUM(cost), 0)',
    },
    top_status: {
      name: 'top_status', label: 'Top status', type: 'string',
      sql: "MAX(CASE WHEN paid THEN 'paid' ELSE 'open' END)",
    },
    any_paid: { name: 'any_paid', label: 'Any paid', type: 'boolean', sql: 'MAX(paid)' },
  },
  dimensions: {
    status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
  },
} as never;

const ctx = {
  getCube: () => cube,
  queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
  executeRawSql: async () => [],
} as never;

const sqlFor = async (query: AnalyticsQuery) =>
  (await new NativeSQLStrategy().generateSql(query, ctx)).sql;

describe('custom-expression measures emit their expression', () => {
  it('emits a number expression verbatim, ungrouped', async () => {
    const sql = await sqlFor({ cube: 'orders', measures: ['margin'] });
    expect(sql).toContain('SUM(revenue) / NULLIF(SUM(cost), 0) AS "margin"');
    expect(sql).not.toContain('COUNT(*)');
  });

  it('emits a number expression verbatim in a grouped query', async () => {
    const sql = await sqlFor({ cube: 'orders', measures: ['margin'], dimensions: ['status'] });
    expect(sql).toContain('SUM(revenue) / NULLIF(SUM(cost), 0) AS "margin"');
    expect(sql).toContain('GROUP BY');
    // Measures never join GROUP BY — only dimensions do. The expression must
    // therefore be aggregate-shaped, which is the author's contract.
    expect(sql.slice(sql.indexOf('GROUP BY'))).not.toContain('NULLIF');
  });

  it('emits string and boolean expressions verbatim', async () => {
    const sql = await sqlFor({ cube: 'orders', measures: ['top_status', 'any_paid'] });
    expect(sql).toContain(`MAX(CASE WHEN paid THEN 'paid' ELSE 'open' END) AS "top_status"`);
    expect(sql).toContain('MAX(paid) AS "any_paid"');
  });

  it('still wraps the aggregate types', async () => {
    const sql = await sqlFor({ cube: 'orders', measures: ['count', 'total'] });
    expect(sql).toContain('COUNT(*) AS "count"');
    expect(sql).toContain('SUM(amount) AS "total"');
  });
});

describe('an expression containing a dot is not mistaken for a join path', () => {
  const dotted: Cube = {
    ...cube,
    joins: { account: { name: 'account', relationship: 'belongsTo', sql: '' } },
    measures: {
      ...cube.measures,
      // A dot inside a function call — an expression, not `relation.column`.
      acct_total: {
        name: 'acct_total', label: 'Account total', type: 'number',
        sql: 'SUM(account.amount) / 2',
      },
      // A genuine relationship path, which MUST still be qualified and joined.
      acct_amount: { name: 'acct_amount', label: 'Account amount', type: 'sum', sql: 'account.amount' },
    },
  } as never;
  const dottedCtx = { ...(ctx as object), getCube: () => dotted } as never;
  const dottedSql = async (q: AnalyticsQuery) =>
    (await new NativeSQLStrategy().generateSql(q, dottedCtx)).sql;

  it('emits the expression intact and registers no phantom join', async () => {
    const sql = await dottedSql({ cube: 'orders', measures: ['acct_total'] });
    expect(sql).toContain('SUM(account.amount) / 2 AS "acct_total"');
    expect(sql).not.toContain('"SUM(account"');
    expect(sql).not.toContain('LEFT JOIN "SUM(account"');
  });

  it('still lowers a real relationship path into a qualified column and a join', async () => {
    const sql = await dottedSql({ cube: 'orders', measures: ['acct_amount'] });
    expect(sql).toContain('SUM("account"."amount") AS "acct_amount"');
    expect(sql).toContain('LEFT JOIN "account" ON "orders"."account" = "account"."id"');
  });
});

describe('the questions COUNT(*) used to answer now fail loudly', () => {
  it('throws for a measure the cube does not declare', async () => {
    await expect(sqlFor({ cube: 'orders', measures: ['revenue'] }))
      .rejects.toThrow(/declares no measure "revenue"/);
  });

  it('names the declared measures, so a typo is self-correcting', async () => {
    await expect(sqlFor({ cube: 'orders', measures: ['totl'] }))
      .rejects.toThrow(/declared: count, total, margin, top_status, any_paid/);
  });

  it('throws for an unrecognised metric type', async () => {
    const bad = {
      ...cube,
      measures: { weird: { name: 'weird', label: 'Weird', type: 'median', sql: 'amount' } },
    } as never;
    const badCtx = { ...(ctx as object), getCube: () => bad } as never;
    await expect(new NativeSQLStrategy().generateSql({ cube: 'orders', measures: ['weird'] }, badCtx))
      .rejects.toThrow(/unrecognised type "median"/);
  });

  it('the unrecognised-type error lists both vocabularies', async () => {
    const bad = {
      ...cube,
      measures: { weird: { name: 'weird', label: 'Weird', type: 'median', sql: 'amount' } },
    } as never;
    const badCtx = { ...(ctx as object), getCube: () => bad } as never;
    const err = await new NativeSQLStrategy()
      .generateSql({ cube: 'orders', measures: ['weird'] }, badCtx)
      .catch((e: Error) => e.message);
    expect(err).toContain('count_distinct');
    expect(err).toContain('number');
  });
});
