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
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { SysUser, SysMember } from '@objectstack/platform-objects/identity';

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
const PERMISSIONS = [...defaultPermissionSets, QA_IN_SET];

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
    objects: [SysUserPosition, SysUserPermissionSet, SysMember],
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
