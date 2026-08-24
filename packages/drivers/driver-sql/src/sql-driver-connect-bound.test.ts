// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3769: a database endpoint that accepts the TCP connection but never
// completes the handshake (overloaded instance, half-open firewall, LB mid-
// failover) makes every query WAIT rather than fail. Left to tarn's default that
// wait is 30s per query on the request path. SqlDriver now bounds it by default,
// while leaving a host's own choice alone.

import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { SqlDriver } from './sql-driver.js';

/** A listener that accepts sockets and then says nothing, ever. */
function blackHole() {
  const held: net.Socket[] = [];
  const server = net.createServer((sock) => { sock.on('error', () => {}); held.push(sock); });
  return {
    listen: () => new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
    }),
    close: () => { held.forEach((s) => s.destroy()); server.close(); },
  };
}

const drivers: SqlDriver[] = [];
const make = (cfg: any) => { const d = new SqlDriver(cfg); drivers.push(d); return d; };

afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect().catch(() => {})));
});

describe('SqlDriver — connection-attempt bound (framework#3769)', () => {
  it('applies a default createTimeoutMillis when the host sets no pool config', () => {
    const d = make({ client: 'pg', connection: 'postgres://u:p@127.0.0.1:1/d' });
    expect((d as any).knex.client.config.pool.createTimeoutMillis).toBe(15_000);
  });

  it('applies it alongside a host pool config without clobbering min/max', () => {
    const d = make({
      client: 'pg',
      connection: 'postgres://u:p@127.0.0.1:1/d',
      pool: { min: 0, max: 5 },
    });
    const pool = (d as any).knex.client.config.pool;
    expect(pool).toMatchObject({ min: 0, max: 5, createTimeoutMillis: 15_000 });
  });

  it("leaves a host's explicit createTimeoutMillis alone", () => {
    const d = make({
      client: 'pg',
      connection: 'postgres://u:p@127.0.0.1:1/d',
      pool: { min: 0, max: 5, createTimeoutMillis: 45_000 },
    });
    expect((d as any).knex.client.config.pool.createTimeoutMillis).toBe(45_000);
  });

  // The pool bound stops the wait but knex blames "the pool is probably full".
  // Each network dialect also gets its OWN connect timeout so the message names
  // the network instead — `timeout expired` (pg) / `connect ETIMEDOUT` (mysql2).
  describe('per-dialect connect timeout (accurate diagnosis)', () => {
    it('moves a pg URL into connectionString and rides the timeout alongside it', () => {
      const d = make({ client: 'pg', connection: 'postgres://u:p@host:5432/d' });
      expect((d as any).knex.client.config.connection).toEqual({
        connectionString: 'postgres://u:p@host:5432/d',
        connectionTimeoutMillis: 10_000,
      });
    });

    it('moves a mysql2 URL into uri with the mysql2 spelling of the timeout', () => {
      const d = make({ client: 'mysql2', connection: 'mysql://u:p@host:3306/d' });
      expect((d as any).knex.client.config.connection).toEqual({
        uri: 'mysql://u:p@host:3306/d',
        connectTimeout: 10_000,
        // #3942 — mysql2 renders a bound `Date` and parses a returned DATETIME in
        // `connection.timezone`, which defaults to the HOST's local zone. Pinned
        // to UTC so the recorded instant cannot depend on which machine wrote it.
        timezone: 'Z',
      });
    });

    it('pins MySQL to UTC on both layers, and leaves an explicit choice alone (#3942)', () => {
      const pinned = make({ client: 'mysql2', connection: { host: 'db', database: 'app' } });
      expect((pinned as any).knex.client.config.connection.timezone).toBe('Z');
      // The server side is the other half: `@@session.time_zone` decides how a
      // zone-naive literal is read for a legacy TIMESTAMP column, and what
      // CURRENT_TIMESTAMP renders. Measured 8h off on a `+08:00` server.
      expect(typeof (pinned as any).knex.client.config.pool.afterCreate).toBe('function');

      const explicit = make({
        client: 'mysql2',
        connection: { host: 'db', database: 'app', timezone: '+08:00' },
      });
      expect((explicit as any).knex.client.config.connection.timezone).toBe('+08:00');
    });

    it('does not touch the connection timezone on non-MySQL dialects', () => {
      // Postgres resolves an explicit-offset literal itself and SQLite has no
      // session zone at all, so neither needs (or should get) the mysql2 knob.
      for (const client of ['pg', 'better-sqlite3']) {
        const d = make({ client, connection: { host: 'db', database: 'app', filename: ':memory:' } });
        expect((d as any).knex.client.config.connection.timezone).toBeUndefined();
      }
    });

    it('adds the timeout to an object connection without disturbing its fields', () => {
      const d = make({
        client: 'pg',
        connection: { host: 'db.example.com', port: 5432, user: 'admin', database: 'app', ssl: true },
      });
      expect((d as any).knex.client.config.connection).toEqual({
        host: 'db.example.com', port: 5432, user: 'admin', database: 'app', ssl: true,
        connectionTimeoutMillis: 10_000,
      });
    });

    it("leaves a host's explicit connect timeout alone", () => {
      const d = make({
        client: 'pg',
        connection: { host: 'db.example.com', connectionTimeoutMillis: 60_000 },
      });
      expect((d as any).knex.client.config.connection.connectionTimeoutMillis).toBe(60_000);
    });

    it('injects nothing for sqlite — a file open has no handshake to time out', () => {
      const d = make({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
      expect((d as any).knex.client.config.connection).toEqual({ filename: ':memory:' });
    });

    // #11784 — `redshift` reaches the server through the `pg` driver (knex's
    // `Client_Redshift extends Client_PG`), so it HAS `connectionTimeoutMillis`
    // and obeys it; it just carried no DIALECT_CONNECT_TIMEOUT row, so nothing
    // was injected and the attempt fell through to the strictly looser 15s pool
    // backstop. Nothing errored and nothing was logged — the before-state is
    // silence, so "it works" is not evidence and the INJECTED CONFIG is pinned.
    //
    // The two controls are load-bearing. `pg` already had a row, so a broken
    // injection path fails them together instead of looking redshift-specific;
    // `better-sqlite3` legitimately has none (a file open has no handshake), so
    // an injector that stopped reading the table and timed everything would be
    // caught rather than read as a pass.
    it('bounds a redshift connect attempt at the dialect timeout, not the pool backstop (#11784)', () => {
      const injected = (client: string, connection: any) =>
        (make({ client, connection, useNullAsDefault: true }) as any).knex.client.config.connection;

      // subject — URL form moves into the pg URL slot with the timeout alongside
      expect(injected('redshift', 'postgres://u:p@host:5439/d')).toEqual({
        connectionString: 'postgres://u:p@host:5439/d',
        connectionTimeoutMillis: 10_000,
      });
      // subject — object form gains the key and disturbs nothing else
      expect(injected('redshift', { host: 'wh.eu-west-1.redshift.amazonaws.com', port: 5439, database: 'dev' }))
        .toEqual({
          host: 'wh.eu-west-1.redshift.amazonaws.com', port: 5439, database: 'dev',
          connectionTimeoutMillis: 10_000,
        });

      // positive control — a client that already had a row
      expect(injected('pg', { host: 'db', database: 'app' }).connectionTimeoutMillis).toBe(10_000);
      // negative control — a dialect that legitimately has no such knob
      expect(injected('better-sqlite3', { filename: ':memory:' }).connectionTimeoutMillis).toBeUndefined();

      // The two bounds must not be equal (knex wins a tie and the accurate
      // message is never seen). Redshift now takes the strict 10s dialect bound
      // with the 15s pool value still strictly looser behind it — which is the
      // whole of what #11784 restores.
      const d = make({ client: 'redshift', connection: 'postgres://u:p@host:5439/d' });
      expect((d as any).knex.client.config.pool.createTimeoutMillis).toBe(15_000);
    });

    it("leaves a redshift host's own explicit connect timeout alone (#11784)", () => {
      const d = make({
        client: 'redshift',
        connection: { host: 'wh.redshift.amazonaws.com', connectionTimeoutMillis: 60_000 },
      });
      expect((d as any).knex.client.config.connection.connectionTimeoutMillis).toBe(60_000);
    });

    it('leaves a function-valued connection alone — the host builds each one itself', () => {
      const provider = () => ({ host: 'x' });
      const d = make({ client: 'pg', connection: provider });
      expect((d as any).knex.client.config.connection).toBe(provider);
    });
  });

  // `driver.config` is load-bearing for two readers that predate this change:
  // serve.ts's startup banner (`describeRegisteredDriver` reads conn.host /
  // conn.filename) and `createDatabase()` (parses the URL to swap in the
  // maintenance database). Both would break on the rewritten shape, so the
  // rewrite must apply to what knex receives — never to what the author gave us.
  it('keeps driver.config in the shape the author passed', () => {
    const d = make({ client: 'pg', connection: 'postgres://u:p@host:5432/d', pool: { min: 0, max: 5 } });
    expect((d as any).config.connection).toBe('postgres://u:p@host:5432/d');
    expect((d as any).config.pool).toEqual({ min: 0, max: 5 });
  });

  it('actually bounds a query against a black-holing endpoint', async () => {
    const bh = blackHole();
    const port = await bh.listen();
    try {
      // The default is 10s; unbounded would be knex/tarn's 30s.
      const d = make({
        client: 'pg',
        connection: `postgres://u:p@127.0.0.1:${port}/d`,
        pool: { min: 0, max: 2 },
      });
      const started = Date.now();
      const err = await (d as any).knex.raw('SELECT 1').then(
        () => { throw new Error('query resolved but should have failed'); },
        (e: Error) => e,
      );
      const elapsed = Date.now() - started;

      // The pg-level timeout fires first (10s), so the message names the
      // connection attempt rather than blaming pool sizing. Guarding against
      // the regression is the point: knex's own wording would send an operator
      // to tune `pool.max` while the network is what is broken.
      expect(err.message).toContain('timeout expired');
      expect(err.message).not.toContain('pool is probably full');
      expect(elapsed).toBeGreaterThan(8_000);
      expect(elapsed).toBeLessThan(20_000);
    } finally {
      bh.close();
    }
  }, 40_000);

  it('does not disturb a working sqlite connection', async () => {
    const d = make({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await expect(d.checkHealth()).resolves.toBe(true);
  });
});
