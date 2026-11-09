// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R1, R3] The permission-set package backfill, measured on a
 * REAL `ObjectQL` engine over a real SQL driver (better-sqlite3 `:memory:`),
 * so the null filter, the keyset walk and the single-column write are the
 * driver's own answers, not a double's.
 *
 * The holders come from a stand-in registry carrying the three holder reads
 * the one rule (`resolvePackageScopedHolders`, `@objectstack/core`) is asked
 * over. A stand-in is what lets a name be held by TWO packages here: phase 1
 * refuses that at registration on a real registry, and the ambiguous set is
 * exactly what a pre-phase-1 clash left behind.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysAudienceBindingSuggestion } from './objects/sys-audience-binding-suggestion.object.js';
import {
  STORED_PERMISSION_SET_REFERENCES,
  backfillStoredPermissionSetPackages,
  backfillStoredPermissionSetPackagesAtBoot,
  permissionSetHolderOf,
  type PermissionSetHolderRegistry,
} from './stored-permission-set-package-backfill.js';

const ORG = 'org_a';
const SYS_ORG = { isSystem: true, tenantId: ORG } as const;
const SYSTEM_CTX = { isSystem: true } as const;

const [GRANTS, SUGGESTIONS] = STORED_PERMISSION_SET_REFERENCES;

/** Package ids, and the permission-set names each holder holds. */
const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';
const ONE_HOLDER = 'crm_sales_rep';
const TWO_HOLDERS = 'shared_reader';
const ENV_SET = 'env_auditor';
const NOBODY = 'retired_set';

/**
 * A registry holding: `crm_sales_rep` by CRM alone; `shared_reader` by CRM and
 * HR (a pre-phase-1 clash); `env_auditor` by the environment alone.
 */
function standInRegistry(): PermissionSetHolderRegistry {
  const packageHolders: Record<string, string[]> = { [ONE_HOLDER]: [CRM], [TWO_HOLDERS]: [CRM, HR] };
  return {
    packageScopedHoldersOf: (_type, name) => packageHolders[name] ?? [],
    getPackageScopedItem: (_type, name, packageId) =>
      (packageHolders[name] ?? []).includes(packageId) ? { name, _packageId: packageId } : undefined,
    getEnvironmentScopedItem: (_type, name) => (name === ENV_SET ? { name } : undefined),
    getPackage: () => undefined,
    getAllPackages: () => [],
  } as PermissionSetHolderRegistry;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.permission-set-package-backfill',
    name: 'Permission-set package backfill',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPermissionSet, SysAudienceBindingSuggestion],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

const grant = (id: string, permissionSet: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: `u_${id}`, permission_set: permissionSet, organization_id: ORG, ...extra,
});

async function seedGrants(engine: ObjectQL): Promise<void> {
  for (const row of [
    grant('g1', ONE_HOLDER),
    grant('g2', ONE_HOLDER),
    grant('g3', TWO_HOLDERS),
    grant('g4', ENV_SET),
    grant('g5', NOBODY),
    // Already names a package: never read as a candidate, never moved.
    grant('g6', ONE_HOLDER, { permission_set_package: 'com.acme.elsewhere' }),
  ]) {
    await engine.insert(GRANTS.object, row, { context: SYS_ORG });
  }
}

async function packagesById(engine: ObjectQL, object: string): Promise<Record<string, unknown>> {
  const rows = (await engine.find(object, { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
  return Object.fromEntries(rows.map((r) => [String(r.id), r.permission_set_package ?? null]));
}

describe('R1 — a grant gains the package that holds its permission set', () => {
  it('a name one package holds is bound to it; every other row is left naming no package', async () => {
    const engine = await boot();
    await seedGrants(engine);

    const report = await backfillStoredPermissionSetPackages(engine, GRANTS, permissionSetHolderOf(standInRegistry()));

    expect(await packagesById(engine, GRANTS.object)).toEqual({
      g1: CRM,
      g2: CRM,
      g3: null,
      g4: null,
      g5: null,
      g6: 'com.acme.elsewhere',
    });
    expect(report.bound).toEqual([{ name: ONE_HOLDER, rows: 2, packageId: CRM }]);
  });

  it('a name two packages hold is left null and reported naming BOTH, never bound to the first', async () => {
    const engine = await boot();
    await seedGrants(engine);

    const report = await backfillStoredPermissionSetPackages(engine, GRANTS, permissionSetHolderOf(standInRegistry()));

    expect(report.ambiguous).toHaveLength(1);
    expect(report.ambiguous[0].name).toBe(TWO_HOLDERS);
    expect(report.ambiguous[0].rows).toBe(1);
    expect(report.ambiguous[0].candidates).toHaveLength(2);
    expect(report.ambiguous[0].candidates.join(' ')).toContain(CRM);
    expect(report.ambiguous[0].candidates.join(' ')).toContain(HR);
    expect((await packagesById(engine, GRANTS.object)).g3).toBeNull();
  });

  it('a name no package holds is left null and reported; the environment\'s own set is left null as its spelling', async () => {
    const engine = await boot();
    await seedGrants(engine);

    const report = await backfillStoredPermissionSetPackages(engine, GRANTS, permissionSetHolderOf(standInRegistry()));

    expect(report.unheld).toEqual([{ name: NOBODY, rows: 1 }]);
    expect(report.unpackaged).toEqual([{ name: ENV_SET, rows: 1, holder: 'environment' }]);
  });

  it('a second run writes no row and reports the same ambiguous and unheld names', async () => {
    const engine = await boot();
    await seedGrants(engine);
    const holderOf = permissionSetHolderOf(standInRegistry());
    const first = await backfillStoredPermissionSetPackages(engine, GRANTS, holderOf);

    const update = vi.spyOn(engine, 'update');
    const second = await backfillStoredPermissionSetPackages(engine, GRANTS, holderOf);

    expect(update).not.toHaveBeenCalled();
    expect(second.bound).toEqual([]);
    expect(second.ambiguous).toEqual(first.ambiguous);
    expect(second.unheld).toEqual(first.unheld);
    expect(second.unpackaged).toEqual(first.unpackaged);
  });

  it('a dry run reports what it would bind and writes nothing', async () => {
    const engine = await boot();
    await seedGrants(engine);
    const update = vi.spyOn(engine, 'update');

    const report = await backfillStoredPermissionSetPackages(engine, GRANTS, permissionSetHolderOf(standInRegistry()), { dryRun: true });

    expect(update).not.toHaveBeenCalled();
    expect(report.bound).toEqual([{ name: ONE_HOLDER, rows: 2, packageId: CRM }]);
    expect((await packagesById(engine, GRANTS.object)).g1).toBeNull();
  });

  it('writes only the package column: the grant\'s other columns are untouched', async () => {
    const engine = await boot();
    await seedGrants(engine);
    const before = (await engine.find(GRANTS.object, { where: { id: 'g1' }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;

    await backfillStoredPermissionSetPackages(engine, GRANTS, permissionSetHolderOf(standInRegistry()));

    const after = (await engine.find(GRANTS.object, { where: { id: 'g1' }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    const { permission_set_package: added, updated_at: _a, ...rest } = after[0];
    const { permission_set_package: was, updated_at: _b, ...restBefore } = before[0];
    expect(was ?? null).toBeNull();
    expect(added).toBe(CRM);
    expect(rest).toEqual(restBefore);
  });
});

describe('R3 — a suggestion gains the package that holds its permission set', () => {
  const suggestion = (id: string, packageId: string, name: string) => ({
    id, package_id: packageId, permission_set_name: name, anchor: 'everyone', status: 'pending', organization_id: ORG,
  });

  it('binds the one holder, and reports a row whose set another package holds than the one that suggested it', async () => {
    const engine = await boot();
    await engine.insert(SUGGESTIONS.object, suggestion('s1', CRM, ONE_HOLDER), { context: SYS_ORG });
    // Suggested by HR, but CRM alone holds the set.
    await engine.insert(SUGGESTIONS.object, suggestion('s2', HR, ONE_HOLDER), { context: SYS_ORG });
    await engine.insert(SUGGESTIONS.object, suggestion('s3', HR, TWO_HOLDERS), { context: SYS_ORG });

    const holderOf = permissionSetHolderOf(standInRegistry());
    const report = await backfillStoredPermissionSetPackages(engine, SUGGESTIONS, holderOf);

    expect(await packagesById(engine, SUGGESTIONS.object)).toEqual({ s1: CRM, s2: CRM, s3: null });
    expect(report.ambiguous.map((a) => a.name)).toEqual([TWO_HOLDERS]);
    expect(report.differs).toEqual([{ id: 's2', name: ONE_HOLDER, packageId: HR, permissionSetPackage: CRM }]);
    // `package_id` is reported, never rewritten.
    const s2 = (await engine.find(SUGGESTIONS.object, { where: { id: 's2' }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    expect(s2[0].package_id).toBe(HR);

    // The next run binds nothing and reports the same differing row.
    const again = await backfillStoredPermissionSetPackages(engine, SUGGESTIONS, holderOf);
    expect(again.bound).toEqual([]);
    expect(again.differs).toEqual(report.differs);
  });
});

describe('the boot run', () => {
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });
  const sealed = (registry: PermissionSetHolderRegistry, getObject: (name: string) => unknown) =>
    Object.assign(registry, { bareNameHoldersAreSealed: true, getObject });

  it('waits for the holder seal: before it, nothing is read or written', async () => {
    const engine = await boot();
    await seedGrants(engine);
    const find = vi.spyOn(engine, 'find');
    const registry = Object.assign(standInRegistry(), { bareNameHoldersAreSealed: false, getObject: () => ({}) });

    expect(await backfillStoredPermissionSetPackagesAtBoot(engine, registry, logger())).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });

  it('binds both references the composition carries, and warns once naming every candidate of the ambiguous set', async () => {
    const engine = await boot();
    await seedGrants(engine);
    const log = logger();
    const registry = sealed(standInRegistry(), (name) => engine.registry.getObject(name));

    const reports = await backfillStoredPermissionSetPackagesAtBoot(engine, registry, log);

    expect(reports?.map((r) => r.row)).toEqual(['R1', 'R3']);
    expect((await packagesById(engine, GRANTS.object)).g1).toBe(CRM);
    const warned = log.warn.mock.calls.map((c) => String(c[0]));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(TWO_HOLDERS);
    expect(warned[0]).toContain(CRM);
    expect(warned[0]).toContain(HR);
  });

  it('skips a reference whose table the composition does not carry', async () => {
    const engine = await boot();
    const registry = sealed(standInRegistry(), (name) => (name === GRANTS.object ? engine.registry.getObject(name) : undefined));

    const reports = await backfillStoredPermissionSetPackagesAtBoot(engine, registry, logger());

    expect(reports?.map((r) => r.row)).toEqual(['R1']);
  });

  it('a table it cannot read keeps its rows and says so, and the boot goes on', async () => {
    const engine = await boot();
    await seedGrants(engine);
    const log = logger();
    vi.spyOn(engine, 'find').mockRejectedValue(new Error('driver offline'));
    const registry = sealed(standInRegistry(), (name) => engine.registry.getObject(name));

    const reports = await backfillStoredPermissionSetPackagesAtBoot(engine, registry, log);

    expect(reports).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(String(log.warn.mock.calls[0][0])).toContain('did not finish');
  });
});

describe('no unique key widens: the package column sits beside the keys, never in them', () => {
  it('every index of both tables is byte-identical to the one before the column', () => {
    expect(JSON.stringify(SysUserPermissionSet.indexes)).toBe(JSON.stringify([
      { fields: ['user_id', 'permission_set', 'organization_id'], unique: 'organization' },
      { fields: ['user_id'], unique: false },
      { fields: ['organization_id'], unique: false },
    ]));
    expect(JSON.stringify(SysAudienceBindingSuggestion.indexes)).toBe(JSON.stringify([
      { fields: ['package_id', 'permission_set_name', 'anchor'], unique: 'organization' },
      { fields: ['status'], unique: false },
      { fields: ['package_id'], unique: false },
    ]));
  });

  it('the store still refuses a second grant of one set to one user, whatever either row\'s package column says', async () => {
    const engine = await boot();
    await engine.insert(GRANTS.object, grant('k1', ONE_HOLDER, { user_id: 'u_k' }), { context: SYS_ORG });
    // Both null: the case a widened key would quietly let through.
    await expect(engine.insert(GRANTS.object, grant('k2', ONE_HOLDER, { user_id: 'u_k' }), { context: SYS_ORG })).rejects.toThrow();
    // One differs only in the new column: still the same grant.
    await expect(
      engine.insert(GRANTS.object, grant('k3', ONE_HOLDER, { user_id: 'u_k', permission_set_package: CRM }), { context: SYS_ORG }),
    ).rejects.toThrow();
    const rows = (await engine.find(GRANTS.object, { where: { user_id: 'u_k' }, context: SYSTEM_CTX })) as unknown[];
    expect(rows).toHaveLength(1);
  });
});
