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
 * ## ⚠️ The port this file talks to is READ BACK, never assumed (#12548)
 *
 * The probe below is an HTTP request to `localhost:<port>`, and what it asserts
 * on the answer is a SECURITY posture. Until #12548 that request went to the
 * port this file ASKED for. Children here spawn through `bin/run-dev.js`, which
 * pins `NODE_ENV=development` before argv is parsed, so `serve.ts`'s
 * `portAutoShiftAllowed` is TRUE for every one of them: a taken port is not an
 * error there, it is a hop to the next free one, and the boot then SUCCEEDS.
 * The harness got a healthy child, a green run, and a request addressed to
 * whatever still held the port it asked for. On the shared container this fleet
 * develops in that is plausibly a neighbouring agent's dev server — measured
 * answering another harness's own request with
 * `{"iAm":"A NEIGHBOURING AGENT DEV SERVER, not os serve"}`.
 *
 * ⇒ a foreign process could supply the answer to the one assertion in this
 * directory where being wrong matters most. So `readyVerdict()` below settles
 * only once the child has SAID which port it took, and `portDriftError()`
 * (`helpers/serve-process.ts`, #12525) REFUSES a mismatch rather than probing.
 *
 * ⛔ The gate keys on the banner's TAIL, never on `Server is ready`. That line
 * is the banner's HEAD, printed one `console.error` before the `API:` row that
 * carries the port — so a head-keyed gate can settle while the port is still
 * unknown, and the comparison then compares nothing. Whether it did would
 * depend on how the pipe happened to chunk, which is the worst shape a check
 * can have: blind at random, and its silence reads as a pass.
 *
 * ⛔ And this is not an argument to make `os serve` stricter. Auto-shifting in
 * development is correct and deliberate (#11113 pins the production half for
 * its own reasons). The defect was that this harness could not tell.
 *
 * Cost: THREE real `os serve` boots — the two legs of the comparison above
 * (~18s together when measured on this container), plus the forced-drift arm
 * that proves the refusal can actually fire. That third boot is bought
 * deliberately: a read-back never observed failing is decoration, and on this
 * file it would be decoration over a security assertion. Every child is killed
 * in `afterAll` regardless of outcome.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  CLI,
  TSX,
  E2E_SECRET_KEY,
  boundPortFromBanner,
  childEnv,
  holdPort,
  portDriftError,
  randomPort,
  VITEST_WORKER_ENV_KEYS,
} from './helpers/serve-process.js';

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

/** How a refusal names this file's child — it spawns directly, so no helper can. */
const WHAT = 'os serve (bin/run-dev.js \u21d2 NODE_ENV=development, spawned directly by this file)';

/** What this file's ready gate makes of the child's output SO FAR. */
type ReadyVerdict =
  /** The child has not announced a bound port yet — keep waiting. */
  | { settled: false }
  /** It announced the port it was asked for, and this is that number. */
  | { settled: true; port: number }
  /** It announced a DIFFERENT port, or a banner that cannot say which. */
  | { settled: true; refusal: Error };

/**
 * ⭐ The ready gate (#12548): settle on having SEEN the port, never on a ready
 * marker.
 *
 * `boundPortFromBanner()` keys on the banner's LAST line, so `no-banner` means
 * "the child has not finished saying which port it took" — and returning
 * `{ settled: false }` for it is what makes the comparison below have something
 * to compare. ⛔ Do not settle this on `Server is ready`: that is the banner's
 * HEAD, one `console.error` ahead of the `API:` row, and a gate keyed there
 * resolves with the port still unknown. `portDriftError()` would then answer
 * `null` — a silent pass — and the whole check would be decorative.
 *
 * Every other state is a settled verdict, and the two failing ones are ERRORS
 * rather than skips for the reason `portDriftError()`'s own docblock gives: an
 * instrument that cannot answer has to say it could not answer.
 */
function readyVerdict(output: string, requestedPort: string): ReadyVerdict {
  const readback = boundPortFromBanner(output);
  if (readback.state === 'no-banner') return { settled: false };

  const refusal = portDriftError(output, WHAT, requestedPort);
  if (refusal) return { settled: true, refusal };

  if (readback.state !== 'bound') {
    // Unreachable while `portDriftError()` answers for every state but
    // `no-banner`. Written as a refusal rather than assumed away, so that
    // widening its silence some day fails loudly HERE instead of quietly
    // handing this file a port no one verified.
    return {
      settled: true,
      refusal: new Error(
        `portDriftError() stayed silent on a ${readback.state} banner, so this harness has no `
        + `verified port to probe.\n--- child output ---\n${output}`,
      ),
    };
  }

  return { settled: true, port: readback.port };
}

/**
 * Boot the real `os serve` through the same entrypoint `runServe()` uses, read
 * the port the child ACTUALLY bound back out of its own banner, probe the
 * origin check on THAT port while it is UP, then stop it.
 *
 * `runServe()` cannot stand in here, twice over: it kills the child the moment
 * `waitFor` matches, so there is no window in which to send a request — and
 * because this file therefore spawns directly, #12525's read-back inside
 * `runServe()` never reaches it. That is why the gate is written out here.
 *
 * `requestedPort` is a parameter rather than a local so the forced-drift arm
 * below can hand it a port that is genuinely HELD. ⛔ Nothing else should pass
 * one: the default draw is bind-probed, and a hand-picked number is not.
 */
async function probeOrigin(
  env: Record<string, string | undefined>,
  requestedPort: string = randomPort(),
): Promise<{ status: number; code: unknown }> {
  const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '--port', requestedPort], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  }) as ProbeChild;
  children.push(child);

  let out = '';
  let err = '';
  try {
    const bound = await new Promise<number>((ready, fail) => {
      const timer = setTimeout(
        () => fail(new Error(
          'serve never printed a COMPLETE ready banner, so it never said which port it bound'
          + `\n--- stdout ---\n${out}\n--- stderr ---\n${err}`,
        )),
        150_000,
      );
      const onData = () => {
        const verdict = readyVerdict(out + err, requestedPort);
        if (!verdict.settled) return;
        clearTimeout(timer);
        if ('refusal' in verdict) fail(verdict.refusal);
        else ready(verdict.port);
      };
      child.stdout.on('data', (d) => { out += String(d); onData(); });
      child.stderr.on('data', (d) => { err += String(d); onData(); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        fail(new Error(
          `serve exited ${code} before it announced a bound port`
          + `\n--- stdout ---\n${out}\n--- stderr ---\n${err}`,
        ));
      });
    });

    // ⭐ `bound`, not `requestedPort`. They are provably the same number on this
    // line — a mismatch was REFUSED above rather than reaching it — and
    // addressing the child's own announced port is what keeps that true if the
    // gate is ever loosened.
    const res = await fetch(`http://localhost:${bound}/api/v1/auth/sign-in/email`, {
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

  it('the ready gate does not settle until the child has SAID which port it took', () => {
    // ⭐ #12548. The banner's HEAD alone is exactly what the gate this file used
    // to have settled on, and at that instant the `API:` row naming the port has
    // not been printed yet — so a drift comparison made there compares nothing
    // and `portDriftError()` answers `null`, a silent pass. This is the cheap
    // half of the check; the forced-drift boot below is the load-bearing one.
    expect(readyVerdict('', '41234')).toEqual({ settled: false });
    expect(readyVerdict('\n  \u2713 Server is ready\n', '41234')).toEqual({ settled: false });
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

    it(
      'THE LOAD-BEARING ARM: a child that DRIFTS off a held port is REFUSED, not probed',
      async () => {
        // ⛔ Nothing is simulated here: the port is really held, so `serve`'s own
        // `isPortAvailable()` says no and its dev-mode `getAvailablePort()` walks
        // off it. This is the lost race, produced.
        //
        // ⭐ What it pins is not `portDriftError()` — `serve-port-readback.e2e.
        // test.ts` owns that — but THIS file's wiring: that the gate above
        // reaches the refusal at all. A read-back called at a point that cannot
        // observe the port is silent forever, and its silence reads as a pass on
        // the security assertion this file exists to make.
        const held = await holdPort();
        try {
          await expect(probeOrigin(childEnv(OVERRIDES), String(held.port))).rejects.toThrow(
            /PORT DRIFT/,
          );
        } finally {
          await held.release();
        }
      },
      240_000,
    );
  });
});
