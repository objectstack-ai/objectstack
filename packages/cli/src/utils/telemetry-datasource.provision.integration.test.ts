// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21733 — the ONE `telemetry` sibling provision every serving boot runs
 * (ADR-0057 §3.6), and the primary a standalone stack keys it on.
 *
 * `provisionTelemetryDatasource` used to be inline in `serve.ts`'s config-load
 * fallback, so the standalone stack — every plain `os dev` — never got the
 * sibling `content/docs/deployment/cli.mdx` promises for a file-backed SQLite
 * dev database. Both boots now call it; this file pins what it registers.
 *
 * Integration tier: it starts a real SQLite driver for the sibling (the
 * `@objectstack/driver-sql` import below is what the tier partition measures).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { provisionTelemetryDatasource, standaloneTelemetryPrimary } from './telemetry-datasource.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the helpers reach them through dynamic `import()`s inside
// clocked `it()` bodies (`scripts/check-test-source-alias.mjs`).
import '@objectstack/service-datasource';
import '@objectstack/runtime';

const ENV_KEYS = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const dirs: string[] = [];
const opened: SqlDriver[] = [];

afterEach(async () => {
  for (const driver of opened.splice(0)) await driver.disconnect();
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'os-21733-telemetry-'));
  dirs.push(d);
  return d;
}

/** Provision against a recording `use`, and hand back what was registered. */
async function provision(primaryPath: string | undefined, env: Record<string, string | undefined>, dev: boolean) {
  const used: any[] = [];
  const path = await provisionTelemetryDatasource({
    primaryPath,
    env,
    dev,
    use: (plugin) => { used.push(plugin); },
    warn: () => {},
  });
  for (const plugin of used) if (plugin?.driver instanceof SqlDriver) opened.push(plugin.driver);
  return { path, used };
}

describe('provisionTelemetryDatasource — the one telemetry provision (#21733)', () => {
  it('a dev boot on a file-backed primary registers `driver.telemetry` next to it, under the dev self-heal', async () => {
    const dir = scratch();
    const { path, used } = await provision(join(dir, 'A.db'), {}, true);
    expect(path).toBe(join(dir, 'A.telemetry.db'));
    expect(used).toHaveLength(1);
    expect(used[0].name).toBe('com.objectstack.driver.telemetry');
    expect(used[0].driver).toBeInstanceOf(SqlDriver);
    expect(used[0].driver.name).toBe('telemetry');
    // The SAME decision the primary reads (`devAutoMigrateConfig`).
    expect(used[0].driver.autoMigrate).toBe('safe');
    expect(existsSync(join(dir, 'A.telemetry.db'))).toBe(true);
  });

  it('OS_TELEMETRY_DB=0 opts out: nothing registered, no file', async () => {
    const dir = scratch();
    const { path, used } = await provision(join(dir, 'A.db'), { OS_TELEMETRY_DB: '0' }, true);
    expect(path).toBeUndefined();
    expect(used).toEqual([]);
    expect(existsSync(join(dir, 'A.telemetry.db'))).toBe(false);
  });

  it('production provisions only on an explicit OS_TELEMETRY_DB path, and never self-heals', async () => {
    const dir = scratch();
    expect((await provision(join(dir, 'A.db'), {}, false)).used).toEqual([]);
    const explicit = join(dir, 'elsewhere.db');
    const { path, used } = await provision(join(dir, 'A.db'), { OS_TELEMETRY_DB: explicit }, false);
    expect(path).toBe(explicit);
    expect(used).toHaveLength(1);
    expect(used[0].driver.autoMigrate).toBe('off');
  });

  it('no file-backed primary, no sibling', async () => {
    expect((await provision(undefined, {}, true)).used).toEqual([]);
    expect((await provision(':memory:', {}, true)).used).toEqual([]);
  });
});

describe('standaloneTelemetryPrimary — the primary a standalone stack keys the sibling on (#21733)', () => {
  it('is the native sqlite file the stack would open, and nothing for any other kind', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const dir = scratch();
    expect(await standaloneTelemetryPrimary({ projectRoot: dir, databaseUrl: `file:${join(dir, 'A.db')}` }))
      .toBe(join(dir, 'A.db'));
    // The unified default the stack falls back to, under the project root.
    expect(await standaloneTelemetryPrimary({ projectRoot: dir }))
      .toBe(join(dir, '.objectstack', 'data', 'objectstack.db'));
    expect(await standaloneTelemetryPrimary({ projectRoot: dir, databaseUrl: ':memory:' })).toBeUndefined();
    expect(await standaloneTelemetryPrimary({ projectRoot: dir, databaseUrl: `wasm-sqlite://${join(dir, 'w.db')}` }))
      .toBeUndefined();
    expect(await standaloneTelemetryPrimary({ projectRoot: dir, databaseUrl: 'postgres://u:p@localhost:5432/db' }))
      .toBeUndefined();
  });
});
