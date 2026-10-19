// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `runAs:'user'` flow reads and writes the rows an email-keyed row policy
 * grants its user, exactly as that user's own request does: the email-keyed
 * twin of `runas-user-org-peers.integration.test.ts`.
 *
 * The defect this pins: the run's data context carried no `email`. The RLS
 * compiler binds `current_user.email` from the execution context's `email`
 * and nothing else, so a policy such as `assignee == current_user.email` (the
 * stock showcase's `task_own_rows`) dropped out inside the run, and a
 * record-change flow was refused on the row its triggering member had just
 * written and could read and update with their own request. On the request
 * path the email is seeded by the core resolver (`resolveUserAuthzGrants`,
 * through `resolveAuthzContext`); the run now seeds it through the same
 * resolver at run setup, and the decider's segment through the same seed.
 *
 * The REAL stack runs here, as in its twin: ObjectKernel, ObjectQLPlugin,
 * driver-sql on better-sqlite3 `:memory:`, the identity objects, the real
 * SecurityPlugin with its shipped default permission sets plus the fixture's
 * set, and the real AutomationEngine and CRUD nodes. The defect lived in the
 * hand-off between the run's identity and the RLS compiler, which no
 * single-layer test sees.
 *
 * Fixture: `qa_owner_task`, whose only row scope is the set
 * `qa_owner_contributor`: select and update both keyed on
 * `assignee == current_user.email`. `usr_member` and `usr_decider` hold the
 * set in the Default Organization, each with their own stored email.
 *
 * The record-change runs are started with the record-change trigger's own
 * envelope (`record`, `object`, `event`, `userId`, `tenantId`, `params`: what
 * `@objectstack/trigger-record-change` hands `automation.execute`), which
 * carries no positions, permission sets or email. That package depends on
 * this one, so its trigger is not composed here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE, type ResumeSignal } from '@objectstack/spec/contracts';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const SYS = { isSystem: true } as const;
const OBJECT = 'qa_owner_task';
const MEMBER = 'usr_member';
const DECIDER = 'usr_decider';
const EMAIL: Record<string, string> = {
  [MEMBER]: 'qa-member@example.test',
  [DECIDER]: 'qa-decider@example.test',
};

/** The showcase task's shape, cut to the fields the policy and the stamp read. */
const taskObject = {
  name: OBJECT,
  label: 'Owner task',
  sharingModel: 'public_read_write',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    assignee: { name: 'assignee', label: 'Assignee', type: 'text' },
    notes: { name: 'notes', label: 'Notes', type: 'text' },
  },
};

/** `showcase_contributor`'s `task_own_rows`, on both verbs the run uses. */
const contributorSet = PermissionSetSchema.parse({
  name: 'qa_owner_contributor',
  label: 'Owner task contributor',
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
  rowLevelSecurity: [
    { name: 'qa_task_own_rows', object: OBJECT, operation: 'select', using: 'assignee == current_user.email' },
    { name: 'qa_task_own_writes', object: OBJECT, operation: 'update', using: 'assignee == current_user.email' },
  ],
});

const cel = (source: string) => ({ dialect: 'cel', source });

/**
 * The card's flow: a `runAs:'user'` record-change flow that reads the row it
 * was triggered by, then stamps `notes` with `current_user.id`.
 */
const stampFlow = (name: string, runAs: 'user' | 'system' = 'user') => ({
  name,
  label: name,
  type: 'record_change',
  runAs,
  variables: [{ name: 'seen', type: 'object', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: OBJECT, triggerType: 'record-after-insert' } },
    { id: 'read', type: 'get_record', label: 'Read', config: { objectName: OBJECT, filter: { id: cel('record.id') }, outputVariable: 'seen' } },
    { id: 'stamp', type: 'update_record', label: 'Stamp', config: { objectName: OBJECT, filter: { id: cel('record.id') }, fields: { notes: cel('current_user.id') } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'read' },
    { id: 'e2', source: 'read', target: 'stamp' },
    { id: 'e3', source: 'stamp', target: 'end' },
  ],
});

/** The approval node's stand-in: a pause only its owning service may continue. */
const GATED = defineActionDescriptor({
  type: 'decision_gate', version: '1.0.0', name: 'Decision Gate',
  supportsPause: true, resumeAuthority: 'service',
});

/** What `ApprovalService.decide` hands the engine for a human decision. */
const decided = (resumedBy: string): ResumeSignal => ({
  branchLabel: 'approve',
  output: { decision: 'approve' },
  resumedBy,
  [RESUME_AUTHORITY_SERVICE]: true,
});

/** start → gate → stamp(`taskId`, notes = current_user.id) → end, under runAs:'user'. */
const reviewFlow = (name: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  runAs: 'user',
  variables: [{ name: 'taskId', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'gate', type: 'decision_gate', label: 'Review' },
    { id: 'after', type: 'update_record', label: 'After the decision', config: { objectName: OBJECT, filter: { id: cel('taskId') }, fields: { notes: cel('current_user.id') } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'gate' },
    { id: 'e2', source: 'gate', target: 'after', label: 'approve' },
    { id: 'e3', source: 'after', target: 'end' },
  ],
});

describe("a runAs:'user' flow reads and writes the rows an email-keyed policy grants its user, as the user's own request does", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let orgA = '';

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
    await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, contributorSet] }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');
    automation.registerNodeExecutor({ type: 'decision_gate', descriptor: GATED, async execute() { return { success: true, suspend: true }; } });
    ql.registry.registerObject(taskObject as any, 'email-owner-test', 'email-owner-test');
    await ql.syncSchemas();

    const orgs = await ql.find('sys_organization', { context: SYS });
    expect(orgs.map((o: any) => o.slug)).toEqual(['default']);
    orgA = String(orgs[0].id);
    for (const id of [MEMBER, DECIDER]) {
      await ql.insert('sys_user', { id, name: id, email: EMAIL[id] }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: orgA, role: 'member' }, { context: SYS });
      await ql.insert('sys_user_permission_set', { id: `ups_${id}`, user_id: id, permission_set: contributorSet.name, organization_id: orgA }, { context: SYS });
    }

    automation.registerFlow('qa_stamp_current_user', stampFlow('qa_stamp_current_user') as never);
    automation.registerFlow('qa_stamp_system', stampFlow('qa_stamp_system', 'system') as never);
    automation.registerFlow('qa_review', reviewFlow('qa_review') as never);
  }, 30_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  /**
   * The context the request path hands ObjectQL for `userId` acting in the
   * organization: `resolveAuthzContext` copies exactly these grants onto it,
   * the email included (`ctx.email`, the session's or else the stored one).
   */
  async function requestContext(userId: string, opts: { email?: boolean } = {}) {
    const g = await resolveUserAuthzGrants(ql, userId, { tenantId: orgA, bypassGrantsCache: true });
    return {
      userId,
      tenantId: orgA,
      isSystem: false,
      positions: g.positions,
      permissions: g.permissions,
      systemPermissions: g.systemPermissions,
      org_user_ids: g.org_user_ids,
      accessible_org_ids: g.accessible_org_ids,
      ...(opts.email === false || !g.email ? {} : { email: g.email }),
    };
  }

  const stored = async (id: string) => (await ql.findOne(OBJECT, { where: { id }, context: SYS })) as any;

  /** The member writes a task assigned to `assignee` through their own request. */
  async function memberWrites(title: string, assignee = EMAIL[MEMBER]) {
    const row: any = await ql.insert(OBJECT, { title, assignee }, { context: await requestContext(MEMBER) });
    return { ...row, ...(await stored(String(row.id))) };
  }

  /** A task the platform writes, assigned to `assignee`: nobody's own write. */
  async function systemWrites(title: string, assignee: string) {
    const row: any = await ql.insert(OBJECT, { title, assignee }, { context: SYS });
    return String(row.id);
  }

  /** What the record-change trigger hands `automation.execute` for the member's insert. */
  const recordChangeEnvelope = (row: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    record: row,
    object: OBJECT,
    event: 'record-after-insert',
    userId: MEMBER,
    tenantId: orgA,
    params: row,
    ...extra,
  });

  it("CONTROL — the member's own request reads and updates the row assigned to their email", async () => {
    const row = await memberWrites('qa-flow control');
    const ctx = await requestContext(MEMBER);
    expect(ctx.email, 'the request path seeds the stored email').toBe(EMAIL[MEMBER]);
    expect((await ql.findOne(OBJECT, { where: { id: row.id }, context: ctx }) as any)?.id).toBe(row.id);
    await ql.update(OBJECT, { id: row.id, notes: 'by hand' }, { context: ctx });
    expect((await stored(row.id)).notes).toBe('by hand');
  });

  it('GUARD — the email-keyed policy is the only access: the same request without the email does not see the row', async () => {
    const row = await memberWrites('qa-flow guard');
    const noEmail = await requestContext(MEMBER, { email: false });
    expect(await ql.findOne(OBJECT, { where: { id: row.id }, context: noEmail })).toBeFalsy();
  });

  it("the card's reproduction: a record-change run triggered by the member reads the row and stamps it with the member's id", async () => {
    const row = await memberWrites('qa-flow-member3');
    const res: any = await automation.execute('qa_stamp_current_user', recordChangeEnvelope(row) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(res.output?.seen?.id, 'the run read the row').toBe(row.id);
    expect((await stored(row.id)).notes, 'the stamp is the member').toBe(MEMBER);
  });

  it("the doors' pre-resolved shape (positions and permission sets forwarded, no email) reads and stamps the same", async () => {
    const row = await memberWrites('qa-flow forwarded');
    const req = await requestContext(MEMBER);
    const res: any = await automation.execute('qa_stamp_current_user', recordChangeEnvelope(row, {
      positions: req.positions, permissions: req.permissions,
    }) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect((await stored(row.id)).notes).toBe(MEMBER);
  });

  it("nothing beyond: the run is refused on a row assigned to someone else's email, as the member's own request is", async () => {
    const id = await systemWrites('qa-flow theirs', EMAIL[DECIDER]);
    expect(await ql.findOne(OBJECT, { where: { id }, context: await requestContext(MEMBER) }), 'control: the request does not see it').toBeFalsy();
    const res: any = await automation.execute('qa_stamp_current_user', recordChangeEnvelope({ id, title: 'qa-flow theirs' }) as never);
    expect(res.success).toBe(false);
    expect((await stored(id)).notes ?? null, 'nothing landed').toBeNull();
  });

  it("after an approval decision the post-decision write carries the decider's email: the decider's row is stamped with the decider", async () => {
    const id = await systemWrites('qa-flow decider row', EMAIL[DECIDER]);
    const paused = await automation.execute('qa_review', { userId: MEMBER, tenantId: orgA, params: { taskId: id } } as never);
    expect(paused.status, JSON.stringify(paused)).toBe('paused');
    const res: any = await automation.resume(paused.runId!, decided(DECIDER));
    expect(res.success, `resume failed: ${JSON.stringify(res)}`).toBe(true);
    expect((await stored(id)).notes, 'the post-decision write is the decider\'s').toBe(DECIDER);
  });

  it("after an approval decision the submitter's email does not survive: the submitter's row is refused to the decider, as the decider's own request is", async () => {
    const id = await systemWrites('qa-flow submitter row', EMAIL[MEMBER]);
    await expect(
      ql.update(OBJECT, { id, notes: 'by hand' }, { context: await requestContext(DECIDER) }),
      'control: the decider\'s own request may not write the submitter\'s row',
    ).rejects.toThrow();
    const paused = await automation.execute('qa_review', { userId: MEMBER, tenantId: orgA, params: { taskId: id } } as never);
    expect(paused.status, JSON.stringify(paused)).toBe('paused');
    const res: any = await automation.resume(paused.runId!, decided(DECIDER));
    expect(res.success).toBe(false);
    expect((await stored(id)).notes ?? null, 'nothing landed').toBeNull();
  });

  it("CONTROL — a runAs:'system' run is unchanged: elevated, it stamps the row whatever the policy reads", async () => {
    const id = await systemWrites('qa-flow system', 'nobody@example.test');
    const res: any = await automation.execute('qa_stamp_system', recordChangeEnvelope({ id, title: 'qa-flow system' }) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect((await stored(id)).notes).toBe(MEMBER);
  });
});
