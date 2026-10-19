// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * After an approval decision, a `runAs:'user'` run continues as the DECIDER —
 * identity and permissions together (ruling A on `FlowSchema.runAs`:
 * 「the human whose act is running this segment: the trigger user until a
 * human decision, the decider after it」).
 *
 * The defect: a resumed run kept its trigger user for its whole life, so the
 * nodes after a manager's approval wrote as the rep who submitted — the
 * record's `updated_by` and the audit trail named someone who did not act, and
 * the writes ran under the rep's grants rather than the manager's.
 *
 * Two layers, each pinning what the other cannot see:
 *
 *  1. THE ENVELOPE (a bare engine, a recording data double, a grants-resolver
 *     stub): the data context every post-decision node hands the data engine
 *     is the decider's — their id, positions, permission sets and peers, as
 *     the resolver answers for THEM — with nothing of the submitter's left in
 *     it; the nodes before the decision keep the submitter's; the run's
 *     history keeps naming its trigger; a later pause in the same run does not
 *     fall back to the submitter. And the controls: a `runAs:'system'` run, a
 *     signal naming a decider without the owning service's marker, and a
 *     signal with no decider all continue exactly as before.
 *  2. THE REAL STACK (ObjectKernel, ObjectQLPlugin's audit stamps, driver-sql
 *     on better-sqlite3 `:memory:`, the identity objects, the real
 *     SecurityPlugin and record sharing, the grants resolver the automation
 *     plugin bridges): the
 *     stored `updated_by` names the decider after the decision and the
 *     submitter before it; the decider's own grants are what admit the write;
 *     and a post-decision node the decider may not perform — a field their
 *     permission set marks non-editable, which the submitter's set allows —
 *     is refused loudly, the run reporting the node, while the same node
 *     resumed with no decider still lands as the submitter.
 *
 * The pause here is a stand-in for the `approval` node: a node type that
 * declares `resumeAuthority: 'service'`, resumed with the
 * `RESUME_AUTHORITY_SERVICE` marker and `resumedBy` exactly as
 * `ApprovalService.decide` hands them over (that hand-off is pinned in
 * `plugin-approvals`' `decision-resume-decider.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE, type ResumeSignal } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';

const silentLogger = (): any => {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
};

/** The approval node's stand-in: a pause only its owning service may continue. */
const GATED = defineActionDescriptor({
  type: 'decision_gate', version: '1.0.0', name: 'Decision Gate',
  supportsPause: true, resumeAuthority: 'service',
});
/** A pause anyone may continue (a screen's shape): the control for the marker. */
const OPEN = defineActionDescriptor({
  type: 'open_gate', version: '1.0.0', name: 'Open Gate',
  supportsPause: true, resumeAuthority: 'any',
});

function registerGates(engine: AutomationEngine): void {
  engine.registerNodeExecutor({ type: 'decision_gate', descriptor: GATED, async execute() { return { success: true, suspend: true }; } });
  engine.registerNodeExecutor({ type: 'open_gate', descriptor: OPEN, async execute() { return { success: true, suspend: true }; } });
}

/** What `ApprovalService.decide` hands the engine for a human decision. */
const decided = (branchLabel: 'approve' | 'reject', resumedBy?: string): ResumeSignal => ({
  branchLabel,
  output: { decision: branchLabel },
  ...(resumedBy ? { resumedBy } : {}),
  [RESUME_AUTHORITY_SERVICE]: true,
});

const write = (id: string, objectName: string, fields: Record<string, unknown>) => ({
  id, type: 'update_record', label: id,
  config: { objectName, filter: { id: { dialect: 'cel', source: 'dealId' } }, fields },
});

/**
 * start → submit → gate1 ─approve→ after1 → gate2 ─approve→ after2 → end
 *                        └reject→ rejected → end
 * Every write is a node of its own, so each one's data context is read apart.
 */
function reviewFlow(name: string, opts: { runAs?: 'system' | 'user'; gate?: string; objectName?: string; approveFields?: Record<string, unknown> } = {}) {
  const objectName = opts.objectName ?? 'deal';
  return {
    name, label: name, type: 'autolaunched',
    ...(opts.runAs ? { runAs: opts.runAs } : {}),
    variables: [{ name: 'dealId', type: 'text', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      write('submit', objectName, { stage: 'submitted' }),
      { id: 'gate1', type: opts.gate ?? 'decision_gate', label: 'Manager review' },
      write('after1', objectName, opts.approveFields ?? { approved_note: 'approved' }),
      { id: 'gate2', type: 'decision_gate', label: 'Second review' },
      write('after2', objectName, { stage: 'won' }),
      write('rejected', objectName, { stage: 'rejected' }),
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'submit' },
      { id: 'e2', source: 'submit', target: 'gate1' },
      { id: 'e3', source: 'gate1', target: 'after1', label: 'approve' },
      { id: 'e4', source: 'gate1', target: 'rejected', label: 'reject' },
      { id: 'e5', source: 'after1', target: 'gate2' },
      { id: 'e6', source: 'gate2', target: 'after2', label: 'approve' },
      { id: 'e7', source: 'gate2', target: 'rejected', label: 'reject' },
      { id: 'e8', source: 'after2', target: 'end' },
      { id: 'e9', source: 'rejected', target: 'end' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The envelope
// ─────────────────────────────────────────────────────────────────────────────

/** Each user's grants as the resolver answers them, deliberately disjoint. */
const GRANTS: Record<string, { positions: string[]; permissions: string[]; org_user_ids: string[] }> = {
  usr_rep: { positions: ['sales_rep', 'everyone'], permissions: ['deal_rep'], org_user_ids: ['usr_rep', 'usr_mgr', 'usr_dir'] },
  usr_mgr: { positions: ['sales_manager', 'everyone'], permissions: ['deal_manager'], org_user_ids: ['usr_mgr', 'usr_rep'] },
  usr_dir: { positions: ['sales_director', 'everyone'], permissions: ['deal_director'], org_user_ids: ['usr_dir'] },
};

function envelopeHarness(opts: { failFor?: string } = {}) {
  const writes: Array<{ node: unknown; ctx: any }> = [];
  const resolved: Array<[string, string | undefined]> = [];
  const data: any = {
    async find() { return []; },
    async findOne(obj: string, q: any) { assertEngineFindOnePredicate(obj, q); return null; },
    async insert() { return { id: 'x' }; },
    async update(_obj: string, fields: any, opts2: any) { writes.push({ node: fields, ctx: opts2?.context }); return { id: 'd1' }; },
    async delete() { return { ok: true }; },
  };
  const engine = new AutomationEngine(silentLogger(), new InMemorySuspendedRunStore());
  registerCrudNodes(engine, { logger: silentLogger(), getService: (n: string) => (n === 'data' ? data : undefined) } as any);
  registerGates(engine);
  engine.setUserGrantsResolver(async (userId, tenantId) => {
    resolved.push([userId, tenantId]);
    if (userId === opts.failFor) throw new Error(`grants store unreachable for ${userId}`);
    const g = GRANTS[userId];
    return g ? { ...g, tenantId } : undefined;
  });
  /** The data context of the write that set `stage` / `approved_note` to `value`. */
  const ctxOf = (key: string, value: unknown) => writes.find((w) => (w.node as any)?.[key] === value)?.ctx;
  return { engine, writes, resolved, ctxOf };
}

const TRIGGER = { userId: 'usr_rep', tenantId: 'org_a', params: { dealId: 'd1' } };

describe("after an approval decision a runAs:'user' run's data operations carry the decider's identity and permissions", () => {
  it('approve: the nodes after the decision run as the decider, with the decider\'s own resolved grants', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('review', reviewFlow('review') as never);
    const paused = await h.engine.execute('review', { ...TRIGGER } as never);
    expect(paused.status).toBe('paused');

    // Before the decision: the submitter, as today.
    const before = h.ctxOf('stage', 'submitted');
    expect(before).toMatchObject({ isSystem: false, userId: 'usr_rep', permissions: ['deal_rep'] });
    expect(before.positions).toContain('sales_rep');

    const res = await h.engine.resume(paused.runId!, decided('approve', 'usr_mgr'));
    expect(res.status, JSON.stringify(res)).toBe('paused'); // parked again at gate2

    const after = h.ctxOf('approved_note', 'approved');
    expect(after, 'the post-decision write never reached the data engine').toBeTruthy();
    expect(after.isSystem).toBe(false);
    expect(after.userId).toBe('usr_mgr');
    expect(after.tenantId).toBe('org_a');
    // Identity AND permissions together: every authorization fact is the
    // decider's, resolved for them — none of the submitter's survives.
    expect(after.positions).toEqual(GRANTS.usr_mgr.positions);
    expect(after.permissions).toEqual(GRANTS.usr_mgr.permissions);
    expect(after.org_user_ids).toEqual(GRANTS.usr_mgr.org_user_ids);
    expect(after.positions).not.toContain('sales_rep');
    expect(after.permissions).not.toContain('deal_rep');
    // Through the same resolver the trigger was seeded through, for the decider.
    expect(h.resolved).toContainEqual(['usr_mgr', 'org_a']);
  });

  it('reject: the reject branch runs as the decider too', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('review', reviewFlow('review') as never);
    const paused = await h.engine.execute('review', { ...TRIGGER } as never);
    const res = await h.engine.resume(paused.runId!, decided('reject', 'usr_mgr'));
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(h.ctxOf('stage', 'rejected')).toMatchObject({ userId: 'usr_mgr', permissions: ['deal_manager'] });
  });

  it('a later pause keeps the decider: a resume that names no decider does not fall back to the submitter', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('review', reviewFlow('review') as never);
    const paused = await h.engine.execute('review', { ...TRIGGER } as never);
    await h.engine.resume(paused.runId!, decided('approve', 'usr_mgr'));
    // The second gate continued by its owning service with no human decider
    // (an SLA auto-decision's shape).
    const res = await h.engine.resume(paused.runId!, decided('approve'));
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(h.ctxOf('stage', 'won')).toMatchObject({ userId: 'usr_mgr', permissions: ['deal_manager'] });
  });

  it('a second decision moves the segment to its own decider, and the run history still names the trigger', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('review', reviewFlow('review') as never);
    const paused = await h.engine.execute('review', { ...TRIGGER } as never);
    await h.engine.resume(paused.runId!, decided('approve', 'usr_mgr'));
    const res = await h.engine.resume(paused.runId!, decided('approve', 'usr_dir'));
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(h.ctxOf('stage', 'won')).toMatchObject({ userId: 'usr_dir', permissions: ['deal_director'] });
    expect(h.ctxOf('stage', 'won').org_user_ids).toEqual(GRANTS.usr_dir.org_user_ids);

    const run = await h.engine.getRun(paused.runId!);
    expect(run?.status).toBe('completed');
    expect(run?.trigger?.userId, 'the run history must keep naming who triggered the run').toBe('usr_rep');
  });

  it("a decider whose grants cannot be resolved runs on the baseline, never on the submitter's grants", async () => {
    const h = envelopeHarness({ failFor: 'usr_mgr' });
    h.engine.registerFlow('review', reviewFlow('review') as never);
    const paused = await h.engine.execute('review', { ...TRIGGER } as never);
    await h.engine.resume(paused.runId!, decided('approve', 'usr_mgr'));
    const after = h.ctxOf('approved_note', 'approved');
    expect(after.userId).toBe('usr_mgr');
    expect(after.positions).toEqual([]);
    expect(after.permissions).toEqual([]);
    expect(after.org_user_ids).toBeUndefined();
  });

  describe('controls — unchanged', () => {
    it("CONTROL: a runAs:'system' run keeps its elevation and its carried trigger user", async () => {
      const h = envelopeHarness();
      h.engine.registerFlow('sys_review', reviewFlow('sys_review', { runAs: 'system' }) as never);
      const paused = await h.engine.execute('sys_review', { ...TRIGGER } as never);
      await h.engine.resume(paused.runId!, decided('approve', 'usr_mgr'));
      expect(h.ctxOf('approved_note', 'approved')).toMatchObject({ isSystem: true, userId: 'usr_rep', positions: [], permissions: [] });
    });

    it('CONTROL: a decider named WITHOUT the owning service\'s marker changes nothing', async () => {
      const h = envelopeHarness();
      h.engine.registerFlow('open_review', reviewFlow('open_review', { gate: 'open_gate' }) as never);
      const paused = await h.engine.execute('open_review', { ...TRIGGER } as never);
      // What an HTTP body can build: no symbol-keyed marker.
      const res = await h.engine.resume(paused.runId!, { branchLabel: 'approve', resumedBy: 'usr_mgr' });
      expect(res.status, JSON.stringify(res)).toBe('paused');
      expect(h.ctxOf('approved_note', 'approved')).toMatchObject({ userId: 'usr_rep', permissions: ['deal_rep'] });
    });

    it('CONTROL: a service resume that names no decider (an SLA auto-decision) keeps the run as it was', async () => {
      const h = envelopeHarness();
      h.engine.registerFlow('review', reviewFlow('review') as never);
      const paused = await h.engine.execute('review', { ...TRIGGER } as never);
      await h.engine.resume(paused.runId!, decided('approve'));
      expect(h.ctxOf('approved_note', 'approved')).toMatchObject({ userId: 'usr_rep', permissions: ['deal_rep'] });
    });

    it('CONTROL: a flow with no human decision node runs as its trigger user throughout', async () => {
      const h = envelopeHarness();
      h.engine.registerFlow('straight', {
        name: 'straight', label: 'straight', type: 'autolaunched',
        variables: [{ name: 'dealId', type: 'text', isInput: true }],
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, write('w', 'deal', { stage: 'straight' }), { id: 'end', type: 'end', label: 'End' }],
        edges: [{ id: 'e1', source: 'start', target: 'w' }, { id: 'e2', source: 'w', target: 'end' }],
      } as never);
      const res = await h.engine.execute('straight', { ...TRIGGER } as never);
      expect(res.success, JSON.stringify(res)).toBe(true);
      expect(h.ctxOf('stage', 'straight')).toMatchObject({ userId: 'usr_rep', permissions: ['deal_rep'] });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The real stack
// ─────────────────────────────────────────────────────────────────────────────

const SYS = { isSystem: true } as const;

/**
 * `updated_by` / `created_by` / `owner_id` are injected by the registry, as on
 * an app object. `private`, as HotCRM's `crm_opportunity` is: record sharing
 * then owns the write verdict, so the manager's `modifyAllRecords` is what
 * reaches a deal the rep owns (the platform's ownership floor defers to it).
 */
const dealObject = {
  name: 'deal',
  label: 'Deal',
  sharingModel: 'private',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    stage: { name: 'stage', label: 'Stage', type: 'text' },
    approved_note: { name: 'approved_note', label: 'Approved Note', type: 'text' },
    restricted_note: { name: 'restricted_note', label: 'Restricted Note', type: 'text' },
  },
};

/** The rep edits their own deals, every field. */
const dealRepSet = PermissionSetSchema.parse({
  name: 'deal_rep', label: 'Deal rep',
  objects: { deal: { allowRead: true, allowCreate: true, allowEdit: true } },
});
/** The manager edits every deal — but may not edit `restricted_note`. */
const dealManagerSet = PermissionSetSchema.parse({
  name: 'deal_manager', label: 'Deal manager',
  objects: { deal: { allowRead: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true } },
  fields: { 'deal.restricted_note': { readable: true, editable: false } },
});

describe('on the real stack: attribution after the decision, and the refusal when the decider lacks a right', () => {
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
    await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, dealRepSet, dealManagerSet] }));
    await kernel.use(new SharingServicePlugin());
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');
    registerGates(automation);
    ql.registry.registerObject(dealObject as any, 'decider-test', 'decider-test');
    await ql.syncSchemas();

    const orgs = await ql.find('sys_organization', { context: SYS });
    orgA = String(orgs[0].id);
    for (const [id, name] of [['usr_rep', 'Rep'], ['usr_mgr', 'Manager']]) {
      await ql.insert('sys_user', { id, name, email: `${id}@example.test` }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: orgA, role: 'member' }, { context: SYS });
    }
    await ql.insert('sys_user_permission_set', { id: 'ups_rep', user_id: 'usr_rep', permission_set: 'deal_rep', organization_id: orgA }, { context: SYS });
    await ql.insert('sys_user_permission_set', { id: 'ups_mgr', user_id: 'usr_mgr', permission_set: 'deal_manager', organization_id: orgA }, { context: SYS });

    automation.registerFlow('deal_review', reviewFlow('deal_review') as never);
    automation.registerFlow('deal_review_restricted', reviewFlow('deal_review_restricted', { approveFields: { restricted_note: 'set after the decision' } }) as never);
  }, 30_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  /** What the request path hands ObjectQL for `userId` acting in the org. */
  const requestContext = async (userId: string) => {
    const g = await resolveUserAuthzGrants(ql, userId, { tenantId: orgA, bypassGrantsCache: true });
    return { userId, tenantId: orgA, isSystem: false, positions: g.positions, permissions: g.permissions, org_user_ids: g.org_user_ids };
  };
  const stored = async (id: string) => (await ql.findOne('deal', { where: { id }, context: SYS })) as any;

  /** The rep creates a deal through their own request, then submits it. */
  async function submitted(flow: string, title: string) {
    const created: any = await ql.insert('deal', { title }, { context: await requestContext('usr_rep') });
    const dealId = String(created.id);
    const paused = await automation.execute(flow, { userId: 'usr_rep', tenantId: orgA, params: { dealId } } as never);
    expect(paused.status, JSON.stringify(paused)).toBe('paused');
    const row = await stored(dealId);
    expect(row.stage).toBe('submitted');
    expect(row.updated_by, 'guard: the submitter wrote the record last before the decision').toBe('usr_rep');
    return { dealId, runId: paused.runId! };
  }

  it("GUARD: the manager's write rests on the manager's own grants — under the rep's sets it is refused", async () => {
    // The fixture would be measuring nothing if any member could write a
    // rep's deal: the default member scope keys writes on `created_by`, so it
    // is `deal_manager`'s `modifyAllRecords` that admits the manager below.
    const created: any = await ql.insert('deal', { title: 'guard' }, { context: await requestContext('usr_rep') });
    const repSets = (await requestContext('usr_rep')).permissions;
    await expect(
      ql.update('deal', { id: created.id, approved_note: 'x' }, { context: { userId: 'usr_mgr', tenantId: orgA, isSystem: false, positions: ['org_member', 'everyone'], permissions: repSets } }),
    ).rejects.toThrow();
  });

  it('approve: `updated_by` names the manager after the decision, and the submitter before it', async () => {
    const { dealId, runId } = await submitted('deal_review', 'approve me');
    const res = await automation.resume(runId, decided('approve', 'usr_mgr'));
    expect(res.status, JSON.stringify(res)).toBe('paused');
    const row = await stored(dealId);
    expect(row.approved_note).toBe('approved');
    expect(row.updated_by, 'the post-decision write is attributed to the decider').toBe('usr_mgr');
    expect(row.created_by).toBe('usr_rep');
  });

  it('reject: the reject branch is attributed to the manager', async () => {
    const { dealId, runId } = await submitted('deal_review', 'reject me');
    const res = await automation.resume(runId, decided('reject', 'usr_mgr'));
    expect(res.success, JSON.stringify(res)).toBe(true);
    const row = await stored(dealId);
    expect(row.stage).toBe('rejected');
    expect(row.updated_by).toBe('usr_mgr');
  });

  it('a post-decision node the decider may not perform is refused loudly, and the run reports the node', async () => {
    const { dealId, runId } = await submitted('deal_review_restricted', 'restricted');
    const res: any = await automation.resume(runId, decided('approve', 'usr_mgr'));
    expect(res.success).toBe(false);
    expect(res.status, 'the run stops at the refused node, repairable').toBe('stranded');
    expect(res.error, 'the report names the refused node').toContain('after1');
    expect(res.error, 'and the field the decider may not write').toContain('restricted_note');
    const row = await stored(dealId);
    expect(row.restricted_note ?? null, 'nothing landed').toBeNull();
    expect(row.updated_by).toBe('usr_rep');

    const run = await automation.getRun(runId);
    expect(run?.status).toBe('failed');
    expect(run?.steps?.find((s: any) => s.nodeId === 'after1')?.status).toBe('failure');
  });

  it('CONTROL: the same node resumed with no decider lands as the submitter, whose set allows it', async () => {
    const { dealId, runId } = await submitted('deal_review_restricted', 'restricted, no decider');
    const res = await automation.resume(runId, decided('approve'));
    expect(res.status, JSON.stringify(res)).toBe('paused');
    const row = await stored(dealId);
    expect(row.restricted_note).toBe('set after the decision');
    expect(row.updated_by).toBe('usr_rep');
  });
});
