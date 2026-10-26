// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D12, amended 2026-10-17; ADR-0131 D3/D4; #24757] A delegate's
 * position assignment is judged on EVERY permission set the assignment grants —
 * exactly the names the position's definition lists. The permission set of the
 * position's own name was judged too while the resolver folded held position
 * names into the requested set names; #24757 retired that fold, so the
 * own-name set is granted by nothing and judged by nothing.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` registered on it (the delegated-administration gate, the CRUD
 * check and the grant-holder membership hooks in their production order), in
 * the three postures `org-admin-assignment-boundary.posture.test.ts` covers.
 * Every refusal is identified by its ADR-0112 envelope — `status` and `code`
 * through `resolveThrownHttpError`, the resolver both HTTP doors answer with —
 * and names the set it judged; every admission reads the stored row back.
 *
 * The unit pins beside the gate (`delegated-admin-gate.test.ts`) hold the same
 * rule on a fake engine; this file holds it where the catalog, the resolver and
 * the gate meet: the gate admits exactly what the resolver grants.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { SysUser, SysMember, SysBusinessUnit, SysBusinessUnitMember } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/index.js';

const SYS = { isSystem: true } as const;
const ORG_A = 'org_a';

/** A delegate's scope over the `east` unit and its subtree, allowlisting `allow`. */
const eastScope = (allow: string[]) => ({
  businessUnit: 'east',
  includeSubtree: true,
  manageAssignments: true,
  assignablePermissionSets: allow,
});
const CRUD = { sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } };

/**
 * The catalog. `field_rep` and `field_lead` each list only `field_user`, and
 * the catalog also holds a permission set of each one's own name — which their
 * definitions do not list, so an assignment grants neither; `field_clerk`
 * lists `field_user` and has no set of its own name; `field_auditor` lists
 * `field_audit`, which neither delegate allowlists.
 */
const PERMISSIONS = [
  ...defaultPermissionSets,
  { name: 'field_user', label: 'Field user', objects: { sys_user: { allowRead: true } } },
  { name: 'field_rep', label: 'Field rep (own name)', objects: { sys_user: { allowRead: true, allowEdit: true } } },
  // Listed by `field_auditor`, allowlisted by neither delegate.
  { name: 'field_audit', label: 'Field audit', objects: { sys_user: { allowRead: true } } },
  // Carries an adminScope equal to the wide delegate's own: not strictly contained by it.
  { name: 'field_lead', label: 'Field lead (own name)', objects: CRUD, adminScope: eastScope(['field_user', 'field_rep', 'field_lead']) },
  // Narrow: allowlists the sets the positions LIST, not their own-name sets.
  { name: 'east_admin', label: 'East delegate', objects: CRUD, adminScope: eastScope(['field_user']) },
  // Wide: also allowlists the own-name sets.
  { name: 'east_admin_wide', label: 'East delegate (wide)', objects: CRUD, adminScope: eastScope(['field_user', 'field_rep', 'field_lead']) },
];
const POSITIONS = [
  { name: 'field_rep', label: 'Field rep', permissionSets: ['field_user'] },
  { name: 'field_lead', label: 'Field lead', permissionSets: ['field_user'] },
  { name: 'field_clerk', label: 'Field clerk', permissionSets: ['field_user'] },
  { name: 'field_auditor', label: 'Field auditor', permissionSets: ['field_audit'] },
];

type Posture = 'single' | 'group' | 'isolated';
const POSTURES: Posture[] = ['single', 'group', 'isolated'];

const delegateCtx = (userId: string, set: string) =>
  ({ userId, positions: [], permissions: [set], tenantId: ORG_A, accessible_org_ids: [ORG_A] });
const NARROW = delegateCtx('u_delegate', 'east_admin');
const WIDE = delegateCtx('u_delegate_wide', 'east_admin_wide');

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
    id: 'com.objectstack.qa.delegated-admin-own-name-set',
    name: 'Delegated administration counts the own-name set',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPosition, SysUserPermissionSet, SysMember, SysBusinessUnit, SysBusinessUnitMember],
  } as any);
  await engine.syncSchemas();
  // `sys_user` registered and unprovisioned, as in the sibling posture suite.
  if (!engine.registry.getObject(SysUser.name)) engine.registry.registerObject(SysUser as never, 'qa.delegated-own-name');
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
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
  for (const userId of ['u_delegate', 'u_delegate_wide', 'u_target']) {
    await engine.insert('sys_member', { id: `m_${userId}`, user_id: userId, organization_id: ORG_A, role: 'member' }, sys);
  }
  await engine.insert('sys_business_unit_member',
    { id: 'bum_target', user_id: 'u_target', business_unit_id: 'bu_east_field', organization_id: ORG_A }, sys);
  return { engine, plugin };
}

async function outcome(run: () => Promise<unknown>): Promise<{ status: number; code?: string; message?: string }> {
  try {
    await run();
    return { status: 200 };
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code, message: (e as Error).message };
  }
}

const assign = (h: Awaited<ReturnType<typeof boot>>, context: any, position: string) =>
  outcome(() => h.engine.insert('sys_user_position',
    { user_id: 'u_target', position, business_unit_id: 'bu_east_field' }, { context } as any));

async function storedPositions(h: Awaited<ReturnType<typeof boot>>): Promise<string[]> {
  const rows = await h.engine.find('sys_user_position', { where: { user_id: 'u_target' }, context: SYS });
  return (Array.isArray(rows) ? rows : []).map((r: any) => r.position).sort();
}

describe('[ADR-0090 D12, amended 2026-10-17; #24757] a delegate is judged on exactly the sets a position assignment grants — three postures', () => {
  for (const posture of POSTURES) {
    describe(`posture '${posture}'`, () => {
      it("ground truth: an assignment of the position does NOT grant the permission set of the position's own name", async () => {
        const h = await boot(posture);
        const sets = await (h.plugin as any).resolvePermissionSetsForContext(
          { userId: 'u_target', positions: ['field_rep'], permissions: ['field_user'], tenantId: ORG_A, accessible_org_ids: [ORG_A] });
        const names = sets.map((s: any) => s.name);
        expect(names).toContain('field_user');
        expect(names).not.toContain('field_rep');
      });

      it("a delegate whose allowlist lacks the position's own-name set is admitted: that set is granted by nothing", async () => {
        const h = await boot(posture);
        expect(await assign(h, NARROW, 'field_rep')).toEqual({ status: 200 });
        expect(await storedPositions(h)).toEqual(['field_rep']);
      });

      it('CONTROL: an assignment whose LISTED set is outside the allowlist is still refused 403, naming that set', async () => {
        // The gate has teeth: the admissions above are not a gate judging
        // nothing at all.
        const h = await boot(posture);
        const r = await assign(h, NARROW, 'field_auditor');
        expect([r.status, r.code], r.message).toEqual([403, 'PERMISSION_DENIED']);
        expect(r.message).toMatch(/position 'field_auditor' distributes permission set 'field_audit'.*not in the scope's allowlist/);
        expect(await storedPositions(h)).toEqual([]);
      });

      it('a position with no own-name set in the catalog is judged on its listed sets alone, as before', async () => {
        const h = await boot(posture);
        expect(await assign(h, NARROW, 'field_clerk')).toEqual({ status: 200 });
        expect(await storedPositions(h)).toEqual(['field_clerk']);
      });

      it('an own-name set that carries an adminScope is not judged for containment: an assignment does not hand it out', async () => {
        const h = await boot(posture);
        expect(await assign(h, WIDE, 'field_lead')).toEqual({ status: 200 });
        expect(await storedPositions(h)).toEqual(['field_lead']);
      });

      it("the delegable-scope report offers one of this catalog's positions exactly when the write admits it", async () => {
        const h = await boot(posture);
        const security = h.plugin as any;
        const fixture = POSITIONS.map((p) => p.name);
        const offered = async (context: any) => {
          const sets = await security.resolvePermissionSetsForContext(context);
          const report = await security.delegatedAdminGate.describeDelegableScope(sets, context);
          return (report.assignablePositions as string[]).filter((n) => fixture.includes(n)).sort();
        };
        expect(await offered(NARROW)).toEqual(['field_clerk', 'field_lead', 'field_rep']);
        expect(await offered(WIDE)).toEqual(['field_clerk', 'field_lead', 'field_rep']);
        for (const [label, context] of [['narrow', NARROW], ['wide', WIDE]] as const) {
          const listed = await offered(context);
          for (const position of fixture) {
            const r = await assign(h, context, position);
            expect(r.status === 200, `${label} · ${position}: ${r.message ?? 'admitted'}`).toBe(listed.includes(position));
            if (r.status === 200) {
              const rows = await h.engine.find('sys_user_position', { where: { user_id: 'u_target', position }, context: SYS });
              for (const row of Array.isArray(rows) ? rows : []) {
                await h.engine.delete('sys_user_position', { where: { id: (row as any).id }, context: SYS } as any);
              }
            }
          }
        }
      });
    });
  }
});
