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
 *    rebuild: a tightened NOT NULL) is skipped, not reported applied.
 * 5. Once the report is applied, the remote face reports no drift, and the
 *    local face over the same file agrees.
 * 6. [#33724] `relax_not_null` is applied in place, with libSQL's own
 *    `ALTER TABLE … ALTER COLUMN … TO …` (ruling 6915086281, letter A): only
 *    the NOT NULL clause leaves the stored definition, the rows, the indexes,
 *    the DEFAULT and the CHECK stay, and the entry is reported applied only on
 *    a read-back. A statement the database refuses, or a splice the plan did
 *    not predict, rolls back whole and is skipped. Through the install's
 *    declared relax (`relaxDeclaredNotNull`) too, and never by a boot.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
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

/** The table's stored `CREATE TABLE`, read through a connection of its own. */
const tableSqlOf = async (file: string, table: string) =>
  String((await secondConnection(file, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`))[0]?.sql);
/** `name → { type, notNull, dflt }` from `pragma_table_info`, read through a connection of its own. */
const columnFactsOf = async (file: string, table: string) =>
  Object.fromEntries(
    (await secondConnection(file, `SELECT name, type, "notnull" AS nn, dflt_value FROM pragma_table_info('${table}')`))
      .map((r) => [String(r.name), { type: r.type, notNull: Number(r.nn) === 1, dflt: r.dflt_value }]),
  );
/** Run one statement on the file through a connection of its own: its error message, or `'ok'`. */
async function tryOnDisk(file: string, sql: string): Promise<string> {
  try {
    await onDisk(file, sql);
    return 'ok';
  } catch (e) {
    return (e as Error).message;
  }
}

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
    expect(Object.keys(await indexesOf(file, 't')).sort()).toEqual(['idx_t_created_at_id', 'idx_t_legacy', 'idx_t_name_legacy']);

    const { applied, skipped } = await remote.applyMigrationEntries([drop], { allowDestructive: true });

    expect([applied, skipped]).toEqual([[drop], []]);
    expect(await columnsOf(file, 't')).not.toContain('legacy');
    // [#33695] The implicit default-order index is keyed on no dropped column, so it stays.
    expect(Object.keys(await indexesOf(file, 't'))).toEqual(['idx_t_created_at_id']);
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
    expect(Object.keys(await indexesOf(file, 't')).sort()).toEqual(['idx_t_created_at_id', 'idx_t_legacy', 'idx_t_name_legacy']);
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
    // [#33695] Only the undeclared index goes; the implicit default-order index stays.
    expect(Object.keys(await indexesOf(file, 'indexed_t'))).toEqual(['idx_indexed_t_created_at_id']);
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
      table: 't', column: 'name', kind: 'nullability', category: 'destructive', severity: 'warning', message: 'probe',
      op: { type: 'tighten_not_null', table: 't', column: 'name' },
    } as unknown as Entry;
    const before = await tableSqlOf(file, 't');
    expect(await remote.applyMigrationEntries([entry], { allowDestructive: true })).toEqual({ applied: [], skipped: [entry] });
    expect(await tableSqlOf(file, 't')).toBe(before);
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

/**
 * `p` as a hosted table can hold it: `price` NOT NULL with a DEFAULT and a
 * CHECK, `code` under a named NOT NULL with ON CONFLICT and a COLLATE, an index
 * on each, two rows. Declared with neither NOT NULL, so the report relaxes both.
 */
const P_DDL =
  `CREATE TABLE "p" ("id" TEXT PRIMARY KEY, "price" REAL NOT NULL DEFAULT 0 CHECK ("price" >= 0), ` +
  `"code" TEXT CONSTRAINT "nn_code" NOT NULL ON CONFLICT ABORT COLLATE NOCASE, "memo" TEXT)`;
const P = { name: 'p', fields: { price: { type: 'number' }, code: { type: 'text' }, memo: { type: 'text' } } };

async function withNotNullColumns(ddl = P_DDL): Promise<{ file: string; remote: TursoDriver }> {
  const file = nextFile();
  await onDisk(
    file,
    ddl,
    'CREATE INDEX "idx_p_price" ON "p" ("price")',
    'CREATE UNIQUE INDEX "uniq_p_code" ON "p" ("code")',
    `INSERT INTO "p" ("id", "price", "code", "memo") VALUES ('a', 1.5, 'A', 'x'), ('b', 2, 'B', NULL)`,
  );
  const remote = await remoteOver(file);
  remote.registerObjectMetadata([P] as Objects);
  return { file, remote };
}

/** The driver's `logger.warn` lines, captured (the diagnostic channel the apply door logs a skipped entry's reason on). */
function warnLines(driver: TursoDriver): () => string[] {
  const logger = (driver as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger;
  const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  return () => spy.mock.calls.map((c) => c.map(String).join(' '));
}

const relaxes = async (remote: TursoDriver) =>
  (await remote.detectManagedDrift([P] as Objects)).filter((d) => d.op.type === 'relax_not_null');

describe('relax_not_null in place, with libSQL\'s ALTER COLUMN (#33724, ruling 6915086281)', () => {
  it('both columns are relaxed and reported applied; only the NOT NULL clauses leave the stored SQL', async () => {
    const { file, remote } = await withNotNullColumns();
    const entries = await relaxes(remote);
    expect(entries.map((d) => d.column).sort()).toEqual(['code', 'price']);
    const facts = await columnFactsOf(file, 'p');
    const indexes = await indexesOf(file, 'p');

    expect(await remote.applyMigrationEntries(entries)).toEqual({ applied: entries, skipped: [] });

    expect(await tableSqlOf(file, 'p')).toBe(
      `CREATE TABLE "p" ("id" TEXT PRIMARY KEY, "price" REAL DEFAULT 0 CHECK ("price" >= 0), "code" TEXT COLLATE NOCASE, "memo" TEXT)`,
    );
    // The type and the DEFAULT the database held, the index set, the rows.
    expect(await columnFactsOf(file, 'p')).toEqual({
      ...facts,
      price: { ...facts.price, notNull: false },
      code: { ...facts.code, notNull: false },
    });
    expect(await indexesOf(file, 'p')).toEqual(indexes);
    expect(await secondConnection(file, 'SELECT id, price, code, memo FROM "p" ORDER BY id')).toEqual([
      { id: 'a', price: 1.5, code: 'A', memo: 'x' },
      { id: 'b', price: 2, code: 'B', memo: null },
    ]);
    // The write the constraint used to refuse; the CHECK, the DEFAULT and the COLLATE still hold.
    expect(await tryOnDisk(file, `INSERT INTO "p" ("id", "price", "code") VALUES ('c', NULL, NULL)`)).toBe('ok');
    expect(await tryOnDisk(file, `INSERT INTO "p" ("id", "price", "code") VALUES ('d', -1, 'D')`)).toMatch(/CHECK constraint failed/);
    expect(await tryOnDisk(file, `INSERT INTO "p" ("id", "code") VALUES ('e', 'E')`)).toBe('ok');
    expect(await secondConnection(file, `SELECT price FROM "p" WHERE id = 'e'`)).toEqual([{ price: 0 }]);
    expect(await tryOnDisk(file, `INSERT INTO "p" ("id", "code") VALUES ('f', 'a')`)).toMatch(/UNIQUE constraint failed/);
    expect((await secondConnection(file, 'PRAGMA integrity_check'))[0]).toEqual({ integrity_check: 'ok' });

    // Converged: the remote face reports no relax, and a re-run has nothing to
    // do, and says so: the apply tells the operator its log says why.
    expect(await relaxes(remote)).toEqual([]);
    const warned = warnLines(remote);
    expect(await remote.applyMigrationEntries(entries)).toEqual({ applied: [], skipped: entries });
    expect(warned().filter((l) => l.includes('relax_not_null on p.')).map((l) => l.replace(/^.*relax_not_null on (p\.\w+).*: /, '$1: ')).sort()).toEqual([
      'p.code: the column is already nullable; nothing was sent',
      'p.price: the column is already nullable; nothing was sent',
    ]);
  });

  it('a DEFAULT libSQL cannot splice (a comma inside it) is refused whole: skipped, and the table byte-identical', async () => {
    // Measured on libSQL (SQLite 3.45.1): it ends the old definition at the
    // first comma after the column's name, so a comma inside a DEFAULT, a
    // CHECK, a width or a comment makes the spliced CREATE TABLE unparseable,
    // and the statement is refused. Ruling parameter 4: no fall-back.
    const ddl = `CREATE TABLE "p" ("id" TEXT PRIMARY KEY, "price" REAL, "code" TEXT NOT NULL DEFAULT ('a,b'), "memo" TEXT)`;
    const { file, remote } = await withNotNullColumns(ddl);
    const entries = await relaxes(remote);
    expect(entries.map((d) => d.column)).toEqual(['code']);
    const before = await tableSqlOf(file, 'p');
    const warned = warnLines(remote);

    expect(await remote.applyMigrationEntries(entries)).toEqual({ applied: [], skipped: entries });

    expect(await tableSqlOf(file, 'p')).toBe(before);
    expect((await columnFactsOf(file, 'p')).code?.notNull).toBe(true);
    // Called refused only because the stored SQL, read again, is what it was.
    const [line] = warned().filter((l) => l.includes('relax_not_null on p.code'));
    expect(line).toContain('and the stored table SQL reads as before, so nothing landed');
    // …and names the class (ruling 6922037129): the comma, and the NOT NULL the column keeps.
    expect(line).toContain("The column's stored definition holds a comma");
    expect(line).toContain('so this transport cannot relax it: the column keeps its NOT NULL');
  });

  it('a transport error after the server committed is logged as an unknown outcome, never as a rollback', async () => {
    const { file, remote } = await withNotNullColumns();
    const [entry] = (await relaxes(remote)).filter((d) => d.column === 'price');
    const transport = (remote as unknown as { remoteTransport: { batch: (s: unknown[], m: string) => Promise<unknown> } }).remoteTransport;
    const send = transport.batch.bind(transport);
    transport.batch = async (statements, mode) => {
      const answer = await send(statements, mode);
      if (typeof statements[0] === 'string' && statements[0].includes('ALTER COLUMN')) throw new Error('fetch failed: socket hang up');
      return answer;
    };
    const warned = warnLines(remote);

    expect(await remote.applyMigrationEntries([entry!])).toEqual({ applied: [], skipped: [entry] });

    // The batch did land: the column is nullable, and the log does not say otherwise.
    expect((await columnFactsOf(file, 'p')).price?.notNull).toBe(false);
    const [line] = warned().filter((l) => l.includes('relax_not_null on p.price'));
    expect(line).toContain('failed (fetch failed: socket hang up), and its outcome is unknown');
    expect(line).toContain('the next drift read decides');
    expect(line).not.toContain('nothing landed');
    // …and the next drift read finds no relax left to do on it.
    expect((await relaxes(remote)).map((d) => d.column)).toEqual(['code']);
  });

  it('a splice the plan did not predict lands nowhere: the check in the same batch rolls the statement back', async () => {
    const { file, remote } = await withNotNullColumns();
    const [entry] = (await relaxes(remote)).filter((d) => d.column === 'price');
    const before = await tableSqlOf(file, 'p');
    // A database that accepts the statement but stores another definition than
    // the one sent: here, the statement itself is altered on its way out.
    const transport = (remote as unknown as { remoteTransport: { batch: (s: unknown[], m: string) => Promise<unknown> } }).remoteTransport;
    const send = transport.batch.bind(transport);
    let checked = false;
    transport.batch = (statements, mode) => {
      if (typeof statements[0] === 'string' && statements[0].includes('ALTER COLUMN')) {
        checked = statements.length === 2;
        statements = [statements[0].replace(/ CHECK \("price" >= 0\)$/, ''), ...statements.slice(1)];
      }
      return send(statements, mode);
    };
    const warned = warnLines(remote);

    expect(await remote.applyMigrationEntries([entry!])).toEqual({ applied: [], skipped: [entry] });

    expect(checked).toBe(true);
    expect(await tableSqlOf(file, 'p')).toBe(before);
    // A comma-free definition is not called the comma class.
    const [line] = warned().filter((l) => l.includes('relax_not_null on p.price'));
    expect(line).toContain('so nothing landed');
    expect(line).not.toContain('holds a comma');
    expect((await columnFactsOf(file, 'p')).price?.notNull).toBe(true);
  });
});

describe('the install\'s declared NOT NULL relax (#33724)', () => {
  it('a declared `storage: { notNull: false }` over a NOT NULL column is relaxed in place and reported applied', async () => {
    const file = nextFile();
    const remote = await remoteOver(file);
    const V1 = { name: 'p', fields: { price: { type: 'number', storage: { notNull: true } } } };
    const V2 = { name: 'p', fields: { price: { type: 'number', storage: { notNull: false } } } };
    await remote.syncSchemasBatch([{ object: 'p', schema: V1 }]);
    const priceOf = async () => (await columnFactsOf(file, 'p')).price;
    const before = await priceOf();
    expect(before?.notNull).toBe(true);

    // ADR-0113 D5: the boot's sync of the upgraded declaration never relaxes.
    await remote.syncSchemasBatch([{ object: 'p', schema: V2 }]);
    expect((await priceOf())?.notNull).toBe(true);
    remote.registerObjectMetadata([V2] as Objects);

    const report = await remote.relaxDeclaredNotNull(V2, ['price'], { packageId: 'com.acme.crm' });

    expect(report.skipped).toEqual([]);
    expect(report.applied.map((e) => `${e.op.type}:${e.column}`)).toEqual(['relax_not_null:price']);
    expect(await priceOf()).toEqual({ ...before, notNull: false });
    expect(await tryOnDisk(file, `INSERT INTO "p" ("id", "price") VALUES ('n', NULL)`)).toBe('ok');
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
