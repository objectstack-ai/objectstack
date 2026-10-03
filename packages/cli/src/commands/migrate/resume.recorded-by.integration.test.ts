// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21498] An interrupted `os migrate recorded-by` run resumes to completion
 * through `os migrate resume --run … --yes`, and an `os serve` boot over that
 * run reports it through the journal scan.
 *
 * ## The measured defect
 *
 * `MigrationRecoveryPlugin` owns the `migration-plans` registry and the boot
 * scan, and nothing composed it. So `recorded-by`'s `plans.register()` landed
 * in its no-registry `catch`, `os migrate resume` found no plan for any run and
 * refused with "no loaded package registers" it — while the plan's owner,
 * `@objectstack/metadata-protocol`, was loaded in that very process — and a
 * serve boot ran no scan at all. Measured at the public door on `25797a16e1`:
 * the list answered `resumable: false`, `--run … --yes` exited 1 with that
 * refusal, and a served boot over the run printed nothing about it.
 *
 * ## What is pinned
 *
 * One interrupted run, made the way a crash makes one: a child process runs
 * the recorded-by plan under the real journal runner and is SIGKILLed inside
 * chunk 0's transaction, leaving `run_started` + `chunk_started(0)` and the
 * sentinel rows untouched. Then, each against its own copy of that database:
 *
 *  1. the REAL command (oclif parse, boot, journal read): the list reports the
 *     run `resumable: true`, and `--run <id> --yes` completes it — exit 0,
 *     status `completed`, no row left holding the sentinel, `run_done`
 *     journalled;
 *  2. the REAL `os serve` (spawned, as `os start` / `os dev` spawn it) reports
 *     the run at boot with the resume command, which means the plan's owner
 *     registered it before the scan read the registry;
 *  3. the control for 2: `os serve` over a fresh database is silent — the scan
 *     composed into every served boot adds no line when there is nothing to
 *     report.
 *
 * ⛔ The interruption is in chunk 0, before any chunk committed. A run that
 * had committed a chunk is refused `PLAN_CHANGED` on resume — `recorded-by`'s
 * `load()` selects only rows still holding the sentinel, so the chunk plan it
 * recomputes no longer hashes to the one the journal recorded. That is a
 * defect of the plan's shape, not of this composition, and it is reported on
 * its own; this file does not pin around it.
 *
 * Every boot runs in a hook: a case only reads what a boot printed or wrote.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { RECORDED_BY_SENTINEL, RECORDED_BY_SENTINEL_PLAN_ID } from '@objectstack/metadata-protocol';
import MigrateResume from './resume.js';
import { isExitSignal } from '../../utils/format.js';

// Pay the first transform of this dist-resolved workspace dep at MODULE LOAD:
// the command's boot reaches it through a dynamic `import()`.
import '@objectstack/runtime';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 300_000;
const CHILD_BUDGET_MS = 120_000;

const ARTIFACT = {
  manifest: { id: 'com.example.resume-21498', name: 'Resume 21498', version: '0.0.0', type: 'app' },
  objects: [{ name: 'rz_note', fields: { name: { type: 'text' } } }],
};

/** Three history rows holding the sentinel — one chunk at the plan's default size. */
const SENTINEL_IDS = ['h_21498_a', 'h_21498_b', 'h_21498_c'];

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
 * The crash. Boots the data stack over the fixture database, writes the
 * sentinel rows, then runs the recorded-by plan under the real runner with a
 * forward that kills the process from inside chunk 0's transaction. The plan
 * keeps the owner's id, step names and chunk size, so the journal records the
 * hash the owner's registered plan computes on resume.
 */
const CRASH_CHILD = `
const rt = await import('@objectstack/runtime');
const core = await import('@objectstack/core');
const mp = await import('@objectstack/metadata-protocol');
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
const at = new Date().toISOString();
const ids = JSON.parse(process.env.FIXTURE_IDS);
for (const [i, id] of ids.entries()) {
  await ql.insert('sys_metadata_history', {
    id, event_seq: i + 1, name: 'rz_' + i, type: 'object', version: 1,
    operation_type: 'create', recorded_by: process.env.FIXTURE_SENTINEL, recorded_at: at,
  }, { context: { isSystem: true } });
}
const owned = mp.createRecordedBySentinelPlan();
const step = owned.steps[0];
const crashing = { ...owned, steps: [{ ...step, forward: async (_rows, ctx) => {
  process.stderr.write('[fixture] run ' + ctx.runId + ' killed in chunk ' + ctx.chunkIndex + '\\n');
  process.kill(process.pid, 'SIGKILL');
  await new Promise(() => {});
} }] };
await core.runMigrationJournal(ql, crashing);
process.stderr.write('[fixture] the run finished, so nothing was interrupted\\n');
process.exit(3);
`;

interface ProjectCopy {
  dir: string;
  dbFile: string;
}

function makeProject(root: string, name: string): ProjectCopy {
  const dir = join(root, name);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));
  return { dir, dbFile: join(dir, 'data', 'app.db') };
}

/** `os serve` over a project, until its ready banner (or exit); never left running. */
function serveBoot(project: ProjectCopy): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const port = String(41000 + Math.floor(Math.random() * 18000));
    const child = spawn(process.execPath, [CLI, 'serve', '--port', port, '--no-ui', '--log-level', 'warn'], {
      cwd: project.dir,
      env: childEnv({
        NO_COLOR: '1',
        OS_ARTIFACT_PATH: join(project.dir, 'dist', 'objectstack.json'),
        OS_DATABASE_URL: `file:${project.dbFile}`,
        OS_LOG_LEVEL: undefined,
        OS_DISABLE_CONSOLE: '1',
        // The fixed key `serve-process.ts` hands its children, so no boot mints
        // and persists a crypto key into this runner's home directory.
        OS_SECRET_KEY: '0e2e'.repeat(16),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      if (err) rejectRun(err);
      else resolveRun(output);
    };
    const timer = setTimeout(
      () => finish(new Error(`os serve did not reach its ready banner in time\n${output}`)),
      HOOK_TIMEOUT_MS - 30_000,
    );
    const onData = (chunk: unknown) => {
      output += String(chunk);
      if (/Press Ctrl\+C to stop/.test(output)) finish();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => finish(err));
    child.on('exit', () => finish());
  });
}

/** Run `os migrate resume` in-process and capture its one `--json` document. */
async function resumeJson(argv: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let thrownExit: number | undefined;
  try {
    try {
      await MigrateResume.run([...argv, '--json'], { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    return { payload: JSON.parse(out), exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

/** Rows of the fixture database, read on a connection of our own. */
async function readRows(dbFile: string, sql: string, bindings: unknown[] = []): Promise<any[]> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    return await (driver as any).knex.raw(sql, bindings);
  } finally {
    await driver.disconnect();
  }
}

let root: string;
let runId: string;
let resumeList: { payload: any; exitCode: number };
let resumeAct: { payload: any; exitCode: number };
let resumed: ProjectCopy;
let scanOutput: string;
let freshOutput: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-21498-'));
  const origin = makeProject(root, 'origin');

  // ── the crash ──────────────────────────────────────────────────────────────
  const crash = spawnSync(process.execPath, ['--input-type=module', '-e', CRASH_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({
      OS_ARTIFACT_PATH: join(origin.dir, 'dist', 'objectstack.json'),
      FIXTURE_PROJECT: origin.dir,
      FIXTURE_DB: origin.dbFile,
      FIXTURE_IDS: JSON.stringify(SENTINEL_IDS),
      FIXTURE_SENTINEL: RECORDED_BY_SENTINEL,
    }),
    encoding: 'utf8',
    timeout: CHILD_BUDGET_MS,
  });
  const killed = /\[fixture\] run (\S+) killed in chunk 0/.exec(crash.stderr ?? '');
  if (crash.signal !== 'SIGKILL' || !killed) {
    throw new Error(
      `the fixture did not leave an interrupted run (status ${crash.status}, signal ${crash.signal})\n${crash.stderr}`,
    );
  }
  runId = killed[1];

  // Each consumer gets its own copy: a resume concludes the run, a serve boot
  // writes rows of its own.
  resumed = makeProject(root, 'resumed');
  const scanned = makeProject(root, 'scanned');
  cpSync(join(origin.dir, 'data'), join(resumed.dir, 'data'), { recursive: true });
  cpSync(join(origin.dir, 'data'), join(scanned.dir, 'data'), { recursive: true });
  const fresh = makeProject(root, 'fresh');

  // ── 1. the real command ────────────────────────────────────────────────────
  const savedEnv: Record<string, string | undefined> = {};
  const savedCwd = process.cwd();
  for (const key of [...OVERRIDING_ENV, 'OS_ARTIFACT_PATH'] as const) savedEnv[key] = process.env[key];
  try {
    for (const key of OVERRIDING_ENV) delete process.env[key];
    process.env.OS_ARTIFACT_PATH = join(resumed.dir, 'dist', 'objectstack.json');
    process.chdir(resumed.dir);
    const url = `file:${resumed.dbFile}`;
    resumeList = await resumeJson(['--database-url', url]);
    resumeAct = await resumeJson(['--run', runId, '--yes', '--database-url', url]);
  } finally {
    process.chdir(savedCwd);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  // ── 2 and 3. the real serve boot ───────────────────────────────────────────
  scanOutput = await serveBoot(scanned);
  freshOutput = await serveBoot(fresh);
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('os migrate resume completes an interrupted recorded-by run (#21498)', () => {
  it('lists the run as resumable — its plan is registered in the resume boot', () => {
    expect(resumeList.exitCode).toBe(0);
    const listed = resumeList.payload.interrupted.find((r: any) => r.runId === runId);
    expect(listed, JSON.stringify(resumeList.payload)).toBeDefined();
    expect(listed.planId).toBe(RECORDED_BY_SENTINEL_PLAN_ID);
    expect(listed.committedChunks).toEqual([]);
    expect(listed.unknownChunks).toEqual([0]);
    expect(listed.resumable).toBe(true);
  });

  it('--run <id> --yes resumes it to completion and converts every sentinel row', async () => {
    expect(resumeAct.exitCode, JSON.stringify(resumeAct.payload)).toBe(0);
    expect(resumeAct.payload.runId).toBe(runId);
    expect(resumeAct.payload.status).toBe('completed');

    const rows = await readRows(
      resumed.dbFile,
      `SELECT id, recorded_by FROM sys_metadata_history WHERE id IN (${SENTINEL_IDS.map(() => '?').join(', ')}) ORDER BY id`,
      SENTINEL_IDS,
    );
    expect(rows.map((r) => r.id)).toEqual([...SENTINEL_IDS].sort());
    expect(rows.every((r) => r.recorded_by === null), JSON.stringify(rows)).toBe(true);

    const kinds = (await readRows(
      resumed.dbFile,
      'SELECT kind FROM sys_migration_journal WHERE run_id = ? ORDER BY seq',
      [runId],
    )).map((r) => r.kind);
    expect(kinds[0]).toBe('run_started');
    expect(kinds.at(-1)).toBe('run_done');
  });
});

describe('os serve reports an interrupted run through the boot scan (#21498)', () => {
  it('names the run and the command that resumes it', () => {
    const lines = scanOutput.split('\n').filter((l) => l.includes(`'${runId}'`));
    expect(lines, scanOutput).toHaveLength(1);
    expect(lines[0]).toContain(`plan '${RECORDED_BY_SENTINEL_PLAN_ID}'`);
    // The owner registered the plan before the scan read the registry.
    expect(lines[0]).toContain(`Resume with: os migrate resume --run ${runId}`);
  });

  it('is silent on a fresh database (the control)', () => {
    expect(freshOutput, freshOutput).toMatch(/Press Ctrl\+C to stop/);
    expect(freshOutput).not.toMatch(/interrupted migration/i);
    expect(freshOutput).not.toMatch(/journal scan failed/i);
  });
});
