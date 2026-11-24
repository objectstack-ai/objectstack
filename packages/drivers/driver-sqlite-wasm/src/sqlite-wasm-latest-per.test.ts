// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [latest per group] This driver is on the engine's list of drivers that
 * compile the one-row-per-group window (objectql `latest-per.ts`), because it
 * inherits `driver-sql`'s `find` and runs it on its own sql.js dialect. Pinned
 * here on that dialect: one row per group, a tie to the id, NULL last, the
 * tenant wall inside the choice, and no helper column on the rows. The full
 * conformance table is `driver-sql`'s `sql-driver-latest-per.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LATEST_PER_DIRECTIVE } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '../src/index.js';

const DEALS = [
  { id: 'd1', account: 'a1', close_date: '2026-01-10', organization_id: 'org_a' },
  { id: 'd2', account: 'a1', close_date: '2026-03-10', organization_id: 'org_a' },
  { id: 'd3', account: 'a2', close_date: '2026-04-01', organization_id: 'org_a' },
  { id: 'd4', account: 'a2', close_date: '2026-04-01', organization_id: 'org_a' },
  { id: 'd5', account: 'a3', close_date: '2026-01-01', organization_id: 'org_a' },
  { id: 'd6', account: 'a3', close_date: null, organization_id: 'org_a' },
  { id: 'xb', account: 'a1', close_date: '2026-12-31', organization_id: 'org_b' },
];

describe('[latest per group] driver-sqlite-wasm serves the window', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: 'deal', fields: { account: { type: 'string' }, close_date: { type: 'date' }, organization_id: { type: 'string' } } },
    ]);
    for (const row of DEALS) await driver.create('deal', { ...row });
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('one row per group: the newest, a tie to the larger id, NULL last, inside the tenant wall', async () => {
    const rows = await driver.find('deal', {
      orderBy: [{ field: 'account', order: 'asc' }],
      [LATEST_PER_DIRECTIVE]: { by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' }] },
    } as never, { tenantId: 'org_a' });
    expect(rows.map((r) => r.id)).toEqual(['d2', 'd4', 'd5']);
    for (const row of rows) expect(Object.keys(row).some((k) => k.startsWith('__os_latest_per'))).toBe(false);
  });

  it('control: without the directive, every row', async () => {
    const rows = await driver.find('deal', {} as never, { tenantId: 'org_a' });
    expect(rows).toHaveLength(6);
  });
});
