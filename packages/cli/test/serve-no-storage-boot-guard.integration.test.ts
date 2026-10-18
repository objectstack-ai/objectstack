// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — spawns the real producer once per single-cause fixture: five production boots of the built CLI (refusal, line, a driver-providing plugin, OS_DATABASE_URL, --dev), each fixture differing only in the input under test; 24.4 s, the slower of two local runs on a shared container, x 1.25, no CI reading yet

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

/**
 * A production `os serve` of a HOST config that resolves no storage (#23573).
 *
 * ## The defect
 *
 * With no `OS_DATABASE_URL`, no `--dev` and no plugin named like a driver, the
 * storage step declares nothing and used to say nothing. The boot went on and
 * died in `AuthPlugin.start()` with "No driver available for object
 * 'sys_organization'", after an objectql ERROR whose remedy names a datasource
 * the operator never declared. Nothing printed named the real remedies.
 *
 * ## What is pinned, one boot per cause
 *
 * The verdict is drawn by a CLI plugin registered LAST, at the end of kernel
 * Phase 1 — after every `init()`, before any `start()`:
 *
 *   1. no driver + the auth service under the `single` posture ⇒ REFUSED, exit 1,
 *      naming the remedies, before any start() (the fixture's own plugin
 *      initialized and never started), and neither downstream line prints;
 *   2. no driver + no auth composed (`--no-server --preset minimal`) ⇒ ONE line
 *      before any start(), and the boot still reaches its banner;
 *   3. a stack plugin whose NAME no driver test matches registers a `driver.*`
 *      service in init() ⇒ silent, and the boot reaches its banner (this shape
 *      booted before the guard and must keep booting);
 *   4. `OS_DATABASE_URL` set ⇒ silent (control);
 *   5. `--dev` ⇒ silent (control).
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset
 *
 * The branch only exists in production posture; `bin/run-dev.js` (what
 * `runServe()` spawns) pins development, where the storage step always
 * resolves a SQLite default and the guard is never registered. See
 * `serve-ready-degraded-boot.e2e.test.ts` for the same reasoning.
 *
 * ## Why `.integration`, not `.e2e`
 *
 * The `.e2e` name moves a file to the nightly run on `main` (`OS_TEST_TIERS`,
 * `scripts/nightly-tiers.mjs`). This pin guards a boot ORDER that any serve.ts
 * edit can break, so it rides the queue run, where such an edit lands.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. See the header for why this one. */
const CLI = resolve(HERE, '../bin/run.js');

/** The complete banner — keyed on its LAST line, so the whole block is on the stream. */
const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;

/** What a refused boot says first, and what its exit line says. */
const REFUSAL_HEAD = 'This production serve has no storage';
const REFUSAL_EXIT = 'Refusing to boot: this production serve has no storage';
/** The one line a boot with no auth gets. */
const LINE_HEAD = '⚠ No storage:';

/** The two downstream lines a refused boot must never reach (both are Phase 2). */
const DOWNSTREAM_DRIVER_ERROR = 'No driver available for object';
const DOWNSTREAM_HYDRATION_ERROR = 'sys_metadata could NOT be read';

/** The fixture plugin's own markers: proof of where Phase 1 ended. */
const MARKER_INIT = '[fx-23573] host-plugin init';
const MARKER_START = '[fx-23573] host-plugin start';

const AUTH_SECRET = 'os-23573-auth-secret-not-a-real-credential';

const OBJECT = `{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text', label: 'Title' } } }`;
const MANIFEST = `{ id: 'com.example.fx23573', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx' }`;
/**
 * An instantiated plugin, which is what makes this a HOST config. Its name
 * matches no driver test, and it writes one marker per lifecycle phase.
 */
const HOST_PLUGIN = `{
  name: 'com.example.fx23573.host-plugin',
  version: '1.0.0',
  init: async () => { process.stderr.write(${JSON.stringify(`${MARKER_INIT}\n`)}); },
  start: async () => { process.stderr.write(${JSON.stringify(`${MARKER_START}\n`)}); },
}`;

/** What `spawn(…, { stdio: ['ignore', 'pipe', 'pipe'] })` returns — no `stdin`. */
type BootChild = ChildProcessByStdio<null, Readable, Readable>;

const children: BootChild[] = [];
let root: string;
/** One object, the host plugin, nothing that names storage. */
let plainDir: string;
/** The same, plus a plugin that registers a SQL driver as `driver.*` in init(). */
let driverDir: string;

/**
 * Make `@objectstack/driver-sql` resolvable from `dir`: a symlink to the
 * package this one already depends on, found through `node_modules` (a package
 * specifier, never a walk out of this package), as `linkSpec` does for spec.
 */
function linkDriverSql(dir: string): void {
  // Its `exports` does not publish `./package.json`, so climb from the entry to
  // the first directory holding a manifest: the package root.
  let pkgRoot = dirname(createRequire(import.meta.url).resolve('@objectstack/driver-sql'));
  while (!existsSync(join(pkgRoot, 'package.json'))) {
    if (dirname(pkgRoot) === pkgRoot) throw new Error('@objectstack/driver-sql resolved to no package root');
    pkgRoot = dirname(pkgRoot);
  }
  const scope = join(dir, 'node_modules', '@objectstack');
  mkdirSync(scope, { recursive: true });
  symlinkSync(pkgRoot, join(scope, 'driver-sql'), 'dir');
}

function writeFixture(dir: string, header: string, plugins: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx-23573', private: true, type: 'module' }));
  const source = defineStackSourceFromLiteral(`{ manifest: ${MANIFEST}, objects: [${OBJECT}], plugins: [${plugins}] }`);
  writeFileSync(join(dir, 'objectstack.config.ts'), `${header}${source}`);
  linkSpec(dir);
}

interface Boot {
  output: string;
  exitCode: number | null;
  ready: boolean;
}

/**
 * Spawn `os serve` in production posture. Resolves on the COMPLETE banner (the
 * child is then stopped) or on the child's exit, whichever comes first.
 * Extra `env` entries override the base; `undefined` unsets.
 */
async function boot(cwd: string, env: Record<string, string | undefined>, args: string[] = []): Promise<Boot> {
  // A kernel-assigned port (#24295): production posture refuses to auto-shift,
  // so a port drawn and released beforehand is a red whenever another process
  // takes it in the gap — and an `exit 1` is this file's subject, so that red
  // would read as a verdict. Nothing here talks to the port.
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--port', KERNEL_ASSIGNED_PORT, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
    env: childEnv({
      NO_COLOR: '1',
      OS_LOG_LEVEL: '',
      OS_DISABLE_CONSOLE: '1',
      OS_CLOUD_URL: 'off',
      OS_HOME: join(cwd, '.os-home'),
      OS_SECRET_KEY: E2E_SECRET_KEY,
      // ⭐ The storage inputs, all truly unset unless a leg names one.
      OS_DATABASE_URL: undefined,
      DATABASE_URL: undefined,
      OS_DATABASE_DRIVER: undefined,
      OS_AUTH_SECRET: undefined,
      OS_TENANCY_POSTURE: undefined,
      OS_MULTI_ORG_ENABLED: undefined,
      // Truly unset: production posture, and oclif resolves the command from `dist/`.
      NODE_ENV: undefined,
      ...env,
    }),
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
        done({ output, exitCode: null, ready: true });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ output, exitCode: code, ready: false });
    });
  });
}

beforeAll(() => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  root = mkdtempSync(join(tmpdir(), 'os-serve-no-storage-'));
  plainDir = join(root, 'plain');
  writeFixture(plainDir, '', HOST_PLUGIN);
  driverDir = join(root, 'driver');
  writeFixture(
    driverDir,
    "import { SqlDriver } from '@objectstack/driver-sql';\n"
      + "const drv = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });\n",
    // `com.acme.store` contains no `driver` and its constructor is `Object`:
    // the storage step's name test cannot see it, so the step declares nothing.
    `${HOST_PLUGIN}, { name: 'com.acme.store', version: '1.0.0', init: async (ctx) => { ctx.registerService('driver.' + drv.name, drv); }, start: async () => {} }`,
  );
  linkDriverSql(driverDir);
});

afterAll(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

/** A boot the guard must leave alone: it reaches its banner, refused nothing, printed no line. */
function expectSilentBoot(output: string, ready: boolean): void {
  const seen = `\n--- output ---\n${output}`;
  expect(ready, `the boot did not reach its banner${seen}`).toBe(true);
  expect(output, `the boot was refused${seen}`).not.toContain(REFUSAL_HEAD);
  expect(output, `the boot got the no-storage line${seen}`).not.toContain(LINE_HEAD);
}

describe('os serve — a production host config with no storage (#23573)', () => {
  it(
    'refuses before any plugin starts when the auth service needs a driver, naming the remedies',
    async () => {
      const { output, exitCode, ready } = await boot(plainDir, { OS_AUTH_SECRET: AUTH_SECRET });
      const seen = `\n--- output ---\n${output}`;

      expect(ready, `a no-storage boot with auth reached its banner${seen}`).toBe(false);
      expect(exitCode, `the refusal did not exit 1${seen}`).toBe(1);
      expect(output, `no refusal was printed${seen}`).toContain(REFUSAL_HEAD);
      expect(output, `the exit line is not the refusal${seen}`).toContain(REFUSAL_EXIT);
      for (const remedy of ['OS_DATABASE_URL', 'new DriverPlugin(driver)', '--dev']) {
        expect(output, `the refusal does not name ${remedy}${seen}`).toContain(remedy);
      }

      // ⭐ Before any start(): the fixture's plugin initialized and never started.
      expect(output, `the fixture plugin never initialized${seen}`).toContain(MARKER_INIT);
      expect(output, `a plugin started before the refusal${seen}`).not.toContain(MARKER_START);
      // ⭐ Neither downstream line, both of which belong to Phase 2.
      expect(output, `the old driver error survived${seen}`).not.toContain(DOWNSTREAM_DRIVER_ERROR);
      expect(output, `objectql's hydration ERROR survived${seen}`).not.toContain(DOWNSTREAM_HYDRATION_ERROR);
    },
    240_000,
  );

  it(
    'prints one line before any plugin starts and keeps booting when no auth is composed',
    async () => {
      const { output, ready } = await boot(plainDir, {}, ['--no-server', '--preset', 'minimal']);
      const seen = `\n--- output ---\n${output}`;

      expect(ready, `a boot that booted before the guard no longer reaches its banner${seen}`).toBe(true);
      expect(output, `this boot was refused${seen}`).not.toContain(REFUSAL_HEAD);
      expect(output.split(LINE_HEAD).length - 1, `not exactly one no-storage line${seen}`).toBe(1);
      const line = output.slice(output.indexOf(LINE_HEAD)).split('\n')[0];
      for (const remedy of ['OS_DATABASE_URL', 'new DriverPlugin(driver)', '--dev']) {
        expect(line, `the line does not name ${remedy}${seen}`).toContain(remedy);
      }
      // ⭐ Before any start(): the fixture's plugin did start in this boot, after the line.
      expect(output, `the fixture plugin never started${seen}`).toContain(MARKER_START);
      expect(output.indexOf(LINE_HEAD), `the line came after a plugin started${seen}`)
        .toBeLessThan(output.indexOf(MARKER_START));
    },
    240_000,
  );

  it(
    'stays silent and boots when a plugin no driver test names registers a driver in init()',
    async () => {
      const { output, ready } = await boot(driverDir, { OS_AUTH_SECRET: AUTH_SECRET });
      expectSilentBoot(output, ready);
    },
    240_000,
  );

  // Two `it`s, not an `it.each`: each spawn's env stays a literal at its call,
  // which is what `check:cli-test-child-env` reads the child's NODE_ENV from.
  it(
    'control: OS_DATABASE_URL set boots and says nothing about storage',
    async () => {
      const { output, ready } = await boot(plainDir, { OS_AUTH_SECRET: AUTH_SECRET, OS_DATABASE_URL: 'file:./ctl.db' });
      expectSilentBoot(output, ready);
    },
    240_000,
  );

  it(
    'control: --dev boots and says nothing about storage',
    async () => {
      const { output, ready } = await boot(plainDir, { OS_AUTH_SECRET: AUTH_SECRET }, ['--dev']);
      expectSilentBoot(output, ready);
    },
    240_000,
  );
});
