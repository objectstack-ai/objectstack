// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #37413 — a field declaring `defaultValue: 'NOW()'`, added to a SQLite table
 * that already holds a row.
 *
 * SQLite refuses a non-constant DEFAULT on `ALTER TABLE … ADD COLUMN` once the
 * table holds a row (`Cannot add a column with non-constant default`), and the
 * local face used to send one, failing the object's whole sync. The
 * `storage.notNull` contract names what such a change over existing rows is —
 * "a destructive migration gated by the schema-drift ceremony" — so the sync
 * does what it already does for a `storage.notNull` column it cannot complete
 * (#37258): it adds the column nullable with NO DEFAULT, fills the existing
 * rows in one statement with the instant the DEFAULT would have given them,
 * and leaves what is still owed to the differ and the ceremony.
 *
 * Pinned, for `datetime`, `date` and `time`, nullable and `storage.notNull`:
 *
 * 1. The sync succeeds; every existing row holds a value of the type's
 *    canonical shape, all of them the same instant.
 * 2. The differ lists exactly the owed entries for the column:
 *    `set_column_default`, and `tighten_not_null` when NOT NULL is declared.
 * 3. After the ceremony (`applyMigrationEntries`, the SQLite table rebuild),
 *    the column carries the declared `NOW()` DEFAULT, NOT NULL when declared,
 *    the rows keep their values, a later insert that omits the field takes the
 *    DEFAULT, and drift is empty.
 * 4. Control: an EMPTY table still gets the DEFAULT (and NOT NULL) at once,
 *    with no drift.
 * 5. The shard door (a rotation-declared object's current shard) fills the
 *    rows the same way.
 * 6. The backfill fills only NULLs: a value already in the column is kept.
 * 7. The differ's new arm, beyond this sync: a column that predates the
 *    `NOW()` declaration and has no DEFAULT reports `set_column_default`, and
 *    the ceremony clears it; a multi-value `NOW()` field and a column already
 *    carrying an expression DEFAULT report nothing.
 * 8. `autoMigrate: 'safe'`: the boot that adds the column also applies the
 *    owed DEFAULT (the rebuild); the next boot applies nothing.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { sqliteNowBackfillSql, sqliteNowColumnDefaultSql } from './sql-driver-schema-sync.js';
import type { ManagedDriftEntry } from './schema-drift.js';

const T = 'now_add_t';
const TYPES = ['datetime', 'date', 'time'] as const;
type Temporal = (typeof TYPES)[number];

const SHAPE: Record<Temporal, RegExp> = {
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d{3})?$/,
};

const V1 = { name: T, fields: { plain: { type: 'text' } } };
const V2 = (type: Temporal, notNull: boolean) => ({
  name: T,
  fields: {
    plain: { type: 'text' },
    added: { type, defaultValue: 'NOW()', ...(notNull ? { storage: { notNull: true } } : {}) },
  },
});

const ownedOps = (entries: readonly ManagedDriftEntry[]) =>
  entries.filter((e) => e.column === 'added').map((e) => e.op.type).sort();

let driver: SqlDriver | null = null;
afterEach(async () => {
  await driver?.disconnect().catch(() => {});
  driver = null;
});

async function open(extra: Record<string, unknown> = {}): Promise<SqlDriver> {
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, ...extra } as never);
  await driver.connect();
  return driver;
}

async function column(d: SqlDriver, table: string = T, name: string = 'added'): Promise<{ notnull: number; dflt_value: unknown }> {
  const rows: Array<{ name: string; notnull: number; dflt_value: unknown }> = await d.getKnex().raw(`PRAGMA table_info("${table}")`);
  const row = rows.find((r) => r.name === name);
  expect(row, 'the column was added').toBeDefined();
  return row!;
}

/** The DEFAULT text SQLite reports back for the expression the driver emits (outer parentheses dropped). */
const reported = (type: Temporal) => sqliteNowColumnDefaultSql(type).replace(/^\(/, '').replace(/\)$/, '');

describe.each(TYPES)('a NOW() %s field added to a populated SQLite table (#37413)', (type) => {
  describe.each([false, true])('storage.notNull: %s', (notNull) => {
    it('the sync fills the rows, the differ lists what is owed, and the ceremony leaves drift empty', async () => {
      const d = await open();
      await d.syncSchema(T, V1);
      await d.create(T, { id: 'r1', plain: 'x' });
      await d.create(T, { id: 'r2', plain: 'y' });

      // 1. The sync does not refuse; the column is added nullable, with no DEFAULT.
      await d.syncSchema(T, V2(type, notNull));
      expect(await column(d)).toMatchObject({ notnull: 0, dflt_value: null });
      const filled = (await d.getKnex()(T).select('added')).map((r: { added: unknown }) => r.added);
      expect(filled).toHaveLength(2);
      for (const v of filled) expect(String(v)).toMatch(SHAPE[type]);
      expect(new Set(filled).size, 'one statement, one instant').toBe(1);

      // 2. Exactly the owed entries.
      const owed = await d.detectManagedDrift([V2(type, notNull)]);
      expect(ownedOps(owed)).toEqual(notNull ? ['set_column_default', 'tighten_not_null'] : ['set_column_default']);

      // 3. The ceremony applies them through the SQLite rebuild.
      const { applied, skipped } = await d.applyMigrationEntries(owed, { allowDestructive: true });
      expect(skipped.filter((e) => e.column === 'added')).toEqual([]);
      expect(applied.filter((e) => e.column === 'added')).toHaveLength(notNull ? 2 : 1);
      expect(await column(d)).toMatchObject({ notnull: notNull ? 1 : 0, dflt_value: reported(type) });
      expect((await d.getKnex()(T).select('added').orderBy('id')).map((r: { added: unknown }) => r.added)).toEqual(filled);
      await d.getKnex()(T).insert({ id: 'r3', plain: 'z' });
      expect(String((await d.getKnex()(T).where({ id: 'r3' }).first()).added)).toMatch(SHAPE[type]);
      expect(await d.detectManagedDrift([V2(type, notNull)])).toEqual([]);
    });
  });
});

describe.each(TYPES)('control: a NOW() %s field added to an EMPTY SQLite table', (type) => {
  it.each([false, true])('storage.notNull: %s — the DEFAULT is emitted at once, with no drift', async (notNull) => {
    const d = await open();
    await d.syncSchema(T, V1);
    await d.syncSchema(T, V2(type, notNull));
    expect(await column(d)).toMatchObject({ notnull: notNull ? 1 : 0, dflt_value: reported(type) });
    expect(await d.detectManagedDrift([V2(type, notNull)])).toEqual([]);
  });
});

describe('the shard door: a rotation-declared object gains a NOW() field (#37413)', () => {
  const ROTATED = (fields: Record<string, unknown>) => ({
    name: 'rot_now',
    fields: { payload: { type: 'text' }, ...fields },
    lifecycle: { class: 'telemetry', storage: { strategy: 'rotation', shards: 3, unit: 'day' } },
  });

  it('adds the column to the populated current shard and fills its rows', async () => {
    const d = await open();
    await d.initObjects([ROTATED({})]);
    const shard = `rot_now__r${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    await d.create('rot_now', { id: 's1', payload: 'x' }, { bypassTenantAudit: true });

    await d.initObjects([ROTATED({ added: { type: 'datetime', defaultValue: 'NOW()' } })]);
    expect(await column(d, shard)).toMatchObject({ notnull: 0, dflt_value: null });
    const rows = (await d.execute(`SELECT added FROM "${shard}"`)) as Array<{ added: unknown }>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.added)).toMatch(SHAPE.datetime);
  });
});

describe('the backfill fills only NULLs (#37413)', () => {
  it('keeps a value a writer already stored, in a row the statement still visits for another column', async () => {
    const d = await open();
    const k = d.getKnex();
    await k.raw(`CREATE TABLE "${T}" (id text primary key, added datetime, on_day date)`);
    await k(T).insert([{ id: 'a', added: null, on_day: 'kept' }, { id: 'b', added: 'kept', on_day: null }]);
    const now = { defaultValue: 'NOW()' };
    await k.raw(sqliteNowBackfillSql(T, [['added', { type: 'datetime', ...now }], ['on_day', { type: 'date', ...now }]])!);
    const [a, b] = await k(T).select('id', 'added', 'on_day').orderBy('id');
    expect(String(a.added)).toMatch(SHAPE.datetime);
    expect(a.on_day).toBe('kept');
    expect(b.added).toBe('kept');
    expect(String(b.on_day)).toMatch(SHAPE.date);
  });
});

describe('the absent NOW() DEFAULT arm beyond this sync (#37413)', () => {
  it('reports a column that predates its NOW() declaration, and the ceremony clears it', async () => {
    const d = await open();
    await d.syncSchema(T, { name: T, fields: { plain: { type: 'text' }, added: { type: 'datetime' } } });
    await d.create(T, { id: 'r1', plain: 'x' });
    const declared = { name: T, fields: { plain: { type: 'text' }, added: { type: 'datetime', defaultValue: 'NOW()' } } };
    await d.syncSchema(T, declared);
    const owed = await d.detectManagedDrift([declared]);
    expect(ownedOps(owed)).toEqual(['set_column_default']);
    expect(owed.find((e) => e.column === 'added')?.category).toBe('safe');

    await d.applyMigrationEntries(owed);
    expect(await column(d)).toMatchObject({ dflt_value: reported('datetime') });
    // The ceremony restates the DEFAULT only; it rewrites no stored row.
    expect((await d.getKnex()(T).where({ id: 'r1' }).first()).added).toBeNull();
    expect(await d.detectManagedDrift([declared])).toEqual([]);
  });

  it('reports nothing for a multi-value field declaring NOW() (a JSON column, no scalar DEFAULT)', async () => {
    const d = await open();
    const declared = {
      name: T,
      fields: { tags: { type: 'select', multiple: true, options: [{ label: 'A', value: 'a' }], defaultValue: 'NOW()' } },
    };
    await d.syncSchema(T, declared);
    expect(await column(d, T, 'tags')).toMatchObject({ dflt_value: null });
    expect((await d.detectManagedDrift([declared])).filter((e) => e.column === 'tags')).toEqual([]);
  });

  it('reports nothing for a column that already carries an expression DEFAULT', async () => {
    const d = await open();
    await d.syncSchema(T, V1);
    await d.getKnex().raw(`ALTER TABLE "${T}" ADD COLUMN added datetime DEFAULT (datetime('now'))`);
    expect(await column(d)).toMatchObject({ dflt_value: "datetime('now')" });
    expect((await d.detectManagedDrift([V2('datetime', false)])).filter((e) => e.column === 'added')).toEqual([]);
  });
});

describe("autoMigrate: 'safe' (#37413)", () => {
  it('the boot that adds the column applies the owed DEFAULT by the rebuild; the next boot applies nothing', async () => {
    const d = await open({ autoMigrate: 'safe' });
    const lines: string[] = [];
    (d as unknown as { logger: unknown }).logger = {
      info: (m: string) => lines.push(String(m)),
      warn: (m: string) => lines.push(String(m)),
      error: (m: string) => lines.push(String(m)),
    };
    await d.initObjects([V1]);
    await d.create(T, { id: 'r1', plain: 'x' });

    await d.initObjects([V2('datetime', false)]);
    expect(lines.filter((l) => l.includes('auto-reconciled'))).toEqual([`[schema-drift] auto-reconciled set_column_default on ${T}.added`]);
    expect(await column(d)).toMatchObject({ dflt_value: reported('datetime') });
    expect(String((await d.getKnex()(T).where({ id: 'r1' }).first()).added)).toMatch(SHAPE.datetime);

    lines.length = 0;
    await d.initObjects([V2('datetime', false)]);
    expect(lines.filter((l) => l.includes('auto-reconciled'))).toEqual([]);
    expect(await d.detectManagedDrift([V2('datetime', false)])).toEqual([]);
  });
});
