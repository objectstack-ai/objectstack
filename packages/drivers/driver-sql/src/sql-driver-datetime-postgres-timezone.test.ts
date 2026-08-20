// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3912 on Postgres — the half that is NOT about storage form.
 *
 * SQLite's mixed INTEGER/TEXT storage is dialect-specific: `Field.datetime` maps
 * to a real `timestamptz` here (knex's `table.timestamp` defaults `useTz: true`),
 * so a `Date` and an ISO-`Z` string always resolved to the same instant. What
 * Postgres HAD instead was a timezone bug of the same family, and it was quieter:
 *
 *   - A zone-NAIVE value bound into `timestamptz` is resolved against the
 *     SERVER's `TimeZone`, not UTC. On an `Asia/Shanghai` server
 *     `'2026-03-20 12:00:00'` was stored as `2026-03-20T04:00:00Z` — 8 hours off
 *     the instant SQLite records for the same write (ADR-0053/ADR-0074: a naive
 *     wall clock IS UTC).
 *   - The filter comparand was passed through untouched, so a bare `YYYY-MM-DD`
 *     from a `{30_days_ago}` token meant midnight in the SERVER's timezone. The
 *     identical query over the identical instant put a row on a different
 *     calendar day than it did on SQLite — a silently wrong window, not an empty
 *     one.
 *
 * `canonicalUtcDatetime` closes both: every write and every comparand carries an
 * explicit `Z`, so the server's timezone stops participating in the answer.
 *
 * Opt-in — needs a real server, which CI does not provision:
 *
 *   OS_TEST_POSTGRES_URL=postgres://user@host:5432/db pnpm --filter @objectstack/driver-sql test
 *
 * Point it at a server whose `TimeZone` is NOT UTC to actually exercise the bug;
 * the suite asserts that and tells you if it cannot.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { PG_CELL } from './live-dialect-matrix.testkit.js';

// The cell, not `process.env.OS_TEST_POSTGRES_URL`: the env var is one value for
// the whole process, so a config built from it puts this file in the same schema
// as every other live file. `PG_CELL.config()` derives a per-FILE schema from
// vitest's own `testPath` (#9350).
const URL = PG_CELL.url;
const TABLE = 'os3912_probe';

/** 20:00Z is 04:00 the NEXT day at +08:00 — so a day window discriminates. */
const BOUNDARY = '2026-03-20T20:00:00.000Z';
const MIDDAY = '2026-03-20T12:00:00.000Z';

describe.skipIf(!URL)('Field.datetime on Postgres is timezone-independent (#3912)', () => {
  let driver: SqlDriver;
  let serverTimeZone = '';

  beforeAll(async () => {
    const probe = new SqlDriver(PG_CELL.config());
    const res: any = await probe.execute(`select current_setting('TimeZone') as tz`);
    serverTimeZone = ((res?.rows ?? res)[0] as any).tz;
    await probe.disconnect();
  });

  beforeEach(async () => {
    driver = new SqlDriver(PG_CELL.config());
    await driver.execute(`drop table if exists "${TABLE}" cascade`);
    await driver.initObjects([
      { name: TABLE, fields: { label: { type: 'string' }, at: { type: 'datetime' } } },
    ]);
  });

  afterEach(async () => {
    await driver.execute(`drop table if exists "${TABLE}" cascade`).catch(() => {});
    await driver.disconnect();
  });

  /** Epoch ms of the stored instant, read straight out of Postgres. */
  const storedEpochMs = async (id: string): Promise<number> => {
    const res: any = await driver.execute(
      `select (extract(epoch from at) * 1000)::bigint as ms from "${TABLE}" where id = ?`,
      [id],
    );
    return Number(((res?.rows ?? res)[0] as any).ms);
  };

  it('is pointed at a non-UTC server (otherwise this suite proves nothing)', () => {
    expect(
      serverTimeZone,
      'set the server TimeZone to something like Asia/Shanghai — on UTC the bug is invisible',
    ).not.toMatch(/^(UTC|Etc\/UTC|GMT)$/i);
  });

  it('maps Field.datetime to timestamptz, not a naive timestamp', async () => {
    const res: any = await driver.execute(
      `select data_type from information_schema.columns where table_name = ? and column_name = 'at'`,
      [TABLE],
    );
    expect(((res?.rows ?? res)[0] as any).data_type).toBe('timestamp with time zone');
  });

  it('records the same instant for a Date, an ISO-Z string and a NAIVE string', async () => {
    await driver.create(TABLE, { id: 'date-obj', label: 'a', at: new Date(MIDDAY) }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 'iso-z', label: 'b', at: MIDDAY }, { bypassTenantAudit: true });
    // The one that used to be resolved in the server's timezone.
    await driver.create(TABLE, { id: 'naive', label: 'c', at: '2026-03-20 12:00:00' }, { bypassTenantAudit: true });

    const expected = Date.parse(MIDDAY);
    for (const id of ['date-obj', 'iso-z', 'naive']) {
      expect(await storedEpochMs(id), `${id} stored instant`).toBe(expected);
    }
  });

  it('anchors a bare calendar-day comparand to UTC midnight, like SQLite', async () => {
    await driver.create(TABLE, { id: 'b1', label: 'x', at: new Date(BOUNDARY) }, { bypassTenantAudit: true });

    const day = async (from: string, to: string) =>
      (await driver.find(TABLE, { where: { at: { $gte: from, $lt: to } } })).map((r: any) => r.id);

    // 20:00Z belongs to 2026-03-20 in UTC. Read against the server's local
    // midnight (Asia/Shanghai) it would fall on the 21st instead — which is
    // exactly how the same dashboard window disagreed with SQLite.
    expect(await day('2026-03-20', '2026-03-21')).toEqual(['b1']);
    expect(await day('2026-03-21', '2026-03-22')).toEqual([]);
  });

  it('presents the stored instant as canonical UTC on read', async () => {
    await driver.create(TABLE, { id: 'r', label: 'r', at: '2026-03-20 12:00:00' }, { bypassTenantAudit: true });
    const row: any = await driver.findOne(TABLE, { where: { id: 'r' } }, { bypassTenantAudit: true });
    expect(new Date(row.at).toISOString()).toBe(MIDDAY);
  });
});
