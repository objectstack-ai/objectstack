// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24519 — what an approval's status write-back hands the automation it fires.
 *
 * The status mirror (`ApprovalService.mirrorStatusField`) is an elevated write
 * made in a person's name: the submitter submitting or recalling, an approver
 * deciding or sending back. A `runAs:'user'` hook on the business object and a
 * `runAs:'user'` record-change flow both run AS that person. The contract,
 * ruled on the card (6271152775): what they run with is that person's own
 * request envelope in the RECORD's organisation — the positions, permission
 * sets and organisation peers `resolveUserAuthzGrants(user, { tenantId })`
 * answers — for every door that names a person, an approver drawn from another
 * organisation's directory included.
 *
 * Two producer facts make that true, and each has its own pins here:
 *  - the write names the organisation (`tenantId`), read live off the record.
 *    Without it every consumer resolves organisation-less: the person alone as
 *    peer, and grants that are not the ones the record's organisation gives;
 *  - the write carries NO `positions` / `permissions` of its own. A consumer
 *    keeps carried arrays verbatim, so empty ones stood in for the person's
 *    grants and left the hook on the member baseline.
 *
 * Real kernel, real ObjectQL engine with its hook wrappers, real record-change
 * trigger and automation engine, real `ApprovalService` and approval node
 * executor, driver-sql on better-sqlite3 `:memory:`. The authz tables the
 * resolver reads are spelled locally (the `status-mirror-cascade` precedent:
 * no dependency edge onto `plugin-auth` / `plugin-security`), and the security
 * catalog that names a permission set is bound with the package's test kit.
 * What the security plugin then ENFORCES for a given envelope is pinned where
 * the seed lives (`service-automation`'s `runas-user-hook-org-peers`); this file
 * pins what the producer hands over.
 *
 * Fixture, all synthetic:
 *  - organisation A (the Default Organization) and organisation B;
 *  - `submitter`: member of A, and of B under a role (`probe_role_b`) held in B
 *    only — the person whose memberships differ between organisations;
 *  - `approver`: member of A, holding an A-scoped grant of a permission set
 *    (`probe_grant_beyond_baseline`) the baseline does not carry;
 *  - `peer`: member of A; `outsider`: member of B;
 *  - `xorg`: member of B only — an approver from another organisation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants } from '@objectstack/core';
import { ObjectQLPlugin, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { APPROVAL_BRANCH_LABELS, APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const ORG_A = 'org_default';
const ORG_B = 'org_b';
const EXTRA_SET = 'probe_grant_beyond_baseline';
const ROLE_ONLY_IN_B = 'probe_role_b';
const SYS = { isSystem: true } as const;
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const text = (name: string) => ({ name, type: 'text' as const });
/**
 * The columns `resolveUserAuthzGrants` reads, and nothing else. Platform-global
 * here (ADR-0066): the real tables are better-auth's and carry their own
 * `organization_id` as data, which is all the resolver filters on.
 */
const PLATFORM_GLOBAL = { enabled: false };
const authzObjects = [
  { owner: '@objectstack/plugin-auth', def: { name: 'sys_user', label: 'User', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, email: text('email') } } },
  { owner: '@objectstack/plugin-auth', def: { name: 'sys_member', label: 'Member', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') } } },
  { owner: '@objectstack/plugin-security', def: { name: 'sys_user_position', label: 'User Position', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), position: text('position'), organization_id: text('organization_id') } } },
  { owner: '@objectstack/plugin-security', def: { name: 'sys_user_permission_set', label: 'User Permission Set', tenancy: PLATFORM_GLOBAL, fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), permission_set: text('permission_set'), organization_id: text('organization_id') } } },
] as const;

const deal = {
  name: 'probe_deal',
  label: 'Probe deal',
  fields: { name: text('name'), approval_status: text('approval_status') },
};
/** Read by the hook and nothing else, so the context the read carries is the hook's own. */
const hookSink = { name: 'probe_hook_sink', label: 'Hook sink', tenancy: { enabled: false }, fields: { name: text('name') } };

const FLOW_NAME = 'deal_approval';
const NODE_ID = 'approve_step';
/** The owning flow `sendBack` checks for its revise window. */
const owningFlow = {
  name: FLOW_NAME,
  nodes: [{ id: NODE_ID, type: 'approval' }, { id: 'revise_window', type: APPROVAL_REVISE_NODE_TYPE }],
  edges: [{ id: 'r', source: NODE_ID, target: 'revise_window', label: APPROVAL_BRANCH_LABELS.revise }],
};
/** The automation an author writes against the mirrored field: runs as the person, records what it runs with. */
const cascadeFlow = {
  name: 'probe_mirror_cascade',
  label: 'Probe mirror cascade',
  type: 'record_change',
  runAs: 'user',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'probe_deal', triggerType: 'record-after-update' } },
    { id: 'capture', type: 'probe_capture', label: 'Capture' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'capture' }, { id: 'e2', source: 'capture', target: 'end' }],
};

/** A door's own context: the person, as the REST layer hands it (its grants are not what the mirror reads). */
const asPerson = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

type Envelope = { tenantId: unknown; positions: unknown; permissions: unknown; org_user_ids: unknown };
const sorted = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : 'ABSENT');
const envelopeOf = (c: any): Envelope => ({
  tenantId: c?.tenantId,
  positions: sorted(c?.positions),
  permissions: sorted(c?.permissions),
  org_user_ids: sorted(c?.org_user_ids),
});

describe("the status mirror hands a runAs:'user' cascade the person's own request envelope in the record's organisation (#24519)", () => {
  let kernel: ObjectKernel;
  let ql: any;
  let svc: ApprovalService;
  let openNode: (recordId: string, submitter: string, approvers: string[], config?: Record<string, unknown>) => Promise<string>;
  /** The context of every write to the business object, in order. */
  let writes: any[];
  /** The context the `runAs:'user'` hook's read carried, per firing. */
  let hookSeen: any[];
  /** A refusal the hook's read met, per firing that met one. */
  let hookRefusals: string[];
  /** The context the `runAs:'user'` record-change flow ran with, per run. */
  let flowSeen: any[];

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();
    ql = kernel.getService('objectql');
    const automation = kernel.getService<AutomationEngine>('automation');

    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    for (const def of [deal, hookSink, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation, SysApprovalToken]) {
      ql.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    for (const o of authzObjects) ql.registry.registerObject(o.def as any, o.owner);
    ql.registry.registerObject(
      { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: text('name'), slug: text('slug') } } as any,
      '@objectstack/plugin-auth',
    );
    await ql.syncSchemas();
    bindTestSecurityCatalog(ql, { permissions: [{ name: EXTRA_SET }] });

    await ql.insert('sys_organization', { id: ORG_A, name: 'Default Organization', slug: 'default' }, { context: SYS });
    await ql.insert('sys_organization', { id: ORG_B, name: 'Organisation B', slug: 'org-b' }, { context: SYS });
    for (const id of ['submitter', 'approver', 'peer', 'outsider', 'xorg']) {
      await ql.insert('sys_user', { id, email: `${id}@example.test` }, { context: SYS });
    }
    const members: Array<[string, string, string]> = [
      ['submitter', ORG_A, 'member'], ['submitter', ORG_B, ROLE_ONLY_IN_B],
      ['approver', ORG_A, 'member'], ['peer', ORG_A, 'member'],
      ['outsider', ORG_B, 'member'], ['xorg', ORG_B, 'member'],
    ];
    for (const [userId, org, role] of members) {
      await ql.insert('sys_member', { id: `mem_${userId}_${org}`, user_id: userId, organization_id: org, role }, { context: SYS });
    }
    await ql.insert('sys_user_permission_set', {
      id: 'ups_approver_extra', user_id: 'approver', permission_set: EXTRA_SET, organization_id: ORG_A,
    }, { context: SYS });

    writes = [];
    hookSeen = [];
    hookRefusals = [];
    flowSeen = [];
    ql.registerMiddleware(async (opCtx: any, next: any) => {
      if (opCtx.object === 'probe_hook_sink') hookSeen.push({ ...(opCtx.context ?? {}) });
      if (opCtx.object === 'probe_deal' && opCtx.operation === 'update') writes.push({ ...(opCtx.context ?? {}) });
      return next();
    });
    bindHooksToEngine(ql, [{
      name: 'probe_reads_as_the_person',
      object: 'probe_deal',
      events: ['afterUpdate'],
      priority: 100,
      runAs: 'user',
      handler: async (ctx: any) => {
        try {
          await ctx.api.object('probe_hook_sink').find({ fields: ['id'] });
        } catch (e: any) {
          hookRefusals.push(String(e?.code ?? e?.message ?? e));
        }
      },
    } as any], { packageId: 'app:test', logger: silent as any });

    automation.registerNodeExecutor({
      type: 'probe_capture',
      async execute(_node: any, _vars: any, context: any) {
        flowSeen.push({ ...(context ?? {}) });
        return { success: true };
      },
    } as any);
    automation.registerFlow(cascadeFlow.name, cascadeFlow as any);

    svc = new ApprovalService({
      engine: ql,
      automation: {
        resume: async () => ({ status: 'completed' }),
        getRun: async (runId: string) => ({ id: runId, status: 'suspended' }),
        hasSuspendedRun: async () => true,
        cancelRun: async () => undefined,
        getFlow: async (name: string) => (name === FLOW_NAME ? owningFlow : undefined),
      } as any,
      logger: silent as any,
    });
    let executor: any;
    registerApprovalNode({ registerNodeExecutor: (e: any) => { if (e.type === 'approval') executor = e; } } as any, svc, silent);

    /** Open a request through the REAL approval node, as a `runAs:'user'` approval flow acting in A runs it. */
    openNode = async (recordId, submitter, approvers, config = {}) => {
      const vars = new Map<string, unknown>([
        ['$runId', `run_${recordId}`], ['$flowName', FLOW_NAME], ['$record', { id: recordId, name: recordId }],
      ]);
      const out = await executor.execute(
        {
          id: NODE_ID, type: 'approval',
          config: { approvers: approvers.map((value) => ({ type: 'user', value })), behavior: 'first_response', lockRecord: false, approvalStatusField: 'approval_status', ...config },
        },
        vars,
        { userId: submitter, tenantId: ORG_A, object: 'probe_deal' },
      );
      expect(out.success, JSON.stringify(out)).toBe(true);
      return String(out.correlation);
    };
  });

  async function seedDeal(id: string, org = ORG_A) {
    await ql.insert('probe_deal', { id, name: id, organization_id: org }, { context: { isSystem: true, tenantId: org } });
  }

  /** What the person's own request acting in `org` carries: the request path's resolver, by construction. */
  async function requestEnvelope(userId: string, org: string): Promise<Envelope> {
    const g = await resolveUserAuthzGrants(ql, userId, { tenantId: org, bypassGrantsCache: true });
    return envelopeOf({ tenantId: org, positions: g.positions, permissions: g.permissions, org_user_ids: g.org_user_ids });
  }

  /** Wait for the cascade a mirror write fired: the hook runs in the write, the flow after it. */
  async function cascade(before: { hooks: number; flows: number }) {
    for (let i = 0; i < 150 && flowSeen.length <= before.flows; i++) await sleep(20);
    expect(hookSeen.length + hookRefusals.length, 'the hook ran exactly once').toBe(before.hooks + 1);
    expect(flowSeen.length, 'the record-change flow ran exactly once').toBe(before.flows + 1);
    return { write: writes[writes.length - 1], hook: hookSeen[hookSeen.length - 1], flow: flowSeen[flowSeen.length - 1] };
  }
  const mark = () => ({ hooks: hookSeen.length + hookRefusals.length, flows: flowSeen.length });

  /** The producer half: elevated, attributed, the record's organisation, no grants of its own. */
  function expectAttributedWrite(write: any, userId: string, org: string) {
    expect(write.isSystem).toBe(true);
    expect(write.userId).toBe(userId);
    expect(write.tenantId).toBe(org);
    expect('positions' in write, 'the write carries no positions of its own').toBe(false);
    expect('permissions' in write, 'the write carries no permission sets of its own').toBe(false);
  }

  /** The consumers first (what an author's automation sees), then the producer fact that explains it. */
  async function expectPersonInOrg(seen: { write: any; hook: any; flow: any }, userId: string, org: string) {
    const expected = await requestEnvelope(userId, org);
    expect(seen.hook.userId).toBe(userId);
    expect(seen.hook.isSystem).toBe(false);
    expect(envelopeOf(seen.hook), "the runAs:'user' hook").toEqual(expected);
    expect(seen.flow.userId).toBe(userId);
    expect(envelopeOf(seen.flow), "the runAs:'user' record-change flow").toEqual(expected);
    expectAttributedWrite(seen.write, userId, org);
    return seen;
  }

  it('open, through the approval node: the submitter in the record organisation, and no role held only in another organisation', async () => {
    await seedDeal('d_open');
    const before = mark();
    const requestId = await openNode('d_open', 'submitter', ['approver']);
    const [request] = await ql.find('sys_approval_request', { where: { id: requestId }, context: SYS });
    expect(request.organization_id, 'fixture premise: the request is stamped with the record organisation').toBe(ORG_A);
    const { hook, flow } = await expectPersonInOrg(await cascade(before), 'submitter', ORG_A);
    // The person whose memberships differ: what A grants, never what B does.
    expect(hook.positions).not.toContain(ROLE_ONLY_IN_B);
    expect(flow.positions).not.toContain(ROLE_ONLY_IN_B);
    expect(sorted(hook.org_user_ids)).toEqual(['approver', 'peer', 'submitter']);
  });

  it('decide approve: the approver carries the grant they hold beyond the baseline, and their organisation peers', async () => {
    await seedDeal('d_approve');
    const requestId = await openNode('d_approve', 'submitter', ['approver']);
    const before = mark();
    await svc.decide(requestId, { decision: 'approve', actorId: 'approver' } as any, asPerson('approver'));
    const { hook, flow } = await expectPersonInOrg(await cascade(before), 'approver', ORG_A);
    // The grant beyond the baseline is the approver's, so the automation that runs as them holds it.
    expect(hook.permissions).toContain(EXTRA_SET);
    expect(flow.permissions).toContain(EXTRA_SET);
    expect(sorted(hook.org_user_ids)).toEqual(['approver', 'peer', 'submitter']);
  });

  it('decide reject: the approver, in the record organisation', async () => {
    await seedDeal('d_reject');
    const requestId = await openNode('d_reject', 'submitter', ['approver']);
    const before = mark();
    await svc.decide(requestId, { decision: 'reject', actorId: 'approver' } as any, asPerson('approver'));
    const { hook } = await expectPersonInOrg(await cascade(before), 'approver', ORG_A);
    expect(hook.permissions).toContain(EXTRA_SET);
  });

  it('recall: the submitter, in the record organisation', async () => {
    await seedDeal('d_recall');
    const requestId = await openNode('d_recall', 'submitter', ['approver']);
    const before = mark();
    await svc.recall(requestId, { actorId: 'submitter' } as any, asPerson('submitter'));
    const { hook, flow } = await expectPersonInOrg(await cascade(before), 'submitter', ORG_A);
    expect(hook.positions).not.toContain(ROLE_ONLY_IN_B);
    expect(flow.positions).not.toContain(ROLE_ONLY_IN_B);
  });

  it('send back for revision: the approver, in the record organisation', async () => {
    await seedDeal('d_returned');
    const requestId = await openNode('d_returned', 'submitter', ['approver']);
    const before = mark();
    await svc.sendBack(requestId, { actorId: 'approver' } as any, asPerson('approver'));
    const seen = await cascade(before);
    expect((await ql.find('probe_deal', { where: { id: 'd_returned' }, context: SYS }))[0].approval_status).toBe('returned');
    await expectPersonInOrg(seen, 'approver', ORG_A);
  });

  it('send back past the revision limit (auto-reject): the approver, in the record organisation', async () => {
    await seedDeal('d_autoreject');
    const requestId = await openNode('d_autoreject', 'submitter', ['approver'], { maxRevisions: 0 });
    const before = mark();
    await svc.sendBack(requestId, { actorId: 'approver' } as any, asPerson('approver'));
    const seen = await cascade(before);
    expect((await ql.find('probe_deal', { where: { id: 'd_autoreject' }, context: SYS }))[0].approval_status).toBe('rejected');
    await expectPersonInOrg(seen, 'approver', ORG_A);
  });

  it('the action link: the approver the token binds, in the record organisation', async () => {
    await seedDeal('d_link');
    const requestId = await openNode('d_link', 'submitter', ['approver']);
    const { approve } = await svc.issueActionTokens(requestId, 'approver');
    const before = mark();
    expect(await svc.redeemActionToken(approve)).toMatchObject({ ok: true, action: 'approve' });
    await expectPersonInOrg(await cascade(before), 'approver', ORG_A);
  });

  it("an approver from another organisation's directory acts in the record's organisation", async () => {
    await seedDeal('d_xorg');
    const requestId = await openNode('d_xorg', 'submitter', ['xorg']);
    const before = mark();
    await svc.decide(requestId, { decision: 'approve', actorId: 'xorg' } as any, asPerson('xorg'));
    const { hook, flow } = await expectPersonInOrg(await cascade(before), 'xorg', ORG_A);
    // The record organisation's members (and the approver), never their own organisation's.
    expect(sorted(hook.org_user_ids)).toEqual(['approver', 'peer', 'submitter', 'xorg']);
    expect(sorted(flow.org_user_ids)).toEqual(['approver', 'peer', 'submitter', 'xorg']);
  });

  it("the organisation is the record's live one: a record re-parented while its request was pending", async () => {
    await seedDeal('d_moved');
    const requestId = await openNode('d_moved', 'submitter', ['approver']);
    await ql.update('probe_deal', { id: 'd_moved', organization_id: ORG_B }, { context: SYS });
    const before = mark();
    await svc.decide(requestId, { decision: 'approve', actorId: 'approver' } as any, asPerson('approver'));
    await expectPersonInOrg(await cascade(before), 'approver', ORG_B);
  });

  it('CONTROL — a release nobody decided (the dead-run sweep) stays user-less: the hook is refused and the flow has no person', async () => {
    await seedDeal('d_sweep');
    await openNode('d_sweep', 'submitter', ['approver']);
    svc.attachAutomation({ getRun: async () => ({ status: 'failed' }) } as any);
    const reads = hookSeen.length;
    const flows = flowSeen.length;
    await svc.releaseDeadRunRequests();
    for (let i = 0; i < 150 && flowSeen.length <= flows; i++) await sleep(20);
    expect((await ql.find('probe_deal', { where: { id: 'd_sweep' }, context: SYS }))[0].approval_status).toBe('recalled');
    const write = writes[writes.length - 1];
    expect(write.isSystem).toBe(true);
    expect(write.userId).toBeUndefined();
    expect(hookSeen.length, "a user-less write gives the runAs:'user' hook nobody to read as").toBe(reads);
    expect(hookRefusals).toEqual([expect.stringContaining('HOOK_UNSCOPED_DATA_ACCESS')]);
    expect(flowSeen.length).toBe(flows + 1);
    expect(flowSeen[flowSeen.length - 1].userId).toBeUndefined();
  });
});
