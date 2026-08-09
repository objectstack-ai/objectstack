// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// Type-only: the compile-time half of the #5602 dispatch pin (see the last test in
// this file). `@objectstack/driver-turso` is an OPTIONAL peer of the CLI — this
// import is erased, so nothing here requires it at runtime.
import type { TursoDriverConfig } from '@objectstack/driver-turso';
import {
  inferDriverTypeFromUrl,
  resolveDriverType,
  resolveStorageDefinition,
  loadTursoDriverFactory,
  MissingDriverPackageError,
  UnsupportedDriverError,
} from './storage-driver.js';

describe('inferDriverTypeFromUrl', () => {
  it('maps each recognized URL scheme to its canonical driver kind', () => {
    expect(inferDriverTypeFromUrl('mongodb://localhost:27017/db')).toBe('mongodb');
    expect(inferDriverTypeFromUrl('mongodb+srv://cluster/db')).toBe('mongodb');
    expect(inferDriverTypeFromUrl('postgres://u:p@h/db')).toBe('postgres');
    expect(inferDriverTypeFromUrl('postgresql://u:p@h/db')).toBe('postgres');
    expect(inferDriverTypeFromUrl('mysql://u:p@h/db')).toBe('mysql');
    expect(inferDriverTypeFromUrl('mysql2://u:p@h/db')).toBe('mysql');
    expect(inferDriverTypeFromUrl('libsql://x.turso.io')).toBe('turso');
    expect(inferDriverTypeFromUrl('https://x.turso.io')).toBe('turso');
    expect(inferDriverTypeFromUrl('wasm-sqlite://data.db')).toBe('sqlite-wasm');
    expect(inferDriverTypeFromUrl('./local.wasm.db')).toBe('sqlite-wasm');
    expect(inferDriverTypeFromUrl('file:./app.db')).toBe('sqlite');
    expect(inferDriverTypeFromUrl('sqlite:./app.db')).toBe('sqlite');
    expect(inferDriverTypeFromUrl('./app.sqlite')).toBe('sqlite');
  });

  // #3276: the mingo in-memory engine has its own `memory://` URL scheme.
  it('maps the memory:// (and mingo://) scheme to the mingo `memory` kind', () => {
    expect(inferDriverTypeFromUrl('memory://')).toBe('memory');
    expect(inferDriverTypeFromUrl('memory://ignored-host')).toBe('memory');
    expect(inferDriverTypeFromUrl('mingo://')).toBe('memory');
  });

  // The sqlite `:memory:` PSEUDO-FILE is SQLite's own in-memory mode — NOT the
  // mingo engine. It must stay `sqlite`, distinct from the `memory://` scheme.
  it('keeps sqlite `:memory:` mapped to sqlite (distinct from memory://)', () => {
    expect(inferDriverTypeFromUrl(':memory:')).toBe('sqlite');
  });

  it('returns "" for an absent or unrecognized URL', () => {
    expect(inferDriverTypeFromUrl(undefined)).toBe('');
    expect(inferDriverTypeFromUrl('')).toBe('');
    expect(inferDriverTypeFromUrl('redis://localhost')).toBe('');
  });
});

describe('resolveDriverType', () => {
  it('lets an explicit driver win over URL inference (and normalizes case/space)', () => {
    expect(resolveDriverType('memory', 'postgres://h/db')).toBe('memory');
    expect(resolveDriverType('  MEMORY  ', undefined)).toBe('memory');
    expect(resolveDriverType('Postgres', 'mongodb://h/db')).toBe('postgres');
  });

  it('falls back to URL inference when no explicit driver is set', () => {
    expect(resolveDriverType(undefined, 'mongodb://h/db')).toBe('mongodb');
    expect(resolveDriverType('', 'memory://')).toBe('memory');
    expect(resolveDriverType('   ', undefined)).toBe('');
  });
});

describe('resolveStorageDefinition (#3826 — a definition, not a driver)', () => {
  // ── #3276: the regression the memory branch exists to fix ──────────────────
  // `memory` must declare the mingo InMemoryDriver — NOT fall through to the
  // dev SQLite `:memory:` default. Remove the `memory` branch and this goes
  // red: in dev it resolves to the sqlite dev-default, in prod to null.
  it('declares the mingo memory driver for `memory` in DEV and PROD', () => {
    for (const isDev of [true, false]) {
      const r = resolveStorageDefinition('memory', { isDev });
      expect(r).not.toBeNull();
      expect(r!.driverId).toBe('memory');
      expect(r!.label).toBe('InMemoryDriver');
      expect(r!.trackName).toBe('MemoryDriver');
      expect(r!.displayUrl).toBe('(in-memory)');
      // Never provisions a telemetry sibling.
      expect(r!.sqliteFilePath).toBeUndefined();
    }
  });

  it('accepts the `mingo` and `in-memory` aliases', () => {
    expect(resolveStorageDefinition('mingo', { isDev: false })!.driverId).toBe('memory');
    expect(resolveStorageDefinition('in-memory', { isDev: false })!.driverId).toBe('memory');
  });

  it('declares mongodb from the URL it was given', () => {
    const r = resolveStorageDefinition('mongodb', {
      databaseUrl: 'mongodb://db.internal:27017/app',
      isDev: false,
    });
    expect(r!.driverId).toBe('mongodb');
    expect(r!.config).toEqual({ url: 'mongodb://db.internal:27017/app' });
    expect(r!.trackName).toBe('MongoDBDriver');
  });

  // VERDICT FLIPPED by #6345 fork 2 (maintainer ruling, 2026-08-09). This pin
  // used to assert `config: { url: 'mongodb://localhost:27017/objectstack' }` for
  // a mongodb selection with no URL — a DSN the CLI invented, naming a host the
  // operator never did. It is the same defect as postgres's `url: undefined`
  // (which let the `pg` client pick its own localhost) wearing a different
  // mechanism, and the standalone stack answered the same selection with a
  // `file:` DSN. All three now refuse, in the wording `turso` has carried since
  // #5602. The full 8-cell matrix lives in `driver-vocabulary-parity.test.ts`;
  // this one stays here because it is the assertion that changed.
  it('REFUSES mongodb with no URL rather than inventing localhost:27017 (#6345)', () => {
    expect(() => resolveStorageDefinition('mongodb', { isDev: false })).toThrow(UnsupportedDriverError);
    expect(() => resolveStorageDefinition('mongodb', { isDev: true })).toThrow(/no database URL was given/);
  });

  it('declares postgres / mysql with the DSN in config and their SqlDriver labels', () => {
    const pg = resolveStorageDefinition('postgres', { databaseUrl: 'postgres://u:p@h/db', isDev: false });
    expect(pg!.driverId).toBe('postgres');
    expect(pg!.config.url).toBe('postgres://u:p@h/db');
    expect(pg!.label).toBe('SqlDriver(pg)');
    const my = resolveStorageDefinition('mysql', { databaseUrl: 'mysql://u:p@h/db', isDev: false });
    expect(my!.driverId).toBe('mysql');
    expect(my!.config.url).toBe('mysql://u:p@h/db');
    expect(my!.label).toBe('SqlDriver(mysql2)');
  });

  // #2186: the dev loosen-only self-heal rides in config so the shared factory
  // applies it at construction. Never present in production configs.
  it('carries autoMigrate:safe in DEV configs for the SQL kinds, never in PROD', () => {
    expect(resolveStorageDefinition('sqlite', { databaseUrl: 'file:./x.db', isDev: true })!.config.autoMigrate).toBe('safe');
    expect(resolveStorageDefinition('postgres', { databaseUrl: 'postgres://h/db', isDev: true })!.config.autoMigrate).toBe('safe');
    expect(resolveStorageDefinition('mysql', { databaseUrl: 'mysql://h/db', isDev: true })!.config.autoMigrate).toBe('safe');
    expect(resolveStorageDefinition('sqlite', { databaseUrl: 'file:./x.db', isDev: false })!.config.autoMigrate).toBeUndefined();
  });

  it('declares sqlite-wasm with the CLI on-disconnect persistence', () => {
    const r = resolveStorageDefinition('sqlite-wasm', { databaseUrl: 'file:./x.db', isDev: false });
    expect(r!.driverId).toBe('sqlite-wasm');
    expect(r!.config).toEqual({ filename: './x.db', persist: 'on-disconnect' });
  });

  // An explicit sqlite primary surfaces `sqliteFilePath` for the telemetry
  // sibling — the field the memory/dev-default branches deliberately leave unset.
  it('declares explicit sqlite and surfaces sqliteFilePath for telemetry', () => {
    const r = resolveStorageDefinition('sqlite', { databaseUrl: 'file:./app.db', isDev: false });
    expect(r!.driverId).toBe('sqlite');
    expect(r!.config.filename).toBe('./app.db');
    expect(r!.sqliteFilePath).toBe('./app.db');
  });

  it('dev default (no driver) declares sqlite :memory: with NO telemetry sibling', () => {
    const r = resolveStorageDefinition('', { isDev: true });
    expect(r!.driverId).toBe('sqlite');
    expect(r!.config.filename).toBe(':memory:');
    expect(r!.sqliteFilePath).toBeUndefined();
  });

  // Production with no driver configured registers nothing (loud downstream
  // failure), rather than silently inventing an engine.
  it('returns null when NO driver is configured in PROD', () => {
    expect(resolveStorageDefinition('', { isDev: false })).toBeNull();
  });

  // VERDICT FLIPPED by #6345 fork 1. `'nonsense'` used to share the `''` answer —
  // null in prod, and in DEV the trailing SQLite default, i.e.
  // `os dev --database-driver sqlite3` silently booted SQLite while `os migrate`
  // refused the same value by name (#6344 killed the silent fallback on that
  // side only). The two are not the same input: `''` means "nobody chose", while
  // a non-empty value can only have come from an operator naming a driver, since
  // URL inference yields a canonical id or `''`. So the two answers separate.
  it('REFUSES an explicitly-named unknown driver, in dev AND prod (#6345)', () => {
    for (const isDev of [false, true]) {
      expect(() => resolveStorageDefinition('nonsense', { isDev })).toThrow(UnsupportedDriverError);
      // The four contract-only aliases: they resolve a CONFIG contract but no
      // host has ever accepted them as a boot selection, and the ruling keeps it
      // that way rather than widening a flag nobody asked to widen.
      expect(() => resolveStorageDefinition('sqlite3', { isDev })).toThrow(UnsupportedDriverError);
      expect(() => resolveStorageDefinition('mariadb', { isDev })).toThrow(UnsupportedDriverError);
    }
    // The refusal enumerates what DOES work, from the shared table.
    let message = '';
    try { resolveStorageDefinition('nonsense', { isDev: false }); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('pg');
    expect(message).toContain('mongodb');
  });
});

describe('resolveStorageDefinition: turso / libSQL is inferred AND built (#5602)', () => {
  // These four pins used to assert the opposite verdict — a `libsql://` URL threw
  // UnsupportedDriverError, because `@objectstack/driver-turso` shipped outside the
  // open-source distribution. #4645 moved the package into this repo and the
  // maintainer's #5602 ruling wired it as an optional peer + dynamic import, so the
  // SAME URLs now produce a `turso` DEFINITION. What did NOT change is the thing the
  // pins were protecting: a libSQL selection must never resolve to SQLite. Remove
  // the turso branch and these go red exactly as before — dev resolves to the sqlite
  // dev-default, prod returns null, both silently ignoring the requested engine.
  it('declares the turso driver for a libsql:// URL in DEV and PROD', () => {
    for (const isDev of [true, false]) {
      const r = resolveStorageDefinition('turso', { isDev, databaseUrl: 'libsql://my-db.turso.io' });
      expect(r).not.toBeNull();
      expect(r!.driverId).toBe('turso');
      expect(r!.config).toEqual({ url: 'libsql://my-db.turso.io' });
      expect(r!.trackName).toBe('TursoDriver');
      expect(r!.label).toBe('TursoDriver(libsql)');
      expect(r!.displayUrl).toBe('libsql://my-db.turso.io');
      // A remote libSQL endpoint is not an on-disk SQLite primary, so it never
      // provisions the telemetry sibling.
      expect(r!.sqliteFilePath).toBeUndefined();
    }
  });

  it('accepts the `libsql` alias and carries the auth token into the config', () => {
    const r = resolveStorageDefinition('libsql', {
      isDev: false,
      databaseUrl: 'libsql://my-db.turso.io',
      authToken: 'jwt-token',
    });
    expect(r!.driverId).toBe('turso');
    expect(r!.config).toEqual({ url: 'libsql://my-db.turso.io', authToken: 'jwt-token' });
  });

  // `TursoDriverConfig` declares neither `autoMigrate` nor `persist`; passing one
  // would be a config key the driver silently ignores (the declared-≠-enforced shape
  // this file's other pins exist to prevent), so the dev branch adds nothing.
  it('adds no autoMigrate passthrough in dev — the turso config contract has no such key', () => {
    const r = resolveStorageDefinition('turso', { isDev: true, databaseUrl: 'libsql://my-db.turso.io' });
    expect(Object.keys(r!.config).sort()).toEqual(['url']);
  });

  // The one shape that still REFUSES: a turso selection with nothing to connect to.
  // Every other kind has a meaningful default for a missing URL; libSQL has none, and
  // inventing one (or dropping to the SQLite default) is exactly the silent
  // substitution #3276 was about.
  it('throws UnsupportedDriverError when `turso` is selected with no URL', () => {
    for (const isDev of [true, false]) {
      expect(() => resolveStorageDefinition('turso', { isDev })).toThrow(UnsupportedDriverError);
      expect(() => resolveStorageDefinition('libsql', { isDev })).toThrow(UnsupportedDriverError);
      expect(() => resolveStorageDefinition('turso', { isDev, databaseUrl: '   ' })).toThrow(UnsupportedDriverError);
    }
    let err: unknown;
    try { resolveStorageDefinition('turso', { isDev: false }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(UnsupportedDriverError);
    expect((err as UnsupportedDriverError).driverType).toBe('turso');
    expect((err as Error).message).toMatch(/OS_DATABASE_URL/);
    expect((err as Error).message).toMatch(/libsql:\/\/my-db\.turso\.io/);
    // It must not send the operator anywhere else: the package is in this repo and
    // is installable from npm (that claim died at #4645).
    expect((err as Error).message).not.toMatch(/cloud|enterprise/i);
  });

  // A `libsql://` / Turso URL is classified, not left unrecognized — which is what
  // would fall through to SQLite.
  it('routes libsql:// and *.turso.* URLs to the turso definition, never SQLite', () => {
    expect(resolveDriverType(undefined, 'libsql://my-db.turso.io')).toBe('turso');
    expect(resolveDriverType(undefined, 'https://my-db.turso.io')).toBe('turso');
    for (const url of ['libsql://my-db.turso.io', 'https://my-db.turso.io']) {
      const r = resolveStorageDefinition(resolveDriverType(undefined, url), { isDev: true, databaseUrl: url });
      expect(r!.driverId).toBe('turso');
      expect(r!.driverId).not.toBe('sqlite');
    }
  });
});

describe('loadTursoDriverFactory: the optional driver package (#5602)', () => {
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

  // ① Package present: the URL reaches a TursoDriver construction with the url and
  // the auth token from `--database-auth-token`. No network — the substitute module
  // proves the DISPATCH, which is the CLI's half of the contract.
  it('builds a TursoDriver from the resolved definition when the package is installed', async () => {
    const { built, module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => module });

    expect(factory.supports('turso')).toBe(true);
    expect(factory.supports('libsql')).toBe(true);
    expect(factory.supports('LibSQL')).toBe(true);
    expect(factory.supports('sqlite')).toBe(false);

    const definition = resolveStorageDefinition('turso', {
      isDev: false,
      databaseUrl: 'libsql://my-db.turso.io',
      authToken: 'jwt-token',
    })!;
    const handle = await factory.create({ name: 'default', driver: definition.driverId, config: definition.config });

    expect(built).toEqual([{ url: 'libsql://my-db.turso.io', authToken: 'jwt-token' }]);
    expect(handle.driver).toBeInstanceOf(module.TursoDriver);
    // Probe surface the connection service uses — the same handle shape the
    // open-core factory returns, ownership left at the default `'factory'` so
    // kernel teardown disconnects an instance built for this connect.
    expect(handle.ownership).toBeUndefined();
    await handle.connect!();
    await handle.disconnect!();
    expect(await handle.checkHealth!()).toBe(true);
    expect((handle.driver as { connected: boolean; disconnected: boolean }).connected).toBe(true);
    expect((handle.driver as { connected: boolean; disconnected: boolean }).disconnected).toBe(true);
  });

  it('omits authToken entirely when none was supplied (no empty-string credential)', async () => {
    const { built, module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => module });
    const definition = resolveStorageDefinition('turso', { isDev: false, databaseUrl: 'file:./data/local.db' })!;
    await factory.create({ name: 'default', driver: 'turso', config: definition.config });
    expect(built).toEqual([{ url: 'file:./data/local.db' }]);
  });

  // ② Package absent: LOUD failure carrying the exact install command, and NO
  // fallback of any kind. The reverse verification for this change lives here —
  // the pre-#5602 code could only ever fail, so "before red / after green" says
  // nothing; what must be proven is that the one surviving failure mode still
  // refuses to become SQLite.
  it('fails loudly with the exact install command when the package is missing', async () => {
    const err = await loadTursoDriverFactory({
      importDriverPackage: async () => { throw new Error("Cannot find module '@objectstack/driver-turso'"); },
    }).then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(MissingDriverPackageError);
    const missing = err as MissingDriverPackageError;
    expect(missing.driverType).toBe('turso');
    expect(missing.packageName).toBe('@objectstack/driver-turso');
    expect(missing.installCommand).toBe('npm install @objectstack/driver-turso');
    // The message states the command, the consequence, and the deliberate refusal.
    expect(missing.message).toContain('npm install @objectstack/driver-turso');
    expect(missing.message).toMatch(/optional peer/i);
    expect(missing.message).toMatch(/would start the server against an empty local database/i);
    expect(missing.message).toMatch(/refuses rather than falling back to SQLite/i);
    // The underlying resolution error is kept — an operator debugging a broken
    // install needs it, and swallowing it is how "not installed" hides "installed
    // but crashed on import".
    expect(missing.message).toContain("Cannot find module '@objectstack/driver-turso'");
  });

  // The no-fallback claim, asserted rather than described: there is no path from a
  // missing package to a driver at all — the loader throws, so no handle, no
  // definition rewrite, nothing sqlite-shaped anywhere in the failure.
  it('offers NO silent SQLite fallback when the package is missing', async () => {
    const attempt = await loadTursoDriverFactory({
      importDriverPackage: async () => { throw new Error('boom'); },
    }).then((f) => ({ ok: true as const, f }), (e: unknown) => ({ ok: false as const, e }));

    expect(attempt.ok).toBe(false);
    expect((attempt as { e: Error }).e).toBeInstanceOf(MissingDriverPackageError);
    expect((attempt as { e: Error }).e.message).not.toMatch(/falling back to sqlite instead|using sqlite/i);
    // …and the definition the CLI would hand the plugin is still turso: nothing
    // rewrites it to sqlite on the way out.
    expect(
      resolveStorageDefinition('turso', { isDev: true, databaseUrl: 'libsql://my-db.turso.io' })!.driverId,
    ).toBe('turso');
  });

  // A package that resolves but is not the driver (shadowing stub, truncated
  // install, a major that renamed the export) gets the same treatment — never a
  // half-built handle.
  it('rejects a resolvable module that exports no TursoDriver', async () => {
    const err = await loadTursoDriverFactory({
      importDriverPackage: async () => ({ notTheDriver: true }),
    }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MissingDriverPackageError);
    expect((err as Error).message).toMatch(/exports no TursoDriver/);
    expect((err as MissingDriverPackageError).installCommand).toBe('npm install @objectstack/driver-turso');
  });

  it('refuses to build a driver from a config with no url', async () => {
    const { module } = stubTursoModule();
    const factory = await loadTursoDriverFactory({ importDriverPackage: async () => module });
    expect(() => factory.create({ name: 'default', driver: 'turso', config: {} })).toThrow(UnsupportedDriverError);
  });

  // The config this CLI builds must be a config the REAL driver accepts. A stub
  // module cannot check that, so the shape is pinned against the real package's
  // published type — `tsc --noEmit` (packages/cli `typecheck`, which compiles tests)
  // goes red if `TursoDriverConfig` renames `url`/`authToken` or turns either
  // required-shaped in a way this dispatch no longer satisfies. Type-only: nothing
  // is imported at runtime, so the optional package stays optional.
  it('builds a config assignable to the real TursoDriverConfig', () => {
    const definition = resolveStorageDefinition('turso', {
      isDev: false,
      databaseUrl: 'libsql://my-db.turso.io',
      authToken: 'jwt-token',
    })!;
    const config = definition.config as { url: string; authToken?: string };
    const pinned: TursoDriverConfig = config;
    expect(pinned.url).toBe('libsql://my-db.turso.io');
    expect(pinned.authToken).toBe('jwt-token');
  });
});
