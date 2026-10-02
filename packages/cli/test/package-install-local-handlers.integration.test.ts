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
 * `bin/run.js` with `NODE_ENV` unset (hence `requireBuiltCli`) — the operator's
 * entrypoint, and the one whose bind is deterministic (no development
 * auto-shift). Every workspace package the child loads, `@objectstack/runtime`
 * and `@objectstack/cloud-connection` included, resolves through its `exports`
 * to `dist/`: an ablation of either package's source reaches this file only
 * after that package is rebuilt. Each `os start` gets its own process group and
 * is stopped by signalling the group (`os start` supervises a `serve`
 * grandchild).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  E2E_SECRET_KEY,
  portContentionError,
  randomPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_JS = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;

const APP_ID = 'com.example.tasksapp';
const OBJECT = 'tasks_app_task';
const EMAIL = 'owner@example.com';
const PASSWORD = 'Passw0rd!Passw0rd';

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
    const child = spawn(process.execPath, [RUN_JS, 'start', '-p', port, '--home', home, '--auth-secret', E2E_SECRET_KEY, '--no-ui', ...extra], {
      cwd,
      // `childEnv`, never a bare `...process.env` — see its header. `NODE_ENV`
      // unset: the built entrypoint resolves commands from dist/ (#11464).
      env: childEnv({ NODE_ENV: undefined, NO_COLOR: '1', OS_CLOUD_URL: 'off', OS_LOG_LEVEL: 'warn', OS_SECRET_KEY: E2E_SECRET_KEY }),
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
      if (READY.test(out)) settle(null);
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

async function http(live: LiveStart, method: string, path: string, token: string, body?: unknown): Promise<Answer> {
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
}

async function authenticate(live: LiveStart, firstUser: boolean): Promise<string> {
  const res = await http(
    live, 'POST', firstUser ? '/api/v1/auth/sign-up/email' : '/api/v1/auth/sign-in/email', '',
    firstUser ? { email: EMAIL, password: PASSWORD, name: 'Owner' } : { email: EMAIL, password: PASSWORD },
  );
  const token = res.body?.token;
  if (res.status !== 200 || typeof token !== 'string') {
    throw new Error(`auth answered ${res.status}: ${JSON.stringify(res.body)}\n--- output ---\n${live.output().slice(-3000)}`);
  }
  return token;
}

function packageInstall(appDir: string, live: LiveStart): { exit: number | null; output: string } {
  const r = spawnSync(process.execPath, [RUN_JS, 'package', 'install', './dist/objectstack.json', '--runtime', live.base, '--email', EMAIL, '--password', PASSWORD], {
    cwd: appDir,
    encoding: 'utf8',
    env: childEnv({ NODE_ENV: undefined, NO_COLOR: '1' }),
    timeout: 120_000,
  });
  return { exit: r.status, output: `${r.stdout}\n${r.stderr}` };
}

/** One MCP JSON-RPC call over Streamable HTTP; the tool's JSON text, parsed. */
async function mcpTool(live: LiveStart, apiKey: string, name: string, args: Record<string, unknown>) {
  const r = await fetch(`${live.base}/api/v1/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': apiKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await r.text();
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
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
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
  const token = await authenticate(first, true);
  installs.push(packageInstall(appDir, first));
  phases.install = await probe(first, token);
  installs.push(packageInstall(appDir, first));
  phases.reinstall = await probe(first, token);
  await stopGroup(first.child);

  // ── boot 2: same home and cwd — the ledger rehydrates on kernel:ready ──
  const second = await bootStart(runtimeDir, home, port);
  phases.restart = await probe(second, await authenticate(second, false));
  await stopGroup(second.child);

  // ── boot 3: the CONTROL — the same file as the boot artifact ───────────
  const controlDir = join(root, 'control');
  mkdirSync(controlDir, { recursive: true });
  const third = await bootStart(controlDir, join(controlDir, 'home'), port, ['--artifact', join(appDir, 'dist', 'objectstack.json')]);
  phases.control = await probe(third, await authenticate(third, true));
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
