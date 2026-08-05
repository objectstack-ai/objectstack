// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  inferDriverTypeFromUrl,
  resolveDriverType,
  resolveStorageDefinition,
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

  it('declares mongodb with the default URL when none is supplied', () => {
    const r = resolveStorageDefinition('mongodb', { isDev: false });
    expect(r!.driverId).toBe('mongodb');
    expect(r!.config).toEqual({ url: 'mongodb://localhost:27017/objectstack' });
    expect(r!.trackName).toBe('MongoDBDriver');
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
  it('returns null for an unknown/absent driver in PROD', () => {
    expect(resolveStorageDefinition('', { isDev: false })).toBeNull();
    expect(resolveStorageDefinition('nonsense', { isDev: false })).toBeNull();
  });
});

describe('resolveStorageDefinition: turso / libSQL is recognized but fails loud', () => {
  // `turso` (@objectstack/driver-turso) is recognized as a kind but is not one
  // this resolver constructs from a URL. Selecting it must THROW a typed error —
  // NOT fall through to the SQLite default. Remove the `turso` branch and these
  // go red: in dev it resolves to the sqlite dev-default, in prod it returns
  // null — both silently ignoring the requested turso engine (the reported bug).
  //
  // Since #4645 the package lives in THIS repo (`packages/drivers/driver-turso`),
  // so the refusal is no longer "it ships elsewhere" — it is "the CLI does not
  // build it from a URL; register it explicitly". The behaviour is unchanged;
  // only the reason given to the operator is. Whether URL inference should
  // construct it is #5602.
  it('throws UnsupportedDriverError for `turso` in DEV and PROD', () => {
    expect(() => resolveStorageDefinition('turso', { isDev: true })).toThrow(UnsupportedDriverError);
    expect(() => resolveStorageDefinition('turso', { isDev: false })).toThrow(UnsupportedDriverError);
  });

  it('throws for the `libsql` alias too', () => {
    expect(() => resolveStorageDefinition('libsql', { isDev: true })).toThrow(UnsupportedDriverError);
  });

  // The message must be actionable: name the package, name the way OUT (register
  // it explicitly), and name the alternatives this resolver does build — so an
  // operator knows exactly how to proceed. It must NOT claim the package ships
  // somewhere else; that stopped being true at #4645 and an error message that
  // sends an operator to the wrong repo is worse than a terse one.
  it('carries an actionable message (package + explicit-registration route + alternatives)', () => {
    expect(() => resolveStorageDefinition('turso', { isDev: false })).toThrow(/@objectstack\/driver-turso/);
    let err: unknown;
    try { resolveStorageDefinition('turso', { isDev: false }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(UnsupportedDriverError);
    expect((err as UnsupportedDriverError).driverType).toBe('turso');
    expect((err as Error).message).toMatch(/register it explicitly/i);
    expect((err as Error).message).toMatch(/sqlite \| postgres \| mysql \| mongodb \| memory/);
    expect((err as Error).message).not.toMatch(/cloud|enterprise/i);
  });

  // A `libsql://` / Turso URL routes to the same loud failure — it is NOT left
  // unrecognized (which would silently fall through to SQLite).
  it('routes libsql:// and *.turso.* URLs to the turso failure, never SQLite', () => {
    expect(resolveDriverType(undefined, 'libsql://my-db.turso.io')).toBe('turso');
    expect(resolveDriverType(undefined, 'https://my-db.turso.io')).toBe('turso');
    expect(() =>
      resolveStorageDefinition(resolveDriverType(undefined, 'libsql://my-db.turso.io'), { isDev: true }),
    ).toThrow(UnsupportedDriverError);
  });
});
