// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21322 — a hot install (`os package install <artifact>` into a RUNNING
 * `os start`) leaves the runtime in the state a restart would: the installed
 * package's record-change flow fires and its permission set is projected into
 * `sys_permission_set`, both right after the install, with no restart.
 *
 * ## The defect, measured on the published train and again on `main`
 *
 * The install registered the package's metadata (`GET /meta/permission` named
 * the set, `GET /meta/flow` named the flow) and nothing that the boot does
 * AFTER registration at `kernel:ready`:
 *
 *   - the record-change flow `task_completed_note` never fired — a task updated
 *     to `done` wrote no note;
 *   - `sys_permission_set` had no `tasks_app_task_user` row, so an admin could
 *     not grant the installed app's set to anyone;
 *
 * and both appeared after a restart on the same home, because the boot's own
 * `kernel:ready` sweeps (the automation plugin's flow sync, the security
 * plugin's declared-permission seeding) read the rehydrated package. Those
 * sweeps run once per boot; nothing re-ran them for a package that arrived
 * after it.
 *
 * ## What each `it` reads
 *
 * One fixture, three phases — after the hot INSTALL, after a RESTART on the
 * same home (the ledger rehydrate), and the `--artifact` CONTROL on a fresh
 * home — each probed through the doors a user uses: the data route for the
 * permission-set row and for the flow's effect (a task updated to `done`, then
 * the note it should have written). The restart and the control are the
 * unchanged paths; they must read exactly what the install now reads.
 *
 * ## Spawn shape
 *
 * Shared with `package-install-local-handlers.integration.test.ts` (#21321):
 * the tsx source entry, one process group per `os start`, every workspace
 * package — `@objectstack/runtime` and `@objectstack/cloud-connection`
 * included — resolved through its `exports` to `dist/`, so an ablation of
 * either package's source reaches this file only after that package is rebuilt.
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
const TASK = 'tasks_app_task';
const NOTE = 'tasks_app_note';
const PERMISSION_SET = 'tasks_app_task_user';
/** The development dev-admin seed — see the #21321 sibling for why it is the operator on every boot. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

/** `dist/objectstack.json` as `os build` writes it for this app (schema defaults trimmed). */
const ARTIFACT = {
  manifest: { id: APP_ID, namespace: 'tasks_app', version: '0.1.0', type: 'app', name: 'Tasks App' },
  requires: ['automation', 'triggers'],
  objects: [
    {
      name: TASK,
      label: 'Task',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        status: { type: 'text', label: 'Status' },
      },
    },
    {
      name: NOTE,
      label: 'Note',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
  flows: [{
    name: 'task_completed_note',
    label: 'Task Completed Note',
    type: 'record_change',
    status: 'active',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'On Task Update',
        config: { objectName: TASK, triggerType: 'record-after-update', condition: "record.status == 'done'" },
      },
      {
        id: 'note',
        type: 'create_record',
        label: 'Write Note',
        // A CEL value envelope — the `{…}` template dialect is retired from
        // value slots (#19939).
        config: { objectName: NOTE, fields: { name: { dialect: 'cel', source: "'Completed: ' + record.name" } } },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'note' },
      { id: 'e2', source: 'note', target: 'end' },
    ],
  }],
  permissions: [{
    name: PERMISSION_SET,
    label: 'Tasks App Task User',
    objects: {
      [TASK]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      [NOTE]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
  }],
};

/**
 * The RUNTIME the package is installed into. `os start` composes its services
 * from the boot stack's `requires`, never from a package installed later, and
 * the always-on slate carries neither the automation engine nor the triggers —
 * so an EMPTY kernel runs no flow at all, before or after a restart. This host
 * declares the two capabilities a flow needs and nothing else.
 */
const HOST_ARTIFACT = {
  manifest: { id: 'com.example.host', namespace: 'host', version: '0.1.0', type: 'app', name: 'Host' },
  requires: ['automation', 'triggers'],
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

/** One exchange against the running `os start`, attributed to the child if the transport fails. ⛔ No assertion inside it. */
function http(live: LiveStart, method: string, path: string, token: string, body?: unknown): Promise<Answer> {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'package-install-local-boot-steps',
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

const recordOf = (a: Answer) => a.body?.data ?? a.body?.record ?? a.body;

interface Phase {
  /** `GET /data/sys_permission_set?name=…` — the projection the admin surface grants from. */
  permissionSet: Answer;
  /** The task the flow is driven through: created, then updated to `done`. */
  created: Answer;
  updated: Answer;
  /** `GET /data/tasks_app_note?name=Completed: …` — what the flow should have written. */
  notes: Answer;
}

let seq = 0;
async function probe(live: LiveStart, token: string): Promise<Phase> {
  const permissionSet = await http(live, 'GET', `/api/v1/data/sys_permission_set?name=${PERMISSION_SET}`, token);

  const taskName = `flow-probe-${++seq}`;
  const created = await http(live, 'POST', `/api/v1/data/${TASK}`, token, { name: taskName, status: 'open' });
  const id = recordOf(created)?.id;
  const updated = await http(live, 'PATCH', `/api/v1/data/${TASK}/${id}`, token, { status: 'done' });
  const noteName = encodeURIComponent(`Completed: ${taskName}`);
  // The record-change trigger dispatches after the update commits; read the
  // note back for a bounded while rather than once, so a flow that fires a
  // beat after the 200 is not misread as one that never fires.
  let notes = await http(live, 'GET', `/api/v1/data/${NOTE}?name=${noteName}`, token);
  for (let i = 0; i < 20 && rowsOf(notes).length === 0; i++) {
    await new Promise((r) => setTimeout(r, 250));
    notes = await http(live, 'GET', `/api/v1/data/${NOTE}?name=${noteName}`, token);
  }
  return { permissionSet, created, updated, notes };
}

const phases: Record<'install' | 'restart' | 'control', Phase | undefined> = {
  install: undefined, restart: undefined, control: undefined,
};
const installs: Array<{ exit: number | null; output: string }> = [];

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'install-local-boot-steps-'));
  dirs.push(root);
  const appDir = join(root, 'app');
  mkdirSync(join(appDir, 'dist'), { recursive: true });
  writeFileSync(join(appDir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT, null, 2), 'utf8');
  // The runtime boots the HOST artifact — never the package — so the package
  // reaches it only through the install.
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  const hostArtifact = join(runtimeDir, 'host.json');
  writeFileSync(hostArtifact, JSON.stringify(HOST_ARTIFACT, null, 2), 'utf8');
  const home = join(runtimeDir, 'home');
  const port = randomPort();

  // ── boot 1: the host, hot install, probe ───────────────────────────────
  const first = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
  const token = await authenticate(first);
  installs.push(await packageInstall(appDir, first));
  phases.install = await probe(first, token);
  await stopGroup(first.child);

  // ── boot 2: same host, home and cwd — the ledger rehydrates on kernel:ready ──
  const second = await bootStart(runtimeDir, home, port, ['--artifact', hostArtifact]);
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

describe('#21322: a hot install binds what the boot binds', () => {
  it('`os package install` succeeds (harness health)', () => {
    for (const run of installs) {
      expect(run.exit, run.output).toBe(0);
      expect(run.output).toMatch(/Package installed into the running kernel/);
    }
  });

  for (const name of ['install', 'restart', 'control'] as const) {
    describe(`after ${name}`, () => {
      it('the package permission set is projected into sys_permission_set', () => {
        const p = phases[name]!;
        expect(p.permissionSet.status, JSON.stringify(p.permissionSet.body)).toBe(200);
        expect(rowsOf(p.permissionSet).map((r) => r?.name)).toEqual([PERMISSION_SET]);
      });

      it('the record-change flow fires: a task updated to done writes its note', () => {
        const p = phases[name]!;
        expect(p.created.status, JSON.stringify(p.created.body)).toBe(201);
        expect(p.updated.status, JSON.stringify(p.updated.body)).toBe(200);
        expect(p.notes.status, JSON.stringify(p.notes.body)).toBe(200);
        expect(rowsOf(p.notes), 'no note — the flow never fired').toHaveLength(1);
      });
    });
  }
});
