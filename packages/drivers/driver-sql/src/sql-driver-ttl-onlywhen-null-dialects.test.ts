// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10165] Dialect-compile measurement for `{ $null: true }` inside a
 * lifecycle `onlyWhen` reap scope — the confidence gap named on the card:
 * the prior round (#7826) covered schema parsing and a fake engine, but not
 * the REAL driver compile path.
 *
 * The Reaper (`@objectstack/objectql` LifecycleService.reap) narrows every
 * candidate read to `{ [ttl.field]: { $lt: cutoff }, ...onlyWhen }` — so the
 * exact where this suite compiles is the exact where production issues. Two
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
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

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
