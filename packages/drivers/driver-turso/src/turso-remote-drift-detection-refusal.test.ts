// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19845 — schema drift detection on the Turso REMOTE face refuses instead of
 * answering "no drift".
 *
 * `SqlDriver.detectManagedDrift` reads the physical schema through Knex, and a
 * remote `TursoDriver` is built with a placeholder `:memory:` Knex connection
 * that holds none of the datasource's tables. Before the refusal, the remote
 * answer was `[]` for every database. That is the answer the artifact-pinned
 * boot gate of `os serve` reads as "never drifted", so a gate whose job is to
 * refuse a boot on destructive drift let every remote-Turso boot through.
 *
 * ## The reproduction, as measured before the refusal existed
 *
 * One declared object `t` with one field. Its table is synced, then an extra
 * physical column `legacy` the declaration omits is added on disk.
 *
 * | face | call | answer |
 * |:--|:--|:--|
 * | local (`:memory:` url, Knex) | `detectManagedDrift()` | `t.legacy`: `unmapped_column`, op `drop_column`, `destructive` |
 * | remote (batch door, the engine's boot sync) | `detectManagedDrift()` | `[]` |
 * | remote | `detectManagedDrift([{ name: 't', fields }])` | `[]` |
 *
 * The remote physical table held `id, created_at, updated_at, name, legacy`
 * at the time, so the drift was on disk and the detector did not see it.
 *
 * ## What is pinned
 *
 * 1. The local and embedded-replica faces still report the extra column. They
 *    are the controls: the same physical state, the same declaration, a real
 *    finding.
 * 2. The remote face refuses both call shapes with `NOT_IMPLEMENTED` / `501`
 *    and the operator-facing first sentence, and sends nothing to the
 *    database while refusing.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { replicaFiles } from './replica-file.testkit.js';

// A replica is a local FILE: the constructor refuses one on `:memory:`.
const replicaFileUrls = replicaFiles();
afterAll(() => replicaFileUrls.removeAll());

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The refusal's opening sentence: the operator contract, because the boot gate
 * prints the driver's message inside its warning. Spelled out here rather than
 * imported, since a test that imports the string it asserts pins nothing about
 * the wording. The rest of the message is prose that may be improved without a
 * test edit.
 */
const REFUSAL_FIRST_SENTENCE =
  "Schema drift detection is not supported by the Turso REMOTE transport (this datasource's " +
  "transport mode is `remote`), so this driver cannot say whether the database's physical " +
  'schema matches the declared objects.';

const T_FIELDS = { name: { type: 'text' } };
const T_OBJECTS = [{ name: 't', fields: T_FIELDS }];
const ADD_LEGACY = 'ALTER TABLE "t" ADD COLUMN "legacy" TEXT';

/** The finding the local detector reports for the extra column. */
const LEGACY_FINDING = {
  table: 't',
  column: 'legacy',
  kind: 'unmapped_column',
  category: 'destructive',
  op: { type: 'drop_column' },
};

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

/** A remote driver whose `t` was synced by the engine's boot-sync door, then drifted on disk. */
async function driftedRemote() {
  const stub = makeLibsqlSqliteStub();
  const rec = record(stub);
  const driver = new TursoDriver({ url: 'libsql://drift.turso.io', client: rec.client as never });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.syncSchemasBatch([{ object: 't', schema: { name: 't', fields: T_FIELDS } }]);
  stub.raw.prepare(ADD_LEGACY).run();
  // Non-vacuous: the drift is on disk, so an empty answer would be a miss.
  expect(columnsOf(stub, 't')).toContain('legacy');
  return { driver, rec };
}

type Call = 'no arguments' | 'explicit objects';
const CALLS: Record<Call, (driver: TursoDriver) => ReturnType<TursoDriver['detectManagedDrift']>> = {
  // The call the artifact-pinned boot gate makes.
  'no arguments': (driver) => driver.detectManagedDrift(),
  'explicit objects': (driver) => driver.detectManagedDrift(T_OBJECTS),
};

describe('controls — the Knex detector still reports the extra column', () => {
  it.each<Call>(['no arguments', 'explicit objects'])('local face, %s', async (call) => {
    const driver = new TursoDriver({ url: ':memory:' });
    await driver.connect();
    expect(driver.transportMode).toBe('local');
    await driver.initObjects(T_OBJECTS);
    await driver.execute(ADD_LEGACY);

    const drift = await CALLS[call](driver);

    expect(drift).toEqual([expect.objectContaining({ ...LEGACY_FINDING, op: expect.objectContaining(LEGACY_FINDING.op) })]);
    await driver.disconnect();
  });

  it.each<Call>(['no arguments', 'explicit objects'])('embedded-replica face, %s', async (call) => {
    // Replica mode reads its local file through Knex; `sync.onConnect: false`
    // keeps the (stubbed) sync target out of the measurement.
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({
      url: replicaFileUrls.next(),
      syncUrl: 'libsql://drift.turso.io',
      client: record(stub).client as never,
      sync: { onConnect: false },
    });
    await driver.connect();
    expect(driver.transportMode).toBe('replica');
    await driver.initObjects(T_OBJECTS);
    await driver.execute(ADD_LEGACY);

    const drift = await CALLS[call](driver);

    expect(drift).toEqual([expect.objectContaining({ ...LEGACY_FINDING, op: expect.objectContaining(LEGACY_FINDING.op) })]);
    await driver.disconnect();
  });
});

describe('remote face — refused, never "no drift"', () => {
  it.each<Call>(['no arguments', 'explicit objects'])(
    'refuses with NOT_IMPLEMENTED / 501, %s, and sends nothing to the database',
    async (call) => {
      const { driver, rec } = await driftedRemote();
      const sentBefore = rec.statements.length;

      const err = await CALLS[call](driver).then(
        (drift) => {
          throw new Error(`expected a refusal, got an answer: ${JSON.stringify(drift)}`);
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
