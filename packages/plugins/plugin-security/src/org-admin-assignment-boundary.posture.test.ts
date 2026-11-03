// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: a fresh real ObjectQL engine and SecurityPlugin per case across three postures, 60 cases that each write and read back the same holder's assignments, so no boot can be shared; 4.3 s in a local run; slowest CI reading 10.9 s (scheduled full-battery run 41199450735, Test Core shard log) x 1.25, rounded up

/**
 * [ADR-0090 D12, amended 2026-10-17] The organization administrator's
 * assignment boundary, measured on a REAL `ObjectQL` engine over a real SQL
 * driver with the REAL `SecurityPlugin` registered on it — the delegated-
 * administration gate, the shipped overrides, the CRUD check and the
 * grant-holder membership hooks all in their production order.
 *
 * Three postures (`single`, `group`, `isolated`) × four callers (a platform
 * administrator, `organization_admin`, `organization_admin_no_bypass`, a
 * member) × insert and delete × both assignment tables × an in-boundary and an
 * out-of-boundary set. Every refusal is identified by its ADR-0112 envelope —
 * `status` and `code` through `resolveThrownHttpError`, the resolver both HTTP
 * doors answer with — and an out-of-boundary refusal also names its set and
 * the failed condition. Every admission reads the stored row back.
 *
 * At the foot: under the walled postures, an organization administrator's
 * update and delete of a row it cannot read answer exactly what an id naming
 * no row answers (ruling of record 5985885287) — the whole refusal, sentence
 * and details included; a row it reads keeps the boundary guidance, and a
 * tenant-level administrator is answered by the engine as before. The same
 * rule for the delegated branch follows: a delegate holding an `adminScope`,
 * an organization administrator who holds one too, and a delegate whose read
 * of the two tables is refused outright; rows it reads keep their verdict and
 * their guidance, in every posture.
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
const ORG_B = 'org_b';

/** An in-boundary set (no superuser bit, no adminScope, an org capability only). */
const QA_IN_SET = {
  name: 'qa_in_set',
  label: 'QA in-boundary',
  objects: { sys_user: { allowRead: true } },
  systemPermissions: ['manage_org_users'],
};
const POSITIONS = [
  { name: 'qa_in_pos', label: 'In', permissionSets: ['qa_in_set'] },
  // A mixed bundle: one set outside puts the whole position outside.
  { name: 'qa_out_pos', label: 'Out', permissionSets: ['qa_in_set', 'admin_full_access'] },
];
/**
 * The delegated branch's sets (the describe at the foot): one `adminScope` over
 * organization A's `a_ops` unit and its subtree, handing out `qa_in_set` only,
 * held with both tables' CRUD; with CRUD but no read; and with a field rule
 * that hides `position` from the holder's reads.
 */
const A_OPS_SCOPE = { businessUnit: 'a_ops', includeSubtree: true, manageAssignments: true, assignablePermissionSets: ['qa_in_set'] };
const READ_WRITE = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const WRITE_ONLY = { allowCreate: true, allowEdit: true, allowDelete: true };
const DELEGATE_SETS = [
  { name: 'qa_delegate', label: 'QA delegate', objects: { sys_user_position: READ_WRITE, sys_user_permission_set: READ_WRITE }, adminScope: A_OPS_SCOPE },
  { name: 'qa_delegate_write_only', label: 'QA delegate, no read', objects: { sys_user_position: WRITE_ONLY, sys_user_permission_set: WRITE_ONLY }, adminScope: A_OPS_SCOPE },
  {
    name: 'qa_delegate_position_hidden',
    label: 'QA delegate, position hidden',
    objects: { sys_user_position: READ_WRITE, sys_user_permission_set: READ_WRITE },
    fields: { 'sys_user_position.position': { readable: false, editable: false } },
    adminScope: A_OPS_SCOPE,
  },
];
const PERMISSIONS = [...defaultPermissionSets, QA_IN_SET, ...DELEGATE_SETS];

type Posture = 'single' | 'group' | 'isolated';
const POSTURES: Posture[] = ['single', 'group', 'isolated'];

const CALLERS = {
  platform: { userId: 'u_platform', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN', tenantId: ORG_A, accessible_org_ids: [ORG_A] },
  orgAdmin: { userId: 'u_org_admin', positions: [], permissions: ['organization_admin'], tenantId: ORG_A, accessible_org_ids: [ORG_A] },
  orgAdminNoBypass: { userId: 'u_org_admin_nb', positions: [], permissions: ['organization_admin_no_bypass'], tenantId: ORG_A, accessible_org_ids: [ORG_A] },
  member: { userId: 'u_member', positions: [], permissions: ['member_default'], tenantId: ORG_A, accessible_org_ids: [ORG_A] },
} as const;
type Caller = keyof typeof CALLERS;

const MEMBERSHIPS = [
  { id: 'm_platform', user_id: 'u_platform', organization_id: ORG_A, role: 'member' },
  { id: 'm_admin', user_id: 'u_org_admin', organization_id: ORG_A, role: 'admin' },
  { id: 'm_admin_nb', user_id: 'u_org_admin_nb', organization_id: ORG_A, role: 'admin' },
  { id: 'm_member', user_id: 'u_member', organization_id: ORG_A, role: 'member' },
  { id: 'm_target', user_id: 'u_target', organization_id: ORG_A, role: 'member' },
  { id: 'm_seeded', user_id: 'u_seeded', organization_id: ORG_A, role: 'member' },
  { id: 'm_other', user_id: 'u_other_org', organization_id: ORG_B, role: 'member' },
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
    id: 'com.objectstack.qa.org-admin-assignment-boundary',
    name: 'Organization administrator assignment boundary',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPosition, SysUserPermissionSet, SysMember, SysBusinessUnit, SysBusinessUnitMember],
  } as any);
  await engine.syncSchemas();
  // `sys_user` registered and unprovisioned, as in the sibling suites: the
  // engine's `user_id` existence probe stands down and the membership hook is
  // what judges the holder.
  if (!engine.registry.getObject(SysUser.name)) engine.registry.registerObject(SysUser as never, 'qa.org-admin-boundary');
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    // [ADR-0131 D3/D4] The catalog the rows are judged against: the shipped
    // sets plus one in-boundary set, and the two positions.
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

  for (const m of MEMBERSHIPS) {
    await engine.insert('sys_member', m, { context: { isSystem: true, tenantId: m.organization_id } } as any);
  }
  return { engine, plugin };
}

type Harness = Awaited<ReturnType<typeof boot>>;

/** The four writes of one (table, in/out) cell. */
const TABLES = {
  sys_user_position: { in: { position: 'qa_in_pos' }, out: { position: 'qa_out_pos' } },
  sys_user_permission_set: { in: { permission_set: 'qa_in_set' }, out: { permission_set: 'admin_full_access' } },
} as const;
type Table = keyof typeof TABLES;

async function outcome(run: () => Promise<unknown>): Promise<{ status: number; code?: string; message?: string }> {
  try {
    await run();
    return { status: 200 };
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code, message: (e as Error).message };
  }
}

async function seed(h: Harness, table: Table, id: string, side: 'in' | 'out') {
  await h.engine.insert(table, { id, user_id: 'u_seeded', ...TABLES[table][side], organization_id: ORG_A },
    { context: { isSystem: true, tenantId: ORG_A } } as any);
}

async function stored(h: Harness, table: Table, where: Record<string, unknown>): Promise<any[]> {
  const rows = await h.engine.find(table, { where, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

/** What each caller is answered — admitted, or refused with the envelope. */
const EXPECTED: Record<Caller, { in: 'admit' | 'deny'; out: 'admit' | 'deny' }> = {
  platform: { in: 'admit', out: 'admit' },
  orgAdmin: { in: 'admit', out: 'deny' },
  orgAdminNoBypass: { in: 'admit', out: 'deny' },
  member: { in: 'deny', out: 'deny' },
};

describe('[ADR-0090 D12, amended 2026-10-17] the organization administrator assigns inside the boundary — three postures', () => {
  for (const posture of POSTURES) {
    describe(`posture '${posture}'`, () => {
      for (const caller of Object.keys(CALLERS) as Caller[]) {
        for (const table of Object.keys(TABLES) as Table[]) {
          for (const side of ['in', 'out'] as const) {
            const expected = EXPECTED[caller][side];
            it(`${caller} · ${table} · ${side}-boundary: insert and delete ${expected === 'admit' ? 'admitted' : 'refused 403'}`, async () => {
              const h = await boot(posture);
              const context = CALLERS[caller];

              // insert
              const ins = await outcome(() => h.engine.insert(table, { user_id: 'u_target', ...TABLES[table][side] }, { context } as any));
              const insRows = await stored(h, table, { user_id: 'u_target' });
              // delete (of a row seeded by the system in org_a)
              await seed(h, table, `seed_${side}`, side);
              const del = await outcome(() => h.engine.delete(table, { where: { id: `seed_${side}` }, context } as any));
              const delRows = await stored(h, table, { id: `seed_${side}` });

              if (expected === 'admit') {
                expect(ins, 'insert').toEqual({ status: 200 });
                expect(insRows, 'insert stored').toHaveLength(1);
                expect(insRows[0]?.organization_id, 'insert stored in the organization').toBe(ORG_A);
                expect(del, 'delete').toEqual({ status: 200 });
                expect(delRows, 'delete removed the row').toHaveLength(0);
              } else {
                expect([ins.status, ins.code], `insert: ${ins.message}`).toEqual([403, 'PERMISSION_DENIED']);
                expect(insRows, 'insert stored nothing').toHaveLength(0);
                expect([del.status, del.code], `delete: ${del.message}`).toEqual([403, 'PERMISSION_DENIED']);
                expect(delRows, 'delete left the row').toHaveLength(1);
                if (caller !== 'member') {
                  // The org admin's refusal names the set and the condition that failed.
                  for (const m of [ins.message, del.message]) {
                    expect(m).toMatch(/organization boundary/);
                    expect(m).toContain("'admin_full_access'");
                    expect(m).toMatch(/by name/);
                  }
                }
              }
            });
          }
        }
      }

      it('an organization administrator assigning a member of ANOTHER organization is refused (the membership hook, 400)', async () => {
        const h = await boot(posture);
        for (const context of [CALLERS.orgAdmin, CALLERS.orgAdminNoBypass]) {
          const r = await outcome(() => h.engine.insert('sys_user_permission_set',
            { user_id: 'u_other_org', permission_set: 'qa_in_set' }, { context } as any));
          expect([r.status, r.code], r.message).toEqual([400, 'VALIDATION_FAILED']);
        }
        expect(await stored(h, 'sys_user_permission_set', { user_id: 'u_other_org' })).toHaveLength(0);
      });

      it('an organization administrator cannot assign a built-in identity position (refused for every writer, 400)', async () => {
        const h = await boot(posture);
        for (const context of [CALLERS.orgAdmin, CALLERS.orgAdminNoBypass]) {
          for (const position of ['platform_admin', 'org_owner', 'org_admin']) {
            const r = await outcome(() => h.engine.insert('sys_user_position', { user_id: 'u_target', position }, { context } as any));
            expect([r.status, r.code], `${position}: ${r.message}`).toEqual([400, 'VALIDATION_FAILED']);
          }
        }
        expect(await stored(h, 'sys_user_position', { user_id: 'u_target' })).toHaveLength(0);
      });

      it('an organization administrator may not edit an assignment in place', async () => {
        const h = await boot(posture);
        await seed(h, 'sys_user_position', 'seed_edit', 'in');
        for (const context of [CALLERS.orgAdmin, CALLERS.orgAdminNoBypass]) {
          const r = await outcome(() => h.engine.update('sys_user_position', { id: 'seed_edit', reason: 'edited' }, { context } as any));
          expect([r.status, r.code], r.message).toEqual([403, 'PERMISSION_DENIED']);
        }
        const [row] = await stored(h, 'sys_user_position', { id: 'seed_edit' });
        expect(row?.reason ?? null).toBeNull();
      });

      it('the delegable-scope report offers the org admin its in-boundary positions only, and explain admits it for its member', async () => {
        const h = await boot(posture);
        const security = h.plugin as any;
        // [#26641] Explain answers only for a user a `sys_user` row carries, so
        // the explained member gets one here (the boot leaves the table
        // unprovisioned for the write cases above).
        await h.engine.syncObjectSchema(SysUser.name);
        await h.engine.insert('sys_user', { id: 'u_target', name: 'Target', email: 'u_target@example.test' }, { context: { isSystem: true } } as any);
        for (const context of [CALLERS.orgAdmin, CALLERS.orgAdminNoBypass]) {
          const sets = await security.resolvePermissionSetsForContext(context);
          const report = await security.delegatedAdminGate.describeDelegableScope(sets, context);
          expect(report.isTenantAdmin).toBe(false);
          expect(report.assignablePositions).toContain('qa_in_pos');
          // Never a position carrying a set outside the boundary — the mixed
          // bundle, nor the built-in administrator positions.
          for (const outside of ['qa_out_pos', 'platform_admin', 'org_owner', 'org_admin']) {
            expect(report.assignablePositions).not.toContain(outside);
          }
          await expect(security.explainAccessForCaller({ object: 'sys_user_position', operation: 'read', userId: 'u_target' }, context))
            .resolves.toBeDefined();
          const refused = await outcome(() => security.explainAccessForCaller(
            { object: 'sys_user_position', operation: 'read', userId: 'u_other_org' }, context));
          expect([refused.status, refused.code]).toEqual([403, 'PERMISSION_DENIED']);
        }
        const memberRefused = await outcome(() => security.explainAccessForCaller(
          { object: 'sys_user_position', operation: 'read', userId: 'u_target' }, CALLERS.member));
        expect([memberRefused.status, memberRefused.code]).toEqual([403, 'PERMISSION_DENIED']);
      });
    });
  }
});

/** An id that names no row in either table. */
const NOWHERE = 'zz_nowhere_0001';

/** Everything a refusal carries: the envelope both doors resolve, its sentence and its details. */
async function answerOf(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run();
    return { status: 200 };
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code, message: (e as Error).message, details: (e as any).details };
  }
}

/** An in-boundary row of `organizationId`, written by the system. */
async function seedIn(h: Harness, table: Table, id: string, organizationId: string, userId: string) {
  await h.engine.insert(table, { id, user_id: userId, ...TABLES[table].in, organization_id: organizationId },
    { context: { isSystem: true, tenantId: organizationId } } as any);
}

const ORG_ADMINS = ['orgAdmin', 'orgAdminNoBypass'] as const;

/** `caller`'s own by-id read of `id`: the read door's answer to it. */
function readAs(h: Harness, table: Table, id: string, caller: Caller) {
  const { positions, permissions, accessible_org_ids, ...rest } = CALLERS[caller];
  const context = { ...rest, positions: [...positions], permissions: [...permissions], accessible_org_ids: [...accessible_org_ids] };
  return h.engine.findOne(table, { where: { id }, context });
}

const write =(h: Harness, table: Table, op: 'update' | 'delete', id: string, context: object) =>
  answerOf(() => op === 'update'
    ? h.engine.update(table, { reason: 'edited' }, { where: { id }, context } as any)
    : h.engine.delete(table, { where: { id }, context } as any));

describe("[ADR-0090 D12; ruling of record 5985885287] an organization administrator's refused assignment write answers the same for a row it cannot read as for a missing one", () => {
  for (const posture of ['group', 'isolated'] as const) {
    describe(`posture '${posture}'`, () => {
      it('update and delete of a row the caller cannot read answer exactly what an id naming no row answers, and leave the row', async () => {
        const h = await boot(posture);
        for (const table of Object.keys(TABLES) as Table[]) {
          const id = `unreadable_${table}`;
          await seedIn(h, table, id, ORG_B, 'u_other_org');
          const before = await stored(h, table, { id });
          expect(before, `${table}: the row exists`).toHaveLength(1);
          for (const caller of ORG_ADMINS) {
            const context = CALLERS[caller];
            // The precondition, read off the read door: this caller reads no such row.
            expect(await readAs(h, table, id, caller), `${caller} reads ${table} ${id}`).toBeFalsy();
            for (const op of ['update', 'delete'] as const) {
              const row = await write(h, table, op, id, context);
              const none = await write(h, table, op, NOWHERE, context);
              expect([none.status, none.code], `${caller} ${op} ${table}, no row: ${none.message}`).toEqual([403, 'PERMISSION_DENIED']);
              expect(row, `${caller} ${op} ${table}: the unreadable row answers as no row`).toEqual(none);
            }
          }
          expect(await stored(h, table, { id }), `${table}: refused means untouched`).toEqual(before);
        }
      });

      it('control: a row of its own organization, which it reads, keeps the boundary guidance; the platform administrator is answered as before', async () => {
        const h = await boot(posture);
        for (const table of Object.keys(TABLES) as Table[]) {
          await seed(h, table, 'own_out', 'out');
          for (const caller of ORG_ADMINS) {
            const context = CALLERS[caller];
            expect(await readAs(h, table, 'own_out', caller), `${caller} reads ${table}`).toBeTruthy();
            const own = await write(h, table, 'delete', 'own_out', context);
            expect([own.status, own.code], `${caller} ${table}: ${own.message}`).toEqual([403, 'PERMISSION_DENIED']);
            expect(own.message).toMatch(/'admin_full_access'.*by name/);
            expect(own, `${caller} ${table}: a row it reads is not answered as no row`).not.toEqual(await write(h, table, 'delete', NOWHERE, context));
          }
          expect(await stored(h, table, { id: 'own_out' }), `${table}: refused means untouched`).toHaveLength(1);

          // A tenant-level administrator passes the gate: the engine answers
          // its by-id writes, and the row it addresses outside its active
          // organization answers that engine's not-found, as no row does.
          const id = `platform_${table}`;
          await seedIn(h, table, id, ORG_B, 'u_other_org');
          for (const op of ['update', 'delete'] as const) {
            const row = await write(h, table, op, id, CALLERS.platform);
            const none = await write(h, table, op, NOWHERE, CALLERS.platform);
            expect([none.status, none.code], `platform ${op} ${table}: ${none.message}`).toEqual([404, 'RECORD_NOT_FOUND']);
            expect({ ...row, message: String(row.message).split(id).join('ID') }, `platform ${op} ${table}`)
              .toEqual({ ...none, message: String(none.message).split(NOWHERE).join('ID') });
          }
          expect(await stored(h, table, { id }), `${table}: refused means untouched`).toHaveLength(1);
        }
      });
    });
  }

  it("control, 'single': a row of another organization that the caller reads keeps the guidance that names its organization", async () => {
    const h = await boot('single');
    for (const table of Object.keys(TABLES) as Table[]) {
      const id = `readable_${table}`;
      await seedIn(h, table, id, ORG_B, 'u_other_org');
      for (const caller of ORG_ADMINS) {
        const context = CALLERS[caller];
        expect(await readAs(h, table, id, caller), `${caller} reads ${table}`).toBeTruthy();
        const row = await write(h, table, 'delete', id, context);
        expect([row.status, row.code], `${caller} ${table}: ${row.message}`).toEqual([403, 'PERMISSION_DENIED']);
        expect(row.message).toMatch(/belongs to organization 'org_b'/);
      }
      expect(await stored(h, table, { id }), `${table}: refused means untouched`).toHaveLength(1);
    }
  });
});

// ── The delegated branch ────────────────────────────────────────────────────

const delegateContext = (userId: string, permissions: string[]) =>
  ({ userId, positions: [] as string[], permissions, tenantId: ORG_A, accessible_org_ids: [ORG_A] });

/** Three principal classes the delegated walk judges, each holding the `a_ops` scope of organization A. */
const DELEGATES = {
  delegate: delegateContext('u_delegate', ['qa_delegate']),
  // Refused by the organization boundary, then judged by its scope.
  orgAdminDelegate: delegateContext('u_org_admin_delegate', ['organization_admin', 'qa_delegate']),
  // The read door refuses its read of both tables outright.
  writeOnlyDelegate: delegateContext('u_write_only_delegate', ['qa_delegate_write_only']),
} as const;
type Delegate = keyof typeof DELEGATES;
const POSITION_HIDDEN = delegateContext('u_position_hidden_delegate', ['qa_delegate_position_hidden']);

/** Members of organization A seated in `a_ops`: one holder per in-scope row a case writes. */
const IN_SCOPE_HOLDERS = ['u_in_0', 'u_in_1', 'u_in_2', 'u_in_3', 'u_in_4', 'u_in_5'];

/** Units in both organizations, the delegates' memberships, and where each holder sits. */
async function seedDelegation(h: Harness) {
  const inA = { context: { isSystem: true, tenantId: ORG_A } } as any;
  const inB = { context: { isSystem: true, tenantId: ORG_B } } as any;
  await h.engine.insert('sys_business_unit', [
    { id: 'bu_a_ops', name: 'a_ops', parent_business_unit_id: null, organization_id: ORG_A },
    { id: 'bu_a_other', name: 'a_other', parent_business_unit_id: null, organization_id: ORG_A },
  ], inA);
  await h.engine.insert('sys_business_unit', { id: 'bu_b1', name: 'b1', parent_business_unit_id: null, organization_id: ORG_B }, inB);
  for (const context of [...Object.values(DELEGATES), POSITION_HIDDEN]) {
    const role = context.permissions.includes('organization_admin') ? 'admin' : 'member';
    await h.engine.insert('sys_member', { id: `m_${context.userId}`, user_id: context.userId, organization_id: ORG_A, role }, inA);
  }
  for (const userId of IN_SCOPE_HOLDERS) {
    await h.engine.insert('sys_member', { id: `m_${userId}`, user_id: userId, organization_id: ORG_A, role: 'member' }, inA);
    await h.engine.insert('sys_business_unit_member', { id: `bum_${userId}`, user_id: userId, business_unit_id: 'bu_a_ops', organization_id: ORG_A }, inA);
  }
  await h.engine.insert('sys_business_unit_member', { id: 'bum_u_seeded', user_id: 'u_seeded', business_unit_id: 'bu_a_other', organization_id: ORG_A }, inA);
  await h.engine.insert('sys_business_unit_member', { id: 'bum_u_other_org', user_id: 'u_other_org', business_unit_id: 'bu_b1', organization_id: ORG_B }, inB);
}

/** A row of `organizationId` holding `qa_in_set` — directly, or through `qa_in_pos` anchored at `businessUnitId`. */
async function seedHolding(h: Harness, table: Table, id: string, organizationId: string, userId: string, businessUnitId: string) {
  const row = table === 'sys_user_position'
    ? { id, user_id: userId, position: 'qa_in_pos', business_unit_id: businessUnitId, organization_id: organizationId }
    : { id, user_id: userId, permission_set: 'qa_in_set', organization_id: organizationId };
  await h.engine.insert(table, row, { context: { isSystem: true, tenantId: organizationId } } as any);
}

/** What `context`'s own by-id read of `id` answers: a row, none, or a refusal. */
async function readOutcome(h: Harness, table: Table, id: string, context: object): Promise<'row' | 'none' | number> {
  try {
    return (await h.engine.findOne(table, { where: { id }, context: structuredClone(context) } as any)) ? 'row' : 'none';
  } catch (e) {
    return resolveThrownHttpError(e).status;
  }
}

/** `write`, and how many times it read row `id` of `table` by id under a caller's context. */
async function writeCountingCallerReads(h: Harness, table: Table, op: 'update' | 'delete', id: string, context: object) {
  const findOne = vi.spyOn(h.engine, 'findOne');
  try {
    const answer = await write(h, table, op, id, context);
    const reads = findOne.mock.calls.filter(([object, opts]: any[]) =>
      object === table && !opts?.context?.isSystem && JSON.stringify(opts?.where) === JSON.stringify({ id })).length;
    return { answer, reads };
  } finally {
    findOne.mockRestore();
  }
}

describe("[ADR-0090 D12; ruling of record 5985885287] a delegated administrator's refused assignment write answers the same for a row it cannot read as for a missing one", () => {
  for (const posture of ['group', 'isolated'] as const) {
    describe(`posture '${posture}'`, () => {
      it('update and delete of a row the caller cannot read answer exactly what an id naming no row answers, for every delegated principal class, and leave the row', async () => {
        const h = await boot(posture);
        await seedDelegation(h);
        for (const table of Object.keys(TABLES) as Table[]) {
          const id = `unreadable_${table}`;
          await seedHolding(h, table, id, ORG_B, 'u_other_org', 'bu_b1');
          const before = await stored(h, table, { id });
          expect(before, `${table}: the row exists`).toHaveLength(1);
          for (const caller of Object.keys(DELEGATES) as Delegate[]) {
            const context = DELEGATES[caller];
            // The precondition, read off the read door: no row for this caller.
            expect(await readOutcome(h, table, id, context), `${caller} reads ${table} ${id}`)
              .toBe(caller === 'writeOnlyDelegate' ? 403 : 'none');
            for (const op of ['update', 'delete'] as const) {
              const row = await write(h, table, op, id, context);
              const none = await write(h, table, op, NOWHERE, context);
              // Refused where it stands, never answered by the engine.
              expect([none.status, none.code], `${caller} ${op} ${table}, no row: ${none.message}`).toEqual([403, 'PERMISSION_DENIED']);
              expect(row, `${caller} ${op} ${table}: the unreadable row answers as no row`).toEqual(none);
            }
          }
          expect(await stored(h, table, { id }), `${table}: refused means untouched`).toEqual(before);
        }
      });

      it('control: a row it reads keeps its verdict and its guidance — admitted inside the scope, refused outside it, judged on the stored row', async () => {
        const h = await boot(posture);
        await seedDelegation(h);
        let holder = 0;
        for (const table of Object.keys(TABLES) as Table[]) {
          for (const caller of ['delegate', 'orgAdminDelegate'] as const) {
            const context = DELEGATES[caller];
            // Inside the scope: admitted, and the row is read as the caller once —
            // the gate's read is the operation's own pre-image read.
            const id = `in_scope_${caller}_${table}`;
            await seedHolding(h, table, id, ORG_A, IN_SCOPE_HOLDERS[holder++], 'bu_a_ops');
            expect(await readOutcome(h, table, id, context), `${caller} reads ${table} ${id}`).toBe('row');
            for (const op of ['update', 'delete'] as const) {
              const { answer, reads } = await writeCountingCallerReads(h, table, op, id, context);
              expect(answer, `${caller} ${op} ${table}: ${answer.message}`).toEqual({ status: 200 });
              expect(reads, `${caller} ${op} ${table}: caller reads of the row`).toBe(1);
            }
            expect(await stored(h, table, { id }), `${caller} ${table}: the delete landed`).toHaveLength(0);
          }
          // Outside the scope, in its own organization: the guidance names the
          // unit or the holder, and is not the answer for no row.
          const outId = `out_of_scope_${table}`;
          await seedHolding(h, table, outId, ORG_A, 'u_seeded', 'bu_a_other');
          for (const op of ['update', 'delete'] as const) {
            const out = await write(h, table, op, outId, DELEGATES.delegate);
            expect([out.status, out.code], `delegate ${op} ${table}: ${out.message}`).toEqual([403, 'DELEGATION_SCOPE_VIOLATION']);
            expect(out.message).toMatch(table === 'sys_user_position' ? /business unit 'bu_a_other' is outside/ : /target user 'u_seeded' is outside/);
            expect(out).not.toEqual(await write(h, table, op, NOWHERE, DELEGATES.delegate));
          }
          expect(await stored(h, table, { id: outId }), `${table}: refused means untouched`).toHaveLength(1);
        }

        // A position the holder's field rules hide from its reads: still held
        // to the allowlist, because the stored row is what is judged.
        await h.engine.insert('sys_user_position',
          { id: 'hidden_out', user_id: IN_SCOPE_HOLDERS[holder], position: 'qa_out_pos', business_unit_id: 'bu_a_ops', organization_id: ORG_A },
          { context: { isSystem: true, tenantId: ORG_A } } as any);
        const seen = await h.engine.findOne('sys_user_position', { where: { id: 'hidden_out' }, context: structuredClone(POSITION_HIDDEN) } as any);
        expect(seen, 'the holder reads the row').toBeTruthy();
        expect(seen, 'without its position').not.toHaveProperty('position');
        for (const op of ['update', 'delete'] as const) {
          const r = await write(h, 'sys_user_position', op, 'hidden_out', POSITION_HIDDEN);
          expect([r.status, r.code], `${op}: ${r.message}`).toEqual([403, 'DELEGATION_SCOPE_VIOLATION']);
          expect(r.message).toMatch(/position 'qa_out_pos' distributes permission set 'admin_full_access'.*not in the scope's allowlist/);
        }
        expect(await stored(h, 'sys_user_position', { id: 'hidden_out' })).toHaveLength(1);
      });
    });
  }

  it("control, 'single': a row of another organization that a delegate reads keeps its guidance, and every in-scope write it made before still lands — the refused read included", async () => {
    const h = await boot('single');
    await seedDelegation(h);
    let holder = 0;
    for (const table of Object.keys(TABLES) as Table[]) {
      const id = `readable_${table}`;
      await seedHolding(h, table, id, ORG_B, 'u_other_org', 'bu_b1');
      for (const caller of ['delegate', 'orgAdminDelegate'] as const) {
        expect(await readOutcome(h, table, id, DELEGATES[caller]), `${caller} reads ${table}`).toBe('row');
        for (const op of ['update', 'delete'] as const) {
          const r = await write(h, table, op, id, DELEGATES[caller]);
          expect([r.status, r.code], `${caller} ${op} ${table}: ${r.message}`).toEqual([403, 'DELEGATION_SCOPE_VIOLATION']);
          expect(r.message).toMatch(table === 'sys_user_position' ? /business unit 'bu_b1' is outside/ : /target user 'u_other_org' is outside/);
        }
      }
      expect(await stored(h, table, { id }), `${table}: refused means untouched`).toHaveLength(1);

      for (const caller of Object.keys(DELEGATES) as Delegate[]) {
        const inId = `in_scope_${caller}_${table}`;
        await seedHolding(h, table, inId, ORG_A, IN_SCOPE_HOLDERS[holder++], 'bu_a_ops');
        for (const op of ['update', 'delete'] as const) {
          const r = await write(h, table, op, inId, DELEGATES[caller]);
          expect(r, `${caller} ${op} ${table}: ${r.message}`).toEqual({ status: 200 });
        }
        expect(await stored(h, table, { id: inId }), `${caller} ${table}: the delete landed`).toHaveLength(0);
      }
    }
  });
});
