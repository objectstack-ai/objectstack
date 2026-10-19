// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7 · #23429] `listPhysicalColumns` reads the table's catalog: the
 * declared columns and any a past release left behind — which the metadata
 * family's legacy-organization read (`@objectstack/metadata-core`'s
 * `readLegacyOrganizationRows`) asks on every boot, without `execute()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';

const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'lpc_family';

describe('SqlDriver.listPhysicalColumns', () => {
  let driver: SqlDriver;
  const knex = () => (driver as unknown as { knex: Knex }).knex;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([{ name: TABLE, fields: { name: { type: 'string' } } }]);
    await driver.create(TABLE, { id: 'env_1', name: 'environment' }, BYPASS);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it('answers the declared columns', async () => {
    const columns = await driver.listPhysicalColumns(TABLE);
    expect(columns).toEqual(expect.arrayContaining(['id', 'name']));
    expect(columns).not.toContain('organization_id');
  });

  it('answers [] for a table that does not exist', async () => {
    expect(await driver.listPhysicalColumns('lpc_no_such_table')).toEqual([]);
  });

  it('answers a column a past release left behind', async () => {
    await knex().raw(`ALTER TABLE ${TABLE} ADD COLUMN organization_id TEXT`);
    expect(await driver.listPhysicalColumns(TABLE)).toContain('organization_id');
  });

  it('joins the caller\'s transaction (a single-connection pool would otherwise wait on it)', async () => {
    const columns = await knex().transaction(async (trx) => driver.listPhysicalColumns(TABLE, { transaction: trx } as DriverOptions));
    expect(columns).toContain('organization_id');
  });
});
