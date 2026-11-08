// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31327] The `mssql` arm of the datasource driver factory: what reaches the
 * `tedious` connection from a federated SQL Server datasource.
 *
 * Read off `buildMssqlConnection`, the leaf module the factory's `mssql` arm
 * hands to `SqlDriver` as the knex `mssql` client's `connection`. Each case is
 * one key of `MssqlConfigSchema` (or the resolved datasource-level `ssl`
 * value, or the bound secret) arriving under the name the knex `mssql` client
 * hands tedious. The module imports no driver package, so this file loads
 * none (`check:test-source-alias`, `check:driver-memory-census`).
 */

import { describe, expect, it } from 'vitest';
import type { DatasourceConnectionSpec } from '../contracts/index.js';
import { buildMssqlConnection } from '../mssql-driver-config.js';

const BOUND_SECRET = 's3cr3t-from-sys_secret';

const spec = (over: Record<string, unknown>): DatasourceConnectionSpec =>
  ({ name: 'erp', driver: 'mssql', schemaMode: 'external', ...over }) as unknown as DatasourceConnectionSpec;

describe('[#31327] mssql — the tedious connection built from the datasource', () => {
  it('maps the discrete fields onto the knex mssql connection, the bound secret as password', () => {
    expect(
      buildMssqlConnection(
        spec({ config: { host: 'erp-db.internal', port: 1433, database: 'ERP', username: 'objectstack_ro' }, secret: BOUND_SECRET }),
        undefined,
      ),
    ).toEqual({
      server: 'erp-db.internal',
      port: 1433,
      database: 'ERP',
      user: 'objectstack_ro',
      password: BOUND_SECRET,
    });
  });

  it('leaves tedious its own TLS default when nothing about TLS is declared', () => {
    const got = buildMssqlConnection(spec({ config: { host: 'h', database: 'ERP' } }), undefined);
    expect(got.options).toBeUndefined();
    expect(got.password).toBeUndefined();
  });

  it('ssl false turns encrypt off; a named instance reaches tedious as instanceName', () => {
    const got = buildMssqlConnection(spec({ config: { host: 'h', database: 'ERP', instanceName: 'SQLEXPRESS' } }), false);
    expect(got.options).toEqual({ encrypt: false, instanceName: 'SQLEXPRESS' });
  });

  it('the ssl block: rejectUnauthorized false is trustServerCertificate, a CA rides in cryptoCredentialsDetails', () => {
    const got = buildMssqlConnection(spec({ config: { host: 'h', database: 'ERP' } }), {
      rejectUnauthorized: false,
      ca: 'PEM',
    });
    expect(got.options).toEqual({
      encrypt: true,
      trustServerCertificate: true,
      cryptoCredentialsDetails: { ca: 'PEM' },
    });
  });
});
