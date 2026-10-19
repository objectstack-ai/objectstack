// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23648] The `os migrate` family on a SQLite database served by
 * `SqliteWasmDriver` (`wasm-sqlite://`, `*.wasm.db`, and the dev boot's
 * step-down from better-sqlite3), each command through its own real boot.
 *
 * Measured before the fix, on this fixture: the schema boot's SQL-driver
 * lookup (`SQL_DRIVER_SERVICES`) did not list the key that driver is published
 * under, `driver.com.objectstack.driver.sqlite-wasm`, so `stack.driver` was
 * `null` and
 *  - `os migrate apply` answered `{"error":"no_sql_driver"}`, exit 0, and
 *    created no table;
 *  - `os migrate plan` answered `{"error":"no_sql_driver","changes":[]}`, exit 0;
 *  - `os migrate organization-ownership` refused both arms with
 *    `driver-unsupported` ("no SQL driver with a raw-SQL seam is active"),
 *    exit 1, on a SQLite database its own text says it supports.
 *
 * Once the driver is found, `os migrate plan` reaches its unmanaged-table
 * sweep, which read `config.client` as a string only. This driver's client is
 * a knex client class, so the section came back `unreadable`. The sweep now
 * resolves the dialect through `dialectOfDriver`, `dialectName` first.
 *
 * The fixture is a project with a compiled artifact that declares no object,
 * and an auth secret, so the boot composes the platform floor the ceremony's
 * apply reads. The database is created by `os migrate apply` itself, and every
 * case after it reads the same file.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from '../../utils/format.js';
import MigrateApply from './apply.js';
import MigratePlan from './plan.js';
import { OrganizationOwnershipCeremony as MigrateOrganizationOwnership } from './organization-ownership.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps the
// commands reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/driver-sqlite-wasm';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;

/** Every variable that would point the boot elsewhere or change what it composes. */
const ENV_KEYS = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_TELEMETRY_DB',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH', 'NODE_ENV',
] as const;

type Invoke = (argv: string[]) => Promise<unknown>;
const invoke = (command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }): Invoke =>
  (argv) => command.run(argv, { root: CLI_ROOT });

/** Run a command with stdout captured, its exits trapped, and its JSON document parsed. */
async function runJson(command: Invoke, argv: string[]): Promise<{ payload: any; exitCode: number }> {
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
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  let thrownExit: number | undefined;
  try {
    try {
      await command(argv);
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try {
      payload = JSON.parse(out);
    } catch {
      payload = { unparsed: out.slice(-400) };
    }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const savedEnv: Record<string, string | undefined> = {};
let savedCwd: string;
let dir: string;
let file: string;
let url: string;
let seeded: { payload: any; exitCode: number };

/** The tables in the database file, read past the driver. */
function tablesOnDisk(): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((r) => r.name);
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  savedCwd = process.cwd();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-23648-wasm-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify({
    manifest: { id: 'com.example.os23648wasm', name: 'wasm', version: '1.0.0', type: 'app' },
  }));
  process.env.NODE_ENV = 'production';
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  process.env.OS_AUTH_SECRET = 'os23648-fixture-secret-at-least-32-characters-long';
  process.chdir(dir);
  file = join(dir, 'app.db');
  url = `wasm-sqlite://${file}`;
  seeded = await runJson(invoke(MigrateApply), ['--database-url', url, '--yes', '--json']);
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('os migrate on a wasm-sqlite:// database', () => {
  it('apply finds the SQL driver and creates the schema in the file', () => {
    expect(seeded.exitCode).toBe(0);
    expect(seeded.payload.error).toBeUndefined();
    expect(seeded.payload.database).toBe(file);
    expect(seeded.payload.created.map((w: { table: string }) => w.table)).toContain('sys_migration');
    expect(tablesOnDisk()).toContain('sys_migration');
  });

  it('plan finds the SQL driver, and its unmanaged-table sweep reads the catalog', async () => {
    const { payload, exitCode } = await runJson(invoke(MigratePlan), ['--database-url', url, '--json']);
    expect(exitCode).toBe(0);
    expect(payload.error).toBeUndefined();
    expect(payload.database).toBe(file);
    expect(payload.pending).toEqual([]);
    expect(payload.unmanagedTables).toMatchObject({ status: 'read' });
    expect(payload.unmanagedTables.physicalTables).toBe(tablesOnDisk().length);
  }, CASE_TIMEOUT_MS);

  it('organization-ownership plans the database and applies the reviewed plan', async () => {
    const planFile = join(dir, 'ownership-plan.json');
    const plan = await runJson(invoke(MigrateOrganizationOwnership), ['--database-url', url, '--out', planFile, '--json']);
    expect(plan.exitCode).toBe(0);
    expect(plan.payload.error).toBeUndefined();
    expect(plan.payload.plan).toMatchObject({ kind: 'organization-ownership-plan', database: file });
    expect(existsSync(planFile)).toBe(true);

    const apply = await runJson(invoke(MigrateOrganizationOwnership), [
      '--apply', '--backup-taken', '--plan-file', planFile, '--database-url', url, '--out', join(dir, 'ownership-apply.json'), '--json',
    ]);
    expect(apply.exitCode).toBe(0);
    expect(apply.payload.error).toBeUndefined();
    expect(apply.payload.report).toMatchObject({ kind: 'organization-ownership-apply', database: file });
    const steps = apply.payload.report.steps as Array<{ step: string; status: string }>;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.filter((s) => s.status !== 'done')).toEqual([]);

    const db = new Database(file, { readonly: true });
    try {
      expect(db.prepare('SELECT id FROM sys_migration').all()).toContainEqual({ id: 'adr-0131-organization-ownership' });
    } finally {
      db.close();
    }
  }, CASE_TIMEOUT_MS);
});
