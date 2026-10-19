// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isExitSignal } from '../../utils/format.js';
import MigrateApply from './apply.js';
import MigrateCommentParentPair from './comment-parent-pair.js';

// Pay the first transform of the dist-resolved workspace deps the commands
// reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';
import '@objectstack/plugin-security';
import '@objectstack/plugin-audit';

/**
 * [ADR-0139 E7] The upgrade stamps the `sys_comment` rows written before the
 * parent pair existed: `os migrate comment-parent-pair`.
 *
 * ## The database
 *
 * The schema this version creates (`os migrate apply --yes` over an empty
 * file, the composition `os serve` mounts with an auth secret, so plugin-audit's
 * objects are among it), then turned back into the shape a deployment upgraded
 * from the previous version holds: the pair's index and both columns DROPPED
 * from `sys_comment`, and comment rows planted the way the previous writer left
 * them — a `thread_id` and no pair. A real SQLite file under the SQL driver the
 * commands boot, because the raw column read is the point.
 *
 * ## The cases run in order over ONE database, as an operator runs the steps
 *
 *  1. a dry run on the database no upgraded process has opened: the columns
 *     are not there yet, so it reads nothing it could stamp and says so;
 *  2. `--apply` boots plain, so the schema sync adds both columns, and stamps
 *     every row whose thread names a record, keeping each row's `updated_at`;
 *  3. a re-run stamps nothing (idempotent) and still names the thread that
 *     names no record, which stays unstamped.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const SECRET = 'os23857-integration-secret-at-least-32-chars';
const UPDATED_AT = '2026-01-02T03:04:05.000Z';

/** The rows the previous writer left, and the pair each must get. */
const PLANTED: Array<{ id: string; thread_id: string; pair: { object_name: string | null; record_id: string | null } }> = [
  { id: 'cmt_1', thread_id: 'os23857_thing:t1', pair: { object_name: 'os23857_thing', record_id: 't1' } },
  { id: 'cmt_2', thread_id: 'os23857_thing:t:2', pair: { object_name: 'os23857_thing', record_id: 't:2' } },
  { id: 'cmt_3', thread_id: 'sys_user:u1', pair: { object_name: 'sys_user', record_id: 'u1' } },
  { id: 'cmt_x', thread_id: 'watercooler', pair: { object_name: null, record_id: null } },
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

const columnsOf = (table: string): string[] =>
  withDb((db) => (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map((c) => c.name));

const pairs = (): Record<string, { object_name: string | null; record_id: string | null }> =>
  withDb((db) => {
    const out: Record<string, { object_name: string | null; record_id: string | null }> = {};
    const rows = db.prepare("SELECT id, object_name, record_id FROM sys_comment WHERE id LIKE 'cmt_%' ORDER BY id").all() as
      Array<{ id: string; object_name: string | null; record_id: string | null }>;
    for (const r of rows) out[r.id] = { object_name: r.object_name, record_id: r.record_id };
    return out;
  });

const updatedAts = (): string[] =>
  withDb((db) => (db.prepare("SELECT updated_at FROM sys_comment WHERE id LIKE 'cmt_%' ORDER BY id").all() as
    Array<{ updated_at: unknown }>).map((r) => String(r.updated_at)));

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-23857-comment-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os23857comment', name: 'requires auth', version: '0.0.0', type: 'app' },",
      "  requires: ['auth'],",
      "  objects: [{ name: 'os23857_thing', fields: { title: { type: 'text' } } }],",
      '};',
      '',
    ].join('\n'),
  );
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  // `os serve` composes the auth family, and with it plugin-audit, only when an
  // auth secret resolves; the deployment this pins serves with one.
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

  // The previous version's shape: no pair, and its rows.
  withDb((db) => {
    const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sys_comment'").all() as
      Array<{ name: string; sql: string | null }>;
    for (const index of indexes) {
      if (index.sql && /object_name|record_id/.test(index.sql)) db.exec(`DROP INDEX "${index.name}"`);
    }
    db.exec('ALTER TABLE sys_comment DROP COLUMN object_name');
    db.exec('ALTER TABLE sys_comment DROP COLUMN record_id');
    for (const row of PLANTED) {
      plant(db, 'sys_comment', {
        id: row.id, thread_id: row.thread_id, body: row.id, author_id: 'u1',
        created_at: UPDATED_AT, updated_at: UPDATED_AT,
      });
    }
  }, false);
  expect(columnsOf('sys_comment'), 'fixture: the previous version has no pair').not.toContain('object_name');
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

describe('os migrate comment-parent-pair stamps the comment rows the previous version left (ADR-0139 E7)', () => {
  const db = () => `file:${dbFile}`;
  const run = (argv: string[]) => runJson(invoke(MigrateCommentParentPair), ['--database-url', db(), ...argv, '--json']);

  it('1. a dry run on the not-yet-synced database writes nothing, adds no column, and does not report a clean table', async () => {
    const { payload, exitCode } = await run([]);
    expect(columnsOf('sys_comment')).not.toContain('object_name');
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({ apply: false, report: { stamped: 0, failures: 1 } });
  }, CASE_TIMEOUT_MS);

  it('2. --apply adds the pair and stamps every row whose thread names a record, keeping updated_at', async () => {
    const { payload, exitCode } = await run(['--apply', '--yes']);
    expect(exitCode).toBe(0);
    expect(columnsOf('sys_comment')).toEqual(expect.arrayContaining(['object_name', 'record_id']));
    expect(payload.report).toEqual({ apply: true, scanned: PLANTED.length, stamped: PLANTED.length - 1, unparented: 1, failures: 0 });
    expect(pairs()).toEqual(Object.fromEntries(PLANTED.map((r) => [r.id, r.pair])));
    expect(new Set(updatedAts())).toEqual(new Set([UPDATED_AT]));
  }, CASE_TIMEOUT_MS);

  it('3. a re-run stamps nothing and still names the thread that names no record', async () => {
    const before = pairs();
    const { payload, exitCode } = await run(['--apply', '--yes']);
    expect(exitCode).toBe(0);
    expect(payload.report).toEqual({ apply: true, scanned: 1, stamped: 0, unparented: 1, failures: 0 });
    expect(pairs()).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('4. a dry run after the apply reports the same clean table', async () => {
    const { payload, exitCode } = await run([]);
    expect(exitCode).toBe(0);
    expect(payload.report).toEqual({ apply: false, scanned: 1, stamped: 0, unparented: 1, failures: 0 });
  }, CASE_TIMEOUT_MS);
});
