// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 30 — spawns the real producer once per single-cause fixture: two production boots of the built CLI (a `default: true` mapping over a declared sqlite datasource, and the same config with no mapping), each fixture differing only in that rule; 17.6 s, the slower of two local runs on a shared container, x 1.25, no CI reading yet

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

/**
 * A served host config whose `datasourceMapping` routes every object to a
 * declared datasource (#23649), measured at the public door.
 *
 * ## The defect
 *
 * `objectstack serve objectstack.config.ts`, production, `OS_DATABASE_URL`
 * naming one SQLite file, the config declaring a second (`primary`) and the rule
 * `{ default: true, datasource: 'primary' }`. The boot printed its ready banner,
 * then every platform read failed with "no such table": the engine plugin's
 * schema sync and the auth plugin's Default Organization had both used the URL
 * store, and only then did `AppPlugin.start()` install the rule, re-routing
 * every platform object to a `primary` whose schema never synced. The URL store
 * held the platform tables and the organization; `primary` held neither.
 *
 * ## What is pinned
 *
 *   1. the mapped boot reaches its banner with no "no such table" and no
 *      "is not registered" line, and afterwards `primary` holds the platform
 *      tables and the one Default Organization while the URL store holds no
 *      `sys_organization` table at all;
 *   2. CONTROL: the same config with no mapping keeps all of it in the URL
 *      store, and the managed, unrouted `primary` is never opened.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset, and why `.integration`
 *
 * Production posture is where the measured boot ran (`bin/run-dev.js` pins
 * development). The file guards a boot ORDER any serve or plugin edit can
 * break, so it rides the queue run rather than the nightly `.e2e` tier — the
 * reasoning `serve-no-storage-boot-guard.integration.test.ts` records.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. See the header for why this one. */
const CLI = resolve(HERE, '../bin/run.js');

/** The complete banner — keyed on its LAST line, so the whole block is on the stream. */
const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;
/** What a platform read against an unsynced datasource prints. */
const NO_SUCH_TABLE = 'no such table';
/** What a routed read against a never-connected datasource prints. */
const NOT_REGISTERED = 'is not registered';

const AUTH_SECRET = 'os-23649-auth-secret-not-a-real-credential';
const URL_STORE = 'ctl.db';
const PRIMARY_STORE = 'ds-primary.db';

const OBJECT = `{ name: 'fx_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text', label: 'Title' } } }`;
const MANIFEST = `{ id: 'com.example.fx23649', namespace: 'fx', version: '1.0.0', type: 'app', name: 'Fx' }`;
const PRIMARY = `{ name: 'primary', label: 'Primary', driver: 'sqlite', config: { filename: './${PRIMARY_STORE}' } }`;
/** An instantiated plugin, which is what makes this a HOST config. */
const HOST_PLUGIN = `{ name: 'com.example.fx23649.host-plugin', version: '1.0.0', init: async () => {}, start: async () => {} }`;

/** What `spawn(…, { stdio: ['ignore', 'pipe', 'pipe'] })` returns — no `stdin`. */
type BootChild = ChildProcessByStdio<null, Readable, Readable>;

const children: BootChild[] = [];
let root: string;
let mappedDir: string;
let controlDir: string;

function writeFixture(dir: string, mapping: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx-23649', private: true, type: 'module' }));
  const source = defineStackSourceFromLiteral(
    `{ manifest: ${MANIFEST}, objects: [${OBJECT}], datasources: [${PRIMARY}],${mapping} plugins: [${HOST_PLUGIN}] }`,
  );
  writeFileSync(join(dir, 'objectstack.config.ts'), source);
  linkSpec(dir);
}

interface Boot {
  output: string;
  ready: boolean;
}

/**
 * Spawn `os serve` in production posture with `OS_DATABASE_URL` naming the URL
 * store. Resolves once the child has EXITED — after the complete banner (the
 * child is then stopped) or on its own — so the stores are closed when read.
 */
async function boot(cwd: string): Promise<Boot> {
  // A kernel-assigned port (#24295): production posture refuses to auto-shift,
  // so a port drawn and released beforehand is a red whenever another process
  // takes it in the gap. Nothing here talks to the port.
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--port', KERNEL_ASSIGNED_PORT], {
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
      OS_AUTH_SECRET: AUTH_SECRET,
      OS_DATABASE_URL: `file:./${URL_STORE}`,
      DATABASE_URL: undefined,
      OS_DATABASE_DRIVER: undefined,
      OS_TENANCY_POSTURE: undefined,
      OS_MULTI_ORG_ENABLED: undefined,
      // Truly unset: production posture, and oclif resolves the command from `dist/`.
      NODE_ENV: undefined,
    }),
  }) as BootChild;
  children.push(child);

  let output = '';
  let ready = false;
  return new Promise<Boot>((done, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error(`serve neither printed its complete banner nor exited\n--- output ---\n${output}`));
    }, 150_000);
    const onData = (d: unknown) => {
      output += String(d);
      if (!ready && READY_BANNER_TAIL.test(output)) {
        ready = true;
        child.kill('SIGTERM');
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => {
      clearTimeout(timer);
      done({ output, ready });
    });
  });
}

/** The user tables of a SQLite file, and its `sys_organization` row count (`null` = no such table). */
function readStore(file: string): { tables: string[]; organizations: number | null } {
  const db = new Database(file, { readonly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .map((r) => r.name);
    const organizations = tables.includes('sys_organization')
      ? (db.prepare('SELECT COUNT(*) AS n FROM sys_organization').get() as { n: number }).n
      : null;
    return { tables, organizations };
  } finally {
    db.close();
  }
}

beforeAll(() => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  root = mkdtempSync(join(tmpdir(), 'os-serve-mapping-before-sync-'));
  mappedDir = join(root, 'mapped');
  writeFixture(mappedDir, ` datasourceMapping: [{ default: true, datasource: 'primary' }],`);
  controlDir = join(root, 'control');
  writeFixture(controlDir, '');
});

afterAll(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('os serve — a host config whose datasourceMapping routes every object to a declared datasource (#23649)', () => {
  it(
    'boots over ONE store: the mapped datasource holds the platform tables and the Default Organization',
    async () => {
      const { output, ready } = await boot(mappedDir);
      const seen = `\n--- output ---\n${output}`;
      expect(ready, `the mapped boot did not reach its banner${seen}`).toBe(true);
      expect(output, `a platform read hit an unsynced datasource${seen}`).not.toContain(NO_SUCH_TABLE);
      expect(output, `a routed read hit a never-connected datasource${seen}`).not.toContain(NOT_REGISTERED);

      const primary = readStore(join(mappedDir, PRIMARY_STORE));
      for (const table of ['sys_organization', 'sys_metadata', 'sys_user', 'fx_task']) {
        expect(primary.tables, `${table} is not on the mapped datasource${seen}`).toContain(table);
      }
      expect(primary.organizations, 'the Default Organization is not on the mapped datasource').toBe(1);

      // The URL store opened as the host default, and no platform object was synced
      // or written there.
      const url = readStore(join(mappedDir, URL_STORE));
      expect(url.tables, 'the platform schema was synced onto the URL store').not.toContain('sys_organization');
      expect(url.tables).not.toContain('sys_metadata');
    },
    240_000,
  );

  it(
    'control: with no mapping the URL store holds everything, and the unrouted datasource is never opened',
    async () => {
      const { output, ready } = await boot(controlDir);
      const seen = `\n--- output ---\n${output}`;
      expect(ready, `the control boot did not reach its banner${seen}`).toBe(true);
      expect(output, `the control boot hit a missing table${seen}`).not.toContain(NO_SUCH_TABLE);

      const url = readStore(join(controlDir, URL_STORE));
      for (const table of ['sys_organization', 'sys_metadata', 'sys_user', 'fx_task']) {
        expect(url.tables, `${table} is not on the URL store${seen}`).toContain(table);
      }
      expect(url.organizations).toBe(1);
      expect(existsSync(join(controlDir, PRIMARY_STORE)), 'the managed, unrouted datasource was opened').toBe(false);
    },
    240_000,
  );
});
