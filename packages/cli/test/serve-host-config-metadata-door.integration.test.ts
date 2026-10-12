// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
 * - **production** — `os serve objectstack.config.ts`, NODE_ENV unset, a host
 *   config with no `dist/`: the declared path answers `401 UNAUTHENTICATED`
 *   (the route matched; only auth stopped it), an undeclared path under the
 *   same namespace answers `404 ENDPOINT_NOT_FOUND`, and the dev-only
 *   `GET /api/v1/dev/metadata-events` stays unmounted. Its two security items
 *   (a position and a capability) are served exactly once each: the door
 *   registers none of the stack, so the AppPlugin wrap stays their single
 *   registrar.
 * - **artifact** (CONTROL) — the same project with its compiled twin on disk,
 *   `os serve --dev`: the dev artifact door composes, and the same path
 *   answers the same `401`.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset — the shipped entry, resolving commands
 * from `dist/`, so the boots measure the built packages (`requireBuiltCli`).
 * Every boot runs in `beforeAll`; every `it` reads what it recorded, and a
 * failed boot is recorded against its own leg.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  E2E_SECRET_KEY,
  portContentionError,
  portDriftError,
  probeThroughChild,
  randomPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
const ALL_BOOTS_TIMEOUT_MS = 2 * (BOOT_TIMEOUT_MS + 30_000);

const HOST_MARKER = 'com.example.fxh.host-marker';
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
  devEvents?: number;
  positionCopies?: number;
  capabilityCopies?: number;
  error?: Error;
}

const groups: ChildProcess[] = [];
let dir: string;
const readings: Partial<Record<'production' | 'artifact', Reading>> = {};

function boot(argv: string[], port: string, env: Record<string, string | undefined>): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, ...argv], {
      cwd: dir,
      // `childEnv`, never a bare `...process.env` — see its header. `NODE_ENV`
      // unset, so the built entry resolves its commands from `dist/`.
      env: childEnv({
        NO_COLOR: '1',
        OS_CLOUD_URL: 'off',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_LOG_LEVEL: 'warn',
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        OS_MODE: undefined,
        NODE_ENV: undefined,
        ...env,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
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
      () => settle(new Error(`os ${argv[0]} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      if (READY.test(out)) settle(portDriftError(out, `os ${argv[0]}`, port));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(portContentionError(out, `os ${argv[0]}`, port)
        ?? new Error(`os ${argv[0]} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
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

async function measure(leg: 'production' | 'artifact', argv: string[], env: Record<string, string | undefined>): Promise<void> {
  const port = randomPort();
  let live: Live | undefined;
  try {
    live = await boot([...argv, '-p', port], port, env);
    const feed = await http(live, 'GET', FEED_PATH);
    const undeclared = await http(live, 'GET', '/api/v1/apps/fxh/no-such-endpoint');
    const reading: Reading = {
      feed: { status: feed.status, code: feed.body?.error?.code },
      undeclared: { status: undeclared.status, code: undeclared.body?.error?.code },
    };
    if (leg === 'production') {
      // The dev SSE route answers a stream when mounted; read the status only.
      const ctl = new AbortController();
      const events = await fetch(`${live.base}/api/v1/dev/metadata-events`, { signal: ctl.signal });
      reading.devEvents = events.status;
      ctl.abort();
      // The first sign-up on a fresh production database is the bootstrap admin.
      const signUp = await http(live, 'POST', '/api/v1/auth/sign-up/email', '', {
        email: 'fxh-admin@example.com', password: 'fxh-admin-password-22989', name: 'Fxh Admin',
      });
      const token = signUp.body?.token;
      if (signUp.status !== 200 || typeof token !== 'string') {
        throw new Error(`sign-up answered ${signUp.status}: ${JSON.stringify(signUp.body)}\n--- output ---\n${live.output().slice(-3000)}`);
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

function reading(leg: 'production' | 'artifact'): Reading {
  const r = readings[leg];
  if (!r) throw new Error(`no reading recorded for ${leg} — the beforeAll never reached it`);
  if (r.error) throw r.error;
  return r;
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
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

  await measure('production', ['serve', 'objectstack.config.ts'], {
    OS_DATABASE_URL: 'file:production.db',
    OS_AUTH_SECRET: 'e2e-22989-production-leg-secret-not-for-real-use',
  });

  // The compiled twin, for the artifact door's control leg.
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(STACK, null, 2), 'utf8');
  await measure('artifact', ['serve', 'objectstack.config.ts', '--dev'], {
    OS_DATABASE_URL: 'file:artifact.db',
  });
}, ALL_BOOTS_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

describe('#22989 — `os serve` of a HOST config serves its declared apis endpoints', () => {
  it('production: the declared path answers 401 UNAUTHENTICATED, not 404', () => {
    expect(reading('production').feed).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('CONTROL: an undeclared path under the same namespace still answers 404 ENDPOINT_NOT_FOUND', () => {
    expect(reading('production').undeclared).toEqual({ status: 404, code: 'ENDPOINT_NOT_FOUND' });
  });

  it('production: the dev-only metadata-events route stays unmounted', () => {
    expect(reading('production').devEvents).toBe(404);
  });

  it('production: each stack-declared security item is served exactly once', () => {
    const r = reading('production');
    expect(r.positionCopies).toBe(1);
    expect(r.capabilityCopies).toBe(1);
  });

  it('CONTROL: the artifact door over the compiled twin answers the same 401', () => {
    const r = reading('artifact');
    expect(r.feed).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    expect(r.undeclared).toEqual({ status: 404, code: 'ENDPOINT_NOT_FOUND' });
  });
});
