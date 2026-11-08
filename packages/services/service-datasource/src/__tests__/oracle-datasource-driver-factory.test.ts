// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31328 — the shared driver factory's `oracle` arm (ADR-0015 §4.6): oracle is
 * a federation dialect of the shared SQL driver, knex `oracledb` over
 * node-oracledb in Thin mode. Construction only: no socket is opened, so no
 * Oracle server is needed for these pins.
 */

import { describe, it, expect, vi } from 'vitest';
// The factory reaches the SQL driver through a lazy `await import()`; its
// first load is paid here, at collection, never inside a clocked case.
import '@objectstack/driver-sql';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

// No case here builds a memory datasource; the factory's lazy memory arm is
// stubbed rather than loaded.
vi.mock('@objectstack/driver-memory', () => ({}));

const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

const connectionOf = (handle: any) => {
  const driver = handle.driver ?? handle;
  return (driver?.config ?? driver?.knexConfig ?? {}).connection;
};

describe('createDefaultDatasourceDriverFactory — oracle construction (#31328)', () => {
  it('supports the oracle id and its oracledb alias', () => {
    expect(factory().supports('oracle')).toBe(true);
    expect(factory().supports('oracledb')).toBe(true);
  });

  it('composes the Easy Connect string from host / port / serviceName; the password is the bound secret', async () => {
    const handle: any = await factory().create({
      driver: 'oracle',
      config: { host: 'ora.internal', serviceName: 'FREEPDB1', username: 'app' },
      secret: 's3cret',
      schemaMode: 'external',
    });
    const driver = handle.driver ?? handle;
    expect(driver?.constructor?.name).toMatch(/SqlDriver$/);
    expect(connectionOf(handle)).toEqual({ connectString: 'ora.internal:1521/FREEPDB1', user: 'app', password: 's3cret' });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('passes a declared connectString through verbatim (a tcps:// string is how TLS is chosen)', async () => {
    const handle: any = await factory().create({
      driver: 'oracle',
      config: { connectString: 'tcps://ora.internal:2484/FREEPDB1', host: 'ignored', serviceName: 'ignored', username: 'app' },
      schemaMode: 'external',
    });
    expect(connectionOf(handle)).toEqual({ connectString: 'tcps://ora.internal:2484/FREEPDB1', user: 'app' });
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });

  it('refuses a datasource `ssl` block that asks for TLS — node-oracledb Thin has no slot for it', async () => {
    for (const ssl of [{ enabled: true, ca: 'CA-PEM' }, { ca: 'CA-PEM' }, { rejectUnauthorized: false }]) {
      await expect(factory().create({
        name: 'erp',
        driver: 'oracle',
        config: { host: 'ora.internal', serviceName: 'FREEPDB1', username: 'app' },
        ssl,
        schemaMode: 'external',
      } as any), JSON.stringify(ssl)).rejects.toThrow(/datasource 'erp': the oracle driver does not read a datasource `ssl` block.*tcps:\/\//s);
    }
  });

  it("a block that asks for nothing is not refused — the parsed defaults (`enabled: false`, `rejectUnauthorized: true`)", async () => {
    const handle: any = await factory().create({
      driver: 'oracle',
      config: { host: 'ora.internal', serviceName: 'FREEPDB1', username: 'app' },
      ssl: { enabled: false, rejectUnauthorized: true },
      schemaMode: 'external',
    } as any);
    expect(connectionOf(handle).connectString).toBe('ora.internal:1521/FREEPDB1');
    try { await handle.disconnect?.(); } catch { /* pool never opened */ }
  });
});
