// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23816 — schema drift detection on the Turso REMOTE face answers, as the
 * local face answers it.
 *
 * Since #19845 the remote face refused `detectManagedDrift()` with
 * `NOT_IMPLEMENTED` / 501, because the inherited detector read the physical
 * schema through a Knex instance remote mode builds with no connection, and
 * walked a registry no remote schema door filled (its answer had been `[]` for
 * every database). The refusal left the v18 organization-ownership ceremony
 * with no remote path: its column drops go through this detector.
 *
 * ## The instrument
 *
 * The remote face is a `TursoDriver` in remote mode over a real
 * `@libsql/client` `file:` client, so its statements run on a real libSQL
 * connection. The CONTROL is the local face (Knex) opened on the SAME file,
 * given the same declarations DDL-free (`registerObjectMetadata`). Every
 * remote answer is asserted EQUAL to the local face's answer over the same
 * bytes, not to a hand-written expectation, so the two read paths (the remote
 * catalog reads and the Knex introspection) are held to one verdict.
 *
 * ## What is pinned
 *
 * 1. A clean table synced by each of the three remote schema doors drifts
 *    nowhere, on either face. This is what the `os serve` boot gate reads: a
 *    false finding here would refuse a healthy boot.
 * 2. Each drifted shape (an extra physical column, a declared index the table
 *    lacks, a bare organization key a NULL-safe unique must tighten, over
 *    clean and over duplicate rows) reads alike on both faces, with or without
 *    explicit objects.
 * 3. The DDL-free `registerObjectMetadata` (a `skipSchemaSync` boot) fills the
 *    registry the no-argument call walks, and sends nothing to the database.
 * 4. A declared table the database does not hold is skipped, as locally.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { TursoDriver } from './turso-driver.js';

const scratch = mkdtempSync(join(tmpdir(), 'turso-remote-drift-'));
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

const sqlOf = (stmt: unknown): string => (typeof stmt === 'string' ? stmt : String((stmt as { sql?: unknown }).sql));

/** A remote face over `file`, every statement it sends recorded. */
async function remoteOver(file: string) {
  const client = createClient({ url: `file:${file}` });
  const statements: string[] = [];
  const recording = {
    execute: (stmt: unknown) => {
      statements.push(sqlOf(stmt));
      return client.execute(stmt as never);
    },
    batch: (stmts: unknown[], mode?: unknown) => {
      for (const s of stmts) statements.push(sqlOf(s));
      return client.batch(stmts as never, mode as never);
    },
    close: () => client.close(),
  } as unknown as Client;
  const driver = new TursoDriver({ url: 'libsql://drift.example.turso.io', client: recording });
  open.push({ driver, client });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return { driver, statements };
}

/** The local (Knex) face over the same file, told the declarations DDL-free. */
async function localOver(file: string, objects: Objects): Promise<TursoDriver> {
  const driver = new TursoDriver({ url: `file:${file}` });
  open.push({ driver, client: null });
  await driver.connect();
  expect(driver.transportMode).toBe('local');
  driver.registerObjectMetadata(objects);
  return driver;
}

/** One statement on the file, through a connection of its own. */
async function onDisk(file: string, sql: string): Promise<void> {
  const c = createClient({ url: `file:${file}` });
  try {
    await c.execute(sql);
  } finally {
    c.close();
  }
}

const T = { name: 't', fields: { name: { type: 'text' }, n: { type: 'number' }, flag: { type: 'boolean' } } };
const TENANT = {
  name: 'tenant_t',
  fields: { code: { type: 'text', unique: true }, label: { type: 'text' }, organization_id: { type: 'text' } },
};
const INDEXED = { name: 'indexed_t', fields: { name: { type: 'text' } }, indexes: [{ fields: ['name'] }] };
const ALL: Objects = [T, TENANT, INDEXED];

type Door = 'syncSchemasBatch' | 'syncSchema' | 'initObjects';
const SYNC: Record<Door, (d: TursoDriver, objects: Objects) => Promise<void>> = {
  syncSchemasBatch: (d, objects) => d.syncSchemasBatch(objects.map((o) => ({ object: o.name, schema: o }))),
  syncSchema: async (d, objects) => {
    for (const o of objects) await d.syncSchema(o.name, o);
  },
  initObjects: (d, objects) => d.initObjects(objects as never),
};

describe('a clean remote-synced database drifts nowhere, on either face', () => {
  it.each<Door>(['syncSchemasBatch', 'syncSchema', 'initObjects'])('synced through %s', async (door) => {
    const file = nextFile();
    const { driver: remote } = await remoteOver(file);
    await SYNC[door](remote, ALL);
    const local = await localOver(file, ALL);

    expect(await local.detectManagedDrift(ALL)).toEqual([]);
    expect(await remote.detectManagedDrift(ALL)).toEqual([]);
    // The call the boot gate makes: the registry every remote door now fills.
    expect(await remote.detectManagedDrift()).toEqual([]);
  });
});

type Drift = Awaited<ReturnType<TursoDriver['detectManagedDrift']>>;

describe('each drifted shape reads alike on the remote and the local face', () => {
  /** The physical drift each case puts on disk after a clean remote sync, and the finding it must produce. */
  const CASES: Array<[string, string[], (drift: Drift) => void]> = [
    [
      'an extra physical column the declaration omits',
      ['ALTER TABLE "t" ADD COLUMN "legacy" TEXT', 'CREATE INDEX "idx_t_legacy" ON "t" ("legacy")'],
      (drift) => expect(drift).toContainEqual(expect.objectContaining({
        table: 't', column: 'legacy', category: 'destructive', op: expect.objectContaining({ type: 'drop_column' }),
      })),
    ],
    [
      'a declared index the table lacks',
      ['DROP INDEX "idx_indexed_t_name"'],
      (drift) => expect(drift).toContainEqual(expect.objectContaining({
        table: 'indexed_t', op: expect.objectContaining({ type: 'create_index', indexName: 'idx_indexed_t_name' }),
      })),
    ],
    [
      'a bare organization key a NULL-safe unique tightens, over clean rows',
      [
        'DROP INDEX "uniq_tenant_t_organization_id_code"',
        'CREATE UNIQUE INDEX "uniq_tenant_t_organization_id_code" ON "tenant_t" ("organization_id", "code")',
      ],
      (drift) => expect(drift).toContainEqual(expect.objectContaining({
        table: 'tenant_t', category: 'safe', op: expect.objectContaining({ type: 'recreate_index', tightenNullSafeOnly: true }),
      })),
    ],
    [
      'the same tightening over duplicate rows the bare key admitted',
      [
        'DROP INDEX "uniq_tenant_t_organization_id_code"',
        'CREATE UNIQUE INDEX "uniq_tenant_t_organization_id_code" ON "tenant_t" ("organization_id", "code")',
        `INSERT INTO "tenant_t" ("id", "code", "organization_id") VALUES ('a', 'X', NULL), ('b', 'X', NULL)`,
      ],
      (drift) => expect(drift).toContainEqual(expect.objectContaining({
        table: 'tenant_t', category: 'destructive', op: expect.objectContaining({ type: 'recreate_index' }),
      })),
    ],
  ];

  it.each(CASES)('%s', async (_label, statements, finding) => {
    const file = nextFile();
    const { driver: remote } = await remoteOver(file);
    await SYNC.syncSchemasBatch(remote, ALL);
    for (const sql of statements) await onDisk(file, sql);
    const local = await localOver(file, ALL);

    const expected = await local.detectManagedDrift(ALL);
    // Non-vacuous: the local face sees the drift the case put on disk.
    finding(expected);
    expect(await remote.detectManagedDrift(ALL)).toEqual(expected);
    expect(await remote.detectManagedDrift()).toEqual(expected);
  });
});

describe('the registry the no-argument call walks', () => {
  it('a skipSchemaSync boot fills it through registerObjectMetadata, sending nothing', async () => {
    const file = nextFile();
    const { driver: synced } = await remoteOver(file);
    await SYNC.syncSchemasBatch(synced, [T]);
    await onDisk(file, 'ALTER TABLE "t" ADD COLUMN "legacy" TEXT');

    const { driver: remote, statements } = await remoteOver(file);
    expect(await remote.detectManagedDrift()).toEqual([]); // nothing has reached this driver yet
    const sent = statements.length;
    remote.registerObjectMetadata([T]);
    expect(statements.length).toBe(sent);

    const local = await localOver(file, [T]);
    const expected = await local.detectManagedDrift([T]);
    expect(expected).toContainEqual(expect.objectContaining({ table: 't', column: 'legacy' }));
    expect(await remote.detectManagedDrift()).toEqual(expected);
  });

  it('a declared table the database does not hold is skipped, as on the local face', async () => {
    const file = nextFile();
    const { driver: remote } = await remoteOver(file);
    await SYNC.syncSchemasBatch(remote, [T]);
    const absent = { name: 'never_created', fields: { x: { type: 'text' } } };
    const local = await localOver(file, [T, absent]);

    expect(await local.detectManagedDrift([T, absent])).toEqual([]);
    expect(await remote.detectManagedDrift([T, absent])).toEqual([]);
  });
});
