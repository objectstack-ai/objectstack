// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20107] `TursoDriver` LOCAL and REMOTE — a federated object (ADR-0015) is
 * read from, and written to, the table its `external.remoteName` declares, on
 * both faces.
 *
 * ## What was measured before this change
 *
 * `registerExternalObject({ name: 'ext_t', external: { remoteName: 'probe_t' } })`
 * records the mapping in `SqlDriver`'s `physicalTableByObject`. The local face
 * reads it in `getBuilder` for every statement. The remote face handed
 * `RemoteTransport` the object name, which the transport used as the table.
 * Measured at `789b2ae54`, remote over a real `@libsql/client` on a `file:`
 * database, with a local driver over the SAME file as the control:
 *
 * ```
 * LOCAL  find/findOne/count/aggregate/distinct   answered from probe_t
 * LOCAL  every write door                        landed in probe_t
 * REMOTE find/findOne/count + every write door   LibsqlError  SQLITE_ERROR: no such table: ext_t  (status undefined)
 * REMOTE aggregate                               []           (the transport reads "no such table" as no rows)
 * REMOTE distinct                                DATABASE_ERROR / 500
 * ```
 *
 * ## What is pinned
 *
 * 1. Read parity on ONE table: both faces run over the same file, and every
 *    read door gives the same answer, which is also the literal answer the
 *    seeded rows imply. The literal matters: two faces agreeing on `[]` would
 *    also be parity.
 * 2. Write parity: each write door runs on a fresh copy for each face. It
 *    lands in the mapped table on both, with the same answer and the same rows
 *    after, and no table named after the object ever appears.
 * 3. A mapped table that is really absent: the remote `find` / `findOne` /
 *    `count` exits answer the local face's read-exit envelope (`DATABASE_ERROR`
 *    / 500), with the libSQL error under a non-enumerable `cause`, and with the
 *    table the statement targeted declared for `isMissingTableError`. The
 *    declared table and the table the backend's own phrase names are the same
 *    table, because the statement targeted the mapped one.
 * 4. A column map that renames a column is refused `NOT_IMPLEMENTED` / 501 on
 *    every remote data door, before any statement is sent. The local face is
 *    the control that the binding itself is well-formed. A map whose entries
 *    rename nothing is served.
 *
 * ## Reverse verification, directions predicted BEFORE running
 *
 * - `remoteTableFor` returning the object name: sections 1 and 2 go RED, with
 *   `no such table: ext_t` on every door, `aggregate` included, which refuses
 *   it as `DATABASE_ERROR` / 500 (before #20424 it answered `[]` in place of
 *   the sum). In section 3 the declared table stays `absent_t` but the
 *   backend's phrase names `ext_gone`, so the phrase assertion goes RED.
 * - `remoteReadExit` rethrowing the error unchanged: section 3 goes RED on
 *   `code` (`SQLITE_ERROR`) and `status` (`undefined`).
 * - The column-map refusal deleted: section 4 goes RED. A filter on the renamed
 *   field answers `[]`, and a write fails with the backend's own error.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { TursoDriver } from './turso-driver.js';

interface Envelope extends Error {
  code?: string;
  status?: number;
  cause?: unknown;
}

/** `@objectstack/types`' `DRIVER_TARGETED_TABLE`: a `Symbol.for` key, so it resolves without the package. */
const DRIVER_TARGETED_TABLE = Symbol.for('objectstack.driver.targetedTable');

const QUIET = { warn() {}, error() {}, info() {}, debug() {} };

const EXT = {
  name: 'ext_t',
  fields: { id: { type: 'text' }, name: { type: 'text' }, amount: { type: 'number' } },
  external: { remoteName: 'probe_t' },
};

const SEED = [
  { id: 'a', name: 'alpha', amount: 1 },
  { id: 'b', name: 'beta', amount: 2 },
  { id: 'c', name: 'beta', amount: 4 },
];

const scratch = mkdtempSync(join(tmpdir(), 'turso-20107-'));
let fileSeq = 0;

/** A fresh `file:` database holding `probe_t` with {@link SEED}, and nothing named after the object. */
async function seededFile(extraDdl: string[] = []): Promise<string> {
  const file = join(scratch, `db-${++fileSeq}.sqlite`);
  const seed = createClient({ url: `file:${file}` });
  await seed.execute('CREATE TABLE probe_t (id TEXT PRIMARY KEY, name TEXT, amount REAL)');
  for (const row of SEED) {
    await seed.execute({ sql: 'INSERT INTO probe_t (id, name, amount) VALUES (?, ?, ?)', args: [row.id, row.name, row.amount] });
  }
  for (const ddl of extraDdl) await seed.execute(ddl);
  seed.close();
  return file;
}

async function tablesIn(file: string): Promise<string[]> {
  const probe = createClient({ url: `file:${file}` });
  try {
    const rs = await probe.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    return rs.rows.map((r) => String(r.name));
  } finally {
    probe.close();
  }
}

async function rowsIn(file: string, table: string): Promise<Array<Record<string, unknown>>> {
  const probe = createClient({ url: `file:${file}` });
  try {
    const rs = await probe.execute(`SELECT * FROM "${table}" ORDER BY id`);
    return rs.rows.map((r) => ({ ...r }));
  } finally {
    probe.close();
  }
}

type Face = { driver: TursoDriver; client: Client | null };

async function localFace(file: string): Promise<Face> {
  const driver = new TursoDriver({ url: `file:${file}` });
  (driver as unknown as { logger: typeof QUIET }).logger = QUIET;
  await driver.connect();
  expect(driver.transportMode).toBe('local');
  return { driver, client: null };
}

async function remoteFace(file: string): Promise<Face> {
  const client = createClient({ url: `file:${file}` });
  const driver = new TursoDriver({ url: 'libsql://issue-20107.turso.io', client });
  (driver as unknown as { logger: typeof QUIET }).logger = QUIET;
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return { driver, client };
}

async function close(face: Face): Promise<void> {
  await face.driver.disconnect();
  face.client?.close();
}

async function refusalOf(run: () => Promise<unknown>): Promise<Envelope> {
  try {
    await run();
  } catch (e) {
    return e as Envelope;
  }
  throw new Error('expected the driver to refuse, but the call resolved');
}

const byId = (rows: unknown): Array<Record<string, unknown>> =>
  [...(rows as Array<Record<string, unknown>>)].sort((x, y) => String(x.id).localeCompare(String(y.id)));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// ── 1. Read parity on one table ──────────────────────────────────────────────

describe('[#20107] TursoDriver LOCAL and REMOTE — every read door answers from the mapped table', () => {
  let file: string;
  let local: Face;
  let remote: Face;

  beforeAll(async () => {
    file = await seededFile();
    local = await localFace(file);
    remote = await remoteFace(file);
    local.driver.registerExternalObject(EXT);
    remote.driver.registerExternalObject(EXT);
  });

  afterAll(async () => {
    await close(local);
    await close(remote);
  });

  const READS: ReadonlyArray<readonly [string, (d: TursoDriver) => Promise<unknown>, unknown]> = [
    ['find', async (d) => byId(await d.find('ext_t', {})), SEED],
    ['find with a filter', async (d) => byId(await d.find('ext_t', { where: { name: 'beta' } })), SEED.slice(1)],
    ['findOne', (d) => d.findOne('ext_t', { where: { id: 'b' } }), SEED[1]],
    ['count', (d) => d.count('ext_t', {}), 3],
    ['count with a filter', (d) => d.count('ext_t', { where: { amount: { $gt: 1 } } }), 2],
    [
      'aggregate',
      (d) => d.aggregate('ext_t', { aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }] } as DriverQuery),
      [{ total: 7 }],
    ],
    [
      'aggregate grouped',
      async (d) =>
        [...(await d.aggregate('ext_t', {
          groupBy: ['name'],
          aggregations: [{ function: 'count', alias: 'n' }],
        } as DriverQuery))].sort((x, y) => String(x.name).localeCompare(String(y.name))),
      [{ name: 'alpha', n: 1 }, { name: 'beta', n: 2 }],
    ],
    ['distinct', async (d) => [...(await d.distinct('ext_t', 'name'))].sort(), ['alpha', 'beta']],
  ];

  for (const [door, read, expected] of READS) {
    it(`${door}: the local face answers from probe_t (the control)`, async () => {
      expect(await read(local.driver)).toEqual(expected);
    });

    it(`${door}: the remote face answers what the local face answers`, async () => {
      expect(await read(remote.driver)).toEqual(await read(local.driver));
    });
  }

  it('no read created, or asked for, a table named after the object', async () => {
    expect(await tablesIn(file)).toEqual(['probe_t']);
  });
});

// ── 2. Write parity, one fresh copy per face per door ────────────────────────

describe('[#20107] TursoDriver LOCAL and REMOTE — every write door lands in the mapped table', () => {
  const WRITES: ReadonlyArray<readonly [string, (d: TursoDriver) => Promise<unknown>]> = [
    ['create', (d) => d.create('ext_t', { id: 'n', name: 'new', amount: 8 })],
    ['update', (d) => d.update('ext_t', 'a', { name: 'renamed' })],
    ['upsert (merge)', (d) => d.upsert('ext_t', { id: 'a', name: 'merged', amount: 1 })],
    ['upsert (insert)', (d) => d.upsert('ext_t', { id: 'z', name: 'inserted', amount: 16 })],
    ['delete', (d) => d.delete('ext_t', 'a')],
    ['bulkCreate', async (d) => byId(await d.bulkCreate('ext_t', [{ id: 'x', name: 'x', amount: 32 }, { id: 'y', name: 'y', amount: 64 }]))],
    ['bulkUpdate', async (d) => byId(await d.bulkUpdate('ext_t', [{ id: 'a', data: { amount: 10 } }, { id: 'b', data: { amount: 20 } }]))],
    ['bulkDelete', (d) => d.bulkDelete('ext_t', ['a', 'b'])],
    ['updateMany', (d) => d.updateMany('ext_t', { where: { name: 'beta' } }, { amount: 0 })],
    ['deleteMany', (d) => d.deleteMany('ext_t', { where: { name: 'beta' } })],
  ];

  for (const [door, write] of WRITES) {
    it(`${door}: the remote face gives the local face's answer and leaves the same rows in probe_t`, async () => {
      const localFile = await seededFile();
      const remoteFile = await seededFile();
      const local = await localFace(localFile);
      const remote = await remoteFace(remoteFile);
      try {
        local.driver.registerExternalObject(EXT);
        remote.driver.registerExternalObject(EXT);

        const localAnswer = await write(local.driver);
        const remoteAnswer = await write(remote.driver);
        expect(remoteAnswer).toEqual(localAnswer);

        const localRows = await rowsIn(localFile, 'probe_t');
        expect(localRows).not.toEqual(SEED);
        expect(await rowsIn(remoteFile, 'probe_t')).toEqual(localRows);
        expect(await tablesIn(remoteFile)).toEqual(['probe_t']);
      } finally {
        await close(local);
        await close(remote);
      }
    });
  }
});

// ── 3. A mapped table that really is absent ─────────────────────────────────

describe('[#20107] TursoDriver REMOTE — a missing mapped table answers the local read-exit envelope', () => {
  const GONE = { name: 'ext_gone', fields: { id: { type: 'text' }, name: { type: 'text' } }, external: { remoteName: 'absent_t' } };
  let local: Face;
  let remote: Face;

  beforeAll(async () => {
    const file = await seededFile();
    local = await localFace(file);
    remote = await remoteFace(file);
    local.driver.registerExternalObject(GONE);
    remote.driver.registerExternalObject(GONE);
  });

  afterAll(async () => {
    await close(local);
    await close(remote);
  });

  const EXITS: ReadonlyArray<readonly [string, (d: TursoDriver) => Promise<unknown>]> = [
    ['find', (d) => d.find('ext_gone', {})],
    ['findOne', (d) => d.findOne('ext_gone', { where: { id: 'a' } })],
    ['count', (d) => d.count('ext_gone', {})],
  ];

  for (const [door, read] of EXITS) {
    it(`${door}: DATABASE_ERROR / 500 on both faces`, async () => {
      const onLocal = await refusalOf(() => read(local.driver));
      const onRemote = await refusalOf(() => read(remote.driver));

      expect(onLocal.code).toBe('DATABASE_ERROR');
      expect(onLocal.status).toBe(500);
      expect(onRemote.code).toBe(onLocal.code);
      expect(onRemote.status).toBe(onLocal.status);
    });

    it(`${door}: the libSQL error rides under a non-enumerable cause, and the message withholds the physical table`, async () => {
      const onRemote = await refusalOf(() => read(remote.driver));
      const cause = onRemote.cause as Envelope;

      expect(cause).toBeInstanceOf(Error);
      expect(cause.code).toBe('SQLITE_ERROR');
      expect(Object.getOwnPropertyDescriptor(onRemote, 'cause')?.enumerable).toBe(false);
      expect(onRemote.message).not.toContain('absent_t');
      expect(JSON.stringify(onRemote)).not.toContain('absent_t');
    });

    it(`${door}: the table declared for isMissingTableError is the table the remote statement targeted`, async () => {
      const onRemote = await refusalOf(() => read(remote.driver));

      expect((onRemote as unknown as Record<symbol, unknown>)[DRIVER_TARGETED_TABLE]).toBe('absent_t');
      // The backend's own phrase is what `isMissingTableError` compares with the
      // declared table, so the two must name the same relation.
      expect((onRemote.cause as Error).message).toMatch(/no such table: absent_t\b/);
    });
  }
});

// ── 4. A column map that renames: refused on every remote door ───────────────

describe('[#20107] TursoDriver REMOTE — a renaming external.columnMap is refused NOT_IMPLEMENTED / 501', () => {
  const MAPPED = {
    name: 'ext_mapped',
    fields: { id: { type: 'text' }, region: { type: 'text' }, amount: { type: 'number' } },
    external: { remoteName: 'probe_mapped', columnMap: { cust_region: 'region' } },
  };
  const MAPPED_DDL = [
    'CREATE TABLE probe_mapped (id TEXT PRIMARY KEY, cust_region TEXT, amount REAL)',
    "INSERT INTO probe_mapped (id, cust_region, amount) VALUES ('a', 'EU', 1), ('b', 'US', 2)",
  ];
  let file: string;
  let local: Face;
  let remote: Face;

  beforeAll(async () => {
    file = await seededFile(MAPPED_DDL);
    local = await localFace(file);
    remote = await remoteFace(file);
    local.driver.registerExternalObject(MAPPED);
    remote.driver.registerExternalObject(MAPPED);
  });

  afterAll(async () => {
    await close(local);
    await close(remote);
  });

  it('control: the local face translates the map, so the binding itself is well-formed', async () => {
    expect(await local.driver.find('ext_mapped', { where: { region: 'EU' } })).toEqual([{ id: 'a', region: 'EU', amount: 1 }]);
  });

  const DOORS: ReadonlyArray<readonly [string, (d: TursoDriver) => Promise<unknown>]> = [
    ['find', (d) => d.find('ext_mapped', { where: { region: 'EU' } })],
    ['findOne', (d) => d.findOne('ext_mapped', { where: { id: 'a' } })],
    ['count', (d) => d.count('ext_mapped', { where: { region: 'EU' } })],
    ['aggregate', (d) => d.aggregate('ext_mapped', { groupBy: ['region'], aggregations: [{ function: 'count', alias: 'n' }] } as DriverQuery)],
    ['distinct', (d) => d.distinct('ext_mapped', 'region')],
    ['create', (d) => d.create('ext_mapped', { id: 'n', region: 'APAC', amount: 3 })],
    ['update', (d) => d.update('ext_mapped', 'a', { region: 'APAC' })],
    ['upsert', (d) => d.upsert('ext_mapped', { id: 'a', region: 'APAC', amount: 1 })],
    ['delete', (d) => d.delete('ext_mapped', 'a')],
    ['bulkCreate', (d) => d.bulkCreate('ext_mapped', [{ id: 'n', region: 'APAC', amount: 3 }])],
    ['bulkUpdate', (d) => d.bulkUpdate('ext_mapped', [{ id: 'a', data: { region: 'APAC' } }])],
    ['bulkDelete', (d) => d.bulkDelete('ext_mapped', ['a'])],
    ['updateMany', (d) => d.updateMany('ext_mapped', { where: { region: 'EU' } }, { region: 'APAC' })],
    ['deleteMany', (d) => d.deleteMany('ext_mapped', { where: { region: 'EU' } })],
  ];

  for (const [door, run] of DOORS) {
    it(`${door}: NOT_IMPLEMENTED / 501, and no statement reached the database`, async () => {
      const execute = vi.spyOn(remote.client!, 'execute');
      try {
        const err = await refusalOf(() => run(remote.driver));
        expect(err.code).toBe('NOT_IMPLEMENTED');
        expect(err.status).toBe(501);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        execute.mockRestore();
      }
    });
  }

  it('the refused writes left probe_mapped as seeded', async () => {
    expect(await rowsIn(file, 'probe_mapped')).toEqual([
      { id: 'a', cust_region: 'EU', amount: 1 },
      { id: 'b', cust_region: 'US', amount: 2 },
    ]);
  });

  it('a map whose entries rename nothing is served, from the mapped table', async () => {
    remote.driver.registerExternalObject({
      name: 'ext_identity',
      fields: { id: { type: 'text' }, name: { type: 'text' }, amount: { type: 'number' } },
      external: { remoteName: 'probe_t', columnMap: { name: 'name' } },
    });
    expect(await remote.driver.count('ext_identity', { where: { name: 'beta' } })).toBe(2);
  });
});

// ── Control: a managed object is still its own table on the remote face ─────

describe('[#20107] TursoDriver REMOTE — a managed object still resolves to its own table', () => {
  it('syncSchema, create and find round-trip on a table named after the object', async () => {
    const file = await seededFile();
    const remote = await remoteFace(file);
    try {
      await remote.driver.syncSchema('managed_t', { name: 'managed_t', fields: { name: { type: 'text' } } });
      await remote.driver.create('managed_t', { id: 'm1', name: 'kept' });
      expect(await remote.driver.find('managed_t', { where: { id: 'm1' } })).toMatchObject([{ id: 'm1', name: 'kept' }]);
      expect(await tablesIn(file)).toEqual(['managed_t', 'probe_t']);
    } finally {
      await close(remote);
    }
  });
});
