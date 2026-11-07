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
/** [#29029] A plain object whose `unit` lookup names a business unit. */
const UNIT_NOTE = 'qa_unit_note';
const NOTE_CRUD = { allowRead: true, allowCreate: true, allowEdit: true };

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
  // [#30758] It may not read `external_ref`, so the aggregate field guard (step 2.5b) has a field to refuse.
  {
    name: 'east_admin', label: 'East delegate', objects: { ...CRUD, [UNIT_NOTE]: NOTE_CRUD }, adminScope: eastScope(['field_user']),
    fields: { 'sys_business_unit.external_ref': { readable: false } },
  },
  // [#29029] A writer of the unit note with no admin scope at all.
  { name: 'note_writer', label: 'Note writer', objects: { [UNIT_NOTE]: NOTE_CRUD } },
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

/** The users of `ORG_A`, as the runtime resolves them onto every session's context from `sys_member`. */
const ORG_USER_IDS = ['u_delegate', 'u_delegate_wide', 'u_target', 'u_writer', 'u_org_admin'];
const delegateCtx = (userId: string, set: string) =>
  ({ userId, positions: [], permissions: [set], tenantId: ORG_A, accessible_org_ids: [ORG_A], org_user_ids: ORG_USER_IDS });
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
    // [#29029] `sys_user` provisioned: an assignment's `user_id` names a user
    // the caller must be able to read, so the table the read door asks exists.
    objects: [
      SysUser, SysUserPosition, SysUserPermissionSet, SysMember, SysBusinessUnit, SysBusinessUnitMember,
      {
        name: UNIT_NOTE,
        label: 'Unit note',
        sharingModel: 'public_read_write',
        fields: {
          name: { name: 'name', type: 'text' },
          unit: { name: 'unit', type: 'lookup', reference: 'sys_business_unit' },
        },
      },
    ],
  } as any);
  await engine.syncSchemas();
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
  for (const userId of ORG_USER_IDS) {
    await engine.insert('sys_user', { id: userId, email: `${userId}@example.test`, name: userId }, sys);
    const role = userId === 'u_org_admin' ? 'admin' : 'member';
    await engine.insert('sys_member', { id: `m_${userId}`, user_id: userId, organization_id: ORG_A, role }, sys);
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
        // [#26189] A set off the caller's allowlist is a scope violation: its own code.
        expect([r.status, r.code], r.message).toEqual([403, 'DELEGATION_SCOPE_VIOLATION']);
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

/** [#29029] Every unit id `context` reads, sorted, or the refusal's status and code. */
async function unitsRead(h: Awaited<ReturnType<typeof boot>>, context: ReturnType<typeof delegateCtx>): Promise<string[] | { status: number; code?: string }> {
  try {
    const rows = await h.engine.find('sys_business_unit', { context });
    return (Array.isArray(rows) ? rows : []).map((r: any) => String(r.id)).sort();
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code };
  }
}

/** [#29029] A unit note naming `unit`, written as `context`: the outcome, and the refused field's code. */
async function noteNaming(h: Awaited<ReturnType<typeof boot>>, context: any, unit: string) {
  try {
    await h.engine.insert(UNIT_NOTE, { name: `note on ${unit}`, unit }, { context } as any);
    return { status: 200 };
  } catch (e) {
    const r = resolveThrownHttpError(e);
    const fields = ((e as any)?.fields ?? []) as Array<{ field?: string; code?: string }>;
    return { status: r.status, code: r.code, fields: fields.map((f) => `${f.field}:${f.code}`) };
  }
}

async function storedNotes(h: Awaited<ReturnType<typeof boot>>): Promise<string[]> {
  const rows = await h.engine.find(UNIT_NOTE, { context: SYS });
  return (Array.isArray(rows) ? rows : []).map((r: any) => String(r.unit)).sort();
}

describe('[ADR-0090 D12, ruling of record 6663849489; #29029] a delegate reads the business units its scope covers, and no other — three postures', () => {
  const WRITER = delegateCtx('u_writer', 'note_writer');
  const ORG_ADMIN = delegateCtx('u_org_admin', 'organization_admin');

  for (const posture of POSTURES) {
    describe(`posture '${posture}'`, () => {
      it('the delegate reads exactly the units its scope covers: the scope root and its subtree, not the unit above it', async () => {
        const h = await boot(posture);
        expect(await unitsRead(h, NARROW)).toEqual(['bu_east', 'bu_east_field']);
        const above = await h.engine.findOne('sys_business_unit', { where: { id: 'bu_hq' }, context: NARROW });
        expect(above ?? null).toBeNull();
        expect(await h.engine.count('sys_business_unit', { context: NARROW })).toBe(2);
      });

      it('the delegate assigns a position in a unit its scope covers, and the assignment is stored', async () => {
        const h = await boot(posture);
        expect(await assign(h, NARROW, 'field_rep')).toEqual({ status: 200 });
        expect(await storedPositions(h)).toEqual(['field_rep']);
      });

      it('a unit outside the scope is a unit the delegate cannot read: a reference to it answers reference_not_found, and one inside is admitted', async () => {
        const h = await boot(posture);
        expect(await noteNaming(h, NARROW, 'bu_hq')).toEqual({ status: 400, code: 'VALIDATION_FAILED', fields: ['unit:reference_not_found'] });
        expect(await noteNaming(h, NARROW, 'bu_east_field')).toEqual({ status: 200 });
        expect(await storedNotes(h)).toEqual(['bu_east_field']);
      });

      it('CONTROL: a caller holding no scope still reads no unit, and cannot name one', async () => {
        const h = await boot(posture);
        expect(await unitsRead(h, WRITER)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(await noteNaming(h, WRITER, 'bu_east')).toEqual({ status: 400, code: 'VALIDATION_FAILED', fields: ['unit:reference_not_found'] });
        expect(await storedNotes(h)).toEqual([]);
      });

      it('CONTROL: an organization administrator reads and names every unit of its organization, as before', async () => {
        const h = await boot(posture);
        expect(await unitsRead(h, ORG_ADMIN)).toEqual(['bu_east', 'bu_east_field', 'bu_hq']);
        expect(await noteNaming(h, ORG_ADMIN, 'bu_hq')).toEqual({ status: 200 });
      });
    });
  }
});

/** [#30758] The unit ids the system context reads under `filter` — what a door that compiles its own statement returns. */
async function unitsUnder(h: Awaited<ReturnType<typeof boot>>, filter: unknown): Promise<string[]> {
  const rows = await h.engine.find('sys_business_unit', { ...(filter ? { where: filter } : {}), context: SYS } as any);
  return (Array.isArray(rows) ? rows : []).map((r: any) => String(r.id)).sort();
}

/** [#30758] An aggregate of `sys_business_unit` as `context`: the group names it counts, or the refusal. */
async function unitAggregate(
  h: Awaited<ReturnType<typeof boot>>,
  context: any,
  query: { where?: unknown; groupBy: string[] },
): Promise<string[] | { status: number; code?: string; forbiddenFields?: unknown }> {
  try {
    const rows = await h.engine.aggregate('sys_business_unit', { ...query, aggregations: [{ function: 'count', alias: 'n' }] } as any, { context } as any);
    return (Array.isArray(rows) ? rows : []).map((r: any) => `${String(r[query.groupBy[0]])}:${Number(r.n)}`).sort();
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code, forbiddenFields: (e as any)?.details?.forbiddenFields };
  }
}

const layerOf = (decision: any, layer: string) => decision.layers.find((l: any) => l.layer === layer);

describe('[ADR-0090 D12, ruling of record 6663849489; #30758] canReadObject and security/explain answer the delegated business-unit read as the read door does — three postures', () => {
  const WRITER = delegateCtx('u_writer', 'note_writer');
  const ORG_ADMIN = delegateCtx('u_org_admin', 'organization_admin');

  for (const posture of POSTURES) {
    describe(`posture '${posture}'`, () => {
      it('canReadObject admits the delegate, and getReadFilter scopes a bypassing door to exactly the units the read door returns', async () => {
        const h = await boot(posture);
        const door = await unitsRead(h, NARROW);
        expect(door).toEqual(['bu_east', 'bu_east_field']);
        expect(await h.plugin.canReadObject('sys_business_unit', NARROW)).toBe(true);
        expect(await unitsUnder(h, await h.plugin.getReadFilter('sys_business_unit', NARROW))).toEqual(door);
      });

      it('security/explain read: allowed, the object grant names the delegated scope, and its readFilter returns exactly the read door\'s units', async () => {
        const h = await boot(posture);
        const d: any = await h.plugin.explainAccessForCaller({ object: 'sys_business_unit', operation: 'read' }, NARROW);
        expect(d.allowed).toBe(true);
        expect(layerOf(d, 'object_crud').verdict).toBe('grants');
        expect(await unitsUnder(h, d.readFilter)).toEqual(await unitsRead(h, NARROW));
      });

      it('security/explain of one unit: the units the scope covers are visible, the unit above it is not — asked by the delegate and by its organization administrator', async () => {
        const h = await boot(posture);
        await h.engine.insert('sys_user_permission_set',
          { id: 'ups_delegate', user_id: 'u_delegate', permission_set: 'east_admin', organization_id: ORG_A }, { context: { isSystem: true, tenantId: ORG_A } } as any);
        for (const [asker, request] of [
          ['delegate', (recordId: string) => h.plugin.explainAccessForCaller({ object: 'sys_business_unit', operation: 'read', recordId }, NARROW)],
          ['organization administrator', (recordId: string) =>
            h.plugin.explainAccessForCaller({ object: 'sys_business_unit', operation: 'read', userId: 'u_delegate', recordId }, ORG_ADMIN)],
        ] as const) {
          for (const unit of ['bu_east', 'bu_east_field']) {
            const d: any = await request(unit);
            expect(d.record?.visible, `${asker} · ${unit}`).toBe(true);
          }
          const above: any = await request('bu_hq');
          expect(above.record?.visible, `${asker} · bu_hq`).toBe(false);
        }
      });

      it('aggregate is the read door too: inside the scope it counts the covered units, outside it counts none, and the field guard still refuses an unreadable field', async () => {
        const h = await boot(posture);
        expect(await unitAggregate(h, NARROW, { groupBy: ['name'] })).toEqual(['east:1', 'east_field:1']);
        expect(await unitAggregate(h, NARROW, { where: { id: 'bu_hq' }, groupBy: ['name'] })).toEqual([]);
        expect(await unitAggregate(h, NARROW, { groupBy: ['external_ref'] }))
          .toEqual({ status: 403, code: 'PERMISSION_DENIED', forbiddenFields: ['external_ref'] });
        // CONTROL: the organization administrator counts every unit; a caller with no scope is refused the object.
        expect(await unitAggregate(h, ORG_ADMIN, { groupBy: ['name'] })).toEqual(['east:1', 'east_field:1', 'hq:1']);
        expect(await unitAggregate(h, WRITER, { groupBy: ['name'] })).toEqual({ status: 403, code: 'PERMISSION_DENIED', forbiddenFields: undefined });
      });

      it('CONTROL: a caller holding no scope is still refused by the door, canReadObject and explain alike', async () => {
        const h = await boot(posture);
        expect(await unitsRead(h, WRITER)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(await h.plugin.canReadObject('sys_business_unit', WRITER)).toBe(false);
        const d: any = await h.plugin.explainAccessForCaller({ object: 'sys_business_unit', operation: 'read' }, WRITER);
        expect(d.allowed).toBe(false);
        expect(layerOf(d, 'object_crud').verdict).toBe('denies');
      });

      it('CONTROL: an organization administrator\'s answers are unchanged — every unit, granted by its own set', async () => {
        const h = await boot(posture);
        expect(await h.plugin.canReadObject('sys_business_unit', ORG_ADMIN)).toBe(true);
        expect(await unitsUnder(h, await h.plugin.getReadFilter('sys_business_unit', ORG_ADMIN))).toEqual(['bu_east', 'bu_east_field', 'bu_hq']);
        const d: any = await h.plugin.explainAccessForCaller({ object: 'sys_business_unit', operation: 'read' }, ORG_ADMIN);
        expect(d.allowed).toBe(true);
        expect(layerOf(d, 'object_crud').contributors.map((c: any) => c.name)).toContain('organization_admin');
      });

      it('CONTROL: the delegated read is the caller\'s own — acting on behalf of another user, even one who reads every unit, no answer admits it, as the door does not', async () => {
        const h = await boot(posture);
        const onBehalf = { ...NARROW, principalKind: 'agent', onBehalfOf: { userId: 'u_org_admin' } };
        expect(await unitsRead(h, onBehalf as any)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(await h.plugin.canReadObject('sys_business_unit', onBehalf)).toBe(false);
        const d: any = await h.plugin.explainAccessForCaller({ object: 'sys_business_unit', operation: 'read' }, onBehalf);
        expect(d.allowed).toBe(false);
      });

      it('CONTROL: the delegated scope grants a read and nothing else — explain still denies create and export, as their doors do', async () => {
        const h = await boot(posture);
        for (const operation of ['create', 'export'] as const) {
          const d: any = await h.plugin.explainAccessForCaller({ object: 'sys_business_unit', operation }, NARROW);
          expect(d.allowed, operation).toBe(false);
        }
        expect(await h.plugin.canExport('sys_business_unit', NARROW)).toBe(false);
      });
    });
  }
});
