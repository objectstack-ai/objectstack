// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isExitSignal } from '../../utils/format.js';
import MigrateApply from './apply.js';
import MigrateListPreferences from './list-preferences.js';

// Pay the first transform of the dist-resolved workspace deps the commands
// reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';
import '@objectstack/plugin-security';
import '@objectstack/plugin-audit';

/**
 * `os migrate list-preferences` against a real SQLite database: the step that
 * removes the `sys_user_preference` rows keyed `ui.list.<object>`, which no
 * Console reads any more (objectstack#35955).
 *
 * ## The database
 *
 * The schema this version creates (`os migrate apply --yes` over an empty
 * file, the composition `os serve` mounts with an auth secret, so the auth
 * family's `sys_user_preference` is among it), with the rows an earlier Console left: three `ui.list.*` rows for two
 * users, and two CONTROLS that are never touched — another family's row
 * (`ui.record.account`) and a key that only looks alike (`ui.lists`).
 *
 * ## The cases run in order over ONE database, as an operator runs the steps
 *
 *  1. a dry run reports the rows and deletes nothing;
 *  2. `--apply` without `--export` is refused, and so is an export path that
 *     already exists — both with nothing deleted;
 *  3. `--apply --export` writes the export (owner-only, every row as stored),
 *     deletes exactly the `ui.list.*` rows, and keeps the controls;
 *  4. a re-run finds nothing and writes no export.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const SECRET = 'os35955-integration-secret-at-least-32-chars';

const RETIRED = [
  { id: 'pref_l1', user_id: 'u1', key: 'ui.list.account', value: '{"viewOrder":["account.all"]}' },
  { id: 'pref_l2', user_id: 'u1', key: 'ui.list.contact', value: '{"perView":{"contact.all":{"rowHeight":"compact"}}}' },
  { id: 'pref_l3', user_id: 'u2', key: 'ui.list.account', value: '{"perView":{"account.all":{"sort":[{"field":"name","order":"desc"}]}}}' },
];
const CONTROLS = [
  { id: 'pref_r1', user_id: 'u1', key: 'ui.record.account', value: '{"showEmptyFields":true}' },
  { id: 'pref_x1', user_id: 'u2', key: 'ui.lists', value: '{}' },
];

type Invoke = (argv: string[]) => Promise<unknown>;
const invoke = (command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }): Invoke =>
  (argv) => command.run(argv, { root: CLI_ROOT });

/** Env that would point a command's boot somewhere other than the fixture. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH',
] as const;

/** Run one command and capture its JSON document and exit status. */
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

function withDb<T>(fn: (db: Database.Database) => T, readonly = true): T {
  const db = new Database(dbFile, { readonly });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Insert a row, filling every other NOT NULL column without a default with a placeholder of its type. */
function plant(db: Database.Database, table: string, values: Record<string, unknown>): void {
  const columns = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<
    { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }
  >;
  const row: Record<string, unknown> = { ...values };
  for (const c of columns) {
    if (c.name in row || !c.notnull || c.dflt_value !== null) continue;
    row[c.name] = /INT|BOOL|REAL|NUM/i.test(c.type) ? 0 : `${c.name}-placeholder`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((n) => row[n] as never));
}

const storedIds = (): string[] =>
  withDb((db) => (db.prepare("SELECT id FROM sys_user_preference WHERE id LIKE 'pref_%' ORDER BY id").all() as
    Array<{ id: string }>).map((r) => r.id));

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-35955-list-prefs-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os35955listprefs', name: 'list prefs', version: '0.0.0', type: 'app' },",
      "  requires: ['auth'],",
      "  objects: [{ name: 'os35955_thing', fields: { title: { type: 'text' } } }],",
      '};',
      '',
    ].join('\n'),
  );
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  // `os serve` composes the auth family, whose objects hold the preference
  // rows, only when an auth secret resolves.
  process.env.OS_AUTH_SECRET = SECRET;
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  dbFile = join(dir, 'upgraded.db');
  process.chdir(dir);
  try {
    const created = await runJson(invoke(MigrateApply), ['--database-url', `file:${dbFile}`, '--yes', '--json']);
    expect(created.exitCode, JSON.stringify(created.payload).slice(0, 400)).toBe(0);
  } finally {
    process.chdir(savedCwd);
  }
  withDb((db) => {
    for (const row of [...RETIRED, ...CONTROLS]) plant(db, 'sys_user_preference', row);
  }, false);
  expect(storedIds()).toEqual([...RETIRED, ...CONTROLS].map((r) => r.id).sort());
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

describe('os migrate list-preferences removes the ui.list.* preference rows (objectstack#35955)', () => {
  const db = () => `file:${dbFile}`;
  const run = (argv: string[]) => runJson(invoke(MigrateListPreferences), ['--database-url', db(), ...argv, '--json']);
  const all = [...RETIRED, ...CONTROLS].map((r) => r.id).sort();

  it('1. a dry run reports the rows, users and objects, and deletes nothing', async () => {
    const { payload, exitCode } = await run([]);
    expect(exitCode).toBe(0);
    expect(payload).toMatchObject({ apply: false, rows: 3, users: 2, objects: ['account', 'contact'], deleted: 0, remaining: 3 });
    expect(storedIds()).toEqual(all);
  }, CASE_TIMEOUT_MS);

  it('2. --apply is refused without --export, and over an existing export, with nothing deleted', async () => {
    const bare = await run(['--apply', '--yes']);
    expect(bare.exitCode).toBe(1);
    expect(bare.payload.error).toBe('export_required');

    const taken = join(dir, 'taken.json');
    writeFileSync(taken, 'keep me\n');
    const over = await run(['--apply', '--yes', '--export', taken]);
    expect(over.exitCode).toBe(1);
    expect(over.payload.error).toBe('export_exists');
    expect(readFileSync(taken, 'utf8')).toBe('keep me\n');
    expect(storedIds()).toEqual(all);
  }, CASE_TIMEOUT_MS);

  it('3. --apply --export writes every retired row to an owner-only export, then deletes exactly those rows', async () => {
    const exportPath = join(dir, 'list-preferences-export.json');
    const { payload, exitCode } = await run(['--apply', '--yes', '--export', exportPath]);
    expect(exitCode, JSON.stringify(payload).slice(0, 400)).toBe(0);
    expect(payload).toMatchObject({ apply: true, rows: 3, users: 2, deleted: 3, remaining: 0, failures: [] });

    const doc = JSON.parse(readFileSync(exportPath, 'utf8'));
    expect(doc.keyPrefix).toBe('ui.list.');
    expect(doc.rows.map((r: { id: string }) => r.id).sort()).toEqual(RETIRED.map((r) => r.id));
    expect(doc.rows.find((r: { id: string }) => r.id === 'pref_l3')).toMatchObject({ user_id: 'u2', key: 'ui.list.account' });
    if (process.platform !== 'win32') expect(statSync(exportPath).mode & 0o077).toBe(0);

    expect(storedIds()).toEqual(CONTROLS.map((r) => r.id).sort());
  }, CASE_TIMEOUT_MS);

  it('4. a re-run finds nothing, writes no export, and keeps the controls', async () => {
    const exportPath = join(dir, 'second-export.json');
    const { payload, exitCode } = await run(['--apply', '--yes', '--export', exportPath]);
    expect(exitCode).toBe(0);
    expect(payload).toMatchObject({ rows: 0, deleted: 0, remaining: 0 });
    expect(existsSync(exportPath)).toBe(false);
    expect(storedIds()).toEqual(CONTROLS.map((r) => r.id).sort());
  }, CASE_TIMEOUT_MS);
});
