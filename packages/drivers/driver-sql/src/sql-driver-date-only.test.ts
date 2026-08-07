// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0053 Phase 1: a `Field.date` is a timezone-naive calendar day. The
 * driver must store and return it as a `YYYY-MM-DD` string, never as an
 * instant — aligning the write/read boundary with the date-only contract
 * the filter layer (`coerceFilterValue`) already enforces.
 *
 * Before this change `formatInput` stored the value verbatim (keeping the
 * time component), while filters normalized the comparand to `YYYY-MM-DD`,
 * so `close_date == '2026-07-15'` compared `'2026-07-15T17:24Z'` against
 * `'2026-07-15'` and silently matched nothing. These tests pin the fixed
 * behaviour and guard that `Field.datetime` keeps its full-instant meaning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver Field.date is a tz-naive calendar day (ADR-0053 Phase 1)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          name: { type: 'string' },
          close_date: { type: 'date' },
          signed_at: { type: 'datetime' },
          amount: { type: 'integer' },
        },
      },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('stores a JS Date in a date field as a YYYY-MM-DD calendar day', async () => {
    await driver.create(
      'deal',
      { id: 'd1', name: 'A', close_date: new Date('2026-07-15T17:24:56.533Z') },
      { bypassTenantAudit: true },
    );
    const row = await driver.findOne('deal', { where: { id: 'd1' } }, { bypassTenantAudit: true });
    expect(row.close_date).toBe('2026-07-15');
  });

  it('stores a full-ISO string in a date field as date-only', async () => {
    await driver.create(
      'deal',
      { id: 'd2', name: 'B', close_date: '2026-07-15T17:24:56.533Z' },
      { bypassTenantAudit: true },
    );
    const row = await driver.findOne('deal', { where: { id: 'd2' } }, { bypassTenantAudit: true });
    expect(row.close_date).toBe('2026-07-15');
  });

  it('leaves an already date-only string unchanged', async () => {
    await driver.create(
      'deal',
      { id: 'd3', name: 'C', close_date: '2026-07-15' },
      { bypassTenantAudit: true },
    );
    const row = await driver.findOne('deal', { where: { id: 'd3' } }, { bypassTenantAudit: true });
    expect(row.close_date).toBe('2026-07-15');
  });

  it('keeps Field.datetime as a full instant (not collapsed to a day)', async () => {
    await driver.create(
      'deal',
      { id: 'd4', name: 'D', signed_at: new Date('2026-03-20T12:34:56.000Z') },
      { bypassTenantAudit: true },
    );
    const row = await driver.findOne('deal', { where: { id: 'd4' } }, { bypassTenantAudit: true });
    // datetime must retain its wall-clock time — never sliced to YYYY-MM-DD.
    expect(new Date(row.signed_at).toISOString()).toBe('2026-03-20T12:34:56.000Z');
  });

  it('matches a date-only equality filter against a timestamped write (the silent-miss regression)', async () => {
    // Written with a Date carrying a time component. Pre-fix this stored
    // '2026-07-15T17:24…' and the equality filter below matched nothing.
    await driver.create(
      'deal',
      { id: 'd5', name: 'E', close_date: new Date('2026-07-15T17:24:56.533Z') },
      { bypassTenantAudit: true },
    );
    const rows = await driver.find('deal', { where: { close_date: '2026-07-15' } });
    expect(rows.map((r: any) => r.id)).toEqual(['d5']);
  });

  it('matches a $in of calendar days', async () => {
    await driver.create('deal', { id: 'd6', name: 'F', close_date: new Date('2026-07-15T08:00:00Z') }, { bypassTenantAudit: true });
    await driver.create('deal', { id: 'd7', name: 'G', close_date: '2026-07-16' }, { bypassTenantAudit: true });
    await driver.create('deal', { id: 'd8', name: 'H', close_date: '2026-07-17' }, { bypassTenantAudit: true });
    const rows = await driver.find('deal', { where: { close_date: { $in: ['2026-07-15', '2026-07-17'] } } });
    expect(rows.map((r: any) => r.id).sort()).toEqual(['d6', 'd8']);
  });

  it('keeps date range filters working ($gte / $lt)', async () => {
    await driver.create('deal', { id: 'r1', close_date: '2025-01-15' }, { bypassTenantAudit: true });
    await driver.create('deal', { id: 'r2', close_date: '2026-03-20' }, { bypassTenantAudit: true });
    await driver.create('deal', { id: 'r3', close_date: '2026-05-25' }, { bypassTenantAudit: true });
    const rows = await driver.find('deal', { where: { close_date: { $gte: '2026-01-01', $lt: '2026-05-01' } } });
    expect(rows.map((r: any) => r.id)).toEqual(['r2']);
  });

  it('repairs a legacy timestamped row on read; an in-place rewrite makes it filter-matchable', async () => {
    // Simulate a row written before this normalization by inserting a full
    // timestamp straight into the (TEXT-affinity) date column, bypassing
    // formatInput.
    await (driver as any).knex('deal').insert({ id: 'legacy', name: 'L', close_date: '2026-08-15T17:24:56.533Z' });

    // Read-side repair: the returned value is date-only with no migration.
    const row = await driver.findOne('deal', { where: { id: 'legacy' } }, { bypassTenantAudit: true });
    expect(row.close_date).toBe('2026-08-15');

    // …but the value still stored in SQL keeps its time, so a SQL equality
    // filter against the un-rewritten row still misses. This is the limitation
    // ADR-0053 calls out: read-repair fixes display/read, and an optional
    // one-time migration (or any write through the normalized path) rewrites
    // legacy rows at rest.
    const beforeRewrite = await driver.find('deal', { where: { close_date: '2026-08-15' } });
    expect(beforeRewrite.map((r: any) => r.id)).toEqual([]);

    // Rewriting through the normalized write path (formatInput) collapses the
    // stored value to date-only, after which the equality filter matches.
    await driver.update('deal', 'legacy', { close_date: '2026-08-15' }, { bypassTenantAudit: true });
    const afterRewrite = await driver.find('deal', { where: { close_date: '2026-08-15' } });
    expect(afterRewrite.map((r: any) => r.id)).toEqual(['legacy']);
  });
});
