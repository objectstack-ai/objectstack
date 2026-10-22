// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// Type-only: the compile-time half of the #5602 dispatch pin (see the last test in
// this file). `@objectstack/driver-turso` is an OPTIONAL peer of the CLI — this
// import is erased, so nothing here requires it at runtime.
import type { TursoDriverConfig } from '@objectstack/driver-turso';
// #7314: the shared libSQL config builder both loaders call, and the class both
// now raise. Imported from `@objectstack/service-datasource` — the lowest package
// of the three, and the only import direction the dependency graph allows.
import {
  buildTursoDriverConfig,
  resolveTursoUrl,
  TURSO_DRIVER_CONFIG_KEYS,
  MissingDriverPackageError as OpenCoreMissingDriverPackageError,
  type TursoDriverConfigInput,
} from '@objectstack/service-datasource';
import {
  inferDriverTypeFromUrl,
  resolveDriverType,
  resolveStorageDefinition,
  loadTursoDriverFactory,
  isTursoDriverId,
  MissingDriverPackageError,
  TURSO_DRIVER_INSTALL_COMMAND,
  UnsupportedDriverError,
} from './storage-driver.js';
// Commit 68f5eccb1: the OTHER host's bindings, imported under their own names so the
// identity assertions below compare two real module paths rather than one alias
// of the same import. `@objectstack/runtime` resolves to the BUILT package here,
// exactly as it does for `storage-driver.ts` itself — which is what makes the
// identity pinned below the identity that ships.
import {
  loadTursoDriverFactory as loadRuntimeTursoDriverFactory,
  isTursoDriverId as runtimeIsTursoDriverId,
  MissingDriverPackageError as RuntimeMissingDriverPackageError,
  TURSO_DRIVER_INSTALL_COMMAND as RUNTIME_TURSO_DRIVER_INSTALL_COMMAND,
} from '@objectstack/runtime';

describe('inferDriverTypeFromUrl', () => {
  it('maps each recognized URL scheme to its canonical driver kind', () => {
    expect(inferDriverTypeFromUrl('mongodb://localhost:27017/db')).toBe('mongodb');
    expect(inferDriverTypeFromUrl('mongodb+srv://cluster/db')).toBe('mongodb');
    expect(inferDriverTypeFromUrl('postgres://u:p@h/db')).toBe('postgres');
    expect(inferDriverTypeFromUrl('postgresql://u:p@h/db')).toBe('postgres');
    // The runtime host's third postgres spelling (`detectDriverFromUrl`).
    expect(inferDriverTypeFromUrl('pg://u:p@h/db')).toBe('postgres');
    expect(inferDriverTypeFromUrl('PG://u:p@h/db')).toBe('postgres');
    expect(inferDriverTypeFromUrl('mysql://u:p@h/db')).toBe('mysql');
    expect(inferDriverTypeFromUrl('mysql2://u:p@h/db')).toBe('mysql');
    expect(inferDriverTypeFromUrl('libsql://x.turso.io')).toBe('turso');
    expect(inferDriverTypeFromUrl('https://x.turso.io')).toBe('turso');
    expect(inferDriverTypeFromUrl('wasm-sqlite://data.db')).toBe('sqlite-wasm');
    expect(inferDriverTypeFromUrl('./local.wasm.db')).toBe('sqlite-wasm');
    expect(inferDriverTypeFromUrl('file:./local.wasm.db')).toBe('sqlite-wasm');
    expect(inferDriverTypeFromUrl('sqlite:./local.wasm.db')).toBe('sqlite-wasm');
    expect(inferDriverTypeFromUrl('file:./app.db')).toBe('sqlite');
    expect(inferDriverTypeFromUrl('sqlite:./app.db')).toBe('sqlite');
    expect(inferDriverTypeFromUrl('./app.sqlite')).toBe('sqlite');
  });

  // The in-memory (mingo) engine's schemes are REFUSED at inference: the engine
  // is no longer a boot store. Asserted on the error's TYPE and on what it names
  // (the variable, the scheme and the two SQLite replacements), never on its prose.
  it.each([
    ['memory://', 'memory://'],
    ['memory://ignored-host', 'memory://'],
    ['mingo://', 'mingo://'],
    ['MINGO://x', 'MINGO://'],
  ])(
    'refuses %s at inference, naming its scheme and the SQLite replacements',
    (url, scheme) => {
      let err: unknown;
      try {
        inferDriverTypeFromUrl(url);
      } catch (e) {
        err = e;
      }
      expect(err, `inferDriverTypeFromUrl accepted ${url}`).toBeInstanceOf(UnsupportedDriverError);
      const refusal = err as UnsupportedDriverError;
      // Not a kind this resolver produces — the allowlist pin's oracle reads this.
      expect(refusal.recognized).toBe(false);
      expect(refusal.driverType).toBe(scheme);
      expect(refusal.message).toContain('OS_DATABASE_URL');
      expect(refusal.message).toContain(`"${scheme}"`);
      expect(refusal.message).toContain('--fresh');
      expect(refusal.message).toContain(':memory:');
    },
  );

  // The refusal is printed to the console on the way out, and both schemes take
  // anything after the `//`: a `user:password@` and an `?authToken=` ride along.
  // It names the scheme, never the URL — in the message AND in the field a
  // caller may log. Placeholder credentials only.
  const PLACEHOLDERS = ['PLACEHOLDER-USER', 'PLACEHOLDER-SECRET', 'PLACEHOLDER-TOKEN'] as const;
  const CREDENTIALED_TAIL = 'PLACEHOLDER-USER:PLACEHOLDER-SECRET@127.0.0.1:6399/0?authToken=PLACEHOLDER-TOKEN';
  it.each(['memory://', 'mingo://'])(
    'refuses a %s URL carrying a user, password and token, naming the scheme and none of the three',
    (scheme) => {
      const url = `${scheme}${CREDENTIALED_TAIL}`;
      let err: unknown;
      try {
        inferDriverTypeFromUrl(url);
      } catch (e) {
        err = e;
      }
      expect(err, `inferDriverTypeFromUrl accepted ${scheme}…`).toBeInstanceOf(UnsupportedDriverError);
      const refusal = err as UnsupportedDriverError;
      expect(refusal.recognized).toBe(false);
      expect(refusal.driverType).toBe(scheme);
      expect(refusal.message).toContain(`"${scheme}"`);
      expect(refusal.message).toContain('--fresh');
      expect(refusal.message).toContain(':memory:');
      for (const placeholder of PLACEHOLDERS) {
        expect(refusal.message, `the refusal prints ${placeholder}`).not.toContain(placeholder);
        expect(refusal.driverType, `driverType carries ${placeholder}`).not.toContain(placeholder);
      }
      expect(refusal.message).not.toContain('127.0.0.1');
    },
  );

  // CONTROL: the same credentialed tail under every other scheme classifies as
  // before — the redaction is scoped to the retired engine's arm, not to URLs
  // that carry credentials.
  it.each([
    ['postgres://', 'postgres'],
    ['postgresql://', 'postgres'],
    ['pg://', 'postgres'],
    ['mysql://', 'mysql'],
    ['mysql2://', 'mysql'],
    ['mongodb://', 'mongodb'],
    ['mongodb+srv://', 'mongodb'],
    ['libsql://', 'turso'],
    ['wasm-sqlite://', 'sqlite-wasm'],
  ])('classifies a %s URL carrying the same user, password and token as %s', (scheme, kind) => {
    expect(inferDriverTypeFromUrl(`${scheme}${CREDENTIALED_TAIL}`)).toBe(kind);
  });

  // The sqlite `:memory:` PSEUDO-FILE is SQLite's own in-memory mode — NOT the
  // mingo engine. It stays `sqlite`, and it is the replacement the refusal names.
  it('keeps sqlite `:memory:` mapped to sqlite (the replacement, distinct from memory://)', () => {
    expect(inferDriverTypeFromUrl(':memory:')).toBe('sqlite');
  });

  // A value with no scheme is a SQLite file path whatever its name — the runtime
  // host's arm. These used to answer '' (dev booted `:memory:`). A one-letter
  // drive and a `:` is a drive, not a scheme.
  it.each(['./data/app', 'data/app', '/var/lib/objectstack/app', 'C:\\data\\app', 'C:/data/app', './backup:2026.db'])(
    'classifies the scheme-less path %s as a sqlite file',
    (url) => {
      expect(inferDriverTypeFromUrl(url)).toBe('sqlite');
    },
  );

  it('returns "" only for an absent or blank URL', () => {
    expect(inferDriverTypeFromUrl(undefined)).toBe('');
    expect(inferDriverTypeFromUrl('')).toBe('');
    // Blank is absent — never a sqlite file named by whitespace.
    expect(inferDriverTypeFromUrl('   ')).toBe('');
  });

  // An unrecognised `<scheme>://` is REFUSED at inference, as `memory://` is: it
  // used to answer '', and `serve --dev` booted `:memory:` over the database the
  // operator named. Asserted on the error's TYPE and on what it names (the
  // variable, the scheme, recognised schemes), never on its prose.
  it.each([
    ['redis://127.0.0.1:6399/0', 'redis://'],
    ['REDIS://h/0', 'REDIS://'],
    ['https://db.example.com/app', 'https://'],
    ['mssql://h/db', 'mssql://'],
    // A `.db` name does not rescue a scheme nothing recognises.
    ['redis://h/app.db', 'redis://'],
    // An OPAQUE scheme (two or more characters and a `:`, no `//`) is refused
    // too, rather than opened as a file at a path made of the URL.
    ['jdbc:postgresql://localhost:5432/db', 'jdbc:'],
    ['redis:cache', 'redis:'],
    // Nor does a `.wasm.db` name: it selects the WASM engine for a FILE only.
    ['redis://h/app.wasm.db', 'redis://'],
    ['jdbc:x/app.wasm.db', 'jdbc:'],
  ])('refuses %s at inference, naming the scheme and the recognised ones', (url, scheme) => {
    let err: unknown;
    try {
      inferDriverTypeFromUrl(url);
    } catch (e) {
      err = e;
    }
    expect(err, `inferDriverTypeFromUrl accepted ${url}`).toBeInstanceOf(UnsupportedDriverError);
    const refusal = err as UnsupportedDriverError;
    expect(refusal.recognized).toBe(false);
    expect(refusal.driverType).toBe(scheme);
    expect(refusal.message).toContain(`"${scheme}"`);
    expect(refusal.message).toContain('OS_DATABASE_URL');
    for (const named of ['postgres://', 'pg://', 'mysql://', 'mongodb://', 'libsql://', 'file:', ':memory:']) {
      expect(refusal.message, `the refusal does not name ${named}`).toContain(named);
    }
  });

  // The refusal is printed on the way out, and the URL is where credentials ride.
  it('names the scheme of a refused URL, never the URL and its credentials', () => {
    const url = 'redis://admin:pw-not-a-real-secret@127.0.0.1:6399/0';
    let message = '';
    try {
      inferDriverTypeFromUrl(url);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, `${url} was not refused`).toContain('"redis://"');
    expect(message).not.toContain('pw-not-a-real-secret');
    expect(message).not.toContain('127.0.0.1');
  });
});

describe('resolveDriverType', () => {
  it('lets an explicit driver win over URL inference (and normalizes case/space)', () => {
    expect(resolveDriverType('sqlite', 'postgres://h/db')).toBe('sqlite');
    expect(resolveDriverType('  SQLITE  ', undefined)).toBe('sqlite');
    expect(resolveDriverType('Postgres', 'mongodb://h/db')).toBe('postgres');
  });

  it('falls back to URL inference when no explicit driver is set', () => {
    expect(resolveDriverType(undefined, 'mongodb://h/db')).toBe('mongodb');
    expect(resolveDriverType('', ':memory:')).toBe('sqlite');
    expect(resolveDriverType('   ', undefined)).toBe('');
    // …and inference's refusal reaches the caller through this function too.
    expect(() => resolveDriverType('', 'memory://')).toThrow(UnsupportedDriverError);
    expect(() => resolveDriverType(undefined, 'redis://h/0')).toThrow(UnsupportedDriverError);
  });

  // An explicit driver still wins: the URL is not classified at all, so an
  // unrecognised scheme beside OS_DATABASE_DRIVER is not refused here.
  it('lets an explicit driver win over a URL whose scheme it does not recognise', () => {
    expect(resolveDriverType('postgres', 'redis://h/0')).toBe('postgres');
    expect(resolveDriverType('sqlite', 'redis://h/0')).toBe('sqlite');
  });
});

describe('resolveStorageDefinition (#3826 — a definition, not a driver)', () => {
  // ── The retired in-memory engine ───────────────────────────────────────────
  // #3276's lesson still holds — a `memory` selection must NOT fall through to the
  // dev SQLite `:memory:` default in silence — but the answer is now a refusal,
  // not the mingo driver: the engine is no longer a boot store. Delete the
  // refusal and dev resolves the sqlite dev default (a silent different engine),
  // prod resolves null; either way no `UnsupportedDriverError` is thrown.
  it.each(['memory', 'mingo', 'in-memory', 'inmemory'])(
    'refuses `%s` in DEV and PROD, naming the SQLite replacements instead of a typo list',
    (spelling) => {
      for (const isDev of [true, false]) {
        let err: unknown;
        try {
          resolveStorageDefinition(spelling, { isDev });
        } catch (e) {
          err = e;
        }
        expect(err, `${spelling} (isDev=${isDev}) was not refused`).toBeInstanceOf(UnsupportedDriverError);
        const refusal = err as UnsupportedDriverError;
        expect(refusal.recognized).toBe(false);
        expect(refusal.driverType).toBe(spelling);
        expect(refusal.message).toContain('--fresh');
        expect(refusal.message).toContain(':memory:');
        expect(refusal.message).not.toContain('Supported drivers:');
      }
    },
  );

  it('declares mongodb from the URL it was given', () => {
    const r = resolveStorageDefinition('mongodb', {
      databaseUrl: 'mongodb://db.internal:27017/app',
      isDev: false,
    });
    expect(r!.driverId).toBe('mongodb');
    expect(r!.config).toEqual({ url: 'mongodb://db.internal:27017/app' });
    expect(r!.trackName).toBe('MongoDBDriver');
  });

  // VERDICT FLIPPED by commit e2798fab7's fork 2 (maintainer ruling, 2026-08-09). This pin
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

  // `sqlite:` / `sqlite://` are aliases of `file:` (the runtime host's
  // `normalizeDatabaseUrl`): `sqlite://x.db` is `x.db`, never `//x.db`, which
  // is the filesystem root. The cross-host equality is pinned in
  // `driver-vocabulary-parity.test.ts`.
  it.each([
    ['sqlite://x.db', 'x.db'],
    ['sqlite:x.db', 'x.db'],
    ['sqlite:///var/lib/objectstack/x.db', '/var/lib/objectstack/x.db'],
    ['SQLITE://x.db', 'x.db'],
  ])('reads %s as the sqlite file %s', (url, file) => {
    const r = resolveStorageDefinition(resolveDriverType(undefined, url), { databaseUrl: url, isDev: false });
    expect(r!.config.filename).toBe(file);
    expect(r!.sqliteFilePath).toBe(file);
    // The banner keeps what the operator typed.
    expect(r!.displayUrl).toBe(url);
  });

  it('reads sqlite://x.wasm.db as the WASM engine on the file x.wasm.db, by the same alias rule', () => {
    const url = 'sqlite://x.wasm.db';
    const r = resolveStorageDefinition(resolveDriverType(undefined, url), { databaseUrl: url, isDev: false });
    expect(r!.driverId).toBe('sqlite-wasm');
    expect(r!.config.filename).toBe('x.wasm.db');
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

  // VERDICT FLIPPED by commit e2798fab7's fork 1. `'nonsense'` used to share the `''` answer —
  // null in prod, and in DEV the trailing SQLite default, i.e.
  // `os dev --database-driver sqlite3` silently booted SQLite while `os migrate`
  // refused the same value by name (commit cfb549db8 killed the silent fallback on that
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

// #7314 — the CONFIG half of the convergence, pinned from the only package that
// can see both sides.
//
// Two loaders build the libSQL driver — `@objectstack/runtime`'s host loader for
// a host's `default` datasource, `@objectstack/service-datasource`'s open-core
// arm for every other door — and each used to hand-list the keys it read. The
// lists drifted: nine keys in the open-core arm, `url` and `authToken` in the
// host loader, so an encrypted or embedded-replica `default` silently lost
// `encryptionKey` / `syncUrl` / `sync` / `concurrency` / `timeout` / `mode` and
// got them back the moment it was renamed. Both now build through
// `buildTursoDriverConfig`, so they cannot disagree with EACH OTHER.
//
// This file pins the remaining gap: whether that one builder still agrees with
// the DRIVER. `@objectstack/driver-turso` is deliberately not resolvable from
// `@objectstack/runtime` or `@objectstack/service-datasource` (that is what
// "optional" means, and the open-core missing-package pin depends on it staying
// so), while the CLI carries it as a dev dependency for exactly this check. The
// assertions are compile-time — `packages/cli`'s `typecheck` compiles this file
// — because a key the driver added and the builder never read is a defect with
// no runtime symptom at all: the config constructs, the driver connects, and the
// setting is simply absent.
describe('#7314 — the shared libSQL config builder against the real TursoDriverConfig', () => {
  /** Compile-time `T must be never`; the alias is only satisfiable when it is. */
  type AssertNever<T extends never> = T;
  /** A key the DRIVER accepts that the shared builder does not read. */
  type UnreadByBuilder = Exclude<keyof Omit<TursoDriverConfig, 'client'>, keyof TursoDriverConfigInput>;
  /**
   * A key the builder emits that the driver does not declare. `schemaMode` is
   * excluded on purpose: ADR-0015 ownership is honoured by the `SqlDriver` base
   * `TursoDriver` extends, not declared on `TursoDriverConfig` itself.
   */
  type UnknownToDriver = Exclude<keyof TursoDriverConfigInput, keyof TursoDriverConfig | 'schemaMode'>;

  it('reads every authorable key of the driver config, and emits none it does not know', () => {
    // `client` is excluded from the driver side: a pre-built `@libsql/client`
    // instance is a host-composition escape hatch, never authorable config.
    const unreadByBuilder: AssertNever<UnreadByBuilder>[] = [];
    const unknownToDriver: AssertNever<UnknownToDriver>[] = [];
    expect([...unreadByBuilder, ...unknownToDriver]).toEqual([]);
  });

  it('produces a config the real driver accepts, carrying every declared key', () => {
    const spec = {
      name: 'default',
      driver: 'turso',
      schemaMode: 'external',
      config: {
        url: 'libsql://my-db.turso.io',
        authToken: 'jwt-token',
        concurrency: 7,
        syncUrl: 'libsql://replica.turso.io',
        sync: { intervalSeconds: 30, onConnect: false },
        timeoutMs: 9000,
        mode: 'replica',
      },
    } as const;
    const built = buildTursoDriverConfig(spec, resolveTursoUrl(spec));
    const pinned: TursoDriverConfig = built;

    // `encryptionKey` is retired (#25050): typed `never` on BOTH sides, so the
    // compile-time pin above holds it as read-and-forwarded (a legacy stored
    // row reaches the constructor's refusal), and no datasource can declare it.
    expect(pinned).not.toHaveProperty('encryptionKey');
    expect(pinned.syncUrl).toBe('libsql://replica.turso.io');
    expect(pinned.sync).toEqual({ intervalSeconds: 30, onConnect: false });
    expect(Object.keys(built).sort())
      .toEqual(TURSO_DRIVER_CONFIG_KEYS.filter((k) => k !== 'encryptionKey').sort());
  });
});

// Commit 68f5eccb1 — the loader has ONE owner (`@objectstack/runtime`), and this file's
// exports are that owner's declarations rather than hand-aligned copies.
//
// The property under test is CLASS IDENTITY, not wording. `serve.ts:1136` decides
// whether a boot failure is fatal with
//
//     if (e instanceof MissingDriverPackageError) throw e;
//
// so a convergence that left two same-named classes — one per package — would
// make that predicate stop matching and degrade a fatal branch to a non-fatal one
// with no diagnostic anywhere. Nothing in the message would change, which is why
// the first case below demonstrates, in-suite, that a message assertion is blind
// to exactly this defect.
describe('#6268 — one loader, one class identity across cli and runtime', () => {
  it('the CLI export IS the runtime class object, not a same-named twin', () => {
    expect(MissingDriverPackageError).toBe(RuntimeMissingDriverPackageError);
    expect(isTursoDriverId).toBe(runtimeIsTursoDriverId);
    expect(TURSO_DRIVER_INSTALL_COMMAND).toBe(RUNTIME_TURSO_DRIVER_INSTALL_COMMAND);
  });

  // THE pin. An error raised by the RUNTIME loader must satisfy the instanceof
  // that `serve.ts` performs against the CLI-side binding.
  it("an error raised by the runtime loader satisfies serve.ts's CLI-side instanceof", async () => {
    const err = await loadRuntimeTursoDriverFactory({
      importDriverPackage: async () => { throw new Error("Cannot find module '@objectstack/driver-turso'"); },
    }).then(() => null, (e: unknown) => e);

    // The predicate serve.ts runs, spelled the way serve.ts spells it.
    expect(err instanceof MissingDriverPackageError).toBe(true);

    // …and the demonstration that a message assertion could NOT have caught a
    // broken identity: a twin declared right here carries the same message and
    // the same fields, and passes every assertion except the one above.
    //
    // #7314 revisited this declaration and KEPT it. It is not a stand-in for a
    // class that could not be reached — the real one is imported at the top of
    // this file and asserted identical two cases up — it is the NEGATIVE CONTROL
    // that gives the positive assertion its meaning: without something that
    // matches on message and name and still fails `instanceof`, nothing here
    // shows that the passing assertion is testing identity rather than wording.
    // Deleting it "in favour of the real import" would have removed the only
    // evidence that the pin has teeth.
    class MissingDriverPackageErrorTwin extends Error {
      constructor(readonly installCommand: string, message: string) {
        super(message);
        this.name = 'MissingDriverPackageError';
      }
    }
    const twin = new MissingDriverPackageErrorTwin(
      (err as MissingDriverPackageError).installCommand,
      (err as Error).message,
    );
    expect(twin.message).toBe((err as Error).message);
    expect(twin.name).toBe((err as Error).name);
    expect(twin.installCommand).toBe(TURSO_DRIVER_INSTALL_COMMAND);
    expect(twin instanceof MissingDriverPackageError).toBe(false);
    // …and the twin fails the OPEN-CORE binding too (#7314). The class moved
    // down into `@objectstack/service-datasource` so the open-core loader could
    // raise it; the seam now has three bindings and one class object, and the
    // twin must be outside all of them.
    expect(twin instanceof OpenCoreMissingDriverPackageError).toBe(false);
    expect(err).toBeInstanceOf(OpenCoreMissingDriverPackageError);
    expect(MissingDriverPackageError).toBe(OpenCoreMissingDriverPackageError);
  });

  it('and the reverse: the CLI loader raises an error the runtime binding matches', async () => {
    const err = await loadTursoDriverFactory({
      importDriverPackage: async () => { throw new Error('nope'); },
    }).then(() => null, (e: unknown) => e);
    expect(err instanceof RuntimeMissingDriverPackageError).toBe(true);
    expect((err as MissingDriverPackageError).installCommand).toBe('npm install @objectstack/driver-turso');
  });

  // The one thing the convergence deliberately did NOT move: the dynamic
  // import's specifier, whose RESOLUTION ROOT is the module that evaluates it.
  // `@objectstack/driver-turso` is an optional PEER of `@objectstack/cli` and,
  // since commit 090f2302e, of `@objectstack/runtime` too — an optional peer names the
  // relationship and installs nothing, so the package still sits in whichever
  // tree the operator installed it into. Had the CLI taken the runtime's default
  // thunk, an operator who ran the exact install command this error prints would
  // still be told the package was missing.
  //
  // This case pins the CLI half — the default thunk finds the package installed
  // next to the CLI, through the CLI's own `devDependencies` entry. ⚠️ The
  // runtime half USED to be pinned from the other side by
  // `standalone-stack.libsql.test.ts`, where a `libsql://` boot with no injected
  // thunk took the missing-package arm because nothing linked the package under
  // the runtime. Commit 090f2302e's optional peer makes pnpm link it there too, so that
  // case now STAGES the absence rather than relying on the layout to supply it.
  // The pair still asserts that the two roots are distinct; what neither can
  // assert any more is that one of them is empty.
  it('resolves the optional package from the CLI’s own node_modules by default', async () => {
    const factory = await loadTursoDriverFactory();
    expect(factory.supports('turso')).toBe(true);
    expect(factory.supports('libsql')).toBe(true);
    expect(factory.supports('sqlite')).toBe(false);
  });

  // The CLI-only semantics the ruling keeps on this side: a url-less turso config
  // is refused as `UnsupportedDriverError`, which serve.ts re-throws as fatal —
  // while the runtime's own default keeps raising its `[StandaloneStack]` error
  // for the same message. Only the TYPE is host-chosen; the wording is shared.
  it('keeps UnsupportedDriverError as the CLI’s url-less refusal, with the shared wording', async () => {
    const factory = await loadTursoDriverFactory({
      importDriverPackage: async () => ({ TursoDriver: class { constructor(_c: unknown) {} } }),
    });
    let err: unknown;
    try { factory.create({ name: 'default', driver: 'turso', config: {} }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(UnsupportedDriverError);
    expect((err as Error).message).toMatch(/needs a libSQL url/);
    // Not the standalone stack's prefix — that host keeps its own error type.
    expect((err as Error).message).not.toMatch(/\[StandaloneStack\]/);
  });
});
