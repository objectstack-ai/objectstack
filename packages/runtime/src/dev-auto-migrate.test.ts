// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21733 — the dev schema self-heal (`autoMigrate: 'safe'`, #2186) has ONE
// home, `dev-auto-migrate.ts`, and the standalone stack reads it.
//
// Three things are pinned here, from the inside out:
//
//   1. the decision's driver set IS the contract's: a kind gets `'safe'` iff
//      its `@objectstack/spec` connection schema declares `autoMigrate` — so a
//      driver cannot silently gain a key it ignores, nor lose one it honours;
//   2. the standalone stack's `default` definition carries it on a dev boot —
//      the card's defect: it never did, so a plain `os dev` never self-healed;
//   3. only an EXPLICIT `dev: true` arms it. The `NODE_ENV` default the sqlite
//      step-down takes does not: `bootSchemaStack` (every one-shot command)
//      passes no `dev`, and must never auto-apply drift under
//      `NODE_ENV=development`. The behavioural half of that fence — a real
//      one-shot boot on a staged database — is
//      `packages/cli/src/utils/schema-migrate.dev-self-heal-fence.integration.test.ts`.
//
// Nothing here connects to a database: `createStandaloneStack` builds a
// DEFINITION and hands it to `DefaultDatasourcePlugin` (ADR-0062 D1), and the
// definition is the whole of what this package decides.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_DRIVER_IDS, getDriverConfigJsonSchemaById } from '@objectstack/spec/data';
import { devAutoMigrateConfig } from './dev-auto-migrate.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: `createStandaloneStack` reaches them through dynamic
// `import()`s inside clocked `it()` bodies (`scripts/check-test-source-alias.mjs`).
import '@objectstack/service-datasource';
import '@objectstack/objectql';
import '@objectstack/metadata';

const ENV_KEYS = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER',
  'OS_HOME',
  'NODE_ENV',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
);
const dirs: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function clearUrlEnv(): void {
  for (const key of ENV_KEYS) if (key !== 'NODE_ENV') delete process.env[key];
}

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'os-21733-'));
  dirs.push(d);
  return d;
}

/** The `default` datasource DEFINITION a built stack carries. */
async function defaultConfigOf(opts: Parameters<typeof createStandaloneStack>[0]): Promise<Record<string, unknown>> {
  const stack = await createStandaloneStack(opts);
  const plugin = stack.plugins.find(
    (p: any) => p?.name === 'com.objectstack.runtime.default-datasource',
  ) as any;
  expect(plugin, 'stack must carry the DefaultDatasourcePlugin').toBeDefined();
  return plugin.def.config ?? {};
}

const BOOT_TIMEOUT = 60_000;

describe('devAutoMigrateConfig — the one decision (#21733)', () => {
  it('answers `safe` on a dev boot for exactly the kinds whose spec contract declares `autoMigrate`', () => {
    for (const id of BUILTIN_DRIVER_IDS) {
      const declared = Object.keys(
        (getDriverConfigJsonSchemaById(id) as { properties?: Record<string, unknown> }).properties ?? {},
      ).includes('autoMigrate');
      expect(devAutoMigrateConfig(id, true), `driver "${id}" (contract declares autoMigrate: ${declared})`)
        .toEqual(declared ? { autoMigrate: 'safe' } : {});
    }
  });

  it('the set is the three SQL kinds — sqlite-wasm, mongodb, turso and memory get nothing', () => {
    const armed = BUILTIN_DRIVER_IDS.filter((id) => devAutoMigrateConfig(id, true).autoMigrate === 'safe');
    expect([...armed].sort()).toEqual(['mysql', 'postgres', 'sqlite']);
  });

  it('answers nothing outside a dev boot, for every kind', () => {
    for (const id of BUILTIN_DRIVER_IDS) expect(devAutoMigrateConfig(id, false)).toEqual({});
  });
});

describe('createStandaloneStack — the `default` definition reads the decision (#21733)', () => {
  it('a dev boot on a file-backed sqlite database carries autoMigrate: safe', async () => {
    clearUrlEnv();
    const dir = scratch();
    const config = await defaultConfigOf({ projectRoot: dir, databaseUrl: `file:${join(dir, 'A.db')}`, dev: true });
    expect(config).toEqual({ filename: join(dir, 'A.db'), autoMigrate: 'safe' });
  }, BOOT_TIMEOUT);

  it('a dev boot on postgres and mysql carries it too; on sqlite-wasm and mongodb it does not', async () => {
    clearUrlEnv();
    const dir = scratch();
    expect(await defaultConfigOf({ projectRoot: dir, databaseUrl: 'postgres://u:p@localhost:5432/db', dev: true }))
      .toEqual({ url: 'postgres://u:p@localhost:5432/db', autoMigrate: 'safe' });
    expect(await defaultConfigOf({ projectRoot: dir, databaseUrl: 'mysql://u:p@localhost:3306/db', dev: true }))
      .toEqual({ url: 'mysql://u:p@localhost:3306/db', autoMigrate: 'safe' });
    expect(await defaultConfigOf({ projectRoot: dir, databaseUrl: `wasm-sqlite://${join(dir, 'w.db')}`, dev: true }))
      .not.toHaveProperty('autoMigrate');
    expect(await defaultConfigOf({ projectRoot: dir, databaseUrl: 'mongodb://localhost:27017/db', dev: true }))
      .not.toHaveProperty('autoMigrate');
  }, BOOT_TIMEOUT);

  it('a production boot (`dev: false`, what `os start` passes) does not carry it', async () => {
    clearUrlEnv();
    const dir = scratch();
    const config = await defaultConfigOf({ projectRoot: dir, databaseUrl: `file:${join(dir, 'A.db')}`, dev: false });
    expect(config).not.toHaveProperty('autoMigrate');
  }, BOOT_TIMEOUT);

  it('the NODE_ENV=development default does NOT arm it — a one-shot boot passes no `dev`', async () => {
    clearUrlEnv();
    process.env.NODE_ENV = 'development';
    const dir = scratch();
    const config = await defaultConfigOf({ projectRoot: dir, databaseUrl: `file:${join(dir, 'A.db')}` });
    expect(config).not.toHaveProperty('autoMigrate');
  }, BOOT_TIMEOUT);
});
