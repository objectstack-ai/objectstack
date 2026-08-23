// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11176] The two write doors that did not advance `updated_at`: `updateMany()`
 * on every dialect, and `upsert()`'s merge branch on Postgres and MySQL.
 *
 * ## Not #11067, and the difference is what this file is set up to show
 *
 * #11067 is about `tablesWithTimestamps` being filled only by DDL, so a
 * `skipSchemaSync` deployment never stamped. These two are missing on EVERY
 * deployment — so almost every table here is built by the driver's own
 * `initObjects`, with `tablesWithTimestamps` correctly populated. That is the
 * configuration the card measured live, and the one in which the defect is not
 * supposed to exist at all.
 *
 * ## §1–§2 `updateMany()` stamped nothing
 *
 * `update()` and `rotatedUpdateById()` both consult `stampsUpdatedAt` and write
 * `updated_at`; `updateMany()` did neither. The column carries an INSERT-time
 * `DEFAULT now()` and no `ON UPDATE` clause or trigger on any dialect this
 * driver speaks, so every row a bulk edit touched kept reading its previous
 * value. Nothing errors — list-view sorts, delta/incremental sync, cache
 * invalidation and audit answers are simply wrong.
 *
 * §2 pins the other end of the same contract: #3493's opt-in historical import
 * (`preserveAudit` + an explicit `updated_at`) must NOT be force-advanced, so
 * this door reaches the same decision `update()` does rather than a private one.
 *
 * ## §3–§5 `upsert()`'s merge branch, and the dialect asymmetry
 *
 * The merge set is derived from the KEYS of `formatted`, so a column that is not
 * in the payload is not in `ON CONFLICT … DO UPDATE`. `stampInsertTimestamps`
 * puts `updated_at` there on SQLite and returns early on every other dialect
 * (`if (!this.isSqlite …) return`), because the column DEFAULT already stores a
 * zone-aware instant on insert. A DEFAULT does not re-fire on the conflict path.
 * **So SQLite was accidentally correct and Postgres/MySQL were not** — which is
 * why §3 running only on SQLite would be green before and after and prove
 * nothing. Every cell here runs on SQLite AND on live Postgres / MySQL through
 * `declareDialectCell`, so an unprovisioned dialect is REPORTED, never omitted.
 *
 * §4 is the guard on the OTHER branch of the same statement. The stamp lands in
 * the INSERT payload too, and `updatedAtStamp()`'s bare `knex.fn.now()` compiles
 * to an unqualified `CURRENT_TIMESTAMP` that MySQL truncates to whole seconds —
 * against a `DATETIME(3)` column whose DEFAULT is `now(3)`. Using it here would
 * make a freshly INSERTED row's `updated_at` read up to 999 ms earlier than its
 * `created_at`: a new defect on a branch that had none. `upsertUpdatedAtStamp()`
 * matches the column default's precision, and §4 is what measures that.
 *
 * §5 pins #7011/#8622's insert-only columns against the new payload key:
 * `created_at` is the row's birth instant and must not move when the merge
 * advances `updated_at`.
 *
 * ## §6 The narrowing, stated as a measurement rather than a claim
 *
 * The upsert stamp reads `observedUpdatedAtColumn` — DDL-observed, or settled
 * `present` by a successful stamped UPDATE — and deliberately NOT #11067's
 * `presumed` state. `presumed` exists so an UPDATE can speculate and then
 * RECOVER (`updateWithPresumedTimestamp`); the upsert door has no such recovery,
 * and a wrong presumption there would name a missing column in an INSERT column
 * list, turning a working call into a hard failure. §6 measures that a
 * hand-migrated table with no `updated_at` still upserts — the property that
 * would break first if the narrowing were ever widened without a recovery.
 *
 * `updateMany` has no such narrowing: it is an UPDATE door, so it reuses
 * #11067's machinery whole (§7).
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring `main`'s `updateMany` body turns §1 and §7 red with the frozen
 * sentinel as the received value (`2020-01-01T00:00:00.000Z`, six years from the
 * asserted "greater than"). Deleting the `stampUpsertUpdatedAt` call turns §3
 * red on the live Postgres and MySQL cells ONLY, and leaves the SQLite cell
 * green — the asymmetry itself, observed rather than argued.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — these fixtures are not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

/**
 * The instant a row is backdated to before the write under test.
 *
 * A sentinel far in the past rather than a sleep, for #11067's reason: MySQL's
 * unqualified `CURRENT_TIMESTAMP` carries no fractional digits, so a stamp a few
 * hundred ms after an insert default of `current_timestamp(3)` can legitimately
 * land on the same stored value. Backdating removes the race without weakening
 * the assertion — the stamp either moved to ~now or did not move at all, and
 * those are six years apart.
 */
const BACKDATED_MS = Date.parse('2020-01-01T00:00:00.000Z');

const BULK = 'os11176_bulk';
const MERGE = 'os11176_merge';
const PRESUMED = 'os11176_pres';
const NO_COL = 'os11176_nocol';

/** A DDL-managed object: `initObjects` builds the table, audit columns included. */
function managedObject(name: string) {
  return {
    name,
    fields: {
      id: { type: 'text' },
      // `string`, not `text`: §3b puts a UNIQUE index on `status`, and MySQL
      // refuses to index a TEXT column without a key length ("BLOB/TEXT column
      // used in key specification without a key length"). Measured — that leg
      // failed on the MySQL cell for that reason in the FIRST baseline run, in
      // which state it was not measuring the timestamp at all.
      title: { type: 'string' },
      status: { type: 'string' },
    },
  } as any;
}

/**
 * `create table t (id …, title …, status …, created_at … default now()[, updated_at
 * … default now()])` — a hand-written migration, in each dialect's own types.
 *
 * The audit columns take the SAME physical types `createAuditTimestampColumn`
 * produces (`DATETIME(3)` on MySQL — #3942 — and the canonical ISO-8601
 * `strftime` default on SQLite), so these model a migration that got the schema
 * right. `withUpdatedAt: false` is the one that genuinely diverged.
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
      `create table \`${table}\` (id varchar(64) primary key, title varchar(255), ` +
      `status varchar(255), ${cols.join(', ')})`
    );
  }
  return `create table "${table}" (id text primary key, title text, status text, ${cols.join(', ')})`;
}

/** Whatever the dialect handed back for an audit column, as epoch ms. */
function asInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const text = String(value);
  // SQLite stores TEXT. The canonical form already carries `Z`; a zone-naive
  // legacy form is read as UTC here rather than as host-local, matching what
  // `repairNaiveUtcAuditTimestamp` does on the read path.
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
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

/** Force the audit columns back to the sentinel, bypassing the driver. */
async function backdate(driver: SqlDriver, table: string, ids: string[], columns: string[]): Promise<void> {
  const patch: Record<string, unknown> = {};
  const iso = new Date(BACKDATED_MS).toISOString();
  for (const c of columns) patch[c] = (driver as any).isSqlite ? iso : new Date(BACKDATED_MS);
  await (driver as any).knex(table).whereIn('id', ids).update(patch);
}

function measure(cell: DialectCell): void {
  describe(`#11176 — bulk and merge writes advance updated_at (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // The DDL path: `tablesWithTimestamps` is filled for these two, which is
      // exactly the deployment the card measured the defect on.
      await driver.initObjects([managedObject(BULK), managedObject(MERGE)]);
      // …and two tables the driver is only TOLD about (`skipSchemaSync`), one of
      // which genuinely lacks the column. §6 and §7 live here.
      const knex = (driver as any).knex;
      await knex.raw(outOfBandDdl(cell, PRESUMED, true));
      await knex.raw(outOfBandDdl(cell, NO_COL, false));
      driver.registerObjectMetadata([managedObject(PRESUMED), managedObject(NO_COL)]);
    });

    afterAll(async () => {
      await driver?.disconnect();
    });

    // ── §1 `updateMany()` stamps ────────────────────────────────────────────

    it('§1 advances `updated_at` on every row a bulk update touched', async () => {
      await driver.create(BULK, { id: 'b1', title: 'one', status: 'open' }, OPTS);
      await driver.create(BULK, { id: 'b2', title: 'two', status: 'open' }, OPTS);
      // A row the filter must not touch — proof the stamp rides the WHERE rather
      // than the table.
      await driver.create(BULK, { id: 'b3', title: 'three', status: 'closed' }, OPTS);
      await backdate(driver, BULK, ['b1', 'b2', 'b3'], ['created_at', 'updated_at']);

      const affected = await driver.updateMany(BULK, { where: { status: 'open' } }, { status: 'done' }, OPTS);
      expect(affected).toBe(2);

      for (const id of ['b1', 'b2']) {
        const after = await readAudit(driver, BULK, id);
        // The defect: before this card these equalled BACKDATED_MS — the value
        // the row already carried, left untouched by the bulk write.
        expect(after.updatedAt).toBeGreaterThan(BACKDATED_MS);
        expect(after.updatedAt).toBeGreaterThan(Date.now() - 10 * 60_000);
        // `created_at` is the row's birth instant; a bulk update must not move it.
        expect(after.createdAt).toBe(BACKDATED_MS);
        // …and the caller's own patch still landed.
        expect(after.row.status).toBe('done');
      }

      const untouched = await readAudit(driver, BULK, 'b3');
      expect(untouched.updatedAt).toBe(BACKDATED_MS);
      expect(untouched.row.status).toBe('closed');
    });

    it('§2 keeps an explicit `updated_at` under `preserveAudit` (historical import)', async () => {
      // #3493: the opt-in historical import is the one caller allowed to pin the
      // value, and this door must reach the SAME decision `update()` does.
      await driver.create(BULK, { id: 'b4', title: 'four', status: 'import' }, OPTS);
      const supplied = new Date(BACKDATED_MS);
      await driver.updateMany(
        BULK,
        { where: { status: 'import' } },
        { title: 'four!', updated_at: (driver as any).isSqlite ? supplied.toISOString() : supplied },
        { ...OPTS, preserveAudit: true },
      );
      const after = await readAudit(driver, BULK, 'b4');
      expect(after.updatedAt).toBe(BACKDATED_MS);
      expect(after.row.title).toBe('four!');
    });

    // ── §3 `upsert()`'s merge branch, on every dialect ───────────────────────

    it('§3 advances `updated_at` when an upsert MERGES onto an existing row', async () => {
      const id = 'm1';
      await driver.upsert(MERGE, { id, title: 'first', status: 'open' }, undefined, OPTS);
      await backdate(driver, MERGE, [id], ['created_at', 'updated_at']);
      const before = await readAudit(driver, MERGE, id);
      expect(before.updatedAt).toBe(BACKDATED_MS);

      await driver.upsert(MERGE, { id, title: 'second', status: 'open' }, undefined, OPTS);

      const after = await readAudit(driver, MERGE, id);
      expect(after.row.title).toBe('second'); // the merge landed
      // The defect, on Postgres and MySQL only: this equalled BACKDATED_MS —
      // still the INSERT-time value, because `ON CONFLICT … DO UPDATE` never
      // named the column. SQLite was already correct here.
      expect(after.updatedAt).toBeGreaterThan(BACKDATED_MS);
      expect(after.updatedAt).toBeGreaterThan(Date.now() - 10 * 60_000);
    });

    it('§3b advances it when the conflict target is a BUSINESS key, not `id`', async () => {
      // The merge set is built the same way whichever column the conflict is
      // targeted at, but this is the shape a connector/seed import actually
      // writes, and it is the shape #8622 showed behaves differently.
      const knex = (driver as any).knex;
      await knex.raw(
        cell.id === 'mysql'
          ? `create unique index os11176_mk on \`${MERGE}\` (status)`
          : `create unique index os11176_mk on "${MERGE}" (status)`,
      );
      await driver.upsert(MERGE, { id: 'k1', title: 'a', status: 'sku-1' }, ['status'], OPTS);
      await backdate(driver, MERGE, ['k1'], ['created_at', 'updated_at']);

      // `id` supplied deliberately: with a rival UNIQUE key on the table, MySQL's
      // #8807 pre-flight arms the landed-on-supplied-identity check, and a
      // freshly minted nanoid would be refused there — a different card's
      // contract, not this one's. The conflict is still TARGETED at `status`.
      await driver.upsert(MERGE, { id: 'k1', title: 'b', status: 'sku-1' }, ['status'], OPTS);

      const after = await readAudit(driver, MERGE, 'k1');
      expect(after.row.title).toBe('b');
      expect(after.updatedAt).toBeGreaterThan(BACKDATED_MS);
    });

    it('§3c preserves an `updated_at` the CALLER supplied', async () => {
      // Same rule `stampInsertTimestamps` follows: only an empty slot is filled.
      const id = 'm2';
      const supplied = new Date(BACKDATED_MS);
      const value = (driver as any).isSqlite ? supplied.toISOString() : supplied;
      await driver.upsert(MERGE, { id, title: 'x', status: 'sku-2' }, undefined, OPTS);
      await driver.upsert(MERGE, { id, title: 'y', status: 'sku-2', updated_at: value }, undefined, OPTS);
      const after = await readAudit(driver, MERGE, id);
      expect(after.row.title).toBe('y');
      expect(after.updatedAt).toBe(BACKDATED_MS);
    });

    // ── §4 The INSERT branch of the same statement is not disturbed ──────────

    it('§4 leaves a freshly INSERTED upsert row with `updated_at` >= `created_at`', async () => {
      // The stamp lands in the INSERT payload too. On MySQL the audit columns
      // are `DATETIME(3)` defaulted with `now(3)`, and an unqualified
      // `CURRENT_TIMESTAMP` truncates to whole seconds — which would put a brand
      // new row's `updated_at` up to 999 ms BEFORE its own `created_at`. This is
      // the measurement that keeps the two expressions precision-matched.
      const id = 'm3';
      await driver.upsert(MERGE, { id, title: 'fresh', status: 'sku-3' }, undefined, OPTS);
      const after = await readAudit(driver, MERGE, id);
      expect(after.updatedAt).toBeGreaterThanOrEqual(after.createdAt);
      expect(after.updatedAt! - after.createdAt).toBeLessThan(1_000);
    });

    // ── §5 The insert-only columns stay insert-only ──────────────────────────

    it('§5 does not move `created_at` when the merge advances `updated_at`', async () => {
      const id = 'm4';
      await driver.upsert(MERGE, { id, title: 'p', status: 'sku-4' }, undefined, OPTS);
      await backdate(driver, MERGE, [id], ['created_at', 'updated_at']);
      await driver.upsert(MERGE, { id, title: 'q', status: 'sku-4' }, undefined, OPTS);
      const after = await readAudit(driver, MERGE, id);
      // #7011/#8622: `created_at` belongs to the original insert.
      expect(after.createdAt).toBe(BACKDATED_MS);
      expect(after.updatedAt).toBeGreaterThan(BACKDATED_MS);
      expect(after.row.id).toBe(id);
    });

    // ── §6 The declared narrowing, measured at the property that would break ──

    it('§6 still upserts a hand-migrated table that has NO `updated_at` column', async () => {
      // The upsert stamp reads the OBSERVED answer, never #11067's presumption,
      // because this door has no recovery to fall back on. If that narrowing is
      // ever widened without one, this is the call that stops working.
      const id = 'n1';
      await driver.upsert(NO_COL, { id, title: 'a', status: 's' }, undefined, OPTS);
      await driver.upsert(NO_COL, { id, title: 'b', status: 's' }, undefined, OPTS);
      const after = await readAudit(driver, NO_COL, id);
      expect(after.updatedAt).toBeUndefined();
      expect(after.row.title).toBe('b');
    });

    // ── §7 `updateMany` reuses #11067's machinery whole ──────────────────────

    it('§7 stamps a `skipSchemaSync` table, and still updates one without the column', async () => {
      // The presumption and its recovery, exercised through the bulk door: it is
      // an UPDATE door, so it reaches the identical decision `update()` does
      // rather than a private copy of it.
      await driver.create(PRESUMED, { id: 'p1', title: 'a', status: 'open' }, OPTS);
      await backdate(driver, PRESUMED, ['p1'], ['created_at', 'updated_at']);
      const affected = await driver.updateMany(PRESUMED, { where: { status: 'open' } }, { title: 'b' }, OPTS);
      expect(affected).toBe(1);
      const presumed = await readAudit(driver, PRESUMED, 'p1');
      expect(presumed.updatedAt).toBeGreaterThan(BACKDATED_MS);
      expect(presumed.row.title).toBe('b');

      // The other half of #11067's pair: a table that genuinely lacks the column
      // must NOT gain a new rejection.
      await driver.create(NO_COL, { id: 'n2', title: 'a', status: 'bulk' }, OPTS);
      const touched = await driver.updateMany(NO_COL, { where: { status: 'bulk' } }, { title: 'b' }, OPTS);
      expect(touched).toBe(1);
      const nocol = await readAudit(driver, NO_COL, 'n2');
      expect(nocol.updatedAt).toBeUndefined();
      expect(nocol.row.title).toBe('b');
    });

    it('§7b leaves an object the driver was never told about exactly as it was', async () => {
      // Unchanged behaviour: nothing told this driver the object exists, so it
      // makes no claim about the physical shape and stamps nothing.
      const knex = (driver as any).knex;
      const table = 'os11176_unreg';
      await knex.raw(outOfBandDdl(cell, table, true));
      await knex(table).insert({ id: 'u1', title: 'a', status: 'open' });
      await backdate(driver, table, ['u1'], ['created_at', 'updated_at']);
      await driver.updateMany(table, { where: { status: 'open' } }, { title: 'b' }, OPTS);
      const after = await readAudit(driver, table, 'u1');
      expect(after.updatedAt).toBe(BACKDATED_MS);
      expect(after.row.title).toBe('b');
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'bulk and merge updated_at (#11176)', measure);
}
