// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11067] `updated_at` must advance on a deployment that never runs the
 * driver's DDL — and must keep working on a hand-migrated table that genuinely
 * has no `updated_at` column.
 *
 * ## The defect, re-derived at the lines rather than taken from the card
 *
 * `SqlDriver.update()` stamps `updated_at` only for tables in
 * `tablesWithTimestamps`. That set is filled in FOUR places (the card says
 * three), and every one of them is downstream of DDL:
 *
 *  1. `initObjects`' `createTable` branch — the table we just built;
 *  2. `initObjects`' "the existing table already has an `updated_at` column"
 *     branch, decided from a physical `columnInfo()`;
 *  3. `initObjects`' rotation branch, just before `ensureRotation`;
 *  4. `aliasShardBookkeeping`, the rotation-shard copy of (3).
 *
 * So a deployment that manages DDL out-of-band — `skipSchemaSync` /
 * `OS_SKIP_SCHEMA_SYNC=1`, documented in
 * `content/docs/deployment/environment-variables.mdx` as "skip the implicit
 * `db:sync` on boot; use after running migrations manually" — boots with the
 * set EMPTY and never stamps. The column carries only an INSERT-time
 * `DEFAULT now()`, with no `ON UPDATE` clause or trigger on any dialect, so
 * `updated_at` records the row's CREATION time forever. Consumers are wrong
 * without being unavailable: list-view sorts, delta/incremental sync, cache
 * invalidation, audit answers.
 *
 * ## What is pinned here, and why each leg exists
 *
 * §1 The card's repro sketch as a measurement: an out-of-band table, a driver
 *    that never runs `initObjects`, `create()` → backdate → `update()` → the
 *    stamp moved. Backdating to a sentinel instant is how "let time pass" is
 *    modelled: it is deterministic on every dialect, where a real sleep races
 *    MySQL's `CURRENT_TIMESTAMP` second granularity.
 *
 * §2 The other half of the pair, and the leg that decides the tier. On a
 *    hand-migrated table genuinely LACKING the column, inferring from the
 *    declared shape alone would turn an `update()` that succeeds today into a
 *    loud failure — a NEW rejection for a call that works. The lazy fallback is
 *    what keeps that from happening, so it is pinned directly: the update must
 *    still succeed, still write the caller's data, and resolve the question
 *    ONCE.
 *
 * §3 The steady-state cost. §1's updates must issue ZERO introspection
 *    round-trips — that is the currency `skipSchemaSync` exists to save, and a
 *    fix that probes every table on first write spends it. §2's first update
 *    may probe exactly once; every later one must not.
 *
 * §4 An object the driver was never told about at all stays untouched — the
 *    inference is keyed to registration, not to "any table name that reaches
 *    `update()`".
 *
 * §5 The caller's transaction survives the fallback. On Postgres ANY statement
 *    error aborts the whole transaction (`25P02`), so a `try/catch` whose
 *    recovery issues SQL on the same transaction can never run there — the
 *    hazard `attemptWithoutPoisoning` was built for (#8269). Pinned on live PG,
 *    where it is real, and run on the other cells too.
 *
 * Every cell runs on SQLite AND on live Postgres / MySQL through
 * `declareDialectCell`, so an unprovisioned dialect is REPORTED rather than
 * omitted. `updated_at` is dialect-dependent in the code under test
 * (`this.isSqlite ? new Date().toISOString() : this.knex.fn.now()`), which is
 * why this is not a SQLite-only pin.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — these fixtures are not tenant-scoped. */
const OPTS = { bypassTenantAudit: true };

/**
 * The instant a row is backdated to before the `update()` under test.
 *
 * A sentinel far in the past rather than a sleep: an insert default and an
 * update a few hundred microseconds later can legitimately land on the same
 * stored value on any dialect. Backdating removes the race without weakening
 * what is asserted: the stamp either moved to ~now or it did not move at all,
 * and those are six years apart.
 *
 * This docblock used to record a STRONGER hazard — that on MySQL the update
 * could land on an EARLIER value than the insert default, because
 * `updatedAtStamp()`'s bare `knex.fn.now()` compiled to a second-precision
 * `CURRENT_TIMESTAMP` against a `DATETIME(3)` column defaulted with `now(3)`.
 * That was the defect #11224 fixed rather than a property of the dialect, and
 * `sql-driver-11224-update-stamp-precision.test.ts` now asserts it is gone.
 */
const BACKDATED_MS = Date.parse('2020-01-01T00:00:00.000Z');

/** The object as an out-of-band migration would have declared it. */
function prefObject(name: string) {
  return {
    name,
    fields: {
      id: { type: 'text' },
      key: { type: 'text' },
      value: { type: 'json' },
    },
  } as any;
}

/**
 * `create table t (id text primary key, key text, value jsonb, created_at
 * timestamptz default now(), updated_at timestamptz default now())` — the
 * card's sketch, spelled in each dialect's own types, exactly as a hand-written
 * migration would. `withUpdatedAt: false` is the hand-migrated table that
 * genuinely lacks the column.
 *
 * The audit columns take the SAME physical types `createAuditTimestampColumn`
 * would have produced (`DATETIME(3)` on MySQL — #3942 — and the canonical
 * ISO-8601 `strftime` default on SQLite), so this fixture models a migration
 * that got the schema right, not one that diverged from the driver.
 */
function outOfBandDdl(cell: DialectCell, table: string, withUpdatedAt: boolean): string {
  const audit = (name: string) => {
    switch (cell.id) {
      case 'mysql':
        return `\`${name}\` datetime(3) default current_timestamp(3)`;
      case 'pg':
        return `"${name}" timestamptz default now()`;
      default:
        return `"${name}" text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
    }
  };
  const cols = [audit('created_at')];
  if (withUpdatedAt) cols.push(audit('updated_at'));
  if (cell.id === 'mysql') {
    return (
      `create table \`${table}\` (id varchar(64) primary key, \`key\` varchar(255), ` +
      `value json, ${cols.join(', ')})`
    );
  }
  const jsonType = cell.id === 'pg' ? 'jsonb' : 'text';
  return `create table "${table}" (id text primary key, "key" text, value ${jsonType}, ${cols.join(', ')})`;
}

/** Whatever the dialect handed back for an audit column, as epoch ms. */
function asInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const text = String(value);
  // SQLite stores TEXT. The canonical form already carries `Z`; a zone-naive
  // legacy form is read as UTC here rather than as host-local, matching what
  // `repairNaiveUtcAuditTimestamp` does on the read path.
  const parsed = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return parsed;
}

/** Read the audit columns straight out of storage, past every read-side coercion. */
async function readAudit(driver: SqlDriver, table: string, id: string) {
  const row: any = await (driver as any).knex(table).where('id', id).first();
  return {
    createdAt: asInstant(row.created_at),
    updatedAt: row.updated_at === undefined ? undefined : asInstant(row.updated_at),
    row,
  };
}

/** Force `updated_at` (or `created_at`) back to the sentinel, bypassing the driver. */
async function backdate(driver: SqlDriver, table: string, id: string, columns: string[]): Promise<void> {
  const patch: Record<string, unknown> = {};
  const iso = new Date(BACKDATED_MS).toISOString();
  for (const c of columns) {
    patch[c] = (driver as any).isSqlite ? iso : new Date(BACKDATED_MS);
  }
  await (driver as any).knex(table).where('id', id).update(patch);
}

/**
 * Count the SCHEMA-INTROSPECTION statements a block issues.
 *
 * `columnInfo()` compiles to `information_schema.columns` on Postgres and
 * MySQL and to `PRAGMA table_info` on SQLite, so one predicate covers all three
 * cells. This is what makes §3 a measurement of the round-trip budget rather
 * than a claim about it.
 */
async function countIntrospections(driver: SqlDriver, run: () => Promise<void>): Promise<number> {
  const knex = (driver as any).knex;
  let seen = 0;
  const onQuery = (q: any) => {
    if (/information_schema|pragma\s+table_info/i.test(String(q?.sql ?? ''))) seen += 1;
  };
  knex.on('query', onQuery);
  try {
    await run();
  } finally {
    knex.removeListener('query', onQuery);
  }
  return seen;
}

function measure(cell: DialectCell): void {
  describe(`#11067 — updated_at without DDL (${cell.label})`, () => {
    let driver: SqlDriver;
    // Short, dialect-safe table names: MySQL's identifier rules are the tightest.
    const WITH_COL = 'os11067_with';
    const NO_COL = 'os11067_nocol';
    const UNREGISTERED = 'os11067_unreg';
    const TX_TABLE = 'os11067_tx';

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      const knex = (driver as any).knex;
      for (const [table, withUpdatedAt] of [
        [WITH_COL, true],
        [NO_COL, false],
        [UNREGISTERED, true],
        [TX_TABLE, false],
      ] as const) {
        await knex.raw(outOfBandDdl(cell, table, withUpdatedAt));
      }
      // THE LINE UNDER TEST — the whole of what a `skipSchemaSync` boot does for
      // these objects. No CREATE TABLE, no ALTER TABLE, no round-trip.
      // `UNREGISTERED` is deliberately absent from this list (§4).
      driver.registerObjectMetadata([prefObject(WITH_COL), prefObject(NO_COL), prefObject(TX_TABLE)]);
    });

    afterAll(async () => {
      await driver?.disconnect();
    });

    // ── §1 The card's repro sketch, measured ────────────────────────────────

    it('§1 advances `updated_at` on a table the driver never ran DDL against', async () => {
      const id = 'w1';
      await driver.create(WITH_COL, { id, key: 'ui.recent', value: { a: 1 } }, OPTS);
      await backdate(driver, WITH_COL, id, ['created_at', 'updated_at']);
      const before = await readAudit(driver, WITH_COL, id);
      expect(before.updatedAt).toBe(BACKDATED_MS);

      await driver.update(WITH_COL, id, { key: 'ui.pinned' }, OPTS);

      const after = await readAudit(driver, WITH_COL, id);
      // The defect: today this equals BACKDATED_MS — the row's creation time,
      // frozen forever.
      expect(after.updatedAt).toBeGreaterThan(BACKDATED_MS);
      expect(after.updatedAt).toBeGreaterThan(Date.now() - 10 * 60_000);
      // `created_at` is the row's birth instant and the update must not disturb it.
      expect(after.createdAt).toBe(BACKDATED_MS);
      // …and the caller's own patch still landed.
      expect(after.row.key).toBe('ui.pinned');
    });

    it('§1b keeps an explicit `updated_at` under `preserveAudit` (historical import)', async () => {
      // #3493: the opt-in historical import is the one caller allowed to pin the
      // value. The inference must not force-advance past it.
      const id = 'w2';
      await driver.create(WITH_COL, { id, key: 'k', value: null }, OPTS);
      const supplied = new Date(BACKDATED_MS);
      await driver.update(
        WITH_COL,
        id,
        { key: 'k2', updated_at: (driver as any).isSqlite ? supplied.toISOString() : supplied },
        { ...OPTS, preserveAudit: true } as any,
      );
      const after = await readAudit(driver, WITH_COL, id);
      expect(after.updatedAt).toBe(BACKDATED_MS);
    });

    // ── §2 The pair's second half: the column genuinely is not there ────────

    it('§2 still updates a hand-migrated table that has NO `updated_at` column', async () => {
      const id = 'n1';
      await driver.create(NO_COL, { id, key: 'ui.recent', value: { a: 1 } }, OPTS);

      // The call that must NOT become a new rejection.
      const returned = await driver.update(NO_COL, id, { key: 'ui.pinned' }, OPTS);
      expect(returned).toBeTruthy();

      const after = await readAudit(driver, NO_COL, id);
      expect(after.updatedAt).toBeUndefined();
      expect(after.row.key).toBe('ui.pinned');

      // And it keeps working — the negative answer is remembered, not re-derived
      // into a second failure.
      await driver.update(NO_COL, id, { key: 'ui.third' }, OPTS);
      expect((await readAudit(driver, NO_COL, id)).row.key).toBe('ui.third');
    });

    // ── §3 The round-trip budget, measured rather than claimed ──────────────

    it('§3 spends ZERO introspection round-trips on the healthy table, and at most one on the other', async () => {
      const healthy = await countIntrospections(driver, async () => {
        await driver.create(WITH_COL, { id: 'w3', key: 'k', value: null }, OPTS);
        await driver.update(WITH_COL, 'w3', { key: 'k2' }, OPTS);
        await driver.update(WITH_COL, 'w3', { key: 'k3' }, OPTS);
      });
      // The currency `skipSchemaSync` exists to save. A fix that probes every
      // table on first write spends it on every table.
      expect(healthy).toBe(0);

      // §2 already resolved NO_COL, so by now it is settled and free.
      const settled = await countIntrospections(driver, async () => {
        await driver.update(NO_COL, 'n1', { key: 'k4' }, OPTS);
        await driver.update(NO_COL, 'n1', { key: 'k5' }, OPTS);
      });
      expect(settled).toBe(0);
    });

    // ── §4 Registration is what arms the inference ──────────────────────────

    it('§4 leaves an object the driver was never told about exactly as it was', async () => {
      const id = 'u1';
      await (driver as any).knex(UNREGISTERED).insert({ id, key: 'k', value: null });
      await backdate(driver, UNREGISTERED, id, ['created_at', 'updated_at']);

      await driver.update(UNREGISTERED, id, { key: 'k2' }, OPTS);

      const after = await readAudit(driver, UNREGISTERED, id);
      // Unchanged behaviour: nothing told this driver the object exists, so it
      // makes no claim about the physical shape and stamps nothing.
      expect(after.updatedAt).toBe(BACKDATED_MS);
      expect(after.row.key).toBe('k2');
    });

    // ── §5 The fallback must not poison a caller's transaction ──────────────

    it("§5 leaves the caller's transaction usable when the fallback fires inside it", async () => {
      // Postgres aborts the WHOLE transaction on any statement error (`25P02`),
      // so this is the leg that decides whether the recovery is safe at all.
      const id = 't1';
      const trx = await driver.beginTransaction();
      try {
        await driver.create(TX_TABLE, { id, key: 'k', value: null }, { ...OPTS, transaction: trx } as any);
        await driver.update(TX_TABLE, id, { key: 'k2' }, { ...OPTS, transaction: trx } as any);
        // The transaction is still usable AFTER the speculative write failed and
        // was recovered — this statement is the proof.
        await driver.update(TX_TABLE, id, { key: 'k3' }, { ...OPTS, transaction: trx } as any);
        await driver.commit(trx);
      } catch (error) {
        await driver.rollback(trx).catch(() => {});
        throw error;
      }
      const after = await readAudit(driver, TX_TABLE, id);
      expect(after.row.key).toBe('k3');
      expect(after.updatedAt).toBeUndefined();
    });

    // ── §6 A real dialect fault is still a real dialect fault ───────────────

    it('§6 does not swallow a write failure that has nothing to do with `updated_at`', async () => {
      // The fallback asks the database whether `updated_at` exists rather than
      // reading the error text, and rethrows the ORIGINAL error when it does.
      // Without this leg the recovery could turn any failing update into a
      // silent unstamped one.
      const id = 'w4';
      await driver.create(WITH_COL, { id, key: 'k', value: null }, OPTS);
      await expect(
        driver.update(WITH_COL, id, { no_such_column_11067: 'x' } as any, OPTS),
      ).rejects.toBeTruthy();
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'timestamps without DDL (#11067)', measure);
}
