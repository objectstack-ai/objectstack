// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 85 — spawns the real producer once per single-cause fixture: two served-shape boots that run the real Archiver, and six spawns of the source CLI (dry run, --apply, re-run over the archive fixture; --apply on a project with no archive; a dry run with a runtime archive row; --apply with a declared archive that cannot connect); 67.8 s, the slower of two local runs on a shared container, x 1.25, no CI reading yet

/**
 * [#24899] `os migrate audit-mail-bodies` masks the mail-log bodies the
 * Archiver already moved to `sys_audit_log`'s archive datasource, and the hot
 * copies it will move later are archived masked.
 *
 * ## The measured gap
 *
 * `sys_audit_log` declares `lifecycle.archive: { after: '90d', to: 'archive' }`.
 * The Archiver (`LifecycleService`) copies rows past the hot window to the
 * datasource named `archive` VERBATIM — a driver `find` → `upsert`, no writer
 * and no mask in between — then deletes them hot, and the engine never routes
 * `sys_audit_log` there. So a copy archived before the writer masked kept the
 * body in clear out of the command's reach: it masked the hot engine only.
 *
 * ## The fixture
 *
 * A project declaring an `archive` SQLite datasource with `autoConnect: true`
 * (ADR-0062 D2(c): a managed datasource nothing routes to connects only so),
 * and a served-shape boot that seeds 18.0-writer copies of mail-log rows with
 * the body in clear — two past the hot window, one inside it, one non-mail row
 * past it — then runs the REAL Archiver (`lifecycle.sweep()`). The archive
 * store is therefore exactly what a deployment's is.
 *
 * ## What is pinned
 *
 *   0. The Archiver moved the old copies to the archive with the body in clear
 *      (a vacuous fixture is no pin), and left the young one hot.
 *   1. The dry run counts the hot copy and the archived ones, names the archive
 *      datasource `examined`, and writes nothing to either store.
 *   2. `--apply` leaves 0 copies holding a body in clear in either store; every
 *      other archived row is untouched.
 *   3. A second `--apply` masks nothing and changes no archived row.
 *   4. The copy that was hot when the command ran, aged past the window and
 *      archived by a second sweep, lands in the archive masked.
 *   5. No run prints a body.
 *   6. A deployment whose archive is a RUNTIME datasource row (which `os serve`
 *      connects and this command's boot does not) is NOT reported clean: the
 *      archive reads `not-connected` and the command exits 1. With neither a
 *      connected datasource nor such a row it reads `none` and exits 0.
 *   7. A DECLARED `autoConnect: true` archive this boot cannot connect is NOT
 *      reported clean either: gate (c) is not fail-fast, so the boot degrades
 *      and leaves no driver, and the archive reads `not-connected`, carrying
 *      the connect service's verdict, and the command exits 1.
 *
 * ⛔ The bodies are sentinels, never a link or a token, and every comparison is
 * reported as a count or a boolean.
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
const SENTINEL = 'mail-body-sentinel-24899';
const MASK = '••••••••';

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
 * fixture's `archive` datasource. `MODE=seed` plants the 18.0-writer copies;
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
  const copy = (id) => JSON.stringify({ id, subject: 'Subject kept', status: 'sent', body_text: process.env.SENTINEL, body_html: process.env.SENTINEL });
  await k('sys_audit_log').insert([
    { id: 'aud_old_1', object_name: 'sys_email', record_id: 'em_1', action: 'create', created_at: old, updated_at: old, new_value: copy('em_1') },
    { id: 'aud_old_2', object_name: 'sys_identity_email', record_id: 'ie_1', action: 'delete', created_at: old, updated_at: old, old_value: copy('ie_1') },
    { id: 'aud_old_3', object_name: 'crm_note', record_id: 'n_1', action: 'create', created_at: old, updated_at: old, new_value: JSON.stringify({ id: 'n_1', title: 'kept' }) },
    { id: 'aud_young', object_name: 'sys_email', record_id: 'em_2', action: 'create', created_at: new Date().toISOString(), new_value: copy('em_2') },
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
let runtimeRowDir: string;
let runtimeRowDb: string;
let seedDetail: { source: string; archived: number | null };
let ageDetail: { source: string; archived: number | null };
const runs: Record<'dry' | 'apply' | 'again', Run> = {} as never;
let archivedBefore: Record<string, unknown>[];
let archivedAfterApply: Record<string, unknown>[];
let archivedAfterAgain: Record<string, unknown>[];
let hotAfterApply: Record<string, unknown>[];
let archivedAfterAging: Record<string, unknown>[];
let runtimeRowRun: Run;
let noArchiveRun: Run;
let unreachableDir: string;
let unreachableRun: Run;
let archivedAfterDry: Record<string, unknown>[];
let hotBeforeDry: Record<string, unknown>[];
let hotAfterDry: Record<string, unknown>[];

function sweep(mode: 'seed' | 'age'): { source: string; archived: number | null } {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', SWEEP_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({
      OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
      FIXTURE_PROJECT: dir,
      FIXTURE_DB: mainDb,
      FIXTURE_ARCHIVE: archiveDb,
      SENTINEL,
      MODE: mode,
    }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  const line = String(r.stderr).split('\n').find((l) => l.startsWith('[fixture] swept '));
  if (r.status !== 0 || !line) throw new Error(`the ${mode} sweep did not run (status ${r.status})\n${String(r.stderr).slice(-3000)}`);
  return JSON.parse(line.slice('[fixture] swept '.length));
}

/** One `os migrate audit-mail-bodies <extra…> --database-url file:<db>` run, in `project`. */
function runCommand(project: string, db: string, extra: string[]): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [CLI, 'migrate', 'audit-mail-bodies', ...extra, '--database-url', `file:${db}`],
      { cwd: project, env: childEnv({ OS_ARTIFACT_PATH: join(project, 'dist', 'objectstack.json') }), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`os migrate audit-mail-bodies did not finish within ${RUN_BUDGET_MS}ms`));
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

/** Rows that still hold a sentinel body in clear. */
const clear = (rows: Record<string, unknown>[]): number => rows.filter((r) => JSON.stringify(r).includes(SENTINEL)).length;

function writeArtifact(project: string, datasources: unknown[]): void {
  mkdirSync(join(project, 'dist'), { recursive: true });
  writeFileSync(
    join(project, 'dist', 'objectstack.json'),
    JSON.stringify({
      manifest: { id: 'com.example.os24899', name: 'Archived mail bodies', version: '0.0.0', type: 'app' },
      datasources,
      objects: [{ name: 'os24899_thing', fields: { name: { type: 'text' } } }],
    }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-24899-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mainDb = join(dir, 'data', 'main.db');
  archiveDb = join(dir, 'data', 'archive.db');
  writeArtifact(dir, [{ name: 'archive', driver: 'sqlite', config: { filename: archiveDb }, autoConnect: true }]);

  seedDetail = sweep('seed');
  archivedBefore = auditRows(archiveDb);

  hotBeforeDry = auditRows(mainDb);
  runs.dry = await runCommand(dir, mainDb, ['--json']);
  archivedAfterDry = auditRows(archiveDb);
  hotAfterDry = auditRows(mainDb);
  runs.apply = await runCommand(dir, mainDb, ['--apply', '--yes', '--json']);
  archivedAfterApply = auditRows(archiveDb);
  hotAfterApply = auditRows(mainDb);
  runs.again = await runCommand(dir, mainDb, ['--apply', '--yes', '--json']);
  archivedAfterAgain = auditRows(archiveDb);

  ageDetail = sweep('age');
  archivedAfterAging = auditRows(archiveDb);

  // A deployment whose archive is an admin-created runtime datasource: no
  // declaration, and an active `datasource` row in `sys_metadata`.
  runtimeRowDir = mkdtempSync(join(tmpdir(), 'os-24899-runtime-row-'));
  runtimeRowDb = join(runtimeRowDir, 'main.db');
  writeArtifact(runtimeRowDir, []);
  noArchiveRun = await runCommand(runtimeRowDir, runtimeRowDb, ['--apply', '--yes', '--json']);
  const db = new Database(runtimeRowDb);
  try {
    db.prepare("INSERT INTO sys_metadata (id, name, type, scope, metadata, state, version) VALUES ('md_24899', 'archive', 'datasource', 'platform', ?, 'active', 1)")
      .run(JSON.stringify({ name: 'archive', driver: 'sqlite', config: { filename: './archive.db' }, origin: 'runtime' }));
  } finally {
    db.close();
  }
  runtimeRowRun = await runCommand(runtimeRowDir, runtimeRowDb, ['--json']);

  // A declared archive the boot cannot reach: a Postgres server on a port
  // nothing listens on, so the connect is refused on every attempt. Not an
  // unopenable SQLite file: the source entry pins NODE_ENV=development, under
  // which the SQLite factory steps an unopenable file down to an in-memory
  // engine instead of failing.
  unreachableDir = mkdtempSync(join(tmpdir(), 'os-24899-unreachable-'));
  writeArtifact(unreachableDir, [
    { name: 'archive', driver: 'postgres', config: { host: '127.0.0.1', port: 1, database: 'archive', user: 'os24899' }, autoConnect: true },
  ]);
  unreachableRun = await runCommand(unreachableDir, join(unreachableDir, 'main.db'), ['--apply', '--yes', '--json']);
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (runtimeRowDir) rmSync(runtimeRowDir, { recursive: true, force: true });
  if (unreachableDir) rmSync(unreachableDir, { recursive: true, force: true });
});

const doc = (run: Run): any => JSON.parse(run.stdout);
/** Two row sets hold the same rows, column for column — a boolean, so a failure prints no row. */
const sameRows = (a: Record<string, unknown>[], b: Record<string, unknown>[]): boolean =>
  a.length === b.length && a.every((row, i) => isDeepStrictEqual(row, b[i]));
const archiveOf = (run: Run): any => doc(run).archive.find((a: { datasource: string }) => a.datasource === 'archive');

describe('[#24899] os migrate audit-mail-bodies over an archive datasource', () => {
  it('0. the fixture: the real Archiver moved the old copies to the archive with the body in clear', () => {
    expect(seedDetail.archived).toBe(3);
    expect(archivedBefore.length).toBe(3);
    expect(clear(archivedBefore)).toBe(2);
  });

  it('1. the dry run counts the hot and the archived copies, and writes nothing', () => {
    const run = runs.dry;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(doc(run).report).toMatchObject({ failures: 0, byObject: { sys_audit_log: { rewritten: 1 } } });
    expect(archiveOf(run)).toMatchObject({
      status: 'examined',
      objects: ['sys_audit_log'],
      report: { apply: false, failures: 0, byObject: { sys_audit_log: { scanned: 2, rewritten: 2 } } },
    });
    // Both stores, read after the dry run: neither moved.
    expect(sameRows(archivedAfterDry, archivedBefore)).toBe(true);
    expect(sameRows(hotAfterDry, hotBeforeDry)).toBe(true);
    expect(clear(archivedAfterDry)).toBe(2);
  });

  it('2. --apply leaves 0 clear copies in either store, and every other archived row is untouched', () => {
    const run = runs.apply;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(archiveOf(run).report).toMatchObject({ apply: true, rewritten: 2, failures: 0 });
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
    expect(isDeepStrictEqual(archivedAfterApply.find((r) => r.id === 'aud_old_3'), before.get('aud_old_3'))).toBe(true);
    const masked = JSON.parse(String(archivedAfterApply.find((r) => r.id === 'aud_old_1')!.new_value));
    expect([masked.body_text === MASK, masked.body_html === MASK, masked.subject === 'Subject kept']).toEqual([true, true, true]);
  });

  it('3. a second --apply masks nothing and changes no archived row', () => {
    const run = runs.again;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(doc(run).report.rewritten).toBe(0);
    expect(archiveOf(run).report).toMatchObject({ scanned: 2, rewritten: 0, failures: 0 });
    expect(sameRows(archivedAfterAgain, archivedAfterApply)).toBe(true);
  });

  it('4. the copy that was hot when the command ran is archived masked', () => {
    expect(ageDetail.archived).toBe(1);
    expect(archivedAfterAging.length).toBe(4);
    expect(archivedAfterAging.some((r) => r.id === 'aud_young')).toBe(true);
    expect(clear(archivedAfterAging)).toBe(0);
  });

  it('5. no run prints a body', () => {
    for (const run of [runs.dry, runs.apply, runs.again, runtimeRowRun, noArchiveRun, unreachableRun]) {
      expect(`${run.stdout}\n${run.stderr}`.includes(SENTINEL)).toBe(false);
    }
  });

  it('6. a runtime archive datasource this boot does not connect is NOT reported clean', () => {
    expect(noArchiveRun.code, noArchiveRun.stderr.slice(-2000)).toBe(0);
    expect(archiveOf(noArchiveRun)).toEqual({ datasource: 'archive', objects: ['sys_audit_log'], status: 'none' });
    expect(runtimeRowRun.code).toBe(1);
    expect(archiveOf(runtimeRowRun)).toEqual({ datasource: 'archive', objects: ['sys_audit_log'], status: 'not-connected' });
  });

  it('7. a declared archive this boot cannot connect is NOT reported clean', () => {
    expect(unreachableRun.code).toBe(1);
    const entry = archiveOf(unreachableRun);
    expect(entry).toMatchObject({ datasource: 'archive', objects: ['sys_audit_log'], status: 'not-connected' });
    expect(entry.connection?.status).toBe('failed-degraded');
    expect(entry.report).toBeUndefined();
  });
});
