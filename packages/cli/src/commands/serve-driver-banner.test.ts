// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3793 — the startup banner's `Driver:` row.
//
// The banner exists so a developer sees at a glance which database they are
// talking to. When the driver was wired by an app preset or by
// `EnvironmentKernelFactory` rather than by serve's own `OS_DATABASE_URL`
// fallback, that row comes from probing the registered driver — and for a
// datasource declared with a DSN it read `SqlDriver(pg)  → (unknown)`: the
// right driver, no address, at exactly the moment (an unreachable database)
// when the address is what you need.

import { describe, it, expect } from 'vitest';
import { describeRegisteredDriver } from './serve.js';

/** A kernel whose `getService` throws for anything not registered, like the real one. */
function fakeKernel(services: Record<string, unknown>) {
  return {
    getService(name: string) {
      if (!(name in services)) throw new Error(`Service '${name}' not found`);
      return services[name];
    },
  };
}

describe('describeRegisteredDriver', () => {
  it('reads a DSN-declared pg datasource — the #3793 (unknown)', () => {
    // Exactly what `defaultDatasourceDriverFactory` hands `new SqlDriver(...)`
    // for a datasource whose config is `{ url }` / `{ connectionString }`.
    const kernel = fakeKernel({
      'driver.com.objectstack.driver.sql': {
        config: {
          client: 'pg',
          connection: { connectionString: 'postgres://u:p@127.0.0.1:59437/nope' },
          pool: { min: 0, max: 5 },
        },
      },
    });
    expect(describeRegisteredDriver(kernel)).toEqual({
      label: 'SqlDriver(pg)',
      url: 'postgres://127.0.0.1:59437/nope',
    });
  });

  it('keeps reading the shapes it already knew', () => {
    expect(describeRegisteredDriver(fakeKernel({
      'driver.sql': { config: { client: 'pg', connection: 'postgres://u:p@host:5432/app' } },
    }))).toEqual({ label: 'SqlDriver(pg)', url: 'postgres://host:5432/app' });

    expect(describeRegisteredDriver(fakeKernel({
      'driver.sql': { config: { client: 'better-sqlite3', connection: { filename: './data.db' } } },
    }))).toEqual({ label: 'SqlDriver(better-sqlite3)', url: './data.db' });

    expect(describeRegisteredDriver(fakeKernel({
      'driver.sql': { config: { client: 'pg', connection: { host: 'db.example.com', port: 5432, database: 'app' } } },
    }))).toEqual({ label: 'SqlDriver(pg)', url: 'db.example.com:5432/app' });
  });

  it('never puts credentials in the banner', () => {
    for (const connection of [
      'postgres://admin:hunter2@db.example.com:5432/app',
      { connectionString: 'postgres://admin:hunter2@db.example.com:5432/app' },
      { host: 'db.example.com', port: 5432, database: 'app', user: 'admin', password: 'hunter2' },
    ]) {
      const probe = describeRegisteredDriver(fakeKernel({
        'driver.sql': { config: { client: 'pg', connection } },
      }));
      expect(probe?.url).not.toContain('hunter2');
    }
  });

  it('reads the top-level url a MongoDBDriver keeps on its config', () => {
    // Every driver has a `config` property (MongoDBDriver's is `{ url, … }`,
    // InMemoryDriver's is `{}`), so the old "has a config → it's a SqlDriver"
    // early return meant *every* mongo boot banner read `(unknown)`.
    const kernel = fakeKernel({
      'driver.com.objectstack.driver.mongodb': {
        constructor: { name: 'MongoDBDriver' },
        name: 'com.objectstack.driver.mongodb',
        config: { url: 'mongodb://admin:hunter2@cluster0.mongodb.net/app', database: 'app' },
      },
    });
    expect(describeRegisteredDriver(kernel)).toEqual({
      label: 'MongoDBDriver',
      url: 'mongodb://cluster0.mongodb.net/app',
    });
  });

  it('redacts the URL a driver exposes on the instance instead', () => {
    const kernel = fakeKernel({
      'driver.com.objectstack.driver.turso': {
        constructor: { name: 'TursoDriver' },
        url: 'libsql://app-org.turso.io?authToken=secret-jwt',
      },
    });
    expect(describeRegisteredDriver(kernel)).toEqual({
      label: 'TursoDriver',
      url: 'libsql://app-org.turso.io',
    });
  });

  it('still says (unknown) when the config genuinely carries no address', () => {
    const kernel = fakeKernel({
      // knex lets the host build a connection per pool checkout; there is
      // nothing to read until it is called.
      'driver.sql': { config: { client: 'pg', connection: () => ({ host: 'h' }) } },
    });
    expect(describeRegisteredDriver(kernel)).toEqual({ label: 'SqlDriver(pg)', url: '(unknown)' });
  });

  it('labels an in-memory driver "(in-memory)", not "(unknown)"', () => {
    const kernel = fakeKernel({
      // InMemoryDriver always has a `config` — `{}` when none was passed.
      'driver.memory': {
        constructor: { name: 'InMemoryDriver' },
        name: 'com.objectstack.driver.memory',
        config: {},
      },
    });
    expect(describeRegisteredDriver(kernel)).toEqual({ label: 'InMemoryDriver', url: '(in-memory)' });
  });

  it('does not paste a Client class into the label (SqliteWasmDriver)', () => {
    // SqliteWasmDriver passes knex a dialect *class* as `client`; interpolating
    // it would put the class source in the banner.
    class Client_WasmSqlite {}
    const kernel = fakeKernel({
      'driver.sql': {
        constructor: { name: 'SqliteWasmDriver' },
        config: { client: Client_WasmSqlite, connection: { filename: './app.wasm.db' } },
      },
    });
    expect(describeRegisteredDriver(kernel)).toEqual({
      label: 'SqliteWasmDriver',
      url: './app.wasm.db',
    });
  });

  it('returns null when no known driver is registered', () => {
    expect(describeRegisteredDriver(fakeKernel({}))).toBeNull();
  });
});
