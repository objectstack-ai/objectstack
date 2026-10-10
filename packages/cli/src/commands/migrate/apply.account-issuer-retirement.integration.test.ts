// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysAccount } from '@objectstack/platform-objects/identity';
import { isExitSignal } from '../../utils/format.js';
import MigratePlan from './plan.js';
import MigrateApply from './apply.js';
import MigrateAccountIssuer from './account-issuer.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps the
// commands reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';
import '@objectstack/plugin-security';
import '@objectstack/plugin-audit';

/**
 * [#22506] The `sys_account.issuer` retirement, end to end on the shape that
 * looped: an app declaring `requires: ['auth']`, over a database whose
 * `sys_account` still carries the retired `issuer` column and its unique index.
 *
 * ## The loop this closes
 *
 * `os migrate plan` / `apply` composed the stack and stopped there: nothing of
 * what `os serve` mounts around it, so `sys_account` (plugin-auth's object,
 * behind `serve`'s auth gate) was never a registered object, the retired column
 * was never a destructive drop, and `apply --allow-destructive` dropped nothing
 * — while the boot's drift line and `os migrate account-issuer` kept
 * prescribing exactly that command. Measured on a 17.4.0-created SQLite
 * database (objectstack-ai/hotclm#82) and reproduced on #22506.
 *
 * ## The fixture is independent of the code under test
 *
 * `sys_account` is created by the driver from the object definition that ships
 * today, then given the legacy shape by hand: the `issuer` column and the
 * `uniq_sys_account_issuer_account_id` index. No `os migrate` composition is
 * involved in building it. One account row carries an issuer, so the
 * retirement pre-flight has something to read.
 *
 * The four pins run in order over ONE database, as an operator runs the steps:
 * the plan declares `sys_account` and names both drops; apply performs them;
 * the pre-flight reaches zero; and a re-plan is in sync — in particular no
 * `sys_activity` `create_table` that no apply can clear (the rotation-declared
 * object the composed audit plugin registers, previewed from the rotator's
 * facts since this card).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const SECRET = 'os22506-integration-secret-at-least-32-chars';
const LEGACY_INDEX = 'uniq_sys_account_issuer_account_id';

type Invoke = (argv: string[]) => Promise<unknown>;
const invoke = (command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }): Invoke =>
  (argv) => command.run(argv, { root: CLI_ROOT });

/** Env that would point a command's boot somewhere other than the fixture. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH',
] as const;

/**
 * Run one command and capture its JSON document (the one-shot family's
 * shape: stdout spied before the boot, `process.exit` and oclif's exit signal
 * trapped, `process.exitCode` restored).
 */
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

let dir: string;
let dbFile: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

function accountShape(): { columns: string[]; indexes: string[] } {
  const db = new Database(dbFile, { readonly: true });
  try {
    return {
      columns: (db.prepare("PRAGMA table_info('sys_account')").all() as Array<{ name: string }>).map((c) => c.name),
      indexes: (db.prepare("PRAGMA index_list('sys_account')").all() as Array<{ name: string }>).map((i) => i.name),
    };
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-22506-issuer-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os22506issuer', name: 'requires auth', version: '0.0.0', type: 'app' },",
      "  requires: ['auth'],",
      "  objects: [{ name: 'os22506_issuer_thing', fields: { title: { type: 'text' } } }],",
      '};',
      '',
    ].join('\n'),
  );
  // Config-only on purpose: the hotclm shape has no compiled artifact here.
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  // `os serve` composes the auth family only when an auth secret resolves; the
  // deployment this pins serves with one.
  process.env.OS_AUTH_SECRET = SECRET;
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  dbFile = join(dir, 'legacy.db');

  // The legacy `sys_account`, built by the driver from today's definition.
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    await driver.initObjects([SysAccount as any]);
  } finally {
    await driver.disconnect();
  }
  const db = new Database(dbFile);
  try {
    db.exec('ALTER TABLE sys_account ADD COLUMN issuer TEXT');
    db.exec(`CREATE UNIQUE INDEX ${LEGACY_INDEX} ON sys_account (issuer, account_id)`);
    db.prepare(
      'INSERT INTO sys_account (id, provider_id, account_id, user_id, issuer) VALUES (?, ?, ?, ?, ?)',
    ).run('acc_os22506', 'credential', 'usr_os22506', 'usr_os22506', 'local:credential');
  } finally {
    db.close();
  }
  expect(accountShape().columns, 'fixture: the legacy column').toContain('issuer');
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); });

describe('the sys_account.issuer retirement on an app with requires: [\'auth\'] (#22506)', () => {
  const db = () => `file:${dbFile}`;

  it('plan declares sys_account and names the column and its index as destructive drops', async () => {
    const { payload, exitCode } = await runJson(invoke(MigratePlan), ['--database-url', db(), '--json']);
    expect(exitCode).toBe(0);
    const drops = (payload.changes ?? [])
      .filter((c: any) => c.table === 'sys_account' && c.category === 'destructive')
      .map((c: any) => `${c.op?.type}:${c.op?.indexName ?? c.column}`)
      .sort();
    expect(drops).toEqual([`drop_column:issuer`, `drop_index:${LEGACY_INDEX}`]);
    // Declared, not swept: the table is no longer "what exists that nothing declares".
    expect(JSON.stringify(payload.unmanagedTables?.tables ?? [])).not.toContain('sys_account');
    expect((payload.composition?.notes ?? []).join(' ')).toContain('Composed the auth family');
  }, CASE_TIMEOUT_MS);

  it('apply --allow-destructive drops the column and its unique index', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateApply), [
      '--database-url', db(), '--allow-destructive', '--yes', '--json',
    ]);
    expect(exitCode).toBe(0);
    const applied = (payload.applied ?? [])
      .filter((c: any) => c.table === 'sys_account')
      .map((c: any) => `${c.op?.type}:${c.op?.indexName ?? c.column}`)
      .sort();
    expect(applied).toEqual([`drop_column:issuer`, `drop_index:${LEGACY_INDEX}`]);
    const shape = accountShape();
    expect(shape.columns).not.toContain('issuer');
    expect(shape.indexes).not.toContain(LEGACY_INDEX);
  }, CASE_TIMEOUT_MS);

  it('account-issuer reaches zero', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateAccountIssuer), ['--database-url', db(), '--json']);
    expect(exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.collisions).toEqual([]);
    expect(payload.scanned).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('a re-plan after apply is in sync — no drift and nothing pending, sys_activity included', async () => {
    const { payload, exitCode } = await runJson(invoke(MigratePlan), ['--database-url', db(), '--json']);
    expect(exitCode).toBe(0);
    expect(payload.changes).toEqual([]);
    expect(payload.pending).toEqual([]);
    expect(payload.composition?.coverage?.unexaminedObjects).toBe(0);
  }, CASE_TIMEOUT_MS);
});
