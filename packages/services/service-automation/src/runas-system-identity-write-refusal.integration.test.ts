// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25251, ruling 6354966423, letter B] A `runAs:'system'` flow writes no
 * identity assignment; a `runAs:'user'` flow's assignment is judged by the
 * delegated-administration gate as the user it acts for.
 *
 * A system run's data nodes write under `{ isSystem: true, …, flowRunId }`
 * (`resolveRunDataContext`), and the security middleware's `isSystem` bypass
 * precedes the ADR-0090 D12 gate and the identity write guard. The middleware
 * now refuses that context's writes to `sys_user_position`,
 * `sys_user_permission_set`, `sys_invitation` and `sys_member` ahead of the
 * bypass. Directions decided before running:
 *
 *  - a `runAs:'system'` flow's create, update or delete of one of the four
 *    fails with `PERMISSION_DENIED` carried to the run's caller, and the store
 *    does not move: user-triggered and user-less (scheduled) alike;
 *  - a `runAs:'user'` flow triggered by a tenant-level administrator grants a
 *    permission set, and the grant records that administrator as `granted_by`;
 *    triggered by a plain member, the D12 gate refuses it;
 *  - CONTROL, a platform writer's `{ isSystem: true }` (no run) writes the
 *    four objects as before;
 *  - CONTROL, a `runAs:'system'` flow still reads the four objects and still
 *    writes every other object.
 *
 * The real stack, as `runas-system-user-hook-grants.integration.test.ts`
 * composes it: ObjectKernel, ObjectQLPlugin, driver-sql on better-sqlite3
 * `:memory:`, the identity objects and the real SecurityPlugin, plus the real
 * AutomationEngine and its CRUD nodes. The hand-off from the flow's data
 * context to the security middleware is the subject, and no single-layer test
 * sees it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const SYS = { isSystem: true } as const;

const text = (name: string) => ({ name, label: name, type: 'text' as const });

/** An ordinary object: the control that a system flow's other writes are unchanged. */
const noteObject = { name: 'fsr_note', label: 'Note', fields: { title: text('title') } };

/** The deployment's member profile. */
const memberProfile = PermissionSetSchema.parse({ name: 'fsr_member', label: 'Refusal: member profile', objects: {} });
/** ADR-0066 tenant-level administrator: the superuser wildcard. */
const tenantAdmin = PermissionSetSchema.parse({
  name: 'fsr_tenant_admin', label: 'Refusal: tenant admin',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
});
/** The set the flows grant. */
const plainSet = PermissionSetSchema.parse({ name: 'fsr_plain', label: 'Refusal: plain', objects: { fsr_note: { allowRead: true } } });

type Node = { id: string; type: string; label: string; config: Record<string, unknown> };

/** start → one data node → end. */
const flowOf = (name: string, runAs: 'system' | 'user', node: Omit<Node, 'id' | 'label'>) => ({
  name, label: name, type: 'autolaunched', runAs,
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'data', label: 'Data', ...node },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'data' }, { id: 'e2', source: 'data', target: 'end' }],
});
const create = (objectName: string, fields: Record<string, unknown>) => ({ type: 'create_record', config: { objectName, fields } });
const update = (objectName: string, id: string, fields: Record<string, unknown>) => ({ type: 'update_record', config: { objectName, filter: { id }, fields } });
const remove = (objectName: string, id: string) => ({ type: 'delete_record', config: { objectName, filter: { id } } });
const read = (objectName: string, id: string) => ({ type: 'get_record', config: { objectName, filter: { id } } });

describe("a runAs:'system' flow writes no identity assignment; a runAs:'user' flow's is judged as the user", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let orgA = '';
  /**
   * The context each operation on the four objects (and the note) carried past
   * the security middleware: registered after it, so a refused write is not seen.
   */
  const seen: Array<{ object: string; operation: string; context: Record<string, unknown> }> = [];

  const WATCHED = new Set(['sys_user_position', 'sys_user_permission_set', 'sys_invitation', 'sys_member', 'fsr_note']);

  /** The rows each target's fixture and flows write; each case grants its own member, so no two collide. */
  const rows = (target = 'usr_target') => ({
    sys_user_permission_set: { user_id: target, permission_set: 'fsr_plain', organization_id: orgA },
    sys_user_position: { user_id: target, position: 'fsr_rep', organization_id: orgA },
    sys_member: { user_id: 'usr_outsider', organization_id: orgA, role: 'member' },
    sys_invitation: {
      email: 'invitee@example.test', role: 'admin', status: 'pending', inviter_id: 'usr_admin',
      organization_id: orgA, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
      name: 'test.driver.sqlite', type: 'standard', version: '1.0.0',
      async init(ctx: PluginContext) { ctx.registerService('driver.default', driver); },
    });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin({
      defaultPermissionSets: [...securityDefaultPermissionSets, memberProfile, tenantAdmin, plainSet],
      fallbackPermissionSet: 'fsr_member',
    }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');
    ql.registry.registerObject(noteObject as any, 'flow-system-refusal-test', 'flow-system-refusal-test');
    ql.registry.registerItem('position', { name: 'fsr_rep', label: 'Rep', permissionSets: ['fsr_plain'] } as any, 'name' as any, 'flow-system-refusal-test');
    await ql.syncSchemas();

    const orgs = await ql.find('sys_organization', { context: SYS });
    orgA = String(orgs[0].id);
    const members = ['usr_admin', 'usr_plain', 'usr_target', 'usr_seeded', 'usr_granted', 'usr_platform'];
    for (const id of [...members, 'usr_outsider']) {
      await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: SYS });
    }
    for (const id of members) {
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: orgA, role: 'member' }, { context: SYS });
    }
    await ql.insert('sys_user_permission_set', { id: 'ups_admin', user_id: 'usr_admin', permission_set: 'fsr_tenant_admin', organization_id: orgA }, { context: SYS });

    ql.registerMiddleware(async (opCtx: any, next: any) => {
      if (WATCHED.has(opCtx.object)) seen.push({ object: opCtx.object, operation: opCtx.operation, context: { ...(opCtx.context ?? {}) } });
      return next();
    });
  }, 30_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  let flowSeq = 0;
  /** Register a one-node flow and run it; triggered by `userId` in organisation A, or user-less when omitted. */
  async function run(runAs: 'system' | 'user', node: Omit<Node, 'id' | 'label'>, userId?: string) {
    const name = `fsr_flow_${++flowSeq}`;
    automation.registerFlow(name, flowOf(name, runAs, node) as never);
    const trigger = userId ? { userId, tenantId: orgA } : { event: 'schedule', params: {} };
    return automation.execute(name, trigger as never);
  }
  const stored = async (object: string, where: Record<string, unknown>) =>
    (await ql.find(object, { where, context: SYS })) as any[];
  const lastSeen = (object: string, operation: string) =>
    [...seen].reverse().find((s) => s.object === object && s.operation === operation);

  function expectRefused(res: any, object: string) {
    expect(res.success, `the run succeeded: ${JSON.stringify(res)}`).toBe(false);
    expect(res.innerRefusal?.code).toBe('PERMISSION_DENIED');
    expect(res.innerRefusal?.message).toMatch(new RegExp(`on '${object}' from a flow that runs as system`));
  }

  for (const object of ['sys_user_permission_set', 'sys_user_position', 'sys_member', 'sys_invitation'] as const) {
    it(`${object}: a runAs:'system' flow's create is refused, user-triggered and user-less, and no row is written`, async () => {
      const row = rows()[object];
      const before = (await stored(object, {})).length;

      expectRefused(await run('system', create(object, row), 'usr_admin'), object);
      expectRefused(await run('system', create(object, row)), object);

      expect((await stored(object, {})).length).toBe(before);
    });
  }

  it("sys_user_permission_set and sys_member: a runAs:'system' flow's update and delete are refused, and the rows do not move", async () => {
    await ql.insert('sys_user_permission_set', { id: 'ups_seeded', ...rows('usr_seeded').sys_user_permission_set }, { context: SYS });
    const grant = await stored('sys_user_permission_set', { id: 'ups_seeded' });
    const member = await stored('sys_member', { id: 'mem_usr_plain' });

    expectRefused(await run('system', update('sys_user_permission_set', 'ups_seeded', { permission_set: 'fsr_tenant_admin' }), 'usr_admin'), 'sys_user_permission_set');
    expectRefused(await run('system', remove('sys_user_permission_set', 'ups_seeded'), 'usr_admin'), 'sys_user_permission_set');
    expectRefused(await run('system', update('sys_member', 'mem_usr_plain', { role: 'owner' }), 'usr_admin'), 'sys_member');
    expectRefused(await run('system', remove('sys_member', 'mem_usr_plain')), 'sys_member');

    expect(await stored('sys_user_permission_set', { id: 'ups_seeded' })).toEqual(grant);
    expect(await stored('sys_member', { id: 'mem_usr_plain' })).toEqual(member);
  });

  it("a runAs:'user' flow triggered by a tenant-level administrator grants the set, recording that administrator as granted_by", async () => {
    const res = await run('user', create('sys_user_permission_set', rows('usr_granted').sys_user_permission_set), 'usr_admin');
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(lastSeen('sys_user_permission_set', 'insert')?.context).toMatchObject({ isSystem: false, userId: 'usr_admin' });
    expect(lastSeen('sys_user_permission_set', 'insert')?.context.flowRunId).toBeTruthy();

    const granted = await stored('sys_user_permission_set', { user_id: 'usr_granted', permission_set: 'fsr_plain' });
    expect(granted.map((r) => r.granted_by)).toEqual(['usr_admin']);
  });

  it("a runAs:'user' flow triggered by a plain member is refused by the delegated-administration gate", async () => {
    const before = (await stored('sys_user_permission_set', { granted_by: 'usr_plain' })).length;
    const res = await run('user', create('sys_user_permission_set', rows().sys_user_permission_set), 'usr_plain');
    expect(res.success, `the run succeeded: ${JSON.stringify(res)}`).toBe(false);
    expect(res.innerRefusal?.code).toBe('PERMISSION_DENIED');
    expect(res.innerRefusal?.message).toMatch(/delegated adminScope \(ADR-0090 D12\)/);
    expect(res.innerRefusal?.message).not.toMatch(/flow that runs as system/);
    expect((await stored('sys_user_permission_set', { granted_by: 'usr_plain' })).length).toBe(before);
  });

  it('CONTROL: a platform writer without a run writes the four objects as before', async () => {
    const r = rows('usr_platform');
    await ql.insert('sys_user_permission_set', { id: 'ups_platform', ...r.sys_user_permission_set }, { context: SYS });
    await ql.insert('sys_user_position', { id: 'up_platform', ...r.sys_user_position }, { context: SYS });
    await ql.insert('sys_member', { id: 'mem_platform', ...r.sys_member }, { context: SYS });
    await ql.insert('sys_invitation', { id: 'inv_platform', ...r.sys_invitation }, { context: SYS });
    await ql.update('sys_member', { role: 'admin' }, { where: { id: 'mem_platform' }, context: SYS } as never);
    await ql.delete('sys_invitation', { where: { id: 'inv_platform' }, context: SYS } as never);

    expect(await stored('sys_user_permission_set', { id: 'ups_platform' })).toHaveLength(1);
    expect(await stored('sys_user_position', { id: 'up_platform' })).toHaveLength(1);
    expect((await stored('sys_member', { id: 'mem_platform' }))[0]?.role).toBe('admin');
    expect(await stored('sys_invitation', { id: 'inv_platform' })).toHaveLength(0);
  });

  it("CONTROL: a runAs:'system' flow still reads the four objects and still writes every other object", async () => {
    for (const [object, id] of [
      ['sys_user_permission_set', 'ups_admin'], ['sys_member', 'mem_usr_admin'],
      ['sys_user_position', 'up_platform'], ['sys_invitation', 'none'],
    ] as const) {
      const res = await run('system', read(object, id), 'usr_admin');
      expect(res.success, `${object} read failed: ${JSON.stringify(res)}`).toBe(true);
      expect(lastSeen(object, 'findOne')?.context).toMatchObject({ isSystem: true, userId: 'usr_admin' });
    }

    const res = await run('system', create('fsr_note', { title: 'from a system flow' }), 'usr_admin');
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(await stored('fsr_note', { title: 'from a system flow' })).toHaveLength(1);
  });
});
