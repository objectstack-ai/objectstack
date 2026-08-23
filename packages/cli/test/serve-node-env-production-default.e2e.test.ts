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
 * ## WHY THIS FILE IS THE REASON `@objectstack/cli#test` DECLARES `build`
 *
 * This is the only file in `packages/cli` that genuinely consumes
 * `packages/cli/dist`, and it is the only one that can be, for a reason that
 * is this card's own subject matter turned back on the test harness.
 *
 * `turbo.json` used to declare `"@objectstack/cli#test": { dependsOn:
 * ["^build"] }` — dependencies only, never this package's own build. So
 * `packages/cli/dist` does not exist when the `Test Core` shard runs. Five
 * other files here name `bin/run.js`; two only assert the path as a string,
 * and the three that actually spawn it (`serve-mcp-stdio-answers`,
 * `serve-mcp-capability-collision`, `serve-stdio-stdout-purity`) pass
 * `NODE_ENV: 'development'` to the child so its `--dev` admin seed runs.
 * That value is also what makes `@oclif/core`'s `tsPath()` rewrite the
 * command target from the declared `./dist/commands` to `./src/commands` and
 * auto-transpile: `lib/util/util.js` defines `isProd = () =>
 * !['development','test'].includes(process.env.NODE_ENV ?? '')`, and the
 * lookup is skipped only when that is true. Those three therefore never
 * touch `dist/` at all, and the missing build stayed invisible.
 *
 * This pin cannot dodge it. Unset `NODE_ENV` is the input under test, and
 * unset is exactly the value that leaves `isProd()` true and the reroute
 * off — so oclif globs the real `dist/commands`, and on an unbuilt tree
 * answers ` ›   Error: command serve not found` before `serve.ts` runs a
 * single line. Measured, deterministic, not load-dependent: unset and
 * `production` both fail that way, `test` and `development` both resolve
 * from `src/`. An earlier revision of this file wrapped the boot in a
 * signature-scoped retry on the theory that the failure was a transient
 * `dist/commands` read under concurrent spawn load; that retry shipped, ran
 * in the failing job, and changed nothing — which is the measurement that
 * removed it again. The prerequisite is declared in the build graph now,
 * where it is true for whoever writes the next built-CLI test here.
 *
 * ⛔ Do NOT "fix" a `command serve not found` here by switching the spawn to
 * `bin/run-dev.js`. That shim sets `NODE_ENV=development` unconditionally
 * before argv is parsed, which makes the unset-`NODE_ENV` input this whole
 * file exists to measure unreachable — the pin would go green measuring
 * nothing. `bin/run.js` plus a genuinely built `dist/` is the only shape
 * that reaches the gate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { childEnv, E2E_SECRET_KEY } from './helpers/serve-process.js';

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
async function probeOriginCheck(env: Record<string, string | undefined>): Promise<OriginCheckResult> {
  const port = randomPort();
  const untrustedOriginPort = port + 1;
  writeFileSync(join(dir, 'objectstack.config.ts'), configFor(port), 'utf8');

  const child = spawn(process.execPath, [CLI, 'serve', '-p', String(port)], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv({
      NO_COLOR: '1',
      OS_LOG_LEVEL: 'warn',
      OS_DISABLE_CONSOLE: '1',
      OS_DATABASE_URL: ':memory:',
      // Explicit and real, threaded into the fixture's own `new AuthPlugin({
      // secret: … })` — so the boot never takes the orthogonal
      // "AuthPlugin.init() throws: secret is required" path regardless of
      // which NODE_ENV state this call is probing.
      OS_AUTH_SECRET: 'e2e-node-env-default-probe-secret-not-for-real-use',
      // EXACTLY the argument the line above makes, for the sibling gate that
      // #11267 exposed. The unset-`NODE_ENV` leg is — by this file's whole
      // design — a PRODUCTION boot, and `LocalCryptoProvider` refuses to start
      // in production without a stable key rather than mint one that would
      // make every `sys_secret` value undecryptable after a restart. That
      // refusal is a boot failure, not a signal about the origin gate this
      // file measures, so the key is supplied explicitly.
      //
      // ⚠️ It was NOT needed before #11267 — and that is the finding, not an
      // inconvenience. `local-crypto-provider.ts:133` reads
      // `if (env.VITEST || env.NODE_ENV === 'test') return 'test'`, so while
      // this fixture still inherited the vitest worker's `VITEST=true`, its
      // crypto layer sat in TEST mode (ephemeral key, no disk, no refusal)
      // while the rest of the boot was in production posture. The production
      // posture this file exists to pin was genuine for auth and fake for
      // crypto. Supplying the key is what makes it genuine for both.
      OS_SECRET_KEY: E2E_SECRET_KEY,
      // The base default for every call: truly unset, unless overridden by
      // `env` below. Node's spawn omits an `undefined`-valued entry rather
      // than inheriting whatever this test RUNNER's own process (vitest sets
      // NODE_ENV=test) happened to have.
      NODE_ENV: undefined,
      // MEASURED TRAP, and the reason the base above is `childEnv()` rather
      // than `...process.env`: this file's own process env is the vitest
      // WORKER's, and that worker carries `TEST=true` (and `VITEST=true`)
      // regardless of `NODE_ENV`. better-auth 1.7.1 reads `TEST` directly,
      // independent of `NODE_ENV`: `create-context.mjs` defaults
      // `skipOriginCheck: … isTest() ? true : false`, and
      // `isTest = () => nodeENV === 'test' || toBoolean(env.TEST)`. Left
      // alone, that inherited `TEST=true` makes better-auth skip origin
      // validation ENTIRELY — a false GREEN that has nothing to do with
      // `serve.ts`'s own gate and stays green with the fix reverted, which is
      // exactly the vacuity this card's anti-vacuity section warns against,
      // one layer further down than the one it names. This file used to unset
      // `TEST` by hand right here; #11267 moved that into `childEnv()` so
      // every spawner in this directory gets it without having to know, and
      // widened it to the whole `VITEST*` family. The behaviour of this
      // fixture is unchanged — `childEnv()` removes a superset of what the
      // hand-written `TEST: undefined` removed.
      ...env,
    }),
  }) as ProbeChild;
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
