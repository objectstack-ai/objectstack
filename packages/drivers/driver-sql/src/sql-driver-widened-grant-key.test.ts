// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, #32164] The grant's key gained its package column:
 * `sys_user_permission_set`'s `(user_id, permission_set, organization_id)`
 * (`unique: 'organization'`, the tenant column listed) became
 * `(user_id, permission_set, permission_set_package, organization_id)`
 * (`unique: 'global'`). The widening arm (`sql-driver-widened-declared-unique.test.ts`
 * holds its rules on the activation ledger) is pinned here on the grant table
 * over a real SQLite database:
 *
 *  - before `metadata-protocol`'s package-less guard stands, the old key is
 *    KEPT — no safe replace and no orphan drop — because the gained column is
 *    nullable and the old key is the only rule keeping package-less grants to
 *    one;
 *  - once the guard stands (the statement `metadata-protocol` runs on SQLite,
 *    verbatim), `os migrate plan` offers one SAFE replace; applied without
 *    `allowDestructive`, the re-plan is empty, and the grants answer as the
 *    epic seat's condition 1 asks: a second package-less grant in one
 *    organization refused, two packages admitted, one package twice refused.
 *    The organization column is NOT NULL on a table this driver builds
 *    (ADR-0131 D1), so no grant here has a NULL organization at all.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from './index.js';

const GRANTS = 'sys_user_permission_set';
const GUARD_NAME = 'uniq_sys_user_permission_set_packageless';
/** `buildUserPermissionSetPackagelessIndexSql(undefined)` in metadata-protocol, verbatim. */
const GUARD_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS ${GUARD_NAME} ON ${GRANTS} (user_id, permission_set, organization_id) ` +
  'WHERE permission_set_package IS NULL';

const OLD_INDEXES = [{ fields: ['user_id', 'permission_set', 'organization_id'], unique: 'organization' as const }];
const NEW_INDEXES = [
  { fields: ['user_id', 'permission_set', 'permission_set_package', 'organization_id'], unique: 'global' as const },
];

const grants = (indexes: unknown[]) => [{
  name: GRANTS,
  fields: {
    user_id: { type: 'text', required: true },
    permission_set: { type: 'text', required: true },
    permission_set_package: { type: 'text' },
    organization_id: { type: 'text' },
  },
  indexes,
}];

describe('the grant key widened by its package column — a real SQLite database', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => {
    await driver?.disconnect();
    driver = undefined;
  });

  const uniqueIndexes = async (): Promise<Array<{ name: string; sql: string | null }>> =>
    (driver as any).knex.raw(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${GRANTS}' AND name LIKE 'uniq_%' ORDER BY name`,
    );
  const columnsOf = (sql: string | null) => /\(([^)]*)\)/.exec(sql ?? '')?.[1]?.replace(/`/g, '') ?? '';
  const drift = async () => ((await driver!.detectManagedDrift()) as any[]).filter((e) => e.table === GRANTS);

  async function upgraded(): Promise<{ oldName: string; newName: string }> {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // The database an earlier release built…
    await driver.initObjects(grants(OLD_INDEXES) as any);
    const before = await uniqueIndexes();
    expect(before.map((i) => columnsOf(i.sql))).toEqual(['user_id, permission_set, organization_id']);
    // …booted by this release's declaration.
    await driver.initObjects(grants(NEW_INDEXES) as any);
    const after = await uniqueIndexes();
    const newName = after.find((i) => columnsOf(i.sql) === 'user_id, permission_set, permission_set_package, organization_id')?.name;
    expect(newName).toBeTruthy();
    return { oldName: before[0].name, newName: newName! };
  }

  it('without the package-less guard the old key is KEPT: no replace, no orphan drop', async () => {
    const { oldName } = await upgraded();
    const plan = await drift();
    expect(plan.some((e) => e.op.type === 'replace_unique_index')).toBe(false);
    expect(plan.some((e) => e.op.type === 'drop_index')).toBe(false);
    expect((await uniqueIndexes()).map((i) => i.name)).toContain(oldName);
    // Still refusing what it refused.
    const k = (driver as any).knex;
    await k(GRANTS).insert({ id: 'a', user_id: 'u1', permission_set: 'sales_rep', organization_id: 'org_1' });
    await expect(
      k(GRANTS).insert({ id: 'b', user_id: 'u1', permission_set: 'sales_rep', organization_id: 'org_1' }),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('with the guard: one SAFE replace, applied without allowDestructive; re-plan empty; condition 1 holds', async () => {
    const { oldName, newName } = await upgraded();
    await (driver as any).knex.raw(GUARD_SQL);

    const plan = await drift();
    expect(plan.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
    expect(plan[0].op).toMatchObject({ dropIndexNames: [oldName], createIndexName: newName });
    expect(plan[0].message).toContain('permission_set_package is nullable');

    const { applied, skipped } = await driver!.applyMigrationEntries(plan);
    expect([applied.length, skipped]).toEqual([1, []]);
    expect((await uniqueIndexes()).map((i) => i.name).sort()).toEqual([GUARD_NAME, newName].sort());
    expect(await drift()).toEqual([]);

    const k = (driver as any).knex;
    const lands = async (id: string, pkg: string | null, org: string | null): Promise<boolean> => {
      try {
        await k(GRANTS).insert({ id, user_id: 'u1', permission_set: 'sales_rep', permission_set_package: pkg, organization_id: org });
        return true;
      } catch {
        return false;
      }
    };
    expect(await lands('n1', null, 'org_1')).toBe(true);
    expect(await lands('n2', null, 'org_1')).toBe(false);
    expect(await lands('p1', 'com.acme.crm', 'org_1')).toBe(true);
    expect(await lands('p2', 'com.acme.hr', 'org_1')).toBe(true);
    expect(await lands('p3', 'com.acme.crm', 'org_1')).toBe(false);
    // The tenant column is NOT NULL on a table this driver builds (ADR-0131 D1),
    // under the old key and the new alike, so the NULL-organization case of
    // condition 1 cannot arise here; metadata-protocol's raw-table pins measure it.
    await expect(
      k(GRANTS).insert({ id: 'z1', user_id: 'u1', permission_set: 'sales_rep', organization_id: null }),
    ).rejects.toThrow(/NOT NULL constraint failed: sys_user_permission_set\.organization_id/);

    // A second boot of this release leaves everything as it is.
    await driver!.initObjects(grants(NEW_INDEXES) as any);
    expect(await drift()).toEqual([]);
  });
});
