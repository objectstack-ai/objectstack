// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/**
 * #23623 — a real `os serve` boot prints the ready banner's address rows only
 * when an HTTP server is composed.
 *
 * ## The defect
 *
 * `os serve objectstack.config.ts --no-server --preset minimal`, in production,
 * printed `API: http://localhost:PORT/` and an MCP connect URL, and a `GET` to
 * that port failed: nothing listened, because `--no-server` had deliberately
 * started no server. The same boot's diagnostics said `RestApiPlugin: HTTP
 * Server service 'http.server' not found. REST routes skipped.`
 *
 * ## What is pinned, one boot per shape
 *
 *   1. production `--no-server` (the card's own command): no `API:`, `Console:`
 *      or `MCP:` row, and ONE line saying no HTTP server is served, naming
 *      `--no-server`;
 *   2. the same under `--dev`;
 *   3. CONTROL: a default production boot still prints `API:` and `MCP:`, and
 *      the `API:` port answers;
 *   4. CONTROL: under `--no-server` a config that mounts its OWN
 *      `HonoServerPlugin` (serve skips only its auto-wired one) still prints
 *      `API:`, because the composed-server read is off the kernel and not off
 *      the flag, and that port answers.
 *
 * The banner's unit shapes live in `utils/format.server-ready-no-http-server.test.ts`;
 * this file pins the WIRING: that serve hands the banner the kernel's answer.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset
 *
 * Shapes 1, 3 and 4 are production posture, which `bin/run-dev.js` cannot
 * reach: it sets `NODE_ENV=development` before argv is parsed. `NODE_ENV` unset
 * is also what makes oclif resolve the command from `dist/`, so this file needs
 * a built CLI (CI declares it: `@objectstack/cli#test` dependsOn `build`).
 * `src/` cannot import `test/helpers/serve-process.ts`, so the few helpers it
 * needs are local, and the child's environment drops the vitest worker family
 * that helper's `childEnv()` strips (its header says why).
 *
 * ## Why `.integration`, not `.e2e`
 *
 * The `.e2e` name moves a file to the nightly run on `main` (`OS_TEST_TIERS`);
 * this pin guards a banner any `serve.ts` edit can change, so it rides the
 * queue run, where such an edit lands.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** `bin/run.js` — the SHIPPED entrypoint. See the header for why this one. */
const CLI = resolve(HERE, '../../bin/run.js');
/** What one `tsup` run emits for every command; its absence means "never built". */
const BUILT_SERVE = resolve(HERE, '../../dist/commands/serve.js');

/** The complete banner — keyed on its LAST line, so the whole block is on the stream. */
const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;
const BANNER_HEAD = 'Server is ready';
/** Every banner row that names an address. */
const ADDRESS_ROW = /\b(?:API|Console|MCP):/;
const NO_SERVER_LINE = 'No HTTP server';

const AUTH_SECRET = 'os-23623-auth-secret-not-a-real-credential';
const SECRET_KEY = '0e2e'.repeat(16);

const OBJECT = `{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text', label: 'Title' } } }`;
const MANIFEST = `{ id: 'com.example.fx23623', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx' }`;
/** An instantiated plugin, which is what makes this a HOST config. */
const HOST_PLUGIN = `{ name: 'com.example.fx23623.host-plugin', version: '1.0.0', init: async () => {}, start: async () => {} }`;

/** What `spawn(…, { stdio: ['ignore', 'pipe', 'pipe'] })` returns — no `stdin`. */
type BootChild = ChildProcessByStdio<null, Readable, Readable>;

const children: BootChild[] = [];
let root: string;
/** One object and the host plugin. */
let plainDir: string;
/** The same, plus its own `new HonoServerPlugin(...)`. */
let honoDir: string;

/** The root of an installed dependency of this package, found through `node_modules`. */
function packageRoot(specifier: string): string {
  // Not every `exports` publishes `./package.json`: climb from the entry to the
  // first directory holding a manifest.
  let dir = dirname(createRequire(import.meta.url).resolve(specifier));
  while (!existsSync(join(dir, 'package.json'))) {
    if (dirname(dir) === dir) throw new Error(`${specifier} resolved to no package root`);
    dir = dirname(dir);
  }
  return dir;
}

function writeFixture(dir: string, header: string, plugins: string, links: string[]): void {
  mkdirSync(join(dir, 'node_modules', '@objectstack'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx-23623', private: true, type: 'module' }));
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

/**
 * This process's environment for a child, minus the vitest worker family and
 * every input that would point the banner at another origin or the boot at
 * another store. An `undefined` override unsets a variable.
 */
function childEnv(cwd: string, overrides: Record<string, string | undefined>): Record<string, string | undefined> {
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
    OS_HOME: join(cwd, '.os-home'),
    OS_SECRET_KEY: SECRET_KEY,
    OS_DATABASE_URL: undefined,
    DATABASE_URL: undefined,
    OS_DATABASE_DRIVER: undefined,
    OS_AUTH_SECRET: undefined,
    OS_TENANCY_POSTURE: undefined,
    OS_MULTI_ORG_ENABLED: undefined,
    // The banner's origin chain: unset, so every address it prints is `http://localhost:<port>`.
    OS_AUTH_URL: undefined,
    BETTER_AUTH_URL: undefined,
    OS_BASE_URL: undefined,
    // MCP is default-on; the pins read its row.
    OS_MCP_SERVER_ENABLED: undefined,
    // Truly unset: production posture, and oclif resolves the command from `dist/`.
    NODE_ENV: undefined,
    ...overrides,
  };
}

interface Boot {
  /** The banner, from its head to its tail. */
  banner: string;
  output: string;
}

/**
 * Spawn `os serve` and resolve on its COMPLETE banner (the child is then
 * stopped). A child that exits first rejects with its output.
 */
async function boot(cwd: string, env: Record<string, string | undefined>, args: string[]): Promise<Boot> {
  const port = await freePort();
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--port', String(port), ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(cwd, { FX_PORT: String(port), ...env }),
  }) as BootChild;
  children.push(child);

  let output = '';
  return new Promise<Boot>((done, fail) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      fail(new Error(`serve neither printed its complete banner nor exited\n--- output ---\n${output}`));
    }, 150_000);
    const onData = (d: unknown) => {
      output += String(d);
      if (!settled && READY_BANNER_TAIL.test(output)) {
        settled = true;
        clearTimeout(timer);
        child.kill('SIGTERM');
        const banner = output.slice(output.lastIndexOf(BANNER_HEAD));
        done({ banner: banner.slice(0, banner.search(READY_BANNER_TAIL)), output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (settled) return;
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

/** A no-server banner: no address row, and the one line. */
function expectNoServerShape({ banner }: Boot): void {
  const seen = `\n--- banner ---\n${banner}`;
  const lines = banner.split('\n');
  expect(lines.filter((l) => ADDRESS_ROW.test(l)), `an address row printed${seen}`).toEqual([]);
  expect(banner, `the MCP connect hint printed${seen}`).not.toContain('connect an AI client');
  const said = lines.filter((l) => l.includes(NO_SERVER_LINE));
  expect(said, `not exactly one no-server line${seen}`).toHaveLength(1);
  expect(said[0], `the line does not name the flag that caused it${seen}`).toContain('--no-server');
}

beforeAll(() => {
  if (!existsSync(BUILT_SERVE)) {
    throw new Error(
      `packages/cli is not built: ${BUILT_SERVE} does not exist. This file spawns bin/run.js with NODE_ENV unset, `
        + 'which resolves the command from dist/. Run: pnpm exec turbo run build --filter=@objectstack/cli',
    );
  }
  root = mkdtempSync(join(tmpdir(), 'os-serve-no-server-banner-'));
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
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('os serve — the ready banner names an address only when an HTTP server is composed (#23623)', () => {
  it(
    'production --no-server (the card\'s command): no address row, one line naming --no-server',
    async () => {
      expectNoServerShape(await boot(plainDir, {}, ['--no-server', '--preset', 'minimal']));
    },
    240_000,
  );

  it(
    '--dev --no-server: the same shape',
    async () => {
      expectNoServerShape(await boot(plainDir, {}, ['--dev', '--no-server']));
    },
    240_000,
  );

  it(
    'control: a default production boot prints API: and MCP:, and the API: port answers',
    async () => {
      const { banner } = await boot(plainDir, { OS_DATABASE_URL: 'file:./ctl.db', OS_AUTH_SECRET: AUTH_SECRET }, []);
      const seen = `\n--- banner ---\n${banner}`;
      expect(banner, `the no-server line printed on a boot with a server${seen}`).not.toContain(NO_SERVER_LINE);
      expect(banner, `no MCP row${seen}`).toMatch(/MCP:\s+http:\/\/localhost:\d+\/api\/v1\/mcp/);
      const port = apiPort(banner);
      expect(port, `no API row naming a localhost port${seen}`).not.toBeNull();
      expect(await statusOf(port as number, '/api/v1/health'), `the API: port did not answer health${seen}`).toBe(200);
    },
    240_000,
  );

  it(
    'control: --no-server with a config-mounted HonoServerPlugin prints API:, and that port answers',
    async () => {
      const { banner } = await boot(honoDir, { OS_DATABASE_URL: 'file:./ctl.db' }, ['--no-server', '--preset', 'minimal']);
      const seen = `\n--- banner ---\n${banner}`;
      // ⭐ The read is off the kernel, not off the flag: the flag skipped serve's
      // own transport, the config composed one, and its address is real.
      expect(banner, `the no-server line printed though the config composed a server${seen}`).not.toContain(NO_SERVER_LINE);
      const port = apiPort(banner);
      expect(port, `no API row naming a localhost port${seen}`).not.toBeNull();
      // Any HTTP status proves a server listens there; `/` is not mounted on this shape.
      expect(await statusOf(port as number, '/'), `nothing answered on the API: port${seen}`).toBeGreaterThanOrEqual(100);
    },
    240_000,
  );
});
