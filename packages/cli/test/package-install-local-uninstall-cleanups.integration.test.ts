// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21490 — an install-local uninstall (`DELETE /api/v1/marketplace/install-local/:id`)
 * runs the protocol's registered uninstall cleanups, so the package's permission
 * sets and their bindings die with it (ADR-0090: "No ghost grants").
 *
 * ## The defect, measured at this door on `main` 9ff74285f1
 *
 * A package installed through install-local declares a permission set, and the
 * set is projected into `sys_permission_set` with `managed_by: package` (#21322
 * made that happen on the hot install, as a restart already did). The DELETE
 * answered 200 and removed the ledger entry, and nothing else: the package's
 * object answered 404 after a restart, but its `sys_permission_set` row — and
 * every grant of it — survived, on both orders of events:
 *
 *   - hot install → DELETE → restart;
 *   - install → restart → DELETE → restart.
 *
 * The protocol's own uninstall (`deletePackage`) runs every cleanup a domain
 * plugin registered through `registerUninstallCleanup` — plugin-security's
 * `security.package-permissions` is the one that removes package-owned sets with
 * their position and user bindings. This door never ran that registry.
 *
 * ## What each `it` reads
 *
 * One fixture, two orders of events, each probed through the data route a user
 * and an admin use: the set by name, the user grant of it by set id, and — after
 * the restart — the package's object. The grant is made through the data door
 * before the uninstall, so "no binding" is read off a row that existed, not off
 * an empty table.
 *
 * A third order of events measures the re-seed window — DELETE, then a hot
 * install of ANOTHER package, then restart — and records, as `it.fails`, the
 * defect it found there; the block above that `describe` says what it is.
 *
 * ## Spawn shape
 *
 * Shared with `package-install-local-boot-steps.integration.test.ts` (#21322):
 * the tsx source entry, one process group per `os start`, every workspace
 * package — `@objectstack/cloud-connection` and `@objectstack/metadata-protocol`
 * included — resolved through its `exports` to `dist/`, so an ablation of either
 * package's source reaches this file only after that package is rebuilt. Every
 * boot runs in `beforeAll`; the `it`s only read what the phases recorded.
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
const PERMISSION_SET = 'tasks_app_task_user';
const UNINSTALL = `/api/v1/marketplace/install-local/${APP_ID}`;
/** The development dev-admin seed — see the #21321 sibling for why it is the operator on every boot. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

/** `dist/objectstack.json` as `os build` writes it for this app (schema defaults trimmed). */
const ARTIFACT = {
  manifest: { id: APP_ID, namespace: 'tasks_app', version: '0.1.0', type: 'app', name: 'Tasks App' },
  objects: [{
    name: TASK,
    label: 'Task',
    sharingModel: 'public_read_write',
    fields: { name: { type: 'text', label: 'Name' } },
  }],
  permissions: [{
    name: PERMISSION_SET,
    label: 'Tasks App Task User',
    objects: { [TASK]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
  }],
};

/**
 * A second, unrelated package for the re-seed order of events: its hot install
 * announces `metadata:reloaded`, which re-runs plugin-security's
 * declared-permission seeding over every package the running kernel still holds.
 */
const OTHER_APP_ID = 'com.example.notesapp';
const OTHER_ARTIFACT = {
  manifest: { id: OTHER_APP_ID, namespace: 'notes_app', version: '0.1.0', type: 'app', name: 'Notes App' },
  objects: [{
    name: 'notes_app_note',
    label: 'Note',
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

function bootStart(cwd: string, home: string, port: string): Promise<LiveStart> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, 'start', '-p', port, '--home', home, '--auth-secret', E2E_SECRET_KEY, '--no-ui'], {
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
      label: 'package-install-local-uninstall-cleanups',
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

interface Session { token: string; userId: string }

async function authenticate(live: LiveStart): Promise<Session> {
  const res = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
  const token = res.body?.token;
  const userId = res.body?.user?.id;
  if (res.status !== 200 || typeof token !== 'string' || typeof userId !== 'string') {
    throw new Error(`auth answered ${res.status}: ${JSON.stringify(res.body)}\n--- output ---\n${live.output().slice(-3000)}`);
  }
  return { token, userId };
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

/** What the data route answers about the package's grants at one moment. */
interface Grants {
  /** `GET /data/sys_permission_set?name=…` — the projection the admin surface grants from. */
  sets: Answer;
  /** `GET /data/sys_user_permission_set?permission_set_id=…` — the user grant made before the uninstall. */
  bindings: Answer;
}

async function readGrants(live: LiveStart, token: string, setId: string): Promise<Grants> {
  return {
    sets: await http(live, 'GET', `/api/v1/data/sys_permission_set?name=${PERMISSION_SET}`, token),
    bindings: await http(live, 'GET', `/api/v1/data/sys_user_permission_set?permission_set_id=${encodeURIComponent(setId)}`, token),
  };
}

/** One order of events, recorded phase by phase; the `it`s read it. */
interface Run {
  install?: { exit: number | null; output: string };
  /** The set and its grant, as they stood right before the DELETE. */
  before?: Grants;
  /** `POST /data/sys_user_permission_set` — the grant whose survival is the defect's second half. */
  granted?: Answer;
  setId?: string;
  uninstall?: Answer;
  /** Same process, right after the DELETE answered. */
  after?: Grants;
  /** A restart on the same home. */
  restarted?: Grants;
  /** The package's object after the restart — the uninstall's own effect, as the control. */
  object?: Answer;
  /** Re-seed order only: the hot install of {@link OTHER_APP_ID} after the DELETE. */
  otherInstall?: { exit: number | null; output: string };
  /** Re-seed order only: same process, right after that second install. */
  afterOtherInstall?: Grants;
}

/**
 * Read the set, grant it to the operator, DELETE the package, read again.
 * The grant is made here, on whichever boot runs the uninstall, so it is
 * the same act on both orders of events.
 */
async function grantThenUninstall(live: LiveStart, session: Session, run: Run): Promise<void> {
  const sets = await http(live, 'GET', `/api/v1/data/sys_permission_set?name=${PERMISSION_SET}`, session.token);
  const setId = rowsOf(sets)[0]?.id;
  if (typeof setId !== 'string') {
    throw new Error(`precondition: no ${PERMISSION_SET} row to grant — ${sets.status} ${JSON.stringify(sets.body)}\n--- output ---\n${live.output().slice(-3000)}`);
  }
  run.setId = setId;
  run.granted = await http(live, 'POST', '/api/v1/data/sys_user_permission_set', session.token, {
    user_id: session.userId,
    permission_set_id: setId,
  });
  run.before = await readGrants(live, session.token, setId);
  run.uninstall = await http(live, 'DELETE', UNINSTALL, session.token);
  run.after = await readGrants(live, session.token, setId);
}

async function readAfterRestart(live: LiveStart, run: Run): Promise<void> {
  const { token } = await authenticate(live);
  run.restarted = await readGrants(live, token, run.setId!);
  run.object = await http(live, 'GET', `/api/v1/data/${TASK}`, token);
}

const runs: Record<'hot' | 'restarted' | 'reseed', Run> = { hot: {}, restarted: {}, reseed: {} };

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'install-local-uninstall-'));
  dirs.push(root);
  const appDir = join(root, 'app');
  mkdirSync(join(appDir, 'dist'), { recursive: true });
  writeFileSync(join(appDir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT, null, 2), 'utf8');
  const otherAppDir = join(root, 'other-app');
  mkdirSync(join(otherAppDir, 'dist'), { recursive: true });
  writeFileSync(join(otherAppDir, 'dist', 'objectstack.json'), JSON.stringify(OTHER_ARTIFACT, null, 2), 'utf8');
  const port = randomPort();

  // ── order 1: hot install → DELETE → restart ────────────────────────────
  const hotDir = join(root, 'hot');
  mkdirSync(hotDir, { recursive: true });
  const hotHome = join(hotDir, 'home');
  const a = await bootStart(hotDir, hotHome, port);
  const aSession = await authenticate(a);
  runs.hot.install = await packageInstall(appDir, a);
  await grantThenUninstall(a, aSession, runs.hot);
  await stopGroup(a.child);
  const b = await bootStart(hotDir, hotHome, port);
  await readAfterRestart(b, runs.hot);
  await stopGroup(b.child);

  // ── order 2: install → restart → DELETE → restart ──────────────────────
  // The DELETE meets a package the ledger REHYDRATED, not one this process
  // hot-installed — the path that existed before #21322's change.
  const coldDir = join(root, 'cold');
  mkdirSync(coldDir, { recursive: true });
  const coldHome = join(coldDir, 'home');
  const c = await bootStart(coldDir, coldHome, port);
  await authenticate(c);
  runs.restarted.install = await packageInstall(appDir, c);
  await stopGroup(c.child);
  const d = await bootStart(coldDir, coldHome, port);
  await grantThenUninstall(d, await authenticate(d), runs.restarted);
  await stopGroup(d.child);
  const e = await bootStart(coldDir, coldHome, port);
  await readAfterRestart(e, runs.restarted);
  await stopGroup(e.child);

  // ── order 3: hot install → DELETE → hot install of ANOTHER package → restart ──
  // The DELETE does not withdraw the package from the running kernel, so it is
  // still registered when the second install announces `metadata:reloaded`.
  const reseedDir = join(root, 'reseed');
  mkdirSync(reseedDir, { recursive: true });
  const reseedHome = join(reseedDir, 'home');
  const f = await bootStart(reseedDir, reseedHome, port);
  const fSession = await authenticate(f);
  runs.reseed.install = await packageInstall(appDir, f);
  await grantThenUninstall(f, fSession, runs.reseed);
  runs.reseed.otherInstall = await packageInstall(otherAppDir, f);
  runs.reseed.afterOtherInstall = await readGrants(f, fSession.token, runs.reseed.setId!);
  await stopGroup(f.child);
  const g = await bootStart(reseedDir, reseedHome, port);
  await readAfterRestart(g, runs.reseed);
  await stopGroup(g.child);
}, 8 * BOOT_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#21490: an install-local uninstall runs the registered uninstall cleanups', () => {
  for (const name of ['hot', 'restarted'] as const) {
    describe(`${name === 'hot' ? 'hot install' : 'install → restart'} → DELETE → restart`, () => {
      it('precondition: the install landed, and the set and its grant exist before the DELETE', () => {
        const run = runs[name];
        expect(run.install?.exit, run.install?.output).toBe(0);
        expect(run.granted?.status, JSON.stringify(run.granted?.body)).toBe(201);
        expect(rowsOf(run.before!.sets).map((r) => [r?.name, r?.managed_by, r?.package_id]))
          .toEqual([[PERMISSION_SET, 'package', APP_ID]]);
        expect(rowsOf(run.before!.bindings).map((r) => r?.id)).toEqual([recordOf(run.granted!)?.id]);
      });

      it('the DELETE answers 200 and reports the security cleanup it ran', () => {
        const run = runs[name];
        expect(run.uninstall?.status, JSON.stringify(run.uninstall?.body)).toBe(200);
        const cleanups: any[] = run.uninstall?.body?.data?.cleanups ?? [];
        const security = cleanups.find((o) => o?.name === 'security.package-permissions');
        expect(security, JSON.stringify(run.uninstall?.body)).toMatchObject({ success: true });
      });

      it('right after the DELETE: no package-managed set, no grant of it', () => {
        const run = runs[name];
        expect(run.after!.sets.status).toBe(200);
        expect(rowsOf(run.after!.sets), JSON.stringify(run.after!.sets.body)).toEqual([]);
        expect(run.after!.bindings.status).toBe(200);
        expect(rowsOf(run.after!.bindings), JSON.stringify(run.after!.bindings.body)).toEqual([]);
      });

      it('after a restart: still no set and no grant, and the package object is gone', () => {
        const run = runs[name];
        expect(run.object?.status, JSON.stringify(run.object?.body)).toBe(404);
        expect(run.restarted!.sets.status).toBe(200);
        expect(rowsOf(run.restarted!.sets), JSON.stringify(run.restarted!.sets.body)).toEqual([]);
        expect(run.restarted!.bindings.status).toBe(200);
        expect(rowsOf(run.restarted!.bindings), JSON.stringify(run.restarted!.bindings.body)).toEqual([]);
      });
    });
  }

  // ── The re-seed window: MEASURED RED, reported for filing, not fixed here ──
  //
  // This DELETE leaves the package registered in the running kernel until the
  // next restart (the response's own note says so), and plugin-security's
  // `metadata:reloaded` subscriber re-runs the declared-permission seeding over
  // every package the kernel holds. So another package's hot install before
  // that restart re-projects the uninstalled package's set as a fresh
  // `managed_by: package` row, and the restart leaves it orphaned: the package
  // is gone, its set is not. The grant does NOT come back — the cleanup deleted
  // the binding and the seeding writes none — and that half is pinned plainly.
  //
  // The two set readings are `it.fails`: each turns red the day its half is
  // fixed, which is the cue to promote it to a plain assertion.
  describe('hot install → DELETE → hot install of another package → restart (the re-seed window)', () => {
    it('precondition: both installs landed, and the DELETE revoked the set and its grant', () => {
      const run = runs.reseed;
      expect(run.install?.exit, run.install?.output).toBe(0);
      expect(run.otherInstall?.exit, run.otherInstall?.output).toBe(0);
      expect(run.granted?.status, JSON.stringify(run.granted?.body)).toBe(201);
      expect(rowsOf(run.before!.sets).map((r) => [r?.name, r?.managed_by, r?.package_id]))
        .toEqual([[PERMISSION_SET, 'package', APP_ID]]);
      expect(run.uninstall?.status, JSON.stringify(run.uninstall?.body)).toBe(200);
      expect(rowsOf(run.after!.sets), JSON.stringify(run.after!.sets.body)).toEqual([]);
      expect(rowsOf(run.after!.bindings), JSON.stringify(run.after!.bindings.body)).toEqual([]);
    });

    it('the grant stays revoked through the other install and the restart, and the package object is gone', () => {
      const run = runs.reseed;
      for (const answer of [run.afterOtherInstall!.sets, run.afterOtherInstall!.bindings, run.restarted!.sets, run.restarted!.bindings]) {
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      }
      expect(rowsOf(run.afterOtherInstall!.bindings), JSON.stringify(run.afterOtherInstall!.bindings.body)).toEqual([]);
      expect(rowsOf(run.restarted!.bindings), JSON.stringify(run.restarted!.bindings.body)).toEqual([]);
      expect(run.object?.status, JSON.stringify(run.object?.body)).toBe(404);
    });

    it.fails('KNOWN-BROKEN: the other package\'s hot install re-projects the uninstalled package\'s set (promote to a plain assertion once fixed)', () => {
      const run = runs.reseed;
      expect(rowsOf(run.afterOtherInstall!.sets), JSON.stringify(run.afterOtherInstall!.sets.body)).toEqual([]);
    });

    it.fails('KNOWN-BROKEN: that re-projected set survives the restart as an orphan row (promote to a plain assertion once fixed)', () => {
      const run = runs.reseed;
      expect(rowsOf(run.restarted!.sets), JSON.stringify(run.restarted!.sets.body)).toEqual([]);
    });
  });
});
