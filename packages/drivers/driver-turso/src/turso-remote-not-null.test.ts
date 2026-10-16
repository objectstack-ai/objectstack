// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23847 — the Turso REMOTE face's schema sync creates the NOT NULL a field's
 * `storage: { notNull: true }` declares (ADR-0113), on `CREATE TABLE` and on
 * `ALTER TABLE … ADD COLUMN`, as the local face's `SqlDriver.createColumn`
 * does.
 *
 * Before, `RemoteTransport` never emitted the constraint: the declaration was
 * unenforced on every Turso remote database, and the shared drift differ read
 * each such column as DESTRUCTIVE `tighten_not_null` drift against a table the
 * remote sync had itself just created.
 *
 * ## The instrument
 *
 * The one `turso-remote-drift-detection.test.ts` uses: the remote face is a
 * `TursoDriver` in remote mode over a real `@libsql/client` `file:` client, so
 * its DDL runs on a real libSQL connection; the CONTROL is the local face
 * (Knex) on a file of its own, or on the same file. The constraint is read
 * back from the database (`PRAGMA table_info`), never from the statement text,
 * and every remote answer is held EQUAL to the local face's answer for the
 * same declarations.
 *
 * ## What is pinned
 *
 * 1. A fresh remote database synced through each of the three remote schema
 *    doors carries the local face's `notnull` flag on every declared column,
 *    and reports no drift, read by either face.
 * 2. The same through `ALTER TABLE … ADD COLUMN`: declared fields added to an
 *    existing, empty table.
 * 3. The constraint is enforced: an insert that leaves a `storage.notNull`
 *    column NULL is refused by the database, as it is locally.
 * 4. A populated table: SQLite refuses `ADD COLUMN … NOT NULL` without a
 *    non-NULL DEFAULT, on both faces alike. The remote refusal names the
 *    statement, and no nullable column is slipped in instead.
 * 5. RECORDED ASYMMETRY — a `storage.notNull` field that also declares a
 *    literal `defaultValue`, added to a populated table: the local face emits
 *    the DEFAULT and accepts; this face emits no declared DEFAULT and refuses.
 *    A DEFAULT question, not a nullability one (see
 *    `RemoteTransport.columnDeclarationSQL`). When this face starts emitting
 *    declared defaults, INVERT this case; ⛔ never loosen the NOT NULL to
 *    make it pass.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { TursoDriver } from './turso-driver.js';

const scratch = mkdtempSync(join(tmpdir(), 'turso-remote-not-null-'));
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
  const driver = new TursoDriver({ url: 'libsql://not-null.example.turso.io', client });
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

/** Each column's `notnull` flag as the database reports it, through a connection of its own. */
async function notNullFlags(file: string, table: string): Promise<Record<string, number>> {
  const c = createClient({ url: `file:${file}` });
  try {
    const rows = (await c.execute(`PRAGMA table_info("${table}")`)).rows;
    return Object.fromEntries(rows.map((r) => [String(r.name), Number(r.notnull)]));
  } finally {
    c.close();
  }
}

const pick = (flags: Record<string, number>, names: string[]) =>
  Object.fromEntries(names.map((n) => [n, flags[n]]));

const DECLARED = {
  name: 'nn_t',
  fields: {
    title: { type: 'text', storage: { notNull: true } },
    amount: { type: 'number', storage: { notNull: true } },
    active: { type: 'boolean', storage: { notNull: true } },
    // #17231's case on the local face: a multi-value JSON column is constrained too.
    tags: { type: 'select', multiple: true, options: [{ label: 'A', value: 'a' }], storage: { notNull: true } },
    // ADR-0113: `required` is the write-time contract, never the column constraint.
    note: { type: 'text', required: true },
    relaxed: { type: 'text', storage: { notNull: false } },
    plain: { type: 'text' },
  },
};
const FIELDS = Object.keys(DECLARED.fields);
const ONLY_PLAIN = { name: DECLARED.name, fields: { plain: { type: 'text' } } };

type Door = 'syncSchemasBatch' | 'syncSchema' | 'initObjects';
const SYNC: Record<Door, (d: TursoDriver, objects: Objects) => Promise<void>> = {
  syncSchemasBatch: (d, objects) => d.syncSchemasBatch(objects.map((o) => ({ object: o.name, schema: o }))),
  syncSchema: async (d, objects) => {
    for (const o of objects) await d.syncSchema(o.name, o);
  },
  initObjects: (d, objects) => d.initObjects(objects as never),
};

/** What the local face's `createColumn` gives these declarations: the reference. */
async function localReference(): Promise<Record<string, number>> {
  const file = nextFile();
  await (await localOver(file)).syncSchema(DECLARED.name, DECLARED);
  return pick(await notNullFlags(file, DECLARED.name), FIELDS);
}

describe('CREATE TABLE: a fresh remote database carries the declared NOT NULL', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])('synced through %s', async (door) => {
    const reference = await localReference();
    expect(reference).toEqual({ title: 1, amount: 1, active: 1, tags: 1, note: 0, relaxed: 0, plain: 0 });

    const file = nextFile();
    const remote = await remoteOver(file);
    await SYNC[door](remote, [DECLARED]);

    expect(pick(await notNullFlags(file, DECLARED.name), FIELDS)).toEqual(reference);
    expect(await remote.detectManagedDrift([DECLARED])).toEqual([]);
    const local = await localOver(file);
    local.registerObjectMetadata([DECLARED]);
    expect(await local.detectManagedDrift([DECLARED])).toEqual([]);
  });
});

describe('ADD COLUMN: declared fields added to an existing, empty table carry it too', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])('synced through %s', async (door) => {
    const reference = await localReference();
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchema(ONLY_PLAIN.name, ONLY_PLAIN);
    await SYNC[door](remote, [DECLARED]);

    expect(pick(await notNullFlags(file, DECLARED.name), FIELDS)).toEqual(reference);
    expect(await remote.detectManagedDrift([DECLARED])).toEqual([]);
  });
});

describe('the constraint is enforced, as on the local face', () => {
  it('an insert leaving a storage.notNull column NULL is refused by the database on both faces', async () => {
    const remoteFile = nextFile();
    const remote = await remoteOver(remoteFile);
    await remote.syncSchema(DECLARED.name, DECLARED);
    const localFile = nextFile();
    const local = await localOver(localFile);
    await local.syncSchema(DECLARED.name, DECLARED);

    const row = { id: 'r1', amount: 1, active: true, tags: ['a'], plain: 'p' }; // no `title`
    for (const face of [remote, local]) {
      await expect(face.create(DECLARED.name, row)).rejects.toThrow(/NOT NULL constraint failed: nn_t\.title/);
    }
    for (const file of [remoteFile, localFile]) {
      const c = createClient({ url: `file:${file}` });
      try {
        expect((await c.execute('SELECT count(*) AS n FROM nn_t')).rows[0]!.n).toBe(0);
      } finally {
        c.close();
      }
    }
  });
});

describe('ADD COLUMN on a populated table', () => {
  const ADDED = { type: 'text', storage: { notNull: true } };
  const WITH_ADDED = (added: object) => ({ name: 'rows_t', fields: { plain: { type: 'text' }, added } });

  async function populated(face: 'remote' | 'local') {
    const file = nextFile();
    const driver = face === 'remote' ? await remoteOver(file) : await localOver(file);
    await driver.syncSchema('rows_t', { name: 'rows_t', fields: { plain: { type: 'text' } } });
    await driver.create('rows_t', { id: 'r1', plain: 'x' });
    return { file, driver };
  }

  it.each<Door>(['syncSchemasBatch', 'syncSchema'])(
    'with no DEFAULT: refused through %s, as locally, naming the statement, with no nullable column slipped in',
    async (door) => {
      const local = await populated('local');
      await expect(local.driver.syncSchema('rows_t', WITH_ADDED(ADDED))).rejects.toThrow(
        /Cannot add a NOT NULL column with default value NULL/,
      );
      expect(await notNullFlags(local.file, 'rows_t')).not.toHaveProperty('added');

      const remote = await populated('remote');
      const refusal = SYNC[door](remote.driver, [WITH_ADDED(ADDED)]);
      await expect(refusal).rejects.toMatchObject({ code: 'SQLITE_ERROR' });
      await expect(refusal).rejects.toThrow(/Cannot add a NOT NULL column with default value NULL/);
      if (door === 'syncSchema') {
        // The engine's per-object report names the object only; the statement names the column.
        await expect(refusal).rejects.toThrow('ALTER TABLE "rows_t" ADD COLUMN "added" TEXT NOT NULL');
      }
      expect(await notNullFlags(remote.file, 'rows_t')).not.toHaveProperty('added');
    },
  );

  it('RECORDED ASYMMETRY: with a literal defaultValue the local face accepts and this face refuses', async () => {
    const withDefault = WITH_ADDED({ ...ADDED, defaultValue: 'd' });

    const local = await populated('local');
    await local.driver.syncSchema('rows_t', withDefault);
    expect((await notNullFlags(local.file, 'rows_t')).added).toBe(1);

    const remote = await populated('remote');
    await expect(remote.driver.syncSchema('rows_t', withDefault)).rejects.toThrow(
      /Cannot add a NOT NULL column with default value NULL/,
    );
    expect(await notNullFlags(remote.file, 'rows_t')).not.toHaveProperty('added');
  });
});
