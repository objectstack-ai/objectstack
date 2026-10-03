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
 * ## The run's identity survives its own progress (#21528)
 *
 * `recorded-by`'s `load()` selects only the rows still holding the sentinel,
 * so it shrinks as the run commits chunks, and the plan the owner registers
 * for resume carries the default chunk size, not the one the run was started
 * with. Both used to change the chunk plan a resume recomputed, and the
 * runner refused `PLAN_CHANGED` a run the list had just called resumable.
 * Three more interrupted runs, made the same way:
 *
 *  4. killed in chunk 1 after chunk 0 committed (203 rows at the default
 *     size): it resumes to completion, and chunk 0 is not run again;
 *  5. started with a chunk size of 2 (the `--chunk-size 2` an operator
 *     passes) and killed in chunk 0: it resumes with the journal's size, two
 *     chunks, not the one chunk the registered plan's default would make;
 *  6. the control: a run started by a plan whose step had another name — a
 *     changed plan — is still refused `PLAN_CHANGED`, and nothing is written.
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
 * forward that runs the owner's forward for every chunk before
 * `FIXTURE_KILL_CHUNK` and kills the process from inside that chunk's
 * transaction. The plan keeps the owner's id; `FIXTURE_CHUNK_SIZE` starts it
 * at another size, as `--chunk-size` does, and `FIXTURE_STEP_NAME` renames its
 * step, which makes it a different plan from the one the owner registers.
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
const chunkSize = process.env.FIXTURE_CHUNK_SIZE ? Number(process.env.FIXTURE_CHUNK_SIZE) : undefined;
const killChunk = Number(process.env.FIXTURE_KILL_CHUNK ?? '0');
const owned = mp.createRecordedBySentinelPlan(chunkSize === undefined ? {} : { chunkSize });
const step = owned.steps[0];
const crashing = { ...owned, steps: [{
  ...step,
  ...(process.env.FIXTURE_STEP_NAME ? { name: process.env.FIXTURE_STEP_NAME } : {}),
  forward: async (rows, ctx, engine) => {
    if (ctx.chunkIndex !== killChunk) return step.forward(rows, ctx, engine);
    process.stderr.write('[fixture] run ' + ctx.runId + ' killed in chunk ' + ctx.chunkIndex + '\\n');
    process.kill(process.pid, 'SIGKILL');
    await new Promise(() => {});
  },
}] };
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

interface InterruptedFixture {
  /** The interrupted run's id, as the killed child printed it. */
  runId: string;
  /** The database the crash left behind. Copy it; never resume over it. */
  origin: ProjectCopy;
}

/**
 * Seed `ids` as sentinel rows and kill a recorded-by run in chunk `killChunk`.
 * See `CRASH_CHILD` for what the other two options change about the run.
 */
function interruptRun(
  name: string,
  ids: readonly string[],
  opts: { killChunk?: number; chunkSize?: number; stepName?: string } = {},
): InterruptedFixture {
  const origin = makeProject(root, name);
  const killChunk = opts.killChunk ?? 0;
  const crash = spawnSync(process.execPath, ['--input-type=module', '-e', CRASH_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({
      OS_ARTIFACT_PATH: join(origin.dir, 'dist', 'objectstack.json'),
      FIXTURE_PROJECT: origin.dir,
      FIXTURE_DB: origin.dbFile,
      FIXTURE_IDS: JSON.stringify(ids),
      FIXTURE_SENTINEL: RECORDED_BY_SENTINEL,
      FIXTURE_KILL_CHUNK: String(killChunk),
      FIXTURE_CHUNK_SIZE: opts.chunkSize === undefined ? undefined : String(opts.chunkSize),
      FIXTURE_STEP_NAME: opts.stepName,
    }),
    encoding: 'utf8',
    timeout: CHILD_BUDGET_MS,
  });
  const killed = new RegExp(`\\[fixture\\] run (\\S+) killed in chunk ${killChunk}\\b`).exec(crash.stderr ?? '');
  if (crash.signal !== 'SIGKILL' || !killed) {
    throw new Error(
      `the fixture '${name}' did not leave an interrupted run (status ${crash.status}, signal ${crash.signal})\n${crash.stderr}`,
    );
  }
  return { runId: killed[1], origin };
}

/** A fresh copy of the database a crash left behind. */
function copyOf(fixture: InterruptedFixture, name: string): ProjectCopy {
  const copy = makeProject(root, name);
  cpSync(join(fixture.origin.dir, 'data'), join(copy.dir, 'data'), { recursive: true });
  return copy;
}

/** Each `argv` through the real `os migrate resume --json`, in order, over `project`. */
async function resumeOver(project: ProjectCopy, ...argvs: string[][]): Promise<Array<{ payload: any; exitCode: number }>> {
  const out: Array<{ payload: any; exitCode: number }> = [];
  const savedEnv: Record<string, string | undefined> = {};
  const savedCwd = process.cwd();
  for (const key of [...OVERRIDING_ENV, 'OS_ARTIFACT_PATH'] as const) savedEnv[key] = process.env[key];
  try {
    for (const key of OVERRIDING_ENV) delete process.env[key];
    process.env.OS_ARTIFACT_PATH = join(project.dir, 'dist', 'objectstack.json');
    process.chdir(project.dir);
    const url = `file:${project.dbFile}`;
    for (const argv of argvs) out.push(await resumeJson([...argv, '--database-url', url]));
  } finally {
    process.chdir(savedCwd);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return out;
}

/** Journal kinds and chunk indices of one run, in `seq` order. */
async function journalOf(dbFile: string, id: string): Promise<Array<{ kind: string; chunk_index: number | null }>> {
  return readRows(dbFile, 'SELECT kind, chunk_index FROM sys_migration_journal WHERE run_id = ? ORDER BY seq', [id]);
}

/** How many of `ids` still hold the sentinel. */
async function sentinelCount(dbFile: string, ids: readonly string[]): Promise<number> {
  const rows = await readRows(
    dbFile,
    `SELECT COUNT(*) AS n FROM sys_metadata_history WHERE recorded_by = ? AND id IN (${ids.map(() => '?').join(', ')})`,
    [RECORDED_BY_SENTINEL, ...ids],
  );
  return Number(rows[0].n);
}

/** One more row than the default chunk size holds, plus two: chunk 0 is 200 rows, chunk 1 is 3. */
const COMMITTED_IDS = Array.from({ length: 203 }, (_, i) => `h_21528_c${String(i).padStart(3, '0')}`);
const SIZED_IDS = ['h_21528_s_a', 'h_21528_s_b', 'h_21528_s_c'];
const CHANGED_IDS = ['h_21528_x_a', 'h_21528_x_b', 'h_21528_x_c'];

let root: string;
let runId: string;
let resumeList: { payload: any; exitCode: number };
let resumeAct: { payload: any; exitCode: number };
let resumed: ProjectCopy;
let scanOutput: string;
let freshOutput: string;

/** The #21528 runs: each fixture, its resumed copy, and what list and act answered. */
interface ResumedFixture extends InterruptedFixture {
  copy: ProjectCopy;
  list?: { payload: any; exitCode: number };
  act: { payload: any; exitCode: number };
}
let afterCommit: ResumedFixture;
let sized: ResumedFixture;
let changed: ResumedFixture;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-21498-'));

  // ── the crash ──────────────────────────────────────────────────────────────
  const interrupted = interruptRun('origin', SENTINEL_IDS);
  runId = interrupted.runId;

  // Each consumer gets its own copy: a resume concludes the run, a serve boot
  // writes rows of its own.
  resumed = copyOf(interrupted, 'resumed');
  const scanned = copyOf(interrupted, 'scanned');
  const fresh = makeProject(root, 'fresh');

  // ── 1. the real command ────────────────────────────────────────────────────
  [resumeList, resumeAct] = await resumeOver(resumed, [], ['--run', runId, '--yes']);

  // ── 2 and 3. the real serve boot ───────────────────────────────────────────
  scanOutput = await serveBoot(scanned);
  freshOutput = await serveBoot(fresh);

  // ── 4, 5 and 6. runs whose recomputed chunk plan differs (#21528) ───────────
  const resumeFixture = async (
    fixture: InterruptedFixture,
    name: string,
    withList: boolean,
  ): Promise<ResumedFixture> => {
    const copy = copyOf(fixture, name);
    const act = ['--run', fixture.runId, '--yes'];
    if (!withList) return { ...fixture, copy, act: (await resumeOver(copy, act))[0] };
    const [list, done] = await resumeOver(copy, [], act);
    return { ...fixture, copy, list, act: done };
  };
  afterCommit = await resumeFixture(interruptRun('after-commit', COMMITTED_IDS, { killChunk: 1 }), 'after-commit-resumed', true);
  sized = await resumeFixture(interruptRun('sized', SIZED_IDS, { chunkSize: 2 }), 'sized-resumed', true);
  changed = await resumeFixture(
    interruptRun('changed', CHANGED_IDS, { stepName: 'sys_metadata_history.recorded_by: an earlier step' }),
    'changed-resumed',
    false,
  );
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

describe("os migrate resume completes a recorded-by run whose remaining rows shrank or whose chunk size was not the default (#21528)", () => {
  it('lists a run killed after a committed chunk as resumable, chunk 0 known committed', () => {
    const listed = afterCommit.list!.payload.interrupted.find((r: any) => r.runId === afterCommit.runId);
    expect(listed, JSON.stringify(afterCommit.list!.payload)).toBeDefined();
    expect(listed.committedChunks).toEqual([0]);
    expect(listed.unknownChunks).toEqual([1]);
    expect(listed.resumable).toBe(true);
  });

  it('resumes that run to completion without running its committed chunk again', async () => {
    expect(afterCommit.act.exitCode, JSON.stringify(afterCommit.act.payload)).toBe(0);
    expect(afterCommit.act.payload).toMatchObject({
      runId: afterCommit.runId, status: 'completed', chunksTotal: 2, chunksCommitted: 2,
    });
    expect(await sentinelCount(afterCommit.copy.dbFile, COMMITTED_IDS)).toBe(0);

    const journal = await journalOf(afterCommit.copy.dbFile, afterCommit.runId);
    // Chunk 0 committed before the kill and is started exactly once; chunk 1
    // is started by the killed run and again by the resume.
    expect(journal.filter((e) => e.kind === 'chunk_started').map((e) => e.chunk_index)).toEqual([0, 1, 1]);
    expect(journal.filter((e) => e.kind === 'chunk_done').map((e) => e.chunk_index)).toEqual([0, 1]);
    expect(journal.at(-1)!.kind).toBe('run_done');
  });

  it('lists a run started with a chunk size of 2 as resumable', () => {
    const listed = sized.list!.payload.interrupted.find((r: any) => r.runId === sized.runId);
    expect(listed, JSON.stringify(sized.list!.payload)).toBeDefined();
    expect(listed.unknownChunks).toEqual([0]);
    expect(listed.resumable).toBe(true);
  });

  it('resumes that run with the chunk size it started with, from the journal', async () => {
    expect(sized.act.exitCode, JSON.stringify(sized.act.payload)).toBe(0);
    // Three rows at size 2 are two chunks; the registered plan's default size
    // would have made one.
    expect(sized.act.payload).toMatchObject({
      runId: sized.runId, status: 'completed', chunksTotal: 2, chunksCommitted: 2,
    });
    expect(await sentinelCount(sized.copy.dbFile, SIZED_IDS)).toBe(0);
    const journal = await journalOf(sized.copy.dbFile, sized.runId);
    expect(journal.filter((e) => e.kind === 'chunk_done').map((e) => e.chunk_index)).toEqual([0, 1]);
    expect(journal.at(-1)!.kind).toBe('run_done');
  });

  it('still refuses PLAN_CHANGED a run another plan started (the control), and writes nothing', async () => {
    expect(changed.act.exitCode, JSON.stringify(changed.act.payload)).toBe(1);
    expect(changed.act.payload.error).toMatch(/^Refused \(PLAN_CHANGED\)/);
    expect(await sentinelCount(changed.copy.dbFile, CHANGED_IDS)).toBe(CHANGED_IDS.length);
    expect((await journalOf(changed.copy.dbFile, changed.runId)).map((e) => e.kind)).toEqual([
      'run_started', 'chunk_started',
    ]);
  });
});
