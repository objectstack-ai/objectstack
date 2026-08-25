// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared harness for e2e tests that need the REAL `os serve` process.
 *
 * Some serve defects only exist above the kernel — the boot-quiet stdout window
 * (#4012), the plugin registration ORDER the command assembles (#4085) — so
 * they survive every in-process test and only a test that spawns the actual
 * command can catch them. This module owns that spawn so each e2e file asserts
 * rather than re-implements it.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** `bin/run-dev.js` — the CLI entrypoint that runs from TS source via tsx. */
export const CLI = resolve(HERE, '../../bin/run-dev.js');
export const TSX = resolve(HERE, '../../../../node_modules/.bin/tsx');

/** A random high port, so a run never contends with a dev server on this host. */
export function randomPort(): string {
  return String(40000 + Math.floor(Math.random() * 20000));
}

/**
 * The variables vitest sets on its own WORKER process, which must never reach a
 * spawned `os serve` child (#11267).
 *
 * ## Why this exists — measured, not defensive
 *
 * A child built with `{ ...process.env, … }` inherits the **vitest worker's**
 * environment, and vitest sets `TEST=true` on that worker unconditionally,
 * independent of `NODE_ENV`. better-auth 1.7.1 reads `TEST` **directly**:
 *
 * ```js
 * // @better-auth/core/dist/env/env-impl.mjs:36
 * const isTest = () => nodeENV === "test" || toBoolean(env.TEST);
 * // better-auth/dist/context/create-context.mjs:210
 * skipOriginCheck: options.advanced?.disableOriginCheck !== void 0
 *   ? options.advanced.disableOriginCheck
 *   : isTest() ? true : false,
 * ```
 *
 * So an inherited `TEST=true` disables better-auth's origin/CSRF validation
 * **entirely**, one layer below anything `serve.ts` or `plugin-auth` decide,
 * and independent of whatever `NODE_ENV` the caller sets on the child. The
 * dangerous direction is not a red test: it is a security-posture assertion
 * that can never go red for the reason it exists, which reads as coverage.
 *
 * MEASURED on a real boot through this helper's own spawn recipe — same
 * fixture, same code, the five variables below the only difference. Probe:
 * `POST /api/v1/auth/sign-in/email` with `Origin: https://evil.example.com`
 * (untrusted under every branch of `serve.ts`'s trusted-origin assembly,
 * including the `isDev` `http://localhost:*` convenience that `run-dev.js`
 * always turns on):
 *
 * | child env | answer |
 * |---|---|
 * | `{ ...process.env }` (this helper, before #11267) | `401 INVALID_EMAIL_OR_PASSWORD` — origin ACCEPTED, validation never ran |
 * | family below stripped | `403 INVALID_ORIGIN` — validation ran and rejected |
 * | only `TEST` stripped | `403 INVALID_ORIGIN` |
 *
 * The third row is the isolation for THAT probe: `TEST` alone is what
 * better-auth reads.
 *
 * ## VITEST is stripped as defence-in-depth now, not for a live product read
 *
 * The first revision of this header said the `VITEST*` entries were stripped
 * as hygiene, "nothing in `os serve` reads them today". That was **false**
 * for a while: `detectMode` in `local-crypto-provider.ts` read `env.VITEST`
 * directly, so an inherited `VITEST=true` put a spawned child's crypto layer
 * in `test` mode — ephemeral key, never touches disk, never refuses — no
 * matter what posture the rest of the boot was in. #11448 (`a58eac3e`,
 * merged 2026-08-23) removed that arm; `detectMode` today reads only
 * `NODE_ENV`:
 *
 * ```ts
 * // packages/services/service-settings/src/local-crypto-provider.ts:185
 * const detectMode = (env: EnvMap): CryptoMode => {
 *   if (env.NODE_ENV === 'test') return 'test';
 *   if (env.NODE_ENV === 'production') return 'production';
 *   return 'development';
 * };
 * ```
 *
 * No product source reads `VITEST` any more, and `pnpm check:runner-env-posture`
 * is the gate that keeps that class shut. The strip below stays anyway — now
 * as **defence-in-depth over a gated class**, not as the fix for a live read:
 * the choke point here should not depend on product source staying that way.
 *
 * The consequence this drove — `OS_SECRET_KEY` being a default below — no
 * longer follows from a VITEST leak; re-derive it from `NODE_ENV`, which is
 * what `detectMode` actually reads. `bin/run-dev.js` pins
 * `process.env.NODE_ENV = 'development'` before argv is even parsed, and
 * `NODE_ENV` is deliberately outside this strip family (below), so every
 * child spawned through this helper is ALREADY in `development` crypto
 * posture — with or without a leaked `VITEST`. Development mode **persists**
 * a minted key to `$HOME/.objectstack/dev-crypto-key`. Measured: with that
 * file absent a production-posture boot refuses to start, and with it
 * present — put there by any earlier dev-mode boot in the same run — the
 * same boot succeeds. That is a cross-test ordering coupling through the
 * runner's home directory, and under vitest's parallel workers it is
 * nondeterministic. An explicit key removes both halves: nothing is written,
 * and nothing is depended on.
 *
 * ⛔ `NODE_ENV` is deliberately NOT in this family. The vitest worker exports
 * `NODE_ENV=test` too, but every caller here already pins the child's
 * `NODE_ENV` explicitly (`bin/run-dev.js` sets `development` before argv is
 * even parsed; the `bin/run.js` spawners pass it in `env`), so stripping it
 * would change which entrypoint those tests resolve through rather than remove
 * a leak. That is a different defect with its own card (#11317) — ⛔ do not
 * fold it in here.
 */
/**
 * A fixed, obviously-synthetic 32-byte key (64 hex chars) for spawned children,
 * so no test boot has to mint one — see `runServe()` and the header above.
 * ⛔ Test fixtures only; it is in the repo in plaintext and encrypts nothing
 * anyone keeps.
 */
export const E2E_SECRET_KEY = '0e2e'.repeat(16);

export const VITEST_WORKER_ENV_KEYS = [
  'TEST',
  'VITEST',
  'VITEST_WORKER_ID',
  'VITEST_POOL_ID',
  'VITEST_MODE',
] as const;

/** `TEST` exactly, or any `VITEST`-prefixed variable — see `childEnv()`. */
function isVitestWorkerKey(key: string): boolean {
  return key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_');
}

/**
 * Variables that silently move a spawned child's module RESOLUTION BASE. A
 * different defect from the runner leak above, stripped for a different reason
 * (#11773).
 *
 * A vitest worker runs with `NODE_PATH` pointing at pnpm's hoisted store
 * (`node_modules/.pnpm/node_modules`), which holds everything transitively
 * reachable anywhere in the workspace. `NODE_PATH` is a FALLBACK, not an
 * override — the `node_modules` walk wins whenever it hits — so the store can
 * only turn a MISS into a HIT. The dangerous direction is therefore an
 * ACCEPTANCE claim ("this base CAN reach X"): green because the store supplied
 * X, not because the base did.
 *
 * The split that decides whether it bites, measured in
 * `test/vitest-resolution-base-collapse.e2e.test.ts`:
 *
 *     resolution API                        NODE_PATH honoured?   base kept?
 *     ESM  import() / import.meta.resolve            NO               YES
 *     CJS  createRequire().resolve()                 YES              NO
 *
 * Spawning a real Node child is this directory's remedy for the resolution base
 * an in-process test cannot measure at all (#11412) — it escapes Vite's
 * rewrite, but it did NOT escape this, so a spawned pin whose claim routes
 * through CJS was as vacuous as the in-process one it replaced.
 * `serve-host-fallback-base.e2e.test.ts`'s control survived only because
 * `createHostImporter`'s fallback leg happens to be an ESM `import()`; had it
 * been CJS — as `createHostRequire` is — the inherited `NODE_PATH` would have
 * kept it green through the very ablation it exists to fail.
 *
 * ⛔ Deliberately NOT folded into `VITEST_WORKER_ENV_KEYS` above. That list is
 * "what vitest sets on its own worker", and `NODE_PATH` is not vitest's: every
 * pnpm bin shim exports one, so a REAL `serve`/`dev` child in production
 * carries it — that is #4719's entire history. Stripping it here is a DEFAULT
 * for spawned test children, not a claim that no child should ever see it. A
 * test that reproduces the shim shape says so explicitly, and the #4719 pin in
 * `serve-organizations-host-resolution.e2e.test.ts` already does
 * (`env: { …, NODE_PATH: hoistedStore }`) — `overrides` are applied after the
 * strip, so that opt-in still wins. What changes is that the fidelity is now
 * DECLARED by the test that wants it rather than inherited by every child.
 */
export const RESOLUTION_BASE_ENV_KEYS = ['NODE_PATH'] as const;

const RESOLUTION_BASE_ENV_SET: ReadonlySet<string> = new Set(RESOLUTION_BASE_ENV_KEYS);

/**
 * Build the environment for a spawned CLI child: this process's environment
 * minus the TWO families stripped above, plus `overrides`.
 *
 * The vitest-worker strip is a **class**, not the fixed list: `TEST` exactly,
 * plus anything matching `VITEST`/`VITEST_*`. `VITEST_WORKER_ENV_KEYS` names
 * the five that vitest 4 exports today (and is what the pin asserts against),
 * but a future runner variable in that namespace is caught without anyone
 * having to rediscover this trap first. The resolution-base strip
 * (`RESOLUTION_BASE_ENV_KEYS`) is the opposite shape — exact names only, no
 * namespace — because `NODE_PATH` is a variable real children legitimately
 * carry, so widening it by prefix would strip things nobody measured.
 *
 * `overrides` is applied AFTER the strip, so a test that genuinely wants one of
 * these set in its child can still say so explicitly — the point is that
 * nothing arrives by accident. An `undefined` value UNSETS a variable for the
 * child: Node's `spawn()` omits `undefined`-valued entries rather than
 * stringifying them, which `''` would not do.
 */
export function childEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (isVitestWorkerKey(key) || RESOLUTION_BASE_ENV_SET.has(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

export interface ServeRun {
  stdout: string;
  stderr: string;
}

/**
 * Boot `os serve` in `cwd`, collect its output until `waitFor` matches (or the
 * process exits), then stop it. Never leaves the child running.
 *
 * A boot that DIES still has to have said why, so an early exit resolves rather
 * than rejects — the caller's assertions read what it printed on the way down.
 *
 * `waitFor` is matched against **stdout and stderr together** (#7915). `serve`
 * writes every human line — banner, boot progress, kernel logs — to stderr now,
 * because its stdout belongs to the MCP stdio transport when one is mounted;
 * matching stdout alone would wait for a stream that stays empty for the whole
 * boot. Both streams are still returned separately, which is what lets
 * `serve-stdio-stdout-purity.e2e.test.ts` assert stdout carries NOTHING else.
 */
export function runServe(
  cwd: string,
  args: string[],
  // `env` values may be `undefined` to UNSET a variable for the child (Node
  // omits undefined entries), which is how a test asserts behaviour that depends
  // on a variable being absent — `''` would not do it, since the resolvers this
  // exercises use `??` and an empty string is not nullish.
  opts: { waitFor: RegExp; timeoutMs?: number; config?: string; env?: Record<string, string | undefined> },
): Promise<ServeRun> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(TSX, [CLI, 'serve', opts.config ?? 'objectstack.config.ts', ...args], {
      cwd,
      // `childEnv`, never a bare `...process.env` — see its header for the
      // measured reason (#11267).
      env: childEnv({
        NO_COLOR: '1',
        // Keep the fixture self-contained: no file written, no port conflict
        // with another agent's dev server, no inherited log level.
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        // Same "no file written" rule, extended to the crypto key — see the
        // header. Without this the child mints one and PERSISTS it to
        // `$HOME/.objectstack/dev-crypto-key`, which both litters the runner's
        // home directory and couples unrelated tests to each other through it.
        OS_SECRET_KEY: E2E_SECRET_KEY,
        ...(opts.env ?? {}),
      }),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      if (err) rejectRun(err);
      else resolveRun({ stdout, stderr });
    };

    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `serve did not reach ${opts.waitFor} in time.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        ),
      opts.timeoutMs ?? 180_000,
    );

    child.stdout.on('data', (d) => {
      stdout += String(d);
      if (opts.waitFor.test(stdout + stderr)) finish();
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
      if (opts.waitFor.test(stdout + stderr)) finish();
    });
    child.on('error', (err) => finish(err));
    child.on('exit', () => finish());
  });
}
