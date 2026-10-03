// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21585 — install-local refuses the code it cannot run: a hook with no `body`,
 * and a job whose `body` the declaration refuses. A package installed by an
 * earlier build still rehydrates, its hook with no `body` warned and NOT bound.
 *
 * ## The defect, measured at this door before the fix
 *
 * A hook in the deprecated function-name `handler` form, with no `body`, names
 * code that travels only in an artifact's runtime module — never in the package
 * JSON `os package install` sends. Such a package installed with exit 0, and
 * its hook either never fired or bound by name to a function the package does
 * not ship, hot and after a restart. A job whose `body`
 * the declaration refuses (an expression body, a `body.timeoutMs`) installed
 * with exit 0 and was never scheduled. Only a server warn said either.
 *
 * ## What each `it` reads
 *
 * One host runtime, booted from an artifact whose runtime module ships a
 * function and whose own hook names it in the `handler` form. Two boots of one
 * home:
 *
 *   1. INSTALL — a package whose hook has no `body` (naming the host's function)
 *      is REFUSED, with its code and remedy, and nothing of it is installed; the
 *      two off-spec job bodies are refused the same way; the body-hook control
 *      installs and fires; a valid body job installs and runs; the host's own
 *      handler hook fires (the `--artifact` boot is unchanged);
 *   2. RESTART — a ledger entry an earlier build wrote, carrying the same hook
 *      with no `body` beside a body hook, rehydrates: its object answers, its
 *      body hook fires, its hook with no `body` runs nothing and is warned by
 *      name.
 *
 * Every reading goes through a door a user uses: the CLI's own output and exit
 * code for the install, the data route for what a hook or a job wrote.
 *
 * ## Spawn shape
 *
 * Shared with `package-install-local-jobs.integration.test.ts` (#21489): the
 * tsx source entry, one process group per `os start`, every workspace package —
 * `@objectstack/runtime` and `@objectstack/cloud-connection` included —
 * resolved through its `exports` to `dist/`, so an ablation of either package's
 * source reaches this file only after that package is rebuilt.
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

/** The host's function, shipped in its runtime module, and the host's own hook naming it. */
const HOST_FN = 'host_stamp';
const HOST_TASK = 'host_task';
const HOST_TICK = 'host_tick';

/** A task object whose `status` a hook appends its stamp to, so every hook that ran is visible on the row. */
function taskObject(name: string) {
  return {
    name,
    label: 'Task',
    sharingModel: 'public_read_write',
    fields: { name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
  };
}

function tickObject(name: string) {
  return { name, label: 'Tick', sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } };
}

function bodyHook(name: string, object: string) {
  return {
    name,
    object,
    events: ['beforeInsert'],
    onError: 'abort',
    body: { language: 'js', source: "ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + 'body';" },
  };
}

/** The deprecated form: a function NAME, no `body`. */
function handlerHook(name: string, object: string) {
  return { name, object, events: ['beforeInsert'], onError: 'abort', handler: HOST_FN };
}

function bodyJob(name: string, object: string, body: Record<string, unknown> = {}) {
  return {
    name,
    schedule: { type: 'interval', intervalMs: 1000 },
    body: {
      language: 'js',
      capabilities: ['api.write'],
      source: `await ctx.api.object('${object}').insert({ name: '${name}' });`,
      ...body,
    },
    timeoutMs: 10_000,
    enabled: true,
  };
}

/**
 * The RUNTIME the packages are installed into: an `--artifact` app whose
 * runtime module ships `HOST_FN`, and whose own hook names it in the `handler`
 * form — the boot that carries its runtime module, which must keep binding it.
 */
const HOST_ARTIFACT = {
  manifest: { id: 'com.example.host', namespace: 'host', version: '0.1.0', type: 'app', name: 'Host' },
  requires: ['job'],
  objects: [taskObject(HOST_TASK), tickObject(HOST_TICK)],
  hooks: [{ name: 'host_own_stamp', object: HOST_TASK, events: ['beforeInsert'], onError: 'abort', handler: HOST_FN }],
  runtimeModule: './runtime.mjs',
};
const HOST_RUNTIME_MODULE =
  'export const functions = {\n'
  + `  ${HOST_FN}: async (ctx) => {\n`
  + '    const d = ctx && ctx.input && ctx.input.data ? ctx.input.data : ctx.input;\n'
  + "    d.status = (typeof d.status === 'string' ? d.status : '') + 'host';\n"
  + '  },\n'
  + '};\n';

const HANDLER_APP_ID = 'com.example.handlerhooks';
const HANDLER_TASK = 'handler_hooks_task';
const HANDLER_HOOK = 'handler_hooks_by_name';
/** The refused package: a hook with no `body`, beside a body hook. */
const HANDLER_ARTIFACT = {
  manifest: { id: HANDLER_APP_ID, namespace: 'handler_hooks', version: '0.1.0', type: 'app', name: 'Handler Hooks' },
  objects: [taskObject(HANDLER_TASK)],
  hooks: [handlerHook(HANDLER_HOOK, HANDLER_TASK), bodyHook('handler_hooks_body', HANDLER_TASK)],
};

const BODY_APP_ID = 'com.example.bodyhooks';
const BODY_TASK = 'body_hooks_task';
/** The control: its one hook carries a `body`. */
const BODY_ARTIFACT = {
  manifest: { id: BODY_APP_ID, namespace: 'body_hooks', version: '0.1.0', type: 'app', name: 'Body Hooks' },
  objects: [taskObject(BODY_TASK)],
  hooks: [bodyHook('body_hooks_body', BODY_TASK)],
};

const EXPR_APP_ID = 'com.example.exprjob';
const EXPR_JOB = 'expr_job_tick';
const EXPR_ARTIFACT = {
  manifest: { id: EXPR_APP_ID, namespace: 'expr_job', version: '0.1.0', type: 'app', name: 'Expr Job' },
  objects: [tickObject('expr_job_tick')],
  jobs: [{ name: EXPR_JOB, schedule: { type: 'interval', intervalMs: 1000 }, enabled: true, body: { language: 'expression', source: '1 + 1' } }],
};

const LIMIT_APP_ID = 'com.example.limitjob';
const LIMIT_JOB = 'limit_job_tick';
const LIMIT_ARTIFACT = {
  manifest: { id: LIMIT_APP_ID, namespace: 'limit_job', version: '0.1.0', type: 'app', name: 'Limit Job' },
  objects: [tickObject('limit_job_tick')],
  jobs: [bodyJob(LIMIT_JOB, HOST_TICK, { timeoutMs: 5_000 })],
};

const GOOD_APP_ID = 'com.example.goodjob';
const GOOD_JOB = 'good_job_tick';
const GOOD_ARTIFACT = {
  manifest: { id: GOOD_APP_ID, namespace: 'good_job', version: '0.1.0', type: 'app', name: 'Good Job' },
  objects: [tickObject('good_job_tick')],
  jobs: [bodyJob(GOOD_JOB, HOST_TICK)],
};

/** The entry an EARLIER build wrote for a package carrying a hook with no `body`, flattened as the install route persists it. */
const LEGACY_APP_ID = 'com.example.legacyhooks';
const LEGACY_TASK = 'legacy_hooks_task';
const LEGACY_HOOK = 'legacy_hooks_by_name';
const LEGACY_ENTRY = {
  packageId: LEGACY_APP_ID,
  versionId: 'local',
  manifestId: LEGACY_APP_ID,
  version: '0.1.0',
  manifest: {
    id: LEGACY_APP_ID,
    namespace: 'legacy_hooks',
    version: '0.1.0',
    type: 'app',
    name: 'Legacy Hooks',
    objects: [taskObject(LEGACY_TASK)],
    hooks: [handlerHook(LEGACY_HOOK, LEGACY_TASK), bodyHook('legacy_hooks_body', LEGACY_TASK)],
  },
  installedAt: '2026-01-01T00:00:00.000Z',
  installedBy: 'admin',
  withSampleData: false,
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
      label: 'package-install-local-hooks',
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

/** The record a `POST /api/v1/data/:object` answered with, whichever envelope it came in. */
const record = (a: Answer) => a.body?.data ?? a.body?.record ?? a.body;

/** The rows of a `GET /api/v1/data/:object` list answer, whichever envelope it came in. */
function rowsOf(answer: Answer): any[] {
  const b = answer.body?.data ?? answer.body;
  if (Array.isArray(b)) return b;
  if (Array.isArray(b?.records)) return b.records;
  if (Array.isArray(b?.items)) return b.items;
  return [];
}

/** Wait (bounded) until `job` has written a row into `object` — a 1-second interval job is read for a while, not once. */
async function awaitRuns(live: LiveStart, token: string, object: string, job: string): Promise<Answer> {
  const deadline = Date.now() + RUN_WAIT_MS;
  const read = () => http(live, 'GET', `/api/v1/data/${object}?name=${encodeURIComponent(job)}&limit=500`, token);
  let answer = await read();
  while (rowsOf(answer).length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    answer = await read();
  }
  return answer;
}

interface InstallRun { exit: number | null; output: string }
const readings: {
  handlerInstall?: InstallRun;
  bodyInstall?: InstallRun;
  exprInstall?: InstallRun;
  limitInstall?: InstallRun;
  goodInstall?: InstallRun;
  installed?: Answer;
  bodyInsert?: Answer;
  hostInsert?: Answer;
  goodRuns?: Answer;
  limitRows?: Answer;
  legacyInsert?: Answer;
  output: Record<string, string>;
} = { output: {} };

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'install-local-hooks-'));
  dirs.push(root);
  const write = (dir: string, artifact: unknown) => {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(artifact, null, 2), 'utf8');
  };
  const apps = {
    handler: join(root, 'handler-app'),
    body: join(root, 'body-app'),
    expr: join(root, 'expr-app'),
    limit: join(root, 'limit-app'),
    good: join(root, 'good-app'),
  };
  write(apps.handler, HANDLER_ARTIFACT);
  write(apps.body, BODY_ARTIFACT);
  write(apps.expr, EXPR_ARTIFACT);
  write(apps.limit, LIMIT_ARTIFACT);
  write(apps.good, GOOD_ARTIFACT);

  // The runtime boots the HOST artifact — never a package — so the packages
  // reach it only through the install, or through the ledger.
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const hostArtifact = join(runtimeDir, 'host.json');
  writeFileSync(hostArtifact, JSON.stringify(HOST_ARTIFACT, null, 2), 'utf8');
  writeFileSync(join(runtimeDir, 'runtime.mjs'), HOST_RUNTIME_MODULE, 'utf8');
  const home = join(runtimeDir, 'home');
  const port = randomPort();

  // ── boot 1: the host; hot installs ─────────────────────────────────────
  const first = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token = await authenticate(first);
  readings.handlerInstall = await packageInstall(apps.handler, first);
  readings.bodyInstall = await packageInstall(apps.body, first);
  readings.exprInstall = await packageInstall(apps.expr, first);
  readings.limitInstall = await packageInstall(apps.limit, first);
  readings.goodInstall = await packageInstall(apps.good, first);
  readings.installed = await http(first, 'GET', '/api/v1/marketplace/install-local', token);
  readings.bodyInsert = await http(first, 'POST', `/api/v1/data/${BODY_TASK}`, token, { name: 'control' });
  readings.hostInsert = await http(first, 'POST', `/api/v1/data/${HOST_TASK}`, token, { name: 'host' });
  readings.goodRuns = await awaitRuns(first, token, HOST_TICK, GOOD_JOB);
  readings.limitRows = await http(first, 'GET', `/api/v1/data/${HOST_TICK}?name=${LIMIT_JOB}&limit=500`, token);
  readings.output.install = first.output();
  await stopGroup(first.child);

  // ── boot 2: same host, home and cwd, plus a ledger entry an earlier build wrote ──
  const ledger = join(runtimeDir, '.objectstack', 'installed-packages');
  mkdirSync(ledger, { recursive: true });
  writeFileSync(join(ledger, `${LEGACY_APP_ID}.json`), JSON.stringify(LEGACY_ENTRY, null, 2), 'utf8');
  const second = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token2 = await authenticate(second);
  readings.legacyInsert = await http(second, 'POST', `/api/v1/data/${LEGACY_TASK}`, token2, { name: 'legacy' });
  readings.output.restart = second.output();
  await stopGroup(second.child);
}, 2 * BOOT_TIMEOUT_MS + 6 * 120_000 + RUN_WAIT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

const transcript = (phase: string) => `\n--- ${phase} output ---\n${(readings.output[phase] ?? '').slice(-3000)}`;

describe('#21585: install-local refuses a hook with no body', () => {
  it('a package whose hook has no body is REFUSED — non-zero exit, its code and remedy — and nothing of it is installed', () => {
    const run = readings.handlerInstall!;
    expect(run.exit, run.output).toBe(1);
    // The CLI names the code the runtime answered with, and the remedy.
    expect(run.output).toMatch(/Install failed \(422 VALIDATION_ERROR\)/);
    expect(run.output).toContain(HANDLER_HOOK);
    expect(run.output).toMatch(/give the hook a `body`/i);
    expect(run.output).toMatch(/os start --artifact/);
    const listing = readings.installed!;
    expect(listing.status, JSON.stringify(listing.body)).toBe(200);
    expect(JSON.stringify(listing.body), 'a refused package must leave nothing in the ledger').not.toContain(HANDLER_APP_ID);
  });

  it('control: the body-hook package installs (exit 0), and its hook fires on insert', () => {
    const run = readings.bodyInstall!;
    expect(run.exit, run.output).toBe(0);
    expect(run.output).toMatch(/Package installed into the running kernel/);
    const inserted = readings.bodyInsert!;
    expect(inserted.status, JSON.stringify(inserted.body)).toBe(201);
    expect(record(inserted)?.status, `null = the body hook never ran${transcript('install')}`).toBe('body');
  });

  it("the `--artifact` boot is unchanged: the host's own handler hook binds to its own runtime module and fires", () => {
    const inserted = readings.hostInsert!;
    expect(inserted.status, JSON.stringify(inserted.body)).toBe(201);
    expect(record(inserted)?.status, `the host's own handler hook did not fire${transcript('install')}`).toBe('host');
  });
});

describe('#21585: install-local refuses a job whose body the declaration refuses', () => {
  it('an expression (L1) job body is refused — non-zero exit, the refused key named', () => {
    const run = readings.exprInstall!;
    expect(run.exit, run.output).toBe(1);
    expect(run.output).toMatch(/Install failed \(422 VALIDATION_ERROR\)/);
    expect(run.output).toContain(EXPR_JOB);
    expect(run.output).toContain('body.language');
    expect(JSON.stringify(readings.installed!.body)).not.toContain(EXPR_APP_ID);
  });

  it('a job body carrying timeoutMs is refused — non-zero exit, the one limit named — and it never runs', () => {
    const run = readings.limitInstall!;
    expect(run.exit, run.output).toBe(1);
    expect(run.output).toMatch(/Install failed \(422 VALIDATION_ERROR\)/);
    expect(run.output).toContain(LIMIT_JOB);
    expect(run.output).toContain('body.timeoutMs');
    expect(JSON.stringify(readings.installed!.body)).not.toContain(LIMIT_APP_ID);
    expect(rowsOf(readings.limitRows!)).toEqual([]);
  });

  it('control: a valid body job installs (exit 0) and runs on its schedule', () => {
    const run = readings.goodInstall!;
    expect(run.exit, run.output).toBe(0);
    const answer = readings.goodRuns!;
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(rowsOf(answer).length, `the installed body job never ran${transcript('install')}`).toBeGreaterThan(0);
  });
});

describe('#21585: rehydrate of an entry an earlier build installed', () => {
  it('the package still rehydrates and its body hook fires; its hook with no body runs nothing', () => {
    const inserted = readings.legacyInsert!;
    expect(inserted.status, `the rehydrated package's object does not answer${transcript('restart')}`).toBe(201);
    expect(record(inserted)?.status, `'body' alone = only the body hook ran${transcript('restart')}`).toBe('body');
  });

  it('…and the hook with no body is warned by name, NOT bound', () => {
    const out = readings.output.restart ?? '';
    const line = out.split('\n').find((l) => l.includes(LEGACY_HOOK) && l.includes('NOT bound'));
    expect(line, `no warn names the withheld hook${transcript('restart')}`).toBeDefined();
  });
});
