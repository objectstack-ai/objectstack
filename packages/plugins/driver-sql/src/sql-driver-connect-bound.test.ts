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
    expect((d as any).knex.client.config.pool.createTimeoutMillis).toBe(10_000);
  });

  it('applies it alongside a host pool config without clobbering min/max', () => {
    const d = make({
      client: 'pg',
      connection: 'postgres://u:p@127.0.0.1:1/d',
      pool: { min: 0, max: 5 },
    });
    const pool = (d as any).knex.client.config.pool;
    expect(pool).toMatchObject({ min: 0, max: 5, createTimeoutMillis: 10_000 });
  });

  it("leaves a host's explicit createTimeoutMillis alone", () => {
    const d = make({
      client: 'pg',
      connection: 'postgres://u:p@127.0.0.1:1/d',
      pool: { min: 0, max: 5, createTimeoutMillis: 45_000 },
    });
    expect((d as any).knex.client.config.pool.createTimeoutMillis).toBe(45_000);
  });

  it('actually bounds a query against a black-holing endpoint', async () => {
    const bh = blackHole();
    const port = await bh.listen();
    try {
      // 700ms so the assertion is decisive: unbounded is 30s.
      const d = make({
        client: 'pg',
        connection: `postgres://u:p@127.0.0.1:${port}/d`,
        pool: { min: 0, max: 2, createTimeoutMillis: 700 },
      });
      const started = Date.now();
      await expect((d as any).knex.raw('SELECT 1')).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      bh.close();
    }
  }, 20_000);

  it('does not disturb a working sqlite connection', async () => {
    const d = make({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await expect(d.checkHealth()).resolves.toBe(true);
  });
});
