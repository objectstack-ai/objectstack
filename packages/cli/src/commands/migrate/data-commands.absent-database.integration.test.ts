// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21529] `os migrate resume`, `os migrate recorded-by` and `os migrate
 * value-shapes` answer a project whose database does not exist yet with empty
 * work and exit 0, the answer each gives a booted database with nothing to do.
 *
 * ## The measured defect
 *
 * Each command's default mode boots read-only: the SQL driver defers every
 * table's DDL, and a missing sqlite file is opened as an empty in-memory
 * stand-in. Each then read the very tables its boot had just deferred, so on a
 * fresh project (measured at the public door, base `49161683fb`):
 *
 *  - `resume --json` exited 1 with "The database refused to run this query for
 *    object 'sys_migration_journal'";
 *  - `recorded-by --json` exited 1 the same way for `sys_metadata_history`;
 *  - `value-shapes --json` exited 1 with every covered object "unreadable" and
 *    the gate closed, over data that does not exist;
 *  - and every one of those boots also logged "Migration journal scan failed"
 *    from `MigrationRecoveryPlugin`'s scan of the same absent journal.
 *
 * ## The answer pinned
 *
 * "Not asked": the read-only boot already measured which tables are absent
 * (the deferred sync lists them as `create_table`, decided by `hasTable`), so
 * a command does not read them. The documented exit for empty work is 0 — an
 * `os migrate` subcommand's `--json` success exits 0 (the platform checklist's
 * migrate item), and for `value-shapes` a clean scan exits 0
 * (`content/docs/deployment/cli.mdx`) — and it is the exit each command gives
 * the booted control below.
 *
 * Per command, on the absent database: exit 0, the empty-work document, no
 * read of its own tables refused, no journal-scan warning, no file created.
 * Human mode says the table is not there yet rather than implying it looked.
 *
 * ## The control
 *
 * A booted database holding one row of work for each command: a journalled
 * run that never concluded, a history row still carrying the sentinel, and an
 * app record with a covered field. Each command READS it and reports it. A
 * fix that answered empty work without looking would fail here.
 *
 * Every spawn runs in the hook; a case only reads what a run printed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 480_000;
const RUN_BUDGET_MS = 120_000;

const ARTIFACT = {
  manifest: { id: 'com.example.os21529', name: 'Absent database', version: '0.0.0', type: 'app' },
  objects: [
    { name: 'os21529_account', fields: { name: { type: 'text' } } },
    // A lookup is a covered value class, so `value-shapes` walks this object.
    {
      name: 'os21529_contact',
      fields: { name: { type: 'text' }, account: { type: 'lookup', reference: 'os21529_account' } },
    },
  ],
};

/** The interrupted run the control's journal holds. */
const RUN_ID = 'run_21529_control';

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

/**
 * This process's environment for a child, minus the families
 * `test/helpers/serve-process.ts` `childEnv()` strips (its header says why).
 * An `undefined` override unsets a variable.
 */
function childEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  const unset: Record<string, undefined> = {};
  for (const key of OVERRIDING_ENV) unset[key] = undefined;
  return { ...env, ...unset, ...overrides };
}

/**
 * The control's database: a served-shape boot (DDL performed) of the same data
 * stack the commands compose, then one row of work for each command.
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
await ql.insert('sys_metadata_history', {
  id: 'h_21529', event_seq: 1, name: 'os21529_note', type: 'object', version: 1,
  operation_type: 'create', recorded_by: 'system', recorded_at: new Date().toISOString(),
}, SYSTEM);
await ql.insert('sys_migration_journal', {
  run_id: process.env.FIXTURE_RUN, seq: 0, kind: 'run_started', plan_hash: 'h',
  detail: JSON.stringify({ planId: 'plan_21529' }),
}, SYSTEM);
await ql.insert('sys_migration_journal', {
  run_id: process.env.FIXTURE_RUN, seq: 1, kind: 'chunk_started', chunk_index: 0,
}, SYSTEM);
const account = await ql.insert('os21529_account', { name: 'Acme' }, SYSTEM);
await ql.insert('os21529_contact', { name: 'Ann', account: account.id }, SYSTEM);
await kernel.shutdown();
process.stderr.write('[fixture] seeded\\n');
process.exit(0);
`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

let dir: string;
let absentDb: string;
let bootedDb: string;

function runCommand(command: string, extra: string[], dbFile: string): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [CLI, 'migrate', command, ...extra, '--database-url', `file:${dbFile}`],
      {
        cwd: dir,
        env: childEnv({
          NO_COLOR: '1',
          OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
          // The fixed key `serve-process.ts` hands its children, so no boot
          // mints and persists a crypto key into this runner's home directory.
          OS_SECRET_KEY: '0e2e'.repeat(16),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`os migrate ${command} did not finish within ${RUN_BUDGET_MS}ms\n${stderr}`));
    }, RUN_BUDGET_MS);
    child.on('error', (err) => { clearTimeout(timer); rejectRun(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

const COMMANDS = ['resume', 'recorded-by', 'value-shapes'] as const;
type CommandName = (typeof COMMANDS)[number];

/** The tables each command reads for its answer — the ones its boot defers on a fresh project. */
const OWN_TABLES: Record<CommandName, readonly string[]> = {
  resume: ['sys_migration_journal'],
  'recorded-by': ['sys_metadata_history'],
  // The objects with a covered field: the scan walks each.
  'value-shapes': ['os21529_contact', 'sys_metadata', 'sys_view_definition'],
};

const absentJson = {} as Record<CommandName, Run>;
const absentHuman = {} as Record<CommandName, Run>;
const bootedJson = {} as Record<CommandName, Run>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-21529-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));
  absentDb = join(dir, 'data', 'absent.db');
  bootedDb = join(dir, 'data', 'booted.db');

  const seed = spawnSync(process.execPath, ['--input-type=module', '-e', SEED_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({
      OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
      OS_SECRET_KEY: '0e2e'.repeat(16),
      FIXTURE_PROJECT: dir,
      FIXTURE_DB: bootedDb,
      FIXTURE_RUN: RUN_ID,
    }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  if (seed.status !== 0 || !String(seed.stderr).includes('[fixture] seeded')) {
    throw new Error(`the control database was not seeded (status ${seed.status})\n${seed.stderr}`);
  }

  for (const command of COMMANDS) {
    absentJson[command] = await runCommand(command, ['--json'], absentDb);
    absentHuman[command] = await runCommand(command, [], absentDb);
    bootedJson[command] = await runCommand(command, ['--json'], bootedDb);
  }
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Lines, on either stream, where a read of one of `tables` was refused. */
function refusedReads(run: Run, tables: readonly string[]): string[] {
  return `${run.stdout}\n${run.stderr}`
    .split('\n')
    .filter((line) => /refused to run this query|cannot read/.test(line))
    .filter((line) => tables.some((t) => line.includes(`'${t}'`) || line.includes(`read ${t} `)));
}

function journalScanWarnings(run: Run): string[] {
  return `${run.stdout}\n${run.stderr}`.split('\n').filter((line) => /journal scan failed/i.test(line));
}

describe('[#21529] on a database that does not exist yet: empty work, exit 0', () => {
  it.each(COMMANDS)('%s: reads none of its own tables, and the boot scan does not warn', (command) => {
    for (const run of [absentJson[command], absentHuman[command]]) {
      expect(refusedReads(run, OWN_TABLES[command]), run.stderr).toEqual([]);
      expect(journalScanWarnings(run)).toEqual([]);
    }
    // Still a read-only boot: no database file was brought into existence.
    expect(existsSync(absentDb)).toBe(false);
  });

  it('resume --json: no interrupted runs, exit 0', () => {
    const run = absentJson.resume;
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ interrupted: [], count: 0 });
  });

  it('recorded-by --json: nothing to convert, exit 0', () => {
    const run = absentJson['recorded-by'];
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      planId: 'metadata.recorded-by-sentinel-to-null',
      sentinel: 'system',
      pending: 0,
      applied: false,
    });
  });

  it('value-shapes --json: a clean, complete scan of zero records, exit 0', () => {
    const run = absentJson['value-shapes'];
    expect(run.code, run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout);
    expect(payload).toMatchObject({ apply: false, gatePassed: true, flag: null });
    expect(payload.scan).toMatchObject({ scannedRecords: 0, blocking: 0, truncated: false, unreadableObjects: [] });
    // The objects were in scope, and answered from the measurement rather than a read.
    expect(payload.scan.scannedObjects).toContain('os21529_contact');
    expect(run.stderr).toMatch(/have no table in this database yet[^\n]*os21529_contact/);
  });

  it('human mode says the table is not there yet, exit 0', () => {
    expect(absentHuman.resume.code, absentHuman.resume.stderr).toBe(0);
    expect(absentHuman.resume.stdout).toContain('No interrupted migration runs — this database has no sys_migration_journal table yet');
    expect(absentHuman['recorded-by'].code, absentHuman['recorded-by'].stderr).toBe(0);
    expect(absentHuman['recorded-by'].stdout).toContain('this database has no such table yet, so there is nothing to convert');
    expect(absentHuman['value-shapes'].code, absentHuman['value-shapes'].stderr).toBe(0);
    expect(absentHuman['value-shapes'].stdout).toMatch(/have no table in this database yet[^\n]*os21529_contact/);
    expect(absentHuman['value-shapes'].stdout).toContain('Scan clean');
  });
});

describe('[#21529] the control: a booted database is read, and its work is reported', () => {
  it('resume --json lists the interrupted run, exit 0', () => {
    const run = bootedJson.resume;
    expect(run.code, run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout);
    expect(payload.count).toBe(1);
    expect(payload.interrupted.map((r: { runId: string }) => r.runId)).toEqual([RUN_ID]);
  });

  it('recorded-by --json counts the sentinel row, exit 0', () => {
    const run = bootedJson['recorded-by'];
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ pending: 1, applied: false });
  });

  it('value-shapes --json walks the stored record, exit 0', () => {
    const run = bootedJson['value-shapes'];
    expect(run.code, run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout);
    expect(payload.gatePassed).toBe(true);
    expect(payload.scan.scannedRecords).toBeGreaterThanOrEqual(1);
    expect(payload.scan.unreadableObjects).toEqual([]);
    expect(run.stderr).not.toMatch(/have no table in this database yet/);
  });

  it.each(COMMANDS)('%s: the boot scan does not warn here either', (command) => {
    expect(journalScanWarnings(bootedJson[command])).toEqual([]);
  });
});
