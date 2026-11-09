// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which primary databases `os serve` refuses when several replicas are declared
 * over the redis cluster driver (cloud#3814 N3): a database local to each
 * replica — SQLite, sqlite-wasm, libSQL over a `file:` URL — and nothing else.
 *
 * Every case is fed by the resolution the boot itself runs, never by a
 * hand-written driver id: the standalone stack's `resolveStandaloneDatabase`
 * (every ordinary boot, the no-URL SQLite default included) and this command's
 * own `OS_DATABASE_URL` fallback (`resolveDriverType` + `resolveStorageDefinition`).
 * So a resolution that later classifies a URL differently moves these cases
 * with it. The boot that prints the refusal and exits 1 is pinned over the real
 * `os serve` process in `test/serve-multi-node-gate-declaration.integration.test.ts`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveStandaloneDatabase, type StandaloneStackConfig } from '@objectstack/runtime';
import { multiReplicaLocalDatabaseRefusal } from './serve.js';
import { resolveDriverType, resolveStorageDefinition } from '../utils/storage-driver.js';

// Pay the first load of what `serve.ts` reaches through dynamic `import()`s at
// MODULE LOAD, outside any clocked case (`pnpm check:test-source-alias`).
import '@objectstack/metadata-protocol';
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/plugin-hono-server';
import '@objectstack/rest';
import '@objectstack/service-settings';
import '@objectstack/service-datasource';
import '@objectstack/driver-turso';
import '@objectstack/driver-sql';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-security';
// …and what it reaches through `start.ts` (`declaresReplicasSharingState`).
import '@objectstack/cloud-connection';

/** The remedy the refusal names, as an operator would copy it. */
const REMEDY = 'OS_DATABASE_URL=postgres://';

const projectRoot = mkdtempSync(join(tmpdir(), 'os-multi-replica-db-'));

/** Every variable the resolutions read a URL or a driver from, so the shell running the suite cannot decide a case. */
const DATABASE_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
const savedEnv = new Map<string, string | undefined>();
beforeAll(() => {
  for (const key of DATABASE_ENV) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(projectRoot, { recursive: true, force: true });
});

/** The standalone stack's own answer for this selection. */
function standalone(databaseUrl?: string, databaseDriver?: StandaloneStackConfig['databaseDriver']) {
  const db = resolveStandaloneDatabase({
    projectRoot,
    // A path that exists nowhere, so the config-declared datasource rung reads nothing.
    artifactPath: join(projectRoot, 'no-artifact.json'),
    ...(databaseUrl !== undefined ? { databaseUrl } : {}),
    ...(databaseDriver !== undefined ? { databaseDriver } : {}),
  });
  return { driver: db.driver, url: db.url };
}

/** This command's `OS_DATABASE_URL` fallback's answer for this selection. */
function fallback(databaseUrl: string | undefined, explicitDriver?: string, isDev = false) {
  const resolution = resolveStorageDefinition(resolveDriverType(explicitDriver, databaseUrl), { databaseUrl, isDev });
  if (!resolution) throw new Error('the fallback resolved no datasource');
  return { driver: resolution.driverId, url: databaseUrl };
}

describe('multiReplicaLocalDatabaseRefusal — a database local to each replica is refused', () => {
  it.each([
    ['a file: URL (standalone)', () => standalone('file:/srv/os/app.db')],
    ['the no-URL SQLite default (standalone)', () => standalone()],
    ['a bare path (standalone)', () => standalone('/srv/os/app.db')],
    ['a *.wasm.db file (standalone, sqlite-wasm)', () => standalone('file:/srv/os/app.wasm.db')],
    ['a wasm-sqlite:// URL (standalone, sqlite-wasm)', () => standalone('wasm-sqlite:///srv/os/app.db')],
    ['libSQL over a file: URL (standalone)', () => standalone('file:/srv/os/app.db', 'turso')],
    ['a file: URL (fallback)', () => fallback('file:/srv/os/app.db')],
    ['the dev SQLite default (fallback)', () => fallback(undefined, undefined, true)],
    ['a wasm-sqlite:// URL (fallback, sqlite-wasm)', () => fallback('wasm-sqlite:///srv/os/app.db')],
    ['libSQL over a file: URL (fallback)', () => fallback('file:/srv/os/app.db', 'turso')],
    ["SQLite's :memory: (standalone)", () => standalone(':memory:')],
    ["libSQL over :memory: (fallback)", () => fallback(':memory:', 'turso')],
    ['a relative file:./ URL (standalone)', () => standalone('file:./data/app.db')],
    ['libSQL over a relative file:./ URL (standalone)', () => standalone('file:./data/app.db', 'turso')],
  ])('%s', (_label, primary) => {
    const refusal = multiReplicaLocalDatabaseRefusal(primary());
    expect(refusal).toBeDefined();
    expect(refusal).toContain(REMEDY);
  });

  it('names the variable and never the URL it was given', () => {
    const refusal = multiReplicaLocalDatabaseRefusal(standalone('file:/srv/secret-path/app.db'));
    expect(refusal).toContain('OS_CLUSTER_REPLICAS');
    expect(refusal).not.toContain('secret-path');
  });
});

describe('multiReplicaLocalDatabaseRefusal — a database every replica reaches is not', () => {
  it.each([
    ['a libsql:// server URL (standalone)', () => standalone('libsql://app-org.turso.io')],
    ['a Turso https:// host (standalone)', () => standalone('https://app-org.turso.io')],
    ['postgres (standalone)', () => standalone('postgres://u:p@db:5432/app')],
    ['mysql (standalone)', () => standalone('mysql://u:p@db:3306/app')],
    ['mongodb (standalone)', () => standalone('mongodb://db:27017/app')],
    ['a libsql:// server URL (fallback)', () => fallback('libsql://app-org.turso.io')],
    ['libSQL over a wss:// server URL (standalone)', () => standalone('wss://app-org.turso.io', 'turso')],
    ['libSQL over an http:// server URL (standalone)', () => standalone('http://127.0.0.1:8080', 'turso')],
    ['libSQL over a wss:// server URL (fallback)', () => fallback('wss://app-org.turso.io', 'turso')],
    ['libSQL over an http:// server URL (fallback)', () => fallback('http://127.0.0.1:8080', 'turso')],
    ['postgres (fallback)', () => fallback('postgres://u:p@db:5432/app')],
  ])('%s', (_label, primary) => {
    expect(multiReplicaLocalDatabaseRefusal(primary())).toBeUndefined();
  });
});
