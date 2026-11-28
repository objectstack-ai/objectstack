// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #37345 — the Turso REMOTE face gives a declared field's column the DEFAULT
 * the local face's `SqlDriver.createColumn` gives it (`applyDeclaredColumnDefault`),
 * from the shared `driver-sql` source (`emitsDeclaredColumnDefault`,
 * `sqliteDeclaredColumnDefaultSql`), and the shared drift differ reads a column
 * either face created as no drift.
 *
 * Before, `RemoteTransport` emitted no declared DEFAULT for any field: a fresh
 * remote table and a fresh local one disagreed on every declared default, and
 * a `storage.notNull` field with a literal default, added to a populated
 * table, was refused here and accepted locally (`turso-remote-not-null.test.ts`
 * case 5 pins that half).
 *
 * ## The instrument
 *
 * The one `turso-remote-not-null.test.ts` uses: the remote face is a
 * `TursoDriver` in remote mode over a real `@libsql/client` `file:` client; the
 * CONTROL is the local face (Knex) on a file of its own. Every DEFAULT is read
 * back from the database (`PRAGMA table_info` `dflt_value`, the raw value the
 * remote catalog read feeds the differ), never from statement text, and every
 * remote answer is held EQUAL to the local face's for the same declarations.
 *
 * ## What is pinned
 *
 * 1. `CREATE TABLE`, through each of the three remote schema doors: one
 *    `dflt_value` per column on both faces, for every kind of default — string
 *    (an embedded quote included, and the empty string), number, integer,
 *    boolean both ways, `toggle`, a date literal, a scalar literal on a
 *    JSON-typed column, `NOW()` on datetime / date / time and on a text field,
 *    and none for a multi-value column, a runtime token other than `NOW()` and
 *    an object; and a boolean declaring the string `'false'` / `'true'`
 *    (`'0'` / `'1'` on both faces). That equality is the pin on the literal
 *    rendering, which the local face leaves to knex and the shared renderer
 *    mirrors.
 * 2. Drift: a sync followed by a drift read reports nothing, read by either
 *    face over the remote database — the string-declared booleans included
 *    (#37434: the differ reads `'false'` / `'true'` on a boolean column as the
 *    booleans they spell).
 * 3. `ADD COLUMN` to an existing, EMPTY table: the same DEFAULTs, `NOW()`
 *    included, through each `ADD COLUMN` door, and no drift.
 * 4. `ADD COLUMN` to a POPULATED table: every literal DEFAULT is emitted (the
 *    existing row takes it); a `NOW()` DEFAULT is withheld (#37413), the
 *    column added nullable with none and the existing row filled in the same
 *    sync; either face's differ then reports exactly the owed
 *    `set_column_default` for each `NOW()` column, and nothing else.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { sqliteDeclaredColumnDefaultSql } from '@objectstack/driver-sql';
import { TursoDriver } from './turso-driver.js';

const scratch = mkdtempSync(join(tmpdir(), 'turso-remote-default-parity-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let seq = 0;
const nextFile = () => join(scratch, `db-${++seq}.db`);

const open: Array<{ driver: TursoDriver; client: Client | null }> = [];
afterEach(async () => {
  while (open.length) {
    const { driver, client } = open.pop()!;
    await driver.disconnect().catch(() => {});
    client?.close();
  }
});

type Objects = Parameters<TursoDriver['detectManagedDrift']>[0] & object;

/** A remote face over `file`, through a real libSQL `file:` client. */
async function remoteOver(file: string): Promise<TursoDriver> {
  const client = createClient({ url: `file:${file}` });
  const driver = new TursoDriver({ url: 'libsql://default-parity.example.turso.io', client });
  open.push({ driver, client });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return driver;
}

/** The local (Knex) face over `file`. */
async function localOver(file: string): Promise<TursoDriver> {
  const driver = new TursoDriver({ url: `file:${file}` });
  open.push({ driver, client: null });
  await driver.connect();
  expect(driver.transportMode).toBe('local');
  return driver;
}

/** Each column's raw `dflt_value`, through a connection of its own. */
async function columnDefaults(file: string, table: string): Promise<Record<string, unknown>> {
  const c = createClient({ url: `file:${file}` });
  try {
    const rows = (await c.execute(`PRAGMA table_info("${table}")`)).rows;
    return Object.fromEntries(rows.map((r) => [String(r.name), r.dflt_value]));
  } finally {
    c.close();
  }
}

const DEFAULTED: Record<string, Record<string, unknown>> = {
  s: { type: 'text', defaultValue: 'd' },
  quoted: { type: 'text', defaultValue: "it's" },
  n: { type: 'number', defaultValue: 5 },
  neg: { type: 'number', defaultValue: -2.5 },
  i: { type: 'integer', defaultValue: 7 },
  yes: { type: 'boolean', defaultValue: true },
  no: { type: 'boolean', defaultValue: false },
  day: { type: 'date', defaultValue: '2024-01-02' },
  sel: { type: 'select', options: [{ label: 'A', value: 'a' }], defaultValue: 'a' },
  required_nn: { type: 'text', defaultValue: 'x', storage: { notNull: true } },
  // The renderer's remaining branches: the second `table.boolean` type, the
  // empty string, and a JSON-typed column (a TEXT builder on SQLite, so knex's
  // catch-all) holding a scalar literal; and a boolean declaring the STRING
  // `'false'` / `'true'`, which knex reads as the boolean it spells.
  toggled: { type: 'toggle', defaultValue: true },
  off_text: { type: 'boolean', defaultValue: 'false' },
  on_text: { type: 'boolean', defaultValue: 'true' },
  empty: { type: 'text', defaultValue: '' },
  cfg: { type: 'json', defaultValue: 3 },
  at: { type: 'datetime', defaultValue: 'NOW()' },
  on: { type: 'date', defaultValue: 'NOW()' },
  clock: { type: 'time', defaultValue: 'NOW()' },
  stamp: { type: 'text', defaultValue: 'NOW()' },
  // No DEFAULT on either face: a multi-value column, a runtime token other than NOW(), an object.
  tags: { type: 'select', multiple: true, options: [{ label: 'A', value: 'a' }], defaultValue: 'a' },
  owner: { type: 'text', defaultValue: 'current_user' },
  blob: { type: 'json', defaultValue: { a: 1 } },
  plain: { type: 'text' },
};
const NAMES = Object.keys(DEFAULTED);
const NOW_NAMES = ['at', 'on', 'clock', 'stamp'];
const NONE = ['tags', 'owner', 'blob', 'plain'];
const OBJECT = { name: 'dflt_t', fields: DEFAULTED };
const BARE = { name: 'dflt_t', fields: { keep: { type: 'text' } } };
const WITH_BARE = { name: 'dflt_t', fields: { keep: { type: 'text' }, ...DEFAULTED } };

const pick = (all: Record<string, unknown>, names: string[]) => Object.fromEntries(names.map((n) => [n, all[n]]));

type Door = 'syncSchemasBatch' | 'syncSchema' | 'initObjects';
const SYNC: Record<Door, (d: TursoDriver, objects: Objects) => Promise<void>> = {
  syncSchemasBatch: (d, objects) => d.syncSchemasBatch(objects.map((o) => ({ object: o.name, schema: o }))),
  syncSchema: async (d, objects) => {
    for (const o of objects) await d.syncSchema(o.name, o);
  },
  initObjects: (d, objects) => d.initObjects(objects as never),
};

/** What the local face's `createColumn` gives these declarations on a fresh table: the reference. */
async function localReference(): Promise<Record<string, unknown>> {
  const file = nextFile();
  await (await localOver(file)).syncSchema(OBJECT.name, OBJECT);
  return pick(await columnDefaults(file, OBJECT.name), NAMES);
}

async function noDriftEitherFace(remote: TursoDriver, file: string, object: { name: string; fields: object }) {
  expect(await remote.detectManagedDrift([object as never])).toEqual([]);
  const local = await localOver(file);
  local.registerObjectMetadata([object as never]);
  expect(await local.detectManagedDrift([object as never])).toEqual([]);
}

describe('the reference: the local face DEFAULT per kind, and the shared renderer says the same', () => {
  it('reads as measured, and every DEFAULT is the one sqliteDeclaredColumnDefaultSql renders', async () => {
    const reference = await localReference();
    expect(pick(reference, ['s', 'quoted', 'n', 'neg', 'i', 'yes', 'no', 'day', 'sel', 'required_nn', 'toggled', 'off_text', 'on_text', 'empty', 'cfg'])).toEqual({
      s: "'d'", quoted: "'it''s'", n: "'5'", neg: "'-2.5'", i: "'7'", yes: "'1'", no: "'0'", day: "'2024-01-02'", sel: "'a'", required_nn: "'x'",
      toggled: "'1'", off_text: "'0'", on_text: "'1'", empty: "''", cfg: "'3'",
    });
    for (const name of NOW_NAMES) expect(String(reference[name])).toMatch(/^(strftime|case when strftime)/);
    expect(pick(reference, NONE)).toEqual({ tags: null, owner: null, blob: null, plain: null });
    // SQLite stores a DEFAULT expression without its outer parentheses.
    for (const name of NAMES) {
      const rendered = sqliteDeclaredColumnDefaultSql(DEFAULTED[name]);
      expect(rendered === null ? null : rendered.replace(/^\((.*)\)$/s, '$1')).toBe(reference[name]);
    }
  });
});

describe('CREATE TABLE: a fresh remote table carries the local face DEFAULTs', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])('synced through %s, and no drift', async (door) => {
    const reference = await localReference();
    const file = nextFile();
    const remote = await remoteOver(file);
    await SYNC[door](remote, [OBJECT]);

    expect(pick(await columnDefaults(file, OBJECT.name), NAMES)).toEqual(reference);
    await noDriftEitherFace(remote, file, OBJECT);
  });
});

describe('ADD COLUMN to an existing, empty table: the same DEFAULTs, NOW() included', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])('synced through %s, and no drift', async (door) => {
    const reference = await localReference();
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchema(BARE.name, BARE);
    await SYNC[door](remote, [WITH_BARE]);

    expect(pick(await columnDefaults(file, OBJECT.name), NAMES)).toEqual(reference);
    await noDriftEitherFace(remote, file, WITH_BARE);
  });
});

describe('ADD COLUMN to a populated table: every literal DEFAULT, never the NOW() expression (#37413)', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema'])('synced through %s: the row takes each literal, NOW() columns get none and are filled, only their DEFAULT is owed', async (door) => {
    const reference = await localReference();
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchema(BARE.name, BARE);
    await remote.create(BARE.name, { id: 'r1', keep: 'k' });
    await SYNC[door](remote, [WITH_BARE]);

    const literals = NAMES.filter((n) => !NOW_NAMES.includes(n));
    const defaults = await columnDefaults(file, OBJECT.name);
    expect(pick(defaults, literals)).toEqual(pick(reference, literals));
    expect(pick(defaults, NOW_NAMES)).toEqual({ at: null, on: null, clock: null, stamp: null });

    const row = await remote.findOne(OBJECT.name, { where: { id: 'r1' } });
    expect(row).toMatchObject({ s: 'd', quoted: "it's", n: 5, i: 7, yes: true, no: false, day: '2024-01-02', required_nn: 'x' });
    for (const name of NOW_NAMES) expect((row as Record<string, unknown>)[name], name).not.toBeNull();
    await ownedNowDefaultsEitherFace(remote, file, WITH_BARE);
  });
});

/** [#37413] Each face's differ reports exactly a `set_column_default` per withheld `NOW()` column, and nothing else. */
async function ownedNowDefaultsEitherFace(remote: TursoDriver, file: string, object: { name: string; fields: object }) {
  const owed = (entries: readonly { op: { type: string }; column?: string }[]) => entries.map((e) => `${e.op.type}:${e.column}`).sort();
  const expected = NOW_NAMES.map((n) => `set_column_default:${n}`).sort();
  expect(owed(await remote.detectManagedDrift([object as never]))).toEqual(expected);
  const local = await localOver(file);
  local.registerObjectMetadata([object as never]);
  expect(owed(await local.detectManagedDrift([object as never]))).toEqual(expected);
}
