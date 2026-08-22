// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10165] Dialect-compile measurement for `{ $null: true }` inside a
 * lifecycle `onlyWhen` reap scope — the confidence gap named on the card:
 * the prior round (#7826) covered schema parsing and a fake engine, but not
 * the REAL driver compile path.
 *
 * The Reaper (`@objectstack/objectql` LifecycleService.reap) narrows every
 * candidate read to `{ [ttl.field]: { $lt: cutoff }, ...onlyWhen }` — so the
 * exact where this suite compiles is the exact where production issues. Three
 * measurements:
 *
 * 1. **Live SQLite** (better-sqlite3, in-memory): the Reaper-shaped where is
 *    executed end-to-end. A backdated tombstone (`revoked_at` non-null,
 *    `expires_at` maximally past — the #7732 write backdates it to
 *    `now - 1000`, so a naive TTL reaps tombstones FIRST) must be excluded,
 *    and an ordinary expired row must still be a candidate (positive control:
 *    the exclusion is the filter, not a dead harness).
 *
 * 2. **Compile-only pg + mysql2**: the same where is pushed through the
 *    driver's own `applyFilterCondition` (the method `find`/`count`/`delete`
 *    all funnel through) onto a Knex builder for that dialect, and the
 *    rendered SQL is read back via `.toSQL()`. No connection is opened —
 *    Knex compiles without one (the pattern `sql-driver-temporal-dialect
 *    .test.ts` established). `$null: true` must render `is null`,
 *    `$null: false` must render `is not null`, and the TTL cutoff must
 *    remain a bound comparison on the same statement.
 *
 * 3. **[#10836] Live pg + mysql**: the same where EXECUTED against real
 *    servers, through `PG_CELL` / `MYSQL_CELL`. Measurement 2 proves the SQL
 *    *text*; it cannot prove the *server* returns those rows, and it never
 *    exercises the ttl cutoff against the column type each dialect actually
 *    creates. That is where these two dialects part company with sqlite:
 *    `Field.datetime` stores TEXT on sqlite but a REAL temporal column here
 *    (`timestamp with time zone` on Postgres, `datetime` on MySQL/MariaDB —
 *    asserted below, not assumed), and an ISO-8601 `...Z` comparand against a
 *    real temporal column under `STRICT_TRANS_TABLES` is exactly the class of
 *    thing a string assertion cannot see.
 *
 *    These are COVERAGE-EXTENSION controls, not defect controls: nothing was
 *    broken when they were written, so there is no red pre-fix tree to point
 *    at. What earns them is the UNFILTERED leg, which drops `onlyWhen` and
 *    watches the tombstone get reaped on the same server, in the same run --
 *    a live leg that stays green with the filter removed is not testing the
 *    filter.
 *
 *    Opt-in, and REPORTED when it cannot run:
 *
 *      OS_TEST_POSTGRES_URL=postgres://u:p@127.0.0.1:5432/conformance \
 *      OS_TEST_MYSQL_URL=mysql://u:p@127.0.0.1:3306/conformance \
 *        pnpm --filter @objectstack/driver-sql test
 *
 *    Without those the legs are declared un-run through `declareDialectCell`
 *    (a NAMED skip, fatal under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`) rather than
 *    silently omitted -- an un-run cell that reports nothing is the same defect
 *    class as the compile-only gap this closes.
 *
 *    What CI gains, stated exactly. The card that asked for these legs assumed
 *    CI provisions no live servers, so a committed live leg would add no CI
 *    protection. That is NOT true of this package: `Temporal Conformance
 *    (live PG + MySQL)` runs the WHOLE driver-sql suite -- `pnpm --filter
 *    @objectstack/driver-sql test`, not a filtered subset -- against a live
 *    `postgres:16` and a live `mysql:8.0`, at `TZ=America/New_York`, with
 *    `OS_EXPECT_LIVE_DIALECT_MATRIX=1` so a missing URL is a red rather than a
 *    skip. So these legs really do execute in CI, on a REQUIRED check, against
 *    real MySQL 8.0 rather than the MariaDB stand-in they were developed on.
 *    They skip -- announced -- on `Test Core` and for a developer with no
 *    servers. See the PR body for the local run that measured them.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  MYSQL_CELL,
  PG_CELL,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const CUTOFF = '2026-08-20T00:00:00.000Z';
/** Exactly what LifecycleService.reap composes for
 *  `ttl: { field: 'expires_at', expireAfter: …, onlyWhen: { revoked_at: { $null: true } } }`. */
const REAPER_WHERE = {
  expires_at: { $lt: CUTOFF },
  revoked_at: { $null: true },
};

describe('ttl onlyWhen {$null} — real driver compile path, three dialects (#10165)', () => {
  const drivers: SqlDriver[] = [];
  afterEach(async () => {
    while (drivers.length) await drivers.pop()!.disconnect();
  });

  it('sqlite (live): tombstones are excluded, ordinary expired rows remain candidates', async () => {
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    drivers.push(driver);

    const k = (driver as any).knex;
    await k.schema.createTable('sessions', (t: any) => {
      t.string('id').primary();
      t.string('expires_at');
      t.string('revoked_at').nullable();
    });
    await k('sessions').insert([
      // ordinary expired row — the positive control: MUST be reaped
      { id: 'expired', expires_at: '2026-08-01T00:00:00.000Z', revoked_at: null },
      // tombstone: revoked, expires_at BACKDATED (looks maximally expired) — MUST be spared
      { id: 'tombstone', expires_at: '2026-07-01T00:00:00.000Z', revoked_at: '2026-07-01T00:00:00.000Z' },
      // live row: not expired — outside the cutoff either way
      { id: 'live', expires_at: '2026-12-31T00:00:00.000Z', revoked_at: null },
    ]);

    // The candidate read the Reaper's batchedReap issues.
    const candidates = await driver.find('sessions', { where: REAPER_WHERE });
    expect(candidates.map((r: any) => r.id)).toEqual(['expired']);

    // And the count path (same compile funnel, second consumer).
    expect(await driver.count('sessions', { where: REAPER_WHERE })).toBe(1);

    // Positive control's counter-face: WITHOUT the filter the tombstone is a
    // candidate — proving the exclusion above is the filter at work, not a
    // harness that never matched anything.
    const unfiltered = await driver.find('sessions', {
      where: { expires_at: { $lt: CUTOFF } },
    });
    expect(unfiltered.map((r: any) => r.id).sort()).toEqual(['expired', 'tombstone']);
  });

  /** Compile the Reaper-shaped where through the driver's real filter
   *  emitter for one dialect and return the rendered SQL + bindings. */
  function compile(client: string, where: Record<string, unknown>) {
    // Connection is never opened — construction and .toSQL() are offline.
    const driver = new SqlDriver({ client, connection: {} } as any);
    drivers.push(driver);
    const qb = (driver as any).knex('sessions').select('*');
    (driver as any).applyFilterCondition(qb, where, 'and', 'sessions');
    return qb.toSQL();
  }

  for (const [client, q] of [
    ['pg', '"'],
    ['mysql2', '`'],
  ] as const) {
    it(`${client} (compile): $null: true renders IS NULL beside the ttl cutoff`, () => {
      const { sql, bindings } = compile(client, REAPER_WHERE);
      const lower = sql.toLowerCase();
      // `is null` on revoked_at — not a bound `= true` (the #2704 failure shape)
      expect(lower).toContain(`${q}revoked_at${q} is null`.toLowerCase());
      expect(lower).not.toContain('is not null');
      // the ttl cutoff stays a bound `<` comparison on the same statement
      expect(lower).toContain(`${q}expires_at${q} <`.toLowerCase());
      expect(bindings).toContain(CUTOFF);
      // the null predicate must NOT leak into the bindings as a comparand
      expect(bindings).not.toContain(true);
    });

    it(`${client} (compile): $null: false renders IS NOT NULL`, () => {
      const { sql } = compile(client, {
        expires_at: { $lt: CUTOFF },
        revoked_at: { $null: false },
      });
      expect(sql.toLowerCase()).toContain(`${q}revoked_at${q} is not null`.toLowerCase());
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// [#10836] MEASUREMENT 3 — the same where, EXECUTED on live servers
// ─────────────────────────────────────────────────────────────────

/** Table this file owns on the live servers. The SCHEMA it lands in is derived
 *  per-file by the cell (#9350), so the bare name cannot collide. */
const LIVE_TABLE = 'os10836_sessions';

/**
 * What `Field.datetime` really becomes on each live dialect, as knex
 * `columnInfo()` reports it — the fact the sqlite leg above structurally
 * cannot show, since sqlite has no temporal type and stores TEXT.
 *
 * Pinned as data rather than described in prose: these are the numbers the
 * card measured by hand (PostgreSQL 16.13, MariaDB 10.11.14), and a server
 * that reports something else is a FINDING to report, not a value to relax
 * the assertion around.
 */
const LIVE_TEMPORAL_TYPE: Partial<Record<DialectCell['id'], string>> = {
  pg: 'timestamp with time zone',
  mysql: 'datetime',
};

/**
 * The live fixture, named as the card names it.
 *
 * The two ordinary rows sit only FOUR HOURS either side of {@link CUTOFF} on
 * purpose. A zone leak on these servers is ±8h (both are provisioned off UTC:
 * PG `Asia/Shanghai`, MySQL `+08:00`) and ±4/5h from a non-UTC process — so if
 * the stored instant and the ISO-Z comparand were ever folded through
 * different clocks, `sess_expired` and `sess_live` would swap sides of the
 * cutoff and this fixture would go red. A day-wide margin would absorb exactly
 * the defect the live legs exist to expose.
 */
const LIVE_ROWS = [
  // ordinary expired row — POSITIVE control: MUST be reaped.
  { id: 'sess_expired', label: 'expired', expires_at: '2026-08-19T20:00:00.000Z' },
  // not yet expired — outside the cutoff either way, so it survives both sweeps
  // and keeps the UNFILTERED leg below from being "everything was deleted".
  { id: 'sess_live', label: 'live', expires_at: '2026-08-20T04:00:00.000Z' },
  // tombstone: revoked, `expires_at` BACKDATED by `reconcileSessionDelete`
  // (#7732) so it looks MAXIMALLY expired — SPARING control: only `onlyWhen`
  // can save it.
  {
    id: 'sess_tombstone',
    label: 'tombstone',
    expires_at: '2026-07-01T00:00:00.000Z',
    revoked_at: '2026-07-01T00:00:00.000Z',
  },
] as const;

const LIVE_MATRIX = 'ttl onlyWhen {$null} reap scope';

/** The Reaper's candidate scope with `onlyWhen` DROPPED — the counter-face. */
const UNFILTERED_WHERE = { expires_at: { $lt: CUTOFF } };

function declareLiveSweep(cell: DialectCell): void {
  describe(`ttl onlyWhen {$null} on live ${cell.id} (#10836)`, () => {
    let driver: SqlDriver;

    /** Ids still present, sorted — "survivors after the sweep" in the card's words. */
    const survivors = async (): Promise<string[]> =>
      (await driver.find(LIVE_TABLE, {}, { bypassTenantAudit: true }))
        .map((r: any) => r.id)
        .sort();

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${LIVE_TABLE}`).catch(() => {});
      // The REAL declaration's field types (`SysSession.expires_at` and
      // `.revoked_at` are both `Field.datetime`), through the driver's own
      // schema sync — so the columns under test are the ones production gets.
      await driver.initObjects([
        {
          name: LIVE_TABLE,
          fields: {
            label: { type: 'string' },
            expires_at: { type: 'datetime', required: true },
            revoked_at: { type: 'datetime', required: false },
          },
        },
      ] as any);
      for (const row of LIVE_ROWS) {
        await driver.create(LIVE_TABLE, { ...row }, { bypassTenantAudit: true });
      }
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${LIVE_TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('stores the ttl field in a REAL temporal column, not the TEXT sqlite uses', async () => {
      const info: any = await (driver as any).knex(LIVE_TABLE).columnInfo();
      const expected = LIVE_TEMPORAL_TYPE[cell.id];
      for (const column of ['expires_at', 'revoked_at']) {
        expect(
          String(info[column]?.type),
          `${cell.id} reported a different type for ${column} than the card measured — that is a ` +
            `finding to report, not a divergence to reconcile away`,
        ).toBe(expected);
      }
      // The fixture would be vacuous if this dialect stored text like sqlite:
      // the whole point of the live legs is that the cutoff meets a temporal
      // column here.
      expect(String(info.expires_at?.type)).not.toMatch(/char|text/i);
    });

    it('the ISO-Z cutoff selects the expired row and the filter spares the tombstone', async () => {
      // The candidate read `LifecycleService.reap`'s batchedReap issues.
      const candidates = await driver.find(
        LIVE_TABLE,
        { where: REAPER_WHERE },
        { bypassTenantAudit: true },
      );
      expect(candidates.map((r: any) => r.id).sort()).toEqual(['sess_expired']);
      // Same compile funnel, second consumer.
      expect(await driver.count(LIVE_TABLE, { where: REAPER_WHERE }, { bypassTenantAudit: true })).toBe(1);
    });

    it('the sweep deletes exactly the expired row — survivors keep the tombstone', async () => {
      const deleted = await driver.deleteMany(
        LIVE_TABLE,
        { where: REAPER_WHERE },
        { bypassTenantAudit: true },
      );
      expect(deleted).toBe(1);
      expect(await survivors()).toEqual(['sess_live', 'sess_tombstone']);
    });

    it('UNFILTERED control: drop onlyWhen and the SAME sweep reaps the tombstone', async () => {
      // This is what earns the three legs above. Without it a live leg that
      // matched nothing — a mis-bound comparand, a table read in the wrong
      // schema — would report the identical green.
      const deleted = await driver.deleteMany(
        LIVE_TABLE,
        { where: UNFILTERED_WHERE },
        { bypassTenantAudit: true },
      );
      expect(deleted).toBe(2);
      expect(await survivors()).toEqual(['sess_live']);
    });
  });
}

// Total, not one-way: a provisioned cell is MEASURED, an unprovisioned one is
// DECLARED un-run (and fatal under OS_EXPECT_LIVE_DIALECT_MATRIX=1). There is
// no third outcome available here, which is the point — a silently skipped
// live leg is as green as a passing one.
declareDialectCell(PG_CELL, LIVE_MATRIX, declareLiveSweep);
declareDialectCell(MYSQL_CELL, LIVE_MATRIX, declareLiveSweep);
