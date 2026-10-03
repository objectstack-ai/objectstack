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

/**
 * The HOST's own object, where every installed package's job writes its rows.
 * Not the package's own object: an uninstall withdraws the package from the
 * running kernel (#21576), so its object stops answering — a job still running
 * after the uninstall would fail its write there and leave no row to see. The
 * host's object outlives every package, so a run that should have stopped shows.
 */
const HOST_TICK = 'host_tick';

const BODY_APP_ID = 'com.example.jobsapp';
const BODY_TICK = 'jobs_app_tick';
const BODY_JOB = 'jobs_app_tick_body';

/** Another installed package — the control a package's uninstall or reinstall must leave running. */
const OTHER_APP_ID = 'com.example.otherjobs';
const OTHER_TICK = 'other_jobs_tick';
const OTHER_JOB = 'other_jobs_tick_body';

/** A package reinstalled with a version that DROPS one of its two jobs. */
const DROP_APP_ID = 'com.example.dropjobs';
const DROP_TICK = 'drop_jobs_tick';
const DROP_KEPT = 'drop_jobs_kept';
const DROP_GONE = 'drop_jobs_gone';

/** "Writes no further row": let an in-flight run land, take the floor, then read again this much later. */
const SETTLE_MS = 1_500;
const QUIET_WAIT_MS = 4_000;

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
  jobs: [bodyJob(BODY_JOB, HOST_TICK)],
};

const OTHER_ARTIFACT = {
  manifest: { id: OTHER_APP_ID, namespace: 'other_jobs', version: '0.1.0', type: 'app', name: 'Other Jobs' },
  objects: [tickObject(OTHER_TICK)],
  jobs: [bodyJob(OTHER_JOB, HOST_TICK)],
};

/** One version of the drop package, declaring `jobs` (all body jobs into one object). */
function dropArtifact(version: string, jobs: string[]) {
  return {
    manifest: { id: DROP_APP_ID, namespace: 'drop_jobs', version, type: 'app', name: 'Drop Jobs' },
    objects: [tickObject(DROP_TICK)],
    jobs: jobs.map((name) => bodyJob(name, HOST_TICK)),
  };
}

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
  objects: [tickObject(HOST_TICK)],
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The reading for an act that must STOP `job`: let a run already in flight
 * land, take the row count as the floor, wait, and count again. A job that
 * was stopped leaves `after === floor`; one still scheduled (every second)
 * adds rows in between.
 */
async function quietAfter(live: LiveStart, token: string, object: string, job: string): Promise<{ floor: number; after: number }> {
  await sleep(SETTLE_MS);
  const floor = rowsOf(await jobRows(live, token, object, job)).length;
  await sleep(QUIET_WAIT_MS);
  const after = rowsOf(await jobRows(live, token, object, job)).length;
  return { floor, after };
}

interface InstallRun { exit: number | null; output: string }
const readings: {
  bodyInstall?: InstallRun;
  handlerInstall?: InstallRun;
  installed?: Answer;
  afterInstall?: { answer: Answer; floor: number };
  afterRestart?: { answer: Answer; floor: number };
  otherInstall?: InstallRun;
  dropInstall?: InstallRun;
  dropReinstall?: InstallRun;
  dropBefore?: { answer: Answer; floor: number };
  dropGoneHot?: { floor: number; after: number };
  dropKeptHot?: { answer: Answer; floor: number };
  uninstall?: Answer;
  bodyGoneHot?: { floor: number; after: number };
  otherHot?: { answer: Answer; floor: number };
  bodyGoneRestart?: { floor: number; after: number };
  dropGoneRestart?: { floor: number; after: number };
  dropKeptRestart?: { answer: Answer; floor: number };
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
  const otherApp = join(root, 'other-app');
  const dropAppV1 = join(root, 'drop-app-v1');
  const dropAppV2 = join(root, 'drop-app-v2');
  write(otherApp, OTHER_ARTIFACT);
  write(dropAppV1, dropArtifact('0.1.0', [DROP_KEPT, DROP_GONE]));
  write(dropAppV2, dropArtifact('0.2.0', [DROP_KEPT]));
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
  readings.otherInstall = await packageInstall(otherApp, first);
  readings.dropInstall = await packageInstall(dropAppV1, first);
  readings.handlerInstall = await packageInstall(handlerApp, first);
  readings.installed = await http(first, 'GET', '/api/v1/marketplace/install-local', token);
  readings.afterInstall = await awaitRuns(first, token, HOST_TICK, BODY_JOB, 0);

  // Reinstall the drop package with a version that no longer declares DROP_GONE.
  readings.dropBefore = await awaitRuns(first, token, HOST_TICK, DROP_GONE, 0);
  readings.dropReinstall = await packageInstall(dropAppV2, first);
  readings.dropGoneHot = await quietAfter(first, token, HOST_TICK, DROP_GONE);
  readings.dropKeptHot = await awaitRuns(first, token, HOST_TICK, DROP_KEPT,
    rowsOf(await jobRows(first, token, HOST_TICK, DROP_KEPT)).length);

  // Uninstall the body package; the other package is the control.
  readings.uninstall = await http(first, 'DELETE', `/api/v1/marketplace/install-local/${BODY_APP_ID}`, token);
  readings.bodyGoneHot = await quietAfter(first, token, HOST_TICK, BODY_JOB);
  readings.otherHot = await awaitRuns(first, token, HOST_TICK, OTHER_JOB,
    rowsOf(await jobRows(first, token, HOST_TICK, OTHER_JOB)).length);
  readings.output.install = first.output();
  await stopGroup(first.child);

  // ── boot 2: same host, home and cwd — the ledger rehydrates on kernel:ready ──
  const second = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token2 = await authenticate(second);
  // The rows boot 1 left behind are the floors: only a run in THIS boot lifts one.
  const floorOf = async (object: string, job: string) => rowsOf(await jobRows(second, token2, object, job)).length;
  const bodyFloor = await floorOf(HOST_TICK, BODY_JOB);
  const goneFloor = await floorOf(HOST_TICK, DROP_GONE);
  const restartedAt = Date.now();
  readings.afterRestart = await awaitRuns(second, token2, HOST_TICK, OTHER_JOB, await floorOf(HOST_TICK, OTHER_JOB));
  readings.dropKeptRestart = await awaitRuns(second, token2, HOST_TICK, DROP_KEPT, await floorOf(HOST_TICK, DROP_KEPT));
  await sleep(Math.max(0, QUIET_WAIT_MS - (Date.now() - restartedAt)));
  readings.bodyGoneRestart = { floor: bodyFloor, after: await floorOf(HOST_TICK, BODY_JOB) };
  readings.dropGoneRestart = { floor: goneFloor, after: await floorOf(HOST_TICK, DROP_GONE) };
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
}, 3 * BOOT_TIMEOUT_MS + 12 * RUN_WAIT_MS);

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

  it("after restart, a rehydrated package's body job runs again", () => {
    expect(readings.otherInstall!.exit, readings.otherInstall!.output).toBe(0);
    const { answer, floor } = readings.afterRestart!;
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(rowsOf(answer).length, `no run after the restart${transcript('restart')}`).toBeGreaterThan(floor);
  });

  it("uninstall: the DELETE answers 200, and the uninstalled package's body job writes no further row — hot", () => {
    expect(readings.uninstall!.status, JSON.stringify(readings.uninstall!.body)).toBe(200);
    const { floor, after } = readings.bodyGoneHot!;
    expect(floor, 'precondition: the job had run before the uninstall').toBeGreaterThan(0);
    expect(after, `the uninstalled package's job kept running${transcript('install')}`).toBe(floor);
  });

  it('… and none after a restart', () => {
    const { floor, after } = readings.bodyGoneRestart!;
    expect(after, `the uninstalled package's job ran after the restart${transcript('restart')}`).toBe(floor);
  });

  it("control: another package's job keeps running across that uninstall", () => {
    const { answer, floor } = readings.otherHot!;
    expect(rowsOf(answer).length, `the control package's job stopped${transcript('install')}`).toBeGreaterThan(floor);
  });

  it('reinstall: a job the new version DROPPED writes no further row — hot, and none after a restart', () => {
    expect(readings.dropInstall!.exit, readings.dropInstall!.output).toBe(0);
    expect(readings.dropReinstall!.exit, readings.dropReinstall!.output).toBe(0);
    expect(rowsOf(readings.dropBefore!.answer).length, 'precondition: the dropped job had run').toBeGreaterThan(0);
    const hot = readings.dropGoneHot!;
    expect(hot.after, `the dropped job kept running after the reinstall${transcript('install')}`).toBe(hot.floor);
    const restart = readings.dropGoneRestart!;
    expect(restart.after, `the dropped job ran after the restart${transcript('restart')}`).toBe(restart.floor);
  });

  it('… while the job the new version KEPT keeps running, hot and after a restart', () => {
    const hot = readings.dropKeptHot!;
    expect(rowsOf(hot.answer).length, `the kept job stopped${transcript('install')}`).toBeGreaterThan(hot.floor);
    const restart = readings.dropKeptRestart!;
    expect(rowsOf(restart.answer).length, `the kept job did not run after the restart${transcript('restart')}`).toBeGreaterThan(restart.floor);
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
