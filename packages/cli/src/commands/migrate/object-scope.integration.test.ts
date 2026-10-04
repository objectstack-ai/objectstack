// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21644] The `--object` scope of the `os migrate` data-migration family,
 * pinned at the public door: the CLI spawned against a real SQLite database.
 *
 * ## The measured defect
 *
 * With one off-shape value stored, `os migrate value-shapes --object
 * <misspelled> --apply --yes --json` exited 0 with `scannedObjects: []` and
 * recorded the deployment-level `adr-0104-value-shapes` flag as VERIFIED. Two
 * causes, one per half of this file:
 *
 *  - every command in the family handed `--object` to its scan as the
 *    candidate list, and the scan silently dropped a name the deployment does
 *    not declare, so a typo scanned nothing and read as clean;
 *  - the flag-recording commands recorded the deployment's flag from a run
 *    that read only the named objects, so any passing subset attested data
 *    nobody scanned.
 *
 * ## The census (one row per command; the enumeration below is this table)
 *
 * | command | `--object` | `--apply` records a deployment flag | where |
 * | --- | --- | --- | --- |
 * | `value-shapes` | repeatable | `adr-0104-value-shapes` | the CLI (`recordDataMigrationRun`) |
 * | `files-to-references` | repeatable | `adr-0104-file-references` | the producer, `runFilesToReferencesMigration` |
 * | `summary-nulls` | repeatable | none, by design | — |
 * | `duplicates` | single | none (no `--apply`; it writes nothing) | — |
 *
 * ## The answers pinned
 *
 *  - A narrowed `--apply` applies its fixes and records no deployment flag,
 *    and leaves a flag an earlier full-scope run recorded exactly as it was.
 *    A full-scope `--apply` records the flag as before.
 *  - An unknown `--object` exits 1 with `OBJECT_NOT_FOUND`, naming the name
 *    and the declared objects, on all four commands, before anything is read
 *    or written.
 *  - The measured repro leaves the flag unrecorded.
 *
 * Every spawn runs in the hook, each against its own copy of the seeded
 * database; a case only reads what a run printed and what the database holds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 600_000;
const RUN_BUDGET_MS = 120_000;

const VALUE_SHAPES_FLAG = 'adr-0104-value-shapes';
const FILE_REFERENCES_FLAG = 'adr-0104-file-references';

const ARTIFACT = {
  manifest: { id: 'com.example.os21644', name: 'Narrowed apply', version: '0.0.0', type: 'app' },
  objects: [
    // No covered field: declared, and nothing for any of the four to check.
    { name: 'os21644_account', fields: { name: { type: 'text' } } },
    // A `location` is a structured-JSON value class: `value-shapes` walks it.
    { name: 'os21644_site', fields: { name: { type: 'text' }, geo: { type: 'location' } } },
    // An `image` is a file value class: `files-to-references` walks it.
    { name: 'os21644_product', fields: { name: { type: 'text' }, image: { type: 'image' } } },
  ],
};

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

/**
 * This process's environment for a child, minus the families
 * `test/helpers/serve-process.ts` `childEnv()` strips (its header says why).
 */
function childEnv(overrides: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  for (const key of OVERRIDING_ENV) env[key] = undefined;
  return { ...env, ...overrides };
}

/**
 * A served-shape boot (DDL performed) writes one clean row per object. The
 * creation-time attestation may record flags for a datastore born empty, so
 * the flag table is then emptied: every run below starts from a deployment
 * that has never earned a flag, the state a migration exists for.
 */
const SEED_CHILD = `
const rt = await import('@objectstack/runtime');
const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
const stack = await rt.createStandaloneStack({
  projectRoot: process.env.FIXTURE_PROJECT,
  databaseUrl: 'file:' + process.env.FIXTURE_DB,
  skipSeedData: true,
  armLifecycleSweep: false,
});
const runtime = new rt.Runtime({ cluster: false });
const kernel = runtime.getKernel();
for (const plugin of stack.plugins) await kernel.use(plugin);
await kernel.use(new PlatformObjectsPlugin());
await runtime.start();
const ql = kernel.getService('objectql');
const SYSTEM = { context: { isSystem: true } };
await ql.insert('os21644_account', { id: 'a1', name: 'Acme' }, SYSTEM);
await ql.insert('os21644_site', { id: 's1', name: 'HQ', geo: { lat: 1, lng: 2 } }, SYSTEM);
await ql.insert('os21644_product', { id: 'p1', name: 'Widget' }, SYSTEM);
await kernel.shutdown();
const { SqlDriver } = await import('@objectstack/driver-sql');
const raw = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_DB }, useNullAsDefault: true });
await raw.knex('sys_migration').del();
await raw.disconnect();
process.stderr.write('[fixture] seeded\\n');
process.exit(0);
`;

/** The repro's off-shape value, written past the write path: a location keyed the retired way. */
const OFF_SHAPE_CHILD = `
const { SqlDriver } = await import('@objectstack/driver-sql');
const raw = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_DB }, useNullAsDefault: true });
await raw.knex('os21644_site').where({ id: 's1' }).update({ geo: JSON.stringify({ latitude: 1, longitude: 2 }) });
await raw.disconnect();
process.exit(0);
`;

/** The flag rows and the app rows, read on a connection of our own. */
const READ_STATE_CHILD = `
const { SqlDriver } = await import('@objectstack/driver-sql');
const raw = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_DB }, useNullAsDefault: true });
const k = raw.knex;
const flags = await k('sys_migration').select('id', 'last_run_at', 'verified_at', 'blocking').orderBy('id');
const site = await k('os21644_site').select('id', 'geo').orderBy('id');
const product = await k('os21644_product').select('id', 'image').orderBy('id');
await raw.disconnect();
process.stdout.write(JSON.stringify({ flags, site, product }));
process.exit(0);
`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface FlagRow {
  id: string;
  last_run_at: string | null;
  verified_at: string | null;
  blocking: number;
}

interface State {
  flags: FlagRow[];
  site: Array<{ id: string; geo: string | null }>;
  product: Array<{ id: string; image: string | null }>;
}

let dir: string;
let seeded: string;
let copies = 0;

function childNode(code: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: CLI_ROOT,
    env: childEnv({ OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'), OS_SECRET_KEY: '0e2e'.repeat(16), ...env }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  return { status: out.status, stdout: String(out.stdout), stderr: String(out.stderr) };
}

/** A fresh copy of the seeded database, so no run sees another's flag. */
function freshDb(): string {
  const db = join(dir, 'data', `run-${++copies}.db`);
  copyFileSync(seeded, db);
  return db;
}

function readState(db: string): State {
  const out = childNode(READ_STATE_CHILD, { FIXTURE_DB: db });
  if (out.status !== 0) throw new Error(`could not read the fixture database (status ${out.status})\n${out.stderr}`);
  return JSON.parse(out.stdout) as State;
}

function flagRow(state: State, id: string): FlagRow | undefined {
  return state.flags.find((f) => f.id === id);
}

/** One `os migrate <command> <argv…> --database-url file:<db>` run, in the fixture project. */
function runCommand(command: string, argv: string[], db: string): Promise<Run> {
  const args = ['migrate', command, ...argv, '--database-url', `file:${db}`];
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: dir,
      env: childEnv({
        NO_COLOR: '1',
        OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
        OS_SECRET_KEY: '0e2e'.repeat(16),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`os ${args.join(' ')} did not finish within ${RUN_BUDGET_MS}ms\n${stderr}`));
    }, RUN_BUDGET_MS);
    child.on('error', (err) => { clearTimeout(timer); rejectRun(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

/**
 * The enumeration across the four commands: the census above, as data.
 * `narrowTo` is a declared object the command walks; `flag` is the
 * deployment flag its full-scope `--apply` records, or `null` for none.
 */
const FAMILY = [
  { command: 'value-shapes', narrowTo: 'os21644_site', flag: VALUE_SHAPES_FLAG, apply: true },
  { command: 'files-to-references', narrowTo: 'os21644_product', flag: FILE_REFERENCES_FLAG, apply: true },
  { command: 'summary-nulls', narrowTo: 'os21644_site', flag: null, apply: true },
  { command: 'duplicates', narrowTo: 'os21644_site', flag: null, apply: false },
] as const;
type Member = (typeof FAMILY)[number];

const MISSPELLED = 'os21644_sitee';

interface Outcome {
  db: string;
  run: Run;
  state: State;
}

const narrowed = new Map<string, Outcome>();
const full = new Map<string, Outcome>();
const unknown = new Map<string, Outcome>();
let narrowedAfterFull: Outcome & { verifiedBefore: FlagRow | undefined };
let unknownHuman: Run;
let reproFullDry: Run;
let repro: Outcome;
let reproRightName: Outcome;

/** `--apply --yes --json` where the command has an apply mode; `duplicates` is always JSON and writes nothing. */
function applyArgs(member: Member, ...scope: string[]): string[] {
  return member.apply ? [...scope, '--apply', '--yes', '--json'] : scope;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-21644-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));
  seeded = join(dir, 'data', 'seeded.db');
  const seed = childNode(SEED_CHILD, { FIXTURE_PROJECT: dir, FIXTURE_DB: seeded });
  if (seed.status !== 0 || !seed.stderr.includes('[fixture] seeded')) {
    throw new Error(`the fixture database was not seeded (status ${seed.status})\n${seed.stderr}`);
  }

  for (const member of FAMILY) {
    const narrowDb = freshDb();
    const narrowRun = await runCommand(member.command, applyArgs(member, '--object', member.narrowTo), narrowDb);
    narrowed.set(member.command, { db: narrowDb, run: narrowRun, state: readState(narrowDb) });

    const fullDb = freshDb();
    const fullRun = await runCommand(member.command, applyArgs(member), fullDb);
    full.set(member.command, { db: fullDb, run: fullRun, state: readState(fullDb) });

    const unknownDb = freshDb();
    const unknownRun = await runCommand(member.command, applyArgs(member, '--object', MISSPELLED), unknownDb);
    unknown.set(member.command, { db: unknownDb, run: unknownRun, state: readState(unknownDb) });
  }

  // A narrowed run over a deployment that already earned the flag leaves it as it was.
  const earnedDb = freshDb();
  await runCommand('value-shapes', ['--apply', '--yes', '--json'], earnedDb);
  const verifiedBefore = flagRow(readState(earnedDb), VALUE_SHAPES_FLAG);
  const after = await runCommand('value-shapes', ['--object', 'os21644_site', '--apply', '--yes', '--json'], earnedDb);
  narrowedAfterFull = { db: earnedDb, run: after, state: readState(earnedDb), verifiedBefore };

  unknownHuman = await runCommand('value-shapes', ['--object', MISSPELLED, '--apply', '--yes'], freshDb());

  // The measured repro: one off-shape value stored, then a misspelled --object --apply.
  const reproDb = freshDb();
  const offShape = childNode(OFF_SHAPE_CHILD, { FIXTURE_DB: reproDb });
  if (offShape.status !== 0) throw new Error(`the off-shape value was not written\n${offShape.stderr}`);
  const reproRightDb = join(dir, 'data', 'repro-right.db');
  copyFileSync(reproDb, reproRightDb);
  reproFullDry = await runCommand('value-shapes', ['--json'], reproDb);
  const reproRun = await runCommand('value-shapes', ['--object', MISSPELLED, '--apply', '--yes', '--json'], reproDb);
  repro = { db: reproDb, run: reproRun, state: readState(reproDb) };
  const rightRun = await runCommand('value-shapes', ['--object', 'os21644_site', '--apply', '--yes', '--json'], reproRightDb);
  reproRightName = { db: reproRightDb, run: rightRun, state: readState(reproRightDb) };
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const FLAG_RECORDING = FAMILY.filter((m) => m.flag !== null);

describe('[#21644] a deployment-level flag is written only by a full-scope run', () => {
  it.each(FLAG_RECORDING)('$command: a narrowed --apply exits 0, reports flag null and records no flag', ({ command, flag, narrowTo }) => {
    const { run, state } = narrowed.get(command)!;
    expect(run.code, run.stderr).toBe(0);
    const doc = JSON.parse(run.stdout);
    expect(doc).toMatchObject({ apply: true, gatePassed: true, flag: null, filter: { objects: [narrowTo] } });
    expect(flagRow(state, flag!)).toBeUndefined();
    // The output says why, and names the run that records it.
    expect(run.stderr).toContain(`Narrowed by --object to ${narrowTo}, so no deployment flag was recorded.`);
    expect(run.stderr).toContain(`"os migrate ${command} --apply"`);
  });

  it.each(FLAG_RECORDING)('$command: a full-scope --apply records the flag verified, as before', ({ command, flag }) => {
    const { run, state } = full.get(command)!;
    expect(run.code, run.stderr).toBe(0);
    const doc = JSON.parse(run.stdout);
    expect(doc).toMatchObject({ apply: true, gatePassed: true, filter: null });
    expect(doc.flag).toMatchObject({ id: flag, blocking: 0 });
    expect(doc.flag.verified_at).toBeTruthy();
    expect(flagRow(state, flag!)?.verified_at).toBeTruthy();
  });

  it.each(FAMILY.filter((m) => m.flag === null))('$command: records no flag, narrowed or not, as before', ({ command }) => {
    for (const outcome of [narrowed.get(command)!, full.get(command)!]) {
      expect(outcome.run.code, outcome.run.stderr).toBe(0);
      expect(outcome.state.flags).toEqual([]);
    }
  });

  it('a narrowed --apply leaves a flag an earlier full-scope run recorded exactly as it was', () => {
    const { run, state, verifiedBefore } = narrowedAfterFull;
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ flag: null, filter: { objects: ['os21644_site'] } });
    expect(verifiedBefore?.verified_at).toBeTruthy();
    expect(flagRow(state, VALUE_SHAPES_FLAG)).toEqual(verifiedBefore);
  });

  it('files-to-references: the deployment-wide column step does not run on a narrowed run', () => {
    expect(JSON.parse(narrowed.get('files-to-references')!.run.stdout)).toMatchObject({
      columnMove: null,
      columnsMovedAt: null,
    });
    // The control: over every object it runs, moves the media column and records it.
    const control = JSON.parse(full.get('files-to-references')!.run.stdout);
    expect(control.columnsMovedAt).toBeTruthy();
    expect(control.columnMove.outcomes.map((o: { table: string; status: string }) => [o.table, o.status])).toEqual([
      ['os21644_product', 'moved'],
    ]);
  });
});

describe('[#21644] an unknown --object is an error, never narrowed to nothing', () => {
  it.each(FAMILY)('$command: exits 1 with OBJECT_NOT_FOUND, naming the name and the declared objects', ({ command }) => {
    const { run } = unknown.get(command)!;
    expect(run.code, run.stderr).toBe(1);
    const doc = JSON.parse(run.stdout);
    expect(doc.code).toBe('OBJECT_NOT_FOUND');
    const message = String(doc.detail ?? doc.error);
    expect(message).toContain(`'${MISSPELLED}'`);
    expect(message).toMatch(/Declared objects: [^\n]*os21644_account, os21644_product, os21644_site/);
  });

  it.each(FAMILY)('$command: refused before anything was read or written', ({ command }) => {
    const { run, state } = unknown.get(command)!;
    expect(state.flags).toEqual([]);
    expect(state.product).toEqual([{ id: 'p1', image: null }]);
    // The one document is the refusal, and no report: nothing was scanned.
    // (`duplicates` keeps its own error shape, a token plus `detail`.)
    expect(Object.keys(JSON.parse(run.stdout)).sort()).toEqual(
      command === 'duplicates' ? ['code', 'detail', 'error'] : ['code', 'error'],
    );
  });

  it('human mode: exits 1 and names the unknown object', () => {
    expect(unknownHuman.code, unknownHuman.stderr).toBe(1);
    expect(`${unknownHuman.stdout}\n${unknownHuman.stderr}`).toContain(`Object '${MISSPELLED}' not found`);
  });
});

describe('[#21644] the measured repro: an off-shape value plus a misspelled --object --apply', () => {
  it('the control: a full-scope scan sees the off-shape value and fails the gate', () => {
    expect(reproFullDry.code, reproFullDry.stderr).toBe(1);
    expect(JSON.parse(reproFullDry.stdout)).toMatchObject({ gatePassed: false, scan: { blocking: 1 } });
  });

  it('the misspelled run exits 1 with OBJECT_NOT_FOUND and leaves the flag unrecorded', () => {
    expect(repro.run.code, repro.run.stderr).toBe(1);
    expect(JSON.parse(repro.run.stdout).code).toBe('OBJECT_NOT_FOUND');
    expect(flagRow(repro.state, VALUE_SHAPES_FLAG)).toBeUndefined();
  });

  it('spelled right, the narrowed run finds the value, exits 1, and still records no flag', () => {
    expect(reproRightName.run.code, reproRightName.run.stderr).toBe(1);
    expect(JSON.parse(reproRightName.run.stdout)).toMatchObject({ gatePassed: false, flag: null, scan: { blocking: 1 } });
    expect(flagRow(reproRightName.state, VALUE_SHAPES_FLAG)).toBeUndefined();
  });
});
