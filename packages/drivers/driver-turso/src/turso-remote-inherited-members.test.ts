// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20055 — every public `SqlDriver` member on the Turso REMOTE face is either
 * answered there or refused with `NOT_IMPLEMENTED` / 501. None is answered by
 * a Knex implementation that has no connection on this face.
 *
 * `TursoDriver extends SqlDriver`. Before this card, 23 public members of
 * `SqlDriver` were inherited on the remote face with no remote arm. Since
 * #20054 that face builds its Knex with no connection, so those members
 * failed with knex's `Unable to acquire a connection` (a connectivity reading
 * of a capability gap), or answered from state no remote door fills.
 * `REMOTE_FACE_ANSWERS` in `turso-driver.ts` now names every public member
 * and its remote answer. Its `satisfies Record<keyof SqlDriver, …>` clause
 * fails this package's typecheck when `SqlDriver` gains a member the table
 * does not name.
 *
 * ## What is pinned
 *
 * 1. The table against the code. A `remote` or `refused` row is redeclared by
 *    `TursoDriver`, and an `inherited` row is not. The control is `find`, a
 *    `remote` row redeclared on the prototype.
 * 2. Each of the 23 members that were inherited before this card, measured on
 *    a remote face over a real `@libsql/client` `file:` client, beside a local
 *    control over the same rows. Measured at the base (`d4c897e0e7`):
 *
 *    | member | remote at base | remote now |
 *    |:--|:--|:--|
 *    | `distinct` | `DATABASE_ERROR` / 500 | the local values; tenant-scoped: 501 |
 *    | `findWithWindowFunctions` | `Unable to acquire a connection` | 501 |
 *    | `analyzeQuery`, `explain` | resolved: the local compiler's SQL plus `error` | 501 |
 *    | `introspectSchema` | `Unable to acquire a connection` | 501 |
 *    | `getKnex` | a Knex whose every statement fails | 501 |
 *    | `rotateShards` | `Unable to acquire a connection` | 501 |
 *    | `applyMigrationEntries` | resolved, every entry `skipped` | 501 |
 *    | `reclaimSpace` | `Unable to acquire a connection` | resolves; pages returned |
 *    | `supportsRotation` | `true` | `false` |
 *    | `setFileColumnsMovedResolver` | `true` (never asked) | `false` |
 *    | the other 13 | unchanged, and true on this face | unchanged |
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { SqlDriver } from '@objectstack/driver-sql';
import { REMOTE_FACE_ANSWERS, TursoDriver } from './turso-driver.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const scratch = mkdtempSync(join(tmpdir(), 'turso-inherited-members-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const open: Array<{ driver: TursoDriver; client: Client | null }> = [];
afterEach(async () => {
  while (open.length) {
    const { driver, client } = open.pop()!;
    await driver.disconnect().catch(() => {});
    client?.close();
  }
});

const PROBE = {
  name: 'probe_t',
  fields: { name: { type: 'text' }, n: { type: 'number' }, flag: { type: 'boolean' } },
};
const PROBE_ROWS = [
  { id: 'a', name: 'x', n: 1, flag: true },
  { id: 'b', name: 'y', n: 2, flag: false },
  { id: 'c', name: 'x', n: 3, flag: true },
];
/** An object with a tenant column, which is what makes `tenantId` scope a read. */
const TENANT = { name: 'probe_org', fields: { name: { type: 'text' }, organization_id: { type: 'text' } } };
const TENANT_ROWS = [
  { id: 't1', name: 'A', organization_id: 'org_a' },
  { id: 't2', name: 'B', organization_id: 'org_b' },
  { id: 't3', name: 'P', organization_id: null },
];
/** [#21595] A date and a datetime on ISO-week boundary days, and the empty bucket. */
const BUCKET = { name: 'probe_bucket', fields: { on: { type: 'date' }, at: { type: 'datetime' } } };
const BUCKET_ROWS = [
  { id: 'w1', on: '2020-12-31', at: '2020-12-31T23:30:00.000Z' }, // a Thursday
  { id: 'w2', on: '2021-01-03', at: '2021-01-03T00:30:00.000Z' }, // the Sunday after it
  { id: 'w3', on: '2021-01-04', at: '2021-01-04T12:00:00.000Z' }, // the Monday after that
  { id: 'w4', on: '2024-12-30', at: '2024-12-30T12:00:00.000Z' }, // a Monday in December
  { id: 'w5', on: '2026-12-28', at: '2026-12-28T12:00:00.000Z' }, // the Monday of a 53rd week
  { id: 'w6', on: null, at: null },
];
/** The ISO week each row falls in, written out rather than computed. */
const ISO_WEEK_OF: Record<string, string | null> = {
  w1: '2020-W53', w2: '2020-W53', w3: '2021-W01', w4: '2025-W01', w5: '2026-W53', w6: null,
};

let seq = 0;
const nextFile = () => join(scratch, `db-${++seq}.db`);

type Face = 'remote' | 'local';

/** A driver of the given face over a fresh SQLite file, synced and seeded. */
async function seeded(face: Face, file = nextFile()): Promise<TursoDriver> {
  const client = face === 'remote' ? createClient({ url: `file:${file}` }) : null;
  const driver =
    face === 'remote'
      ? new TursoDriver({ url: 'libsql://probe.example.turso.io', client: client! })
      : new TursoDriver({ url: `file:${file}` });
  open.push({ driver, client });
  await driver.connect();
  await driver.initObjects([PROBE, TENANT]);
  await driver.bulkCreate('probe_t', PROBE_ROWS.map((row) => ({ ...row })));
  await driver.bulkCreate('probe_org', TENANT_ROWS.map((row) => ({ ...row })));
  return driver;
}

/** A remote driver that is only constructed: no client, nothing sent. */
function bareRemote(): TursoDriver {
  return new TursoDriver({ url: 'libsql://probe.example.turso.io', authToken: 'probe' });
}

/** The error a call rejected or threw with, or a failure if it answered. */
async function refusalOf(call: () => unknown): Promise<WireBearingError> {
  try {
    await call();
  } catch (error) {
    return error as WireBearingError;
  }
  throw new Error('expected a refusal, but the call answered');
}

/** The refusal envelope (ADR-0112) and the operation named at the start of its message. */
function expectRefused(err: WireBearingError, operation: string): void {
  expect(err.code).toBe('NOT_IMPLEMENTED');
  expect(err.status).toBe(501);
  expect(
    err.message.startsWith(
      `${operation} is not supported by the Turso REMOTE transport (this datasource's transport mode is \`remote\`)`,
    ),
  ).toBe(true);
}

const sorted = (values: unknown[]) => [...values].map(String).sort();

describe('REMOTE_FACE_ANSWERS names every public SqlDriver member, and each row matches the code', () => {
  const rows = Object.entries(REMOTE_FACE_ANSWERS);
  const ownOnTurso = (member: string) => Object.prototype.hasOwnProperty.call(TursoDriver.prototype, member);
  const onSqlPrototype = (member: string) => member in SqlDriver.prototype;

  it('the control: `find` is a `remote` row, redeclared on the prototype', () => {
    expect(REMOTE_FACE_ANSWERS.find).toBe('remote');
    expect(ownOnTurso('find')).toBe(true);
  });

  it.each(rows.filter(([, answer]) => answer === 'inherited'))(
    '`%s` is inherited: SqlDriver declares it and TursoDriver does not redeclare it',
    (member) => {
      expect(onSqlPrototype(member)).toBe(true);
      expect(ownOnTurso(member)).toBe(false);
    },
  );

  it.each(rows.filter(([member, answer]) => answer !== 'inherited' && onSqlPrototype(member)))(
    '`%s` (%s) is redeclared by TursoDriver',
    (member) => {
      expect(ownOnTurso(member)).toBe(true);
    },
  );

  it('the rows off the prototype are the two class fields, and they carry the Turso identity', () => {
    // A redeclared class field is a SOURCE fact that no runtime probe can tell
    // from the inherited one (`version` is '1.0.0' on both classes); the type
    // pin covers these two, and this holds the set to exactly them.
    const fields = rows.filter(([member]) => !onSqlPrototype(member)).map(([member]) => member);
    expect(fields).toEqual(['name', 'version']);
    const base = new SqlDriver({ client: 'better-sqlite3', useNullAsDefault: true });
    expect(bareRemote().name).toBe('com.objectstack.driver.turso');
    expect(base.name).toBe('com.objectstack.driver.sql');
  });
});

describe('distinct(): answered on the remote face, as the local face answers it', () => {
  it.each<[string, Parameters<TursoDriver['distinct']>]>([
    ['one column', ['probe_t', 'name']],
    ['under a filter', ['probe_t', 'name', { n: { $gte: 2 } }]],
    ['a declared boolean, presented as find() presents it', ['probe_t', 'flag']],
    ['a tenant object, unscoped', ['probe_org', 'name']],
    ['`tenantId` on an object with no tenant column', ['probe_t', 'name', undefined, { tenantId: 'org_a' }]],
  ])('%s', async (_label, args) => {
    const local = await (await seeded('local')).distinct(...args);
    const remote = await (await seeded('remote')).distinct(...args);
    expect(sorted(remote)).toEqual(sorted(local));
    expect(remote.map((v) => typeof v).sort()).toEqual(local.map((v) => typeof v).sort());
  });

  it('an unknown column: INVALID_FIELD / 400 on both faces, not a database fault', async () => {
    for (const face of ['local', 'remote'] as const) {
      const err = await refusalOf(async () => (await seeded(face)).distinct('probe_t', 'nosuch'));
      expect([face, err.code, err.status]).toEqual([face, 'INVALID_FIELD', 400]);
    }
  });

  it('a tenant-scoped call is refused on the remote face, where the local face scopes it', async () => {
    const scoped: Parameters<TursoDriver['distinct']> = ['probe_org', 'name', undefined, { tenantId: 'org_a' }];
    expect(sorted(await (await seeded('local')).distinct(...scoped))).toEqual(['A', 'P']);
    expectRefused(await refusalOf(async () => (await seeded('remote')).distinct(...scoped)), 'A tenant-scoped `distinct()`');
  });
});

describe('members refused on the remote face, beside the local control that answers them', () => {
  const WINDOW = {
    windowFunctions: [{ function: 'row_number', alias: 'rn', over: { orderBy: [{ field: 'id', order: 'asc' }] } }],
  } as unknown as Parameters<TursoDriver['findWithWindowFunctions']>[1];
  const DROP_N = [
    { table: 'probe_t', column: 'n', kind: 'unmapped_column', category: 'destructive', op: { type: 'drop_column' }, message: 'probe' },
  ] as unknown as Parameters<TursoDriver['applyMigrationEntries']>[0];
  const ROTATED = {
    name: 'probe_rot',
    fields: { name: { type: 'text' } },
    lifecycle: { storage: { strategy: 'rotation', unit: 'day', shards: 3 } },
  };

  it.each<[string, string, (d: TursoDriver) => unknown]>([
    ['findWithWindowFunctions', 'A window-function read (`findWithWindowFunctions()`)', (d) => d.findWithWindowFunctions('probe_t', WINDOW)],
    ['analyzeQuery', 'Query plan analysis (`explain()` / `analyzeQuery()`)', (d) => d.analyzeQuery('probe_t', { where: { name: 'x' } })],
    ['explain', 'Query plan analysis (`explain()` / `analyzeQuery()`)', (d) => d.explain('probe_t', { where: { name: 'x' } })],
    ['introspectSchema', 'Schema introspection (`introspectSchema()`)', (d) => d.introspectSchema()],
    ['getKnex', 'Handing out the Knex instance (`getKnex()`)', (d) => d.getKnex()],
    ['rotateShards', 'Data-lifecycle shard rotation (`rotateShards()`)', (d) => d.rotateShards(ROTATED)],
    ['applyMigrationEntries', 'Applying schema migration entries (`applyMigrationEntries()`)', (d) => d.applyMigrationEntries(DROP_N, { allowDestructive: true })],
  ])('%s', async (_member, operation, call) => {
    await expect(Promise.resolve(call(await seeded('local')))).resolves.toBeDefined();
    const remote = await seeded('remote');
    expectRefused(await refusalOf(() => call(remote)), operation);
  });

  it('applyMigrationEntries left the remote table as it was: the column is still read back', async () => {
    const remote = await seeded('remote');
    await refusalOf(() => remote.applyMigrationEntries(DROP_N, { allowDestructive: true }));
    expect((await remote.find('probe_t', { where: { id: 'a' } }))[0]).toEqual(expect.objectContaining({ n: 1 }));
  });

  it('the deprecated commitTransaction / rollbackTransaction answer with the commit / rollback refusal', async () => {
    const remote = await seeded('remote');
    const handle = { commit: async () => {}, rollback: async () => {} } as never;
    const commitErr = await refusalOf(() => remote.commitTransaction(handle));
    const rollbackErr = await refusalOf(() => remote.rollbackTransaction(handle));
    expect([commitErr.code, commitErr.status, rollbackErr.code, rollbackErr.status]).toEqual([
      'NOT_IMPLEMENTED', 501, 'NOT_IMPLEMENTED', 501,
    ]);
    expect(commitErr.message.startsWith('`commit()` is not supported by the Turso REMOTE transport.')).toBe(true);
    expect(rollbackErr.message.startsWith('`rollback()` is not supported by the Turso REMOTE transport.')).toBe(true);
  });
});

describe('reclaimSpace(): the local statement, run to completion on the remote database', () => {
  /**
   * A database created in INCREMENTAL auto-vacuum mode, with `rows` pages on its
   * freelist. Every reading below comes from a SECOND client opened on the file,
   * never from the one that issued the statement: over a libSQL `file:` client,
   * the issuing connection used to read one page fewer while the file itself
   * had not changed.
   */
  async function withFreePages(face: Face, rows = 40): Promise<{ driver: TursoDriver; file: string }> {
    const file = nextFile();
    const prep = createClient({ url: `file:${file}` });
    await prep.execute('PRAGMA auto_vacuum = INCREMENTAL');
    await prep.execute('VACUUM');
    prep.close();
    const driver = await seeded(face, file);
    await driver.initObjects([{ name: 'bulk', fields: { body: { type: 'text' } } }]);
    const body = 'x'.repeat(4000);
    if (rows > 0) {
      await driver.bulkCreate('bulk', Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, body })));
      await driver.deleteMany('bulk', { where: { id: { $ne: '' } } });
    }
    return { driver, file };
  }

  /** One scalar, as a fresh second client on the file reads it. */
  async function secondConnection(file: string, sql: string): Promise<number> {
    const reader = createClient({ url: `file:${file}` });
    try {
      return Number((await reader.execute(sql)).rows[0][0]);
    } finally {
      reader.close();
    }
  }

  async function pageState(file: string): Promise<{ freelist: number; pages: number }> {
    return {
      freelist: await secondConnection(file, 'PRAGMA freelist_count'),
      pages: await secondConnection(file, 'PRAGMA page_count'),
    };
  }

  it.each<Face>(['local', 'remote'])('%s face: every free page leaves the file, read from a second connection', async (face) => {
    const { driver, file } = await withFreePages(face);
    const before = await pageState(file);
    expect(before.freelist).toBeGreaterThanOrEqual(30);
    await expect(driver.reclaimSpace()).resolves.toBeUndefined();
    expect(await pageState(file)).toEqual({ freelist: 0, pages: before.pages - before.freelist });
  });

  it.each<Face>(['local', 'remote'])('%s face, the control: an empty freelist resolves, and nothing changes', async (face) => {
    const { driver, file } = await withFreePages(face, 0);
    const before = await pageState(file);
    expect(before.freelist).toBe(0);
    await expect(driver.reclaimSpace()).resolves.toBeUndefined();
    expect(await pageState(file)).toEqual(before);
  });

  it('remote face: the file shrinks on disk while the driver is still open', async () => {
    const { driver, file } = await withFreePages('remote');
    const pageSize = await secondConnection(file, 'PRAGMA page_size');
    expect(statSync(file).size).toBe((await pageState(file)).pages * pageSize);
    await driver.reclaimSpace();
    expect(statSync(file).size).toBe((await pageState(file)).pages * pageSize);
    expect((await pageState(file)).freelist).toBe(0);
  });

  it('local face: in WAL mode the freed bytes leave the -wal sidecar too, while the driver is still open', async () => {
    const { driver, file } = await withFreePages('local');
    const wal = () => (existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0);
    const pageSize = await secondConnection(file, 'PRAGMA page_size');
    expect(wal()).toBeGreaterThan(0);
    await driver.reclaimSpace();
    const after = await pageState(file);
    expect(after.freelist).toBe(0);
    expect({ file: statSync(file).size, wal: wal() }).toEqual({ file: after.pages * pageSize, wal: 0 });
  });

  it('remote face: a row written after the call reaches a second connection', async () => {
    const { driver, file } = await withFreePages('remote');
    await driver.reclaimSpace();
    await driver.create('bulk', { id: 'after', body: 'written after reclaimSpace' });
    expect(await secondConnection(file, "SELECT count(*) FROM bulk WHERE id = 'after'")).toBe(1);
  });

  /** A client that answers the free-page count with `freePages` and records every call. */
  function scriptedClient(freePages: number | Error, vacuum?: Error) {
    const calls: Array<[string, unknown]> = [];
    const client = {
      execute: async (stmt: unknown) => {
        calls.push(['execute', stmt]);
        if (freePages instanceof Error) throw freePages;
        return { rows: [[freePages]] };
      },
      executeMultiple: async (sql: string) => {
        calls.push(['executeMultiple', sql]);
        if (vacuum) throw vacuum;
      },
      close: () => {},
    };
    return { client, calls };
  }

  async function remoteOver(client: unknown): Promise<TursoDriver> {
    const driver = new TursoDriver({ url: 'libsql://probe.example.turso.io', client: client as never });
    await driver.connect();
    return driver;
  }

  it('remote face: the count is read first, and nothing more is sent when the freelist is empty', async () => {
    const empty = scriptedClient(0);
    await (await remoteOver(empty.client)).reclaimSpace();
    expect(empty.calls).toEqual([['execute', 'PRAGMA freelist_count']]);

    const some = scriptedClient(7);
    await (await remoteOver(some.client)).reclaimSpace();
    expect(some.calls).toEqual([
      ['execute', 'PRAGMA freelist_count'],
      ['executeMultiple', 'PRAGMA incremental_vacuum'],
    ]);
  });

  it('a server that refuses the count answers DATABASE_ERROR / 500, the raw door envelope, and sends no vacuum', async () => {
    const { client, calls } = scriptedClient(new Error('SQLITE_AUTH: not authorized'));
    const err = await refusalOf(async () => (await remoteOver(client)).reclaimSpace());
    expect([err.code, err.status]).toEqual(['DATABASE_ERROR', 500]);
    expect(calls).toEqual([['execute', 'PRAGMA freelist_count']]);
  });

  it('a server that refuses the vacuum answers DATABASE_ERROR / 500, the raw door envelope', async () => {
    const { client, calls } = scriptedClient(7, new Error('SQLITE_AUTH: not authorized'));
    const err = await refusalOf(async () => (await remoteOver(client)).reclaimSpace());
    expect([err.code, err.status]).toEqual(['DATABASE_ERROR', 500]);
    expect(calls).toEqual([
      ['execute', 'PRAGMA freelist_count'],
      ['executeMultiple', 'PRAGMA incremental_vacuum'],
    ]);
  });
});

describe('members whose remote answer is a declaration', () => {
  it('supportsRotation: false on the remote face, true on the local face', async () => {
    expect((await seeded('remote')).supportsRotation).toBe(false);
    expect((await seeded('local')).supportsRotation).toBe(true);
  });

  it('setFileColumnsMovedResolver: not taken on the remote face, taken and asked on the local face', async () => {
    const asked = { remote: 0, local: 0 };
    const remote = bareRemote();
    expect(remote.setFileColumnsMovedResolver(() => { asked.remote += 1; return false; })).toBe(false);
    const local = new TursoDriver({ url: `file:${nextFile()}` });
    open.push({ driver: local, client: null });
    expect(local.setFileColumnsMovedResolver(() => { asked.local += 1; return false; })).toBe(true);
    await local.connect();
    await local.initObjects([PROBE]);
    expect(asked).toEqual({ remote: 0, local: 1 });
  });
});

describe('members inherited unchanged, and true on the remote face', () => {
  it('the deferred-DDL readers report nothing deferred, and arming stays refused', async () => {
    const remote = await seeded('remote');
    expect(() => remote.setDeferredDdl(true)).toThrow(expect.objectContaining({ code: 'NOT_IMPLEMENTED', status: 501 }));
    expect(remote.deferredSchemaObjectCount).toBe(0);
    await expect(remote.previewDeferredSchemaWork()).resolves.toEqual([]);
    await expect(remote.flushDeferredSchemaDdl()).resolves.toEqual([]);
  });

  it("getSchemaSyncStats: both counts at zero, the contract's \"cannot say\"; the local control counts", async () => {
    expect((await seeded('remote')).getSchemaSyncStats()).toEqual({ created: 0, existing: 0 });
    expect((await seeded('local')).getSchemaSyncStats()).toEqual({ created: 2, existing: 0 });
  });

  it('the bookkeeping and dialect members answer as on the local face', async () => {
    const remote = await seeded('remote');
    const local = await seeded('local');
    await expect(Promise.resolve(remote.registerObjectMetadata([PROBE]))).resolves.toBeUndefined();
    await expect(Promise.resolve(remote.registerExternalObject(PROBE))).resolves.toBeUndefined();
    expect(remote.sqliteOpenedEmptyInMemory).toBe(false);
    expect(remote.dialectName).toBe(local.dialectName);
    expect(remote.temporalFilterValue('probe_t', 'name', 'x')).toBe(local.temporalFilterValue('probe_t', 'name', 'x'));
    expect(remote.temporalFilterColumnSql('probe_t', 'name', '"name"')).toBe(
      local.temporalFilterColumnSql('probe_t', 'name', '"name"'),
    );
  });
});

/**
 * [#21595] `dateBucketSql` is an `inherited` row: the remote face renders
 * `SqlDriver`'s SQLite bucket expression with Knex's compiler, which needs no
 * connection, and libSQL runs it. The row was measured once with a harness
 * that no longer exists, so until this block it was held only structurally.
 *
 * Here the expression each face renders goes through that face's own
 * `execute()`: libSQL behind the remote face, better-sqlite3 behind the local
 * one. Measured: `@libsql/client` 0.18.0 bundles SQLite 3.45.1, which has no
 * `strftime('%V')`, so a `week` arm built on `%V` answers NULL on the remote
 * face while the local face answers the week.
 */
describe('dateBucketSql: the inherited expression runs on libSQL, as on the local face', () => {
  const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;

  /** A driver of the given face over a fresh SQLite file, holding the bucket rows. */
  async function withBuckets(face: Face): Promise<TursoDriver> {
    const file = nextFile();
    const client = face === 'remote' ? createClient({ url: `file:${file}` }) : null;
    const driver =
      face === 'remote'
        ? new TursoDriver({ url: 'libsql://probe.example.turso.io', client: client! })
        : new TursoDriver({ url: `file:${file}` });
    open.push({ driver, client });
    await driver.connect();
    await driver.initObjects([BUCKET]);
    await driver.bulkCreate(BUCKET.name, BUCKET_ROWS.map((row) => ({ ...row })));
    return driver;
  }

  /** `id -> label`: the face's rendered expression, run through the face's own `execute()`. */
  async function labels(driver: TursoDriver, field: 'on' | 'at', g: (typeof GRANULARITIES)[number]) {
    const expr = driver.dateBucketSql(BUCKET.name, field, g);
    expect(expr, `${field} @ ${g}: an expression is rendered`).toBeTypeOf('string');
    const rows = (await driver.execute(`select id, ${expr} as b from ${BUCKET.name} order by id`)) as Array<{ id: string; b: unknown }>;
    return Object.fromEntries(rows.map((row) => [row.id, row.b ?? null]));
  }

  it('the row is still `inherited`', () => {
    expect(REMOTE_FACE_ANSWERS.dateBucketSql).toBe('inherited');
  });

  it.each(GRANULARITIES)('%s: libSQL answers the labels the local face answers, on both columns', async (g) => {
    const remote = await withBuckets('remote');
    const local = await withBuckets('local');
    for (const field of ['on', 'at'] as const) {
      expect(await labels(remote, field, g), `${field} @ ${g}`).toEqual(await labels(local, field, g));
    }
  });

  it('week: libSQL answers the ISO week of each boundary day, on both columns', async () => {
    const remote = await withBuckets('remote');
    for (const field of ['on', 'at'] as const) {
      expect(await labels(remote, field, 'week'), field).toEqual(ISO_WEEK_OF);
    }
  });
});
