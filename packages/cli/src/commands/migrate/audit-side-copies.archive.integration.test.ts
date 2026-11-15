// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 90 — spawns the real producer once per single-cause fixture: two served-shape boots that run the real Archiver, and six spawns of the source CLI (a misspelled --object refused before the boot; the human dry run; the JSON dry run; an --apply narrowed to sys_activity; --apply; a re-run), the budget of its twin audit-key-material.archive, re-measure on CI

/**
 * [#33155] `os migrate audit-side-copies` is the operator door for
 * `@objectstack/plugin-audit`'s at-rest side-copy rewrite (#32442): it removes
 * the columns `side-copy-columns.ts` lists (today `sys_approval_request`'s
 * `payload_json`) from the ledger copies written before the writer omitted
 * them, on the hot tables (`migrateSideCopies`) and in the archive datasource
 * `sys_audit_log` archives to (`migrateArchivedSideCopies`). The fixture and
 * the cases are `audit-key-material.archive.integration.test.ts`'s, over this
 * rewrite's list, plus the `--object` scope. The archive classification the
 * twins share (`../../utils/ledger-copy-archive.ts`: none, not-connected,
 * unknown) is pinned there and not repeated here.
 *
 * ## The fixture
 *
 * A project declaring an `archive` SQLite datasource with `autoConnect: true`,
 * and a served-shape boot that seeds older-writer copies still carrying the
 * column (two approval-request copies past the hot window, one inside it, and
 * a row of an object the list does not name that happens to carry a column of
 * the same name, past it), then runs the REAL Archiver (`lifecycle.sweep()`).
 *
 * ## What is pinned
 *
 *   0. The Archiver moved the old copies to the archive still carrying the
 *      column (a vacuous fixture is no pin), and left the young one hot.
 *   1. The dry run reports, per copy table, the copies read and the copies to
 *      rewrite for the hot tables and for the archive, and writes nothing to
 *      either store; the human face prints the same counts per table and store.
 *   2. `--object sys_activity --apply` reads and writes only that table: no
 *      `sys_audit_log` copy is read or rewritten in either store.
 *   3. `--apply` leaves 0 copies carrying the column in either store and
 *      reports the counts it wrote; every other key of a rewritten copy, every
 *      other column, and the unlisted object's row are untouched.
 *   4. A second `--apply` rewrites nothing and changes no archived row.
 *   5. The copy that was hot when the command ran, aged past the window and
 *      archived by a second sweep, lands in the archive without the column.
 *   6. An `--object` that is not a copy table is refused before anything is
 *      read, exit 1, `OBJECT_NOT_FOUND`.
 *   7. No run prints a sentinel.
 *
 * ⛔ The column values are sentinels, and every comparison is reported as a
 * count or a boolean.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import Database from 'better-sqlite3';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 480_000;
const RUN_BUDGET_MS = 120_000;
const SENTINEL = 'side-copy-sentinel-33155';
/** The same-named column on an object the list does not name: recorded as before. */
const OTHER = 'other-object-column-33155';

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

/**
 * This process's environment for a child, minus the families
 * `test/helpers/serve-process.ts` `childEnv()` strips (its header says why).
 */
function childEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  const unset: Record<string, undefined> = {};
  for (const key of OVERRIDING_ENV) unset[key] = undefined;
  return {
    ...env,
    ...unset,
    // The fixed key `serve-process.ts` hands its children, so no boot mints and
    // persists a crypto key into this runner's home directory.
    OS_SECRET_KEY: '0e2e'.repeat(16),
    // [#22579] One database for the hot objects: the fixture declares its own topology.
    OS_TELEMETRY_DB: '0',
    NO_COLOR: '1',
    ...overrides,
  };
}

/**
 * A served-shape boot of the data stack plus the audit plugin, with the
 * fixture's `archive` datasource. `MODE=seed` plants the older-writer copies;
 * `MODE=age` moves every hot copy's `created_at` past the window. Either way
 * the boot then runs the real Archiver once.
 */
const SWEEP_CHILD = `
const rt = await import('@objectstack/runtime');
const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
const { AuditPlugin } = await import('@objectstack/plugin-audit');
const { SqlDriver } = await import('@objectstack/driver-sql');
const stack = await rt.createStandaloneStack({
  projectRoot: process.env.FIXTURE_PROJECT,
  databaseUrl: 'file:' + process.env.FIXTURE_DB,
  skipSeedData: true,
  // Armed, so the service is enabled: the sweep below is the one this child
  // runs itself, long before the schedule's first (unref'ed) tick.
});
const runtime = new rt.Runtime({ cluster: false });
const kernel = runtime.getKernel();
for (const plugin of stack.plugins) await kernel.use(plugin);
await kernel.use(new PlatformObjectsPlugin());
await kernel.use(new AuditPlugin());
await runtime.start();
const ql = kernel.getService('objectql');
let source = 'declared';
if (!ql.getDriverByName('archive')) {
  // The host registers the archive driver under the datasource's name, as
  // the datasource-connection service does for a connected declaration.
  const cold = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_ARCHIVE }, useNullAsDefault: true });
  Object.defineProperty(cold, 'name', { value: 'archive' });
  await cold.connect();
  ql.registerDriver(cold);
  source = 'host-registered';
}
const k = ql.getDriverForObject('sys_audit_log').knex;
const old = new Date(Date.now() - 200 * 86400000).toISOString();
if (process.env.MODE === 'seed') {
  const v = process.env.SENTINEL;
  await k('sys_audit_log').insert([
    { id: 'aud_old_1', object_name: 'sys_approval_request', record_id: 'ar_1', action: 'create', created_at: old, updated_at: old, new_value: JSON.stringify({ id: 'ar_1', status: 'kept', process_name: 'kept', payload_json: v }) },
    { id: 'aud_old_2', object_name: 'sys_approval_request', record_id: 'ar_2', action: 'delete', created_at: old, updated_at: old, old_value: JSON.stringify({ id: 'ar_2', status: 'kept', payload_json: v }) },
    { id: 'aud_old_3', object_name: 'crm_note', record_id: 'n_1', action: 'create', created_at: old, updated_at: old, new_value: JSON.stringify({ id: 'n_1', title: 'kept', payload_json: process.env.OTHER }) },
    { id: 'aud_young', object_name: 'sys_approval_request', record_id: 'ar_3', action: 'update', created_at: new Date().toISOString(), new_value: JSON.stringify({ id: 'ar_3', status: 'kept', payload_json: v }) },
  ]);
} else {
  await k('sys_audit_log').update({ created_at: old });
}
const report = await kernel.getService('lifecycle').sweep();
const entry = report.swept.find((s) => s.object === 'sys_audit_log');
await kernel.shutdown();
process.stderr.write('[fixture] swept ' + JSON.stringify({ source, archived: entry ? entry.archived : null }) + '\\n');
process.exit(0);
`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

let dir: string;
let mainDb: string;
let archiveDb: string;
let seedDetail: { source: string; archived: number | null };
let ageDetail: { source: string; archived: number | null };
const runs: Record<'refused' | 'human' | 'dry' | 'scoped' | 'apply' | 'again', Run> = {} as never;
let archivedBefore: Record<string, unknown>[];
let hotBefore: Record<string, unknown>[];
let archivedAfterDry: Record<string, unknown>[];
let hotAfterDry: Record<string, unknown>[];
let archivedAfterScoped: Record<string, unknown>[];
let hotAfterScoped: Record<string, unknown>[];
let archivedAfterApply: Record<string, unknown>[];
let hotAfterApply: Record<string, unknown>[];
let archivedAfterAgain: Record<string, unknown>[];
let archivedAfterAging: Record<string, unknown>[];

function sweep(mode: 'seed' | 'age'): { source: string; archived: number | null } {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', SWEEP_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({
      OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
      FIXTURE_PROJECT: dir,
      FIXTURE_DB: mainDb,
      FIXTURE_ARCHIVE: archiveDb,
      SENTINEL,
      OTHER,
      MODE: mode,
    }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  const line = String(r.stderr).split('\n').find((l) => l.startsWith('[fixture] swept '));
  if (r.status !== 0 || !line) throw new Error(`the ${mode} sweep did not run (status ${r.status})\n${String(r.stderr).slice(-3000)}`);
  return JSON.parse(line.slice('[fixture] swept '.length));
}

/** One `os migrate audit-side-copies <extra…> --database-url file:<db>` run, in `project`. */
function runCommand(project: string, db: string, extra: string[]): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [CLI, 'migrate', 'audit-side-copies', ...extra, '--database-url', `file:${db}`],
      { cwd: project, env: childEnv({ OS_ARTIFACT_PATH: join(project, 'dist', 'objectstack.json') }), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`os migrate audit-side-copies did not finish within ${RUN_BUDGET_MS}ms`));
    }, RUN_BUDGET_MS);
    child.on('error', (err) => { clearTimeout(timer); rejectRun(err); });
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}

/** Every `sys_audit_log` row of one database file, read with a connection of our own. */
function auditRows(file: string): Record<string, unknown>[] {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT * FROM sys_audit_log ORDER BY id').all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/** Rows that still carry a listed column. */
const clear = (rows: Record<string, unknown>[]): number => rows.filter((r) => JSON.stringify(r).includes(SENTINEL)).length;

function writeArtifact(project: string, datasources: unknown[]): void {
  mkdirSync(join(project, 'dist'), { recursive: true });
  writeFileSync(
    join(project, 'dist', 'objectstack.json'),
    JSON.stringify({
      manifest: { id: 'com.example.os33155', name: 'Archived side copies', version: '0.0.0', type: 'app' },
      datasources,
      objects: [{ name: 'os33155_thing', fields: { name: { type: 'text' } } }],
    }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-33155-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mainDb = join(dir, 'data', 'main.db');
  archiveDb = join(dir, 'data', 'archive.db');
  writeArtifact(dir, [{ name: 'archive', driver: 'sqlite', config: { filename: archiveDb }, autoConnect: true }]);

  seedDetail = sweep('seed');
  archivedBefore = auditRows(archiveDb);
  hotBefore = auditRows(mainDb);

  runs.refused = await runCommand(dir, mainDb, ['--object', 'sys_approval_request', '--apply', '--yes', '--json']);
  runs.human = await runCommand(dir, mainDb, []);
  runs.dry = await runCommand(dir, mainDb, ['--json']);
  archivedAfterDry = auditRows(archiveDb);
  hotAfterDry = auditRows(mainDb);
  runs.scoped = await runCommand(dir, mainDb, ['--object', 'sys_activity', '--apply', '--yes', '--json']);
  archivedAfterScoped = auditRows(archiveDb);
  hotAfterScoped = auditRows(mainDb);
  runs.apply = await runCommand(dir, mainDb, ['--apply', '--yes', '--json']);
  archivedAfterApply = auditRows(archiveDb);
  hotAfterApply = auditRows(mainDb);
  runs.again = await runCommand(dir, mainDb, ['--apply', '--yes', '--json']);
  archivedAfterAgain = auditRows(archiveDb);

  ageDetail = sweep('age');
  archivedAfterAging = auditRows(archiveDb);
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const doc = (run: Run): any => JSON.parse(run.stdout);
/** Two row sets hold the same rows, column for column — a boolean, so a failure prints no row. */
const sameRows = (a: Record<string, unknown>[], b: Record<string, unknown>[]): boolean =>
  a.length === b.length && a.every((row, i) => isDeepStrictEqual(row, b[i]));
const archiveOf = (run: Run): any => doc(run).archive.find((a: { datasource: string }) => a.datasource === 'archive');

describe('os migrate audit-side-copies over the hot tables and an archive datasource', () => {
  it('0. the fixture: the real Archiver moved the old copies to the archive still carrying the column', () => {
    expect(seedDetail.archived).toBe(3);
    expect(archivedBefore.length).toBe(3);
    expect(clear(archivedBefore)).toBe(2);
    expect(clear(hotBefore)).toBe(1);
  });

  it('1. the dry run reports the copies read and to rewrite per table, hot and archived, and writes nothing', () => {
    const run = runs.dry;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(doc(run)).toMatchObject({ apply: false });
    expect(doc(run).report).toMatchObject({
      apply: false,
      failures: 0,
      byObject: { sys_audit_log: { scanned: 1, rewritten: 1, refused: 0 }, sys_activity: { rewritten: 0 } },
    });
    expect(archiveOf(run)).toMatchObject({
      status: 'examined',
      objects: ['sys_audit_log'],
      report: { apply: false, failures: 0, byObject: { sys_audit_log: { scanned: 2, rewritten: 2 } } },
    });
    // Both stores, read after the dry run: neither moved.
    expect(sameRows(archivedAfterDry, archivedBefore)).toBe(true);
    expect(sameRows(hotAfterDry, hotBefore)).toBe(true);
    expect(clear(archivedAfterDry)).toBe(2);
  });

  it('1b. the human dry run prints the same counts per table, hot and archived, and says nothing was written', () => {
    const run = runs.human;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(run.stdout).toMatch(/sys_audit_log: 1 ledger cop\(ies\) scanned, 1 to rewrite/);
    expect(run.stdout).toMatch(/sys_audit_log \(archive datasource 'archive'\): 2 ledger cop\(ies\) scanned, 2 to rewrite/);
    expect(run.stdout).toMatch(/Dry run only/);
  });

  it('2. --object sys_activity --apply reads and writes only that table, in neither store sys_audit_log', () => {
    const run = runs.scoped;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(Object.keys(doc(run).report.byObject)).toEqual(['sys_activity']);
    expect(doc(run).report).toMatchObject({ apply: true, rewritten: 0, failures: 0 });
    expect(doc(run).archive).toEqual([]);
    expect(sameRows(archivedAfterScoped, archivedBefore)).toBe(true);
    expect(sameRows(hotAfterScoped, hotBefore)).toBe(true);
  });

  it('3. --apply leaves 0 copies carrying the column in either store, reports what it wrote, and nothing else moves', () => {
    const run = runs.apply;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(doc(run).report).toMatchObject({ apply: true, failures: 0, byObject: { sys_audit_log: { scanned: 1, rewritten: 1 } } });
    expect(archiveOf(run).report).toMatchObject({ apply: true, rewritten: 2, failures: 0, byObject: { sys_audit_log: { scanned: 2, rewritten: 2 } } });
    expect(clear(archivedAfterApply)).toBe(0);
    expect(clear(hotAfterApply)).toBe(0);
    const before = new Map(archivedBefore.map((r) => [r.id, r]));
    const movedColumns = archivedAfterApply.flatMap((row) =>
      Object.keys(before.get(row.id)!)
        .filter((key) => key !== 'new_value' && key !== 'old_value')
        .filter((key) => !isDeepStrictEqual(row[key], before.get(row.id)![key]))
        .map((key) => `${String(row.id)}.${key}`),
    );
    // Names only: an id and a column, never a value.
    expect(movedColumns).toEqual([]);
    // The unlisted object's row keeps its same-named column.
    expect(isDeepStrictEqual(archivedAfterApply.find((r) => r.id === 'aud_old_3'), before.get('aud_old_3'))).toBe(true);
    expect(JSON.stringify(archivedAfterApply.find((r) => r.id === 'aud_old_3')).includes(OTHER)).toBe(true);
    // A rewritten copy loses exactly the column: every other key is kept.
    const created = JSON.parse(String(archivedAfterApply.find((r) => r.id === 'aud_old_1')!.new_value));
    const deleted = JSON.parse(String(archivedAfterApply.find((r) => r.id === 'aud_old_2')!.old_value));
    const young = JSON.parse(String(hotAfterApply.find((r) => r.id === 'aud_young')!.new_value));
    expect(Object.keys(created).sort()).toEqual(['id', 'process_name', 'status']);
    expect(Object.keys(deleted).sort()).toEqual(['id', 'status']);
    expect(Object.keys(young).sort()).toEqual(['id', 'status']);
  });

  it('4. a second --apply rewrites nothing and changes no archived row', () => {
    const run = runs.again;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(doc(run).report.rewritten).toBe(0);
    expect(archiveOf(run).report).toMatchObject({ scanned: 2, rewritten: 0, failures: 0 });
    expect(sameRows(archivedAfterAgain, archivedAfterApply)).toBe(true);
  });

  it('5. the copy that was hot when the command ran is archived without the column', () => {
    expect(ageDetail.archived).toBe(1);
    expect(archivedAfterAging.length).toBe(4);
    expect(archivedAfterAging.some((r) => r.id === 'aud_young')).toBe(true);
    expect(clear(archivedAfterAging)).toBe(0);
  });

  it('6. an --object that is not a copy table is refused before anything is read, and nothing is written', () => {
    const run = runs.refused;
    expect(run.code).toBe(1);
    expect(doc(run)).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(doc(run).error).toMatch(/sys_activity, sys_audit_log/);
    // It ran first: the dry run read both stores as the seed left them.
    expect(sameRows(hotAfterDry, hotBefore)).toBe(true);
  });

  it('7. no run prints a sentinel', () => {
    for (const run of Object.values(runs)) {
      expect(`${run.stdout}\n${run.stderr}`.includes(SENTINEL)).toBe(false);
    }
  });
});
