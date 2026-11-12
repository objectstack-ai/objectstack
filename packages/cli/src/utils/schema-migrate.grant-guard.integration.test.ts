// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32164, MF6 review must-fix 1] The one-shot CLI boot and
 * `sys_user_permission_set`'s package-less guard,
 * `uniq_sys_user_permission_set_packageless`.
 *
 * Every boot through `bootSchemaStack` declares `runPlatformMigrations: false`,
 * so the boot repairs never arm here. The guard does not ride that gate: it
 * follows the table's DDL (metadata-protocol's
 * `createUserPermissionSetGuardAtSchemaSync`, run on `objectql:schema-synced`).
 * Three faces, over a real SQLite file and the composition a served platform
 * provisions (plugin-security included):
 *
 *  - a WRITE boot (the `--apply` modes of the data commands, which boot without
 *    deferring) creates the table at its schema sync, and the guard with it;
 *  - a READ-ONLY boot (`os migrate plan`, every dry-run mode: deferred +
 *    `readOnlyProbe`) over a table that lacks the guard builds nothing, so the
 *    database is left as it was;
 *  - `os migrate apply`'s boot holds the DDL back, so the guard is absent until
 *    the operator confirms; its flush creates the tables and then builds the
 *    guard (`DeferSchemaDdlPlugin.announceSchemaSynced`).
 *
 * Ablations (recorded in the PR): with the flush's announcement removed, the
 * apply pin goes red; with the ensurer's held-back check removed, the read-only
 * pin goes red; with the subscription back inside the `runPlatformMigrations`
 * gate, all three go red (the write and apply pins at their guard, the read-only
 * pin at its setup, which drops the guard the write boot no longer built).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { bootSchemaStack } from './schema-migrate.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: `bootSchemaStack` reaches them through dynamic `import()`s,
// which vitest clocks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-audit';
import '@objectstack/service-datasource';
import '@objectstack/driver-turso';
import '@objectstack/plugin-security';
import '@objectstack/rest';

const CASE_TIMEOUT_MS = 180_000;
const GRANTS = 'sys_user_permission_set';
const GUARD = 'uniq_sys_user_permission_set_packageless';

const artifact = {
  manifest: { id: 'com.example.m32164', name: 'm32164', version: '1.0.0', type: 'app' },
  packages: [{
    manifest: {
      id: 'com.example.m32164a', name: 'm32164a', version: '1.0.0', type: 'app', namespace: 'm32164a',
      objects: [{ name: 'm32164a_task', label: 'Task', fields: { title: { name: 'title', label: 'Title', type: 'text' } } }],
    },
  }],
};

let dir: string;
const savedCwd = process.cwd();
const ENV_KEYS = ['OS_ARTIFACT_PATH', 'OS_DATABASE_URL', 'DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ENVIRONMENT_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};

/** Run `fn` against `file` on a connection of our own, after every boot has shut down. */
async function onOwnConnection<T>(file: string, fn: (knex: any) => Promise<T>): Promise<T> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  try {
    return await fn((driver as any).knex);
  } finally {
    await driver.disconnect();
  }
}

/** `{ table, guard }`: whether the grant table exists, and whether the guard stands on it. */
async function grantState(file: string): Promise<{ table: boolean; guard: boolean }> {
  return onOwnConnection(file, async (knex) => {
    const rows = (await knex.raw(
      "SELECT type, name FROM sqlite_master WHERE (type = 'table' AND name = ?) OR (type = 'index' AND name = ?)",
      [GRANTS, GUARD],
    )) as Array<{ type: string; name: string }>;
    return { table: rows.some((r) => r.type === 'table'), guard: rows.some((r) => r.type === 'index') };
  });
}

type BootOptions = Parameters<typeof bootSchemaStack>[0];

/** A one-shot boot over `file` with the served composition, `cwd` at the project. */
async function oneShot(file: string, extra: Partial<BootOptions>) {
  process.chdir(dir);
  try {
    return await bootSchemaStack({
      jsonOutput: true, databaseUrl: `file:${file}`, projectRoot: dir,
      composeHostStack: true, composeServedPlatform: true, composeAuthGatedSecurity: true,
      ...extra,
    } as BootOptions);
  } finally {
    process.chdir(savedCwd);
  }
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.OS_AUTH_SECRET = 'm32164'.repeat(11);
  dir = mkdtempSync(join(tmpdir(), 'os-32164-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(artifact));
});

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('[#32164] the package-less grant guard on a one-shot CLI boot (runPlatformMigrations: false)', () => {
  it('a write boot (not deferred) creates the grant table and builds the guard at its schema sync', async () => {
    const file = join(dir, 'write.db');
    const stack = await oneShot(file, {});
    await stack.shutdown();

    expect(await grantState(file)).toEqual({ table: true, guard: true });
  }, CASE_TIMEOUT_MS);

  it('a read-only boot (deferred + readOnlyProbe) over a table without the guard builds nothing: the database is left as it was', async () => {
    const file = join(dir, 'read-only.db');
    await (await oneShot(file, {})).shutdown();
    await onOwnConnection(file, (knex) => knex.raw(`DROP INDEX ${GUARD}`));
    expect(await grantState(file)).toEqual({ table: true, guard: false });

    const stack = await oneShot(file, { deferSchemaDdl: true, readOnlyProbe: true });
    await stack.shutdown();

    expect(await grantState(file)).toEqual({ table: true, guard: false });
  }, CASE_TIMEOUT_MS);

  it('os migrate apply on a fresh database: nothing before the confirmation, then the flush creates the table and builds the guard', async () => {
    const file = join(dir, 'apply.db');
    const stack = await oneShot(file, { deferSchemaDdl: true });
    try {
      expect(stack.pendingSchemaWork.some((w) => w.table === GRANTS && w.kind === 'create_table')).toBe(true);
      expect(await grantState(file)).toEqual({ table: false, guard: false });

      await stack.flushSchemaDdl();

      expect(await grantState(file)).toEqual({ table: true, guard: true });
    } finally {
      await stack.shutdown();
    }
  }, CASE_TIMEOUT_MS);
});
