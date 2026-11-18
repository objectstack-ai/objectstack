// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [aggregate order and cut] `aggregate()` compiles the order-and-cut directive
 * the engine hands it (objectql `aggregate-order-cut.ts`) into its own
 * statement: the grouped statement as a derived table, `count(*) over ()` for
 * the groups it formed, and ORDER BY / LIMIT over the derived table's columns.
 *
 * Pinned here: the top N by a measure, in order, with the count of every group
 * before the cut (more groups than the cut, as a top-N over a large set asks);
 * an order by a group key; a `sum` whose group has no value ranks as the `0` it
 * is served as, in either direction; a NULL group key ranks last in either
 * direction; the cut inside the tenant wall and the `where`; the statement
 * itself carries the ORDER BY, the LIMIT and the window (a query spy, so an
 * in-application sort cannot pass); and a malformed directive, or one ordering
 * by a column the statement does not project, refused before anything runs.
 *
 * Every live cell runs where the suite provisions it (`OS_TEST_POSTGRES_URL`,
 * `OS_TEST_MYSQL_URL`); SQLite always runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';
import { AGGREGATE_ORDER_CUT_DIRECTIVE, type AggregateOrderCutDirective } from './sql-driver-aggregation.js';

const TABLE = 'os_agg_order_cut_order';
const COUNT_COLUMN = '__os_group_count';

/**
 * 60 customers `c00`..`c59` in org_a, each with two orders (`i * 10` and `5`),
 * so customer `cNN` totals `NN * 10 + 5`; `cnull` has one order with no amount
 * (its `sum` is NULL in SQL, served as `0`); one order has no customer (a NULL
 * group key); org_b holds a customer `cz` richer than all of them.
 */
function orders(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 60; i++) {
    const c = `c${String(i).padStart(2, '0')}`;
    rows.push({ id: `${c}-a`, customer: c, amount: i * 10, status: 'won', organization_id: 'org_a' });
    rows.push({ id: `${c}-b`, customer: c, amount: 5, status: i % 2 === 0 ? 'won' : 'lost', organization_id: 'org_a' });
  }
  rows.push({ id: 'n-1', customer: 'cnull', amount: null, status: 'won', organization_id: 'org_a' });
  rows.push({ id: 'k-1', customer: null, amount: 1, status: 'won', organization_id: 'org_a' });
  rows.push({ id: 'z-1', customer: 'cz', amount: 99999, status: 'won', organization_id: 'org_b' });
  return rows;
}

const REVENUE = [{ function: 'sum' as const, field: 'amount', alias: 'revenue' }];

const query = (directive: unknown, over: Partial<DriverQuery> = {}): DriverQuery => ({
  groupBy: ['customer'],
  aggregations: REVENUE,
  ...over,
  [AGGREGATE_ORDER_CUT_DIRECTIVE]: directive,
} as unknown as DriverQuery);

const cut = (
  orderBy: AggregateOrderCutDirective['orderBy'],
  limit?: number,
): AggregateOrderCutDirective => ({ orderBy, ...(limit !== undefined ? { limit } : {}), groupCountColumn: COUNT_COLUMN });

const customers = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.customer);

function declareCell(cell: DialectCell): void {
  describe(`[aggregate order and cut] driver-sql — aggregate orders, cuts and counts groups (${cell.label})`, () => {
    let driver: SqlDriver;
    const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;

    beforeAll(async () => {
      process.env.OS_TENANCY_POSTURE = 'isolated';
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        {
          name: TABLE,
          fields: {
            customer: { type: 'text' }, amount: { type: 'number' }, status: { type: 'text' },
            organization_id: { type: 'text' },
          },
        },
      ] as never);
      for (const row of orders()) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect?.();
      if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
    });

    it('the top five by a measure, in order, and every group counted before the cut', async () => {
      const rows = await driver.aggregate(TABLE, query(cut([{ column: 'revenue', order: 'desc' }, { column: 'customer', order: 'asc' }], 5)), { tenantId: 'org_a' });
      expect(customers(rows)).toEqual(['c59', 'c58', 'c57', 'c56', 'c55']);
      expect(rows.map((r) => r.revenue)).toEqual([595, 585, 575, 565, 555]);
      // 60 customers, `cnull` and the NULL customer: 62 groups in org_a.
      expect(rows.map((r) => r[COUNT_COLUMN])).toEqual([62, 62, 62, 62, 62]);
    });

    it('a sum with no value ranks as the 0 it is served as; a NULL group key ranks last either way', async () => {
      const asc = await driver.aggregate(TABLE, query(cut([{ column: 'revenue', order: 'asc' }, { column: 'customer', order: 'asc' }], 3)), { tenantId: 'org_a' });
      expect(customers(asc)).toEqual(['cnull', null, 'c00']);
      expect(asc.map((r) => r.revenue)).toEqual([0, 1, 5]);
      const byKeyAsc = await driver.aggregate(TABLE, query(cut([{ column: 'customer', order: 'asc' }])), { tenantId: 'org_a' });
      expect(customers(byKeyAsc).slice(0, 3)).toEqual(['c00', 'c01', 'c02']);
      expect(customers(byKeyAsc)[customers(byKeyAsc).length - 1]).toBeNull();
      const byKeyDesc = await driver.aggregate(TABLE, query(cut([{ column: 'customer', order: 'desc' }], 62)), { tenantId: 'org_a' });
      expect(customers(byKeyDesc).slice(0, 2)).toEqual(['cnull', 'c59']);
      expect(customers(byKeyDesc)[customers(byKeyDesc).length - 1]).toBeNull();
    });

    it('the cut runs inside the tenant wall and the where', async () => {
      const lost = await driver.aggregate(
        TABLE,
        query(cut([{ column: 'revenue', order: 'desc' }, { column: 'customer', order: 'asc' }], 2), { where: { status: 'lost' } }),
        { tenantId: 'org_a' },
      );
      // `lost` orders: the 30 odd customers' 5s — every one ties at 5, the group key breaks it.
      expect(customers(lost)).toEqual(['c01', 'c03']);
      expect(lost[0][COUNT_COLUMN]).toBe(30);
      const other = await driver.aggregate(TABLE, query(cut([{ column: 'revenue', order: 'desc' }], 5)), { tenantId: 'org_b' });
      expect(customers(other)).toEqual(['cz']);
      expect(other[0][COUNT_COLUMN]).toBe(1);
    });

    it('the ORDER BY, the LIMIT and the group count are in the statement, not applied after it', async () => {
      const seen: string[] = [];
      const knex = (driver as unknown as { knex: { on: Function; off: Function } }).knex;
      const listen = (q: { sql: string }) => { seen.push(q.sql); };
      knex.on('query', listen);
      try {
        await driver.aggregate(TABLE, query(cut([{ column: 'revenue', order: 'desc' }], 5)), { tenantId: 'org_a' });
      } finally {
        knex.off('query', listen);
      }
      const statement = seen.find((s) => /count\(\*\) over \(\)/i.test(s));
      expect(statement, seen.join('\n')).toBeDefined();
      expect(statement).toMatch(/order by .*revenue/i);
      expect(statement).toMatch(/\blimit\b|\bfetch\b|\btop\b/i);
      expect(statement).toMatch(/group by/i);
    });

    it('CONTROL — no directive: the grouped answer as before, no count column', async () => {
      const rows = await driver.aggregate(TABLE, { groupBy: ['customer'], aggregations: REVENUE } as DriverQuery, { tenantId: 'org_a' });
      expect(rows).toHaveLength(62);
      expect(rows[0]).not.toHaveProperty(COUNT_COLUMN);
    });

    it('a malformed directive, or an order by a column the statement does not project, is refused before it runs', async () => {
      const malformed = await driver.aggregate(TABLE, query({ orderBy: 'revenue' }), { tenantId: 'org_a' })
        .then(() => null, (e: Error & { code?: string }) => e);
      expect(malformed?.code).toBe('INTERNAL_ERROR');
      const unprojected = await driver.aggregate(TABLE, query(cut([{ column: 'amount', order: 'desc' }])), { tenantId: 'org_a' })
        .then(() => null, (e: Error & { code?: string }) => e);
      expect(unprojected?.code).toBe('INTERNAL_ERROR');
      expect(unprojected?.message).toMatch(/'amount'/);
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'aggregate order and cut', declareCell);
