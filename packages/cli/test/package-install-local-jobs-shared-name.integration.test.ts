// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 140 — spawns the real producer once per single-cause fixture: two `os start` boots of the tsx source entry on one home (the hot installs and an uninstall, then the rehydrate and a second uninstall) and three `os package install` runs, one per package sharing the job name; slowest CI reading 110.4 s (run 38332198724, the card's window; 107.1 s in hourly full battery run 40290659753) x 1.25, rounded up

/**
 * #21602 — two install-local packages that declare the SAME job name both keep
 * running, and uninstalling one stops only its own job.
 *
 * ## The defect, measured at this door before the fix
 *
 * The metadata registry keys a packaged item by `<packageId>:<name>`, so two
 * packages may each declare a job `shared_tick`. The job service keyed by the
 * bare name and replaced: the second install scheduled its `shared_tick` over
 * the first package's, whose job stopped — its rows held flat over several
 * intervals — while both installs answered success and nothing at the door
 * said so.
 *
 * ## What each `it` reads
 *
 * Three packages, ALPHA, BETA and GAMMA, each declare a body job named
 * `shared_tick`; each body writes a row carrying ITS OWN marker into the
 * host's object, so a run is attributable to a package even though the three
 * jobs share a name. One host runtime (`requires: ['job']`, package scheduled
 * work on), two boots on one home:
 *
 *   1. HOT — ALPHA installs alone: a single-package runtime, whose job and run
 *      history read the AUTHORED name in `sys_job` / `sys_job_run`. BETA and
 *      GAMMA install: all three run, ALPHA's included, and ALPHA's catalogue
 *      row and run history still read the authored name; the later two are
 *      catalogued under the registry's package-scoped identity. BETA (a
 *      scoped holder) uninstalls: BETA stops, ALPHA and GAMMA run on.
 *   2. RESTART — the ledger rehydrates ALPHA and GAMMA: both run. ALPHA (the
 *      holder of the bare name) uninstalls: ALPHA stops, GAMMA runs on.
 *
 * Every reading goes through a door a user uses: the CLI's output and exit
 * code for an install, the install-local DELETE for an uninstall, the data
 * route for the rows a job wrote and for the `sys_job` / `sys_job_run`
 * catalogue an operator reads in Setup.
 *
 * ## Spawn shape
 *
 * Shared with `package-install-local-jobs.integration.test.ts` (#21489): the
 * tsx source entry, one process group per `os start`, every workspace package
 * — `@objectstack/runtime` included — resolved through its `exports` to
 * `dist/`, so an ablation of the runtime's source reaches this file only after
 * that package is rebuilt.
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
  KERNEL_ASSIGNED_PORT,
  probeThroughChild,
  readKernelAssignedPort,
} from './helpers/serve-process.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
/** How long a phase waits for a 1-second interval job to have written a row. */
const RUN_WAIT_MS = 20_000;
/** "Writes no further row": let an in-flight run land, take the floor, then read again this much later. */
const SETTLE_MS = 1_500;
const QUIET_WAIT_MS = 4_000;

/** The development dev-admin seed — see the #21321 sibling for why it is the operator on every boot. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

/**
 * The HOST's own object, where every package's job writes its rows — it
 * outlives every package, so a job still running after its uninstall shows.
 */
const HOST_TICK = 'host_tick';

/** The ONE job name all three packages declare. */
const SHARED_JOB = 'shared_tick';

/**
 * The three packages. Their ids sort ALPHA < GAMMA, which is the order the
 * ledger rehydrates them in — the same order they were installed in, so the
 * holder of the bare name is the same package on both boots.
 */
const ALPHA = { id: 'com.example.sharedalpha', namespace: 'shared_alpha', marker: 'shared_tick_alpha' };
const BETA = { id: 'com.example.sharedbeta', namespace: 'shared_beta', marker: 'shared_tick_beta' };
const GAMMA = { id: 'com.example.sharedgamma', namespace: 'shared_gamma', marker: 'shared_tick_gamma' };
type Pkg = typeof ALPHA;

/** The package-scoped identity the metadata registry keys a packaged item by. */
const scopedKey = (pkg: Pkg) => `${pkg.id}:${SHARED_JOB}`;

/** A package declaring `shared_tick`, whose body writes one row per run carrying the package's marker. */
function sharedJobArtifact(pkg: Pkg) {
  return {
    manifest: { id: pkg.id, namespace: pkg.namespace, version: '0.1.0', type: 'app', name: pkg.namespace },
    objects: [{
      name: `${pkg.namespace}_note`,
      label: 'Note',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    }],
    jobs: [{
      name: SHARED_JOB,
      schedule: { type: 'interval', intervalMs: 1000 },
      body: {
        language: 'js',
        capabilities: ['api.write'],
        source: `await ctx.api.object('${HOST_TICK}').insert({ name: '${pkg.marker}' });`,
      },
      timeoutMs: 10_000,
      enabled: true,
    }],
  };
}

/** The RUNTIME the packages are installed into: the job service and the host's object, nothing else. */
const HOST_ARTIFACT = {
  manifest: { id: 'com.example.host', namespace: 'host', version: '0.1.0', type: 'app', name: 'Host' },
  requires: ['job'],
  objects: [{
    name: HOST_TICK,
    label: 'Tick',
    sharingModel: 'public_read_write',
    fields: { name: { type: 'text', label: 'Name' } },
  }],
};

const groups: ChildProcess[] = [];
const dirs: string[] = [];

interface LiveStart {
  child: ChildProcess;
  base: string;
  output: () => string;
}

function bootStart(cwd: string, home: string, extra: string[] = []): Promise<LiveStart> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, 'start', '-p', KERNEL_ASSIGNED_PORT, '--home', home, '--auth-secret', E2E_SECRET_KEY, '--no-ui', ...extra], {
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
    const settle = (verdict: Error | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (verdict instanceof Error) rejectBoot(verdict);
      else resolveBoot({ child, base: `http://localhost:${verdict}`, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`os start never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound: a kernel-assigned one (#24342).
      if (READY.test(out)) settle(readKernelAssignedPort(out, 'os start'));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`os start exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
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
      label: 'package-install-local-jobs-shared-name',
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
 * The `beforeAll` budget, and the ONE number an install's ceiling is read from.
 *
 * An install had a ceiling of its own, a fixed 120 s, set on an idle machine.
 * The file passes alone in about 76 s, all three installs included. Under a full
 * `pnpm test` on a 4 vCPU box the first install outlived it. It was SIGKILLed
 * with more than 390 s of the hook's 600 s left (the whole file took 209 s),
 * and six assertions went red against correct code. A bigger constant fails
 * the same way on a busier box. A ceiling scaled from a calibration fails too
 * (`run-dev-unbuilt-workspace.e2e.test.ts` records both attempts).
 *
 * So an install has no budget of its own. It may run until this phase's
 * deadline, the hook's start plus this budget, minus the reserve below. A slow
 * box spends the slack the boots and the run waits did not use. An install
 * that hangs is still killed, and the kill names the install.
 */
const SETUP_BUDGET_MS = 2 * BOOT_TIMEOUT_MS + 12 * RUN_WAIT_MS;
/**
 * What a killed install leaves the hook, before vitest's own hook timeout.
 * The group kill, the pipes closing and the throw must land inside it. Past
 * that, the red is `Hook timed out`, which names no step.
 */
const KILL_REPORT_RESERVE_MS = 10_000;

interface InstallRun { exit: number | null; output: string; elapsedMs: number }

/**
 * `os package install ./dist/objectstack.json` against the running runtime.
 * ⛔ Asynchronous on purpose — see the #21321 sibling: a `spawnSync` stops this
 * process draining the server's pipes for the whole install.
 *
 * The child runs until `deadline` (see `SETUP_BUDGET_MS`). It gets its own
 * process group, so the kill reaches every process the install started.
 * The CLI process holds the pipes, and `close` would wait for it. A kill REJECTS,
 * naming the install, the wall time and the budget: the rest of the hook could
 * only run into vitest's hook timeout. An install that exits by itself
 * resolves, whatever its code, and the first `it` judges it.
 */
function packageInstall(appDir: string, live: LiveStart, deadline: number): Promise<InstallRun> {
  return new Promise((done, fail) => {
    const started = Date.now();
    const child = spawn(process.execPath, [CLI, 'package', 'install', './dist/objectstack.json', '--runtime', live.base, '--email', EMAIL, '--password', PASSWORD], {
      cwd: appDir,
      env: childEnv({ NO_COLOR: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    let killed = false;
    child.stdout?.on('data', (d) => { output += String(d); });
    child.stderr?.on('data', (d) => { output += String(d); });
    const timer = setTimeout(() => {
      killed = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
    }, Math.max(0, deadline - started));
    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      if (!killed) {
        done({ exit: code, output, elapsedMs });
        return;
      }
      fail(new Error(
        `os package install in ${appDir} was SIGKILLed after ${elapsedMs} ms: the setup budget ` +
        `(${SETUP_BUDGET_MS} ms for the whole beforeAll, less a ${KILL_REPORT_RESERVE_MS} ms reserve) was spent.` +
        `\n--- install output ---\n${output.slice(-3000)}\n--- runtime output ---\n${live.output().slice(-3000)}`,
      ));
    });
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

/** The rows `pkg`'s job has written into the host's object, read through the data route. */
async function packageRows(live: LiveStart, token: string, pkg: Pkg): Promise<Answer> {
  return http(live, 'GET', `/api/v1/data/${HOST_TICK}?name=${encodeURIComponent(pkg.marker)}&limit=500`, token);
}

const countOf = async (live: LiveStart, token: string, pkg: Pkg) => rowsOf(await packageRows(live, token, pkg)).length;

/**
 * Wait (bounded) until `pkg`'s job has written MORE than `floor` rows — a
 * 1-second interval job is read for a while rather than once, so a run a beat
 * after an install is not misread as one that never happens.
 */
async function awaitRuns(live: LiveStart, token: string, pkg: Pkg, floor: number): Promise<{ answer: Answer; floor: number }> {
  const deadline = Date.now() + RUN_WAIT_MS;
  let answer = await packageRows(live, token, pkg);
  while (rowsOf(answer).length <= floor && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    answer = await packageRows(live, token, pkg);
  }
  return { answer, floor };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The reading for an act that must STOP `pkg`'s job: let a run already in
 * flight land, take the row count as the floor, wait, and count again. A job
 * that was stopped leaves `after === floor`; one still scheduled (every
 * second) adds rows in between.
 */
async function quietAfter(live: LiveStart, token: string, pkg: Pkg): Promise<{ floor: number; after: number }> {
  await sleep(SETTLE_MS);
  const floor = await countOf(live, token, pkg);
  await sleep(QUIET_WAIT_MS);
  const after = await countOf(live, token, pkg);
  return { floor, after };
}

/** The job catalogue an operator reads in Setup: `sys_job` names, and the `job_name` of every `sys_job_run` row. */
async function catalogue(live: LiveStart, token: string): Promise<{ jobs: Answer; runs: Answer }> {
  return {
    jobs: await http(live, 'GET', '/api/v1/data/sys_job?limit=500', token),
    runs: await http(live, 'GET', '/api/v1/data/sys_job_run?limit=1000', token),
  };
}

/** The distinct names a catalogue reading carries for the shared job, sorted. */
function sharedNames(rows: any[], key: 'name' | 'job_name'): string[] {
  return [...new Set(rows.map((r) => String(r?.[key])).filter((n) => n.endsWith(SHARED_JOB)))].sort();
}

const readings: {
  installs: Record<string, InstallRun>;
  alphaAlone?: { answer: Answer; floor: number };
  alphaAloneCatalogue?: { jobs: Answer; runs: Answer };
  alphaAfterOthers?: { answer: Answer; floor: number };
  betaRuns?: { answer: Answer; floor: number };
  gammaRuns?: { answer: Answer; floor: number };
  sharedCatalogue?: { jobs: Answer; runs: Answer };
  betaUninstall?: Answer;
  betaGone?: { floor: number; after: number };
  alphaAfterBetaGone?: { answer: Answer; floor: number };
  gammaAfterBetaGone?: { answer: Answer; floor: number };
  alphaRestart?: { answer: Answer; floor: number };
  gammaRestart?: { answer: Answer; floor: number };
  alphaUninstall?: Answer;
  alphaGone?: { floor: number; after: number };
  gammaAfterAlphaGone?: { answer: Answer; floor: number };
  output: Record<string, string>;
} = { installs: {}, output: {} };

beforeAll(async () => {
  const deadline = Date.now() + SETUP_BUDGET_MS - KILL_REPORT_RESERVE_MS;
  const root = mkdtempSync(join(tmpdir(), 'install-local-jobs-shared-'));
  dirs.push(root);
  const appDir = (pkg: Pkg) => {
    const dir = join(root, pkg.namespace);
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(sharedJobArtifact(pkg), null, 2), 'utf8');
    return dir;
  };
  const dirOf = { alpha: appDir(ALPHA), beta: appDir(BETA), gamma: appDir(GAMMA) };

  // The runtime boots the HOST artifact — never a package — so the packages
  // reach it only through the install.
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const hostArtifact = join(runtimeDir, 'host.json');
  writeFileSync(hostArtifact, JSON.stringify(HOST_ARTIFACT, null, 2), 'utf8');
  const home = join(runtimeDir, 'home');

  // ── boot 1: hot installs ─────────────────────────────────────────────
  const first = await bootStart(runtimeDir, home, ['--artifact', hostArtifact]);
  const token = await authenticate(first);

  // ALPHA alone: a single-package runtime.
  readings.installs.alpha = await packageInstall(dirOf.alpha, first, deadline);
  readings.alphaAlone = await awaitRuns(first, token, ALPHA, 0);
  readings.alphaAloneCatalogue = await catalogue(first, token);

  // BETA and GAMMA declare the same job name. The floor for ALPHA is taken
  // AFTER both installs answered, so only a run that happens once they are in
  // lifts it.
  readings.installs.beta = await packageInstall(dirOf.beta, first, deadline);
  readings.installs.gamma = await packageInstall(dirOf.gamma, first, deadline);
  await sleep(SETTLE_MS);
  readings.alphaAfterOthers = await awaitRuns(first, token, ALPHA, await countOf(first, token, ALPHA));
  readings.betaRuns = await awaitRuns(first, token, BETA, 0);
  readings.gammaRuns = await awaitRuns(first, token, GAMMA, 0);
  readings.sharedCatalogue = await catalogue(first, token);

  // Uninstall BETA — a holder of a package-scoped identity.
  readings.betaUninstall = await http(first, 'DELETE', `/api/v1/marketplace/install-local/${BETA.id}`, token);
  readings.betaGone = await quietAfter(first, token, BETA);
  readings.alphaAfterBetaGone = await awaitRuns(first, token, ALPHA, await countOf(first, token, ALPHA));
  readings.gammaAfterBetaGone = await awaitRuns(first, token, GAMMA, await countOf(first, token, GAMMA));
  readings.output.hot = first.output();
  await stopGroup(first.child);

  // ── boot 2: same host, home and cwd — the ledger rehydrates ALPHA and GAMMA ──
  const second = await bootStart(runtimeDir, home, ['--artifact', hostArtifact]);
  const token2 = await authenticate(second);
  readings.alphaRestart = await awaitRuns(second, token2, ALPHA, await countOf(second, token2, ALPHA));
  readings.gammaRestart = await awaitRuns(second, token2, GAMMA, await countOf(second, token2, GAMMA));

  // Uninstall ALPHA — the holder of the bare name.
  readings.alphaUninstall = await http(second, 'DELETE', `/api/v1/marketplace/install-local/${ALPHA.id}`, token2);
  readings.alphaGone = await quietAfter(second, token2, ALPHA);
  readings.gammaAfterAlphaGone = await awaitRuns(second, token2, GAMMA, await countOf(second, token2, GAMMA));
  readings.output.restart = second.output();
  await stopGroup(second.child);
}, SETUP_BUDGET_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

const transcript = (phase: string) => `\n--- ${phase} output ---\n${(readings.output[phase] ?? '').slice(-3000)}`;

describe('#21602: two packages declaring the same job name both run, and an uninstall stops only its own', () => {
  it('all three packages install (exit 0)', () => {
    for (const [name, run] of Object.entries(readings.installs)) {
      expect(run.exit, `${name} (${run.elapsedMs} ms): ${run.output}`).toBe(0);
      expect(run.output, name).toMatch(/Package installed into the running kernel/);
    }
  });

  it('a single-package runtime: the job runs, and sys_job / sys_job_run read the AUTHORED name', () => {
    const { answer } = readings.alphaAlone!;
    expect(rowsOf(answer).length, `ALPHA's job never ran${transcript('hot')}`).toBeGreaterThan(0);
    const { jobs, runs } = readings.alphaAloneCatalogue!;
    expect(jobs.status, JSON.stringify(jobs.body)).toBe(200);
    expect(runs.status, JSON.stringify(runs.body)).toBe(200);
    expect(sharedNames(rowsOf(jobs), 'name')).toEqual([SHARED_JOB]);
    expect(sharedNames(rowsOf(runs), 'job_name')).toEqual([SHARED_JOB]);
  });

  it("after the same-named installs, the FIRST package's job keeps running — it is not displaced", () => {
    const { answer, floor } = readings.alphaAfterOthers!;
    expect(rowsOf(answer).length, `ALPHA's job stopped once BETA and GAMMA installed${transcript('hot')}`).toBeGreaterThan(floor);
  });

  it("… and each later package's job runs too", () => {
    expect(rowsOf(readings.betaRuns!.answer).length, `BETA's job never ran${transcript('hot')}`).toBeGreaterThan(0);
    expect(rowsOf(readings.gammaRuns!.answer).length, `GAMMA's job never ran${transcript('hot')}`).toBeGreaterThan(0);
  });

  it("the catalogue: the first package keeps the authored name; the later ones read the registry's package-scoped identity", () => {
    const { jobs, runs } = readings.sharedCatalogue!;
    const expected = [SHARED_JOB, scopedKey(BETA), scopedKey(GAMMA)].sort();
    expect(sharedNames(rowsOf(jobs), 'name')).toEqual(expected);
    expect(sharedNames(rowsOf(runs), 'job_name')).toEqual(expected);
  });

  it('uninstalling a scoped holder (BETA) stops its job — hot', () => {
    expect(readings.betaUninstall!.status, JSON.stringify(readings.betaUninstall!.body)).toBe(200);
    const { floor, after } = readings.betaGone!;
    expect(floor, 'precondition: the job had run before the uninstall').toBeGreaterThan(0);
    expect(after, `BETA's job kept running after its uninstall${transcript('hot')}`).toBe(floor);
  });

  it('… and only its own: ALPHA and GAMMA run on', () => {
    const alpha = readings.alphaAfterBetaGone!;
    expect(rowsOf(alpha.answer).length, `ALPHA's job stopped at BETA's uninstall${transcript('hot')}`).toBeGreaterThan(alpha.floor);
    const gamma = readings.gammaAfterBetaGone!;
    expect(rowsOf(gamma.answer).length, `GAMMA's job stopped at BETA's uninstall${transcript('hot')}`).toBeGreaterThan(gamma.floor);
  });

  it('after a restart, both rehydrated packages run', () => {
    const alpha = readings.alphaRestart!;
    expect(rowsOf(alpha.answer).length, `ALPHA's job did not run after the restart${transcript('restart')}`).toBeGreaterThan(alpha.floor);
    const gamma = readings.gammaRestart!;
    expect(rowsOf(gamma.answer).length, `GAMMA's job did not run after the restart${transcript('restart')}`).toBeGreaterThan(gamma.floor);
  });

  it('uninstalling the holder of the bare name (ALPHA) stops its job, and only its own: GAMMA runs on', () => {
    expect(readings.alphaUninstall!.status, JSON.stringify(readings.alphaUninstall!.body)).toBe(200);
    const { floor, after } = readings.alphaGone!;
    expect(floor, 'precondition: the job had run before the uninstall').toBeGreaterThan(0);
    expect(after, `ALPHA's job kept running after its uninstall${transcript('restart')}`).toBe(floor);
    const gamma = readings.gammaAfterAlphaGone!;
    expect(rowsOf(gamma.answer).length, `GAMMA's job stopped at ALPHA's uninstall${transcript('restart')}`).toBeGreaterThan(gamma.floor);
  });
});
