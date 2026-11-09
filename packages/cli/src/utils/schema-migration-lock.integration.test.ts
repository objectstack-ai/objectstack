// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two `os migrate apply` runs against ONE Postgres database serialize on the
 * schema-migration lock (`acquireSchemaMigrationLock`, taken by
 * `bootSchemaStack` on an applying boot): one waits, both succeed, the schema
 * is applied once and the second finds nothing to do.
 *
 * ## What this inverts, measured before the lock
 *
 * Three concurrent applies against one fresh Postgres database each reported
 * creating tables — 82, 86 and 37 for the 86 the database ended with — and the
 * third applied drift on tables the others were still creating. Every run
 * exited 0, so no exit status carried the collision.
 *
 * ## Why the contention is staged, not raced
 *
 * Two migrators started together contend only if their boots overlap, which
 * is timing. So this file takes the lock FIRST, on a session of its own, waits
 * until Postgres reports both migrators queued behind it (`pg_locks`, an
 * advisory lock not yet granted), and only then lets go. Both then wait by
 * construction, and the one that gets the lock second must read the database
 * the first one left. The third run is the control: uncontended, it prints
 * no wait line and finds the schema in sync.
 *
 * ## The driver axis
 *
 * Postgres only, and only when `OS_TEST_POSTGRES_URL` is set, in a database
 * named from this file's workspace-relative path (the `os_lv_` derivation every
 * live suite shares). Without the URL the cell is a NAMED skip, and a FAILURE
 * under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`. ⚠️ A named skip is a report, not
 * coverage: no CI leg supplies the URL to this package today. SQLite takes no
 * lock, which the unit file pins.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { SCHEMA_MIGRATION_PG_LOCK_KEY } from './schema-migration-lock.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../bin/run-dev.js');

/** Env that would point the child's boot somewhere other than this file's database. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

/**
 * This process's environment for a child, minus the families
 * `test/helpers/serve-process.ts` `childEnv()` strips (its header says why).
 */
function childEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    if ((OVERRIDING_ENV as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  // The fixed key `serve-process.ts` hands its children, so no boot mints and
  // persists a crypto key into this runner's home directory.
  return { ...env, OS_SECRET_KEY: '0e2e'.repeat(16), NO_COLOR: '1' };
}

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const EXPECT_LIVE_DIALECTS = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';
/** Three CLI boots, two of them queued behind the staged lock. */
const CELL_TIMEOUT_MS = 240_000;
const LIVE_DB_PREFIX = 'os_lv_';

/**
 * This file's live database: `os_lv_<slug>_<12 hex of sha256(path)>`, the
 * derivation `packages/drivers/driver-sql/src/live-dialect-matrix.testkit.ts`
 * uses. A copy rather than an import: that testkit is not on driver-sql's
 * public surface.
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

function liveDatabase(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error('live-dialect isolation: vitest reported no testPath, so this cell cannot be given a database of its own.');
  }
  return liveDatabaseNameFor(repoRelativeTestPath(testPath));
}

const LIVE_DATABASE = liveDatabase();

function liveUrl(): string {
  const url = new URL(PG_URL!);
  url.pathname = `/${LIVE_DATABASE}`;
  return url.toString();
}

async function adminExecute(sql: string): Promise<void> {
  const admin = new SqlDriver({ client: 'pg', connection: PG_URL });
  try {
    await admin.execute(sql);
  } finally {
    await admin.disconnect();
  }
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function migrate(cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, 'migrate', 'apply', '--yes', '--json', '--database-url', liveUrl()],
      { cwd, maxBuffer: 64 * 1024 * 1024, env: childEnv() },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

interface ApplyPayload {
  message?: string;
  created?: unknown[];
}

const WAIT_LINE = /^.*Another schema migration is running on .*$/gm;
const CONFIG = [
  'export default {',
  "  name: 'migration_lock_31598',",
  "  label: 'Migration lock',",
  "  objects: [{ name: 'ml_ticket', label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } }],",
  '};',
  '',
].join('\n');

if (!PG_URL) {
  describe('os migrate apply serializes on the schema-migration lock (live postgres)', () => {
    it.skipIf(!EXPECT_LIVE_DIALECTS)('is provisioned — set OS_TEST_POSTGRES_URL to run this cell', () => {
      expect.fail(
        'OS_TEST_POSTGRES_URL is unset while OS_EXPECT_LIVE_DIALECT_MATRIX=1: this runner declared it provisions a live '
          + 'server, so the concurrent-migration cell must not be skipped.',
      );
    });
  });
} else {
  describe('os migrate apply serializes on the schema-migration lock (live postgres)', () => {
    let dir: string;
    let first: Run;
    let second: Run;
    let control: Run;
    let queuedBehindHolder = 0;
    let tables: string[] = [];

    beforeAll(async () => {
      await adminExecute(`DROP DATABASE IF EXISTS "${LIVE_DATABASE}" WITH (FORCE)`);
      await adminExecute(`CREATE DATABASE "${LIVE_DATABASE}"`);
      dir = mkdtempSync(join(tmpdir(), 'os-migration-lock-'));
      writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);

      // The holder: the lock, on a session of this file's own.
      const holder = new SqlDriver({ client: 'pg', connection: liveUrl() });
      const knex = holder.getKnex();
      const session = await knex.client.acquireRawConnection();
      try {
        await knex.raw('select pg_advisory_lock(?::bigint)', [SCHEMA_MIGRATION_PG_LOCK_KEY]).connection(session);
        const runs = [migrate(dir), migrate(dir)];
        // Until both migrators are queued behind the holder — never a sleep.
        const deadline = Date.now() + CELL_TIMEOUT_MS / 2;
        while (Date.now() < deadline) {
          const r = await knex.raw(
            "select count(*)::int as n from pg_locks l join pg_database d on d.oid = l.database "
              + "where l.locktype = 'advisory' and not l.granted and d.datname = ?",
            [LIVE_DATABASE],
          ).connection(session) as { rows: Array<{ n: number }> };
          queuedBehindHolder = r.rows[0].n;
          if (queuedBehindHolder >= 2) break;
          await new Promise((r2) => setTimeout(r2, 250));
        }
        await knex.raw('select pg_advisory_unlock(?::bigint)', [SCHEMA_MIGRATION_PG_LOCK_KEY]).connection(session);
        [first, second] = await Promise.all(runs);
      } finally {
        await knex.client.destroyRawConnection(session);
        await holder.disconnect();
      }
      control = await migrate(dir);

      const probe = new SqlDriver({ client: 'pg', connection: liveUrl() });
      try {
        const r = await probe.getKnex().raw(
          "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
        ) as { rows: Array<{ table_name: string }> };
        tables = r.rows.map((row) => row.table_name);
      } finally {
        await probe.disconnect();
      }
    }, CELL_TIMEOUT_MS);

    afterAll(async () => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      await adminExecute(`DROP DATABASE IF EXISTS "${LIVE_DATABASE}" WITH (FORCE)`);
    }, CELL_TIMEOUT_MS);

    it('both migrators queued behind the held lock — the contention is real, not a race that happened to miss', () => {
      expect(queuedBehindHolder).toBe(2);
    });

    it('both succeed, and each said ONCE that it waited — on stderr, stdout still one JSON document', () => {
      for (const run of [first, second]) {
        expect(run.code).toBe(0);
        expect(run.stderr.match(WAIT_LINE)).toHaveLength(1);
        expect(() => JSON.parse(run.stdout)).not.toThrow();
      }
    });

    it('⭐ the schema is applied ONCE: one migrator creates it, the other finds nothing to do', () => {
      const payloads = [first, second].map((run) => JSON.parse(run.stdout) as ApplyPayload);
      const creators = payloads.filter((p) => (p.created?.length ?? 0) > 0);
      expect(creators).toHaveLength(1);
      const other = payloads.find((p) => p !== creators[0])!;
      expect(other.created ?? []).toEqual([]);
      expect(other.message).toBe('in_sync');
      expect(tables).toContain('ml_ticket');
    });

    it('control — an uncontended migrator prints no wait line and finds the schema in sync', () => {
      expect(control.code).toBe(0);
      expect(control.stderr.match(WAIT_LINE)).toBeNull();
      expect((JSON.parse(control.stdout) as ApplyPayload).message).toBe('in_sync');
    });
  });
}
