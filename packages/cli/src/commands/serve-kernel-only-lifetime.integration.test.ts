// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — spawns the real producer once per single-cause fixture: three boots of the built CLI (production --no-server on the host kernel, --dev --no-server, a default composed boot), each differing only in the input under test, held 3 s past its banner and then stopped by SIGTERM; 27.0 s, the slower of two local runs on a shared container, x 1.25, no CI reading yet

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #23744 — a real `os serve` boot that composes no HTTP transport stays up
 * until it is stopped, as its banner's `Press Ctrl+C to stop` says.
 *
 * ## The defect, measured at this door before the fix
 *
 * `os serve objectstack.config.ts --no-server --preset minimal`, production,
 * on a host config with no `OS_DATABASE_URL` and no auth secret: the banner's
 * last line printed about 4.3 s after spawn and the process exited 0 by itself
 * about 60 ms later, with and without an `ipc` channel, before any signal and
 * without its kernel shutting down. Nothing held the event loop. The same
 * command stayed up whenever the storage driver kept a connection pool
 * (`--dev --no-server`, or `--no-server` with `OS_DATABASE_URL` set): the only
 * ref'd handle on those boots was the SQL driver's pool-reaping interval.
 *
 * ## What is pinned, one boot per shape
 *
 * Each boot is read for its banner and `objectstack:seed-settled`, then left
 * alone for {@link HOLD_WINDOW_MS}, then sent SIGTERM:
 *
 *   1. production `--no-server` with no store and no auth composed (the card's
 *      shape): still alive after the window, and SIGTERM ends it with the
 *      kernel's code, 0, the kernel's own handler exiting the process (no
 *      signal death). [ADR-0131 D9] The card's own `--preset minimal` composes
 *      no auth, and a production boot with no auth is now refused whether or
 *      not `--server`; the one production composition that still boots with
 *      no auth is the cloud runtime's host kernel (auth is each project's
 *      there), so this leg boots that — {@link HOST_KERNEL_PLUGIN} in the
 *      config, `tiers: ['core', 'auth']` so the `auth` tier is on and skipped
 *      by the host-kernel path, still `--preset minimal`, no secret. It keeps
 *      what made the defect: no storage driver, so no pool holding the event
 *      loop;
 *   2. CONTROL: `--dev --no-server` behaves as before: the same;
 *   3. CONTROL: a default composed production boot sends
 *      `[objectstack:listening, objectstack:seed-settled]`, stays up, and stops
 *      on SIGTERM with 0.
 *
 * The holding mechanism and its wiring are unit-pinned in
 * `serve-kernel-only-hold.test.ts`. This file reads only process state and
 * exit codes.
 *
 * ## Bounded, never hanging
 *
 * Every spawned child has a hard timeout on its boot and on its stop, and is
 * SIGKILLed in `finally` if it is still alive. A child that exits by itself
 * during the window is recorded, not waited on, which is how shape 1 goes red
 * with the fix ablated.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset, and `.integration`
 *
 * As in `serve-no-transport-announcements.integration.test.ts`: production
 * posture, which `bin/run-dev.js` cannot reach, and oclif resolves the command
 * from `dist/`, so this file needs a built CLI. `src/` cannot import
 * `test/helpers/serve-process.ts`, so its few helpers are local. The child's
 * environment is DECLARED, never copied from this process, so no vitest worker
 * variable and no ambient storage or auth input reaches it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../../bin/run.js');
/** What one build emits for every command; its absence means "never built". */
const BUILT_SERVE = resolve(HERE, '../../dist/commands/serve.js');

const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;

/**
 * How long a booted child is left alone before SIGTERM. Measured before the
 * fix, the card's shape exited about 60 ms after its banner; the window is
 * fifty times that, so a slow CI box cannot read an early exit as a hold.
 */
const HOLD_WINDOW_MS = 3_000;
const BOOT_TIMEOUT_MS = 150_000;
const STOP_TIMEOUT_MS = 60_000;

const AUTH_SECRET = 'os-23744-auth-secret-not-a-real-credential';
const SECRET_KEY = '0e2e'.repeat(16);

const OBJECT = `{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text', label: 'Title' } } }`;
const MANIFEST = `{ id: 'com.example.fx23744', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx' }`;
/** An instantiated plugin, which is what makes this a HOST config. */
const HOST_PLUGIN = `{ name: 'com.example.fx23744.host-plugin', version: '1.0.0', init: async () => {}, start: async () => {} }`;
/** The cloud runtime's host kernel, as `isHostKernelComposition` recognises it: auth is skipped with a warning. */
const HOST_KERNEL_PLUGIN = `{ name: 'com.objectstack.runtime.objectos-environment', version: '0.0.0', init: async () => {}, start: async () => {} }`;

interface IpcMessage { type?: string }
interface Exit { code: number | null; signal: NodeJS.Signals | null }

interface Lifetime {
  output: string;
  messages: IpcMessage[];
  /** How the child ended when it exited by itself — after its banner, before any signal. `null` when it held. */
  exitedOnItsOwn: (Exit & { msAfterBanner: number }) | null;
  /** How SIGTERM ended it; `timedOut` when it outlived {@link STOP_TIMEOUT_MS} and was SIGKILLed. */
  stopped: Exit | { timedOut: true } | null;
}

const children: ChildProcess[] = [];
let root: string;
let plainDir: string;
/** The same, on the cloud runtime's host kernel — see shape 1. */
let hostKernelDir: string;

/** The root of an installed dependency of this package, found through `node_modules`. */
function packageRoot(specifier: string): string {
  let dir = dirname(createRequire(import.meta.url).resolve(specifier));
  while (!existsSync(join(dir, 'package.json'))) {
    if (dirname(dir) === dir) throw new Error(`${specifier} resolved to no package root`);
    dir = dirname(dir);
  }
  return dir;
}

/** A port the kernel just called free. Narrows, never closes, the gap to the child's bind. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address ? done(address.port) : fail(new Error('no port'))));
    });
  });
}

/**
 * The child's whole environment, declared: the few variables a Node process
 * needs to run, the boot's fixed inputs, and the leg's own. `NODE_ENV` is
 * absent, which is production posture.
 */
function childEnv(home: string, leg: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    NO_COLOR: '1',
    OS_DISABLE_CONSOLE: '1',
    OS_CLOUD_URL: 'off',
    OS_HOME: home,
    OS_SECRET_KEY: SECRET_KEY,
  };
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'SystemRoot']) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...leg };
}

const sleep = (ms: number) => new Promise<'elapsed'>((done) => { const t = setTimeout(() => done('elapsed'), ms); t.unref(); });

/**
 * Spawn `os serve` with an `ipc` channel; wait for its complete banner and
 * `objectstack:seed-settled`; leave it alone for {@link HOLD_WINDOW_MS}; then
 * SIGTERM it and read how it ended. A child that exits before its banner
 * rejects with its output.
 */
async function bootHoldStop(cwd: string, leg: Record<string, string>, args: string[]): Promise<Lifetime> {
  const port = await freePort();
  const home = join(cwd, `.os-home-${port}`);
  mkdirSync(home, { recursive: true });
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--port', String(port), ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: childEnv(home, leg),
  });
  children.push(child);

  let output = '';
  const messages: IpcMessage[] = [];
  // `as`, not an annotation: assigned in a listener, so TypeScript must not narrow it to `null` here.
  let bannerAt = null as number | null;
  /** Milliseconds since the banner's last line printed. */
  const sinceBanner = () => (bannerAt === null ? Number.NaN : Date.now() - bannerAt);
  const exited = new Promise<Exit>((done) => child.once('exit', (code, signal) => done({ code, signal })));
  let onProgress = () => {};
  const progressed = () => onProgress();
  const onData = (d: unknown) => {
    output += String(d);
    if (bannerAt === null && READY_BANNER_TAIL.test(output)) bannerAt = Date.now();
    progressed();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('message', (raw: unknown) => {
    messages.push((raw ?? {}) as IpcMessage);
    progressed();
  });
  const seen = () => `\n--- messages ---\n${JSON.stringify(messages)}\n--- output ---\n${output}`;

  try {
    const ready = new Promise<'ready'>((done) => {
      onProgress = () => {
        if (bannerAt !== null && messages.some((m) => m.type === 'objectstack:seed-settled')) done('ready');
      };
      onProgress();
    });
    let bootTimer: NodeJS.Timeout | undefined;
    const bootTimedOut = new Promise<'boot-timeout'>((done) => { bootTimer = setTimeout(() => done('boot-timeout'), BOOT_TIMEOUT_MS); });
    const first = await Promise.race([ready, exited, bootTimedOut]);
    clearTimeout(bootTimer);
    if (first === 'boot-timeout') throw new Error(`serve neither completed its boot nor exited${seen()}`);
    if (first !== 'ready') {
      if (bannerAt === null) {
        const contended = /already in use|EADDRINUSE/.test(output);
        throw new Error(
          (contended
            ? `PORT CONTENTION on ${port}: another process took it between the probe and the spawn — a host race, not a verdict; re-run this file.`
            : `serve exited ${first.code ?? first.signal} before its banner`) + seen(),
        );
      }
      return { output, messages, exitedOnItsOwn: { ...first, msAfterBanner: sinceBanner() }, stopped: null };
    }

    const held = await Promise.race([exited, sleep(HOLD_WINDOW_MS)]);
    if (held !== 'elapsed') {
      return { output, messages, exitedOnItsOwn: { ...held, msAfterBanner: sinceBanner() }, stopped: null };
    }

    child.kill('SIGTERM');
    const stopped = await Promise.race([exited, sleep(STOP_TIMEOUT_MS)]);
    return { output, messages, exitedOnItsOwn: null, stopped: stopped === 'elapsed' ? { timedOut: true } : stopped };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

/** The card's assertion pair, with the reading attached to each failure. */
function expectHeldThenStopped(life: Lifetime): void {
  const seen = `\n--- messages ---\n${JSON.stringify(life.messages)}\n--- output (tail) ---\n${life.output.slice(-4000)}`;
  expect(
    life.exitedOnItsOwn,
    `the boot exited by itself after a banner ending "Press Ctrl+C to stop", before any signal${seen}`,
  ).toBeNull();
  // `signal: null` with code 0: the kernel's own SIGTERM handler drained it and
  // exited the process. A signal death would read `{ code: null, signal: 'SIGTERM' }`.
  expect(life.stopped, `SIGTERM did not end it with the kernel's code${seen}`).toEqual({ code: 0, signal: null });
}

beforeAll(() => {
  if (!existsSync(BUILT_SERVE)) {
    throw new Error(
      `packages/cli is not built: ${BUILT_SERVE} does not exist. This file spawns bin/run.js with NODE_ENV unset, `
        + 'which resolves the command from dist/. Run: pnpm exec turbo run build --filter=@objectstack/cli',
    );
  }
  root = mkdtempSync(join(tmpdir(), 'os-serve-kernel-only-lifetime-'));
  plainDir = join(root, 'plain');
  mkdirSync(join(plainDir, 'node_modules', '@objectstack'), { recursive: true });
  writeFileSync(join(plainDir, 'package.json'), JSON.stringify({ name: 'fx-23744', private: true, type: 'module' }));
  writeFileSync(
    join(plainDir, 'objectstack.config.ts'),
    "import { defineStack } from '@objectstack/spec';\n"
      + `export default defineStack({ manifest: ${MANIFEST}, objects: [${OBJECT}], plugins: [${HOST_PLUGIN}] });\n`,
  );
  symlinkSync(packageRoot('@objectstack/spec'), join(plainDir, 'node_modules', '@objectstack', 'spec'), 'dir');
  hostKernelDir = join(root, 'host-kernel');
  mkdirSync(join(hostKernelDir, 'node_modules', '@objectstack'), { recursive: true });
  writeFileSync(join(hostKernelDir, 'package.json'), JSON.stringify({ name: 'fx-23744-host-kernel', private: true, type: 'module' }));
  writeFileSync(
    join(hostKernelDir, 'objectstack.config.ts'),
    "import { defineStack } from '@objectstack/spec';\n"
      + `export default defineStack({ manifest: ${MANIFEST}, tiers: ['core', 'auth'], objects: [${OBJECT}], plugins: [${HOST_PLUGIN}, ${HOST_KERNEL_PLUGIN}] });\n`,
  );
  symlinkSync(packageRoot('@objectstack/spec'), join(hostKernelDir, 'node_modules', '@objectstack', 'spec'), 'dir');
});

afterAll(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('os serve — a boot with no HTTP transport stays up until it is stopped (#23744)', () => {
  it(
    'production --no-server with no store and no auth (the card\'s shape, on the host kernel): alive after its banner, and SIGTERM ends it with 0',
    async () => {
      expectHeldThenStopped(await bootHoldStop(hostKernelDir, {}, ['--no-server', '--preset', 'minimal']));
    },
    240_000,
  );

  it(
    'control: --dev --no-server, as before: alive after its banner, and SIGTERM ends it with 0',
    async () => {
      expectHeldThenStopped(await bootHoldStop(plainDir, {}, ['--dev', '--no-server']));
    },
    240_000,
  );

  it(
    'control: a default composed production boot sends listening then seed-settled, stays up, and SIGTERM ends it with 0',
    async () => {
      const life = await bootHoldStop(plainDir, { OS_DATABASE_URL: 'file:./ctl.db', OS_AUTH_SECRET: AUTH_SECRET }, []);
      expect(
        life.messages.map((m) => m.type),
        `not listening then seed-settled\n--- messages ---\n${JSON.stringify(life.messages)}`,
      ).toEqual(['objectstack:listening', 'objectstack:seed-settled']);
      expectHeldThenStopped(life);
    },
    240_000,
  );
});
