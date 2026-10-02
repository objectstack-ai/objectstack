// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21321 — an app installed with `os package install <artifact>` runs its
 * script actions and its body hooks exactly as the same artifact does under
 * `os start --artifact`, on the real composition, across a reinstall and a
 * restart.
 *
 * ## The defect, measured on the published train and again on `main` f39760864c
 *
 * `os start` (empty kernel) → `os package install ./dist/objectstack.json` (the
 * documented air-gapped install-local path) registered the app's objects and
 * declarations, and bound none of its handlers:
 *
 *   - REST `POST /api/v1/actions/<obj>/complete_task`  → 404 RESOURCE_NOT_FOUND
 *   - MCP  `run_action complete_task`                  → "No handler registered …"
 *   - MCP  `list_actions`                              → still lists complete_task
 *   - a `beforeInsert` body hook                       → never ran (status null)
 *
 * before AND after a restart, while `os start --artifact` of the same file
 * answered 200, `run_action ok`, and stamped the row. `AppPlugin.start` was the
 * only binder; the install route and the ledger rehydrate never reached it.
 *
 * ## What each `it` reads
 *
 * One fixture, four phases — after the install, after a REINSTALL of the same
 * file, after a RESTART on the same home, and the `--artifact` CONTROL on a
 * fresh home — each probed through the doors a user and an agent actually use:
 * the data route (the hook), the REST action door, and MCP over Streamable HTTP
 * with a minted API key (`list_actions`, `run_action`). The hook APPENDS to
 * `status`, so a hook bound twice answers `stampedstamped`: "exactly one binding
 * after a reinstall" is read off a row, not off an internal registry.
 *
 * `ghost_task` is a declared, AI-exposed `script` action whose `target` no code
 * ever registers. It is the advertisement half: `list_actions` must not offer
 * what `run_action` refuses, so it is absent from every listing, and the run
 * door's refusal is read beside it.
 *
 * ## Spawn shape
 *
 * The tsx source entry (`bin/run-dev.js`), as every `runServe()` caller spawns
 * it, for `os start` and for `os package install` alike. It pins
 * `NODE_ENV=development`, which lets `serve` auto-shift off a port taken
 * between the probe and the bind, so the ready banner is read back
 * (`portDriftError`) before any request is addressed to the port. The CLI runs
 * from `src/`, but every workspace package it loads — `@objectstack/runtime`
 * and `@objectstack/cloud-connection` included — resolves through its
 * `exports` to `dist/`: an ablation of either package's source reaches this
 * file only after that package is rebuilt. Each `os start` gets its own
 * process group and is stopped by signalling the group (`os start` supervises
 * a `serve` grandchild).
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

const APP_ID = 'com.example.tasksapp';
const OBJECT = 'tasks_app_task';
/**
 * The development dev-admin seed (`objectstack dev`'s documented, loginable
 * admin — `admin@objectos.ai` / `admin123`, promoted to platform admin): the
 * tsx entry runs `os start` in development, which seeds it on every boot that
 * finds no login, so it is the operator on all three boots and holds the
 * `manage_metadata` capability the install route demands.
 */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

const COMPLETE_TASK = {
  name: 'complete_task',
  label: 'Complete Task',
  objectName: OBJECT,
  locations: ['record_header'],
  type: 'script',
  body: {
    language: 'js',
    capabilities: ['api.write'],
    source:
      `var id = ctx.recordId; await ctx.api.object('${OBJECT}').update({ id: id, status: 'done', done: true }); `
      + 'return { ok: true, id: id };',
  },
  ai: { exposed: true, description: 'Mark a task as complete: sets its status to done and ticks the Done box.' },
};
const GHOST_TASK = {
  name: 'ghost_task',
  label: 'Ghost Task',
  objectName: OBJECT,
  type: 'script',
  target: 'ghostTaskHandler',
  ai: { exposed: true, description: 'Declared and AI-exposed; no code ever registers its handler.' },
};

/** `dist/objectstack.json` as `os build` writes it for this app (schema defaults trimmed). */
const ARTIFACT = {
  manifest: { id: APP_ID, namespace: 'tasks_app', version: '0.1.0', type: 'app', name: 'Tasks App' },
  objects: [{
    name: OBJECT,
    label: 'Task',
    sharingModel: 'public_read_write',
    fields: {
      name: { type: 'text', label: 'Name' },
      status: { type: 'text', label: 'Status' },
      done: { type: 'boolean', label: 'Done' },
    },
    actions: [COMPLETE_TASK, GHOST_TASK],
  }],
  actions: [COMPLETE_TASK, GHOST_TASK],
  hooks: [{
    name: 'tasks_app_stamp_status',
    label: 'Stamp Status',
    object: OBJECT,
    events: ['beforeInsert'],
    // APPENDS, so a double binding is visible on the row.
    body: { language: 'js', source: "ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + 'stamped';" },
    onError: 'abort',
  }],
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
      // `childEnv`, never a bare `...process.env` — see its header.
      env: childEnv({ NO_COLOR: '1', OS_CLOUD_URL: 'off', OS_LOG_LEVEL: 'warn', OS_SECRET_KEY: E2E_SECRET_KEY }),
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

/**
 * One exchange against the running `os start`, attributed to the child if the
 * transport fails (`probeThroughChild`: a dead child is named with its
 * transcript; a socket the live server dropped — the keep-alive connection an
 * idle stretch outlives — is absorbed and retried, loudly, a bounded number of
 * times). ⛔ No assertion inside it.
 */
function exchange<T>(live: LiveStart, what: string, run: () => Promise<T>): Promise<T> {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'package-install-local-handlers',
      what,
    },
    run,
  );
}

function http(live: LiveStart, method: string, path: string, token: string, body?: unknown): Promise<Answer> {
  return exchange(live, `${method} ${path}`, async () => {
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
  });
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
 * ⛔ Asynchronous on purpose: a `spawnSync` would stop this process draining
 * the server's stdout/stderr pipes for the whole install, and a server that
 * fills its pipe while the install waits on it blocks until the timeout.
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

/** One MCP JSON-RPC call over Streamable HTTP; the tool's JSON text, parsed. */
async function mcpTool(live: LiveStart, apiKey: string, name: string, args: Record<string, unknown>) {
  const text = await exchange(live, `MCP tools/call ${name}`, async () => {
    const r = await fetch(`${live.base}/api/v1/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': apiKey },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return r.text();
  });
  const data = text.split('\n').find((l) => l.startsWith('data:'));
  const envelope = JSON.parse(data ? data.slice(5) : text);
  const content = envelope?.result?.content?.[0]?.text;
  let payload: any = content;
  try { payload = JSON.parse(content); } catch { /* a refusal is prose */ }
  return { isError: envelope?.result?.isError === true, payload };
}

interface Phase {
  inserted: Answer;
  restAction: Answer;
  afterRest: Answer;
  listed: string[];
  run: { isError: boolean; payload: any };
  afterRun: Answer;
  ghostRun: { isError: boolean; payload: any };
}

let seq = 0;
async function probe(live: LiveStart, token: string): Promise<Phase> {
  const key = await http(live, 'POST', '/api/v1/keys', token, { name: `mcp-${++seq}` });
  const apiKey = key.body?.data?.key ?? key.body?.key;
  if (typeof apiKey !== 'string') throw new Error(`POST /api/v1/keys answered ${key.status}: ${JSON.stringify(key.body)}`);

  const inserted = await http(live, 'POST', `/api/v1/data/${OBJECT}`, token, { name: `rest-${seq}` });
  const id = inserted.body?.data?.id ?? inserted.body?.id;
  const restAction = await http(live, 'POST', `/api/v1/actions/${OBJECT}/complete_task`, token, { recordId: id });
  const afterRest = await http(live, 'GET', `/api/v1/data/${OBJECT}/${id}`, token);

  const second = await http(live, 'POST', `/api/v1/data/${OBJECT}`, token, { name: `mcp-${seq}` });
  const id2 = second.body?.data?.id ?? second.body?.id;
  const list = await mcpTool(live, apiKey, 'list_actions', {});
  const rows: any[] = Array.isArray(list.payload?.actions) ? list.payload.actions : Array.isArray(list.payload) ? list.payload : [];
  const run = await mcpTool(live, apiKey, 'run_action', { actionName: 'complete_task', objectName: OBJECT, recordId: id2 });
  const afterRun = await http(live, 'GET', `/api/v1/data/${OBJECT}/${id2}`, token);
  const ghostRun = await mcpTool(live, apiKey, 'run_action', { actionName: 'ghost_task', objectName: OBJECT, recordId: id2 });
  return { inserted, restAction, afterRest, listed: rows.map((a) => a?.name), run, afterRun, ghostRun };
}

const rec = (a: Answer) => a.body?.data ?? a.body?.record ?? a.body;

const phases: Record<'install' | 'reinstall' | 'restart' | 'control', Phase | undefined> = {
  install: undefined, reinstall: undefined, restart: undefined, control: undefined,
};
const installs: Array<{ exit: number | null; output: string }> = [];

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'install-local-handlers-'));
  dirs.push(root);
  const appDir = join(root, 'app');
  mkdirSync(join(appDir, 'dist'), { recursive: true });
  writeFileSync(join(appDir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT, null, 2), 'utf8');
  // The runtime's cwd holds no project config, so `os start` boots the EMPTY kernel.
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const home = join(runtimeDir, 'home');
  const port = randomPort();

  // ── boot 1: empty `os start`, install, probe, reinstall, probe ─────────
  const first = await bootStart(runtimeDir, home, port);
  const token = await authenticate(first);
  installs.push(await packageInstall(appDir, first));
  phases.install = await probe(first, token);
  installs.push(await packageInstall(appDir, first));
  phases.reinstall = await probe(first, token);
  await stopGroup(first.child);

  // ── boot 2: same home and cwd — the ledger rehydrates on kernel:ready ──
  const second = await bootStart(runtimeDir, home, port);
  phases.restart = await probe(second, await authenticate(second));
  await stopGroup(second.child);

  // ── boot 3: the CONTROL — the same file as the boot artifact ───────────
  const controlDir = join(root, 'control');
  mkdirSync(controlDir, { recursive: true });
  const third = await bootStart(controlDir, join(controlDir, 'home'), port, ['--artifact', join(appDir, 'dist', 'objectstack.json')]);
  phases.control = await probe(third, await authenticate(third));
  await stopGroup(third.child);
}, 4 * BOOT_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#21321: an install-local package runs its script actions and body hooks', () => {
  it('both `os package install` runs succeed (harness health)', () => {
    for (const run of installs) {
      expect(run.exit, run.output).toBe(0);
      expect(run.output).toMatch(/Package installed into the running kernel/);
    }
  });

  for (const name of ['install', 'reinstall', 'restart', 'control'] as const) {
    describe(`after ${name}`, () => {
      it('the body hook fires exactly once on insert', () => {
        const p = phases[name]!;
        expect(p.inserted.status, JSON.stringify(p.inserted.body)).toBe(201);
        expect(rec(p.inserted)?.status, 'null = the hook never ran; stampedstamped = it is bound twice').toBe('stamped');
      });

      it('REST POST /api/v1/actions runs the script action body', () => {
        const p = phases[name]!;
        expect(p.restAction.status, JSON.stringify(p.restAction.body)).toBe(200);
        expect(p.restAction.body?.data).toMatchObject({ ok: true });
        expect(rec(p.afterRest)).toMatchObject({ status: 'done', done: true });
      });

      it('MCP run_action runs it, and list_actions advertises it', () => {
        const p = phases[name]!;
        expect(p.run.isError, JSON.stringify(p.run.payload)).toBe(false);
        expect(p.run.payload).toMatchObject({ ok: true, action: 'complete_task', result: { ok: true } });
        expect(rec(p.afterRun)).toMatchObject({ status: 'done', done: true });
        expect(p.listed).toContain('complete_task');
      });

      it('list_actions does not advertise a declared action run_action cannot run', () => {
        const p = phases[name]!;
        expect(p.ghostRun.isError, 'precondition: ghost_task has no handler anywhere').toBe(true);
        expect(String(p.ghostRun.payload)).toMatch(/No handler registered/);
        expect(p.listed, 'advertised an action the run door refuses').not.toContain('ghost_task');
      });
    });
  }
});
