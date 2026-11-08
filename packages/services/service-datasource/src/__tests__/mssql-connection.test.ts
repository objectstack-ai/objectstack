// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31327] The `mssql` arm of the datasource driver factory: what reaches the
 * `tedious` connection from a federated SQL Server datasource.
 *
 * Read off the built driver's own knex config, with no server: knex's `mssql`
 * client builds offline. Each case is one key of `MssqlConfigSchema` (or the
 * datasource-level `ssl` block / bound secret) arriving under the name the
 * knex `mssql` client hands tedious.
 */

import { describe, expect, it } from 'vitest';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const factory = () => createDefaultDatasourceDriverFactory({ dev: false });

const BOUND_SECRET = 's3cr3t-from-sys_secret';

async function built(spec: Record<string, unknown>): Promise<{ client: unknown; connection: any; dialect: unknown }> {
  const handle: any = await factory().create({
    driver: 'mssql',
    schemaMode: 'external',
    ...spec,
  } as any);
  try {
    const driver = handle.driver ?? handle;
    const config = driver.config ?? {};
    return { client: config.client, connection: config.connection, dialect: driver.dialectName };
  } finally {
    try { await handle.disconnect?.(); } catch { /* noop */ }
  }
}

describe('[#31327] mssql — the factory builds SqlDriver over the tedious connection', () => {
  it('maps the discrete fields onto the knex mssql connection, the bound secret as password', async () => {
    const got = await built({
      name: 'erp',
      config: { host: 'erp-db.internal', port: 1433, database: 'ERP', username: 'objectstack_ro' },
      secret: BOUND_SECRET,
    });
    expect(got.client).toBe('mssql');
    expect(got.dialect).toBe('mssql');
    expect(got.connection).toMatchObject({
      server: 'erp-db.internal',
      port: 1433,
      database: 'ERP',
      user: 'objectstack_ro',
      password: BOUND_SECRET,
    });
  });

  it('leaves tedious its own TLS default when nothing about TLS is declared', async () => {
    const got = await built({ name: 'erp', config: { host: 'h', database: 'ERP' } });
    expect(got.connection.options).toBeUndefined();
    expect(got.connection.password).toBeUndefined();
  });

  it('config.ssl: false turns encrypt off; a named instance reaches tedious as instanceName', async () => {
    const got = await built({ name: 'erp', config: { host: 'h', database: 'ERP', ssl: false, instanceName: 'SQLEXPRESS' } });
    expect(got.connection.options).toEqual({ encrypt: false, instanceName: 'SQLEXPRESS' });
  });

  it('the ssl block: rejectUnauthorized false is trustServerCertificate, a CA rides in cryptoCredentialsDetails', async () => {
    const got = await built({
      name: 'erp',
      config: { host: 'h', database: 'ERP' },
      ssl: { enabled: true, rejectUnauthorized: false, ca: 'PEM' },
    });
    expect(got.connection.options).toEqual({
      encrypt: true,
      trustServerCertificate: true,
      cryptoCredentialsDetails: { ca: 'PEM' },
    });
  });
});
