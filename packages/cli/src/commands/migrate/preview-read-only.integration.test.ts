// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21349] The two stored-data previews leave the database exactly as they
 * found it — boot included.
 *
 * `os migrate meta --stored` and `os migrate audit-metadata-bodies` are
 * preview-by-default: without `--apply` each one reads, reports, and writes
 * nothing. Both used to boot the plain data stack for that read, and the plain
 * boot is not read-only: it runs schema sync (create-table / add-column) and the
 * artifact's inline seed loader, whose upserts rewrite every seeded row of the
 * app's tables — `updated_at` bumped, `organization_id` stamped, an operator's
 * edit to a seeded row put back to the seed's value. Measured on a database
 * `examples/app-crm` had seeded and signed its first admin into: 28 rows across
 * five app tables changed under each preview.
 *
 * The preview now boots the way `os migrate plan` does (`deferSchemaDdl` +
 * `readOnlyProbe` — `../../utils/schema-migrate.ts`). What this file pins, per
 * command, on the REAL command (oclif parse, occupancy probe, boot, walk,
 * shutdown), against a database a plain boot seeded:
 *
 *  1. the preview leaves the schema and every row byte-identical, while its
 *     report still names the work `--apply` would do — so the identity is not
 *     the vacuous one of a walk that never read anything;
 *  2. the control: `--apply` still applies that work;
 *  3. (SQLite) a preview pointed at a file that does not exist creates no file,
 *     and exits 1 with the refusal its changeset declared (#21391).
 *
 * ## The driver axis
 *
 * The SQLite cell always runs. The live PostgreSQL cell runs when
 * `OS_TEST_POSTGRES_URL` is set, in its own database named from this file's
 * workspace-relative path (the `os_lv_` derivation every live suite shares, so
 * the names stay jointly injective on the one server CI provisions). Without the
 * URL the cell is a NAMED skip, and a FAILURE under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`. ⚠️ A named skip is a report, not coverage:
 * no CI leg supplies the URL to this package today, so until one does this cell
 * runs only where a developer provisions the server.
 *
 * ## What "unchanged" is measured as
 *
 * The schema plus every row of every table, read on a connection of our own —
 * never a hash of the database file: SQLite rewrites header bytes on any
 * read-write open, so a file hash moves after a run that only SELECTed
 * (`duplicates.integration.test.ts` records the measurement).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import MigrateMeta from './meta.js';
import MigrateAuditMetadataBodies from './audit-metadata-bodies.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { isExitSignal } from '../../utils/format.js';

// [#10126] Pay the first transform of this dist-resolved workspace dep at
// MODULE LOAD: the fixture's served boot reaches it through a dynamic
// `import()` inside a clocked hook (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');

/** A boot plus a command run — oclif builds its command table on the first run in a process. */
const CASE_TIMEOUT_MS = 120_000;

/** Elevated so the fixture's writes bypass RLS on system objects. */
const SYSTEM = { context: { isSystem: true } };

const ARTIFACT = {
  manifest: { id: 'com.example.preview-read-only', name: 'Preview Read Only', version: '0.0.0', type: 'app' },
  objects: [{ name: 'rp_lead', fields: { name: { type: 'text' }, status: { type: 'text' } } }],
  // The inline seed a plain boot upserts on EVERY start.
  data: [{ object: 'rp_lead', externalId: 'name', mode: 'upsert', records: [{ name: 'Acme', status: 'open' }] }],
};

/**
 * A pre-17 flow — `delete_record` carrying `config.filters`, which the
 * `flow-node-crud-filter-alias` conversion renames to `filter` — so
 * `meta --stored` has one row to report (preview) and rewrite (`--apply`).
 */
const LEGACY_FLOW = {
  name: 'rp_purge',
  label: 'Purge',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'n0', type: 'start', label: 'Start' },
    { id: 'n1', type: 'delete_record', label: 'Purge', config: { objectName: 'rp_lead', filters: { status: 'stale' } } },
  ],
  edges: [{ id: 'e1', source: 'n0', target: 'n1' }],
};

/** The credential an old audit copy of a datasource body still carries in cleartext. */
const CRED = 'preview-read-only-cred-21349';
const AUDIT_ROW_ID = 'aud_preview_21349';
const AUDIT_COPY = JSON.stringify({
  id: 'm_preview_21349',
  name: 'ds',
  type: 'datasource',
  scope: 'platform',
  metadata: JSON.stringify({ name: 'ds', driver: 'turso', config: { url: 'libsql://db.turso.io', encryptionKey: CRED } }),
});

/** Env that would point the command's boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

// ── The driver axis ──────────────────────────────────────────────────────────

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const EXPECT_LIVE_DIALECTS = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';
/** Adopted from driver-sql's live matrix (`LIVE_CELL_TIMEOUT_MS`): above the driver's own connect bound. */
const LIVE_CELL_TIMEOUT_MS = 180_000;
const LIVE_DB_PREFIX = 'os_lv_';

/**
 * This file's live database: `os_lv_<slug>_<12 hex of sha256(path)>`, the
 * derivation `packages/drivers/driver-sql/src/live-dialect-matrix.testkit.ts`
 * and `packages/runtime/src/cascade-delete-multivalue-lookup-real-driver.integration.test.ts`
 * use. A copy rather than an import: that testkit is not on driver-sql's public
 * surface, and importing another package's `src/` moves this file's resolution
 * domain.
 */
function liveDatabaseNameFor(testFileKey: string): string {
  const key = testFileKey.replace(/\\/g, '/');
  const slug = basename(key)
    .replace(/\.test\.tsx?$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  const name = `${LIVE_DB_PREFIX}${slug}_${hash}`;
  if (!/^[a-z][a-z0-9_]*$/.test(name) || name.length > 63) {
    throw new Error(`live-dialect isolation: derived an unusable database name ${JSON.stringify(name)}`);
  }
  return name;
}

/** The test path relative to the workspace root, so a worktree and CI derive the same name. */
function repoRelativeTestPath(absolutePath: string): string {
  let dir = dirname(absolutePath);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return absolutePath.slice(dir.length + 1);
    const parent = dirname(dir);
    if (parent === dir) return basename(absolutePath);
    dir = parent;
  }
}

function currentLiveDatabase(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error(
      'live-dialect isolation: vitest reported no testPath, so the live cell cannot be given a database of its '
        + 'own and would share one with every other live suite on the server.',
    );
  }
  return liveDatabaseNameFor(repoRelativeTestPath(testPath));
}

const LIVE_DATABASE = currentLiveDatabase();

/** The live URL with its database swapped for this file's own. */
function liveUrl(): string {
  const url = new URL(PG_URL!);
  url.pathname = `/${LIVE_DATABASE}`;
  return url.toString();
}

/** Drop and recreate this file's live database, from a connection to the URL's own database. */
async function resetLiveDatabase(): Promise<void> {
  const admin = new SqlDriver({ client: 'pg', connection: PG_URL });
  try {
    await admin.execute(`DROP DATABASE IF EXISTS "${LIVE_DATABASE}" WITH (FORCE)`);
    await admin.execute(`CREATE DATABASE "${LIVE_DATABASE}"`);
  } finally {
    await admin.disconnect();
  }
}

afterAll(async () => {
  if (!PG_URL) return;
  const admin = new SqlDriver({ client: 'pg', connection: PG_URL });
  try {
    await admin.execute(`DROP DATABASE IF EXISTS "${LIVE_DATABASE}" WITH (FORCE)`);
  } finally {
    await admin.disconnect();
  }
});

interface DialectCell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  available: boolean;
  timeout: number;
}

const DIALECT_CELLS: readonly DialectCell[] = [
  { id: 'sqlite', label: 'better-sqlite3', env: null, available: true, timeout: CASE_TIMEOUT_MS },
  { id: 'pg', label: 'live postgres', env: 'OS_TEST_POSTGRES_URL', available: !!PG_URL, timeout: LIVE_CELL_TIMEOUT_MS },
];

// ── The fixture database ─────────────────────────────────────────────────────

interface Fixture {
  dir: string;
  databaseUrl: string;
  /** A probe connection of our own, never the booted stack's. */
  probe: () => SqlDriver;
  cleanup: () => Promise<void>;
}

async function createFixture(cell: DialectCell): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'os-21349-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));
  // The standalone stack reads `OS_ARTIFACT_PATH`, else `<cwd>/dist/objectstack.json`
  // — never `projectRoot` — so the fixture boot and the command both need it.
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');

  let databaseUrl: string;
  let probe: () => SqlDriver;
  if (cell.id === 'pg') {
    await resetLiveDatabase();
    databaseUrl = liveUrl();
    probe = () => new SqlDriver({ client: 'pg', connection: databaseUrl });
  } else {
    const dbFile = join(dir, 'data', 'app.db');
    databaseUrl = `file:${dbFile}`;
    probe = () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  }

  // The deployment as a served boot left it: every table either command reads,
  // the artifact's seed written, then an operator's edit to the seeded row, a
  // legacy flow row, and an audit copy of a datasource body in cleartext.
  //
  // [#21391] A SERVED boot, not `bootSchemaStack`: no one-shot boot runs the
  // seed loader any more, so the funnel cannot stand in for `os dev` here.
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const served = await createStandaloneStack({ projectRoot: dir, databaseUrl });
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of served.plugins) await kernel.use(plugin as any);
  for (const plugin of await buildDataMigrationPlugins({ automation: true, audit: true })) await kernel.use(plugin as any);
  await runtime.start();
  try {
    const ql = kernel.getService('objectql') as IObjectQLEngine;
    const [acme] = await ql.find('rp_lead', { where: { name: 'Acme' } }, SYSTEM);
    expect(acme?.status, 'the served boot did not write the artifact seed — nothing to protect').toBe('open');
    await ql.update('rp_lead', { id: acme.id, status: 'won' }, SYSTEM);
    await ql.insert('sys_metadata', {
      type: 'flow',
      name: LEGACY_FLOW.name,
      state: 'active',
      metadata: JSON.stringify(LEGACY_FLOW),
    }, SYSTEM);
  } finally {
    await kernel.shutdown();
  }
  const raw = probe();
  try {
    await (raw as any).knex('sys_audit_log').insert({
      id: AUDIT_ROW_ID,
      object_name: 'sys_metadata',
      record_id: 'm_preview_21349',
      action: 'create',
      new_value: AUDIT_COPY,
    });
  } finally {
    await raw.disconnect();
  }

  return {
    dir,
    databaseUrl,
    probe,
    cleanup: async () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/** The schema plus every row of every table, ordered, as plain JSON. */
async function readState(cell: DialectCell, fixture: Fixture): Promise<unknown> {
  const driver = fixture.probe();
  const k = (driver as any).knex;
  try {
    if (cell.id === 'pg') {
      const tables = (await k.raw(
        `SELECT table_name, table_type FROM information_schema.tables
          WHERE table_schema = current_schema() ORDER BY table_name`,
      )).rows as Array<{ table_name: string; table_type: string }>;
      const columns = (await k.raw(
        `SELECT table_name, column_name, data_type, column_default, is_nullable FROM information_schema.columns
          WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`,
      )).rows;
      const indexes = (await k.raw(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY indexname`,
      )).rows;
      const rows: Record<string, unknown> = {};
      for (const t of tables) {
        if (t.table_type !== 'BASE TABLE') continue;
        rows[t.table_name] = (await k.raw(
          `SELECT row_to_json(t)::text AS r FROM "${t.table_name}" t ORDER BY 1`,
        )).rows.map((r: { r: string }) => r.r);
      }
      return { tables, columns, indexes, rows };
    }
    const schema = await k.raw('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
    const rows: Record<string, unknown> = {};
    for (const entry of schema as Array<{ type: string; name: string }>) {
      if (entry.type !== 'table' || entry.name.startsWith('sqlite_')) continue;
      rows[entry.name] = await k.raw(`SELECT * FROM "${entry.name}" ORDER BY rowid`);
    }
    return { schema, rows };
  } finally {
    await driver.disconnect();
  }
}

// ── Running the real command ─────────────────────────────────────────────────

/** One command, run through oclif exactly as the binary runs it. */
type Invoke = (argv: string[]) => Promise<unknown>;
const meta: Invoke = (argv) => MigrateMeta.run(argv, { root: CLI_ROOT });
const auditBodies: Invoke = (argv) => MigrateAuditMetadataBodies.run(argv, { root: CLI_ROOT });

/**
 * Run one command and capture its one `--json` document. `process.exitCode` is
 * process-global and `emitJson` sets it, so it is saved and restored; the
 * stdout spy is installed before the boot because a `--json` boot reserves
 * stdout and keeps whatever `process.stdout.write` is at that moment.
 */
async function runJson(
  command: Invoke,
  argv: string[],
): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let thrownExit: number | undefined;
  try {
    try {
      await command([...argv, '--json']);
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    return { payload: JSON.parse(out), exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

// ── The matrix ───────────────────────────────────────────────────────────────

function declareUnprovisionedCell(cell: DialectCell): void {
  describe(`os migrate stored-data previews boot read-only (${cell.label})`, () => {
    it.skipIf(!EXPECT_LIVE_DIALECTS)(`is provisioned — set ${cell.env} to run this cell`, () => {
      expect.fail(
        `${cell.env} is unset while OS_EXPECT_LIVE_DIALECT_MATRIX=1: this runner declared it provisions a live `
          + `server, so the ${cell.label} cell of the read-only preview pins must not be skipped.`,
      );
    });
  });
}

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell);
    continue;
  }

  describe(`os migrate stored-data previews boot read-only (${cell.label})`, () => {
    const savedEnv: Record<string, string | undefined> = {};
    const savedCwd = process.cwd();
    let fixture: Fixture | null = null;

    beforeEach(async () => {
      for (const key of [...OVERRIDING_ENV, 'OS_ARTIFACT_PATH', 'NODE_ENV'] as const) {
        savedEnv[key] = process.env[key];
      }
      for (const key of OVERRIDING_ENV) delete process.env[key];
      process.env.NODE_ENV = 'production';
      fixture = await createFixture(cell);
      // The commands take `process.cwd()` as the project root, as a real
      // invocation from the project directory does.
      process.chdir(fixture.dir);
    }, cell.timeout);

    afterEach(async () => {
      process.chdir(savedCwd);
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fixture?.cleanup();
      fixture = null;
    });

    it('meta --stored without --apply reports the legacy row and leaves every row and the schema unchanged', async () => {
      const before = await readState(cell, fixture!);
      const { payload } = await runJson(meta, ['--stored', '--database-url', fixture!.databaseUrl]);

      // The walk really read: the legacy flow row is the pending work.
      expect(payload.apply).toBe(false);
      expect(payload.pending).toBe(1);
      expect(payload.rewritten).toBe(0);
      expect(await readState(cell, fixture!)).toEqual(before);
    }, cell.timeout);

    it('meta --stored --apply still rewrites the legacy row (the control)', async () => {
      const { payload } = await runJson(meta, ['--stored', '--apply', '--yes', '--database-url', fixture!.databaseUrl]);

      expect(payload.apply).toBe(true);
      expect(payload.rewritten).toBe(1);
      const driver = fixture!.probe();
      try {
        const [row] = await (driver as any).knex('sys_metadata').where({ type: 'flow', name: LEGACY_FLOW.name, state: 'active' });
        const stored = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        expect(stored.nodes.find((n: { id: string }) => n.id === 'n1').config)
          .toEqual({ objectName: 'rp_lead', filter: { status: 'stale' } });
      } finally {
        await driver.disconnect();
      }
    }, cell.timeout);

    it('audit-metadata-bodies without --apply reports the cleartext copy and leaves every row and the schema unchanged', async () => {
      const before = await readState(cell, fixture!);
      const { payload } = await runJson(auditBodies, ['--database-url', fixture!.databaseUrl]);

      expect(payload.apply).toBe(false);
      expect(payload.report.byObject.sys_audit_log.rewritten).toBe(1);
      expect(payload.report.failures).toBe(0);
      expect(await readState(cell, fixture!)).toEqual(before);
    }, cell.timeout);

    it('audit-metadata-bodies --apply still redacts the cleartext copy (the control)', async () => {
      const { payload } = await runJson(auditBodies, ['--apply', '--yes', '--database-url', fixture!.databaseUrl]);

      expect(payload.apply).toBe(true);
      expect(payload.report.byObject.sys_audit_log.rewritten).toBe(1);
      const driver = fixture!.probe();
      try {
        const [row] = await (driver as any).knex('sys_audit_log').where({ id: AUDIT_ROW_ID });
        expect(String(row.new_value)).not.toContain(CRED);
      } finally {
        await driver.disconnect();
      }
    }, cell.timeout);

    if (cell.id === 'sqlite') {
      it.each([
        ['meta --stored', meta, ['--stored']],
        ['audit-metadata-bodies', auditBodies, []],
      ] as Array<[string, Invoke, string[]]>)('%s without --apply creates no database file where none existed', async (_name, command, argv) => {
        const absent = join(fixture!.dir, 'data', 'never-started.db');
        await runJson(command, [...argv, '--database-url', `file:${absent}`]);

        for (const path of [absent, `${absent}-wal`, `${absent}-shm`, `${absent}-journal`]) {
          expect(existsSync(path), `${path} was created by a preview`).toBe(false);
        }
      }, cell.timeout);

      // [#21391] The edge #21349's changeset declared BREAKING: a preview whose
      // database lacks the table it reads used to create the table and answer
      // "nothing to examine" with exit 0. It now refuses with exit 1 and names
      // what it could not read. Both halves are asserted: the exit code a
      // script reads, and the refusal the payload carries.
      it('meta --stored without --apply on a database that does not exist exits 1 with the driver\'s refusal for sys_metadata', async () => {
        const absent = join(fixture!.dir, 'data', 'never-started.db');
        const { payload, exitCode } = await runJson(meta, ['--stored', '--database-url', `file:${absent}`]);

        expect(exitCode).toBe(1);
        expect(payload.code).toBe('DATABASE_ERROR');
        expect(payload.error).toContain("'sys_metadata'");
      }, cell.timeout);

      // [#21207] The audit reads a third table: the decision-audit trail, whose
      // conflict notes named stored content hashes. The #21391 intent is
      // unchanged — EVERY audited table is counted unread — so the expected set
      // is the whole audited set, stated literally: a widening that is not
      // carried here turns this case red instead of passing on a stale count.
      it('audit-metadata-bodies without --apply on a database that does not exist exits 1 with every audited table counted unread', async () => {
        const absent = join(fixture!.dir, 'data', 'never-started.db');
        const { payload, exitCode } = await runJson(auditBodies, ['--database-url', `file:${absent}`]);
        const audited = ['sys_activity', 'sys_audit_log', 'sys_metadata_audit'];

        expect(exitCode).toBe(1);
        expect(payload.apply).toBe(false);
        // `failures` counts the tables whose rows were NOT examined.
        expect(payload.report.failures).toBe(audited.length);
        expect(payload.report.scanned).toBe(0);
        expect(Object.keys(payload.report.byObject).sort()).toEqual(audited);
      }, cell.timeout);
    }
  });
}
