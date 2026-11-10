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
 *    (ADR-0131 D1), so no grant here has a NULL organization at all;
 *  - the narrower key as 18.0 built it — `(user_id, permission_set,
 *    COALESCE(organization_id, '__global__'))` under the same generated name,
 *    over a nullable organization column — is the widening arm's to account
 *    for, never an orphan `drop_index` (destructive): KEPT on a table that is
 *    not certified (the COALESCE bucket keeps NULL-organization grants to one,
 *    which neither the wider key nor the guard does), and on a certified one
 *    (ADR-0131 D1: the tenant column holds no NULL, so the two forms are one
 *    constraint) kept until the guard stands, then one SAFE replace. Measured
 *    on the upgrade dogfoods' 18.0 and 18.0.0 fixtures first (#32164).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from './index.js';
import { asPre18TenantColumn } from './pre-18-tenant-column.testkit.js';

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

describe('the narrower key as 18.0 built it (the NULL-safe organization form) — a real SQLite database', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => {
    await driver?.disconnect();
    driver = undefined;
  });

  /** `buildIndexName('sys_user_permission_set', ['user_id', 'permission_set', 'organization_id'], true)`, the 18.0 fixtures' name. */
  const LEGACY = 'uniq_sys_user_permission_set_ac248331';
  const knex = () => (driver as any).knex;
  const indexSql = async (name: string): Promise<string | null> =>
    ((await knex().raw(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`, [name])) as any[])[0]?.sql ?? null;
  const indexOps = async () =>
    ((await driver!.detectManagedDrift()) as any[]).filter((e) => e.table === GRANTS && String(e.op.type).endsWith('_index'));
  const lands = async (id: string, pkg: string | null, org: string | null): Promise<boolean> => {
    try {
      await knex()(GRANTS).insert({ id, user_id: 'u1', permission_set: 'sales_rep', permission_set_package: pkg, organization_id: org });
      return true;
    } catch {
      return false;
    }
  };

  /** An 18.0 database (nullable organization, the COALESCE narrower), booted by this release's declaration. */
  async function from18Point0(): Promise<void> {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await driver.initObjects(grants(OLD_INDEXES) as any);
    await asPre18TenantColumn(driver, GRANTS);
    await knex().raw(`DROP INDEX "${LEGACY}"`);
    await knex().raw(
      `CREATE UNIQUE INDEX "${LEGACY}" ON "${GRANTS}" ("user_id", "permission_set", COALESCE("organization_id", '__global__'))`,
    );
    await driver.initObjects(grants(NEW_INDEXES) as any);
    expect(await indexSql(LEGACY)).toMatch(/COALESCE/);
  }

  it('certified or not, never an orphan drop and nothing destructive (before this arm: a destructive drop_index, the 18.0 upgrade dogfoods red)', async () => {
    await from18Point0();
    for (const certified of [false, true]) {
      driver!.setTenantKeyCertifiedResolver(() => certified);
      const ops = await indexOps();
      expect(ops.some((e) => e.op.type === 'drop_index'), `certified=${certified}`).toBe(false);
      expect(ops.some((e) => e.category === 'destructive'), `certified=${certified}`).toBe(false);
    }
  });

  it('read BEFORE the sync that adds the package column (`os migrate plan` over an 18.0 database): KEPT, never an orphan drop', async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // The 18.0 table: no package column yet, a nullable organization, the COALESCE narrower.
    const [old] = grants(OLD_INDEXES) as Array<{ fields: Record<string, unknown> }>;
    const { permission_set_package: _absent, ...oldFields } = old.fields;
    await driver.initObjects([{ ...old, fields: oldFields }] as any);
    await asPre18TenantColumn(driver, GRANTS);
    await knex().raw(`DROP INDEX "${LEGACY}"`);
    await knex().raw(
      `CREATE UNIQUE INDEX "${LEGACY}" ON "${GRANTS}" ("user_id", "permission_set", COALESCE("organization_id", '__global__'))`,
    );
    for (const certified of [false, true]) {
      driver!.setTenantKeyCertifiedResolver(() => certified);
      const plan = ((await driver!.detectManagedDrift(grants(NEW_INDEXES) as any)) as any[]).filter((e) => e.table === GRANTS);
      expect(plan.filter((e) => e.op.type === 'drop_index' || e.category === 'destructive'), `certified=${certified}`).toEqual([]);
      // Nothing else is offered for this table either: the additive sync adds
      // the column (the plan reports no missing column), and the wider index
      // cannot be offered before its column exists.
      expect(plan, `certified=${certified}`).toEqual([]);
    }
    expect(await indexSql(LEGACY)).toMatch(/COALESCE/);
  });

  it('not certified: KEPT even beside the guard — no replace, no drop — and it still folds NULL-organization grants', async () => {
    await from18Point0();
    driver!.setTenantKeyCertifiedResolver(() => false);
    await knex().raw(GUARD_SQL);
    expect(await indexOps()).toEqual([]);
    expect(await indexSql(LEGACY)).toMatch(/COALESCE/);
    // Everything it refused, it still refuses: a NULL organization included.
    expect(await lands('a', null, null)).toBe(true);
    expect(await lands('b', null, null)).toBe(false);
    expect(await lands('c', null, 'org_1')).toBe(true);
    expect(await lands('d', null, 'org_1')).toBe(false);
  });

  it('certified, no guard yet: KEPT — no replace, no drop', async () => {
    await from18Point0();
    driver!.setTenantKeyCertifiedResolver(() => true);
    expect(await indexOps()).toEqual([]);
    expect(await indexSql(LEGACY)).toMatch(/COALESCE/);
  });

  it('certified, with the guard: one SAFE replace naming it, applied without allowDestructive; re-plan empty; condition 1 on the non-NULL organization', async () => {
    await from18Point0();
    driver!.setTenantKeyCertifiedResolver(() => true);
    await knex().raw(GUARD_SQL);
    const plan = await indexOps();
    expect(plan.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
    expect(plan[0].op.dropIndexNames).toEqual([LEGACY]);
    expect(plan[0].actual).toBe("UNIQUE (user_id, permission_set, COALESCE(organization_id, '__global__'))");
    const { applied, skipped } = await driver!.applyMigrationEntries(plan);
    expect([applied.length, skipped]).toEqual([1, []]);
    expect(await indexSql(LEGACY)).toBeNull();
    expect(await indexOps()).toEqual([]);
    expect(await lands('n1', null, 'org_1')).toBe(true);
    expect(await lands('n2', null, 'org_1')).toBe(false);
    expect(await lands('p1', 'com.acme.crm', 'org_1')).toBe(true);
    expect(await lands('p2', 'com.acme.hr', 'org_1')).toBe(true);
    expect(await lands('p3', 'com.acme.crm', 'org_1')).toBe(false);
  });
});
