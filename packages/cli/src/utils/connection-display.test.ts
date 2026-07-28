// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3793 — the startup banner rendered a DSN-declared datasource as
// `→ (unknown)`: `describeRegisteredDriver` knew a `connection` that was a
// string, a `{ filename }` or a `{ host, port, database }`, but not the
// `{ connectionString }` that `defaultDatasourceDriverFactory` builds for a
// pg datasource declared with `config.url` / `config.connectionString`. The
// address went missing exactly when the database is unreachable and the
// address is the one thing worth reading.
//
// These pin both halves of the fix: every shape resolves to a target, and no
// shape leaks the credentials the DSN carries.

import { describe, it, expect } from 'vitest';
import { redactConnectionUrl, describeDriverConnection } from './connection-display.js';

describe('redactConnectionUrl', () => {
  it('drops the userinfo segment from a DSN', () => {
    expect(redactConnectionUrl('postgres://admin:hunter2@db.example.com:5432/app'))
      .toBe('postgres://db.example.com:5432/app');
  });

  it('drops a password supplied without a username', () => {
    // The old `(\/\/[^/@:]+):[^/@]+@` mask required a username to match, so
    // this shape printed the password verbatim.
    expect(redactConnectionUrl('postgres://:hunter2@db.example.com/app'))
      .toBe('postgres://db.example.com/app');
  });

  it('drops the query string, where tokens hide', () => {
    expect(redactConnectionUrl('libsql://app-org.turso.io?authToken=secret-jwt'))
      .toBe('libsql://app-org.turso.io');
  });

  it('handles a mongodb+srv DSN', () => {
    expect(redactConnectionUrl('mongodb+srv://u:p@cluster0.mongodb.net/app?retryWrites=true'))
      .toBe('mongodb+srv://cluster0.mongodb.net/app');
  });

  it('leaves a credential-free DSN alone, and is idempotent', () => {
    const clean = 'postgres://db.example.com:5432/app';
    expect(redactConnectionUrl(clean)).toBe(clean);
    expect(redactConnectionUrl(redactConnectionUrl('postgres://u:p@db.example.com:5432/app')))
      .toBe(clean);
  });

  it('passes non-URL values through untouched', () => {
    expect(redactConnectionUrl(':memory:')).toBe(':memory:');
    expect(redactConnectionUrl('./data/objectstack.db')).toBe('./data/objectstack.db');
    expect(redactConnectionUrl('(in-memory)')).toBe('(in-memory)');
    expect(redactConnectionUrl('sqlite:/var/lib/app.db')).toBe('sqlite:/var/lib/app.db');
  });

  it('still strips userinfo from something the URL parser rejects', () => {
    expect(redactConnectionUrl('weird scheme://u:p@host/db')).toBe('weird scheme://host/db');
  });
});

describe('describeDriverConnection', () => {
  it('reads a DSN string', () => {
    expect(describeDriverConnection({ client: 'pg', connection: 'postgres://u:p@host:5432/app' }))
      .toBe('postgres://host:5432/app');
  });

  it('reads `{ connectionString }` — the shape that used to render (unknown)', () => {
    expect(describeDriverConnection({
      client: 'pg',
      connection: { connectionString: 'postgres://u:p@127.0.0.1:59437/nope', password: 'hunter2' },
    })).toBe('postgres://127.0.0.1:59437/nope');
  });

  it('reads the `{ uri }` / `{ url }` spellings of the same thing', () => {
    expect(describeDriverConnection({ connection: { uri: 'mongodb://u:p@host:27017/app' } }))
      .toBe('mongodb://host:27017/app');
    expect(describeDriverConnection({ connection: { url: 'mongodb://u:p@host:27017/app' } }))
      .toBe('mongodb://host:27017/app');
  });

  it('reads a sqlite `{ filename }`', () => {
    expect(describeDriverConnection({ client: 'better-sqlite3', connection: { filename: ':memory:' } }))
      .toBe(':memory:');
    expect(describeDriverConnection({ client: 'better-sqlite3', connection: { filename: './data.db' } }))
      .toBe('./data.db');
  });

  it('reads discrete `{ host, port, database }` and never their password', () => {
    expect(describeDriverConnection({
      client: 'pg',
      connection: { host: 'db.example.com', port: 5432, database: 'app', user: 'admin', password: 'hunter2' },
    })).toBe('db.example.com:5432/app');
  });

  it('omits the port and database when they are absent', () => {
    expect(describeDriverConnection({ client: 'pg', connection: { host: 'db.example.com' } }))
      .toBe('db.example.com');
  });

  it('prefers the DSN when a config carries both shapes', () => {
    expect(describeDriverConnection({
      client: 'pg',
      connection: { connectionString: 'postgres://u:p@dsn-host/dsn-db', host: 'discrete-host' },
    })).toBe('postgres://dsn-host/dsn-db');
  });

  it('falls back to a top-level address — MongoDBDriver keeps `config.url`', () => {
    expect(describeDriverConnection({ url: 'mongodb://u:p@cluster0.mongodb.net/app', database: 'app' }))
      .toBe('mongodb://cluster0.mongodb.net/app');
  });

  it('prefers `connection` over a top-level address', () => {
    expect(describeDriverConnection({
      connection: { connectionString: 'postgres://u:p@nested-host/nested-db' },
      url: 'postgres://u:p@top-level-host/top-level-db',
    })).toBe('postgres://nested-host/nested-db');
  });

  it('returns undefined when the config carries no address', () => {
    expect(describeDriverConnection(undefined)).toBeUndefined();
    expect(describeDriverConnection({})).toBeUndefined();
    expect(describeDriverConnection({ client: 'pg', connection: '' })).toBeUndefined();
    expect(describeDriverConnection({ client: 'pg', connection: {} })).toBeUndefined();
    // knex lets a host hand back a fresh connection per pool checkout — there
    // is no address to read until it is called, so don't invent one.
    expect(describeDriverConnection({ client: 'pg', connection: () => ({ host: 'h' }) })).toBeUndefined();
  });
});
