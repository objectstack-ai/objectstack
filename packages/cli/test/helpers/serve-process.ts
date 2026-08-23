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
 * The third row is the isolation: **`TEST` alone is load-bearing.** The
 * `VITEST*` entries are stripped as hygiene — nothing in `os serve` reads them
 * today, and a child that believes it is a vitest worker is a lie regardless.
 *
 * ⛔ `NODE_ENV` is deliberately NOT in this family. The vitest worker exports
 * `NODE_ENV=test` too, but every caller here already pins the child's
 * `NODE_ENV` explicitly (`bin/run-dev.js` sets `development` before argv is
 * even parsed; the `bin/run.js` spawners pass it in `env`), so stripping it
 * would change which entrypoint those tests resolve through rather than remove
 * a leak. That is a different defect with its own card (#11317) — ⛔ do not
 * fold it in here.
 */
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
 * Build the environment for a spawned CLI child: this process's environment
 * minus the vitest worker family above, plus `overrides`.
 *
 * The strip is a **class**, not the fixed list: `TEST` exactly, plus anything
 * matching `VITEST`/`VITEST_*`. `VITEST_WORKER_ENV_KEYS` names the five that
 * vitest 4 exports today (and is what the pin asserts against), but a future
 * runner variable in that namespace is caught without anyone having to
 * rediscover this trap first.
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
    if (isVitestWorkerKey(key)) continue;
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
