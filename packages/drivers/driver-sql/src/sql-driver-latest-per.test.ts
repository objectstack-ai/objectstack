// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [latest per group] `find()` compiles the window directive the engine hands
 * it (objectql `latest-per.ts`) into its own statement: one more predicate,
 * `id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY …
 * ORDER BY …, id) rn FROM t WHERE <tenant wall> AND <where>) w WHERE rn = 1)`.
 *
 * Pinned here: one row per group, the order's first row, ties broken by id in
 * the last key's direction, a NULL order value ranked last; the window chosen
 * among the rows the read's `where` admits (a group whose newest row the
 * `where` hides answers its newest admitted row) and inside the tenant wall
 * (another tenant's newer row never wins a group); the read's own ORDER BY,
 * limit, offset and projection applied to the groups; no helper column on the
 * rows; and a malformed directive refused before anything compiles.
 *
 * Every live cell runs where the suite provisions it (`OS_TEST_POSTGRES_URL`,
 * `OS_TEST_MYSQL_URL`); SQLite always runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';
import { LATEST_PER_DIRECTIVE, type LatestPerDirective } from './sql-driver-latest-per.js';

const TABLE = 'os_latest_per_deal';

/**
 * Deals by account and owner. Account `a1`: d3 is newest; `a2`: d5 and d6 tie
 * on the date (d6 wins on id, descending); `a3`: d8 has no date and ranks last
 * whatever the direction; `ab` is another tenant's account, and `a1` carries
 * one more deal, newer than all, in another tenant (xb).
 */
const DEALS = [
  { id: 'd1', account: 'a1', owner: 'u1', stage: 'won', close_date: '2026-01-10', amount: 10, organization_id: 'org_a' },
  { id: 'd2', account: 'a1', owner: 'u2', stage: 'lost', close_date: '2026-02-10', amount: 20, organization_id: 'org_a' },
  { id: 'd3', account: 'a1', owner: 'u1', stage: 'hidden', close_date: '2026-03-10', amount: 30, organization_id: 'org_a' },
  { id: 'd4', account: 'a2', owner: 'u2', stage: 'won', close_date: '2026-01-05', amount: 40, organization_id: 'org_a' },
  { id: 'd5', account: 'a2', owner: 'u1', stage: 'won', close_date: '2026-04-01', amount: 50, organization_id: 'org_a' },
  { id: 'd6', account: 'a2', owner: 'u2', stage: 'won', close_date: '2026-04-01', amount: 60, organization_id: 'org_a' },
  { id: 'd7', account: 'a3', owner: 'u1', stage: 'won', close_date: '2026-01-01', amount: 70, organization_id: 'org_a' },
  { id: 'd8', account: 'a3', owner: 'u1', stage: 'won', close_date: null, amount: 80, organization_id: 'org_a' },
  { id: 'xb', account: 'a1', owner: 'u1', stage: 'won', close_date: '2026-12-31', amount: 90, organization_id: 'org_b' },
  { id: 'yb', account: 'ab', owner: 'u9', stage: 'won', close_date: '2026-06-01', amount: 99, organization_id: 'org_b' },
];

const latestBy = (by: string[], orderBy: LatestPerDirective['orderBy']): LatestPerDirective => ({ by, orderBy });
const NEWEST_PER_ACCOUNT = latestBy(['account'], [{ field: 'close_date', order: 'desc' }]);

const query = (directive: unknown, over: Partial<DriverQuery> = {}): DriverQuery => ({
  orderBy: [{ field: 'account', order: 'asc' }],
  ...over,
  [LATEST_PER_DIRECTIVE]: directive,
} as unknown as DriverQuery);

const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id));

function declareCell(cell: DialectCell): void {
  describe(`[latest per group] driver-sql — find answers one row per group (${cell.label})`, () => {
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
            account: { type: 'text' }, owner: { type: 'text' }, stage: { type: 'text' },
            close_date: { type: 'date' }, amount: { type: 'number' }, organization_id: { type: 'text' },
          },
        },
      ] as never);
      for (const row of DEALS) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect?.();
      if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
    });

    it('one row per group: the newest; a tie goes to the larger id; a NULL date ranks last', async () => {
      const rows = await driver.find(TABLE, query(NEWEST_PER_ACCOUNT), { tenantId: 'org_a' });
      expect(ids(rows)).toEqual(['d3', 'd6', 'd7']);
    });

    it('ascending: the earliest per group, a tie to the smaller id, NULL still last', async () => {
      const rows = await driver.find(TABLE, query(latestBy(['account'], [{ field: 'close_date', order: 'asc' }])), { tenantId: 'org_a' });
      expect(ids(rows)).toEqual(['d1', 'd4', 'd7']);
    });

    it('a group whose newest row the where hides answers its newest ADMITTED row, never nothing', async () => {
      const rows = await driver.find(TABLE, query(NEWEST_PER_ACCOUNT, { where: { stage: { $ne: 'hidden' } } }), { tenantId: 'org_a' });
      expect(ids(rows)).toEqual(['d2', 'd6', 'd7']);
    });

    it('inside the tenant wall: another tenant\'s newer row never wins, its groups never appear', async () => {
      const a = await driver.find(TABLE, query(NEWEST_PER_ACCOUNT), { tenantId: 'org_a' });
      expect(ids(a)).not.toContain('xb');
      expect(ids(a)).not.toContain('yb');
      const b = await driver.find(TABLE, query(NEWEST_PER_ACCOUNT), { tenantId: 'org_b' });
      expect(ids(b)).toEqual(['xb', 'yb']);
    });

    it('several partition fields: one row per (account, owner)', async () => {
      const rows = await driver.find(TABLE, query(latestBy(['account', 'owner'], [{ field: 'close_date', order: 'desc' }]), {
        orderBy: [{ field: 'id', order: 'asc' }],
      }), { tenantId: 'org_a' });
      expect(ids(rows)).toEqual(['d2', 'd3', 'd5', 'd6', 'd7']);
    });

    it('the read\'s own ORDER BY, limit, offset and projection apply to the groups; no helper column', async () => {
      const page = await driver.find(TABLE, query(NEWEST_PER_ACCOUNT, {
        orderBy: [{ field: 'amount', order: 'desc' }],
        limit: 2,
        offset: 1,
        fields: ['id', 'amount'],
      }), { tenantId: 'org_a' });
      // Groups by amount desc: d7 (70), d6 (60), d3 (30) → offset 1, limit 2.
      expect(ids(page)).toEqual(['d6', 'd3']);
      for (const row of page) expect(Object.keys(row).sort()).toEqual(['amount', 'id']);
      const full = await driver.find(TABLE, query(NEWEST_PER_ACCOUNT), { tenantId: 'org_a' });
      for (const row of full) expect(Object.keys(row).some((k) => k.startsWith('__os_latest_per'))).toBe(false);
    });

    it('control: the same read without the directive answers every row', async () => {
      const rows = await driver.find(TABLE, { orderBy: [{ field: 'id', order: 'asc' }] } as DriverQuery, { tenantId: 'org_a' });
      expect(ids(rows)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']);
    });

    it('a malformed directive is refused before anything compiles', async () => {
      const err = await driver.find(TABLE, query({ by: [], orderBy: [] }), { tenantId: 'org_a' })
        .then(() => null, (e: Error) => e);
      expect(err?.message).toMatch(/latest-per directive is malformed/);
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'find latest per group', declareCell);
