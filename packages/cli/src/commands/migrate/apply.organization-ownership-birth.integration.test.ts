// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10; ruling record 6269955919, ① A] `os migrate apply` is the
 * boot that creates a fresh install's tables when an operator's deploy script
 * runs it before the first `os serve`, so it writes the organization-ownership
 * BIRTH MARKER — and only on a database it created from empty.
 *
 * Its boot defers schema DDL: each object is stored and skipped before the
 * driver counts it, so the birth plugin its boot composes sees nothing created
 * and writes nothing. The tables are created at the confirmed flush, and the
 * birth half runs there (`SchemaStack.flushSchemaDdl`). The served boot's guard
 * then judges the file as `os serve` does — read here through
 * `assertOrganizationOwnershipMigrated` on a boot that creates nothing, so the
 * verdict is the marker's alone:
 *
 *  (a) an empty file: the apply writes one verified birth row, and the guard
 *      admits the database;
 *  (b) a database the apply did not create — no marker, the shape an 18.0
 *      pre-release leaves, and a 17.x one with a retired organization column —
 *      gets NO birth marker, though the flush creates a table in it and creates
 *      nothing else, and the guard still refuses it, naming the ceremony;
 *  (c, d) the apply run again over the database it created and marked, with a
 *      table to create: one row, unchanged.
 *
 * Case (b) is the rule that must not break: a false birth would let a database
 * an earlier release created skip the ownership ceremony.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID, ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } from '@objectstack/spec/system';
import { assertOrganizationOwnershipMigrated, isOrganizationOwnershipBootRefusal } from '@objectstack/runtime';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import MigrateApply from './apply.js';

// Pay the first transform of the dist-resolved workspace deps the command
// reaches through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/objectql';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;

/** The ceremony's first step, as the boot refusal prescribes it. */
const CEREMONY_PLAN = 'os migrate organization-ownership --out PLAN';

/** A table the composition declares, dropped from a copy so the apply's flush has one to create. */
const DROPPED_TABLE = 'sys_platform_setting_audit';

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

const applyArgv = (file: string) => ['--database-url', `file:${file}`, '--yes', '--json'];

function withDb<T>(file: string, fn: (db: Database.Database) => T): T {
  const db = new Database(file);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Every `sys_migration` row naming the ceremony: the marker, read straight from the file. */
const markerRows = (file: string): Array<Record<string, unknown>> =>
  withDb(file, (db) => db.prepare('SELECT * FROM sys_migration WHERE id = ?').all(ORGANIZATION_OWNERSHIP_MIGRATION_ID) as Array<Record<string, unknown>>);

/**
 * The served boot's verdict on `file`, as `os serve`'s guard reaches it, from a
 * boot that holds its DDL back: it creates nothing, so the guard cannot read the
 * store as created from empty and decides on the marker alone. Resolves when the
 * database would be served; rejects with the refusal when it would not.
 *
 * Composed as the apply composes, so the ledger object is registered: a boot of
 * the data stack alone registers no `sys_migration`, and the guard is inert
 * there — it would admit every file. Case (b)'s refusal is the control.
 */
async function guardVerdict(file: string): Promise<void> {
  const stack = await bootSchemaStack({
    jsonOutput: false,
    databaseUrl: `file:${file}`,
    deferSchemaDdl: true,
    readOnlyProbe: true,
    composeHostStack: true,
    composeServedPlatform: true,
    projectRoot: dir,
  });
  try {
    const engine = (stack.kernel as { getService: (name: string) => unknown }).getService('objectql');
    await assertOrganizationOwnershipMigrated(engine as never);
  } finally {
    await stack.shutdown();
  }
}

let dir: string;
let freshDb: string;
let freshApply: { payload: any; exitCode: number };
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** A copy of the database the first apply created, edited raw by `edit`. */
let seq = 0;
function copyOfFresh(edit: (db: Database.Database) => void): string {
  seq += 1;
  const file = join(dir, `case-${seq}.db`);
  copyFileSync(freshDb, file);
  withDb(file, edit);
  return file;
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-apply-birth-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    "export default { manifest: { id: 'com.example.applybirth', name: 'birth', version: '0.0.0', type: 'app' } };\n",
  );
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  // (a)'s act: `os migrate apply` on a file that does not exist yet.
  freshDb = join(dir, 'fresh.db');
  process.chdir(dir);
  try {
    freshApply = await runJson(applyArgv(freshDb));
  } finally {
    process.chdir(savedCwd);
  }
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

describe('os migrate apply writes the organization-ownership birth marker on a database it created from empty', () => {
  it('(a) an empty file: one verified birth row at the current shape generation, and the guard admits it', async () => {
    expect(freshApply.exitCode, JSON.stringify(freshApply.payload).slice(0, 400)).toBe(0);
    expect(freshApply.payload.created.length, 'the apply created the tables').toBeGreaterThan(0);

    const rows = markerRows(freshDb);
    expect(rows).toHaveLength(1);
    expect(rows[0].verified_at).not.toBeNull();
    expect(Number(rows[0].blocking)).toBe(0);
    expect(JSON.parse(String(rows[0].details)).birth).toMatchObject({
      shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION,
    });

    await expect(guardVerdict(freshDb)).resolves.toBeUndefined();
  }, CASE_TIMEOUT_MS);

  it.each([
    ['an 18.0 pre-release shape (no marker, no retired column)', [] as string[]],
    ['a 17.x shape (no marker, a retired organization column)', ['ALTER TABLE sys_platform_setting ADD COLUMN organization_id TEXT']],
  ])('(b) a database the apply did not create, %s: no birth marker, and the guard still refuses it', async (_shape, extra) => {
    const file = copyOfFresh((db) => {
      db.prepare('DELETE FROM sys_migration WHERE id = ?').run(ORGANIZATION_OWNERSHIP_MIGRATION_ID);
      db.exec(`DROP TABLE ${DROPPED_TABLE}`);
      for (const sql of extra) db.exec(sql);
    });

    const { payload, exitCode } = await runJson(applyArgv(file));
    expect(exitCode, JSON.stringify(payload).slice(0, 400)).toBe(0);
    // The trap the birth half must not fall into: the flush's own work names
    // only tables it CREATED — a populated database that merely gains one reads
    // exactly like an empty one there.
    expect(payload.created).toEqual([expect.objectContaining({ table: DROPPED_TABLE, kind: 'create_table' })]);

    expect(markerRows(file)).toEqual([]);
    const refusal = await guardVerdict(file).then(() => null, (error: unknown) => error);
    expect(isOrganizationOwnershipBootRefusal(refusal), String(refusal)).toBe(true);
    expect((refusal as Error).message).toContain(CEREMONY_PLAN);
    expect((refusal as { tables: string[] }).tables).toEqual(extra.length > 0 ? ['sys_platform_setting'] : []);
  }, CASE_TIMEOUT_MS);

  it('(c, d) the apply run again over the database it created and marked, with a table to create: one row, unchanged', async () => {
    const file = copyOfFresh((db) => db.exec(`DROP TABLE ${DROPPED_TABLE}`));
    const before = markerRows(file);
    expect(before).toHaveLength(1);

    const { payload, exitCode } = await runJson(applyArgv(file));
    expect(exitCode, JSON.stringify(payload).slice(0, 400)).toBe(0);
    expect(payload.created).toEqual([expect.objectContaining({ table: DROPPED_TABLE, kind: 'create_table' })]);

    expect(markerRows(file)).toEqual(before);
  }, CASE_TIMEOUT_MS);
});
