// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23816 — the v18 organization-ownership ceremony, plan and apply, completes
 * on a Turso REMOTE database: a real `sqld` reached as
 * `libsql://127.0.0.1:<port>?tls=0`, the transport every hosted tenant uses.
 *
 * ## What used to happen
 *
 * Both boots armed deferred schema DDL unconditionally, and the remote face
 * refuses that (`Deferred schema DDL is not supported by the Turso REMOTE
 * transport`), so the plan exited 1 before reading a table; the column drops
 * then went through `detectManagedDrift` + `applyMigrationEntries`, which the
 * remote face refused too. Every hosted environment holding 17.x data stopped
 * at its first v18 request.
 *
 * ## The case
 *
 * The 17.x database is built the way an environment gets one: an ordinary,
 * syncing boot of the composition the ceremony boots, against the server (the
 * additive sync on the remote face), then the 17.x leftovers a second libSQL
 * connection adds — an `organization_id` column and the tenant index keyed on
 * it, on `column-drop` tables, and rows. Then the real command, plan then
 * `--apply --backup-taken`, and every claim is read back through a SECOND
 * connection to the server's own database:
 *
 *  - the plan exits 0 and leaves the database byte-identical (a logical dump of
 *    every catalog row and every table's rows, before and after), and names the
 *    remote database, not the placeholder Knex client;
 *  - the apply completes with `blocking 0`, the declared sharing-rule mirrors a
 *    17.x seeder left deleted by its mirror-deletion step (ADR-0131 C3 stage 9:
 *    the registry serves declared rules, and no grant names these copies);
 *  - each column and the index keyed on it are gone from the server, the rows
 *    are not, and the `adr-0131-organization-ownership` marker is verified.
 *
 * ## How to run it
 *
 * It needs a `sqld` binary (libsql-server), so it is skipped unless
 * `OS_TEST_SQLD_BIN` names one; the case starts its own server on a free port
 * over a temporary directory and stops it afterwards. One way to get the binary
 * is the npm package that ships it (`npm pack @sqld/linux-x64` or
 * `@sqld/darwin-arm64`, then `tar -xzf` and point the variable at
 * `package/sqld`); the `ghcr.io/tursodatabase/libsql-server` image and the
 * Turso CLI's `turso dev` carry the same server.
 *
 *     OS_TEST_SQLD_BIN=/path/to/sqld pnpm --filter @objectstack/cli exec \
 *       vitest run --project integration src/commands/migrate/organization-ownership.remote-face.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TursoDriver } from '@objectstack/driver-turso';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { isExitSignal } from '../../utils/format.js';
import { OrganizationOwnershipCeremony as MigrateOrganizationOwnership } from './organization-ownership.js';

// Paid at module load, not inside a clocked case (`check:test-source-alias`).
import '@objectstack/runtime';
import '@objectstack/objectql';

const SQLD = process.env.OS_TEST_SQLD_BIN;
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;

/** Env that would point a boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'OS_DATABASE_AUTH_TOKEN',
  'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH', 'OS_TELEMETRY_DB', 'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED', 'OS_SKIP_SCHEMA_SYNC',
] as const;

/** `column-drop` tables the 17.x leftovers are put on, when the composition has them. */
const LEFTOVER_CANDIDATES = ['sys_job', 'sys_metadata_activation', 'sys_presence'] as const;
/** Declared sharing rules a 17.x seeder wrote organization-less (HotCRM declares eleven). */
const RULE_MIRRORS = 11;

let dir: string;
let projectDir: string;
let server: ChildProcess | undefined;
let url: string;
let leftovers: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

const freePort = (): Promise<number> =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

type Rows = Array<Record<string, unknown>>;
type Exec = (sql: string, args?: unknown[]) => Promise<Rows>;

/**
 * A second connection to the server, separate from every driver the command
 * boots: a remote-mode driver of its own, so its own libSQL client.
 */
async function secondConnection<T>(read: (exec: Exec) => Promise<T>): Promise<T> {
  const driver = new TursoDriver({ url });
  await driver.connect();
  try {
    return await read(async (sql, args = []) => (await driver.execute(sql, args)) as Rows);
  } finally {
    await driver.disconnect();
  }
}

/** Every catalog row and every table's rows, hashed: equal means nothing moved. */
const logicalDump = () =>
  secondConnection(async (exec) => {
    const hash = createHash('sha256');
    const master = await exec('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name');
    hash.update(JSON.stringify(master));
    for (const t of master.filter((r) => r.type === 'table' && !String(r.name).startsWith('sqlite_'))) {
      hash.update(String(t.name));
      hash.update(JSON.stringify(await exec(`SELECT * FROM "${String(t.name)}" ORDER BY rowid`)));
    }
    return hash.digest('hex');
  });

const hasOrganizationColumn = (table: string) =>
  secondConnection(async (exec) =>
    (await exec('SELECT name FROM pragma_table_info(?)', [table])).some((r) => r.name === 'organization_id'));

/** The real command, its stdout parsed, and the exit it asked for. */
async function run(args: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.chdir(projectDir);
  let exitCode: number | undefined;
  try {
    try {
      await MigrateOrganizationOwnership.run(args, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const payload = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
    return { payload, exitCode: exitCode ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

describe.skipIf(!SQLD)('os migrate organization-ownership on a Turso REMOTE database (sqld)', () => {
  beforeAll(async () => {
    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'os-ceremony-remote-'));
    projectDir = join(dir, 'project');
    mkdirSync(projectDir, { recursive: true });
    const port = await freePort();
    url = `libsql://127.0.0.1:${port}?tls=0`;
    server = spawn(SQLD!, ['--http-listen-addr', `127.0.0.1:${port}`, '--db-path', join(dir, 'sqld')], { stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try {
        await secondConnection((exec) => exec('SELECT 1'));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // The environment's own boot: the composition the ceremony boots, syncing.
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: url,
      projectRoot: projectDir,
      composeHostStack: true,
      composeServedPlatform: true,
      composeAuthGatedSecurity: true,
    });
    await stack.shutdown();

    // The 17.x leftovers, through a connection of their own.
    await secondConnection(async (exec) => {
      const tables = new Set((await exec("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => String(r.name)));
      leftovers = LEFTOVER_CANDIDATES.filter((t) => tables.has(t));
      for (const t of leftovers) {
        await exec(`ALTER TABLE "${t}" ADD COLUMN "organization_id" TEXT`);
        await exec(`CREATE INDEX "idx_${t}_organization_id" ON "${t}" ("organization_id")`);
      }
      if (leftovers.includes('sys_job')) {
        await exec(`INSERT INTO "sys_job" ("id", "organization_id") VALUES ('job_v17_a', NULL), ('job_v17_b', NULL)`);
      }
      if (tables.has('sys_sharing_rule')) {
        for (let i = 1; i <= RULE_MIRRORS; i++) {
          await exec(
            `INSERT INTO "sys_sharing_rule" ("id", "name", "object_name", "managed_by", "customized", "organization_id") ` +
              `VALUES (?, ?, 'crm_deal', 'package', 0, NULL)`,
            [`rule_v17_${i}`, `share_v17_${i}`],
          );
        }
      }
    });
    expect(leftovers.length).toBeGreaterThan(0);
  }, CASE_TIMEOUT_MS);

  afterAll(() => {
    server?.kill();
    for (const key of OVERRIDING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('plans read-only, applies with blocking 0, and the drops land on the server', async () => {
    for (const t of leftovers) expect(await hasOrganizationColumn(t)).toBe(true);
    const planFile = join(dir, 'plan.json');

    const before = await logicalDump();
    const plan = await run(['--database-url', url, '--json', '--out', planFile]);
    expect(plan.payload.error, JSON.stringify(plan.payload).slice(0, 800)).toBeUndefined();
    expect(plan.exitCode).toBe(0);
    expect(await logicalDump()).toBe(before);
    expect(plan.payload.plan.database).toBe(`libsql://127.0.0.1:${new URL(url).port}`);

    const apply = await run([
      '--apply', '--backup-taken', '--plan-file', planFile, '--database-url', url, '--json', '--out', join(dir, 'apply.json'),
    ]);
    expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 800)).toBeUndefined();
    expect([apply.exitCode, apply.payload.report.complete, apply.payload.report.blocking]).toEqual([0, true, 0]);
    expect(apply.payload.report.tables.find((t: { object: string }) => t.object === 'sys_sharing_rule')).toMatchObject({
      remaining: 0,
      departures: [],
      deleted: RULE_MIRRORS,
    });

    for (const t of leftovers) expect(await hasOrganizationColumn(t)).toBe(false);
    const after = await secondConnection(async (exec) => ({
      indexes: (await exec("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%_organization_id'"))
        .map((r) => String(r.name))
        .filter((n) => leftovers.some((t) => n === `idx_${t}_organization_id`)),
      marker: (await exec(
        'SELECT applied_at IS NOT NULL AS applied, verified_at IS NOT NULL AS verified FROM sys_migration WHERE id = ?',
        [ORGANIZATION_OWNERSHIP_MIGRATION_ID],
      )).map((r) => ({ applied: Number(r.applied), verified: Number(r.verified) })),
      jobs: leftovers.includes('sys_job') ? Number((await exec('SELECT count(*) AS n FROM "sys_job"'))[0]!.n) : 2,
      rules: Number((await exec('SELECT count(*) AS n FROM "sys_sharing_rule" WHERE "organization_id" IS NULL'))[0]!.n),
    }));
    expect(after).toEqual({ indexes: [], marker: [{ applied: 1, verified: 1 }], jobs: 2, rules: 0 });
  }, CASE_TIMEOUT_MS);
});
