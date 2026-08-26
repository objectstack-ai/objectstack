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

import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** `bin/run-dev.js` — the CLI entrypoint that runs from TS source via tsx. */
export const CLI = resolve(HERE, '../../bin/run-dev.js');
export const TSX = resolve(HERE, '../../../../node_modules/.bin/tsx');

/**
 * The bind probe, run in a throwaway Node process: bind `0.0.0.0:<want>`, print
 * the port the kernel actually assigned, close. `want = 0` asks the kernel to
 * choose. Returns `null` when the bind failed — which for a specific `want`
 * means "that port is taken", and for `0` means the probe itself malfunctioned.
 *
 * ## Why a SUBPROCESS rather than an in-process `net.createServer()`
 *
 * `net.Server#listen()` reports its assigned port ASYNCHRONOUSLY. Measured on
 * this container (node 22.22.2): `server.address()` is `null` on the very next
 * line after `listen(0, '0.0.0.0')`, so an in-process probe can only be
 * `async`. `randomPort()` below is called from ~14 sites across 8 other files
 * in this directory, every one of them passing it straight into a `spawn()`
 * argument list; turning it async would edit all of them for no behavioural
 * gain. A `node -e` child does the same bind and is synchronous from this
 * process's point of view.
 *
 * The price, measured on the container this suite runs in: ~72-75 ms per draw
 * (10-draw means, `NODE_OPTIONS` inherited 74.7 ms, cleared 71.7 ms). Against
 * this package's own measured per-spawn floor — 2.9 s for `node bin/run.js
 * --version`, 6.5 s for the tsx source entry — one draw is ~2.6% of the
 * cheapest thing it precedes, and ~14 draws are ~1 s against a suite whose wall
 * was 495.8 s when `vitest.config.ts` last measured it (~0.2%).
 *
 * `NODE_OPTIONS` is cleared for the probe: it is a bare `net` bind, so nothing
 * this suite loads applies to it, and an inherited `--import` hook would run in
 * it for no reason.
 */
function probeBind(want: number): number | null {
  const src = [
    "const net = require('node:net');",
    'const want = Number(process.argv[1] || 0);',
    'const s = net.createServer();',
    "s.on('error', () => process.exit(3));",
    "s.listen(want, '0.0.0.0', () => {",
    '  const p = s.address().port;',
    '  s.close(() => process.stdout.write(String(p)));',
    '});',
  ].join('\n');
  try {
    const out = execFileSync(process.execPath, ['-e', src, String(want)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    const port = Number(out.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * The ONE port draw for every e2e spawn in this directory — a real bind probe,
 * not a blind `Math.random()` (#12441).
 *
 * Listen on `0.0.0.0:0`, read the port the kernel assigned, close the listener,
 * return the port for the caller to hand to `os serve`.
 *
 * ## ⚠️ What this guarantees, and what it does NOT — both halves, deliberately
 *
 * It is **still TOCTOU**. The listener is closed before `serve` binds, so the
 * port is unheld across the close-to-spawn gap and this can still lose a race.
 * What it actually buys:
 *
 *   • It never draws a port that is **already held**. A blind draw picks a
 *     number out of a range without asking anyone, so a neighbouring agent's
 *     dev server — bound for that process's entire lifetime, minutes or hours —
 *     is a live target on every single draw. The kernel does not assign a port
 *     that is currently bound, so that whole population is off the table.
 *   • It narrows the window from "the whole run" to "one close-to-spawn gap"
 *     (milliseconds). Only something that binds *inside* that gap can take it.
 *   • It removes this directory's second collision source. There used to be
 *     three independent draws over two overlapping ranges (41000-60000 here,
 *     40000-60000 in `serve-app-anchored-optional-import.e2e.test.ts`), which
 *     could collide with EACH OTHER under `--maxWorkers > 1`, not only with a
 *     neighbour. There is one draw now and it asks the kernel.
 *
 * ⛔ The comment this replaced claimed "a run never contends with another
 * agent's dev server on this host". That unqualified negative is the reason
 * nobody re-examined the draw until a real run in this fleet went red on
 * `✗ Port 49402 is already in use`. **Do not write another one here.** The
 * residual race is real and unclosed; what pays for it is
 * `portContentionError()` below, which makes the residual failure SAY it is a
 * port race instead of `serve exited 1 before "Server is ready"`.
 *
 * ⚠️ One property that is worse than the old range and is stated rather than
 * hidden: the kernel assigns from its ephemeral range
 * (`/proc/sys/net/ipv4/ip_local_port_range`, 32768-60999 on this container),
 * which is also where it draws source ports for OUTBOUND connections. The old
 * 40000-60000 range overlapped that anyway, and the probe's win — never
 * handing out a port some listener already holds — is the larger term. Nothing
 * here makes the port immune once it is handed over.
 */
export function reservePort(): number {
  // Retried, because a `null` for `want = 0` is a malfunctioning probe (the
  // kernel cannot answer "busy" to a request for any free port), and turning a
  // transient subprocess hiccup into a hard failure would replace one flake
  // class with another.
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = probeBind(0);
    if (port !== null) return port;
  }
  throw new Error(
    'bind probe failed: could not obtain a free TCP port from the kernel after 3 attempts '
    + '(listen on 0.0.0.0:0 in a `node -e` child). This is a host problem, not a verdict '
    + 'about the code under test.',
  );
}

/**
 * Is `port` bindable RIGHT NOW? The **negative arm** of the same probe.
 *
 * Exported so `serve-port-bind-probe.test.ts` can prove the instrument is able
 * to answer NO: a probe that reports "free" for a port the test is holding open
 * is not an instrument, and every claim `reservePort()` makes rests on this
 * being a real bind rather than a shape that always succeeds.
 */
export function portIsFree(port: number | string): boolean {
  return probeBind(Number(port)) !== null;
}

/**
 * `reservePort()` as a string, for the call sites that pass a port straight
 * into a `spawn()` argument list.
 *
 * ⚠️ The name is kept — and is now a slight misnomer, which is cheaper than the
 * alternative. It is `String(reservePort())` and nothing else; the draw, the
 * guarantees and the residual race are all documented on `reservePort()` above
 * and there is no second mechanism hiding behind this name. Renaming it would
 * be a rename-only edit across the 8 other files in this directory that call
 * it, which is churn this change deliberately does not spend.
 */
export function randomPort(): string {
  return String(reservePort());
}

/** How a boot says the port was taken — `serve.ts`'s own diagnostic, then the raw kernel error. */
const PORT_TAKEN_PATTERNS = [
  /Port (\d+) is already in use/,
  /EADDRINUSE[^\n]*?:(\d+)/,
];

/**
 * ⭐ Turn a boot that died on a taken port into a failure that SAYS SO (#12441
 * ruling ④).
 *
 * Returns an `Error` when `output` shows the child could not bind, else `null`.
 *
 * ## Why this exists, and why it is the half that pays
 *
 * The measured cost of a lost port race here is not the lost run. It is *"a red
 * suite that is not reproducible, on a test file the reader has no reason to
 * connect to a port"* — the failure surfaced as `serve exited 1 before "Server
 * is ready"` inside a file about `NODE_ENV` defaulting, and it cost an agent a
 * round to decide whether the failure belonged to the change under test. A fix
 * that only lowers the probability leaves that cost exactly where it was, just
 * rarer and therefore even more surprising when it lands.
 *
 * So the port number is read out of the CHILD's own diagnostic rather than
 * passed in: whatever the harness thought it reserved, the number the child
 * printed is the one that was contended. `probedPort` is threaded in only to
 * say, in the message, that the port WAS probed free moments earlier — which is
 * what tells the reader this is the residual TOCTOU gap and not a harness that
 * never looked.
 */
export function portContentionError(
  output: string,
  what: string,
  probedPort?: number | string,
): Error | null {
  let port: string | undefined;
  for (const pattern of PORT_TAKEN_PATTERNS) {
    const match = pattern.exec(output);
    if (match) {
      port = match[1];
      break;
    }
  }
  if (port === undefined) return null;
  const probed = probedPort === undefined
    ? ''
    : `This harness bind-probed ${probedPort} and the kernel reported it FREE moments earlier `
      + '(`reservePort()` in `test/helpers/serve-process.ts`), so this is the residual '
      + 'close-to-spawn gap that probe narrows but does not close.\n';
  return new Error(
    `PORT CONTENTION on port ${port}: \`${what}\` could not bind it.\n`
    + probed
    + 'Several agents share one container in this fleet, so another process took the port '
    + 'between the probe and the spawn.\n'
    + '⛔ This is a HOST race, not a verdict about the code under test. Do not spend a round '
    + 'deciding whether your change caused it — re-run this file in isolation. If it '
    + 'reproduces there, the port is genuinely held and the message above names it.\n'
    + `--- child output ---\n${output}`,
  );
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
 * The port a caller asked for, read back out of its own `args`.
 *
 * `runServe` takes the port as an opaque argv element rather than a parameter,
 * so this is how it learns which port it probed — for the message only, never
 * for the verdict (`portContentionError` reads the contended port out of the
 * child's own diagnostic). `undefined` when the caller passed no `--port`,
 * which just drops one sentence from the message.
 */
function portOf(args: string[]): string | undefined {
  for (const flag of ['--port', '-p']) {
    const at = args.indexOf(flag);
    if (at !== -1 && at + 1 < args.length) return args[at + 1];
  }
  return undefined;
}

/**
 * Boot `os serve` in `cwd`, collect its output until `waitFor` matches (or the
 * process exits), then stop it. Never leaves the child running.
 *
 * A boot that DIES still has to have said why, so an early exit resolves rather
 * than rejects — the caller's assertions read what it printed on the way down.
 *
 * ⭐ ONE narrow exception to that, and it is deliberate (#12441): a boot that
 * died because it could not BIND rejects, with `portContentionError()`'s
 * message. That death says nothing about the code under test, and letting it
 * resolve hands the caller an output buffer whose assertions then fail on
 * whatever marker is missing — which is the illegible shape the card measured.
 * No test in this directory drives a deliberately-busy port, so nothing is
 * asserting on the resolved form of it.
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
      if (err) {
        rejectRun(err);
        return;
      }
      const contended = portContentionError(
        stdout + stderr,
        'os serve (bin/run-dev.js, via runServe)',
        portOf(args),
      );
      if (contended) {
        rejectRun(contended);
        return;
      }
      resolveRun({ stdout, stderr });
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
