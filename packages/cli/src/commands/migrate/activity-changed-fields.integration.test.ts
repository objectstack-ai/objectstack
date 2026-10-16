// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isExitSignal } from '../../utils/format.js';
import MigrateApply from './apply.js';
import MigrateActivityChangedFields from './activity-changed-fields.js';

// Pay the first transform of the dist-resolved workspace deps the commands
// reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';
import '@objectstack/plugin-security';
import '@objectstack/plugin-audit';

/**
 * [ADR-0139 E6] The upgrade stamps the `sys_activity` rows written before the
 * two read-rule columns existed: `os migrate activity-changed-fields`.
 *
 * ## The database
 *
 * The schema this version creates (`os migrate apply --yes` over an empty
 * file, the composition `os serve` mounts with an auth secret, so plugin-audit's
 * objects are among it), then turned back into the shape a deployment upgraded
 * from the previous version holds: the two columns DROPPED from the activity
 * shard (`sys_activity` is rotation-managed: its base name is a view over a
 * `sys_activity__r<key>` shard table), and activity rows planted there the way
 * the previous writer left them — no stamp. A real SQLite file under the SQL
 * driver the commands boot, because the raw column read is the point.
 *
 * ## The cases run in order over ONE database, as an operator runs the steps
 *
 *  1. a dry run on the database no upgraded process has opened: the columns
 *     are not there yet, so it reads nothing it could judge and says so;
 *  2. `--apply` boots plain, so the schema sync adds both columns to the
 *     shard, and stamps every row the planner can judge, as the writer would;
 *  3. a re-run stamps nothing (idempotent) and still names the row it cannot
 *     judge, which stays unstamped.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const SECRET = 'os23731-integration-secret-at-least-32-chars';

/** The rows the previous writer left, and the stamp each must get. */
const PLANTED: Array<{ id: string; metadata: unknown; stamp: { changed_fields: string[] | null; milestone_key: string | null } }> = [
  { id: 'act_u1', metadata: { old: { b: 1, a: 1 }, new: { a: 2 } }, stamp: { changed_fields: ['a', 'b'], milestone_key: null } },
  { id: 'act_c1', metadata: { old: null, new: { a: 1 } }, stamp: { changed_fields: [], milestone_key: null } },
  { id: 'act_n1', metadata: { channel: 'call' }, stamp: { changed_fields: [], milestone_key: null } },
  {
    id: 'act_m1',
    metadata: { old: { stage: 'a' }, new: { stage: 'b' }, kind: 'milestone', text_sources: { summary: [], record_label: [], kind: ['stage', 'phase'] } },
    stamp: { changed_fields: ['stage'], milestone_key: 'phase,stage' },
  },
  {
    id: 'act_x1',
    metadata: { kind: 'milestone', text_sources: { summary: [], record_label: [] } },
    stamp: { changed_fields: null, milestone_key: null },
  },
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

let shard = '';

const columnsOf = (table: string): string[] =>
  withDb((db) => (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map((c) => c.name));

const stamps = (): Record<string, { changed_fields: string[] | null; milestone_key: string | null }> =>
  withDb((db) => {
    const out: Record<string, { changed_fields: string[] | null; milestone_key: string | null }> = {};
    const rows = db.prepare(`SELECT id, changed_fields, milestone_key FROM "${shard}" WHERE id LIKE 'act_%' ORDER BY id`).all() as
      Array<{ id: string; changed_fields: string | null; milestone_key: string | null }>;
    for (const r of rows) {
      out[r.id] = {
        changed_fields: r.changed_fields === null ? null : JSON.parse(r.changed_fields),
        milestone_key: r.milestone_key,
      };
    }
    return out;
  });

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-23731-activity-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os23731activity', name: 'requires auth', version: '0.0.0', type: 'app' },",
      "  requires: ['auth'],",
      "  objects: [{ name: 'os23731_thing', fields: { title: { type: 'text' } } }],",
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

  // The previous version's shape: no stamp column, and its rows.
  withDb((db) => {
    shard = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'sys_activity__r*'").get() as
      { name: string } | undefined)?.name ?? '';
    if (!shard) throw new Error('the fixture has no sys_activity shard: the rotation did not run');
    db.exec(`ALTER TABLE "${shard}" DROP COLUMN changed_fields`);
    db.exec(`ALTER TABLE "${shard}" DROP COLUMN milestone_key`);
    for (const row of PLANTED) {
      plant(db, shard, {
        id: row.id, timestamp: new Date().toISOString(), type: 'updated', summary: row.id,
        object_name: 'os23731_thing', record_id: 't1', metadata: JSON.stringify(row.metadata),
      });
    }
  }, false);
  expect(columnsOf(shard), 'fixture: the previous version has no stamp column').not.toContain('changed_fields');
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

describe('os migrate activity-changed-fields stamps the activity rows the previous version left (ADR-0139 E6)', () => {
  const db = () => `file:${dbFile}`;

  it('1. a dry run on the not-yet-synced database writes nothing, adds no column, and does not report a clean table', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateActivityChangedFields), ['--database-url', db(), '--json']);
    process.stderr.write(`[diag 1] exit=${exitCode} ${JSON.stringify(payload).slice(0, 600)}\n`);
    expect(columnsOf(shard)).not.toContain('changed_fields');
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({ apply: false, report: { stamped: 0, failures: 1 } });
  }, CASE_TIMEOUT_MS);

  it('2. --apply adds both columns to the shard and stamps every row the planner can judge, as the writer would', async () => {
    const { payload, exitCode } = await runJson(
      invoke(MigrateActivityChangedFields), ['--apply', '--yes', '--database-url', db(), '--json'],
    );
    process.stderr.write(`[diag 2] exit=${exitCode} ${JSON.stringify(payload).slice(0, 600)}\n`);
    expect(exitCode).toBe(0);
    expect(columnsOf(shard)).toEqual(expect.arrayContaining(['changed_fields', 'milestone_key']));
    expect(payload.report).toMatchObject({ apply: true, stamped: PLANTED.length - 1, milestones: 1, unjudged: 1, failures: 0 });
    expect(stamps()).toEqual(Object.fromEntries(PLANTED.map((r) => [r.id, r.stamp])));
  }, CASE_TIMEOUT_MS);

  it('3. a re-run stamps nothing and still names the row it cannot judge', async () => {
    const before = stamps();
    const { payload, exitCode } = await runJson(
      invoke(MigrateActivityChangedFields), ['--apply', '--yes', '--database-url', db(), '--json'],
    );
    expect(exitCode).toBe(0);
    expect(payload.report).toEqual({ apply: true, scanned: 1, stamped: 0, milestones: 0, unjudged: 1, failures: 0 });
    expect(stamps()).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('4. a dry run after the apply reports the same clean table', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateActivityChangedFields), ['--database-url', db(), '--json']);
    expect(exitCode).toBe(0);
    expect(payload.report).toEqual({ apply: false, scanned: 1, stamped: 0, milestones: 0, unjudged: 1, failures: 0 });
  }, CASE_TIMEOUT_MS);
});
