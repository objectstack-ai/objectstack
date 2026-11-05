// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — three refusals that exit before any server starts, then two real `os start` boots (one on explicit settings; one on the defaults, which also signs up an owner, creates a member and reads the notice as each); the file read 27.6 s on a shared local box (no CI reading yet) x 1.25, rounded up to the next 10 s

/**
 * #30120, ruling A3 (record 6634240777) — the official image refuses to start
 * on a disk it would lose; every other `os start` keeps booting, says so in
 * its log, and tells the administrators in the Console.
 *
 * ## The defect, measured on origin/main 47c457b2 and the published 18.3.0 image
 *
 * `os start` with none of `OS_DATABASE_URL`, `OS_AUTH_SECRET`, `OS_SECRET_KEY`
 * booted in production mode on a SQLite file under its home and on two secrets
 * it generated there, and the image did the same inside the container layer:
 * replacing the container lost the data, signed everyone out, and left every
 * saved credential unreadable. The boot log said nothing about it.
 *
 * ## What this pins, at the shipped entry (`bin/run.js` over `dist/`)
 *
 *  1. With the image's switch (`OS_DEPLOYMENT_DURABILITY_CHECK_ENABLED=true`,
 *     the Dockerfile's `ENV`), a start missing any of the three exits 1 and
 *     names exactly the missing ones, before it writes a secret, a key or a
 *     database file.
 *  2. An explicit `OS_DATABASE_URL=file:…` with both secrets passes, and the
 *     boot keeps nothing on its disk by default, so it prints no block.
 *  3. Without the switch, a production `os start` on its defaults boots, and
 *     prints the block naming the three files.
 *  4. On that boot, an administrator reads the three findings from
 *     `GET /api/settings/deployment/notice` with the files the block named, a
 *     member is refused `403`, and neither the public auth config nor the
 *     runtime config carries any of it.
 *
 * The hide's audit row and the route's other refusals are pinned beside the
 * routes (`service-settings` `deployment-notice.routes.test.ts`).
 *
 * ## Spawn shape
 *
 * As `dev-start-shared-data-key.integration.test.ts`: `bin/run.js` with
 * `NODE_ENV` unset (`os start` sets production itself), in an empty project
 * directory (the empty kernel), each boot in its own process group, on a
 * kernel-assigned port read back out of the child's own banner.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  KERNEL_ASSIGNED_PORT,
  portContentionError,
  probeThroughChild,
  readKernelAssignedPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
const SWITCH = 'OS_DEPLOYMENT_DURABILITY_CHECK_ENABLED';

const scratch: string[] = [];
const groups: ChildProcess[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(d);
  return d;
}

/**
 * The overrides every run starts from: no variable of any spelling the subject
 * reads. Each spawn hands them to `childEnv` itself, with `NODE_ENV` unset as
 * the last word, so the child's posture is readable at the call
 * (`check:cli-test-child-env`).
 */
function baseEnv(home: string, over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NO_COLOR: '1',
    HOME: home,
    OS_CLOUD_URL: 'off',
    OS_DISABLE_CONSOLE: '1',
    OS_LOG_LEVEL: 'warn',
    OS_TRUSTED_ORIGINS: 'http://localhost:*',
    [SWITCH]: undefined,
    OS_SECRET_KEY: undefined,
    OS_DEV_CRYPTO_KEY: undefined,
    OBJECTSTACK_DEV_CRYPTO_KEY: undefined,
    OS_INTERNAL_CRYPTO_KEY_FILE: undefined,
    OS_INTERNAL_CRYPTO_KEY_FILE_CANDIDATE: undefined,
    OS_INTERNAL_DEPLOYMENT_FINDINGS: undefined,
    OS_HOME: undefined,
    OBJECTSTACK_HOME: undefined,
    OS_DATABASE_URL: undefined,
    DATABASE_URL: undefined,
    TURSO_DATABASE_URL: undefined,
    OS_ARTIFACT_URL: undefined,
    OS_ARTIFACT_PATH: undefined,
    OS_AUTH_SECRET: undefined,
    AUTH_SECRET: undefined,
    BETTER_AUTH_SECRET: undefined,
    OS_CLUSTER_DRIVER: undefined,
    OS_MODE: undefined,
    OS_PORT: undefined,
    PORT: undefined,
    ...over,
  };
}

/** Everything under `dir`, recursively, as relative paths. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join((e as any).parentPath ?? (e as any).path, e.name).slice(dir.length + 1));
}

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

function boot(what: string, cwd: string, over: Record<string, string | undefined>): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, 'start', '--port', KERNEL_ASSIGNED_PORT], {
      cwd,
      env: childEnv({ ...over, NODE_ENV: undefined }),
      stdio: ['ignore', 'pipe', 'pipe'],
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
      () => settle(new Error(`${what} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      if (READY.test(out)) settle(readKernelAssignedPort(out, what));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(
        portContentionError(out, what, KERNEL_ASSIGNED_PORT)
          ?? new Error(`${what} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`),
      ),
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

/** One exchange, attributed to the child if the transport fails. ⛔ No assertion inside it. */
function http(live: Live, method: string, path: string, token = '', body?: unknown) {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'start-deployment-durability',
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
      return { status: r.status, body: parsed, text };
    },
  );
}

const PASSWORD = 'Durable-30120-pass!';

function tokenOf(live: Live, what: string, r: { status: number; body: any; text: string }): string {
  const token = r.body?.token;
  if (r.status !== 200 || typeof token !== 'string') {
    throw new Error(`${what} answered ${r.status}: ${r.text.slice(0, 1000)}\n--- output ---\n${live.output().slice(-3000)}`);
  }
  return token;
}

/** The first registrant: under the single-tenant posture, the platform administrator. */
async function signUpOwner(live: Live, email: string): Promise<string> {
  const r = await http(live, 'POST', '/api/v1/auth/sign-up/email', '', { email, password: PASSWORD, name: 'Owner' });
  return tokenOf(live, `sign-up of ${email}`, r);
}

/**
 * A member, created by the administrator (self-registration closes after the
 * owner), with no password change pending, so the held-session gate is not
 * what refuses them.
 */
async function createMember(live: Live, adminToken: string, email: string): Promise<string> {
  const created = await http(live, 'POST', '/api/v1/auth/admin/create-user', adminToken, {
    email,
    name: 'Member',
    password: PASSWORD,
    mustChangePassword: false,
  });
  if (created.status !== 200) {
    throw new Error(`create-user answered ${created.status}: ${created.text.slice(0, 1000)}`);
  }
  const r = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email, password: PASSWORD });
  return tokenOf(live, `sign-in of ${email}`, r);
}

const secret = () => randomBytes(32).toString('hex');

beforeAll(() => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
});

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const d of scratch) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}, 60_000);

// ---------------------------------------------------------------------------
// 1 — the image's switch refuses
// ---------------------------------------------------------------------------

describe('#30120 — with the image switch on, a start missing its settings refuses', () => {
  const refuse = (over: Record<string, string | undefined>) => {
    const home = tmp('os-30120-home-');
    const cwd = tmp('os-30120-cwd-');
    const run = spawnSync(process.execPath, [CLI, 'start', '--port', KERNEL_ASSIGNED_PORT], {
      cwd,
      env: childEnv({ ...baseEnv(home, { [SWITCH]: 'true', ...over }), NODE_ENV: undefined }),
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { run, home, cwd, out: `${run.stdout}\n${run.stderr}` };
  };

  it('none set: exit 1, naming all three, before anything is written', () => {
    const { run, home, cwd, out } = refuse({});
    expect(run.status, out).toBe(1);
    expect(out).toContain('OS_DATABASE_URL, OS_AUTH_SECRET and OS_SECRET_KEY are not set');
    expect(out).not.toMatch(READY);
    // No secret minted, no key file, no database: the refusal comes first.
    expect(filesUnder(home).filter((f) => /auth-secret|dev-crypto-key|\.db$/.test(f)), out).toEqual([]);
    expect(filesUnder(cwd).filter((f) => /auth-secret|dev-crypto-key|\.db$/.test(f)), out).toEqual([]);
  });

  it('only the database missing: names only OS_DATABASE_URL', () => {
    const { run, out } = refuse({ OS_AUTH_SECRET: secret(), OS_SECRET_KEY: secret() });
    expect(run.status, out).toBe(1);
    expect(out).toContain('OS_DATABASE_URL is not set');
    expect(out).not.toMatch(/OS_AUTH_SECRET[^\n]*not set|OS_SECRET_KEY[^\n]*not set/);
  });

  it('a switch value that is not a switch is refused too, rather than read as off', () => {
    const { run, out } = refuse({ [SWITCH]: 'yes please' });
    expect(run.status, out).toBe(1);
    expect(out).toContain('is not a switch value');
  });
});

// ---------------------------------------------------------------------------
// 2 — an explicit file: passes
// ---------------------------------------------------------------------------

interface Boot {
  output?: string;
  health?: number;
  error?: Error;
}

describe('#30120 — with the image switch on, an explicit file: database and both secrets boot', () => {
  let reading: Boot = {};
  beforeAll(async () => {
    const home = tmp('os-30120-home-');
    const cwd = tmp('os-30120-cwd-');
    const volume = tmp('os-30120-volume-');
    let live: Live | undefined;
    try {
      live = await boot(
        'os start (explicit settings)',
        cwd,
        baseEnv(home, {
          [SWITCH]: 'true',
          OS_DATABASE_URL: `file:${join(volume, 'app.db')}`,
          OS_AUTH_SECRET: secret(),
          OS_SECRET_KEY: secret(),
        }),
      );
      const health = await http(live, 'GET', '/api/v1/health');
      reading = { output: live.output(), health: health.status };
    } catch (error) {
      reading = { error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      if (live) await stopGroup(live.child);
    }
  }, BOOT_TIMEOUT_MS + 30_000);

  it('boots and answers health, printing no durability block', () => {
    if (reading.error) throw reading.error;
    expect(reading.health, reading.output).toBe(200);
    expect(reading.output).not.toContain('this server keeps these on its own disk');
  });
});

// ---------------------------------------------------------------------------
// 3 + 4 — no switch: boots, says so in the log and to the administrators
// ---------------------------------------------------------------------------

interface DefaultsBoot {
  output?: string;
  home?: string;
  adminNotice?: { status: number; body: any; text: string };
  memberNotice?: { status: number; body: any; text: string };
  authConfig?: { status: number; text: string };
  runtimeConfig?: { status: number; text: string };
  error?: Error;
}

describe('#30120 — without the switch, a production start on its defaults boots and says so', () => {
  let reading: DefaultsBoot = {};
  beforeAll(async () => {
    const home = tmp('os-30120-home-');
    const cwd = tmp('os-30120-cwd-');
    let live: Live | undefined;
    try {
      live = await boot('os start (defaults)', cwd, baseEnv(home));
      // Single-tenant posture: the first registrant is the platform administrator.
      const adminToken = await signUpOwner(live, 'owner-30120@example.com');
      const memberToken = await createMember(live, adminToken, 'member-30120@example.com');
      const adminNotice = await http(live, 'GET', '/api/settings/deployment/notice', adminToken);
      const memberNotice = await http(live, 'GET', '/api/settings/deployment/notice', memberToken);
      const authConfig = await http(live, 'GET', '/api/v1/auth/config', adminToken);
      const runtimeConfig = await http(live, 'GET', '/api/v1/runtime/config', adminToken);
      reading = { output: live.output(), home, adminNotice, memberNotice, authConfig, runtimeConfig };
    } catch (error) {
      reading = { error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      if (live) await stopGroup(live.child);
    }
  }, BOOT_TIMEOUT_MS + 60_000);

  const recorded = (): Required<Omit<DefaultsBoot, 'error'>> => {
    if (reading.error) throw reading.error;
    return reading as Required<Omit<DefaultsBoot, 'error'>>;
  };

  it('prints the block naming the database file, the sign-in secret file and the data key file', () => {
    const { output, home } = recorded();
    const osHome = join(home, '.objectstack');
    expect(output).toContain('Production mode, and this server keeps these on its own disk');
    expect(output).toContain(`Database: a SQLite file, ${join(osHome, 'data', 'objectstack.db')}`);
    expect(output).toContain(`Sign-in secret: generated and kept in ${join(osHome, 'auth-secret')}`);
    expect(output).toContain(`kept in ${join(osHome, 'dev-crypto-key')} (OS_SECRET_KEY is not set)`);
  });

  it('an administrator reads the three findings, with the files the block named', () => {
    const { adminNotice, home, output } = recorded();
    const osHome = join(home, '.objectstack');
    expect(adminNotice.status, `${adminNotice.text}\n${output.slice(-3000)}`).toBe(200);
    const high = adminNotice.body?.data?.findings?.filter((f: any) => f.severity === 'high');
    expect(high).toEqual([
      { id: 'database_local_file', severity: 'high', variable: 'OS_DATABASE_URL', file: join(osHome, 'data', 'objectstack.db') },
      { id: 'auth_secret_generated', severity: 'high', variable: 'OS_AUTH_SECRET', file: join(osHome, 'auth-secret') },
      { id: 'data_key_file', severity: 'high', variable: 'OS_SECRET_KEY', file: join(osHome, 'dev-crypto-key') },
    ]);
    // The default boot stores uploads locally and sends no mail: the two
    // lower-severity lines.
    expect(adminNotice.body?.data?.findings?.filter((f: any) => f.severity === 'low').map((f: any) => f.id)).toEqual([
      'file_storage_local',
      'email_not_configured',
    ]);
  });

  it('a member is refused the notice 403, and the answer names no server path', () => {
    const { memberNotice } = recorded();
    expect(memberNotice.status, memberNotice.text).toBe(403);
    expect(memberNotice.body?.error?.code).toBe('PERMISSION_DENIED');
    expect(memberNotice.text).not.toContain('.objectstack');
  });

  it('neither the public auth config nor the runtime config carries the notice', () => {
    const { authConfig, runtimeConfig, adminNotice, home } = recorded();
    // Non-vacuity: the administrator's own read carries every string the
    // check below looks for, so a leak of it could not pass unseen.
    for (const leak of ['database_local_file', 'auth_secret_generated', 'data_key_file', home]) {
      expect(adminNotice.text).toContain(leak);
    }
    for (const served of [authConfig, runtimeConfig]) {
      expect(served.status, served.text.slice(0, 500)).toBe(200);
      for (const leak of ['database_local_file', 'auth_secret_generated', 'data_key_file', 'deployment_notice', home]) {
        expect(served.text).not.toContain(leak);
      }
    }
  });
});
