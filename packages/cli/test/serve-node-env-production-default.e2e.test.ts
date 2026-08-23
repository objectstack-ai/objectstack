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
 * ## WHY THE FIXTURE CONSTRUCTS `AuthPlugin` ITSELF, RATHER THAN LEAVING
 * `os serve` TO AUTO-INJECT IT — measured, and it contradicts the naive
 * reading of the regression-pin wording
 *
 * `os serve`'s OWN auto-injection wiring (`serve.ts`, the `!hasAuthPlugin &&
 * tierEnabled('auth')` block) does two things that make
 * `plugin-auth/auth-manager.ts`'s `NODE_ENV`-gated substitution (line ~1927)
 * UNREACHABLE through that path, regardless of `NODE_ENV`, before or after
 * this fix:
 *
 *   1. It ALWAYS pushes the resolved `baseUrl`'s origin into `trustedOrigins`
 *      before handing the array to `AuthPlugin` — so `this.config.trustedOrigins`
 *      inside `auth-manager.ts` is NEVER empty, and that substitution is
 *      itself gated on `!origins.length`.
 *   2. It has its OWN, separate localhost-wildcard convenience
 *      (`if (isDev && …) trustedOrigins.push('http://localhost:*')`), gated on
 *      `isDev = flags.dev || NODE_ENV === 'development'` — an EQUALITY test
 *      against `'development'` that was never open on unset `NODE_ENV` to
 *      begin with (unset `!== 'development'`, same as `'production'`).
 *
 * MEASURED on real boots, both ways: spawning `os serve` with NO declared
 * `plugins` (letting the CLI auto-inject `AuthPlugin`) answers `403
 * INVALID_ORIGIN` to an untrusted-localhost-origin probe with UNSET
 * `NODE_ENV` — identically — on the pre-fix tree AND the post-fix tree. That
 * is not this fix working; it is `serve.ts`'s own, unrelated `isDev` gate,
 * which was already closed. A pin built on the auto-injected path would have
 * been GREEN with the fix reverted — the exact vacuity this card's own
 * anti-vacuity section warns against, just one layer further down than the
 * one it names.
 *
 * The gate this card is actually about — `auth-manager.ts`'s own
 * `NODE_ENV`-gated substitution — IS reached by a host app that constructs
 * `AuthPlugin` ITSELF (a supported, real shape: `serve.ts`'s `hasAuthPlugin`
 * check exists precisely to detect and defer to it), without pre-populating
 * `trustedOrigins`. So that is what this fixture does. Reverse-verified: on
 * the pre-fix tree, this exact fixture with unset `NODE_ENV` answers `401
 * INVALID_EMAIL_OR_PASSWORD` (origin accepted, gate OPEN) to the same probe
 * that gets `403 INVALID_ORIGIN` post-fix.
 *
 * WHY THE PROBE IS AN ORIGIN CHECK, NOT A SIGN-IN. The trusted-origin
 * substitution is consulted by better-auth's CSRF/origin middleware BEFORE
 * the sign-in handler ever looks at the credentials in the body (see
 * `origin-check.mjs`'s `validateFormCsrf` → `validateOrigin`), so a request
 * with bogus credentials still tells the two states apart: gate OPEN answers
 * with whatever `sign-in/email` says about the (wrong) credentials, gate
 * CLOSED never reaches that logic and answers `403 INVALID_ORIGIN` first.
 * `OS_AUTH_SECRET` is set explicitly in every boot below and threaded into
 * the fixture's own `AuthPlugin({ secret: … })` — `AuthPlugin.init()` throws
 * `'AuthPlugin: secret is required'` synchronously otherwise, which is a
 * boot failure, not a signal about this gate.
 *
 * The probed Origin is `http://localhost:<a DIFFERENT random port>` —
 * different from the port `serve` itself binds to — so a pass can only be
 * explained by the wildcard `http://localhost:*` substitution, never by
 * better-auth's own default trust of the deployment's own origin.
 *
 * ## The bounded retry — a documented CI infrastructure shape, not a mask
 *
 * CI measured (run 32625390225, `Test Core (2/6)`): the FIRST leg of this
 * file's suite failed with oclif's own `Error: command serve not found`
 * before ever reaching "Server is ready" — the other two legs, and 1824 other
 * tests in the same shard, passed. That sentence is `scripts/
 * cli-build-prerequisite.mjs`'s own documented signature for a `dist/` that
 * reads unbuilt-or-half-built to oclif's live `dist/commands/**` glob scan
 * (no manifest cache — `packages/cli` ships no `oclif.manifest.json`, so
 * EVERY invocation re-globs). `pnpm --filter @objectstack/cli typecheck` and
 * a full local run of this file were both clean; `packages/cli`'s own suite
 * spawns the real built CLI from ~20 other files, so a transient read of a
 * just-finished, cold `tsc` build under this package's heavy concurrent-spawn
 * load (measured 485s wall, 1825 tests, dozens of real child processes) is a
 * documented shape of THIS suite specifically, not a property of the fix
 * under test — the ordering proof above already establishes that
 * `serve.ts`'s ENTIRE ELSE branch runs after the command was already found
 * and `run()` already entered, so it cannot be the cause of a failure to find
 * the command in the first place. `bootServeWithRetry` below retries once,
 * scoped EXACTLY to that one oclif sentence — any other failure (a real
 * assertion, a real crash, a real timeout with a different tail) still fails
 * on the first attempt, unretried.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/** What `spawn(..., { stdio: ['ignore', 'pipe', 'pipe'] })` actually returns — no `stdin`. */
type ProbeChild = ChildProcessByStdio<null, Readable, Readable>;

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. See the file header for why this one, not `run-dev.js`. */
const CLI = resolve(HERE, '../bin/run.js');

/**
 * The fixture's parent directory sits INSIDE `packages/cli/test/`, not the
 * system tmpdir: the config below does a real, static
 * `import { AuthPlugin } from '@objectstack/plugin-auth'`, and that only
 * resolves because `packages/cli/node_modules/@objectstack/plugin-auth`
 * (a real dependency of this package) is reachable by Node's ordinary
 * upward `node_modules` walk from wherever the config file lives. A fixture
 * rooted in `os.tmpdir()` has no such ancestor and the import fails.
 */
const FIXTURES_ROOT = HERE;

function configFor(port: number): string {
  return `
import { AuthPlugin } from '@objectstack/plugin-auth';

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
  // Constructed here, by the HOST — not left to os serve's own auto-inject.
  // See the file header for why that distinction is load-bearing for this pin.
  plugins: [
    new AuthPlugin({
      secret: process.env.OS_AUTH_SECRET,
      baseUrl: 'http://localhost:${port}',
    }),
  ],
};
`;
}

let dir: string;
const children: ProbeChild[] = [];

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
/**
 * oclif's own "command <id> not found" — what its live `dist/commands/**` glob
 * answers with when it scans a target directory that is unbuilt OR (the shape
 * measured against this file, see the retry below) TRANSIENTLY appears
 * incomplete under this package's own heavy concurrent-spawn test load.
 * `scripts/cli-build-prerequisite.mjs` names this exact signature as the
 * shared detector several of this repo's own CI gates already carry for
 * commands shelled out to the built CLI, including oclif's own line-wrapping
 * of the sentence across ` › `-prefixed lines — flattened here the same way,
 * not re-imported (that module lives at the repo root for GATES to share;
 * this is a package test, a different resolution domain).
 */
function looksLikeMissingCliCommand(text: string): string {
  const flattened = text
    .split('\n')
    .map((line) => line.replace(/^\s*›\s*/, ''))
    .join('')
    .replace(/\s+/g, ' ');
  return flattened.match(/Error:\s*command\b.*?\bnot found\b/)?.[0] ?? '';
}

class BootFailure extends Error {
  constructor(public readonly stdout: string, public readonly stderr: string) {
    super(`serve did not reach "Server is ready"\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
}

/**
 * Spawn `os serve` once and resolve when it prints "Server is ready", or
 * reject with a {@link BootFailure} carrying everything it wrote. Never
 * retries — that policy lives one level up, in {@link bootServeWithRetry},
 * where it can be scoped to the one failure shape it exists for.
 */
function bootServeOnce(port: number, env: Record<string, string | undefined>): { child: ProbeChild; ready: Promise<void> } {
  const child = spawn(process.execPath, [CLI, 'serve', '-p', String(port)], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_COLOR: '1',
      OS_LOG_LEVEL: 'warn',
      OS_DISABLE_CONSOLE: '1',
      OS_DATABASE_URL: ':memory:',
      // Explicit and real, threaded into the fixture's own `new AuthPlugin({
      // secret: … })` — so the boot never takes the orthogonal
      // "AuthPlugin.init() throws: secret is required" path regardless of
      // which NODE_ENV state this call is probing.
      OS_AUTH_SECRET: 'e2e-node-env-default-probe-secret-not-for-real-use',
      // The base default for every call: truly unset, unless overridden by
      // `env` below. Node's spawn omits an `undefined`-valued entry rather
      // than inheriting whatever this test RUNNER's own process (vitest sets
      // NODE_ENV=test) happened to have.
      NODE_ENV: undefined,
      // MEASURED TRAP, worth stating explicitly: `...process.env` above is
      // THIS FILE's own process env — the vitest WORKER's — and vitest's
      // worker carries `TEST=true` (and `VITEST=true`) regardless of
      // `NODE_ENV`. better-auth 1.7.1 reads `TEST` directly, independent of
      // `NODE_ENV`: `create-context.mjs` defaults
      // `skipOriginCheck: … isTest() ? true : false`, and
      // `isTest = () => nodeENV === 'test' || toBoolean(env.TEST)`. Left
      // alone, that inherited `TEST=true` makes better-auth skip origin
      // validation ENTIRELY — a false GREEN that has nothing to do with
      // `serve.ts`'s own gate and stays green with the fix reverted, which is
      // exactly the vacuity this card's anti-vacuity section warns against,
      // one layer further down than the one it names. Unset it the same way
      // `NODE_ENV` is unset above, for the same reason.
      TEST: undefined,
      ...env,
    },
  }) as ProbeChild;
  children.push(child);

  let out = '';
  let err = '';
  const ready = new Promise<void>((readyResolve, readyReject) => {
    const timer = setTimeout(() => {
      readyReject(new BootFailure(out, err));
    }, 150_000);
    const onData = () => {
      if (/Server is ready/.test(out + err)) {
        clearTimeout(timer);
        readyResolve();
      }
    };
    child.stdout.on('data', (d) => { out += String(d); onData(); });
    child.stderr.on('data', (d) => { err += String(d); onData(); });
    child.on('exit', () => {
      clearTimeout(timer);
      readyReject(new BootFailure(out, err));
    });
  });
  return { child, ready };
}

/**
 * {@link bootServeOnce}, retried EXACTLY ONCE, and only when the failure is
 * oclif's own documented "command not found" — never on any other shape,
 * which would mask a real regression instead of absorbing a known
 * infrastructure characteristic. See {@link looksLikeMissingCliCommand}'s
 * header for what that signature means and why this package's own suite is
 * positioned to hit it: ~20 files in this same suite spawn the real built CLI
 * (this file among them), so a transient read of a just-built `dist/commands`
 * under concurrent load is a documented shape here, not a hypothesis reached
 * for to explain away a failure.
 */
async function bootServeWithRetry(port: number, env: Record<string, string | undefined>): Promise<ProbeChild> {
  const first = bootServeOnce(port, env);
  try {
    await first.ready;
    return first.child;
  } catch (e) {
    if (!(e instanceof BootFailure) || !looksLikeMissingCliCommand(e.stderr)) throw e;
    await stop(first.child);
    const retryPort = randomPort();
    writeFileSync(join(dir, 'objectstack.config.ts'), configFor(retryPort), 'utf8');
    const second = bootServeOnce(retryPort, env);
    await second.ready;
    return second.child;
  }
}

async function probeOriginCheck(env: Record<string, string | undefined>): Promise<OriginCheckResult> {
  const port = randomPort();
  writeFileSync(join(dir, 'objectstack.config.ts'), configFor(port), 'utf8');

  const child = await bootServeWithRetry(port, env);
  // `bootServeWithRetry` may have rebound to a different port on its retry
  // leg — read the port the child actually reports itself as, from the last
  // arg it was spawned with, so the probe below always targets the live one.
  const boundPort = Number(child.spawnargs[child.spawnargs.length - 1]);
  const boundUntrustedOriginPort = boundPort + 1;

  try {
    const res = await fetch(`http://localhost:${boundPort}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // No cookie header — this is the shape `validateFormCsrf` forces an
        // origin check for when neither Sec-Fetch-* nor a cookie is present.
        origin: `http://localhost:${boundUntrustedOriginPort}`,
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

describe('#11113: os serve defaults NODE_ENV to production when unset', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(FIXTURES_ROOT, 'tmp-node-env-default-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'serve-node-env-default-e2e-fixture', private: true, type: 'module' }, null, 2),
      'utf8',
    );
    // objectstack.config.ts is written per-probe (configFor embeds the port).
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
