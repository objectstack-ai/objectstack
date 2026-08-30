// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5820 — the standalone stack dispatches `libsql://`, on the same terms the CLI
// does (#5602 / PR #5819).
//
// Before this, `detectDriverFromUrl()` refused every libSQL URL with
// `Unsupported database URL scheme`, while `resolveDatabaseUrl()` listed
// `TURSO_DATABASE_URL` as a URL SOURCE — read it in, cannot dispatch it out. The
// operator-visible split was `os start` (CLI path, boots) versus `os migrate`
// (this path, `Unsupported database URL scheme`) on one and the same
// `OS_DATABASE_URL=libsql://…`.
//
// What the pins below assert, in order:
//   1. detection — libSQL URLs resolve to the `turso` kind, existing schemes are
//      untouched, and a genuinely unknown scheme still throws;
//   2. the optional package, both ways — present ⇒ a TursoDriver is built from
//      the definition; absent ⇒ a loud failure carrying the install command,
//      with no SQLite anywhere in the failure (#3276);
//   3. the whole boot — `createStandaloneStack({ databaseUrl: 'libsql://…' })`
//      no longer produces the "unsupported scheme" refusal.
//
// No test here touches a real Turso endpoint. Every loader-level case
// substitutes the package through `importDriverPackage`; the whole-boot case in
// ③ has no such seam and stages absence with `vi.doMock` instead (#12943).
// Both make the "package missing" arm testable in a workspace where the package
// IS installed — which, since `@objectstack/driver-turso` became a declared
// optional peer of this package, is now every workspace.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  resolveStandaloneDatabase,
  resolveDatabaseAuthToken,
  createStandaloneStack,
} from './standalone-stack.js';
import {
  loadTursoDriverFactory,
  MissingDriverPackageError,
  isTursoDriverId,
  TURSO_DRIVER_INSTALL_COMMAND,
  TURSO_DRIVER_PACKAGE,
} from './turso-driver-factory.js';

/** Env keys these tests write; restored after every case. */
const ENV_KEYS = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_AUTH_TOKEN',
  'TURSO_AUTH_TOKEN',
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

describe('detectDriverFromUrl — libSQL/Turso URLs resolve to the `turso` kind (#5820)', () => {
  it('libsql:// resolves to turso, keeps the URL, and probes no sqlite file', () => {
    const r = resolveStandaloneDatabase({ databaseUrl: 'libsql://my-db.turso.io' });
    expect(r.driver).toBe('turso');
    expect(r.url).toBe('libsql://my-db.turso.io');
    // The occupancy probe (`os migrate`, #3917) must have nothing to say about a
    // remote endpoint — and must NOT read the URL as a file path.
    expect(r.sqliteFile).toBeNull();
  });

  it('an https Turso endpoint resolves to turso — the exact spelling the CLI classifies', () => {
    expect(resolveStandaloneDatabase({ databaseUrl: 'https://my-db.turso.io' }).driver).toBe('turso');
    expect(resolveStandaloneDatabase({ databaseUrl: 'http://my-db.turso.io' }).driver).toBe('turso');
  });

  // The reason this issue exists: the env var was already a URL SOURCE here.
  it('TURSO_DATABASE_URL now dispatches as well as resolves (the read-in/refuse-out split is gone)', () => {
    clearUrlEnv();
    process.env.TURSO_DATABASE_URL = 'libsql://from-env.turso.io';
    const r = resolveStandaloneDatabase();
    expect(r.url).toBe('libsql://from-env.turso.io');
    expect(r.driver).toBe('turso');
  });

  it('an explicit databaseDriver: "turso" is accepted by the config schema', () => {
    const r = resolveStandaloneDatabase({ databaseDriver: 'turso', databaseUrl: 'libsql://explicit.turso.io' });
    expect(r.driver).toBe('turso');
    expect(r.sqliteFile).toBeNull();
  });

  it('OS_DATABASE_DRIVER=turso selects the same kind', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_DRIVER = 'turso';
    process.env.OS_DATABASE_URL = 'libsql://env-driver.turso.io';
    expect(resolveStandaloneDatabase().driver).toBe('turso');
  });
});

describe('detectDriverFromUrl — the existing schemes are untouched (positive controls)', () => {
  it.each([
    ['memory://anything', 'memory'],
    ['postgres://user:pw@localhost:5432/db', 'postgres'],
    ['postgresql://user:pw@localhost:5432/db', 'postgres'],
    ['pg://user:pw@localhost:5432/db', 'postgres'],
    ['mongodb://localhost:27017/objectstack', 'mongodb'],
    ['mongodb+srv://cluster.example.com/db', 'mongodb'],
    ['wasm-sqlite:///tmp/x.db', 'sqlite-wasm'],
    ['file:/tmp/os-5820/plain.db', 'sqlite'],
    ['/tmp/os-5820/bare-path.db', 'sqlite'],
  ])('%s → %s', (url, kind) => {
    expect(resolveStandaloneDatabase({ databaseUrl: url }).driver).toBe(kind);
  });

  it('an unknown scheme still throws, and the message now lists libsql', () => {
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'wat://nope' }))
      .toThrow(/Unsupported database URL scheme/);
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'wat://nope' }))
      .toThrow(/libsql:\/\//);
  });

  // The turso arm is narrow on purpose: a plain https URL is not a database.
  it('a non-Turso https URL is still unsupported', () => {
    expect(() => resolveStandaloneDatabase({ databaseUrl: 'https://example.com/db' }))
      .toThrow(/Unsupported database URL scheme/);
  });
});

describe('resolveDatabaseAuthToken — the same precedence `os serve` reads', () => {
  it('explicit config wins over both env vars', () => {
    process.env.OS_DATABASE_AUTH_TOKEN = 'from-os-env';
    process.env.TURSO_AUTH_TOKEN = 'from-vendor-env';
    expect(resolveDatabaseAuthToken({ databaseAuthToken: 'from-config' })).toBe('from-config');
  });

  it('OS_DATABASE_AUTH_TOKEN (where --database-auth-token lands) wins over TURSO_AUTH_TOKEN', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_AUTH_TOKEN = 'from-os-env';
    process.env.TURSO_AUTH_TOKEN = 'from-vendor-env';
    expect(resolveDatabaseAuthToken()).toBe('from-os-env');
  });

  it('falls back to the vendor TURSO_AUTH_TOKEN', () => {
    clearUrlEnv();
    process.env.TURSO_AUTH_TOKEN = 'from-vendor-env';
    expect(resolveDatabaseAuthToken()).toBe('from-vendor-env');
  });

  it('blank values are absent, not empty credentials', () => {
    clearUrlEnv();
    process.env.OS_DATABASE_AUTH_TOKEN = '   ';
    expect(resolveDatabaseAuthToken()).toBeUndefined();
    process.env.TURSO_AUTH_TOKEN = 'fallback';
    expect(resolveDatabaseAuthToken()).toBe('fallback');
  });

  it('no source at all → undefined (so no authToken key reaches the driver config)', () => {
    clearUrlEnv();
    expect(resolveDatabaseAuthToken()).toBeUndefined();
  });
});

describe('loadTursoDriverFactory — the OPTIONAL driver package, both ways (#5820)', () => {
  /** A stand-in for the real `@objectstack/driver-turso` module. */
  function stubTursoModule() {
    const built: Array<Record<string, unknown>> = [];
    class FakeTursoDriver {
      connected = false;
      disconnected = false;
      constructor(public readonly config: Record<string, unknown>) {
        built.push(config);
      }
      async connect() { this.connected = true; }
      async disconnect() { this.disconnected = true; }
      async checkHealth() { return true; }
    }
    return { built, module: { TursoDriver: FakeTursoDriver } };
  }

  it('claims the turso/libsql driver ids and nothing else', async () => {
    const { module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => module });
    expect(factory.supports('turso')).toBe(true);
    expect(factory.supports('libsql')).toBe(true);
    expect(factory.supports('LibSQL')).toBe(true);
    expect(factory.supports('sqlite')).toBe(false);
    expect(factory.supports('memory')).toBe(false);
    expect(isTursoDriverId('turso')).toBe(true);
    expect(isTursoDriverId('sqlite')).toBe(false);
  });

  // ① Package present: the definition this stack builds reaches a TursoDriver
  // construction with the url and the auth token. No network — the substitute
  // module proves the DISPATCH, which is this package's half of the contract.
  it('builds a TursoDriver from the stack-shaped definition (url + authToken)', async () => {
    const { built, module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => module });

    const handle = await factory.create({
      name: 'default',
      driver: 'turso',
      config: { url: 'libsql://my-db.turso.io', authToken: 'jwt-token' },
    });

    expect(built).toEqual([{ url: 'libsql://my-db.turso.io', authToken: 'jwt-token' }]);
    expect(handle.driver).toBeInstanceOf(module.TursoDriver);
    // Ownership left at the default `'factory'`: the instance was built for THIS
    // connect, so kernel teardown disconnects it.
    expect(handle.ownership).toBeUndefined();
    await handle.connect!();
    expect(await handle.checkHealth!()).toBe(true);
    await handle.disconnect!();
    const driver = handle.driver as { connected: boolean; disconnected: boolean };
    expect(driver.connected).toBe(true);
    expect(driver.disconnected).toBe(true);
  });

  it('omits authToken entirely when none was resolved (no empty-string credential)', async () => {
    const { built, module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => module });
    await factory.create({ name: 'default', driver: 'turso', config: { url: 'file:./data/local.db' } });
    expect(built).toEqual([{ url: 'file:./data/local.db' }]);
  });

  // ② Package absent: LOUD failure carrying the exact install command, and no
  // fallback of any kind.
  it('fails loudly with the exact install command when the package is missing', async () => {
    const err = await loadTursoDriverFactory({
      importDriverPackage: async () => { throw new Error("Cannot find module '@objectstack/driver-turso'"); },
    }).then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(MissingDriverPackageError);
    const missing = err as MissingDriverPackageError;
    expect(missing.driverType).toBe('turso');
    expect(missing.packageName).toBe(TURSO_DRIVER_PACKAGE);
    expect(missing.installCommand).toBe(TURSO_DRIVER_INSTALL_COMMAND);
    expect(missing.installCommand).toBe('npm install @objectstack/driver-turso');
    // The message states the command, the consequence, and the deliberate refusal.
    expect(missing.message).toContain('npm install @objectstack/driver-turso');
    expect(missing.message).toMatch(/OPTIONAL package/);
    expect(missing.message).toMatch(/refuses rather than falling back to SQLite/i);
    expect(missing.message).toMatch(/os migrate/);
    // The underlying resolution error is kept: an operator debugging a broken
    // install needs it, and swallowing it is how "not installed" hides
    // "installed but crashed on import".
    expect(missing.message).toContain("Cannot find module '@objectstack/driver-turso'");
  });

  it('offers NO silent SQLite fallback when the package is missing', async () => {
    const attempt = await loadTursoDriverFactory({
      importDriverPackage: async () => { throw new Error('boom'); },
    }).then((f) => ({ ok: true as const, f }), (e: unknown) => ({ ok: false as const, e }));

    expect(attempt.ok).toBe(false);
    expect((attempt as { e: Error }).e).toBeInstanceOf(MissingDriverPackageError);
    expect((attempt as { e: Error }).e.message).not.toMatch(/falling back to sqlite instead|using sqlite/i);
    // …and the kind the stack resolved is still turso: nothing rewrites it to
    // sqlite on the way out.
    expect(resolveStandaloneDatabase({ databaseUrl: 'libsql://my-db.turso.io' }).driver).toBe('turso');
  });

  it('rejects a resolvable module that exports no TursoDriver', async () => {
    const err = await loadTursoDriverFactory({
      importDriverPackage: async () => ({ notTheDriver: true }),
    }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MissingDriverPackageError);
    expect((err as Error).message).toMatch(/exports no TursoDriver/);
    expect((err as MissingDriverPackageError).installCommand).toBe(TURSO_DRIVER_INSTALL_COMMAND);
  });

  it('accepts a CJS-shaped module whose driver hangs off `default`', async () => {
    const { module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => ({ default: module }) });
    const handle = await factory.create({ name: 'default', driver: 'turso', config: { url: 'libsql://x.turso.io' } });
    expect(handle.driver).toBeInstanceOf(module.TursoDriver);
  });

  it('refuses to build a driver from a config with no url', async () => {
    const { module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => module });
    expect(() => factory.create({ name: 'default', driver: 'turso', config: {} }))
      .toThrow(/needs a libSQL url/);
  });
});

// ③ The whole boot, on the URL the issue is about.
//
// ⭐ This case's old comment predicted its own future and was right: "Should the
// package ever become a dependency of this one, this case turns red and names
// exactly why in this comment." #12943 declared `@objectstack/driver-turso` an
// OPTIONAL PEER of `@objectstack/runtime` — install-time honesty for a
// relationship the source already had, installing nothing for a consumer — and
// pnpm LINKS an optional workspace peer. Measured on that change: the boot
// stopped taking the missing-package arm and SUCCEEDED, building a real driver
// against `libsql://my-db.turso.io`. Red, and in the worse of the two
// directions: a green-looking boot pointed at a remote endpoint.
//
// So absence is STAGED now. `createStandaloneStack` has no `importDriverPackage`
// seam of its own — it calls `loadTursoDriverFactory()` bare, which is exactly
// the standalone default this case exists to cover — so the specifier is mocked
// with a factory that throws the resolver's own error. ⛔ No `vi.resetModules()`:
// the assertion below is an `instanceof` against the binding this file imported,
// and a reset would hand the arm a different class object and make that false
// for a correct error.
//
// What matters either way is still the FIRST assertion: the refusal is no longer
// "unsupported scheme".
describe('createStandaloneStack — a libsql:// boot is dispatched, not refused as unknown (#5820)', () => {
  it('fails with the install command instead of "Unsupported database URL scheme"', async () => {
    clearUrlEnv();
    vi.doMock('@objectstack/driver-turso', () => {
      throw Object.assign(
        new Error("Cannot find module '@objectstack/driver-turso' imported from /app/node_modules/x.mjs"),
        { code: 'ERR_MODULE_NOT_FOUND' },
      );
    });
    const err = await createStandaloneStack({ databaseUrl: 'libsql://my-db.turso.io' })
      .then(() => null, (e: unknown) => e)
      .finally(() => { vi.doUnmock('@objectstack/driver-turso'); });

    if (err === null) {
      throw new Error(
        'staging @objectstack/driver-turso as absent no longer makes the standalone libsql boot '
        + 'refuse, so this case has stopped exercising the missing-package arm — it booted a real '
        + 'driver against a remote endpoint instead. ⛔ Do not delete it and do not weaken it: '
        + 'find out why the stub stops short of the arm.',
      );
    }
    expect(err).not.toBeNull();
    expect(String((err as Error).message)).not.toMatch(/Unsupported database URL scheme/);
    expect(err).toBeInstanceOf(MissingDriverPackageError);
    expect((err as MissingDriverPackageError).installCommand).toBe(TURSO_DRIVER_INSTALL_COMMAND);
  }, 60_000);

  // The control on the same path: an unknown scheme is still refused as unknown,
  // so the new arm did not turn the throw into a catch-all. `os migrate`'s e2e
  // exit-code test pins this message from the CLI end.
  it('still refuses a genuinely unknown scheme', async () => {
    clearUrlEnv();
    await expect(createStandaloneStack({ databaseUrl: 'wat://nope' }))
      .rejects.toThrow(/Unsupported database URL scheme/);
  }, 60_000);
});
