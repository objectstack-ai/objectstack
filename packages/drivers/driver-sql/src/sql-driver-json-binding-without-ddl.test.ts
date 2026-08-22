// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10995] A JSON field must round-trip on Postgres when the driver was told
 * about its object WITHOUT running DDL.
 *
 * ## The defect, measured rather than inferred
 *
 * `formatInput` DOES `JSON.stringify` a JSON field's value on every non-SQLite
 * dialect — but only for fields listed in `jsonFields[object]`, and that
 * registry is filled exclusively by the DDL entry points (`initObjects` /
 * `syncSchema`, plus `registerExternalObject` for federated objects). A
 * deployment that manages DDL out-of-band — `skipSchemaSync` /
 * `OS_SKIP_SCHEMA_SYNC=1`, the documented posture after running migrations
 * manually, and the one cold-start-sensitive runtimes are told to use — never
 * calls them, so it serves writes with EVERY coercion registry empty. What
 * reaches Postgres is then whatever node-postgres does with a bare JS value:
 *
 * | value written to a `json` field | with an empty registry (measured on PG 16) |
 * | :--- | :--- |
 * | `{a:1}` object | JSON text — accidentally correct |
 * | `42` number | `42` — already valid JSON |
 * | `[{type:'app'}]` array | `{"(type,app)"}`-style ARRAY LITERAL → `22P02 invalid input syntax for type json` → 500 |
 * | `'x'` bare string | raw `x` → not JSON text (`"x"` would be) → 500 |
 * | `[]` empty array | array literal `{}` — **valid JSON**, so it is ACCEPTED and silently stored as an empty OBJECT |
 *
 * That last row is the one that outlives a fix aimed at the crashes: it does
 * not error, it corrupts. Every row above was reproduced against a live
 * Postgres before the fix, on INSERT and on UPDATE alike.
 *
 * ## Why no existing suite caught it
 *
 * `formatInput` ends with a bind-safety net that stringifies any leftover
 * object/array — gated on `isSqlite`, because better-sqlite3 cannot bind them
 * at all. So on SQLite an empty registry is invisible, and tenant environments
 * run Turso/SQLite: the seed and data suites exercise a different dialect
 * branch of the same function. Postgres has no such net, and both control
 * planes are Postgres.
 *
 * ## What this file pins, and on which driver path
 *
 * Every test in §1–§3 runs against a **live Postgres** (`OS_TEST_POSTGRES_URL`,
 * provisioned by CI's `temporal-conformance` job) through the real
 * `SqlDriver.create()` / `update()` paths — the dialect the defect is on.
 * §4 runs the same matrix on SQLite as an expected NON-effect. The tables here
 * are created with raw SQL, exactly as an out-of-band migration would, and the
 * driver under test never runs DDL against them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { PG_CELL, dialectCell } from './live-dialect-matrix.testkit.js';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';

const PG_URL = PG_CELL.url;

/** The object as an out-of-band migration would have created it. */
const PREF_FIELDS = {
  id: { type: 'text' },
  key: { type: 'text' },
  value: { type: 'json' },
} as const;

function prefObject(name: string) {
  return { name, fields: { ...PREF_FIELDS } } as any;
}

const OPTS = { bypassTenantAudit: true };

/** `create table … (id text primary key, key text, value jsonb)` — no driver DDL. */
async function migrateOutOfBand(driver: SqlDriver, table: string): Promise<void> {
  await (driver as any).knex.raw(
    `create table if not exists "${table}" (id text primary key, key text, value jsonb, ` +
      `created_at timestamptz, updated_at timestamptz)`,
  );
}

/** Write `value` on a fresh row and read back what storage actually holds. */
async function insertAndRead(driver: SqlDriver, table: string, value: unknown): Promise<any> {
  const id = `i_${Math.random().toString(36).slice(2, 10)}`;
  await driver.create(table, { id, key: 'ui.recent', value }, OPTS);
  const row: any = await driver.findOne(table, { where: { id } }, OPTS);
  return row?.value;
}

/** Seed a row, PATCH only `value` onto it, and read back what storage holds. */
async function updateAndRead(driver: SqlDriver, table: string, value: unknown): Promise<any> {
  const id = `u_${Math.random().toString(36).slice(2, 10)}`;
  await driver.create(table, { id, key: 'ui.recent', value: { seeded: true } }, OPTS);
  await driver.update(table, id, { value }, OPTS);
  const row: any = await driver.findOne(table, { where: { id } }, OPTS);
  return row?.value;
}

describe.skipIf(!PG_URL)('#10995 — live Postgres, driver told about the object without DDL', () => {
  // §1–§3 share one driver: the registration under test is per-object, and a
  // shared connection keeps the live cell to one pool.
  let driver: SqlDriver;
  const TABLE = 'os10995_pref';

  beforeAll(async () => {
    driver = new SqlDriver(PG_CELL.config());
    await migrateOutOfBand(driver, TABLE);
    // THE LINE UNDER TEST: the object's field types reach the driver with no
    // CREATE TABLE, no ALTER TABLE and no round-trip — what a `skipSchemaSync`
    // boot now does in place of doing nothing.
    driver.registerObjectMetadata([prefObject(TABLE)]);
  });

  afterAll(async () => {
    await driver?.disconnect();
  });

  // ── §1 The three rows the card is about ──────────────────────────────────

  it('§1a a NON-EMPTY ARRAY round-trips (insert and update)', async () => {
    const recents = [
      { type: 'app', id: 'crm' },
      { type: 'record', id: 'acc_1' },
    ];
    const inserted = await insertAndRead(driver, TABLE, recents);
    expect(Array.isArray(inserted)).toBe(true);
    expect(inserted).toEqual(recents);

    const updated = await updateAndRead(driver, TABLE, recents);
    expect(Array.isArray(updated)).toBe(true);
    expect(updated).toEqual(recents);
  });

  it('§1b a BARE STRING and the other scalar JSON documents round-trip (insert and update)', async () => {
    // `"x"` is a legal JSON document; a fix that special-cases arrays re-fails
    // this row, which is why it is pinned apart from §1a.
    expect(await insertAndRead(driver, TABLE, 'x')).toBe('x');
    expect(await updateAndRead(driver, TABLE, 'x')).toBe('x');

    expect(await insertAndRead(driver, TABLE, true)).toBe(true);
    expect(await updateAndRead(driver, TABLE, false)).toBe(false);
  });

  it('§1c an EMPTY ARRAY round-trips as [] — not as {}', async () => {
    // The row that does not crash. Postgres' array literal for `[]` is `{}`,
    // which is valid JSON, so the write was accepted and the value silently
    // became an empty OBJECT. Both halves are asserted: the shape that must be
    // there, and the shape that must NOT.
    const inserted = await insertAndRead(driver, TABLE, []);
    expect(Array.isArray(inserted)).toBe(true);
    expect(inserted).toEqual([]);
    expect(inserted).not.toEqual({});

    const updated = await updateAndRead(driver, TABLE, []);
    expect(Array.isArray(updated)).toBe(true);
    expect(updated).toEqual([]);
    expect(updated).not.toEqual({});
  });

  // ── §2 Expected NON-effects on the same path ─────────────────────────────

  it('§2 objects, nested arrays and numbers are unchanged (they already worked)', async () => {
    expect(await insertAndRead(driver, TABLE, { a: 1 })).toEqual({ a: 1 });
    expect(await updateAndRead(driver, TABLE, { items: [1, 2] })).toEqual({ items: [1, 2] });
    expect(await insertAndRead(driver, TABLE, 42)).toBe(42);
    // A non-JSON column keeps its own binding: `key` is text, and text is what
    // comes back — the registration must not turn every column into JSON.
    const id = `k_${Math.random().toString(36).slice(2, 10)}`;
    await driver.create(TABLE, { id, key: 'ui.recent', value: null }, OPTS);
    const row: any = await driver.findOne(TABLE, { where: { id } }, OPTS);
    expect(row.key).toBe('ui.recent');
    expect(row.value).toBeNull();
  });

  // ── §3 The other posture with the same empty registry: DDL REFUSED ───────

  it('§3 a datasource we are a guest in registers its objects even though DDL is refused', async () => {
    // `schemaMode !== 'managed'` (ADR-0015): `initObjects` must still refuse the
    // DDL — and must no longer leave the driver ignorant of the objects it was
    // just handed, which is what made every JSON write on a federated Postgres
    // datasource take the node-postgres defaults above.
    const guestTable = 'os10995_guest';
    const guest = new SqlDriver({ ...PG_CELL.config(), schemaMode: 'validate-only' } as any);
    try {
      await migrateOutOfBand(guest, guestTable);
      await expect(guest.initObjects([prefObject(guestTable)])).rejects.toBeInstanceOf(
        ExternalSchemaModeViolationError,
      );
      expect(await insertAndRead(guest, guestTable, [{ type: 'app' }])).toEqual([{ type: 'app' }]);
      expect(await updateAndRead(guest, guestTable, [])).toEqual([]);
      expect(await updateAndRead(guest, guestTable, 'x')).toBe('x');
    } finally {
      await guest.disconnect();
    }
  });
});

// ── §4 The SQLite path is unchanged ────────────────────────────────────────

describe('#10995 — the SQLite path is unaffected', () => {
  it('§4 round-trips the same matrix, with and without the DDL-free registration', async () => {
    const driver = new SqlDriver(dialectCell('sqlite').config());
    try {
      const TABLE = 'os10995_sqlite';
      await (driver as any).knex.raw(
        `create table if not exists "${TABLE}" (id text primary key, key text, value text)`,
      );
      // Un-registered, SQLite neither crashes nor corrupts: `formatInput`'s
      // dialect-local bind-safety net stringifies the array, so what lands on
      // disk is the right JSON text — it just comes back as TEXT, because the
      // read-side parse is keyed by the same empty registry. Storing the right
      // bytes is what makes the empty registry invisible here, and it is why
      // the SQLite/Turso suites never showed the Postgres defect.
      expect(await insertAndRead(driver, TABLE, [{ type: 'app' }])).toBe('[{"type":"app"}]');
      expect(await updateAndRead(driver, TABLE, [])).toBe('[]');

      // Registered: unchanged.
      driver.registerObjectMetadata([prefObject(TABLE)]);
      expect(await insertAndRead(driver, TABLE, [{ type: 'app' }])).toEqual([{ type: 'app' }]);
      expect(await updateAndRead(driver, TABLE, [])).toEqual([]);
      expect(await updateAndRead(driver, TABLE, 'x')).toBe('x');
      expect(await insertAndRead(driver, TABLE, { a: 1 })).toEqual({ a: 1 });
    } finally {
      await driver.disconnect();
    }
  });
});
