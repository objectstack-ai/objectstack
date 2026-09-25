// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19894 — planning the ADR-0104 media column move on the Turso REMOTE face
 * refuses instead of answering "nothing to move".
 *
 * `SqlDriver.planMediaColumnMove` walks `managedObjectFields` and probes each
 * table through Knex. A remote `TursoDriver` fills neither: no remote schema
 * door reaches the Knex `initObjects` that fills the map, and its Knex
 * connection is a placeholder `:memory:` database holding none of the
 * datasource's tables. `os migrate files-to-references` mapped the resulting
 * empty scan to "nothing to move — this datastore declares no single-value
 * media column".
 *
 * ## The reproduction, as measured before the refusal existed
 *
 * One declared object `m` with a `file` field `doc` and an `image` field
 * `pic`, synced through each door. The remote physical table held
 * `id, created_at, updated_at, title, doc, pic`, every one TEXT.
 *
 * | face | door | `managedObjectFields` | placeholder `hasTable('m')` | scan |
 * |:--|:--|:--|:--|:--|
 * | local (`:memory:`) | `initObjects` | `m` | true | 2 `unquote` plans |
 * | embedded replica | `initObjects` | `m` | true | 2 `unquote` plans |
 * | remote | `syncSchemasBatch` (the engine's boot sync) | empty | false | `{ plans: [], refusals: [] }` |
 * | remote | `syncSchema` | empty | false | `{ plans: [], refusals: [] }` |
 * | remote | `initObjects` | empty | false | `{ plans: [], refusals: [] }` |
 *
 * ## What is pinned
 *
 * 1. The local (`:memory:` and `file:`) and embedded-replica faces still plan
 *    the move, and the local faces plan exactly what a plain `SqlDriver` plans
 *    for the same declaration. They are the controls.
 * 2. The remote face refuses on every schema door with `NOT_IMPLEMENTED` /
 *    `501` and the operator-facing first sentence, with the media columns on
 *    disk, and sends nothing to the database while refusing.
 * 3. The refusal's closing sentence describes this face: a remote write stores
 *    the JSON encoding and reads it back as the id, and the ADR-0104 resolver
 *    the engine supplies is taken but never asked. If the remote face starts
 *    reading the column-move record, this pin reddens and the sentence must
 *    change with it.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { replicaFiles } from './replica-file.testkit.js';

// A replica, and a local `file:` url, each need a real file of their own.
const fileUrls = replicaFiles();
afterAll(() => fileUrls.removeAll());

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The refusal's opening sentence: the operator contract, because the migration
 * command prints the driver's message in its column-step report. Spelled out
 * here rather than imported, since a test that imports the string it asserts
 * pins nothing about the wording. The rest of the message is prose that may be
 * improved without a test edit.
 */
const REFUSAL_FIRST_SENTENCE =
  'Planning the ADR-0104 media column move is not supported by the Turso REMOTE transport ' +
  "(this datasource's transport mode is `remote`), so this driver cannot say which single-value " +
  'media columns the database holds or how their values are encoded.';

const M_FIELDS = { title: { type: 'text' }, doc: { type: 'file' }, pic: { type: 'image' } };
const M_OBJECTS = [{ name: 'm', fields: M_FIELDS }];

const sqlOf = (stmt: unknown): string =>
  typeof stmt === 'string' ? stmt : String((stmt as { sql?: unknown }).sql ?? '');

/** Wrap the stub so every statement the transport sends is recorded. */
function record(stub: LibsqlSqliteStub) {
  const statements: string[] = [];
  const client = {
    async execute(stmt: unknown) {
      statements.push(sqlOf(stmt));
      return stub.execute(stmt);
    },
    async batch(stmts: unknown[]) {
      for (const s of stmts) statements.push(sqlOf(s));
      return stub.batch(stmts);
    },
    close() {
      stub.close();
    },
  };
  return { client, statements };
}

const columnsOf = (stub: LibsqlSqliteStub, table: string) =>
  (stub.raw.prepare(`pragma table_info("${table}")`).all() as Array<{ name: string }>).map((r) => r.name);

type Door = 'syncSchemasBatch' | 'syncSchema' | 'initObjects';
const DOORS: Record<Door, (driver: TursoDriver) => Promise<void>> = {
  // The door the engine's boot sync takes on this driver.
  syncSchemasBatch: (driver) => driver.syncSchemasBatch([{ object: 'm', schema: { name: 'm', fields: M_FIELDS } }]),
  syncSchema: (driver) => driver.syncSchema('m', { name: 'm', fields: M_FIELDS }),
  initObjects: (driver) => driver.initObjects(M_OBJECTS),
};

/** A remote driver whose `m` was synced through `door`, with its media columns on disk. */
async function syncedRemote(door: Door) {
  const stub = makeLibsqlSqliteStub();
  const rec = record(stub);
  const driver = new TursoDriver({ url: 'libsql://media.turso.io', client: rec.client as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await DOORS[door](driver);
  // Non-vacuous: the media columns are on disk, so an empty answer would be a miss.
  expect(columnsOf(stub, 'm')).toEqual(expect.arrayContaining(['doc', 'pic']));
  return { driver, rec, stub };
}

/** What a plain `SqlDriver` plans for the same declaration: the local faces' reference. */
async function sqlDriverScan() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await driver.initObjects(M_OBJECTS);
  const scan = await driver.planMediaColumnMove();
  await driver.disconnect();
  return scan;
}

const PLANNED = [
  { table: 'm', column: 'doc', kind: 'unquote' },
  { table: 'm', column: 'pic', kind: 'unquote' },
];

describe('controls — the Knex planner still plans the move', () => {
  it.each([
    ['local face, `:memory:`', () => ':memory:'],
    ['local face, `file:`', () => fileUrls.next()],
  ])('%s: exactly what SqlDriver plans', async (_label, url) => {
    const driver = new TursoDriver({ url: url() });
    await driver.connect();
    expect(driver.transportMode).toBe('local');
    await driver.initObjects(M_OBJECTS);

    const scan = await driver.planMediaColumnMove();

    expect(scan.plans).toEqual(PLANNED.map((p) => expect.objectContaining(p)));
    expect(scan).toEqual(await sqlDriverScan());
    await driver.disconnect();
  });

  it('embedded-replica face: the two unquote plans, no refusals', async () => {
    // Replica mode reads its local file through Knex; `sync.onConnect: false`
    // keeps the (stubbed) sync target out of the measurement.
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({
      url: fileUrls.next(),
      syncUrl: 'libsql://media.turso.io',
      client: record(stub).client as never,
      sync: { onConnect: false },
    });
    await driver.connect();
    expect(driver.transportMode).toBe('replica');
    await driver.initObjects(M_OBJECTS);

    const scan = await driver.planMediaColumnMove();

    expect(scan.dialect).toBe('sqlite');
    expect(scan.plans).toEqual(PLANNED.map((p) => expect.objectContaining(p)));
    expect(scan.refusals).toEqual([]);
    await driver.disconnect();
  });
});

describe('remote face — refused, never "nothing to move"', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])(
    'synced through %s: refuses with NOT_IMPLEMENTED / 501 and sends nothing to the database',
    async (door) => {
      const { driver, rec } = await syncedRemote(door);
      const sentBefore = rec.statements.length;

      const err = await driver.planMediaColumnMove().then(
        (scan) => {
          throw new Error(`expected a refusal, got an answer: ${JSON.stringify(scan)}`);
        },
        (e: unknown) => e as WireBearingError,
      );

      expect(err.code).toBe('NOT_IMPLEMENTED');
      expect(err.status).toBe(501);
      expect(err.message.startsWith(REFUSAL_FIRST_SENTENCE)).toBe(true);
      expect(rec.statements.slice(sentBefore)).toEqual([]);
      await driver.disconnect();
    },
  );
});

describe('the refusal describes this face: the JSON encoding, and no column-move record read', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])(
    'synced through %s: a file id is stored as a JSON string, read back as the id, and the resolver is never asked',
    async (door) => {
      const stub = makeLibsqlSqliteStub();
      const driver = new TursoDriver({ url: 'libsql://media.turso.io', client: stub as never });
      // The engine's supply seam (`ObjectQL.registerDriver`), with a resolver
      // that would answer "moved" if it were ever asked.
      let asked = 0;
      expect(driver.setFileColumnsMovedResolver(() => { asked += 1; return true; })).toBe(true);
      await driver.connect();
      await DOORS[door](driver);

      await driver.create('m', { id: 'r1', title: 't', doc: 'file_abc', pic: 'file_def' });

      expect(stub.raw.prepare('select doc, pic from "m" where id = ?').all('r1')).toEqual([
        { doc: '"file_abc"', pic: '"file_def"' },
      ]);
      expect(await driver.findOne('m', { where: { id: 'r1' } })).toEqual(
        expect.objectContaining({ doc: 'file_abc', pic: 'file_def' }),
      );
      expect(asked).toBe(0);
      await driver.disconnect();
    },
  );
});
