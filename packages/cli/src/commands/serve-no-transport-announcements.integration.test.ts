// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 30 — spawns the real producer once per single-cause fixture: three boots of the built CLI (production --no-server, a default boot, a config-mounted HonoServerPlugin under --no-server), each read over its IPC channel and its OS_HOME; 20.9 s, the slowest of three local runs on a shared container, x 1.25, no CI reading yet

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #23743 — a real `os serve` boot announces an address on its machine channels
 * only when an HTTP transport is composed, and prints the banner's `MCP:` row
 * only when the route's owner is composed.
 *
 * ## The defects, measured at this door before the fix
 *
 * 1. `os serve objectstack.config.ts --no-server --preset minimal`, production,
 *    spawned with an `ipc` channel: `{ type: 'objectstack:listening', port,
 *    url: 'http://localhost:PORT' }` arrived, `runtime.env_local.<project>.json`
 *    was written with the same `url`, and a `GET` to that port answered
 *    `ECONNREFUSED`. The docs row for the message reads "The HTTP server is
 *    bound".
 * 2. The same command with a config that mounts its own `HonoServerPlugin`:
 *    the banner printed `MCP: http://localhost:PORT/api/v1/mcp` and its connect
 *    hint, and `GET /api/v1/mcp` answered 404 while the REST data route
 *    answered 401 — the transport listened, the MCP route was not mounted.
 *
 * ## What is pinned, one boot per shape
 *
 *   1. production `--no-server` (the card's command): no `objectstack:listening`
 *      message, `objectstack:seed-settled` still sent (and so the boot's only
 *      message), and no runtime state file EVER created in its `OS_HOME`;
 *   2. CONTROL: a default production boot sends `objectstack:listening` with
 *      the port its `API:` row names, `seed-settled` after it, writes the state
 *      file with that same `port` and `url` before the message arrives, prints
 *      `MCP:`, and the port answers;
 *   3. a config-mounted `HonoServerPlugin` under `--no-server`: no `MCP:` row
 *      and no connect hint (the route answers 404 there), while `API:` still
 *      prints — and, the transport being composed, the IPC message and the
 *      state file are both published: the three channels agree.
 *
 * ## Why "ever created", read through a directory watch
 *
 * Shape 1 exits on its own a few milliseconds after its banner (a separate
 * card), and the state file's exit handler deletes the file. A directory
 * listing taken after the boot therefore cannot tell "never written" from
 * "written and cleaned up", and would stay green with the defect back. So the
 * `OS_HOME` directory exists before the spawn and is watched: a creation of
 * `runtime.*.json` at any moment of the boot is recorded.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset, and `.integration`
 *
 * As in `serve-no-server-banner.integration.test.ts`: production posture,
 * which `bin/run-dev.js` cannot reach, and oclif resolves the command from
 * `dist/`, so this file needs a built CLI. `src/` cannot import
 * `test/helpers/serve-process.ts`, so its few helpers are local. It rides the
 * queue run, where a `serve.ts` edit lands.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../../bin/run.js');
/** What one build emits for every command; its absence means "never built". */
const BUILT_SERVE = resolve(HERE, '../../dist/commands/serve.js');

const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;
const BANNER_HEAD = 'Server is ready';
const MCP_ROW = /\bMCP:/;
const STATE_FILE = /^runtime\..+\.json$/;

const AUTH_SECRET = 'os-23743-auth-secret-not-a-real-credential';
const SECRET_KEY = '0e2e'.repeat(16);

const OBJECT = `{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text', label: 'Title' } } }`;
const MANIFEST = `{ id: 'com.example.fx23743', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx' }`;
/** An instantiated plugin, which is what makes this a HOST config. */
const HOST_PLUGIN = `{ name: 'com.example.fx23743.host-plugin', version: '1.0.0', init: async () => {}, start: async () => {} }`;

interface IpcMessage { type?: string; port?: unknown; url?: unknown }

const children: ChildProcess[] = [];
const watchers: FSWatcher[] = [];
let root: string;
let plainDir: string;
let honoDir: string;

/** The root of an installed dependency of this package, found through `node_modules`. */
function packageRoot(specifier: string): string {
  let dir = dirname(createRequire(import.meta.url).resolve(specifier));
  while (!existsSync(join(dir, 'package.json'))) {
    if (dirname(dir) === dir) throw new Error(`${specifier} resolved to no package root`);
    dir = dirname(dir);
  }
  return dir;
}

function writeFixture(dir: string, header: string, plugins: string, links: string[]): void {
  mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx-23743', private: true, type: 'module' }));
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    `import { defineStack } from '@objectstack/spec';\n${header}\n`
      + `export default defineStack({ manifest: ${MANIFEST}, objects: [${OBJECT}], plugins: [${plugins}] });\n`,
  );
  for (const name of links) {
    symlinkSync(packageRoot(`@objectstack/${name}`), join(dir, 'node_modules', '@objectstack', name), 'dir');
  }
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

/** This process's environment for a child, minus the vitest worker family and every input that would move the boot. */
function childEnv(home: string, overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  return {
    ...env,
    NO_COLOR: '1',
    OS_LOG_LEVEL: '',
    OS_DISABLE_CONSOLE: '1',
    OS_CLOUD_URL: 'off',
    OS_HOME: home,
    OS_SECRET_KEY: SECRET_KEY,
    OS_ENVIRONMENT_ID: undefined,
    OS_DATABASE_URL: undefined,
    DATABASE_URL: undefined,
    OS_DATABASE_DRIVER: undefined,
    OS_AUTH_SECRET: undefined,
    OS_TENANCY_POSTURE: undefined,
    OS_MULTI_ORG_ENABLED: undefined,
    OS_AUTH_URL: undefined,
    BETTER_AUTH_URL: undefined,
    OS_BASE_URL: undefined,
    // MCP is default-on; the pins read its row.
    OS_MCP_SERVER_ENABLED: undefined,
    NODE_ENV: undefined,
    ...overrides,
  };
}

/** One state-file reading: its name and parsed body. */
interface StateReading { file: string; body: { port?: unknown; url?: unknown; pid?: unknown } }

interface Boot {
  /** The banner, from its head to its tail. */
  banner: string;
  /** Every IPC message, in arrival order. */
  messages: IpcMessage[];
  /** The `OS_HOME` state files present when `objectstack:listening` arrived (empty if it never did). */
  stateAtListening: StateReading[];
  /** Every `runtime.*.json` name the directory watch saw created, at any moment of the boot. */
  stateFilesEverSeen: string[];
  stop: () => void;
}

function readState(home: string): StateReading[] {
  return readdirSync(home)
    .filter((f) => STATE_FILE.test(f))
    .map((file) => ({ file, body: JSON.parse(readFileSync(join(home, file), 'utf8')) }));
}

/**
 * Spawn `os serve` with an `ipc` channel and resolve once BOTH its complete
 * banner has printed and `objectstack:seed-settled` has arrived — the last
 * thing every boot sends. A child that exits first resolves with what it sent
 * if the banner printed (shape 1 exits on its own), and rejects otherwise.
 */
async function boot(cwd: string, env: Record<string, string | undefined>, args: string[]): Promise<Boot> {
  const port = await freePort();
  const home = join(cwd, `.os-home-${port}`);
  mkdirSync(home, { recursive: true });
  const stateFilesEverSeen = new Set<string>();
  // Armed BEFORE the spawn: a file written and deleted mid-boot is still seen.
  watchers.push(watch(home, (_event, name) => {
    if (name && STATE_FILE.test(String(name))) stateFilesEverSeen.add(String(name));
  }));
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--port', String(port), ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: childEnv(home, { FX_PORT: String(port), ...env }),
  });
  children.push(child);

  let output = '';
  const messages: IpcMessage[] = [];
  let stateAtListening: StateReading[] = [];
  return new Promise<Boot>((done, fail) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The watch callback is asynchronous: fold in what is on disk now too.
      for (const { file } of existsSync(home) ? readState(home) : []) stateFilesEverSeen.add(file);
      const banner = output.slice(output.lastIndexOf(BANNER_HEAD));
      done({
        banner: banner.slice(0, banner.search(READY_BANNER_TAIL)),
        messages,
        stateAtListening,
        stateFilesEverSeen: [...stateFilesEverSeen],
        stop: () => child.kill('SIGTERM'),
      });
    };
    const ready = () => READY_BANNER_TAIL.test(output) && messages.some((m) => m.type === 'objectstack:seed-settled');
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      fail(new Error(`serve neither completed its boot nor exited\n--- messages ---\n${JSON.stringify(messages)}\n--- output ---\n${output}`));
    }, 150_000);
    child.on('message', (raw: unknown) => {
      const message = (raw ?? {}) as IpcMessage;
      messages.push(message);
      // Read synchronously on receipt: the publish order writes the file BEFORE the message.
      if (message?.type === 'objectstack:listening') stateAtListening = readState(home);
      if (ready()) finish();
    });
    const onData = (d: unknown) => {
      output += String(d);
      if (ready()) finish();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      if (settled) return;
      if (READY_BANNER_TAIL.test(output)) {
        // Let the last IPC message and watch event drain before reading them.
        setTimeout(finish, 250);
        return;
      }
      settled = true;
      clearTimeout(timer);
      const contended = /already in use|EADDRINUSE/.test(output);
      fail(new Error(
        (contended
          ? `PORT CONTENTION on ${port}: another process took it between the probe and the spawn — a host race, not a verdict; re-run this file.\n`
          : `serve exited ${code} before its banner\n`)
          + `--- output ---\n${output}`,
      ));
    });
  });
}

/** The port the banner's `API:` row names, or null. */
function apiPort(banner: string): number | null {
  const row = banner.split('\n').find((line) => line.includes('API:'));
  const match = row ? /http:\/\/localhost:(\d+)\//.exec(row) : null;
  return match ? Number(match[1]) : null;
}

/** The status `GET http://localhost:<port><path>` answers. */
async function statusOf(port: number, path: string): Promise<number> {
  const res = await fetch(`http://localhost:${port}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  return res.status;
}

const types = (messages: IpcMessage[]) => messages.map((m) => m.type);

beforeAll(() => {
  if (!existsSync(BUILT_SERVE)) {
    throw new Error(
      `packages/cli is not built: ${BUILT_SERVE} does not exist. This file spawns bin/run.js with NODE_ENV unset, `
        + 'which resolves the command from dist/. Run: pnpm exec turbo run build --filter=@objectstack/cli',
    );
  }
  root = mkdtempSync(join(tmpdir(), 'os-serve-no-transport-announcements-'));
  plainDir = join(root, 'plain');
  writeFixture(plainDir, '', HOST_PLUGIN, ['spec']);
  honoDir = join(root, 'hono');
  writeFixture(
    honoDir,
    "import { HonoServerPlugin } from '@objectstack/plugin-hono-server';\n",
    `${HOST_PLUGIN}, new HonoServerPlugin({ port: Number(process.env.FX_PORT) })`,
    ['spec', 'plugin-hono-server'],
  );
});

afterAll(() => {
  for (const watcher of watchers) watcher.close();
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('os serve — the machine channels announce an address only when an HTTP server is composed (#23743)', () => {
  it(
    'production --no-server (the card\'s command): no objectstack:listening, no state file, seed-settled alone',
    async () => {
      const { banner, messages, stateFilesEverSeen, stop } = await boot(plainDir, {}, ['--no-server', '--preset', 'minimal']);
      stop();
      const seen = `\n--- messages ---\n${JSON.stringify(messages)}\n--- banner ---\n${banner}`;
      // `soft`: three independent channels, each reported on its own when it regresses.
      expect.soft(
        messages.filter((m) => m.type === 'objectstack:listening'),
        `objectstack:listening was sent by a boot that bound no HTTP server${seen}`,
      ).toEqual([]);
      expect.soft(types(messages), `seed-settled is not the boot's one message${seen}`).toEqual(['objectstack:seed-settled']);
      expect.soft(stateFilesEverSeen, `a runtime state file was written by a boot that bound no HTTP server${seen}`).toEqual([]);
    },
    240_000,
  );

  it(
    'control: a default production boot sends objectstack:listening with the bound address, seed-settled after it, and writes the state file first',
    async () => {
      const { banner, messages, stateAtListening, stop } = await boot(
        plainDir,
        { OS_DATABASE_URL: 'file:./ctl.db', OS_AUTH_SECRET: AUTH_SECRET },
        [],
      );
      const seen = `\n--- messages ---\n${JSON.stringify(messages)}\n--- banner ---\n${banner}`;
      try {
        const port = apiPort(banner);
        expect(port, `no API row naming a localhost port${seen}`).not.toBeNull();
        const url = `http://localhost:${port}`;
        expect(types(messages), `not listening then seed-settled${seen}`).toEqual([
          'objectstack:listening',
          'objectstack:seed-settled',
        ]);
        expect(messages[0], `the listening message does not name the bound address${seen}`).toEqual({
          type: 'objectstack:listening',
          port,
          url,
        });
        expect(stateAtListening.map((s) => ({ port: s.body.port, url: s.body.url })), `the state file${seen}`).toEqual([
          { port, url },
        ]);
        expect(banner, `no MCP row on a boot that mounts the route${seen}`).toMatch(/MCP:\s+http:\/\/localhost:\d+\/api\/v1\/mcp/);
        expect(await statusOf(port as number, '/api/v1/health'), `the announced port did not answer health${seen}`).toBe(200);
        expect(await statusOf(port as number, '/api/v1/mcp'), `the MCP row names an unmounted route${seen}`).not.toBe(404);
      } finally {
        stop();
      }
    },
    240_000,
  );

  it(
    '--no-server with a config-mounted HonoServerPlugin: no MCP: row (its route is not mounted), and the three channels agree on the address',
    async () => {
      const { banner, messages, stateAtListening, stop } = await boot(
        honoDir,
        { OS_DATABASE_URL: 'file:./ctl.db' },
        ['--no-server', '--preset', 'minimal'],
      );
      const seen = `\n--- messages ---\n${JSON.stringify(messages)}\n--- banner ---\n${banner}`;
      try {
        const port = apiPort(banner);
        expect(port, `the API: row is gone though the config composed a server${seen}`).not.toBeNull();
        expect(banner.split('\n').filter((l) => MCP_ROW.test(l)), `an MCP: row printed for an unmounted route${seen}`).toEqual([]);
        expect(banner, `the MCP connect hint printed${seen}`).not.toContain('connect an AI client');
        // Why the row must not print here: the route is not mounted on this shape.
        // Should that change, the row is due back — revisit the gate, not this line.
        expect(await statusOf(port as number, '/api/v1/mcp'), `the MCP route is mounted on this shape now${seen}`).toBe(404);
        // A transport IS composed, so the machine channels announce it — the same answer the banner gave.
        const url = `http://localhost:${port}`;
        expect(messages.find((m) => m.type === 'objectstack:listening'), `no listening message for a bound server${seen}`).toEqual({
          type: 'objectstack:listening',
          port,
          url,
        });
        expect(stateAtListening.map((s) => ({ port: s.body.port, url: s.body.url })), `the state file${seen}`).toEqual([
          { port, url },
        ]);
      } finally {
        stop();
      }
    },
    240_000,
  );
});
