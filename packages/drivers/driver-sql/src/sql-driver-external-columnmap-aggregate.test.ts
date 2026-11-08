// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `aggregate()` and `distinct()` honour `external.columnMap` (ADR-0015 §18).
 *
 * `find()`, `count()` and every WHERE have mapped a federated object's local
 * field to its remote column since columnMap landed (`remoteColumn` in
 * `findRows`, `applyFilters`). The two analytic doors did not: they named the
 * FIELD verbatim in GROUP BY, in the aggregand and in `SELECT DISTINCT`, so
 * the remote table was asked for a column it does not have. Measured before
 * the fix on SQLite (this file's fixture) as the driver's unattributed-column
 * refusal.
 *
 * The rule pinned here: identifiers are the REMOTE column; output keys,
 * presentation and the per-field registries stay the FIELD.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './index.js';

const REMOTE = {
  name: 'legacy_deal',
  fields: {
    deal_no: { type: 'text' },
    region_code: { type: 'text' },
    amt: { type: 'number' },
    closed_dt: { type: 'date' },
    won_flag: { type: 'boolean' },
  },
};

const COLUMN_MAP = { deal_no: 'id', region_code: 'region', amt: 'amount', closed_dt: 'closed_on', won_flag: 'won' };
const LOCAL_FIELDS = {
  region: { type: 'text' },
  amount: { type: 'number' },
  closed_on: { type: 'date' },
  won: { type: 'boolean' },
};

let file: string;
let driver: any;

beforeAll(async () => {
  file = join(tmpdir(), `os-cm-agg-${process.pid}-${Date.now()}.db`);
  const fx = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }) as any;
  fx.name = 'fx';
  await fx.connect();
  await fx.initObjects([REMOTE]);
  await fx.create('legacy_deal', { deal_no: 'd1', region_code: 'NA', amt: 100, closed_dt: '2026-01-10', won_flag: true });
  await fx.create('legacy_deal', { deal_no: 'd2', region_code: 'EU', amt: 40, closed_dt: '2026-01-20', won_flag: false });
  await fx.create('legacy_deal', { deal_no: 'd3', region_code: 'EU', amt: 60, closed_dt: '2026-04-02', won_flag: true });
  await fx.disconnect();

  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true, schemaMode: 'external' } as any) as any;
  driver.name = 'extds';
  await driver.connect();
  driver.registerExternalObject({ name: 'deal', external: { remoteName: 'legacy_deal', columnMap: COLUMN_MAP }, fields: LOCAL_FIELDS });
});

afterAll(async () => {
  await driver?.disconnect();
  if (file) rmSync(file, { force: true });
});

const byRegion = (rows: any[]) => [...rows].sort((a, b) => String(a.region).localeCompare(String(b.region)));

describe('aggregate() over a columnMap-ed object', () => {
  it('groups by the remote column and keys the group under the field', async () => {
    const rows = await driver.aggregate('deal', {
      groupBy: ['region'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }, { function: 'count', alias: 'n' }],
    });
    expect(byRegion(rows)).toEqual([
      { region: 'EU', total: 100, n: 2 },
      { region: 'NA', total: 100, n: 1 },
    ]);
  });

  it('an aliased structured group key lands under its alias', async () => {
    const rows = await driver.aggregate('deal', {
      groupBy: [{ field: 'region', alias: 'r' }],
      aggregations: [{ function: 'max', field: 'amount', alias: 'top' }],
    });
    expect([...rows].sort((a: any, b: any) => a.r.localeCompare(b.r))).toEqual([
      { r: 'EU', top: 60 },
      { r: 'NA', top: 100 },
    ]);
  });

  it('a date-bucketed group reads the remote column and keeps the field registry (calendar day)', async () => {
    const rows = await driver.aggregate('deal', {
      groupBy: [{ field: 'closed_on', dateGranularity: 'month' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect([...rows].sort((a: any, b: any) => a.closed_on.localeCompare(b.closed_on))).toEqual([
      { closed_on: '2026-01', n: 2 },
      { closed_on: '2026-04', n: 1 },
    ]);
  });

  it('min/max over a mapped column take the field presentation; count_distinct maps too', async () => {
    const [row] = await driver.aggregate('deal', {
      aggregations: [
        { function: 'min', field: 'closed_on', alias: 'first' },
        { function: 'count_distinct', field: 'region', alias: 'regions' },
      ],
    });
    expect(row).toEqual({ first: '2026-01-10', regions: 2 });
  });

  it('the WHERE and the GROUP BY agree on the mapping', async () => {
    const rows = await driver.aggregate('deal', {
      where: { won: true },
      groupBy: ['region'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });
    expect(byRegion(rows)).toEqual([
      { region: 'EU', total: 60 },
      { region: 'NA', total: 100 },
    ]);
  });
});

describe('distinct() over a columnMap-ed object', () => {
  it('reads the remote column and answers its values', async () => {
    expect([...(await driver.distinct('deal', 'region'))].sort()).toEqual(['EU', 'NA']);
  });

  it('presents by the field registry (a mapped boolean reads as a boolean)', async () => {
    expect([...(await driver.distinct('deal', 'won'))].sort()).toEqual([false, true]);
  });

  it('with a filter on another mapped field', async () => {
    expect(await driver.distinct('deal', 'region', { amount: { $gt: 50 } })).toEqual(expect.arrayContaining(['EU', 'NA']));
    expect(await driver.distinct('deal', 'region', { amount: { $lt: 50 } })).toEqual(['EU']);
  });
});
