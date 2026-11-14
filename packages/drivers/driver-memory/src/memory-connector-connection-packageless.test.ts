// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4 and D8 row R11, #31699] `sys_connector_connection`'s key gained
 * its package column — `(organization_id, connector_package, connector_name)`,
 * `unique: 'global'` — and on this driver that is a DECLARED LIMIT, measured
 * here, as the grant key's is (`memory-user-permission-set-packageless.test.ts`).
 *
 * On SQL and Mongo a runtime guard keeps the connections that name no package to
 * one per organization and instance (`metadata-protocol`'s
 * `connector-connection-packageless-index.ts`, `driver-mongodb`'s
 * `RUNTIME_OWNED_UNIQUES`). This driver has no raw-SQL seam for that migration
 * and no runtime-owned uniques, so the guard is not built here, and a NULL key
 * part exempts a row from the declared key: two package-less connections of one
 * instance in one organization are ADMITTED. This file asserts the admission so
 * that a future guard seam on this driver turns it red and the limit is
 * withdrawn on purpose, not by accident. The connection store is the table's one
 * writer and reads before it writes (`service-automation`'s
 * `connector-connections.ts`: a connect updates the row it finds), so it writes
 * no second row of a connected instance on any driver.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { uniqueConstraintsFromDeclaredIndexes } from './memory-unique-constraint.js';

const TABLE = 'sys_connector_connection';
const NEW_FIELDS = ['organization_id', 'connector_package', 'connector_name'];

/** The connection object, reduced to what schema sync reads, under a given unique declaration. */
const connections = (indexes: Array<{ fields: string[]; unique: 'global' | 'organization' }>) => ({
  name: TABLE,
  fields: {
    id: { type: 'text' },
    organization_id: { type: 'text' },
    connector_name: { type: 'text' },
    connector_package: { type: 'text' },
  },
  indexes,
});
const current = connections([{ fields: NEW_FIELDS, unique: 'global' }]);
// The earlier declaration listed no organization column; on this driver it was read as the listed column alone.
const previous = connections([{ fields: ['connector_name'], unique: 'organization' }]);

async function lands(driver: InMemoryDriver, row: Record<string, unknown>): Promise<boolean> {
  try {
    await driver.create(TABLE, { organization_id: 'org_1', connector_name: 'github', ...row });
    return true;
  } catch {
    return false;
  }
}

describe('[#31699] driver-memory and the connection key that gained its package column (a declared limit)', () => {
  let now: InMemoryDriver;
  let old: InMemoryDriver;

  beforeEach(async () => {
    now = new InMemoryDriver();
    await now.syncSchema(TABLE, current);
    old = new InMemoryDriver();
    await old.syncSchema(TABLE, previous);
  });

  it('reads the declaration as a plain, NULL-distinct column list', () => {
    expect(uniqueConstraintsFromDeclaredIndexes(current)).toEqual([{ columns: NEW_FIELDS, nullSafeColumns: [] }]);
  });

  it('packaged connections: two packages admitted, one package twice refused (the key working as declared)', async () => {
    expect(await lands(now, { id: 'p1', connector_package: 'com.acme.crm' })).toBe(true);
    expect(await lands(now, { id: 'p2', connector_package: 'com.acme.hr' })).toBe(true);
    expect(await lands(now, { id: 'p3', connector_package: 'com.acme.crm' })).toBe(false);
  });

  it('THE DECLARED LIMIT: two package-less connections of one instance in one organization are admitted here, where the old key refused the second', async () => {
    expect(await lands(old, { id: 'a', connector_package: null })).toBe(true);
    expect(await lands(old, { id: 'b', connector_package: null })).toBe(false);

    expect(await lands(now, { id: 'a', connector_package: null })).toBe(true);
    // Measured: the NULL package is distinct. SQL and Mongo refuse this row through their runtime guard.
    expect(await lands(now, { id: 'b', connector_package: null })).toBe(true);
    expect(await now.count(TABLE)).toBe(2);
  });
});
