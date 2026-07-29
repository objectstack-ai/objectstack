// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression #3912 — the OTHER half of the SQLite `Field.datetime` storage mix.
 *
 * `sql-driver-datetime-filter.test.ts` covers rows written with a JS `Date`, so
 * better-sqlite3 stores them as INTEGER epoch ms. But the REST / JSON write path
 * cannot produce a `Date` (JSON has no such type) and a `defaultValue: 'NOW()'`
 * slot stamps an ISO string, so a production table is dominated by ISO **TEXT**
 * — and the filter path coerced its comparand to epoch ms purely from the
 * DECLARED type. Every datetime window filter then compared INTEGER-vs-TEXT and
 * returned nothing: a dashboard `last_30_days` on `created_date` read 0 while 29
 * rows matched.
 *
 * These tests write the way REST does (ISO strings) and assert the same filters
 * that already pass for `Date`-written rows. The mixed-storage suite at the end
 * is the real production shape: one table holding both forms at once.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const OBJECT = {
  name: 'lead',
  fields: {
    name: { type: 'string' },
    created_date: { type: 'datetime' },
    closed_on: { type: 'date' },
  },
} as any;

describe('SqlDriver datetime filters on ISO-TEXT-stored columns (#3912)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([OBJECT]);

    // Written the way a REST/JSON create writes: ISO strings, which
    // better-sqlite3 binds as TEXT.
    await driver.create('lead', {
      id: 'l1', name: 'Old', created_date: '2025-01-15T00:00:00.000Z', closed_on: '2025-01-15',
    }, { bypassTenantAudit: true });
    await driver.create('lead', {
      id: 'l2', name: 'New', created_date: '2026-03-20T12:00:00.000Z', closed_on: '2026-03-20',
    }, { bypassTenantAudit: true });
    await driver.create('lead', {
      id: 'l3', name: 'Newer', created_date: '2026-05-25T08:30:15.250Z', closed_on: '2026-05-25',
    }, { bypassTenantAudit: true });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('stores the ISO write as TEXT (the premise these tests rest on)', async () => {
    const rows: any = await (driver as any).knex.raw(
      `select id, typeof(created_date) as t from lead order by id`,
    );
    expect(rows.map((r: any) => r.t)).toEqual(['text', 'text', 'text']);
  });

  it('matches $gte against an ISO date string', async () => {
    const rows = await driver.find('lead', {
      where: { created_date: { $gte: '2026-01-01' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(rows.map((r: any) => r.id)).toEqual(['l2', 'l3']);
  });

  it('matches a $gte / $lt window — the dashboard dateRange shape', async () => {
    const rows = await driver.find('lead', {
      where: { created_date: { $gte: '2026-01-01', $lt: '2026-05-01' } },
    });
    expect(rows.map((r: any) => r.id)).toEqual(['l2']);
  });

  it('matches a full ISO timestamp comparand, to the millisecond', async () => {
    const inclusive = await driver.find('lead', {
      where: { created_date: { $gte: '2026-05-25T08:30:15.250Z' } },
    });
    expect(inclusive.map((r: any) => r.id)).toEqual(['l3']);

    const exclusive = await driver.find('lead', {
      where: { created_date: { $gt: '2026-05-25T08:30:15.250Z' } },
    });
    expect(exclusive).toEqual([]);
  });

  it('matches a JS Date comparand against a TEXT-stored row', async () => {
    const rows = await driver.find('lead', {
      where: { created_date: { $gte: new Date('2026-05-01T00:00:00Z') } },
    });
    expect(rows.map((r: any) => r.id)).toEqual(['l3']);
  });

  it('matches equality on the exact stored instant', async () => {
    const rows = await driver.find('lead', {
      where: { created_date: '2026-03-20T12:00:00.000Z' },
    });
    expect(rows.map((r: any) => r.id)).toEqual(['l2']);
  });

  it('matches $between, $in and $nin', async () => {
    const between = await driver.find('lead', {
      where: { created_date: { $between: ['2026-01-01', '2026-04-01'] } },
    });
    expect(between.map((r: any) => r.id)).toEqual(['l2']);

    const isIn = await driver.find('lead', {
      where: { created_date: { $in: ['2026-03-20T12:00:00.000Z', '2026-05-25T08:30:15.250Z'] } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(isIn.map((r: any) => r.id)).toEqual(['l2', 'l3']);

    const notIn = await driver.find('lead', {
      where: { created_date: { $nin: ['2026-03-20T12:00:00.000Z'] } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(notIn.map((r: any) => r.id)).toEqual(['l1', 'l3']);
  });

  it('matches $ne and the null predicates', async () => {
    const ne = await driver.find('lead', {
      where: { created_date: { $ne: '2026-03-20T12:00:00.000Z' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(ne.map((r: any) => r.id)).toEqual(['l1', 'l3']);

    await driver.create('lead', { id: 'l4', name: 'Undated' }, { bypassTenantAudit: true });
    const missing = await driver.find('lead', { where: { created_date: { $null: true } } });
    expect(missing.map((r: any) => r.id)).toEqual(['l4']);

    const present = await driver.find('lead', {
      where: { created_date: { $null: false } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(present.map((r: any) => r.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('matches the AST array filter form', async () => {
    const rows = await driver.find('lead', {
      where: [['created_date', '>=', '2026-01-01'], ['created_date', '<', '2026-05-01']],
    } as any);
    expect(rows.map((r: any) => r.id)).toEqual(['l2']);
  });

  it('matches inside an $or branch', async () => {
    const rows = await driver.find('lead', {
      where: { $or: [{ created_date: { $lt: '2025-06-01' } }, { name: 'Newer' }] },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(rows.map((r: any) => r.id)).toEqual(['l1', 'l3']);
  });

  it('leaves the Field.date column on its own YYYY-MM-DD rule', async () => {
    const rows = await driver.find('lead', {
      where: { closed_on: { $gte: '2026-01-01' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(rows.map((r: any) => r.id)).toEqual(['l2', 'l3']);
  });

});

describe('SqlDriver datetime filters on the created_at audit column (#3912)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // `withAuditFields` (objectql registry) declares `created_at` / `updated_at`
    // as `datetime` on every audited object, so the driver sees them as declared
    // datetime columns — exactly as spelled here.
    await driver.initObjects([
      {
        name: 'ticket',
        fields: {
          subject: { type: 'string' },
          created_at: { type: 'datetime' },
          updated_at: { type: 'datetime' },
        },
      },
    ] as any);
    await driver.create('ticket', { id: 't1', subject: 'Stamped' });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('filters created_at even though the driver stamps it as ISO TEXT', async () => {
    // The driver stamps the audit columns with `new Date().toISOString()` — never
    // a `Date` — so they are TEXT on EVERY object in the system while being
    // declared `datetime`. Filtering on them was unconditionally broken, not an
    // edge case.
    const stamped: any = await (driver as any).knex.raw(
      `select typeof(created_at) as c, typeof(updated_at) as u from ticket`,
    );
    expect(stamped[0]).toEqual({ c: 'text', u: 'text' });

    const matched = await driver.find('ticket', {
      where: { created_at: { $gte: '2000-01-01' } },
    });
    expect(matched.map((r: any) => r.id)).toEqual(['t1']);

    // …and a window that starts after the stamp excludes it, so the match above
    // is a real comparison rather than "the predicate was dropped".
    const future = await driver.find('ticket', {
      where: { created_at: { $gte: '2999-01-01' } },
    });
    expect(future).toEqual([]);
  });
});

describe('SqlDriver datetime filters on a MIXED-storage column (#3912)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([OBJECT]);

    // The production shape: seeds/imports bind a `Date` (INTEGER epoch) while the
    // REST API writes ISO strings (TEXT) — into the same column.
    await driver.create('lead', {
      id: 'int-old', name: 'int-old', created_date: new Date('2025-02-01T00:00:00Z'),
    }, { bypassTenantAudit: true });
    await driver.create('lead', {
      id: 'txt-old', name: 'txt-old', created_date: '2025-02-02T00:00:00.000Z',
    }, { bypassTenantAudit: true });
    await driver.create('lead', {
      id: 'int-new', name: 'int-new', created_date: new Date('2026-06-01T00:00:00Z'),
    }, { bypassTenantAudit: true });
    await driver.create('lead', {
      id: 'txt-new', name: 'txt-new', created_date: '2026-06-02T00:00:00.000Z',
    }, { bypassTenantAudit: true });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('really does hold both storage forms', async () => {
    const rows: any = await (driver as any).knex.raw(
      `select id, typeof(created_date) as t from lead order by id`,
    );
    expect(Object.fromEntries(rows.map((r: any) => [r.id, r.t]))).toEqual({
      'int-new': 'integer', 'int-old': 'integer', 'txt-new': 'text', 'txt-old': 'text',
    });
  });

  it('returns rows of BOTH forms from one window filter', async () => {
    const rows = await driver.find('lead', {
      where: { created_date: { $gte: '2026-01-01' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(rows.map((r: any) => r.id)).toEqual(['int-new', 'txt-new']);
  });

  it('excludes rows of BOTH forms that fall outside the window', async () => {
    const rows = await driver.find('lead', {
      where: { created_date: { $lt: '2026-01-01' } },
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(rows.map((r: any) => r.id)).toEqual(['int-old', 'txt-old']);
  });

  it('counts rows of both forms in an aggregate window', async () => {
    const rows: any = await driver.aggregate('lead', {
      aggregations: [{ function: 'count', alias: 'n' }],
      where: { created_date: { $gte: '2026-01-01' } },
    } as any);
    // 4 means the window was dropped; 1 means only one storage form matched.
    expect(Number(rows[0].n)).toBe(2);
  });
});
