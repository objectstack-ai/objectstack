// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23429 E1 · ADR-0131 D10 item 5] `os migrate apply --allow-destructive`
 * refuses to drop `organization_id` from a table in the organization-ownership
 * ceremony's inventory until the ceremony's marker is verified — the
 * #17440 / #23281 shape, `--json` refusal included, no flag that stands it
 * down. Pinned on a v17-shape `sys_platform_setting` (an inventory table v18 declares
 * no organization column on, so the drift report offers its physical one for
 * the destructive apply):
 *
 * 1. the drop is refused, naming the ceremony, and nothing is dropped — the
 *    whole `--allow-destructive` run is held, an unrelated drop in it included;
 * 2. a control: an unrelated destructive drop on the same table is not gated;
 * 3. once the ceremony's marker is verified, the drop proceeds.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';
import { isExitSignal } from '../../utils/format.js';
import MigrateApply from './apply.js';

// Pay the first transform of the dist-resolved workspace deps the command
// reaches through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;

const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH',
] as const;

async function runJson(argv: string[]): Promise<{ payload: any; exitCode: number }> {
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
      await MigrateApply.run(argv, { root: CLI_ROOT });
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try { payload = JSON.parse(out); } catch { payload = { unparsed: out.slice(-400) }; }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

let dir: string;
let v18Db: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

function withDb<T>(file: string, fn: (db: Database.Database) => T): T {
  const db = new Database(file);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const columnsOf = (file: string, table: string): string[] =>
  withDb(file, (db) => (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map((c) => c.name));

/** A copy of the v18 schema with `columns` added raw to `sys_platform_setting`. */
let seq = 0;
function caseDb(columns: readonly string[]): string {
  seq += 1;
  const file = join(dir, `case-${seq}.db`);
  copyFileSync(v18Db, file);
  withDb(file, (db) => { for (const c of columns) db.exec(`ALTER TABLE sys_platform_setting ADD COLUMN ${c} TEXT`); });
  return file;
}

const dropArgv = (file: string) => ['--database-url', `file:${file}`, '--allow-destructive', '--yes', '--json'];


beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-23429-drop-gate-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    "export default { manifest: { id: 'com.example.os23429gate', name: 'gate', version: '0.0.0', type: 'app' } };\n",
  );
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  v18Db = join(dir, 'v18.db');
  process.chdir(dir);
  try {
    const created = await runJson(['--database-url', `file:${v18Db}`, '--yes', '--json']);
    expect(created.exitCode, JSON.stringify(created.payload).slice(0, 400)).toBe(0);
  } finally {
    process.chdir(savedCwd);
  }
  // This apply of THIS tree created the store from empty, so it wrote this
  // release's birth marker; the v17 database each case stands in for carries
  // none, and the drop gate below reads that absence.
  withDb(v18Db, (db) => db.prepare('DELETE FROM sys_migration WHERE id = ?').run(ORGANIZATION_OWNERSHIP_MIGRATION_ID));
  expect(columnsOf(v18Db, 'sys_platform_setting'), 'fixture: v18 declares no organization column here').not.toContain('organization_id');
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

describe('os migrate apply --allow-destructive waits for the organization-ownership ceremony (#23429 E1)', () => {
  it('1. a v17-shape table: the organization_id drop is refused, naming the ceremony, and nothing is dropped', async () => {
    const file = caseDb(['organization_id']);
    const { payload, exitCode } = await runJson(dropArgv(file));
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({
      message: 'refused_organization_ownership_unmigrated',
      tables: ['sys_platform_setting'],
      applied: [],
      created: [],
      marker: null,
    });
    expect(payload.detail).toMatch(/organization-ownership ceremony/);
    expect(columnsOf(file, 'sys_platform_setting')).toContain('organization_id');
  }, CASE_TIMEOUT_MS);

  it('1b. an unverified marker refuses too', async () => {
    const file = caseDb(['organization_id']);
    withDb(file, (db) => db.prepare(
      'INSERT INTO sys_migration (id, last_run_at, verified_at, blocking) VALUES (?, ?, NULL, 2)',
    ).run(ORGANIZATION_OWNERSHIP_MIGRATION_ID, new Date().toISOString()));
    const { payload, exitCode } = await runJson(dropArgv(file));
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({ message: 'refused_organization_ownership_unmigrated', tables: ['sys_platform_setting'] });
    expect(payload.detail).toMatch(/is not verified \(2 blocking/);
    expect(columnsOf(file, 'sys_platform_setting')).toContain('organization_id');
  }, CASE_TIMEOUT_MS);

  it('1c. the refusal holds the WHOLE run: a gated drop beside an unrelated one, and neither is applied', async () => {
    const file = caseDb(['organization_id', 'legacy_23429_note']);
    const { payload, exitCode } = await runJson(dropArgv(file));
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({
      message: 'refused_organization_ownership_unmigrated', tables: ['sys_platform_setting'], applied: [], created: [],
    });
    expect(columnsOf(file, 'sys_platform_setting')).toEqual(expect.arrayContaining(['organization_id', 'legacy_23429_note']));
  }, CASE_TIMEOUT_MS);

  it('2. control: an unrelated destructive drop on the same table is not gated', async () => {
    const file = caseDb(['legacy_23429_note']);
    const { payload, exitCode } = await runJson(dropArgv(file));
    expect(exitCode, JSON.stringify(payload).slice(0, 600)).toBe(0);
    expect(payload.message).not.toBe('refused_organization_ownership_unmigrated');
    expect(columnsOf(file, 'sys_platform_setting')).not.toContain('legacy_23429_note');
  }, CASE_TIMEOUT_MS);

  it('3. once the ceremony\'s marker is verified, the drop proceeds', async () => {
    const file = caseDb(['organization_id']);
    const now = new Date().toISOString();
    withDb(file, (db) => db.prepare(
      'INSERT INTO sys_migration (id, last_run_at, verified_at, blocking) VALUES (?, ?, ?, 0)',
    ).run(ORGANIZATION_OWNERSHIP_MIGRATION_ID, now, now));
    const { payload, exitCode } = await runJson(dropArgv(file));
    expect(exitCode, JSON.stringify(payload).slice(0, 600)).toBe(0);
    expect(payload.message).not.toBe('refused_organization_ownership_unmigrated');
    expect(columnsOf(file, 'sys_platform_setting')).not.toContain('organization_id');
  }, CASE_TIMEOUT_MS);
});
