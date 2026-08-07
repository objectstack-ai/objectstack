// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical storage + presentation for USER-declared `defaultValue: 'NOW()'`
 * temporal fields on SQLite — the ADR-0053/ADR-0074 follow-up.
 *
 * A `Field.datetime` with `defaultValue: 'NOW()'` used to take the
 * `knex.fn.now()` → `CURRENT_TIMESTAMP` column default on SQLite, storing a
 * timezone-NAIVE, space-separated `'YYYY-MM-DD HH:MM:SS'` (no millis, no zone).
 * `Date.parse` reads such a zone-less string as LOCAL time, so the stored UTC
 * wall-clock shifts by the host offset on a non-UTC runtime — the same class of
 * bug ADR-0074 fixed for the builtin `created_at`/`updated_at` audit columns.
 * Worse, the SAME column mixes storage: an explicit JS `Date` is bound by
 * better-sqlite3 as INTEGER epoch ms, while an omitted value takes the naive
 * TEXT default — so one column holds both INTEGER ms and naive TEXT.
 *
 * These tests pin the fix:
 *   1. the DDL default now emits a canonical instant — ISO-8601 with `Z` for
 *      datetime, `YYYY-MM-DD` for date, time-of-day for time;
 *   2. `formatOutput` folds every datetime storage form (INTEGER epoch ms,
 *      canonical ISO-`Z`, legacy naive TEXT) to one canonical ISO-`Z` instant on
 *      read, so reads are uniform regardless of how/when the row was written.
 * Postgres/MySQL keep native `now()` (a real zone-aware TIMESTAMP) and are
 * unaffected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;

/** Probe the per-dialect `nowColumnDefault` SQL without opening a connection. */
class ProbeDriver extends SqlDriver {
  nowDefaultSql(type: string): string {
    return (this as any).nowColumnDefault(type).toString();
  }
}
function makeProbe(client: string): ProbeDriver {
  return new ProbeDriver({ client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
}

describe('User NOW()-default temporal fields — canonical format (SQLite)', () => {
  let driver: SqlDriver;
  let raw: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    raw = (driver as any).knex;
    await driver.initObjects([
      {
        name: 'event',
        fields: {
          label: { type: 'string' },
          starts_at: { type: 'datetime', defaultValue: 'NOW()' },
          on_day: { type: 'date', defaultValue: 'NOW()' },
          at_time: { type: 'time', defaultValue: 'NOW()' },
        },
      },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  // ── DDL default (raw on disk) ───────────────────────────────────────────────

  it('datetime NOW()-default stores canonical ISO-8601-Z on an omitted insert (raw on disk)', async () => {
    await driver.create('event', { id: 'e1', label: 'A' }, { bypassTenantAudit: true });
    const row = await raw('event').where('id', 'e1').first();
    // The raw on-disk value — NOT the naive space-separated `CURRENT_TIMESTAMP`.
    expect(row.starts_at).toMatch(ISO_Z);
    expect(row.starts_at.endsWith('Z')).toBe(true);
    expect(row.starts_at).not.toContain(' ');
  });

  it('date NOW()-default stores YYYY-MM-DD; time NOW()-default stores a time-of-day (not a full timestamp)', async () => {
    await driver.create('event', { id: 'e2', label: 'B' }, { bypassTenantAudit: true });
    const row = await raw('event').where('id', 'e2').first();
    expect(row.on_day).toMatch(DATE_ONLY);
    expect(row.at_time).toMatch(TIME_ONLY);
    expect(row.at_time).not.toContain('-'); // time-of-day, not a `YYYY-MM-DD …` timestamp
  });

  // ── Read presentation: mixed storage → one canonical instant ────────────────

  it('an explicit Date is STORED canonical, not just presented canonical (#3912)', async () => {
    const when = new Date('2026-03-20T12:34:56.789Z');
    await driver.create('event', { id: 'e3', label: 'C', starts_at: when }, { bypassTenantAudit: true });

    // On disk it used to be the INTEGER epoch (better-sqlite3 binds a Date as
    // getTime()); `formatInput` now canonicalises the write, so storage and
    // presentation are the same string. That equality is the whole point — it is
    // what lets a window filter and an ORDER BY read the column directly.
    const rawRow = await raw('event').where('id', 'e3').first();
    expect(typeof rawRow.starts_at).toBe('string');
    expect(rawRow.starts_at).toBe('2026-03-20T12:34:56.789Z');

    const row: any = await driver.findOne('event', { where: { id: 'e3' } }, { bypassTenantAudit: true });
    expect(row.starts_at).toBe(rawRow.starts_at);
  });

  it('CONSISTENT STORAGE: an explicit-Date row and a defaulted row land in the SAME form (#3912)', async () => {
    await driver.create('event', { id: 'explicit', label: 'X', starts_at: new Date('2026-01-02T03:04:05.006Z') }, { bypassTenantAudit: true });
    await driver.create('event', { id: 'defaulted', label: 'Y' }, { bypassTenantAudit: true }); // omitted → DDL default

    // This assertion is the inverse of the one it replaces. The two write paths
    // used to produce INTEGER and TEXT in one column — the mixed storage that
    // broke every window filter (#3912) and still mis-orders ORDER BY (#3928).
    // `formatInput` and `nowColumnDefault` now agree on one shape.
    const rawRows = await raw('event').whereIn('id', ['explicit', 'defaulted']).select('id', 'starts_at');
    expect(new Set(rawRows.map((r: any) => typeof r.starts_at))).toEqual(new Set(['string']));
    for (const r of rawRows as any[]) expect(r.starts_at).toMatch(ISO_Z);

    // Lexicographic order is chronological order — what fixed-width UTC buys.
    const sorted = [...rawRows].sort((a: any, b: any) => String(a.starts_at).localeCompare(String(b.starts_at)));
    expect(sorted.map((r: any) => r.id)).toEqual(['explicit', 'defaulted']);

    for (const id of ['explicit', 'defaulted']) {
      const row: any = await driver.findOne('event', { where: { id } }, { bypassTenantAudit: true });
      expect(row.starts_at).toMatch(ISO_Z);
      expect(Number.isNaN(new Date(row.starts_at).getTime())).toBe(false);
    }
  });

  it('still repairs a LEGACY epoch row on read (un-migrated database)', async () => {
    // Rows written by a pre-#3912 build are INTEGER epoch ms. The read-side
    // repair that presented them canonically has not gone anywhere — a database
    // whose backfill has not run must keep reading correctly.
    await raw('event').insert({ id: 'legacy', label: 'L', starts_at: Date.parse('2026-03-20T12:34:56.789Z') });
    const rawRow = await raw('event').where('id', 'legacy').first();
    expect(typeof rawRow.starts_at).toBe('number');

    const row: any = await driver.findOne('event', { where: { id: 'legacy' } }, { bypassTenantAudit: true });
    expect(row.starts_at).toBe('2026-03-20T12:34:56.789Z');
  });

  it('an explicit ISO-8601-Z string is preserved (idempotent) on read', async () => {
    const iso = '2026-05-25T08:00:00.000Z';
    await driver.create('event', { id: 'e4', label: 'D', starts_at: iso }, { bypassTenantAudit: true });
    const row: any = await driver.findOne('event', { where: { id: 'e4' } }, { bypassTenantAudit: true });
    expect(row.starts_at).toBe(iso);
  });

  // ── Legacy / raw rows (read-repair, no data migration) ──────────────────────

  it('repairs a legacy naive CURRENT_TIMESTAMP row to canonical ISO-Z on read, interpreting it as UTC', async () => {
    // A row written before this fix (or by a raw insert that took the OLD naive
    // `CURRENT_TIMESTAMP` default), bypassing the driver write path entirely.
    await raw('event').insert({ id: 'legacy', label: 'L', starts_at: '2026-01-15 08:30:00' });
    const row: any = await driver.findOne('event', { where: { id: 'legacy' } }, { bypassTenantAudit: true });
    expect(row.starts_at).toBe('2026-01-15T08:30:00.000Z');
  });

  it('REGRESSION (host-timezone independence): the repaired instant equals the UTC wall-clock', async () => {
    // The zone-naive `2026-01-15 08:30:00` must mean 08:30 UTC, NOT 08:30 local.
    await raw('event').insert({ id: 'tz', label: 'T', starts_at: '2026-01-15 08:30:00' });
    const row: any = await driver.findOne('event', { where: { id: 'tz' } }, { bypassTenantAudit: true });
    expect(new Date(row.starts_at).getTime()).toBe(Date.parse('2026-01-15T08:30:00.000Z'));
  });

  it('find() (list path) normalizes datetime identically to findOne(), across mixed storage', async () => {
    await raw('event').insert({ id: 'list1', label: 'L1', starts_at: '2026-02-02 02:02:02.200' });
    await driver.create('event', { id: 'list2', label: 'L2', starts_at: new Date('2026-02-02T02:02:02.200Z') }, { bypassTenantAudit: true });
    const rows = await driver.find('event', { orderBy: [{ field: 'id', order: 'asc' }] });
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    expect(byId.list1.starts_at).toBe('2026-02-02T02:02:02.200Z');
    expect(byId.list2.starts_at).toBe('2026-02-02T02:02:02.200Z');
  });

  it('leaves an explicit null datetime untouched', async () => {
    const d2 = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    try {
      await d2.initObjects([{ name: 'evt2', fields: { dt: { type: 'datetime' }, label: { type: 'string' } } }]);
      await d2.create('evt2', { id: 'n1', label: 'N', dt: null }, { bypassTenantAudit: true });
      const row: any = await d2.findOne('evt2', { where: { id: 'n1' } }, { bypassTenantAudit: true });
      expect(row.dt).toBeNull();
    } finally {
      await d2.disconnect();
    }
  });

  // ── Dialect gate (Postgres/MySQL unaffected) ────────────────────────────────

  it('nowColumnDefault: SQLite emits canonical strftime; Postgres/MySQL keep native now()', () => {
    const sqlite = makeProbe('better-sqlite3');
    expect(sqlite.nowDefaultSql('datetime')).toContain('strftime');
    expect(sqlite.nowDefaultSql('datetime')).toContain('%Y-%m-%dT%H:%M:%fZ');
    expect(sqlite.nowDefaultSql('date')).toContain('%Y-%m-%d');
    expect(sqlite.nowDefaultSql('time')).toContain('%H:%M:%f');

    for (const client of ['pg', 'mysql2']) {
      const native = makeProbe(client);
      const sql = native.nowDefaultSql('datetime');
      expect(sql).not.toContain('strftime');
      expect(sql.toUpperCase()).toContain('CURRENT_TIMESTAMP'); // = knex.fn.now()
    }
  });
});
