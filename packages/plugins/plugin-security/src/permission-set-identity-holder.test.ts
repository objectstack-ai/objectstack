// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2/D3] Every identity derived from a permission set's NAME, and
 * every gate that grants a set, compares `(package, name)`.
 *
 *  - Platform standing and the organization-administrator rung come from the
 *    PLATFORM's set of that name — the holder of the kernel namespace `sys` —
 *    never from another package's set that shares it.
 *  - The delegated-admin gate's allowlist names a holder: each name resolves
 *    from the package of the set that carries the scope, so being allowed to
 *    grant package A's `sales_rep` never allows granting package B's.
 *  - The evaluator's catalog-less by-name arm never picks one of two holders.
 *
 * The registry here is a package-scoped stand-in: no install-time namesake
 * backstop runs, so two holders of a name coexist the way #31698's narrowing
 * will let packages of different namespaces hold them.
 */

import { describe, it, expect, vi } from 'vitest';
import { holdsPlatformPermissionSet, resolveUserAuthzGrants } from '@objectstack/core';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { DelegatedAdminGate } from './delegated-admin-gate.js';

const ORG = 'org_default';
const OTHER_ORG = 'org_other';
/** The platform's package: the kernel namespace `sys`. */
const SYS = 'com.objectstack.plugin-security';
/** A package of another namespace that ships sets under the platform's names. */
const ACME = 'com.acme.tools';
const ALPHA = 'com.alpha.sales';
const BETA = 'org.beta.crm';

const NAMESPACES: Record<string, string> = { [SYS]: 'sys', [ACME]: 'acme', [ALPHA]: 'alpha', [BETA]: 'beta' };

type Item = Record<string, unknown>;
type Holders = Record<string, Array<{ packageId: string; item: Item }>>;

const set = (name: string, packageId: string, extra: Item = {}): Item => ({ name, _packageId: packageId, objects: {}, ...extra });
const superuser = { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } };

const HOLDERS: Holders = {
  admin_full_access: [
    { packageId: SYS, item: set('admin_full_access', SYS, { objects: superuser }) },
    { packageId: ACME, item: set('admin_full_access', ACME, { objects: { acme_note: { allowRead: true } } }) },
  ],
  organization_admin: [
    { packageId: SYS, item: set('organization_admin', SYS, { objects: superuser }) },
    { packageId: ACME, item: set('organization_admin', ACME, { objects: { acme_note: { allowRead: true } } }) },
  ],
  sales_rep: [
    { packageId: ALPHA, item: set('sales_rep', ALPHA, { objects: { alpha_deal: { allowRead: true } } }) },
    { packageId: BETA, item: set('sales_rep', BETA, { objects: { beta_deal: { allowRead: true } } }) },
  ],
};

/** A package-scoped registry over `holders` and `positions`; its packages declare {@link NAMESPACES}. */
function scopedRegistry(holders: Holders, positions: Item[] = []) {
  const all = () => Object.values(holders).flatMap((h) => h.map((x) => x.item));
  const position = (name: string) => positions.find((p) => p.name === name);
  return {
    getItem: (type: string, name: string) =>
      (type === 'permission' ? holders[name]?.[0]?.item : type === 'position' ? position(name) : undefined),
    listItems: (type: string) => (type === 'permission' ? all() : type === 'position' ? positions : []),
    isPackageDisabled: () => false,
    packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' ? (holders[name] ?? []).map((h) => h.packageId) : []),
    getPackageScopedItem: (type: string, name: string, packageId: string) =>
      type === 'permission' ? holders[name]?.find((h) => h.packageId === packageId)?.item : undefined,
    getEnvironmentScopedItem: (type: string, name: string) => (type === 'position' ? position(name) : undefined),
    // A package's own shipped position is its own slot (ADR-0150 D7).
    getArtifactItem: (type: string, name: string) => (type === 'position' ? position(name) : undefined),
    getPackage: (id: string) => (NAMESPACES[id] ? { manifest: { id, namespace: NAMESPACES[id] } } : undefined),
    getAllPackages: () => Object.entries(NAMESPACES).map(([id, namespace]) => ({ manifest: { id, namespace } })),
  };
}

/** An engine double answering `find` from `tables` (equality and `$in`), with the registry above. */
function engine(tables: Record<string, Array<Record<string, unknown>>>, positions: Item[] = []) {
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`engine double: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      if (v === null) return (row[k] ?? null) === null;
      return row[k] === v;
    });
  return {
    registry: scopedRegistry(HOLDERS, positions),
    registerMiddleware: () => {},
    getSchema: () => null,
    findOne: async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; },
    find: async (object: string, opts: any) => {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
}

const grant = (permissionSet: string, permissionSetPackage: string | null, organizationId = ORG) => ({
  id: `g_${permissionSet}_${permissionSetPackage ?? 'none'}_${organizationId}`,
  user_id: 'u1',
  organization_id: organizationId,
  permission_set: permissionSet,
  permission_set_package: permissionSetPackage,
});

function tablesFor(grants: Array<Record<string, unknown>>) {
  return {
    sys_user: [{ id: 'u1', email: 'u1@example.com' }],
    sys_organization: [{ id: ORG, slug: 'default' }, { id: OTHER_ORG, slug: 'other' }],
    sys_member: [
      { user_id: 'u1', organization_id: ORG, role: 'member' },
      { user_id: 'u1', organization_id: OTHER_ORG, role: 'member' },
    ],
    sys_user_position: [],
    sys_user_permission_set: grants,
    sys_metadata_activation: [],
  };
}

/** A started security plugin over `ql`: its catalog is bound in `start()`, as on a booted stack. */
async function bootPlugin(ql: ReturnType<typeof engine>) {
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => null, list: async () => [] },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: null });
  await plugin.init(ctx);
  await plugin.start(ctx);
  return plugin as any;
}

async function grantsFor(grants: Array<Record<string, unknown>>, tenantId = ORG) {
  const ql = engine(tablesFor(grants));
  await bootPlugin(ql);
  return { ql, authz: await resolveUserAuthzGrants(ql, 'u1', { tenantId }) };
}

describe('[ADR-0150 D2/D3] platform standing comes from the platform\'s `admin_full_access` only', () => {
  it('CONTROL: the sys holder\'s set, granted in the Default Organization, confers platform standing', async () => {
    const { authz } = await grantsFor([grant('admin_full_access', SYS)]);
    expect(authz.posture).toBe('PLATFORM_ADMIN');
    expect(authz.positions).toContain('platform_admin');
    expect(authz.permissionSetAddresses).toEqual([{ packageId: SYS, name: 'admin_full_access' }]);
  });

  it('⛔ another package\'s set of that name is granted as any set is, and confers no standing', async () => {
    const { authz } = await grantsFor([grant('admin_full_access', ACME)]);
    expect(authz.permissions).toEqual(['admin_full_access']);
    expect(authz.permissionSetAddresses).toEqual([{ packageId: ACME, name: 'admin_full_access' }]);
    expect(authz.posture).not.toBe('PLATFORM_ADMIN');
    expect(authz.positions).not.toContain('platform_admin');
  });

  it('⛔ …nor crosses the tenant wall the anchor crosses: acting in another organization it applies nowhere', async () => {
    const { authz } = await grantsFor([grant('admin_full_access', ACME)], OTHER_ORG);
    expect(authz.permissions).toEqual([]);
    expect(authz.posture).not.toBe('PLATFORM_ADMIN');
  });

  it('CONTROL: the sys holder\'s anchoring grant applies in another organization too', async () => {
    const { authz } = await grantsFor([grant('admin_full_access', SYS)], OTHER_ORG);
    expect(authz.permissions).toEqual(['admin_full_access']);
    expect(authz.posture).toBe('PLATFORM_ADMIN');
  });
});

describe('[ADR-0150 D2/D3] the organization-administrator rung comes from the platform\'s set only', () => {
  it('CONTROL: the sys holder\'s `organization_admin` makes a tenant administrator', async () => {
    const { authz } = await grantsFor([grant('organization_admin', SYS)]);
    expect(authz.posture).toBe('TENANT_ADMIN');
  });

  it('⛔ another package\'s `organization_admin` is granted, and is no rung', async () => {
    const { authz } = await grantsFor([grant('organization_admin', ACME)]);
    expect(authz.permissions).toEqual(['organization_admin']);
    expect(authz.posture).toBe('MEMBER');
  });
});

describe('[ADR-0150 D3] holdsPlatformPermissionSet — a name read as an identity reads its holder', () => {
  const ql = engine(tablesFor([]));

  it('an address of the sys holder is the platform\'s; one of another namespace is not', () => {
    const held = (packageId: string) => ({ permissions: ['organization_admin'], permissionSetAddresses: [{ packageId, name: 'organization_admin' }] });
    expect(holdsPlatformPermissionSet(ql, held(SYS), 'organization_admin')).toBe(true);
    expect(holdsPlatformPermissionSet(ql, held(ACME), 'organization_admin')).toBe(false);
  });

  it('⛔ a name with no address resolves with no caller: two holders are refused, so it is no identity', () => {
    expect(holdsPlatformPermissionSet(ql, { permissions: ['organization_admin'] }, 'organization_admin')).toBe(false);
  });

  it('a name not held is no identity, whatever the addresses say', () => {
    expect(holdsPlatformPermissionSet(ql, { permissions: [], permissionSetAddresses: [{ packageId: SYS, name: 'organization_admin' }] }, 'organization_admin')).toBe(false);
  });
});

// ── The delegated-admin gate ────────────────────────────────────────────────

/** A delegate's scope over `east`, allowlisting `sales_rep` — a reference written inside ALPHA's set. */
const EAST_SCOPE = { businessUnit: 'east', includeSubtree: true, manageAssignments: true, assignablePermissionSets: ['sales_rep'] };
const DELEGATE_SET = { name: 'east_admin', _packageId: ALPHA, objects: {}, adminScope: EAST_SCOPE };

const POSITIONS: Item[] = [
  { name: 'alpha_rep', _packageId: ALPHA, permissionSets: ['sales_rep'] },
  { name: 'beta_rep', _packageId: BETA, permissionSets: ['sales_rep'] },
];

function delegateHarness(callerSets: any[] = [DELEGATE_SET]) {
  const ql = engine({
    sys_business_unit: [
      { id: 'bu_east', name: 'east', parent_business_unit_id: null, organization_id: ORG },
    ],
    sys_business_unit_member: [{ id: 'm1', business_unit_id: 'bu_east', user_id: 'u_east' }],
    sys_member: [{ user_id: 'u_east', organization_id: ORG, role: 'member' }],
    sys_user: [{ id: 'u_east' }],
    sys_user_position: [],
    sys_user_permission_set: [],
  }, POSITIONS);
  const gate = new DelegatedAdminGate({ ql, resolveSets: async () => callerSets });
  const context = { userId: 'u_delegate', positions: [], organizationId: ORG, tenantId: ORG };
  return { ql, gate, context };
}

async function bootGate(callerSets?: any[]) {
  const h = delegateHarness(callerSets);
  await bootPlugin(h.ql);
  return h;
}

describe('[ADR-0150 D3] the delegated-admin gate compares (package, name)', () => {
  const grantInsert = (h: Awaited<ReturnType<typeof bootGate>>, permissionSetPackage: string) => h.gate.assert({
    object: 'sys_user_permission_set',
    operation: 'insert',
    data: { user_id: 'u_east', permission_set: 'sales_rep', permission_set_package: permissionSetPackage },
    context: h.context,
  });
  const assignment = (h: Awaited<ReturnType<typeof bootGate>>, position: string) => h.gate.assert({
    object: 'sys_user_position',
    operation: 'insert',
    data: { user_id: 'u_east', position, business_unit_id: 'bu_east' },
    context: h.context,
  });

  it('CONTROL: allowed to grant ALPHA\'s `sales_rep`, a grant of ALPHA\'s set is admitted', async () => {
    await expect(grantInsert(await bootGate(), ALPHA)).resolves.toBeUndefined();
  });

  it('⛔ allowed to grant ALPHA\'s `sales_rep` does not allow granting BETA\'s', async () => {
    await expect(grantInsert(await bootGate(), BETA)).rejects.toThrow(/permission set 'sales_rep' of package 'org.beta.crm' is not in the scope's allowlist/);
  });

  it('CONTROL: a position whose package resolves `sales_rep` to ALPHA\'s set is assignable', async () => {
    await expect(assignment(await bootGate(), 'alpha_rep')).resolves.toBeUndefined();
  });

  it('⛔ a position whose package resolves `sales_rep` to BETA\'s set is not', async () => {
    await expect(assignment(await bootGate(), 'beta_rep')).rejects.toThrow(/position 'beta_rep' distributes permission set 'sales_rep', which is not in the scope's allowlist/);
  });

  it('organization administration is the platform\'s `organization_admin`: another package\'s set of that name covers no one', async () => {
    const sys = await bootGate([HOLDERS.organization_admin[0].item]);
    const acme = await bootGate([HOLDERS.organization_admin[1].item]);
    expect(await sys.gate.organizationAdminCoversUser([HOLDERS.organization_admin[0].item] as any, 'u_east', sys.context)).toBe(true);
    expect(await acme.gate.organizationAdminCoversUser([HOLDERS.organization_admin[1].item] as any, 'u_east', acme.context)).toBe(false);
  });
});

// ── The evaluator's catalog-less arm ────────────────────────────────────────

describe('[ADR-0150 D3] the catalog-less by-name arm never picks one of two holders', () => {
  const listed = [HOLDERS.sales_rep[0].item, HOLDERS.sales_rep[1].item];

  it('⛔ a name two listed holders serve grants nothing — not the list\'s first, not a bootstrap body — and is said, naming both', async () => {
    const warn = vi.fn();
    const sets = await new PermissionEvaluator().resolvePermissionSets(
      ['sales_rep'],
      { list: async () => listed },
      [set('sales_rep', SYS, { objects: { boot_deal: { allowRead: true } } }) as any],
      undefined,
      { logger: { warn } },
    );
    expect(sets).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({ permissionSet: 'sales_rep', holders: [`package "${ALPHA}"`, `package "${BETA}"`] });
  });

  it('CONTROL: one listed holder answers as before', async () => {
    const sets = await new PermissionEvaluator().resolvePermissionSets(['sales_rep'], { list: async () => [listed[1]] }, []);
    expect(sets).toEqual([listed[1]]);
  });
});
