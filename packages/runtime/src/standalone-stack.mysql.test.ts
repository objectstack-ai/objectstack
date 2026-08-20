// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6265 — two halves of one defect family in `standalone-stack.ts`, pinned
// together because they close the same hole from opposite sides: a driver
// selection this stack could not dispatch.
//
// (a) `mysql://` — the #5820 split with a different scheme. The CLI has
//     classified `mysql[2]://` as `mysql` since forever
//     (`utils/storage-driver.ts` `inferDriverTypeFromUrl`), the SHARED factory
//     has always been able to build it (`kind === 'mysql'` → SqlDriver on
//     `mysql2`), and only `detectDriverFromUrl()` here had no arm — so one
//     `OS_DATABASE_URL=mysql://…` booted under `os start` and died under
//     `os migrate` with `Unsupported database URL scheme`.
//
// (b) `OS_DATABASE_DRIVER` — `cfg.databaseDriver` was parsed by a zod enum
//     (loud rejection) while the env var was a bare `as` cast (no runtime check
//     at all). An unknown value matched no dispatch arm and landed in the
//     chain's trailing `else`: SQLite, in silence. `OS_DATABASE_DRIVER=mysql`
//     with no URL therefore created a local `standalone.db` while the operator
//     believed they were connected to MySQL — the #3276 class, and the value is
//     one `content/docs/deployment/environment-variables.mdx` advertises.
//
// Nothing here talks to a real MySQL server: `createStandaloneStack` builds a
// DEFINITION and hands it to `DefaultDatasourcePlugin`, which connects later at
// kernel init (ADR-0062 D1 / #3826). The definition plus the shared factory's
// own `supports()` is therefore the whole of this package's contract.

import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveStandaloneDatabase,
  createStandaloneStack,
  StandaloneDatabaseDriverSchema,
} from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/service-datasource';

/** Env keys these tests write; restored after every case. */
const ENV_KEYS = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER',
  'OS_HOME',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

function clearUrlEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

/** The `default` datasource DEFINITION a built stack carries. */
function defaultDefOf(stack: Awaited<ReturnType<typeof createStandaloneStack>>): {
  driver: string;
  config?: Record<string, unknown>;
} {
  const plugin = stack.plugins.find(
    (p: any) => p?.name === 'com.objectstack.runtime.default-datasource',
  ) as any;
  expect(plugin, 'stack must carry the DefaultDatasourcePlugin').toBeDefined();
  return plugin.def;
}

const BOOT_TIMEOUT = 60_000;

describe('detectDriverFromUrl — mysql:// resolves to the `mysql` kind (#6265)', () => {
  it('mysql:// resolves to mysql, keeps the URL, and probes no sqlite file', () => {
    const url = 'mysql://user:pw@localhost:3306/objectstack';
    const r = resolveStandaloneDatabase({ databaseUrl: url });
    expect(r.driver).toBe('mysql');
    expect(r.url).toBe(url);
    // The occupancy probe (`os migrate`, #3917) has nothing to say about a
    // remote server — and must NOT read the DSN as a file path.
    expect(r.sqliteFile).toBeNull();
  });

  it('mysql2:// — the second spelling the CLI regex accepts — resolves the same', () => {
    const r = resolveStandaloneDatabase({ databaseUrl: 'mysql2://user:pw@db.internal:3306/app' });
    expect(r.driver).toBe('mysql');
    expect(r.sqliteFile).toBeNull();
  });

  it('the scheme match is case-insensitive, like every other arm', () => {
    expect(resolveStandaloneDatabase({ databaseUrl: 'MYSQL://user@host/db' }).driver).toBe('mysql');
  });

  it('an explicit databaseDriver: "mysql" is accepted by the config schema', () => {
    const r = resolveStandaloneDatabase({
      databaseDriver: 'mysql',
      databaseUrl: 'mysql://user:pw@localhost:3306/db',
    });
    expect(r.driver).toBe('mysql');
    expect(r.sqliteFile).toBeNull();
  });

  it('OS_DATABASE_DRIVER=mysql selects the same kind', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_DRIVER = 'mysql';
    process.env.OS_DATABASE_URL = 'mysql://user:pw@env-host:3306/db';
    expect(resolveStandaloneDatabase().driver).toBe('mysql');
  });

  // The URL source that used to be dispatchable only from the CLI side.
  it('OS_DATABASE_URL=mysql://… dispatches with no explicit driver at all', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_URL = 'mysql://user:pw@env-host:3306/db';
    const r = resolveStandaloneDatabase();
    expect(r.driver).toBe('mysql');
    expect(r.url).toBe('mysql://user:pw@env-host:3306/db');
  });
});

describe('createStandaloneStack — a mysql:// boot is dispatched, not refused as unknown (#6265)', () => {
  it('declares { driver: "mysql", config: { url } } instead of throwing "Unsupported database URL scheme"', async () => {
    clearUrlEnv();
    const url = 'mysql://user:pw@localhost:3306/objectstack';
    const stack = await createStandaloneStack({ databaseUrl: url });
    const def = defaultDefOf(stack);
    expect(def.driver).toBe('mysql');
    expect(def.config).toEqual({ url });
  }, BOOT_TIMEOUT);

  // The other end of the handshake: the id this stack declares is one the
  // SHARED factory can build (`kind === 'mysql'` → SqlDriver, client `mysql2`).
  // Not a connect — `mysql2` is an optional peer of `@objectstack/driver-sql`
  // and a live server is not this package's contract; what matters is that the
  // declared id is not an id nobody builds.
  it('the declared driver id is one the shared factory supports', async () => {
    const { createDefaultDatasourceDriverFactory } = await import('@objectstack/service-datasource');
    const factory = createDefaultDatasourceDriverFactory({ dev: false });
    expect(factory.supports('mysql')).toBe(true);
  });

  it('an explicit databaseDriver:"mysql" declares mysql — never the sqlite fallback', async () => {
    clearUrlEnv();
    const stack = await createStandaloneStack({
      databaseDriver: 'mysql',
      databaseUrl: 'mysql://user:pw@localhost:3306/objectstack',
    });
    expect(defaultDefOf(stack).driver).toBe('mysql');
  }, BOOT_TIMEOUT);
});

describe('OS_DATABASE_DRIVER — an unknown value is refused loudly, never SQLite (#6265)', () => {
  it('a typo with a URL set throws, naming the value and every legal driver', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_DRIVER = 'mysq1';
    process.env.OS_DATABASE_URL = 'mysql://user:pw@localhost:3306/db';
    expect(() => resolveStandaloneDatabase()).toThrow(/Unsupported OS_DATABASE_DRIVER value/);
    expect(() => resolveStandaloneDatabase()).toThrow(/mysq1/);
    // The legal-values list is DERIVED from the enum, so this loop is the pin:
    // a kind added to the schema without touching the message still passes.
    for (const option of StandaloneDatabaseDriverSchema.options) {
      expect(() => resolveStandaloneDatabase(), `legal value "${option}" must be named`).toThrow(option);
    }
  });

  // The insidious one: no URL at all, so the old code resolved the default
  // `file:…/standalone.db`, cast the env value to a kind nothing matched, and
  // created a SQLite database for an operator who asked for something else.
  it('a typo with NO URL set throws too — it does not quietly become the sqlite default', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_DRIVER = 'postgress';
    expect(() => resolveStandaloneDatabase()).toThrow(/Unsupported OS_DATABASE_DRIVER value/);
    expect(() => resolveStandaloneDatabase()).toThrow(/postgress/);
  });

  it('the whole boot refuses as well, and produces no sqlite definition (both URL states)', async () => {
    clearUrlEnv();
    process.env.OS_DATABASE_DRIVER = 'mysq1';
    process.env.OS_DATABASE_URL = 'mysql://user:pw@localhost:3306/db';
    await expect(createStandaloneStack()).rejects.toThrow(/Unsupported OS_DATABASE_DRIVER value/);

    delete process.env.OS_DATABASE_URL;
    const err = await createStandaloneStack().then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(String((err as Error).message)).toMatch(/Unsupported OS_DATABASE_DRIVER value/);
    // …and nothing anywhere in the refusal offers sqlite as a consolation.
    expect(String((err as Error).message)).not.toMatch(/falling back to sqlite|using sqlite/i);
  }, BOOT_TIMEOUT);

  // Two different failures, two different messages: "I don't know that driver"
  // must not read as "I don't know that URL scheme", or an operator debugging
  // one goes looking at the other.
  it('the driver refusal and the URL-scheme refusal stay distinguishable', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_DRIVER = 'mysq1';
    expect(() => resolveStandaloneDatabase()).not.toThrow(/Unsupported database URL scheme/);

    delete process.env.OS_DATABASE_DRIVER;
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'wat://nope' }))
      .not.toThrow(/Unsupported OS_DATABASE_DRIVER value/);
  });

  it('an empty / whitespace-only value is "unset", not an unknown driver', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_DRIVER = '   ';
    process.env.OS_DATABASE_URL = 'memory://blank-driver';
    expect(resolveStandaloneDatabase().driver).toBe('memory');
  });

  // Normalization parity with the CLI's reader of this same variable
  // (`resolveDriverType`: `.toLowerCase().trim()`). The accepted VOCABULARY is
  // still exactly the enum — only the casing of the operator's typing is
  // normalized, in both readers, so one env value cannot mean two things.
  it('accepts the CLI-normalized spellings of a legal value (case + surrounding space)', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_URL = 'mysql://user:pw@localhost:3306/db';
    process.env.OS_DATABASE_DRIVER = ' MySQL ';
    expect(resolveStandaloneDatabase().driver).toBe('mysql');
  });

  it('every legal value round-trips through the env path', () => {
    clearUrlEnv();
    // A URL that never decides on its own — the env value is what is under test.
    process.env.OS_DATABASE_URL = 'file:/tmp/os-6265/env-driver.db';
    for (const option of StandaloneDatabaseDriverSchema.options) {
      process.env.OS_DATABASE_DRIVER = option;
      expect(resolveStandaloneDatabase().driver).toBe(option);
    }
  });
});

describe('the existing schemes are untouched (positive controls, #6265)', () => {
  it.each([
    ['memory://anything', 'memory'],
    ['postgres://user:pw@localhost:5432/db', 'postgres'],
    ['postgresql://user:pw@localhost:5432/db', 'postgres'],
    ['pg://user:pw@localhost:5432/db', 'postgres'],
    ['mysql://user:pw@localhost:3306/db', 'mysql'],
    ['mysql2://user:pw@localhost:3306/db', 'mysql'],
    ['mongodb://localhost:27017/objectstack', 'mongodb'],
    ['mongodb+srv://cluster.example.com/db', 'mongodb'],
    ['libsql://my-db.turso.io', 'turso'],
    ['https://my-db.turso.io', 'turso'],
    ['wasm-sqlite:///tmp/x.db', 'sqlite-wasm'],
    ['file:/tmp/os-6265/plain.db', 'sqlite'],
    ['/tmp/os-6265/bare-path.db', 'sqlite'],
  ])('%s → %s', (url, kind) => {
    expect(resolveStandaloneDatabase({ databaseUrl: url }).driver).toBe(kind);
  });

  // #6220's e2e pins this exit path from the CLI end — the new mysql arm must
  // not have turned the trailing throw into a catch-all.
  it('an unknown scheme still throws, and the message now lists mysql://', () => {
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'wat://nope' }))
      .toThrow(/Unsupported database URL scheme/);
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'wat://nope' }))
      .toThrow(/mysql:\/\//);
    // …and it still lists what #5820 added, so neither half erased the other.
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'wat://nope' }))
      .toThrow(/libsql:\/\//);
  });

  it('a non-Turso https URL is still unsupported', () => {
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'https://example.com/db' }))
      .toThrow(/Unsupported database URL scheme/);
  });
});
