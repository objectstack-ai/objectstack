// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21489 — a package's job BODIES run on every door that brings an artifact
 * in, and install-local refuses the one job shape no JSON door can run.
 *
 * ## The defect, measured at this door before the fix
 *
 * A job's runnable code was only ever a `handler`: the name of a
 * `defineStack({ functions })` entry, whose callable travels in the artifact's
 * runtime module, which only `os start --artifact` imports. So a package
 * installed with `os package install` into a running platform:
 *
 *   - declaring a job with a sandboxed `body` (`JobSchema.body`, the hook body
 *     shape) was never scheduled — not hot, not after a restart, and not even
 *     on an `--artifact` boot, because the boot resolved `handler` alone;
 *   - declaring a job with only a `handler` installed "successfully" and was
 *     never scheduled either — the install answered 200 and nothing said the
 *     job would never run.
 *
 * ## What each `it` reads
 *
 * One host runtime (`requires: ['job']`, package scheduled work switched on),
 * three boots:
 *
 *   1. INSTALL — the body-job package installs and its body runs on its
 *      schedule (the rows it writes appear); the handler-only package is
 *      REFUSED by the install door with its code and remedy, and nothing of it
 *      is installed;
 *   2. RESTART — same home: the ledger rehydrate schedules the body job again
 *      (new rows appear after the restart);
 *   3. CONTROL — `os start --artifact` of one artifact carrying a body job and
 *      a handler job (with its runtime module): both run.
 *
 * Every reading goes through a door a user uses: the CLI's own output and exit
 * code for the install, the data route for the rows a job wrote.
 *
 * ## Spawn shape
 *
 * Shared with `package-install-local-handlers.integration.test.ts` (#21321)
 * and `package-install-local-boot-steps.integration.test.ts` (#21322): the tsx
 * source entry, one process group per `os start`, every workspace package —
 * `@objectstack/runtime` and `@objectstack/cloud-connection` included —
 * resolved through its `exports` to `dist/`, so an ablation of either
 * package's source reaches this file only after that package is rebuilt.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI,
  childEnv,
  E2E_SECRET_KEY,
  portContentionError,
  portDriftError,
  probeThroughChild,
  randomPort,
  TSX,
} from './helpers/serve-process.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
/** How long a phase waits for a 1-second interval job to have written a row. */
const RUN_WAIT_MS = 20_000;

/** The development dev-admin seed — see the #21321 sibling for why it is the operator on every boot. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

const BODY_APP_ID = 'com.example.jobsapp';
const BODY_TICK = 'jobs_app_tick';
const BODY_JOB = 'jobs_app_tick_body';

const HANDLER_APP_ID = 'com.example.handlerjobs';
const HANDLER_TICK = 'handler_jobs_tick';
const HANDLER_JOB = 'handler_jobs_tick_handler';

/** A job with a sandboxed body that writes one row per run into `object`. */
function bodyJob(name: string, object: string) {
  return {
    name,
    schedule: { type: 'interval', intervalMs: 1000 },
    body: {
      language: 'js',
      capabilities: ['api.write'],
      source: `await ctx.api.object('${object}').insert({ name: '${name}' });`,
    },
    timeoutMs: 10_000,
    enabled: true,
  };
}

/** A job whose code is a function NAME only — the deprecated form. */
function handlerJob(name: string) {
  return { name, schedule: { type: 'interval', intervalMs: 1000 }, handler: 'tick', enabled: true };
}

function tickObject(name: string) {
  return {
    name,
    label: 'Tick',
    sharingModel: 'public_read_write',
    fields: { name: { type: 'text', label: 'Name' } },
  };
}

/** The body-job package, as `os build` writes `dist/objectstack.json` (schema defaults trimmed). */
const BODY_ARTIFACT = {
  manifest: { id: BODY_APP_ID, namespace: 'jobs_app', version: '0.1.0', type: 'app', name: 'Jobs App' },
  objects: [tickObject(BODY_TICK)],
  jobs: [bodyJob(BODY_JOB, BODY_TICK)],
};

/** The handler-only package: its one enabled job names a function no JSON door carries. */
const HANDLER_ARTIFACT = {
  manifest: { id: HANDLER_APP_ID, namespace: 'handler_jobs', version: '0.1.0', type: 'app', name: 'Handler Jobs' },
  objects: [tickObject(HANDLER_TICK)],
  jobs: [handlerJob(HANDLER_JOB)],
};

/**
 * The CONTROL artifact: both job forms in one boot artifact, the handler's
 * callable in the runtime module `os start --artifact` merges
 * (`mergeRuntimeModule`, the path `os build` emits).
 */
const CONTROL_ARTIFACT = {
  manifest: { id: 'com.example.controljobs', namespace: 'control_jobs', version: '0.1.0', type: 'app', name: 'Control Jobs' },
  objects: [tickObject(BODY_TICK), tickObject(HANDLER_TICK)],
  jobs: [bodyJob(BODY_JOB, BODY_TICK), handlerJob(HANDLER_JOB)],
  runtimeModule: './runtime.mjs',
};
const CONTROL_RUNTIME_MODULE =
  'export const functions = {\n'
  + '  tick: async ({ ql }) => {\n'
  + `    await ql.insert('${HANDLER_TICK}', { name: '${HANDLER_JOB}' }, { context: { isSystem: true } });\n`
  + '  },\n'
  + '};\n';

/**
 * The RUNTIME the packages are installed into. `os start` composes its
 * services from the boot stack's `requires`, never from a package installed
 * later, so the host declares the job service and nothing else.
 */
const HOST_ARTIFACT = {
  manifest: { id: 'com.example.host', namespace: 'host', version: '0.1.0', type: 'app', name: 'Host' },
  requires: ['job'],
};

const groups: ChildProcess[] = [];
const dirs: string[] = [];

interface LiveStart {
  child: ChildProcess;
  base: string;
  output: () => string;
}

function bootStart(cwd: string, home: string, port: string, extra: string[] = []): Promise<LiveStart> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, 'start', '-p', port, '--home', home, '--auth-secret', E2E_SECRET_KEY, '--no-ui', ...extra], {
      cwd,
      // `childEnv`, never a bare `...process.env` — see its header. Package
      // scheduled work is OFF by default in every posture (#17396); this
      // runtime is one that runs it.
      env: childEnv({
        NO_COLOR: '1',
        OS_CLOUD_URL: 'off',
        OS_LOG_LEVEL: 'warn',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_AUTOMATION_SCHEDULED_WORK_ENABLED: 'true',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: `os start` supervises a `serve` grandchild.
      detached: true,
    });
    groups.push(child);
    let out = '';
    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) rejectBoot(err);
      else resolveBoot({ child, base: `http://localhost:${port}`, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`os start never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound.
      if (READY.test(out)) settle(portDriftError(out, 'os start', port));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(portContentionError(out, 'os start', port)
        ?? new Error(`os start exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
    );
  });
}

async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      done();
    }, 15_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

interface Answer { status: number; body: any }

/** One exchange against the running `os start`, attributed to the child if the transport fails. ⛔ No assertion inside it. */
function http(live: LiveStart, method: string, path: string, token: string, body?: unknown): Promise<Answer> {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'package-install-local-jobs',
      what: `${method} ${path}`,
    },
    async () => {
      const r = await fetch(`${live.base}${path}`, {
        method,
        headers: {
          origin: live.base,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch { /* keep the text */ }
      return { status: r.status, body: parsed };
    },
  );
}

async function authenticate(live: LiveStart): Promise<string> {
  const res = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
  const token = res.body?.token;
  if (res.status !== 200 || typeof token !== 'string') {
    throw new Error(`auth answered ${res.status}: ${JSON.stringify(res.body)}\n--- output ---\n${live.output().slice(-3000)}`);
  }
  return token;
}

/**
 * `os package install ./dist/objectstack.json` against the running runtime.
 * ⛔ Asynchronous on purpose — see the #21321 sibling: a `spawnSync` stops this
 * process draining the server's pipes for the whole install.
 */
function packageInstall(appDir: string, live: LiveStart): Promise<{ exit: number | null; output: string }> {
  return new Promise((done) => {
    const child = spawn(TSX, [CLI, 'package', 'install', './dist/objectstack.json', '--runtime', live.base, '--email', EMAIL, '--password', PASSWORD], {
      cwd: appDir,
      env: childEnv({ NO_COLOR: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (d) => { output += String(d); });
    child.stderr?.on('data', (d) => { output += String(d); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code) => { clearTimeout(timer); done({ exit: code, output }); });
  });
}

/** The rows of a `GET /api/v1/data/:object` list answer, whichever envelope it came in. */
function rowsOf(answer: Answer): any[] {
  const b = answer.body?.data ?? answer.body;
  if (Array.isArray(b)) return b;
  if (Array.isArray(b?.records)) return b.records;
  if (Array.isArray(b?.items)) return b.items;
  return [];
}

/** The rows `job` has written into `object`, read through the data route. */
async function jobRows(live: LiveStart, token: string, object: string, job: string): Promise<Answer> {
  return http(live, 'GET', `/api/v1/data/${object}?name=${encodeURIComponent(job)}&limit=500`, token);
}

/**
 * Wait (bounded) until `job` has written MORE than `floor` rows into
 * `object` — a 1-second interval job is read for a while rather than once, so
 * a run a beat after the boot is not misread as one that never happens.
 */
async function awaitRuns(live: LiveStart, token: string, object: string, job: string, floor: number): Promise<{ answer: Answer; floor: number }> {
  const deadline = Date.now() + RUN_WAIT_MS;
  let answer = await jobRows(live, token, object, job);
  while (rowsOf(answer).length <= floor && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    answer = await jobRows(live, token, object, job);
  }
  return { answer, floor };
}

interface InstallRun { exit: number | null; output: string }
const readings: {
  bodyInstall?: InstallRun;
  handlerInstall?: InstallRun;
  installed?: Answer;
  afterInstall?: { answer: Answer; floor: number };
  afterRestart?: { answer: Answer; floor: number };
  controlBody?: { answer: Answer; floor: number };
  controlHandler?: { answer: Answer; floor: number };
  output: Record<string, string>;
} = { output: {} };

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'install-local-jobs-'));
  dirs.push(root);
  const write = (dir: string, artifact: unknown) => {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(artifact, null, 2), 'utf8');
  };
  const bodyApp = join(root, 'body-app');
  const handlerApp = join(root, 'handler-app');
  const controlApp = join(root, 'control-app');
  write(bodyApp, BODY_ARTIFACT);
  write(handlerApp, HANDLER_ARTIFACT);
  write(controlApp, CONTROL_ARTIFACT);
  writeFileSync(join(controlApp, 'dist', 'runtime.mjs'), CONTROL_RUNTIME_MODULE, 'utf8');

  // The runtime boots the HOST artifact — never a package — so the packages
  // reach it only through the install.
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const hostArtifact = join(runtimeDir, 'host.json');
  writeFileSync(hostArtifact, JSON.stringify(HOST_ARTIFACT, null, 2), 'utf8');
  const home = join(runtimeDir, 'home');
  const port = randomPort();

  // ── boot 1: the host, hot installs, the body job runs ─────────────────
  const first = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token = await authenticate(first);
  readings.bodyInstall = await packageInstall(bodyApp, first);
  readings.handlerInstall = await packageInstall(handlerApp, first);
  readings.installed = await http(first, 'GET', '/api/v1/marketplace/install-local', token);
  readings.afterInstall = await awaitRuns(first, token, BODY_TICK, BODY_JOB, 0);
  readings.output.install = first.output();
  await stopGroup(first.child);

  // ── boot 2: same host, home and cwd — the ledger rehydrates on kernel:ready ──
  const second = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token2 = await authenticate(second);
  // The rows boot 1 left behind are the floor: only a run in THIS boot lifts it.
  const floor = rowsOf(await jobRows(second, token2, BODY_TICK, BODY_JOB)).length;
  readings.afterRestart = await awaitRuns(second, token2, BODY_TICK, BODY_JOB, floor);
  readings.output.restart = second.output();
  await stopGroup(second.child);

  // ── boot 3: the CONTROL — both job forms in the boot artifact ─────────
  const controlHome = join(controlApp, 'home');
  const third = await bootStart(controlApp, controlHome, port, ['--artifact', join(controlApp, 'dist', 'objectstack.json')]);
  const token3 = await authenticate(third);
  readings.controlHandler = await awaitRuns(third, token3, HANDLER_TICK, HANDLER_JOB, 0);
  readings.controlBody = await awaitRuns(third, token3, BODY_TICK, BODY_JOB, 0);
  readings.output.control = third.output();
  await stopGroup(third.child);
}, 3 * BOOT_TIMEOUT_MS + 6 * RUN_WAIT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

const transcript = (phase: string) => `\n--- ${phase} output ---\n${(readings.output[phase] ?? '').slice(-3000)}`;

describe('#21489: install-local runs job bodies and refuses handler-only jobs', () => {
  it('the body-job package installs (exit 0)', () => {
    const run = readings.bodyInstall!;
    expect(run.exit, run.output).toBe(0);
    expect(run.output).toMatch(/Package installed into the running kernel/);
  });

  it('after install, the body job runs on its schedule — hot, with no restart', () => {
    const { answer } = readings.afterInstall!;
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(rowsOf(answer).length, `the installed body job never ran${transcript('install')}`).toBeGreaterThan(0);
  });

  it('after restart, the rehydrated body job runs again', () => {
    const { answer, floor } = readings.afterRestart!;
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(rowsOf(answer).length, `no run after the restart${transcript('restart')}`).toBeGreaterThan(floor);
  });

  it('the handler-only package is REFUSED, with its code and remedy, and nothing of it is installed', () => {
    const run = readings.handlerInstall!;
    expect(run.exit, run.output).toBe(1);
    // The CLI names the code the runtime answered with, and the remedy.
    expect(run.output).toMatch(/Install failed \(422 VALIDATION_ERROR\)/);
    expect(run.output).toContain(HANDLER_JOB);
    expect(run.output).toMatch(/give the job a `body`/i);
    expect(run.output).toMatch(/os start --artifact/);
    const listing = readings.installed!;
    expect(listing.status, JSON.stringify(listing.body)).toBe(200);
    const ids = JSON.stringify(listing.body);
    expect(ids).toContain(BODY_APP_ID);
    expect(ids, 'a refused package must leave nothing in the ledger').not.toContain(HANDLER_APP_ID);
  });

  it('control: an `--artifact` boot runs the handler job (its runtime module) …', () => {
    const { answer } = readings.controlHandler!;
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(rowsOf(answer).length, `the control handler job never ran${transcript('control')}`).toBeGreaterThan(0);
  });

  it('… and the body job, through the same binder', () => {
    const { answer } = readings.controlBody!;
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(rowsOf(answer).length, `the control body job never ran${transcript('control')}`).toBeGreaterThan(0);
  });
});
