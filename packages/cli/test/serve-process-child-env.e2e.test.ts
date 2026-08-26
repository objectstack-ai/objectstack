// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11267 — a spawned `os serve` child must not inherit the vitest worker's
 * `TEST=true`, because better-auth switches its own origin/CSRF validation OFF
 * when it sees it.
 *
 * ## What this file pins, and why it takes a real boot to pin it
 *
 * The fix itself is four lines in `helpers/serve-process.ts` (`childEnv()`
 * drops `TEST` and the `VITEST*` family before the overrides go on). A pin that
 * only asserted "the returned object has no `TEST` key" would be true and
 * almost worthless: it says nothing about whether that key ever mattered, and
 * this card exists precisely because that distinction was invisible. So the
 * structural assertions below are followed by two REAL boots that differ in
 * nothing but those variables.
 *
 * ## The measurement, which is what the two boots re-run on every CI pass
 *
 * Probe: `POST /api/v1/auth/sign-in/email` carrying
 * `Origin: https://evil.example.com`, no cookie, no `Sec-Fetch-*`. That is the
 * shape `validateFormCsrf` forces an origin check for (`origin-check.mjs`: no
 * cookie and no Fetch-Metadata, but an `origin` header present ⇒
 * `validateOrigin(ctx, true)`). The origin is not localhost, so it is untrusted
 * under EVERY branch of `serve.ts`'s trusted-origin assembly — including the
 * `isDev` `http://localhost:*` convenience, which `bin/run-dev.js` always turns
 * on by setting `NODE_ENV=development` before argv is parsed. A pass therefore
 * cannot be explained by the deployment trusting its own origin.
 *
 * | child env | answer |
 * |---|---|
 * | `{ ...process.env, … }` — this directory's shape before #11267 | `401 INVALID_EMAIL_OR_PASSWORD` — origin ACCEPTED, validation never ran |
 * | `childEnv({ … })` | `403 INVALID_ORIGIN` — validation ran and rejected |
 *
 * Isolated when this was measured: stripping ONLY `TEST` (leaving `VITEST`,
 * `VITEST_WORKER_ID`, `VITEST_POOL_ID`, `VITEST_MODE` in place) also answers
 * `403 INVALID_ORIGIN`, so `TEST` alone is what better-auth reads.
 *
 * ⚠️ `VITEST` was not merely hygiene either, though this file said so in its
 * first revision and was wrong. What follows is quoted in the PAST TENSE on
 * purpose — the code it quotes is GONE. `detectMode` in
 * `local-crypto-provider.ts` used to read
 * `if (env.VITEST || env.NODE_ENV === 'test') return 'test'`, so an inherited
 * `VITEST=true` silently put a spawned child's crypto layer in test mode.
 * #11448 (`a58eac3e`, merged 2026-08-23) deleted that arm; the live
 * `detectMode` (`local-crypto-provider.ts:185`) reads `NODE_ENV` and nothing
 * else.
 *
 * ⛔ So do not read the strip as still moving crypto posture: children
 * spawned through this helper run `bin/run-dev.js`, which pins
 * `process.env.NODE_ENV = 'development'` before argv is parsed, and `NODE_ENV`
 * is deliberately outside `childEnv()`'s strip family — their posture is
 * `development` with or without a leaked `VITEST`. The old wording predicted a
 * `test` → `development` flip that cannot happen, and that prediction has
 * already cost one dispatch (#11596) its scoping assumption. The strip stays
 * anyway, now as defence-in-depth over a class `pnpm check:runner-env-posture`
 * holds shut in product source. Same class, different gate;
 * `helpers/serve-process.ts` carries the measurement.
 *
 * ## ⚠️ The first boot deliberately builds the env the WRONG way
 *
 * `leakedEnv()` below is a bare `...process.env` spread on purpose — it is the
 * pre-#11267 recipe, kept executable so the repair stays distinguishable from a
 * no-op. ⛔ Do not "clean it up" to `childEnv()`: that would delete the only
 * evidence in the repo that the leak does anything, and leave a green suite
 * behind. It is also the canary on the dependency — if better-auth stops
 * reading `TEST`, that leg goes red, and the answer is to re-read this header
 * and re-measure, not to silence it.
 *
 * Cost: two real `os serve` boots, ~18s together when measured on this
 * container. Both children are killed in `afterAll` regardless of outcome.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { CLI, TSX, E2E_SECRET_KEY, childEnv, randomPort, VITEST_WORKER_ENV_KEYS } from './helpers/serve-process.js';

/** What `spawn(…, { stdio: ['ignore', 'pipe', 'pipe'] })` actually returns — no `stdin`. */
type ProbeChild = ChildProcessByStdio<null, Readable, Readable>;

/**
 * No `plugins` key: this is the shape that leaves `serve.ts` to auto-inject
 * `AuthPlugin` (`!hasAuthPlugin && tierEnabled('auth')`), which is what mounts
 * better-auth at `/api/v1/auth/*`. The object exists only so the stack is a
 * valid app; nothing below reads it.
 */
const CONFIG = `
export default {
  manifest: {
    id: 'com.example.childenv',
    namespace: 'childenv',
    version: '1.0.0',
    type: 'app',
    name: 'childEnv origin-validation probe',
  },
  objects: [{
    name: 'childenv_task',
    label: 'Task',
    sharingModel: 'public',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

/** The overrides both legs share, so the ONLY difference between them is the base. */
const OVERRIDES = {
  NO_COLOR: '1',
  OS_DATABASE_URL: ':memory:',
  OS_LOG_LEVEL: 'warn',
  OS_DISABLE_CONSOLE: '1',
  // Explicit rather than leaning on serve.ts's isDev fallback secret, so a
  // change to that fallback can never turn this into a boot-failure test.
  OS_AUTH_SECRET: 'e2e-child-env-probe-secret-not-for-real-use',
  // Explicit for the same reason, and it stays in the SHARED overrides so the
  // two legs still differ in nothing but the vitest env family — which is the
  // property the whole comparison rests on.
  OS_SECRET_KEY: E2E_SECRET_KEY,
};

/**
 * ⚠️ The PRE-#11267 recipe, on purpose. See this file's header before touching
 * it — it is the leg that proves the leak does something.
 */
function leakedEnv(): Record<string, string | undefined> {
  return { ...process.env, ...OVERRIDES };
}

let dir: string;
const children: ProbeChild[] = [];

async function stop(child: ProbeChild): Promise<void> {
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

/**
 * Boot the real `os serve` through the same entrypoint `runServe()` uses, probe
 * the origin check while it is UP, then stop it. `runServe()` itself cannot
 * stand in here: it kills the child the moment `waitFor` matches, so there is
 * no window in which to send a request.
 */
async function probeOrigin(env: Record<string, string | undefined>): Promise<{ status: number; code: unknown }> {
  const port = randomPort();
  const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '--port', port], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  }) as ProbeChild;
  children.push(child);

  let out = '';
  let err = '';
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(
      () => fail(new Error(`serve never became ready\n--- stdout ---\n${out}\n--- stderr ---\n${err}`)),
      150_000,
    );
    const onData = () => {
      if (/Press Ctrl\+C to stop|Server is ready/.test(out + err)) {
        clearTimeout(timer);
        ready();
      }
    };
    child.stdout.on('data', (d) => { out += String(d); onData(); });
    child.stderr.on('data', (d) => { err += String(d); onData(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`serve exited ${code} before it was ready\n--- stdout ---\n${out}\n--- stderr ---\n${err}`));
    });
  });

  try {
    const res = await fetch(`http://localhost:${port}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Not localhost, so untrusted under every branch of serve.ts's
        // trusted-origin assembly. No cookie and no Sec-Fetch-* header: that is
        // the shape validateFormCsrf forces an origin check for.
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'definitely-wrong-password' }),
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON body, fall through */ }
    return { status: res.status, code: body?.code };
  } finally {
    await stop(child);
  }
}

describe('#11267: childEnv() keeps the vitest worker out of a spawned os serve', () => {
  it('drops every variable in the vitest worker family', () => {
    const env = childEnv();
    for (const key of VITEST_WORKER_ENV_KEYS) {
      expect(Object.hasOwn(env, key), `childEnv() still carries ${key}`).toBe(false);
    }
  });

  it('drops the whole VITEST namespace, not just the five names known today', () => {
    const env = childEnv();
    const leaked = Object.keys(env).filter((k) => k === 'TEST' || k.startsWith('VITEST'));
    expect(leaked).toEqual([]);
  });

  it('still carries the rest of the environment, and lets an override win', () => {
    const env = childEnv({ TEST: 'deliberate', OS_LOG_LEVEL: 'warn' });
    // PATH is the one variable a spawned child cannot do without.
    expect(env.PATH).toBe(process.env.PATH);
    // Overrides are applied AFTER the strip: a test that genuinely wants one of
    // these can still say so — the point is that nothing arrives by accident.
    expect(env.TEST).toBe('deliberate');
    expect(env.OS_LOG_LEVEL).toBe('warn');
  });

  it('an `undefined` override survives as an own key, so spawn() unsets it', () => {
    const env = childEnv({ NODE_ENV: undefined });
    expect(Object.hasOwn(env, 'NODE_ENV')).toBe(true);
    expect(env.NODE_ENV).toBeUndefined();
  });

  describe('and that is not cosmetic — the same boot, the same probe, two answers', () => {
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'os-child-env-probe-'));
      writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
    });

    afterAll(async () => {
      for (const child of children) await stop(child);
      if (dir) rmSync(dir, { recursive: true, force: true });
    }, 60_000);

    it(
      'inheriting the worker env (the pre-#11267 shape): the untrusted origin is ACCEPTED',
      async () => {
        // ⛔ Do NOT convert this leg to childEnv() — see the file header.
        const { status, code } = await probeOrigin(leakedEnv());
        expect(status).not.toBe(403);
        expect(code).not.toBe('INVALID_ORIGIN');
        // Positive control: the request really did reach the sign-in handler,
        // rather than failing for some unrelated reason that also is not a 403.
        expect(code).toBe('INVALID_EMAIL_OR_PASSWORD');
      },
      180_000,
    );

    it(
      'through childEnv(): the untrusted origin is REJECTED',
      async () => {
        const { status, code } = await probeOrigin(childEnv(OVERRIDES));
        expect(status).toBe(403);
        expect(code).toBe('INVALID_ORIGIN');
      },
      180_000,
    );
  });
});
