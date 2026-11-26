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
 * 4. A populated table, no DEFAULT its rows can take (none, or a runtime
 *    token other than `NOW()`): both faces add the column nullable, through
 *    each remote `ADD COLUMN` door, the multi-value JSON column included, and
 *    each face's differ reports `tighten_not_null` (#37258 local, #37281
 *    remote) — the `storage.notNull` contract's "destructive migration gated
 *    by the schema-drift ceremony". The object stays writable. In one batch, a
 *    populated table and an empty one each get their own answer.
 * 5. [#37345] A `storage.notNull` field that also declares a literal
 *    `defaultValue`, added to a populated table: both faces emit the DEFAULT,
 *    keep the NOT NULL and accept, through each remote `ADD COLUMN` door; the
 *    existing row takes the default and neither differ reports drift. ⛔ Never
 *    loosen the NOT NULL to make this pass: the local face keeps it.
 *
 *    A `NOW()` default there is NOT one answer yet, and the case records it:
 *    SQLite refuses a non-constant DEFAULT on `ADD COLUMN` to a table holding
 *    rows, the local face sends one and fails the sync, and this face withholds
 *    it, so it keeps the answer it always gave (nullable: added with no
 *    DEFAULT; `storage.notNull`: refused). The local defect and this face's
 *    `NOW()` half after it are #37413; when it lands, make this one outcome.
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

/** Each column's raw `dflt_value`, as the drift differ is fed it. */
async function columnDefaults(file: string, table: string): Promise<Record<string, unknown>> {
  const c = createClient({ url: `file:${file}` });
  try {
    const rows = (await c.execute(`PRAGMA table_info("${table}")`)).rows;
    return Object.fromEntries(rows.map((r) => [String(r.name), r.dflt_value]));
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

  /** The answer the sync gave `fields`: each column's `notnull` flag, and the differ's `tighten_not_null` columns. */
  async function answer(face: { file: string; driver: TursoDriver }, object: { name: string; fields: object }) {
    const flags = await notNullFlags(face.file, object.name);
    const drift = await face.driver.detectManagedDrift([object as never]);
    return {
      flags: pick(flags, Object.keys(object.fields)),
      tighten: drift.filter((e) => e.op.type === 'tighten_not_null').map((e) => e.column).sort(),
    };
  }

  const TAGS = { type: 'select', multiple: true, options: [{ label: 'A', value: 'a' }], storage: { notNull: true } };
  const NO_ROW_DEFAULT: Array<[string, object]> = [
    ['no defaultValue', ADDED],
    ['the current_user token', { ...ADDED, defaultValue: 'current_user' }],
  ];

  describe.each(NO_ROW_DEFAULT)('with %s: both faces add it nullable and report tighten_not_null', (_, added) => {
    const declared = { name: 'rows_t', fields: { plain: { type: 'text' }, added, added_tags: TAGS } };
    const expected = { flags: { plain: 0, added: 0, added_tags: 0 }, tighten: ['added', 'added_tags'] };

    it.each<Door | 'local'>(['local', 'syncSchemasBatch', 'syncSchema'])('through %s', async (door) => {
      const face = await populated(door === 'local' ? 'local' : 'remote');
      if (door === 'local') await face.driver.syncSchema(declared.name, declared);
      else await SYNC[door](face.driver, [declared]);

      expect(await answer(face, declared)).toEqual(expected);
      // The object is writable, and a row that provides the columns reads back.
      await face.driver.create('rows_t', { id: 'r2', plain: 'y', added: 'v', added_tags: ['a'] });
      expect((await face.driver.findOne('rows_t', { where: { id: 'r2' } }))?.added).toBe('v');
    });
  });

  it('one batch answers per table: the populated table gets it nullable, the empty one NOT NULL', async () => {
    const remote = await populated('remote');
    const empty = { name: 'empty_t', fields: { plain: { type: 'text' } } };
    await remote.driver.syncSchema(empty.name, empty);
    const rows = WITH_ADDED(ADDED);
    const emptyAdded = { name: 'empty_t', fields: { plain: { type: 'text' }, added: ADDED } };

    await SYNC.syncSchemasBatch(remote.driver, [rows, emptyAdded]);

    expect(await answer(remote, rows)).toEqual({ flags: { plain: 0, added: 0 }, tighten: ['added'] });
    expect(await answer(remote, emptyAdded)).toEqual({ flags: { plain: 0, added: 1 }, tighten: [] });
  });

  describe('with a literal defaultValue: both faces emit the DEFAULT, keep NOT NULL and accept', () => {
    const declared = WITH_ADDED({ ...ADDED, defaultValue: 'd' });

    it.each<Door | 'local'>(['local', 'syncSchemasBatch', 'syncSchema'])('through %s', async (door) => {
      const face = await populated(door === 'local' ? 'local' : 'remote');
      if (door === 'local') await face.driver.syncSchema(declared.name, declared);
      else await SYNC[door](face.driver, [declared]);

      expect(await answer(face, declared)).toEqual({ flags: { plain: 0, added: 1 }, tighten: [] });
      expect(await face.driver.detectManagedDrift([declared as never])).toEqual([]);
      // The existing row took the declared default.
      expect((await face.driver.findOne('rows_t', { where: { id: 'r1' } }))?.added).toBe('d');
    });
  });

  describe('with a NOW() defaultValue: recorded, not one answer yet (#37413)', () => {
    const NOW_ADDED = { type: 'datetime', defaultValue: 'NOW()' };

    it('the local face refuses the non-constant DEFAULT, nullable or storage.notNull', async () => {
      for (const added of [NOW_ADDED, { ...NOW_ADDED, storage: { notNull: true } }]) {
        const local = await populated('local');
        await expect(local.driver.syncSchema('rows_t', WITH_ADDED(added))).rejects.toThrow(
          /Cannot add a column with non-constant default/,
        );
      }
    });

    it.each<Door>(['syncSchemasBatch', 'syncSchema'])('this face keeps its answer through %s: nullable accepted with no DEFAULT, storage.notNull refused', async (door) => {
      const nullable = await populated('remote');
      await SYNC[door](nullable.driver, [WITH_ADDED(NOW_ADDED)]);
      expect(await notNullFlags(nullable.file, 'rows_t')).toMatchObject({ added: 0 });
      expect((await columnDefaults(nullable.file, 'rows_t')).added).toBeNull();

      const notNull = await populated('remote');
      await expect(SYNC[door](notNull.driver, [WITH_ADDED({ ...NOW_ADDED, storage: { notNull: true } })])).rejects.toThrow(
        /Cannot add a NOT NULL column with default value NULL/,
      );
      expect(await notNullFlags(notNull.file, 'rows_t')).not.toHaveProperty('added');
    });
  });
});
