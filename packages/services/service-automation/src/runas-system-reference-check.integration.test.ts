// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28881] A `runAs: 'system'` flow's record writes keep the write-time
 * reference check, and keep their authorization elevation.
 *
 * The business case (the duly measurement): an assignment flow runs as system
 * so it can create tasks for other people, and fans out over a list of
 * assignees, one of whom has been deleted. Before this card the flow created
 * that task with an assignee that resolves to no account, while the same write
 * on the user path was refused `reference_not_found`. Elevation is for
 * authorization; it never needed a link to a row that does not exist.
 *
 *  1. `create_record` naming a deleted `sys_user` is refused with the user
 *     path's own answer (code and sentence), and no row is written.
 *  2. The same for `update_record`: the row keeps its assignee. And the
 *     master_detail arm: a deleted header is refused, a live one written.
 *  3. Elevation control: the same system run still updates a row its trigger
 *     user may not write (another member's row, `owner_only_writes`).
 *  4. Controls: a seed write (`SEED_WRITE_EXECUTION_CONTEXT`) and an import's
 *     batched create under an in-process system principal still store a
 *     reference to a row that does not exist yet, as before.
 *
 * ## The rig
 *
 * The real stack of `runas-system-stamping.integration.test.ts`'s flip
 * suite: ObjectKernel, ObjectQLPlugin, driver-sql on better-sqlite3
 * `:memory:`, the real AutomationEngine and CRUD nodes, plugin-auth's identity
 * objects (so `sys_user` is a real target) and the real SecurityPlugin.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

/** A business object with one user lookup, the field the duly flow writes. */
const crmTask = {
  name: 'crm_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    assignee: { name: 'assignee', label: 'Assignee', type: 'lookup', reference: 'sys_user' },
  },
};

/** A master and its detail: the master_detail arm of the check (#28881 S2). */
const crmOrder = {
  name: 'crm_order',
  label: 'Order',
  fields: { title: { name: 'title', label: 'Title', type: 'text' } },
};
const crmOrderLine = {
  name: 'crm_order_line',
  label: 'Order line',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    order: { name: 'order', label: 'Order', type: 'master_detail', reference: 'crm_order' },
  },
};

const RW = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const taskWriteSet = PermissionSetSchema.parse({
  name: 'task_write',
  label: 'Reference check — task write',
  objects: { crm_task: RW, crm_order: RW, crm_order_line: RW },
});

const MEMBER = 'usr_member';
const OTHER = 'usr_other';
const DELETED = 'usr_deleted';
const NEVER_YET = 'usr_not_yet_created';

const SYS = { isSystem: true } as const;

/** start → one write node → end, under runAs:'system'. */
const systemFlow = (name: string, node: Record<string, unknown>) => ({
  name,
  label: name,
  type: 'autolaunched',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'w', label: 'Write', ...node },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'w' },
    { id: 'e2', source: 'w', target: 'end' },
  ],
});

describe("a runAs:'system' flow's record writes keep the reference check (#28881)", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let memberCtx: { userId: string; tenantId: string; positions: string[]; permissions: string[] };

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  async function boot() {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
      name: 'test.driver.sqlite',
      type: 'standard',
      version: '1.0.0',
      async init(ctx: PluginContext) {
        ctx.registerService('driver.default', driver);
      },
    });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, taskWriteSet] }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');
    ql.registry.registerObject(crmTask as any, 'refcheck-test', 'refcheck-test');
    ql.registry.registerObject(crmOrder as any, 'refcheck-test', 'refcheck-test');
    ql.registry.registerObject(crmOrderLine as any, 'refcheck-test', 'refcheck-test');
    await ql.syncSchemas();

    const orgs = await ql.find('sys_organization', { context: SYS });
    const tenantId = String(orgs[0].id);
    memberCtx = { userId: MEMBER, tenantId, positions: ['org_member'], permissions: ['member_default', 'task_write'] };

    for (const id of [MEMBER, OTHER, DELETED]) {
      await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: SYS });
    }
    await ql.delete('sys_user', { where: { id: DELETED }, context: SYS });
    expect(await ql.findOne('sys_user', { where: { id: DELETED }, context: SYS })).toBeFalsy();
  }

  const tasks = async () => ((await ql.find('crm_task', { context: SYS })) as any[])
    .map((r) => ({ title: r.title, assignee: r.assignee ?? null }))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));

  /** The user path's answer for the same dangling assignee: the member's own create. */
  async function userPathRefusal() {
    const e: any = await ql.insert('crm_task', { title: 'user path', assignee: DELETED }, { context: { ...memberCtx } })
      .then(() => undefined, (err) => err);
    expect(e?.fields?.map((f: any) => [f.field, f.code])).toEqual([['assignee', 'reference_not_found']]);
    return e;
  }

  it('create_record naming a deleted user is refused with the user path\'s reference_not_found, and nothing is written', async () => {
    await boot();
    const userPath = await userPathRefusal();
    automation.registerFlow('fanout', systemFlow('fanout', {
      type: 'create_record', config: { objectName: 'crm_task', fields: { title: 'for deleted', assignee: DELETED } },
    }) as any);

    const res: any = await automation.execute('fanout', { ...memberCtx });

    expect(res.success).toBe(false);
    expect(res.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: userPath.message });
    expect(res.innerRefusal.message).toBe(`Assignee: no sys_user record has id "${DELETED}"`);
    expect(await tasks()).toEqual([]);
  });

  it('update_record naming a deleted user is refused the same way, and the row keeps its assignee', async () => {
    await boot();
    const userPath = await userPathRefusal();
    const row: any = await ql.insert('crm_task', { title: 'reassign me', assignee: OTHER, owner_id: MEMBER, created_by: MEMBER }, { context: SYS });
    automation.registerFlow('reassign', systemFlow('reassign', {
      type: 'update_record', config: { objectName: 'crm_task', filter: { id: row.id }, fields: { assignee: DELETED } },
    }) as any);

    const res: any = await automation.execute('reassign', { ...memberCtx });

    expect(res.success).toBe(false);
    expect(res.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: userPath.message });
    expect(await tasks()).toEqual([{ title: 'reassign me', assignee: OTHER }]);
  });

  // The master_detail arm asks `masterDetailHeaderExists`, which only a flow
  // run's write (or one it sets off) reaches as a system caller.
  it('create_record naming a deleted master_detail header is refused with the user path\'s answer; a live header is written', async () => {
    await boot();
    const live: any = await ql.insert('crm_order', { title: 'live' }, { context: SYS });
    const gone: any = await ql.insert('crm_order', { title: 'gone' }, { context: SYS });
    await ql.delete('crm_order', { where: { id: gone.id }, context: SYS });
    const userPath: any = await ql.insert('crm_order_line', { title: 'user path', order: gone.id }, { context: { ...memberCtx } })
      .then(() => undefined, (err) => err);
    expect(userPath?.fields?.map((f: any) => [f.field, f.code])).toEqual([['order', 'reference_not_found']]);
    automation.registerFlow('line_gone', systemFlow('line_gone', {
      type: 'create_record', config: { objectName: 'crm_order_line', fields: { title: 'on gone', order: gone.id } },
    }) as any);
    automation.registerFlow('line_live', systemFlow('line_live', {
      type: 'create_record', config: { objectName: 'crm_order_line', fields: { title: 'on live', order: live.id } },
    }) as any);

    const refused: any = await automation.execute('line_gone', { ...memberCtx });
    const written: any = await automation.execute('line_live', { ...memberCtx });

    expect(refused.success).toBe(false);
    expect(refused.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: userPath.message });
    expect(written.success, `run failed: ${JSON.stringify(written)}`).toBe(true);
    const lines = ((await ql.find('crm_order_line', { context: SYS })) as any[]).map((r) => [r.title, r.order]);
    expect(lines).toEqual([['on live', live.id]]);
  });

  it('elevation control: the same system run still writes a row its trigger user may not write', async () => {
    await boot();
    const row: any = await ql.insert('crm_task', { title: 'theirs', assignee: OTHER, owner_id: OTHER, created_by: OTHER }, { context: SYS });
    // The trigger user cannot write it on the user path (owner_only_writes).
    const denied: any = await ql.update('crm_task', { id: row.id, assignee: MEMBER }, { context: { ...memberCtx } })
      .then(() => undefined, (err) => err);
    expect(denied?.code).toBe('PERMISSION_DENIED');
    automation.registerFlow('takeover', systemFlow('takeover', {
      type: 'update_record', config: { objectName: 'crm_task', filter: { id: row.id }, fields: { assignee: MEMBER } },
    }) as any);

    const res: any = await automation.execute('takeover', { ...memberCtx });

    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(await tasks()).toEqual([{ title: 'theirs', assignee: MEMBER }]);
  });

  it('control: a seed write and an import\'s batched create under a system principal still store a not-yet-existing reference', async () => {
    await boot();
    await ql.insert('crm_task', { title: 'seeded', assignee: NEVER_YET }, { context: SEED_WRITE_EXECUTION_CONTEXT as any });
    // The context the import door builds for an in-process system principal
    // (`importUndoWriteContext`, rest): the caller's, with automations and the
    // state machine off.
    await (ql as any).insertMany('crm_task', [{ title: 'imported', assignee: NEVER_YET }], {
      context: { ...SYS, skipAutomations: true, skipStateMachine: true },
    });
    expect(await tasks()).toEqual([
      { title: 'imported', assignee: NEVER_YET },
      { title: 'seeded', assignee: NEVER_YET },
    ]);
  });
});
