// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23816 — `applyMigrationEntries()` on the Turso REMOTE face applies a drift
 * report's index entries and `drop_column` through the libSQL client.
 *
 * Since #20055 the member refused with `NOT_IMPLEMENTED` / 501 there (before
 * that it resolved with every entry `skipped`, destructive ones its caller had
 * allowed included). The v18 organization-ownership ceremony drops its columns
 * through this member, so a hosted tenant on the remote transport could not
 * finish the ceremony at all.
 *
 * ## The instrument
 *
 * A remote-mode `TursoDriver` over a real `@libsql/client` `file:` client: a
 * real libSQL connection, so a `write` batch is the transaction it is on a
 * Turso server. Each entry comes from the remote face's own drift report (the
 * shape the ceremony hands it), and every outcome is read back through a
 * SECOND connection on the file, never through the driver that applied it.
 *
 * ## What is pinned
 *
 * 1. `drop_column` drops the column and every index keyed on it, keeps the
 *    rows, and is not repeated when the column is already gone; without
 *    `allowDestructive` it is skipped and nothing moves.
 * 2. A column SQLite refuses to drop (here a UNIQUE constraint) is skipped,
 *    and the indexes the same batch had dropped first are back: the batch is
 *    one transaction.
 * 3. `drop_index`, `create_index` and `recreate_index` reach their target
 *    state: an 18.0 `COALESCE` organization key on an uncertified nullable
 *    table is rebuilt to the plain key new DDL emits (ADR-0131 D1), and on a
 *    certified database is no entry at all; the NULL-safe tightening (reached
 *    now only through a pre-normalized declaration) re-probes for duplicates
 *    and refuses over them, leaving the old index exactly as it was.
 * 4. A column entry this transport cannot perform (it needs the SQLite table
 *    rebuild) is skipped, not reported applied.
 * 5. Once the report is applied, the remote face reports no drift, and the
 *    local face over the same file agrees.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { TursoDriver } from './turso-driver.js';
import { initObjectsPre18 } from './pre-18-tenant-column.testkit.js';

const scratch = mkdtempSync(join(tmpdir(), 'turso-remote-migrate-'));
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
type Entry = Awaited<ReturnType<TursoDriver['detectManagedDrift']>>[number];

async function remoteOver(file: string): Promise<TursoDriver> {
  const client = createClient({ url: `file:${file}` });
  const driver = new TursoDriver({ url: 'libsql://migrate.example.turso.io', client });
  open.push({ driver, client });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  return driver;
}

/** Read the file through a connection of its own. */
async function secondConnection(file: string, sql: string): Promise<Array<Record<string, unknown>>> {
  const c = createClient({ url: `file:${file}` });
  try {
    return (await c.execute(sql)).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    c.close();
  }
}
async function onDisk(file: string, ...statements: string[]): Promise<void> {
  const c = createClient({ url: `file:${file}` });
  try {
    for (const sql of statements) await c.execute(sql);
  } finally {
    c.close();
  }
}
const columnsOf = async (file: string, table: string) =>
  (await secondConnection(file, `SELECT name FROM pragma_table_info('${table}') ORDER BY cid`)).map((r) => String(r.name));
const indexesOf = async (file: string, table: string) =>
  Object.fromEntries(
    (await secondConnection(file, `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql IS NOT NULL`))
      .map((r) => [String(r.name), String(r.sql)]),
  );

/** `t` as the release declares it: no `legacy`. */
const T = { name: 't', fields: { name: { type: 'text' } } };

/** A remote face whose `t` carries a 17.x-style `legacy` column with its own index, and two rows. */
async function withLegacyColumn(): Promise<{ file: string; remote: TursoDriver; drop: Entry }> {
  const file = nextFile();
  const remote = await remoteOver(file);
  await remote.syncSchemasBatch([{ object: 't', schema: T }]);
  await onDisk(
    file,
    'ALTER TABLE "t" ADD COLUMN "legacy" TEXT',
    'CREATE INDEX "idx_t_legacy" ON "t" ("legacy")',
    'CREATE INDEX "idx_t_name_legacy" ON "t" ("name", "legacy")',
    `INSERT INTO "t" ("id", "name", "legacy") VALUES ('a', 'A', 'x'), ('b', 'B', NULL)`,
  );
  const drop = (await remote.detectManagedDrift()).find((d) => d.op.type === 'drop_column' && d.column === 'legacy');
  expect(drop).toBeDefined();
  return { file, remote, drop: drop! };
}

describe('drop_column', () => {
  it('drops the column and every index keyed on it, keeping the rows', async () => {
    const { file, remote, drop } = await withLegacyColumn();
    expect(Object.keys(await indexesOf(file, 't')).sort()).toEqual(['idx_t_legacy', 'idx_t_name_legacy']);

    const { applied, skipped } = await remote.applyMigrationEntries([drop], { allowDestructive: true });

    expect([applied, skipped]).toEqual([[drop], []]);
    expect(await columnsOf(file, 't')).not.toContain('legacy');
    expect(await indexesOf(file, 't')).toEqual({});
    expect(await secondConnection(file, 'SELECT id, name FROM "t" ORDER BY id')).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    // Re-applied over a column that is gone: nothing to do, so not `applied`.
    expect(await remote.applyMigrationEntries([drop], { allowDestructive: true })).toEqual({ applied: [], skipped: [drop] });
  });

  it('without allowDestructive it is skipped, and nothing moves', async () => {
    const { file, remote, drop } = await withLegacyColumn();
    expect(await remote.applyMigrationEntries([drop])).toEqual({ applied: [], skipped: [drop] });
    expect(await columnsOf(file, 't')).toContain('legacy');
    expect(Object.keys(await indexesOf(file, 't')).sort()).toEqual(['idx_t_legacy', 'idx_t_name_legacy']);
  });

  it('a column SQLite refuses to drop is skipped, and the indexes dropped before it are rolled back', async () => {
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchemasBatch([{ object: 't', schema: T }]);
    // Rebuilt with `legacy` under an inline UNIQUE constraint, plus a plain index on it.
    await onDisk(
      file,
      'DROP TABLE "t"',
      'CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "created_at" TEXT, "updated_at" TEXT, "name" TEXT, "legacy" TEXT UNIQUE)',
      'CREATE INDEX "idx_t_legacy" ON "t" ("legacy")',
    );
    const drop = (await remote.detectManagedDrift()).find((d) => d.op.type === 'drop_column' && d.column === 'legacy')!;
    expect(drop).toBeDefined();

    expect(await remote.applyMigrationEntries([drop], { allowDestructive: true })).toEqual({ applied: [], skipped: [drop] });
    expect(await columnsOf(file, 't')).toContain('legacy');
    expect(Object.keys(await indexesOf(file, 't'))).toEqual(['idx_t_legacy']);
  });
});

const INDEXED = { name: 'indexed_t', fields: { name: { type: 'text' } }, indexes: [{ fields: ['name'] }] };
const TENANT = {
  name: 'tenant_t',
  fields: { code: { type: 'text', unique: true }, organization_id: { type: 'text' } },
};
const TENANT_UNIQUE = 'uniq_tenant_t_organization_id_code';
/**
 * `tenant_t` with its unique declared ALREADY NORMALIZED, carrying the NULL-safe
 * key part itself. ADR-0131 D1: the generators key the plain organization column
 * now, so only an input carrying `nullSafeColumns` (honoured verbatim) still
 * yields the ADR-0120 D4 tightening and its duplicate re-probe.
 */
const TENANT_NULL_SAFE = {
  name: 'tenant_t',
  fields: { code: { type: 'text' }, organization_id: { type: 'text' } },
  indexes: [{ name: TENANT_UNIQUE, fields: ['organization_id', 'code'], unique: true, nullSafeColumns: ['organization_id'] }],
};

describe('the index entries', () => {
  it('drop_index: an undeclared index is dropped, and a second run finds the step done', async () => {
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchemasBatch([{ object: 'indexed_t', schema: { name: 'indexed_t', fields: INDEXED.fields } }]);
    await onDisk(file, 'CREATE INDEX "idx_indexed_t_name" ON "indexed_t" ("name")');
    const drop = (await remote.detectManagedDrift()).find((d) => d.op.type === 'drop_index')!;
    expect(drop).toBeDefined();

    expect(await remote.applyMigrationEntries([drop], { allowDestructive: true })).toEqual({ applied: [drop], skipped: [] });
    expect(await indexesOf(file, 'indexed_t')).toEqual({});
    expect(await remote.applyMigrationEntries([drop], { allowDestructive: true })).toEqual({ applied: [drop], skipped: [] });
  });

  it('create_index: a declared index the table lacks is created as the schema sync creates it', async () => {
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchemasBatch([{ object: 'indexed_t', schema: INDEXED }]);
    const synced = await indexesOf(file, 'indexed_t');
    await onDisk(file, 'DROP INDEX "idx_indexed_t_name"');
    const create = (await remote.detectManagedDrift()).find((d) => d.op.type === 'create_index')!;
    expect(create).toBeDefined();

    expect(await remote.applyMigrationEntries([create])).toEqual({ applied: [create], skipped: [] });
    expect(await indexesOf(file, 'indexed_t')).toEqual(synced);
  });

  /**
   * A tenant table as 18.0 left it: a nullable tenant column (built before
   * 18.x, ADR-0131 D1) and the ADR-0120 D3 `COALESCE` key under the declared
   * name, where HEAD's sync keys the plain column.
   */
  async function coalescedTenantKey() {
    const file = nextFile();
    const remote = await remoteOver(file);
    await initObjectsPre18(remote, TENANT);
    await remote.syncSchemasBatch([{ object: 'tenant_t', schema: TENANT }]);
    const synced = await indexesOf(file, 'tenant_t');
    expect(synced[TENANT_UNIQUE]).not.toMatch(/COALESCE/i);
    await onDisk(
      file,
      `DROP INDEX "${TENANT_UNIQUE}"`,
      `CREATE UNIQUE INDEX "${TENANT_UNIQUE}" ON "tenant_t" (COALESCE("organization_id", '__global__'), "code")`,
    );
    return { file, remote, synced };
  }

  it('recreate_index: an 18.0 COALESCE key on an uncertified nullable table is rebuilt to the plain key', async () => {
    const { file, remote, synced } = await coalescedTenantKey();
    const recreate = (await remote.detectManagedDrift()).find((d) => d.op.type === 'recreate_index')!;
    // Uncertified, the two forms are different constraints: a destructive rebuild, not the D4 tightening.
    expect(recreate).toEqual(expect.objectContaining({ category: 'destructive' }));
    expect(recreate.op).not.toHaveProperty('tightenNullSafeOnly');
    expect(await remote.applyMigrationEntries([recreate])).toEqual({ applied: [], skipped: [recreate] });
    expect(await remote.applyMigrationEntries([recreate], { allowDestructive: true })).toEqual({ applied: [recreate], skipped: [] });
    expect(await indexesOf(file, 'tenant_t')).toEqual(synced);
    expect(await remote.detectManagedDrift()).toEqual([]);
  });

  it('a certified database reads the same 18.0 COALESCE key as the plain one: no entry, and nothing moves', async () => {
    const { file, remote } = await coalescedTenantKey();
    const coalesced = await indexesOf(file, 'tenant_t');
    remote.setTenantKeyCertifiedResolver(() => true);
    expect(await remote.detectManagedDrift()).toEqual([]);
    expect(await indexesOf(file, 'tenant_t')).toEqual(coalesced);
  });

  /** A pre-18 tenant table whose pre-normalized NULL-safe unique was left as the bare composite, optionally over duplicates. */
  async function bareTenantKey(duplicates: boolean) {
    const file = nextFile();
    const remote = await remoteOver(file);
    // A nullable tenant column (a store built before 18.x, ADR-0131 D1): the
    // duplicates the bare key admitted carry no organization, and a NOT NULL
    // column would read the two key forms as one, proposing nothing.
    await initObjectsPre18(remote, TENANT_NULL_SAFE);
    await remote.syncSchemasBatch([{ object: 'tenant_t', schema: TENANT_NULL_SAFE }]);
    const synced = await indexesOf(file, 'tenant_t');
    expect(synced[TENANT_UNIQUE]).toMatch(/COALESCE/i);
    await onDisk(
      file,
      `DROP INDEX "${TENANT_UNIQUE}"`,
      `CREATE UNIQUE INDEX "${TENANT_UNIQUE}" ON "tenant_t" ("organization_id", "code")`,
      ...(duplicates ? [`INSERT INTO "tenant_t" ("id", "code", "organization_id") VALUES ('a', 'X', NULL), ('b', 'X', NULL)`] : []),
    );
    const bare = await indexesOf(file, 'tenant_t');
    const recreate = (await remote.detectManagedDrift()).find((d) => d.op.type === 'recreate_index')!;
    expect(recreate).toBeDefined();
    expect(recreate.op).toEqual(expect.objectContaining({ tightenNullSafeOnly: true, nullSafeColumns: ['organization_id'] }));
    return { file, remote, synced, bare, recreate };
  }

  it('recreate_index: a pre-normalized NULL-safe declaration tightens the bare key over clean rows', async () => {
    const { file, remote, synced, recreate } = await bareTenantKey(false);
    expect(await remote.applyMigrationEntries([recreate], { allowDestructive: true })).toEqual({ applied: [recreate], skipped: [] });
    expect(await indexesOf(file, 'tenant_t')).toEqual(synced);
  });

  it('recreate_index: over duplicates the re-probe refuses, and the old index is exactly as it was', async () => {
    const { file, remote, bare, recreate } = await bareTenantKey(true);
    expect(await remote.applyMigrationEntries([recreate], { allowDestructive: true })).toEqual({ applied: [], skipped: [recreate] });
    expect(await indexesOf(file, 'tenant_t')).toEqual(bare);
  });
});

describe('what this transport cannot perform, and convergence', () => {
  it('a column entry that needs the SQLite table rebuild is skipped, never reported applied', async () => {
    const { file, remote } = await withLegacyColumn();
    const entry = {
      table: 't', column: 'name', kind: 'nullability', category: 'safe', severity: 'warning', message: 'probe',
      op: { type: 'relax_not_null', table: 't', column: 'name' },
    } as unknown as Entry;
    const before = await columnsOf(file, 't');
    expect(await remote.applyMigrationEntries([entry], { allowDestructive: true })).toEqual({ applied: [], skipped: [entry] });
    expect(await columnsOf(file, 't')).toEqual(before);
  });

  it('once the report is applied the remote face reports no drift, and the local face agrees', async () => {
    const { file, remote } = await withLegacyColumn();
    const report = await remote.detectManagedDrift();
    expect(report.length).toBeGreaterThan(0);
    const { skipped } = await remote.applyMigrationEntries(report, { allowDestructive: true });
    expect(skipped).toEqual([]);

    expect(await remote.detectManagedDrift()).toEqual([]);
    const local = new TursoDriver({ url: `file:${file}` });
    open.push({ driver: local, client: null });
    await local.connect();
    local.registerObjectMetadata([T] as Objects);
    expect(await local.detectManagedDrift([T] as Objects)).toEqual([]);
  });
});

describe('the database a migration names', () => {
  // `SqlDriver` keeps the DECLARED target in `config` for
  // `describeDriverConnection`, the CLI's "which database" label, which the
  // organization-ownership ceremony writes into its plan and compares before
  // an apply. The remote face used to keep no target there, so every remote
  // database read `better-sqlite3`.
  it('the remote face keeps its url in config, and still no Knex connection', () => {
    const url = 'libsql://tenant-a.example.turso.io';
    const config = (new TursoDriver({ url, authToken: 'probe' }) as unknown as { config: Record<string, unknown> }).config;
    expect(config).toEqual({ client: 'better-sqlite3', useNullAsDefault: true, url });
    expect('connection' in config).toBe(false);
  });
});

describe('an overlay-index rebuild, the step a host upgrade takes through these two members', () => {
  // The shape a host's v18 upgrade drives: `detectManagedDrift([subject])` for
  // one declared object, apply the one `recreate_index` it reports, and read
  // again, where an entry still there means the rebuild did not take. The
  // object here is test data shaped like an overlay table (a global unique over
  // four columns, two of them nullable); the stale index is the 17.x shape
  // under the same name.
  const OVERLAY = {
    name: 'overlay_t',
    fields: {
      type: { type: 'text' }, name: { type: 'text' }, package_id: { type: 'text' }, bundle_member: { type: 'text' },
    },
    indexes: [{ name: 'idx_overlay_t_active', fields: ['type', 'name', 'package_id', 'bundle_member'], unique: 'global' }],
  };

  it('the stale index is rebuilt to its declared shape, and neither face reports it after', async () => {
    const file = nextFile();
    const remote = await remoteOver(file);
    await remote.syncSchemasBatch([{ object: 'overlay_t', schema: OVERLAY }]);
    const declared = await indexesOf(file, 'overlay_t');
    await onDisk(
      file,
      'ALTER TABLE "overlay_t" ADD COLUMN "organization_id" TEXT',
      'DROP INDEX "idx_overlay_t_active"',
      // Plain key parts: an expression key is outside what the shared differ
      // reproduces (`isSyncReproducibleIndex`), on either face.
      'CREATE UNIQUE INDEX "idx_overlay_t_active" ON "overlay_t" ("type", "name", "organization_id", "package_id")',
    );
    const subject = [OVERLAY] as unknown as Objects;
    const find = async () => (await remote.detectManagedDrift(subject)).find(
      (d) => d.op.type === 'recreate_index' && (d.op as { indexName?: string }).indexName === 'idx_overlay_t_active',
    );
    const entry = await find();
    expect(entry).toBeDefined();

    await remote.applyMigrationEntries([entry!], { allowDestructive: true });

    expect(await find()).toBeUndefined();
    expect((await indexesOf(file, 'overlay_t')).idx_overlay_t_active).toBe(declared.idx_overlay_t_active);
    const local = new TursoDriver({ url: `file:${file}` });
    open.push({ driver: local, client: null });
    await local.connect();
    local.registerObjectMetadata(subject);
    expect((await local.detectManagedDrift(subject)).filter((d) => d.op.type === 'recreate_index')).toEqual([]);
  });
});
