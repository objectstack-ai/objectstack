// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * install-local refuses an enabled job whose `pull` cannot bind, as it refuses
 * a job whose `body` cannot bind; a package installed by an earlier build
 * still rehydrates, its unbindable pull job withheld and warned by name.
 *
 * ## The defect, measured at this door before the fix
 *
 * `JobSchema.pull: { mapping }` is a job's declarative run form: the binder
 * (`scheduleAppArtifactJobs`) schedules it when `judgeJobPull` binds it — the
 * artifact declares the named mapping, with a `connectorSource`. A package
 * whose enabled pull job named a mapping the package does not declare, or a
 * mapping with no `connectorSource`, installed with exit 0: the binder logged a
 * warn and never scheduled the job, and the install answer said nothing. The
 * authoring doors (`defineStack`, `os validate`) already refuse both shapes, so
 * only a hand-edited package reached this door with one.
 *
 * ## What each `it` reads
 *
 * One host runtime (`requires: ['job', 'automation']`, package scheduled work
 * switched on), two boots of one home:
 *
 *   1. INSTALL — a pull job naming an undeclared mapping is REFUSED, with its
 *      code, the job, the key the refusal names and the remedy, and nothing of
 *      the package is installed or scheduled; a pull job whose mapping declares
 *      no `connectorSource` is refused the same way; the control — a pull job
 *      naming a declared mapping — installs and is scheduled (its `sys_job`
 *      row, and a `sys_job_run` row per run: every run reaches the automation
 *      service's pull door, which refuses it because the package declares no
 *      `connectors[]` entry for the connector the mapping names — the run's
 *      verdict, `failed`, not the install's: the install door judges the job's
 *      `pull` as the binder does, never the connector a run will read); a
 *      DISABLED unbindable pull job does not block its install;
 *   2. RESTART — a ledger entry an earlier build wrote, carrying an unbindable
 *      pull job beside a bindable one, rehydrates: the bindable job is
 *      scheduled, the unbindable one is not, and a warn names it.
 *
 * Every reading goes through a door a user uses: the CLI's own output and exit
 * code for the install, the data route for the job service's own records.
 *
 * ## Spawn shape
 *
 * Shared with `package-install-local-jobs.integration.test.ts`: the tsx source
 * entry, one process group per `os start`, every workspace package —
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
/** How long a phase waits for a 1-second interval job to have recorded a run. */
const RUN_WAIT_MS = 20_000;

/** The development dev-admin seed — see the #21321 sibling for why it is the operator on every boot. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

/** The control: an enabled pull job naming a mapping its package declares, with a `connectorSource`. */
const GOOD_APP_ID = 'com.example.pulljobs';
const GOOD_JOB = 'pull_jobs_orders';

/** An enabled pull job naming a mapping its package does not declare (a one-letter typo). */
const MISSING_APP_ID = 'com.example.pullmissing';
const MISSING_JOB = 'pull_missing_orders';

/** An enabled pull job naming a declared mapping that has no `connectorSource`. */
const NOSOURCE_APP_ID = 'com.example.pullnosource';
const NOSOURCE_JOB = 'pull_nosource_orders';

/** A DISABLED pull job naming an undeclared mapping. */
const OFF_APP_ID = 'com.example.pulloff';
const OFF_JOB = 'pull_off_orders';

/** The ledger entry an earlier build wrote: one bindable pull job, one unbindable. */
const LEGACY_APP_ID = 'com.example.pulllegacy';
const LEGACY_BOUND = 'pull_legacy_bound';
const LEGACY_UNBOUND = 'pull_legacy_unbound';

const MAPPING_NAME = 'orders_pull';

function orderObject(name: string) {
  return {
    name,
    label: 'Order',
    sharingModel: 'public_read_write',
    fields: { external_id: { type: 'text', label: 'External id' } },
  };
}

/** A mapping that pulls into `target`; `withSource: false` drops its `connectorSource` (an import-only mapping). */
function mapping(target: string, withSource = true) {
  return {
    name: MAPPING_NAME,
    targetObject: target,
    fieldMapping: [{ source: 'id', target: 'external_id' }],
    mode: 'upsert',
    upsertKey: ['external_id'],
    ...(withSource ? { connectorSource: { connector: 'orders_api', action: 'request' } } : {}),
  };
}

/** A pull job on a 1-second interval naming `mappingName`. */
function pullJob(name: string, mappingName: string, extra: Record<string, unknown> = {}) {
  return { name, schedule: { type: 'interval', intervalMs: 1000 }, pull: { mapping: mappingName }, ...extra };
}

/** One package, as `os build` writes `dist/objectstack.json` (schema defaults trimmed). */
function pullArtifact(id: string, ns: string, opts: { job: unknown; withSource?: boolean }) {
  return {
    manifest: { id, namespace: ns, version: '0.1.0', type: 'app', name: ns },
    objects: [orderObject(`${ns}_order`)],
    mappings: [mapping(`${ns}_order`, opts.withSource ?? true)],
    jobs: [opts.job],
  };
}

const GOOD_ARTIFACT = pullArtifact(GOOD_APP_ID, 'pull_jobs', { job: pullJob(GOOD_JOB, MAPPING_NAME) });
const MISSING_ARTIFACT = pullArtifact(MISSING_APP_ID, 'pull_missing', { job: pullJob(MISSING_JOB, 'orders_pul') });
const NOSOURCE_ARTIFACT = pullArtifact(NOSOURCE_APP_ID, 'pull_nosource', { job: pullJob(NOSOURCE_JOB, MAPPING_NAME), withSource: false });
const OFF_ARTIFACT = pullArtifact(OFF_APP_ID, 'pull_off', { job: pullJob(OFF_JOB, 'orders_pul', { enabled: false }) });

/** What the install route persists — the compiled bundle, flattened — in an earlier build's layout. */
const LEGACY_ENTRY = {
  packageId: LEGACY_APP_ID,
  versionId: 'local',
  manifestId: LEGACY_APP_ID,
  version: '0.1.0',
  manifest: {
    id: LEGACY_APP_ID,
    namespace: 'pull_legacy',
    version: '0.1.0',
    type: 'app',
    name: 'Pull Legacy',
    objects: [orderObject('pull_legacy_order')],
    mappings: [mapping('pull_legacy_order')],
    jobs: [pullJob(LEGACY_BOUND, MAPPING_NAME), pullJob(LEGACY_UNBOUND, 'orders_pul')],
  },
  installedAt: '2026-01-01T00:00:00.000Z',
  installedBy: 'admin',
  withSampleData: false,
};

/**
 * The RUNTIME the packages are installed into. `os start` composes its
 * services from the boot stack's `requires`, never from a package installed
 * later, so the host declares the job service and the automation service — the
 * one whose `pullConnectorSource` a pull job's run calls.
 */
const HOST_ARTIFACT = {
  manifest: { id: 'com.example.pullhost', namespace: 'pull_host', version: '0.1.0', type: 'app', name: 'Pull Host' },
  requires: ['job', 'automation'],
  objects: [orderObject('pull_host_order')],
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
      label: 'package-install-local-jobs-pull',
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

/** The job service's own record of `job` — the `sys_job` row `IJobService.schedule` upserts. */
function jobRow(live: LiveStart, token: string, job: string): Promise<Answer> {
  return http(live, 'GET', `/api/v1/data/sys_job?name=${encodeURIComponent(job)}&limit=10`, token);
}

/** The runs the job service recorded for `job` — one `sys_job_run` row per attempt. */
function jobRuns(live: LiveStart, token: string, job: string): Promise<Answer> {
  return http(live, 'GET', `/api/v1/data/sys_job_run?job_name=${encodeURIComponent(job)}&limit=500`, token);
}

/** Wait (bounded) until `job` has recorded a run — a 1-second interval job is read for a while, not once. */
async function awaitRuns(live: LiveStart, token: string, job: string): Promise<Answer> {
  const deadline = Date.now() + RUN_WAIT_MS;
  let answer = await jobRuns(live, token, job);
  while (rowsOf(answer).length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    answer = await jobRuns(live, token, job);
  }
  return answer;
}

interface InstallRun { exit: number | null; output: string }
const readings: {
  goodInstall?: InstallRun;
  missingInstall?: InstallRun;
  nosourceInstall?: InstallRun;
  offInstall?: InstallRun;
  installed?: Answer;
  goodJob?: Answer;
  goodRuns?: Answer;
  missingJob?: Answer;
  nosourceJob?: Answer;
  offJob?: Answer;
  legacyBoundJob?: Answer;
  legacyBoundRuns?: Answer;
  legacyUnboundJob?: Answer;
  legacyUnboundRuns?: Answer;
  output: Record<string, string>;
} = { output: {} };

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'install-local-jobs-pull-'));
  dirs.push(root);
  const write = (dir: string, artifact: unknown) => {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(artifact, null, 2), 'utf8');
  };
  const apps = {
    good: join(root, 'good-app'),
    missing: join(root, 'missing-app'),
    nosource: join(root, 'nosource-app'),
    off: join(root, 'off-app'),
  };
  write(apps.good, GOOD_ARTIFACT);
  write(apps.missing, MISSING_ARTIFACT);
  write(apps.nosource, NOSOURCE_ARTIFACT);
  write(apps.off, OFF_ARTIFACT);

  // The runtime boots the HOST artifact — never a package — so the packages
  // reach it only through the install, or through the ledger.
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const hostArtifact = join(runtimeDir, 'host.json');
  writeFileSync(hostArtifact, JSON.stringify(HOST_ARTIFACT, null, 2), 'utf8');
  const home = join(runtimeDir, 'home');
  const port = randomPort();

  // ── boot 1: the host; hot installs ─────────────────────────────────────
  const first = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token = await authenticate(first);
  readings.missingInstall = await packageInstall(apps.missing, first);
  readings.nosourceInstall = await packageInstall(apps.nosource, first);
  readings.offInstall = await packageInstall(apps.off, first);
  readings.goodInstall = await packageInstall(apps.good, first);
  readings.installed = await http(first, 'GET', '/api/v1/marketplace/install-local', token);
  readings.goodRuns = await awaitRuns(first, token, GOOD_JOB);
  readings.goodJob = await jobRow(first, token, GOOD_JOB);
  readings.missingJob = await jobRow(first, token, MISSING_JOB);
  readings.nosourceJob = await jobRow(first, token, NOSOURCE_JOB);
  readings.offJob = await jobRow(first, token, OFF_JOB);
  readings.output.install = first.output();
  await stopGroup(first.child);

  // ── boot 2: same host, home and cwd, plus a ledger entry an earlier build wrote ──
  const ledger = join(runtimeDir, '.objectstack', 'installed-packages');
  mkdirSync(ledger, { recursive: true });
  writeFileSync(join(ledger, `${LEGACY_APP_ID}.json`), JSON.stringify(LEGACY_ENTRY, null, 2), 'utf8');
  const second = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token2 = await authenticate(second);
  readings.legacyBoundRuns = await awaitRuns(second, token2, LEGACY_BOUND);
  readings.legacyBoundJob = await jobRow(second, token2, LEGACY_BOUND);
  readings.legacyUnboundJob = await jobRow(second, token2, LEGACY_UNBOUND);
  readings.legacyUnboundRuns = await jobRuns(second, token2, LEGACY_UNBOUND);
  readings.output.restart = second.output();
  await stopGroup(second.child);
}, 2 * BOOT_TIMEOUT_MS + 4 * 120_000 + 2 * RUN_WAIT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

const transcript = (phase: string) => `\n--- ${phase} output ---\n${(readings.output[phase] ?? '').slice(-3000)}`;

describe('install-local refuses an enabled job whose pull does not bind', () => {
  it('a pull job naming a mapping the package does not declare is REFUSED — non-zero exit, the job, the key and the remedy', () => {
    const run = readings.missingInstall!;
    expect(run.exit, `${run.output}${transcript('install')}`).toBe(1);
    // The CLI names the code the runtime answered with.
    expect(run.output).toMatch(/Install failed \(422 VALIDATION_ERROR\)/);
    expect(run.output).toContain(MISSING_JOB);
    expect(run.output).toContain("pull.mapping: this artifact declares no mapping 'orders_pul'");
    expect(run.output).toContain('os validate');
  });

  it('a pull job whose mapping declares no connectorSource is REFUSED the same way', () => {
    const run = readings.nosourceInstall!;
    expect(run.exit, `${run.output}${transcript('install')}`).toBe(1);
    expect(run.output).toMatch(/Install failed \(422 VALIDATION_ERROR\)/);
    expect(run.output).toContain(NOSOURCE_JOB);
    expect(run.output).toContain(`mapping '${MAPPING_NAME}' declares no connectorSource`);
  });

  it('a refused package leaves nothing behind: not in the ledger, and its job not scheduled', () => {
    const listing = readings.installed!;
    expect(listing.status, JSON.stringify(listing.body)).toBe(200);
    const ids = JSON.stringify(listing.body);
    expect(ids, 'a refused package must leave nothing in the ledger').not.toContain(MISSING_APP_ID);
    expect(ids, 'a refused package must leave nothing in the ledger').not.toContain(NOSOURCE_APP_ID);
    for (const answer of [readings.missingJob!, readings.nosourceJob!]) {
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(rowsOf(answer)).toEqual([]);
    }
  });

  it('control: a pull job naming a declared mapping installs (exit 0) and is scheduled — every run reaches the pull door', () => {
    const run = readings.goodInstall!;
    expect(run.exit, run.output).toBe(0);
    expect(run.output).toMatch(/Package installed into the running kernel/);
    expect(JSON.stringify(readings.installed!.body)).toContain(GOOD_APP_ID);
    const job = readings.goodJob!;
    expect(job.status, JSON.stringify(job.body)).toBe(200);
    expect(rowsOf(job).map((r) => r.name), `the control pull job was not scheduled${transcript('install')}`).toEqual([GOOD_JOB]);
    const runs = readings.goodRuns!;
    expect(runs.status, JSON.stringify(runs.body)).toBe(200);
    expect(rowsOf(runs).length, `the control pull job never ran${transcript('install')}`).toBeGreaterThan(0);
  });

  it('a DISABLED pull job naming an undeclared mapping does not block its install, and is not scheduled', () => {
    const run = readings.offInstall!;
    expect(run.exit, run.output).toBe(0);
    expect(JSON.stringify(readings.installed!.body)).toContain(OFF_APP_ID);
    expect(rowsOf(readings.offJob!)).toEqual([]);
  });
});

describe('rehydrate of an entry an earlier build installed, holding a pull job that does not bind', () => {
  it('the bindable pull job of the entry is scheduled and runs', () => {
    expect(rowsOf(readings.legacyBoundJob!).map((r) => r.name), `the rehydrated bindable pull job was not scheduled${transcript('restart')}`)
      .toEqual([LEGACY_BOUND]);
    expect(rowsOf(readings.legacyBoundRuns!).length, `the rehydrated bindable pull job never ran${transcript('restart')}`).toBeGreaterThan(0);
  });

  it('…the unbindable one is withheld — never scheduled, never run', () => {
    expect(rowsOf(readings.legacyUnboundJob!), transcript('restart')).toEqual([]);
    expect(rowsOf(readings.legacyUnboundRuns!), transcript('restart')).toEqual([]);
  });

  it('…and a warn names it, with the refusal', () => {
    const out = readings.output.restart ?? '';
    const line = out.split('\n').find((l) => l.includes(LEGACY_UNBOUND) && l.includes('NOT scheduled'));
    expect(line, `no warn names the withheld pull job${transcript('restart')}`).toBeDefined();
    expect(line).toContain("pull.mapping: this artifact declares no mapping 'orders_pul'");
  });
});
