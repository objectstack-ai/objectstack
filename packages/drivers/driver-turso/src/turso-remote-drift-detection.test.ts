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
 *    lacks, an 18.0 `COALESCE` organization key against the plain expectation
 *    on an uncertified nullable table, and a pre-normalized NULL-safe
 *    declaration over a bare key, over clean and over duplicate rows) reads
 *    alike on both faces, with or without explicit objects. On a certified
 *    database the 18.0 key reads as the plain one: no drift on either face
 *    (ADR-0131 D1).
 * 3. The DDL-free `registerObjectMetadata` (a `skipSchemaSync` boot) fills the
 *    registry the no-argument call walks, and sends nothing to the database.
 * 4. A declared table the database does not hold is skipped, as locally.
 * 5. The embedded-replica face, which reads its local file through Knex, still
 *    reports drift on a drifted database (the control the retired refusal
 *    suite carried for this face, kept here at the same layer).
 * 6. `driftReportCaveat`: a sentence on the remote face, which a caller that
 *    would act on the report unattended reads first; `null` on the local and
 *    embedded-replica faces.
 * 7. The no-argument call reads the catalog in the same number of round trips
 *    for one table as for many.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { replicaFiles } from './replica-file.testkit.js';
import { initObjectsPre18 } from './pre-18-tenant-column.testkit.js';

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
const TENANT_UNIQUE = 'uniq_tenant_t_organization_id_code';
/** What 18.0 built under the declared name: the ADR-0120 D3 NULL-safe key part. */
const COALESCE_18_0 = `CREATE UNIQUE INDEX "${TENANT_UNIQUE}" ON "tenant_t" (COALESCE("organization_id", '__global__'), "code")`;
/**
 * `tenant_t` with its unique declared ALREADY NORMALIZED, carrying the NULL-safe
 * key part itself. ADR-0131 D1: the generators key the plain organization column
 * now, so this is the one declaration that still yields the ADR-0120 D4
 * tightening (an input carrying `nullSafeColumns` is honoured verbatim).
 */
const TENANT_NULL_SAFE = {
  name: 'tenant_t',
  fields: { code: { type: 'text' }, label: { type: 'text' }, organization_id: { type: 'text' } },
  indexes: [{ name: TENANT_UNIQUE, fields: ['organization_id', 'code'], unique: true, nullSafeColumns: ['organization_id'] }],
};
const ALL_NULL_SAFE: Objects = [T, TENANT_NULL_SAFE, INDEXED];

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
  // The fourth element: the case needs a nullable tenant column — rows that
  // carry no organization, or an uncertified table whose column could hold
  // them — which only a store built before 18.x has (ADR-0131 D1), so
  // `tenant_t` is built in that shape first (`initObjectsPre18`). The fifth:
  // the declarations, when not `ALL`.
  const CASES: Array<[string, string[], (drift: Drift) => void, boolean?, Objects?]> = [
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
      // ADR-0131 D1: new DDL keys the plain column; on a nullable tenant column
      // with no certification the 18.0 COALESCE key is a different constraint,
      // so the rebuild is destructive (it is NOT the D4 tightening — the
      // expectation carries no NULL-safe part).
      'an 18.0 COALESCE organization key against the plain expectation, on an uncertified nullable table',
      [`DROP INDEX "${TENANT_UNIQUE}"`, COALESCE_18_0],
      (drift) => {
        const entry = drift.find((d) => d.table === 'tenant_t' && d.op.type === 'recreate_index');
        expect(entry).toEqual(expect.objectContaining({
          category: 'destructive', op: expect.objectContaining({ type: 'recreate_index', indexName: TENANT_UNIQUE }),
        }));
        expect(entry!.op).not.toHaveProperty('nullSafeColumns');
        expect(entry!.op).not.toHaveProperty('tightenNullSafeOnly');
      },
      true,
    ],
    [
      'a pre-normalized NULL-safe declaration tightens a bare organization key, over clean rows',
      [`DROP INDEX "${TENANT_UNIQUE}"`, `CREATE UNIQUE INDEX "${TENANT_UNIQUE}" ON "tenant_t" ("organization_id", "code")`],
      (drift) => expect(drift).toContainEqual(expect.objectContaining({
        table: 'tenant_t', category: 'safe', op: expect.objectContaining({ type: 'recreate_index', tightenNullSafeOnly: true }),
      })),
      true,
      ALL_NULL_SAFE,
    ],
    [
      'the same tightening over duplicate rows the bare key admitted',
      [
        `DROP INDEX "${TENANT_UNIQUE}"`,
        `CREATE UNIQUE INDEX "${TENANT_UNIQUE}" ON "tenant_t" ("organization_id", "code")`,
        `INSERT INTO "tenant_t" ("id", "code", "organization_id") VALUES ('a', 'X', NULL), ('b', 'X', NULL)`,
      ],
      (drift) => expect(drift).toContainEqual(expect.objectContaining({
        table: 'tenant_t', category: 'destructive', op: expect.objectContaining({ type: 'recreate_index', tightenNullSafeOnly: true }),
      })),
      true,
      ALL_NULL_SAFE,
    ],
  ];

  it.each(CASES)('%s', async (_label, statements, finding, pre18Tenant, objects = ALL) => {
    const file = nextFile();
    const { driver: remote } = await remoteOver(file);
    if (pre18Tenant) await initObjectsPre18(remote, objects.find((o) => o.name === 'tenant_t')!);
    await SYNC.syncSchemasBatch(remote, objects);
    for (const sql of statements) await onDisk(file, sql);
    const local = await localOver(file, objects);

    const expected = await local.detectManagedDrift(objects);
    // Non-vacuous: the local face sees the drift the case put on disk.
    finding(expected);
    expect(await remote.detectManagedDrift(objects)).toEqual(expected);
    expect(await remote.detectManagedDrift()).toEqual(expected);
  });

  it('the same 18.0 COALESCE key on a certified database reads as the plain one: no drift on either face', async () => {
    // ADR-0131 D1 — the equivalence leg of the uncertified case above: same
    // bytes on disk, the certification resolver answering yes on both faces.
    const file = nextFile();
    const { driver: remote } = await remoteOver(file);
    await initObjectsPre18(remote, TENANT);
    await SYNC.syncSchemasBatch(remote, ALL);
    for (const sql of [`DROP INDEX "${TENANT_UNIQUE}"`, COALESCE_18_0]) await onDisk(file, sql);
    const local = await localOver(file, ALL);
    // Non-vacuous: uncertified, both faces see the destructive rebuild.
    expect((await local.detectManagedDrift(ALL)).map((d) => d.op.type)).toEqual(['recreate_index']);
    expect((await remote.detectManagedDrift(ALL)).map((d) => d.op.type)).toEqual(['recreate_index']);

    local.setTenantKeyCertifiedResolver(() => true);
    remote.setTenantKeyCertifiedResolver(() => true);
    expect(await local.detectManagedDrift(ALL)).toEqual([]);
    expect(await remote.detectManagedDrift(ALL)).toEqual([]);
    expect(await remote.detectManagedDrift()).toEqual([]);
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

describe('the embedded-replica face still reports drift (its Knex detector)', () => {
  const replicas = replicaFiles();
  afterAll(() => replicas.removeAll());

  it.each(['no arguments', 'explicit objects'] as const)('%s', async (call) => {
    // Replica mode reads its local file through Knex; `sync.onConnect: false`
    // keeps the (stubbed) sync target out of the measurement.
    const stub = makeLibsqlSqliteStub();
    const driver = new TursoDriver({
      url: replicas.next(),
      syncUrl: 'libsql://drift.example.turso.io',
      client: stub as never,
      sync: { onConnect: false },
    });
    open.push({ driver, client: null });
    await driver.connect();
    expect(driver.transportMode).toBe('replica');
    await driver.initObjects([T] as never);
    await driver.execute('ALTER TABLE "t" ADD COLUMN "legacy" TEXT');

    const drift = call === 'no arguments' ? await driver.detectManagedDrift() : await driver.detectManagedDrift([T]);

    expect(drift).toEqual([expect.objectContaining({
      table: 't', column: 'legacy', kind: 'unmapped_column', category: 'destructive', op: expect.objectContaining({ type: 'drop_column' }),
    })]);
    stub.close();
  });
});

describe('driftReportCaveat: whether a caller may act on the report unattended', () => {
  it('a sentence on the remote face; null on the local and embedded-replica faces', async () => {
    const { driver: remote } = await remoteOver(nextFile());
    expect(remote.driftReportCaveat).toEqual(expect.stringContaining('NOT NULL'));

    const local = new TursoDriver({ url: `file:${nextFile()}` });
    expect(local.transportMode).toBe('local');
    expect(local.driftReportCaveat).toBeNull();

    const replicas = replicaFiles();
    try {
      const replica = new TursoDriver({ url: replicas.next(), syncUrl: 'libsql://drift.example.turso.io', sync: { onConnect: false } });
      expect(replica.transportMode).toBe('replica');
      expect(replica.driftReportCaveat).toBeNull();
    } finally {
      replicas.removeAll();
    }
  });
});

describe('the no-argument call reads the catalog in a fixed number of round trips', () => {
  /** Every client call a detection makes, counted, one batch as one call. */
  async function roundTripsFor(objects: Objects): Promise<number> {
    const file = nextFile();
    const { driver: synced } = await remoteOver(file);
    await SYNC.syncSchemasBatch(synced, objects);
    const client = createClient({ url: `file:${file}` });
    let calls = 0;
    const counting = {
      execute: (stmt: unknown) => { calls++; return client.execute(stmt as never); },
      batch: (stmts: unknown[], mode?: unknown) => { calls++; return client.batch(stmts as never, mode as never); },
      close: () => client.close(),
    } as unknown as Client;
    const driver = new TursoDriver({ url: 'libsql://drift.example.turso.io', client: counting });
    open.push({ driver, client });
    await driver.connect();
    driver.registerObjectMetadata(objects);
    const before = calls;
    expect(await driver.detectManagedDrift()).toEqual([]);
    return calls - before;
  }

  it('one table and five tables cost the same three reads', async () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `rt_${n}`, fields: { name: { type: 'text' } }, indexes: [{ fields: ['name'] }] }));
    expect(await roundTripsFor(many.slice(0, 1))).toBe(3);
    expect(await roundTripsFor(many)).toBe(3);
  });
});
