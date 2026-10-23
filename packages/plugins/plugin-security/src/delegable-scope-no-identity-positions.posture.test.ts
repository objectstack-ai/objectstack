// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D12 / ADR-0105 D8 × ADR-0068 D2] The delegable-scope report offers
 * only positions the write admits, in EVERY branch of `describeDelegableScope`:
 * the tenant-level administrator, the organization-level administrator and the
 * delegate holding a placing `adminScope`. The ADR-0068 D2 built-in identity
 * names are declared positions the security catalog lists, and are refused by
 * `sys_user_position.position` from every writer — so no branch offers one.
 * `org_external` (ruling 6355206139) is the one that names a set
 * (`external_default`), so a delegate whose allowlist lacks it meets the
 * delegated-administration gate's refusal first; either refusal stores nothing.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` registered on it (its declared built-in positions, the
 * delegated-administration gate, the CRUD check, the object validations and
 * the grant-holder membership hooks in their production order), in the three
 * postures the sibling posture suites cover. Each branch is held three ways:
 * none of the four identity names is listed; a non-identity control position
 * still is; and every listed position is admitted by the real write, read
 * back from storage. The ground truth beside it — the catalog this stack
 * serves holds the four names, and the write refuses each one from the same
 * caller with the ADR-0112 envelope — is what keeps the first assertion from
 * passing over a catalog that never held them.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { securityCatalogReaderOf } from '@objectstack/core';
import { SysUser, SysMember, SysBusinessUnit, SysBusinessUnitMember } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { RESERVED_IDENTITY_NAMES } from './objects/reserved-identity-names.js';
import { defaultPermissionSets } from './objects/index.js';
import { BUILTIN_IDENTITY_ORG_EXTERNAL } from '@objectstack/spec';

const SYS = { isSystem: true } as const;
const ORG_A = 'org_a';
const CONTROL = 'field_rep';

/**
 * The catalog. `field_user` is inside the organization boundary (no superuser
 * bit, no adminScope, no capability) and is the one set the delegate's scope
 * allowlists; `field_rep` distributes it alone, so every branch may assign it.
 */
const PERMISSIONS = [
  ...defaultPermissionSets,
  { name: 'field_user', label: 'Field user', objects: { sys_user: { allowRead: true } } },
  {
    name: 'east_admin',
    label: 'East delegate',
    objects: { sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    adminScope: { businessUnit: 'east', includeSubtree: true, manageAssignments: true, assignablePermissionSets: ['field_user'] },
  },
];
const POSITIONS = [{ name: CONTROL, label: 'Field rep', permissionSets: ['field_user'] }];

type Posture = 'single' | 'group' | 'isolated';
const POSTURES: Posture[] = ['single', 'group', 'isolated'];

/** One caller per branch of the report, and how the report must name the branch it took. */
const BRANCHES = {
  'tenant-level': {
    context: { userId: 'u_platform', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN', tenantId: ORG_A, accessible_org_ids: [ORG_A] },
    isTenantAdmin: true,
    scopes: [] as string[],
  },
  'organization-level': {
    context: { userId: 'u_org_admin', positions: [], permissions: ['organization_admin'], tenantId: ORG_A, accessible_org_ids: [ORG_A] },
    isTenantAdmin: false,
    scopes: [] as string[],
  },
  delegated: {
    context: { userId: 'u_delegate', positions: [], permissions: ['east_admin'], tenantId: ORG_A, accessible_org_ids: [ORG_A] },
    isTenantAdmin: false,
    scopes: ['east_admin'],
  },
} as const;
type Branch = keyof typeof BRANCHES;

const MEMBERSHIPS = [
  { id: 'm_platform', user_id: 'u_platform', role: 'member' },
  { id: 'm_org_admin', user_id: 'u_org_admin', role: 'admin' },
  { id: 'm_delegate', user_id: 'u_delegate', role: 'member' },
  { id: 'm_target', user_id: 'u_target', role: 'member' },
];

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.delegable-scope-no-identity-positions',
    name: 'The delegable-scope report offers no built-in identity position',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPosition, SysUserPermissionSet, SysMember, SysBusinessUnit, SysBusinessUnitMember],
  } as any);
  await engine.syncSchemas();
  // `sys_user` registered and unprovisioned, as in the sibling posture suites.
  if (!engine.registry.getObject(SysUser.name)) engine.registry.registerObject(SysUser as never, 'qa.delegable-scope-identity');
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    // [ADR-0131 D3/D4] The stack-declared half of the catalog; the built-in
    // positions are the plugin's own declarations, in the engine registry.
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'position' ? POSITIONS.find((p) => p.name === name)
          : type === 'permission' ? PERMISSIONS.find((p) => p.name === name)
          : type === 'capability' ? undefined
          : engine.getSchema(name)) ?? null,
      list: async (type: string) => (type === 'position' ? POSITIONS : type === 'permission' ? PERMISSIONS : []),
    },
    ...(posture === 'single' ? {} : { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture } }),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  const sys = { context: { isSystem: true, tenantId: ORG_A } } as any;
  await engine.insert('sys_business_unit', [
    { id: 'bu_hq', name: 'hq', parent_business_unit_id: null, organization_id: ORG_A },
    { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq', organization_id: ORG_A },
    { id: 'bu_east_field', name: 'east_field', parent_business_unit_id: 'bu_east', organization_id: ORG_A },
  ], sys);
  for (const m of MEMBERSHIPS) await engine.insert('sys_member', { ...m, organization_id: ORG_A }, sys);
  await engine.insert('sys_business_unit_member',
    { id: 'bum_target', user_id: 'u_target', business_unit_id: 'bu_east_field', organization_id: ORG_A }, sys);
  return { engine, plugin };
}
type Harness = Awaited<ReturnType<typeof boot>>;

async function outcome(run: () => Promise<unknown>): Promise<{ status: number; code?: string; message?: string }> {
  try {
    await run();
    return { status: 200 };
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code, message: (e as Error).message };
  }
}

/** Assign `position` to the target, in a unit every branch's caller may place into. */
const assign = (h: Harness, context: any, position: string) =>
  outcome(() => h.engine.insert('sys_user_position',
    { user_id: 'u_target', position, business_unit_id: 'bu_east_field' }, { context } as any));

async function storedRows(h: Harness, position: string): Promise<any[]> {
  const rows = await h.engine.find('sys_user_position', { where: { user_id: 'u_target', position }, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

describe('[ADR-0090 D12 / ADR-0105 D8 × ADR-0068 D2] every branch of the delegable-scope report offers only positions the write admits — three postures', () => {
  for (const posture of POSTURES) {
    describe(`posture '${posture}'`, () => {
      for (const branch of Object.keys(BRANCHES) as Branch[]) {
        it(`${branch}: no built-in identity name is offered, the control still is, and every offered position is admitted`, async () => {
          const h = await boot(posture);
          const security = h.plugin as any;
          const { context, isTenantAdmin, scopes } = BRANCHES[branch];

          // Ground truth: the catalog this stack serves lists the four names,
          // and the write refuses each one from this very caller.
          const catalogNames = (await securityCatalogReaderOf(h.engine)!.list('position')).map((e) => e.name);
          expect(catalogNames).toEqual(expect.arrayContaining([...RESERVED_IDENTITY_NAMES, CONTROL]));
          for (const name of RESERVED_IDENTITY_NAMES) {
            const r = await assign(h, context, name);
            const gatedFirst = branch === 'delegated' && name === BUILTIN_IDENTITY_ORG_EXTERNAL;
            expect([r.status, r.code], `${name}: ${r.message}`).toEqual(gatedFirst ? [403, 'PERMISSION_DENIED'] : [400, 'VALIDATION_FAILED']);
            expect(await storedRows(h, name), `${name} stored nothing`).toHaveLength(0);
          }

          const sets = await security.resolvePermissionSetsForContext(context);
          const report = await security.delegatedAdminGate.describeDelegableScope(sets, context);
          // The caller reached the branch this case names.
          expect(report.isTenantAdmin).toBe(isTenantAdmin);
          expect(report.scopes.map((s: any) => s.setName)).toEqual(scopes);

          const offered = report.assignablePositions as string[];
          for (const name of RESERVED_IDENTITY_NAMES) expect(offered, `${name} offered`).not.toContain(name);
          expect(offered).toContain(CONTROL);
          for (const position of offered) {
            const r = await assign(h, context, position);
            expect(r, `${position}: ${r.message ?? 'admitted'}`).toEqual({ status: 200 });
            const rows = await storedRows(h, position);
            expect(rows, `${position} stored`).toHaveLength(1);
            await h.engine.delete('sys_user_position', { where: { id: rows[0].id }, context: SYS } as any);
          }
        });
      }
    });
  }
});
