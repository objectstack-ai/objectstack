// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11113 — `os serve` with an UNSET `NODE_ENV` must be treated as production,
 * exactly as `os start` already is.
 *
 * `os start` defaults `NODE_ENV` to `'production'` on the unset case, but it
 * does so on `localEnv` — a child environment assembled for a SPAWN
 * (`start.ts:347`). `os serve` runs IN-PROCESS, so there is no child env to
 * default; the equivalent has to mutate `process.env.NODE_ENV` itself, early
 * enough that every `NODE_ENV !== 'production'` gate downstream — starting
 * with plugin-auth's localhost trusted-origin CSRF substitution (#10366) —
 * observes the default rather than the raw unset value.
 *
 * WHY THIS FILE SPAWNS THE REAL, BUILT CLI (`bin/run.js`, not
 * `bin/run-dev.js`). `run-dev.js` unconditionally sets
 * `process.env.NODE_ENV = 'development'` before it even parses argv — it is
 * the tsx source-loader shim `pnpm dev` and the other e2e fixtures use, and
 * it would make the exact input this defect is about (a truly UNSET
 * `NODE_ENV`) unreachable no matter what the test passes to `spawn()`'s `env`.
 * Only the shipped, built entrypoint leaves `NODE_ENV` exactly as the spawn
 * environment supplies it — which is also why a plain in-process unit test
 * (`auth-manager.test.ts`'s "substitutes the trio when NODE_ENV is unset")
 * cannot stand in for this one: it proves the GATE reads unset the open way,
 * not that `serve.ts`'s boot sets `process.env.NODE_ENV` EARLY ENOUGH for the
 * gate to observe the default before it is first read. A fix that set the
 * default after the imports/gates below would pass that unit test and still
 * ship with the door open — that ordering is what only a real boot can catch.
 *
 * WHY THE PROBE IS AN ORIGIN CHECK, NOT A SIGN-IN. The trusted-origin
 * substitution is consulted by better-auth's CSRF/origin middleware BEFORE
 * the sign-in handler ever looks at the credentials in the body (see
 * `origin-check.mjs`'s `validateFormCsrf` → `validateOrigin`), so a request
 * with bogus credentials still tells the two states apart: gate OPEN answers
 * with whatever `sign-in/email` says about the (wrong) credentials, gate
 * CLOSED never reaches that logic and answers `403 INVALID_ORIGIN` first.
 * `OS_AUTH_SECRET` is set explicitly in every boot below so the outcome is
 * never confused with `serve.ts`'s separate "AuthPlugin skipped, no secret"
 * warning path (`serve.ts` ~2444) — that path is orthogonal to this gate and
 * unaffected by this fix (it is keyed on `isDev`, not on the raw variable).
 *
 * The probed Origin is `http://localhost:<a DIFFERENT random port>` —
 * different from the port `serve` itself binds to — so a pass can only be
 * explained by the wildcard `http://localhost:*` substitution, never by
 * better-auth's own default trust of the deployment's own origin.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. See the file header for why this one, not `run-dev.js`. */
const CLI = resolve(HERE, '../bin/run.js');

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.nodeenvdefault',
    namespace: 'nodeenvdefault',
    version: '1.0.0',
    type: 'app',
    name: 'NODE_ENV production-default probe',
  },
  objects: [{
    name: 'nodeenvdefault_task',
    label: 'Task',
    sharingModel: 'public',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

let dir: string;
const children: ChildProcessWithoutNullStreams[] = [];

/** A random high port, so a run never contends with another agent's dev server on this host. */
function randomPort(): number {
  return 41000 + Math.floor(Math.random() * 19000);
}

interface OriginCheckResult {
  status: number;
  body: any;
}

/**
 * Boot `os serve` for real against the shipped entrypoint, wait for the ready
 * banner, POST a sign-in attempt carrying an untrusted-looking localhost
 * Origin and no cookie, then shut the child down. Never leaves a child
 * running past its own test.
 *
 * `env.NODE_ENV` may be `undefined` to leave the variable truly UNSET for the
 * child — Node's `spawn()` omits `undefined`-valued env entries rather than
 * stringifying them, so this is not the same as `NODE_ENV=''`.
 */
async function probeOriginCheck(env: Record<string, string | undefined>): Promise<OriginCheckResult> {
  const port = randomPort();
  const untrustedOriginPort = port + 1;

  const child = spawn(process.execPath, [CLI, 'serve', '-p', String(port)], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_COLOR: '1',
      OS_LOG_LEVEL: '',
      OS_DISABLE_CONSOLE: '1',
      OS_DATABASE_URL: ':memory:',
      // Explicit and real, so the boot never takes the orthogonal "AuthPlugin
      // skipped — no OS_AUTH_SECRET" path (serve.ts) regardless of which
      // NODE_ENV state this call is probing.
      OS_AUTH_SECRET: 'e2e-node-env-default-probe-secret-not-for-real-use',
      // The base default for every call: truly unset, unless overridden by
      // `env` below. Node's spawn omits an `undefined`-valued entry rather
      // than inheriting whatever this test RUNNER's own process (vitest sets
      // NODE_ENV=test) happened to have.
      NODE_ENV: undefined,
      ...env,
    },
  }) as ChildProcessWithoutNullStreams;
  children.push(child);

  let out = '';
  let err = '';

  await new Promise<void>((readyResolve, readyReject) => {
    const timer = setTimeout(() => {
      readyReject(new Error(`serve never reached "Server is ready"\n--- stdout ---\n${out}\n--- stderr ---\n${err}`));
    }, 150_000);
    const onData = () => {
      if (/Server is ready/.test(out + err)) {
        clearTimeout(timer);
        readyResolve();
      }
    };
    child.stdout.on('data', (d) => { out += String(d); onData(); });
    child.stderr.on('data', (d) => { err += String(d); onData(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      readyReject(new Error(`serve exited ${code} before "Server is ready"\n--- stdout ---\n${out}\n--- stderr ---\n${err}`));
    });
  });

  try {
    const res = await fetch(`http://localhost:${port}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // No cookie header — this is the shape `validateFormCsrf` forces an
        // origin check for when neither Sec-Fetch-* nor a cookie is present.
        origin: `http://localhost:${untrustedOriginPort}`,
      },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'definitely-wrong-password' }),
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON error body, fall through with null */ }
    return { status: res.status, body };
  } finally {
    await stop(child);
  }
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done();
    }, 10_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(give);
      done();
    }
  });
}

describe('#11113: os serve defaults NODE_ENV to production when unset', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'serve-node-env-default-e2e-'));
    writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'serve-node-env-default-e2e-fixture', private: true, type: 'module' }, null, 2),
      'utf8',
    );
  });

  afterAll(async () => {
    for (const child of children) await stop(child);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it(
    'NODE_ENV unset: the localhost trusted-origin convenience gate is CLOSED (regression pin)',
    async () => {
      const { status, body } = await probeOriginCheck({});
      expect(status).toBe(403);
      expect(body?.code).toBe('INVALID_ORIGIN');
    },
    180_000,
  );

  it(
    'NODE_ENV=development (explicit): the gate stays OPEN — unaffected by the production default',
    async () => {
      const { status, body } = await probeOriginCheck({ NODE_ENV: 'development' });
      expect(status).not.toBe(403);
      expect(body?.code).not.toBe('INVALID_ORIGIN');
    },
    180_000,
  );

  it(
    'NODE_ENV=test (explicit): the gate stays OPEN — unaffected by the production default',
    async () => {
      const { status, body } = await probeOriginCheck({ NODE_ENV: 'test' });
      expect(status).not.toBe(403);
      expect(body?.code).not.toBe('INVALID_ORIGIN');
    },
    180_000,
  );
});
