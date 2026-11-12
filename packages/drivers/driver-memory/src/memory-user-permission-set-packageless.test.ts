// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, #32164] `sys_user_permission_set`'s key gained its package
 * column — `(user_id, permission_set, permission_set_package,
 * organization_id)`, `unique: 'global'` — and on this driver that is a
 * DECLARED LIMIT, measured here.
 *
 * On SQL and Mongo a runtime guard keeps the grants that name no package to one
 * per `(user_id, permission_set, organization_id)`
 * (`metadata-protocol`'s `user-permission-set-packageless-index.ts`,
 * `driver-mongodb`'s `RUNTIME_OWNED_UNIQUES`). This driver has no raw-SQL seam
 * for metadata-protocol's migration and no runtime-owned uniques, so the guard is
 * not built here (the activation ledger's guard has the same exemption).
 *
 * The epic seat's condition 3 on #32164 asked to MEASURE whether this driver's
 * unique check folds NULLs: if it did, the new key alone would still refuse two
 * package-less grants and no exemption would be needed. It does not — a NULL in
 * any key part exempts the row (`memory-declared-index-unique.test.ts` measures
 * the rule; ADR-0131 D1 retired the organization fold) — so two package-less
 * grants of one set for one user in one organization are ADMITTED. That is the
 * declared limit, stated in the changeset and the PR body; this file asserts the
 * admission so that a future guard seam on this driver turns it red and the
 * limit is withdrawn on purpose, not by accident.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { uniqueConstraintsFromDeclaredIndexes } from './memory-unique-constraint.js';

const OLD_FIELDS = ['user_id', 'permission_set', 'organization_id'];
const NEW_FIELDS = ['user_id', 'permission_set', 'permission_set_package', 'organization_id'];

/** The grant object, reduced to what schema sync reads, under a given unique declaration. */
const grants = (indexes: Array<{ fields: string[]; unique: 'global' | 'organization' }>) => ({
  name: 'sys_user_permission_set',
  fields: {
    id: { type: 'text' },
    user_id: { type: 'text' },
    permission_set: { type: 'text' },
    permission_set_package: { type: 'text' },
    organization_id: { type: 'text' },
  },
  indexes,
});
const current = grants([{ fields: NEW_FIELDS, unique: 'global' }]);
const previous = grants([{ fields: OLD_FIELDS, unique: 'organization' }]);

async function lands(driver: InMemoryDriver, row: Record<string, unknown>): Promise<boolean> {
  try {
    await driver.create('sys_user_permission_set', { user_id: 'u1', permission_set: 'sales_rep', ...row });
    return true;
  } catch {
    return false;
  }
}

describe('[#32164] driver-memory and the grant key that gained its package column (a declared limit)', () => {
  let now: InMemoryDriver;
  let old: InMemoryDriver;

  beforeEach(async () => {
    now = new InMemoryDriver();
    await now.syncSchema('sys_user_permission_set', current);
    old = new InMemoryDriver();
    await old.syncSchema('sys_user_permission_set', previous);
  });

  it('reads both declarations as plain, NULL-distinct column lists', () => {
    expect(uniqueConstraintsFromDeclaredIndexes(current)).toEqual([{ columns: NEW_FIELDS, nullSafeColumns: [] }]);
    // The old 'organization' declaration listed its tenant column, so its parts are the listed columns too.
    expect(uniqueConstraintsFromDeclaredIndexes(previous)).toMatchObject([{ columns: OLD_FIELDS, nullSafeColumns: [] }]);
  });

  it('packaged grants: two packages admitted, one package twice refused (the key working as declared)', async () => {
    expect(await lands(now, { id: 'p1', permission_set_package: 'com.acme.crm', organization_id: 'org_1' })).toBe(true);
    expect(await lands(now, { id: 'p2', permission_set_package: 'com.acme.hr', organization_id: 'org_1' })).toBe(true);
    expect(await lands(now, { id: 'p3', permission_set_package: 'com.acme.crm', organization_id: 'org_1' })).toBe(false);
  });

  it('THE DECLARED LIMIT: two package-less grants of one set in one organization are admitted here, where the old key refused the second', async () => {
    expect(await lands(old, { id: 'a', permission_set_package: null, organization_id: 'org_1' })).toBe(true);
    expect(await lands(old, { id: 'b', permission_set_package: null, organization_id: 'org_1' })).toBe(false);

    expect(await lands(now, { id: 'a', permission_set_package: null, organization_id: 'org_1' })).toBe(true);
    // Measured: the unique check treats the NULL package as distinct. SQL and
    // Mongo refuse this row through their runtime guard; this driver has none.
    expect(await lands(now, { id: 'b', permission_set_package: null, organization_id: 'org_1' })).toBe(true);
    expect(await now.count('sys_user_permission_set')).toBe(2);
  });

  it('CONTROL — a NULL organization was exempt under the old key too', async () => {
    expect(await lands(old, { id: 'z1', permission_set_package: null, organization_id: null })).toBe(true);
    expect(await lands(old, { id: 'z2', permission_set_package: null, organization_id: null })).toBe(true);
  });
});
