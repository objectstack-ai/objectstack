// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 50 — spawns the real producer once per single-cause fixture: two `os serve` boots of one host config in one beforeAll, the source leg and its compiled twin; slowest CI reading 34.85 s (run 40424746941) of the two scheduled CI runs after the oclif test manifest (PR #26256: 40392443783, 40424746941), x 1.25, rounded up

/**
 * #22989 — `os serve` of a HOST config serves the stack's declared `apis`
 * endpoints, because the boot now composes `@objectstack/metadata`'s
 * `MetadataPlugin` (the maintainer's option A).
 *
 * ## The defect, measured at the public door before the fix
 *
 * `examples/app-showcase` is a host config (its `plugins[]` holds plugin
 * instances), and so is every `create-objectstack` scaffold. On `os serve` such
 * a config never reaches `createStandaloneStack`, the composition that gives
 * every other config boot a `MetadataPlugin`, so its `metadata` slot was the
 * kernel's in-memory core fallback — which has no `matchEndpoint`. Measured on
 * the showcase, no session:
 *
 *   | boot                                             | GET /api/v1/apps/showcase/tasks |
 *   |--------------------------------------------------|---------------------------------|
 *   | `os serve objectstack.config.ts` (production)    | 404 → 401 with this change      |
 *   | `os serve --dev` over `dist/` (the artifact door) | 401 before and after            |
 *
 * ## What each leg pins
 *
 * - **source** — `os serve objectstack.config.ts` of a host config with no
 *   `dist/`, so no artifact door can compose: the declared path answers
 *   `401 UNAUTHENTICATED` (the route matched; only auth stopped it), and an
 *   undeclared path under the same namespace answers `404
 *   ENDPOINT_NOT_FOUND`. Its two security items (a position and a capability)
 *   are served exactly once each: the door registers none of the stack, so
 *   the AppPlugin wrap stays their single registrar.
 * - **artifact** (CONTROL) — the same project with its compiled twin on disk:
 *   the dev artifact door composes, and the same path answers the same `401`.
 *
 * ## Spawn shape, and the production posture it does not reach
 *
 * The source entry (`bin/run-dev.js`), the harness the other boot-level
 * files here use, under this process's own `node` rather than the tsx binary.
 * That entry runs under `NODE_ENV=development`, so both legs
 * boot the DEVELOPMENT posture. The host-config door is decided by the same
 * three facts on both postures (no artifact door, a host config, no
 * `MetadataPlugin` in the composition), and the source leg is the branch
 * where no artifact door composes, exactly as on every production boot. What
 * only production decides — the dev SSE route staying unmounted — is pinned
 * in-process in `src/commands/serve-host-config-metadata-door.pin.test.ts`,
 * and the production boot of `examples/app-showcase` was measured over HTTP
 * on the card.
 *
 * Every boot runs in `beforeAll`; every `it` reads what it recorded, and a
 * failed boot is recorded against its own leg.
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
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
const ALL_BOOTS_TIMEOUT_MS = 2 * (BOOT_TIMEOUT_MS + 30_000);

const HOST_MARKER = 'com.example.fxh.host-marker';
/** The development dev-admin seed — the operator on every boot here. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';
const FEED_PATH = '/api/v1/apps/fxh/tasks';

/** The stack, as data: the compiled twin is exactly this JSON. */
const STACK = {
  manifest: { id: 'com.example.fxh', namespace: 'fxh', version: '1.0.0', type: 'app', name: 'Fxh' },
  objects: [{
    name: 'fxh_task',
    label: 'Task',
    pluralLabel: 'Tasks',
    sharingModel: 'public_read_write',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  apis: [{
    name: 'fxh_task_feed',
    path: FEED_PATH,
    method: 'GET',
    summary: 'Task feed',
    type: 'object_operation',
    objectParams: { object: 'fxh_task', operation: 'find' },
    authRequired: true,
  }],
  positions: [{ name: 'fxh_reviewer', label: 'Reviewer' }],
  capabilities: [{ name: 'fxh.export_data', label: 'Export', scope: 'org', packageId: 'com.example.fxh' }],
};

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

interface Reading {
  feed?: { status: number; code?: string };
  undeclared?: { status: number; code?: string };
  positionCopies?: number;
  capabilityCopies?: number;
  error?: Error;
}

const groups: ChildProcess[] = [];
let dir: string;
const readings: Partial<Record<'source' | 'artifact', Reading>> = {};

function boot(argv: string[], env: Record<string, string | undefined>): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, ...argv, '-p', KERNEL_ASSIGNED_PORT], {
      cwd: dir,
      // `childEnv`, never a bare `...process.env` — see its header. Neither
      // artifact variable leaks in from the runner: each leg states its own.
      env: childEnv({
        NO_COLOR: '1',
        OS_CLOUD_URL: 'off',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_LOG_LEVEL: 'warn',
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        OS_MODE: undefined,
        ...env,
      }),
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
      () => settle(new Error(`os ${argv[0]} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound: a kernel-assigned one (#24342).
      if (READY.test(out)) settle(readKernelAssignedPort(out, `os ${argv[0]}`));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`os ${argv[0]} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
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
      label: 'serve-host-config-metadata-door',
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

/** How many items named `name` the `/meta/<type>` answer carries. */
function copies(body: any, name: string): number {
  const items = body?.items ?? body?.data?.items ?? body?.data;
  return Array.isArray(items) ? items.filter((i: any) => i?.name === name).length : -1;
}

/** One leg: read what it pins from a boot already started, then stop it. */
async function measure(leg: 'source' | 'artifact', started: Promise<Live>): Promise<void> {
  let live: Live | undefined;
  try {
    live = await started;
    const feed = await http(live, 'GET', FEED_PATH);
    const undeclared = await http(live, 'GET', '/api/v1/apps/fxh/no-such-endpoint');
    const reading: Reading = {
      feed: { status: feed.status, code: feed.body?.error?.code },
      undeclared: { status: undeclared.status, code: undeclared.body?.error?.code },
    };
    if (leg === 'source') {
      const signIn = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
      const token = signIn.body?.token;
      if (signIn.status !== 200 || typeof token !== 'string') {
        throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${live.output().slice(-3000)}`);
      }
      reading.positionCopies = copies((await http(live, 'GET', '/api/v1/meta/position', token)).body, 'fxh_reviewer');
      reading.capabilityCopies = copies((await http(live, 'GET', '/api/v1/meta/capability', token)).body, 'fxh.export_data');
    }
    readings[leg] = reading;
  } catch (error) {
    readings[leg] = { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
  }
}

function reading(leg: 'source' | 'artifact'): Reading {
  const r = readings[leg];
  if (!r) throw new Error(`no reading recorded for ${leg} — the beforeAll never reached it`);
  if (r.error) throw r.error;
  return r;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-22989-host-door-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fxh-host', private: true }), 'utf8');
  // A host config: a plugin INSTANCE in `plugins` (`isHostConfig`).
  const literal = JSON.stringify(STACK, null, 2).replace(/\n}$/, `,
  "plugins": [{ name: '${HOST_MARKER}', version: '1.0.0', init: async () => {}, start: async () => {} }]
}`);
  // The splice must have landed, or this fixture silently stops being a host.
  if (!literal.includes(HOST_MARKER)) throw new Error(`host-config fixture lost its plugin:\n${literal}`);
  writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSourceFromLiteral(literal));
  linkSpec(dir);

  await measure('source', boot(['serve', 'objectstack.config.ts'], { OS_DATABASE_URL: 'file:source.db' }));

  // The compiled twin, for the artifact door's control leg.
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(STACK, null, 2), 'utf8');
  await measure('artifact', boot(['serve', 'objectstack.config.ts'], { OS_DATABASE_URL: 'file:artifact.db' }));
}, ALL_BOOTS_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

describe('#22989 — `os serve` of a HOST config serves its declared apis endpoints', () => {
  it('with no artifact door, the declared path answers 401 UNAUTHENTICATED, not 404', () => {
    expect(reading('source').feed).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('CONTROL: an undeclared path under the same namespace still answers 404 ENDPOINT_NOT_FOUND', () => {
    expect(reading('source').undeclared).toEqual({ status: 404, code: 'ENDPOINT_NOT_FOUND' });
  });

  it('each stack-declared security item is served exactly once', () => {
    const r = reading('source');
    expect(r.positionCopies).toBe(1);
    expect(r.capabilityCopies).toBe(1);
  });

  it('CONTROL: the artifact door over the compiled twin answers the same 401', () => {
    const r = reading('artifact');
    expect(r.feed).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    expect(r.undeclared).toEqual({ status: 404, code: 'ENDPOINT_NOT_FOUND' });
  });
});
