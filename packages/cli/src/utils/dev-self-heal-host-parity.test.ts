// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21733 — both boot hosts give the `default` datasource the SAME dev
 * self-heal, kind by kind.
 *
 * The self-heal (`autoMigrate: 'safe'`, #2186) used to be decided inline in
 * the CLI host (`resolveStorageDefinition`) and not at all in the runtime host
 * (`createStandaloneStack`), which every plain `os dev` composes. Both now read
 * `devAutoMigrateConfig` from `@objectstack/runtime`; this file drives the two
 * REAL entry points, not the helper, so a host that stops reading it — or
 * starts deciding for itself — fails here by kind. Same reason the driver
 * vocabulary's own cross-host pin lives in this package
 * (`driver-vocabulary-parity.test.ts`): it is the one that can import both.
 *
 * The host path's answer is the reference: no kind gains or loses `'safe'`
 * relative to it (`storage-driver.test.ts` pins that answer on its own).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneStack } from '@objectstack/runtime';
import { resolveStorageDefinition } from './storage-driver.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: `createStandaloneStack` reaches them through dynamic
// `import()`s inside clocked `it()` bodies (`scripts/check-test-source-alias.mjs`).
import '@objectstack/service-datasource';
import '@objectstack/objectql';
import '@objectstack/metadata';

const ENV_KEYS = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const dirs: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Each canonical kind, by a URL both hosts select it from. */
function urlsFor(dir: string): Record<string, string> {
  return {
    sqlite: `file:${join(dir, 'p.db')}`,
    'sqlite-wasm': `wasm-sqlite://${join(dir, 'w.db')}`,
    postgres: 'postgres://u:p@localhost:5432/db',
    mysql: 'mysql://u:p@localhost:3306/db',
    mongodb: 'mongodb://localhost:27017/db',
    turso: 'libsql://my-db.turso.io',
  };
}

async function runtimeAutoMigrate(databaseUrl: string, dev: boolean, projectRoot: string): Promise<unknown> {
  const stack = await createStandaloneStack({ databaseUrl, dev, projectRoot });
  const plugin = stack.plugins.find((p: any) => p?.name === 'com.objectstack.runtime.default-datasource') as any;
  expect(plugin, 'the standalone stack must carry the DefaultDatasourcePlugin').toBeDefined();
  return plugin.def.config?.autoMigrate;
}

const BOOT_TIMEOUT = 90_000;

describe('#21733 — the dev self-heal is the same on both boot hosts', () => {
  it('every kind: the standalone stack carries exactly the `autoMigrate` the CLI host does, dev and production', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const dir = mkdtempSync(join(tmpdir(), 'os-21733-parity-'));
    dirs.push(dir);
    const rows: string[] = [];
    for (const [kind, url] of Object.entries(urlsFor(dir))) {
      for (const dev of [true, false]) {
        const cli = resolveStorageDefinition(kind, { databaseUrl: url, isDev: dev })?.config.autoMigrate;
        const runtime = await runtimeAutoMigrate(url, dev, dir);
        rows.push(`${kind} dev=${dev}: cli=${String(cli)} runtime=${String(runtime)}`);
      }
    }
    // One assertion over the whole table, so a divergence names every kind it touches.
    expect(rows).toEqual([
      'sqlite dev=true: cli=safe runtime=safe',
      'sqlite dev=false: cli=undefined runtime=undefined',
      'sqlite-wasm dev=true: cli=undefined runtime=undefined',
      'sqlite-wasm dev=false: cli=undefined runtime=undefined',
      'postgres dev=true: cli=safe runtime=safe',
      'postgres dev=false: cli=undefined runtime=undefined',
      'mysql dev=true: cli=safe runtime=safe',
      'mysql dev=false: cli=undefined runtime=undefined',
      'mongodb dev=true: cli=undefined runtime=undefined',
      'mongodb dev=false: cli=undefined runtime=undefined',
      'turso dev=true: cli=undefined runtime=undefined',
      'turso dev=false: cli=undefined runtime=undefined',
    ]);
  }, BOOT_TIMEOUT);
});
