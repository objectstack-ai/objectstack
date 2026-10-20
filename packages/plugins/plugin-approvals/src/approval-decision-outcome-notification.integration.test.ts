// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The decision that ends an approval tells its submitter the outcome (#24753).
 *
 * ## The defect
 *
 * A send-back told the submitter (`approval.returned`), and so did a question
 * (`approval.request_info`). The decision itself told no one: approving or
 * rejecting a request emitted nothing to its `submitter_id`, so a submitter
 * learned the outcome only by opening the approvals inbox — measured on the
 * showcase, where a rejected expense report left its submitter's bell at
 * "You're all caught up".
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the real
 * `AutomationEngine` running the flows and the real approval node opening each
 * step, and the messaging surface recording what reaches it:
 *
 * - an approval sends ONE `approval.approved` to the submitter, a rejection
 *   ONE `approval.rejected`, in the sibling notices' shape: the record named by
 *   its object's label and id, the outcome, the decider's comment when they
 *   wrote one, the inbox deep-linked to the request, the decider as the actor;
 * - a submitter who decided their own request is told nothing;
 * - "final" is the process, not the step: a decision whose resume opened the
 *   next approval step tells no one, and the decision that ends the run does —
 *   measured on the run, so a gateway that SKIPS the later step makes the first
 *   decision the final one. A co-sign vote that leaves the request pending
 *   tells no one either;
 * - the SLA sweep's auto-decision is told by the escalation's own submitter
 *   notice, under its `notifySubmitter` switch, never a second time.
 *
 * Every negative case carries its positive control in the same test, so a
 * build that never sends the notice cannot pass one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine, registerLogicNodes } from '@objectstack/service-automation';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const ORG = 'org_outcome';
const OUTCOME_TOPICS = ['approval.approved', 'approval.rejected'];
const REJECT_NOTE = 'Over budget, resubmit next quarter.';

const USERS = [
  { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
  { id: 'u_mgr', name: 'Mona Manager', email: 'mona@example.com' },
  { id: 'u_exec', name: 'Eve Exec', email: 'eve@example.com' },
];

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
  },
};

/** The plugin's own object definitions, as its manifest registers them. */
async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: silent,
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

const user = (value: string) => ({ type: 'user', value });

/** One approval step between start and two ends. */
function oneStep(name: string, config: Record<string, unknown>): any {
  return {
    name, label: name, type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'review', type: 'approval', label: 'Review', config },
      { id: 'ok', type: 'end', label: 'Approved' },
      { id: 'no', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'review' },
      { id: 'e2', source: 'review', target: 'ok', label: 'approve' },
      { id: 'e3', source: 'review', target: 'no', label: 'reject' },
    ],
  };
}

/**
 * Two approval steps in series, the showcase budget approval's shape: a
 * manager, then — only above the threshold — an executive. Below it the
 * gateway walks straight to the end, so the manager's decision is the last.
 */
const LADDER = {
  name: 'deal_ladder', label: 'Deal Ladder', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'mgr', type: 'approval', label: 'Manager Review', config: { approvers: [user('u_mgr')] } },
    { id: 'big', type: 'decision', label: 'Above 1000?' },
    { id: 'exec', type: 'approval', label: 'Executive Review', config: { approvers: [user('u_exec')] } },
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mgr' },
    { id: 'e2', source: 'mgr', target: 'big', label: 'approve' },
    { id: 'e3', source: 'mgr', target: 'no', label: 'reject' },
    { id: 'e4', source: 'big', target: 'exec', label: 'true', condition: 'record.amount > 1000' },
    { id: 'e5', source: 'big', target: 'ok', label: 'false', condition: 'record.amount <= 1000' },
    { id: 'e6', source: 'exec', target: 'ok', label: 'approve' },
    { id: 'e7', source: 'exec', target: 'no', label: 'reject' },
  ],
};

interface Emitted {
  topic: string;
  audience: string[];
  source?: { object: string; id: string };
  payload?: Record<string, unknown>;
  actorId?: string;
  organizationId?: string;
}

describe('the decision that ends an approval tells its submitter (approval.approved / approval.rejected)', () => {
  let engine: ObjectQL;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-20T09:00:00.000Z');
  const emits: Emitted[] = [];

  /** Start `flow` on a fresh deal as the submitter; answer the step it paused on. */
  const submit = async (flow: string, key: string, amount = 100): Promise<any> => {
    const record = { id: `D_${key}`, title: key, amount, organization_id: ORG };
    await engine.insert('crm_deal', record, { context: SYSTEM } as any);
    const run = await automation.execute(flow, { object: 'crm_deal', record, userId: 'u_sub' } as any);
    expect(run.status, `${flow} on D_${key} paused on its first step`).toBe('paused');
    return pendingOn(`D_${key}`);
  };
  /** The one pending request on a deal, or `undefined`. */
  const pendingOn = async (recordId: string): Promise<any> => {
    const rows: any[] = await engine.find('sys_approval_request', {
      where: { record_id: recordId, status: 'pending' }, context: SYSTEM,
    } as any);
    expect(rows.length, `at most one pending request on ${recordId}`).toBeLessThanOrEqual(1);
    return rows[0];
  };
  const stored = async (requestId: string): Promise<any> =>
    engine.findOne('sys_approval_request', { where: { id: requestId } }, { context: SYSTEM } as any);
  /** The outcome notices sent about one request. */
  const outcomesAbout = (requestId: string) =>
    emits.filter((e) => OUTCOME_TOPICS.includes(e.topic) && e.source?.id === requestId);

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, deal, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);

    automation = new AutomationEngine(silent);
    // The ladder's gateway is a `decision` node, one of the built-ins the
    // automation plugin seeds; a bare engine starts without them.
    registerLogicNodes(automation, { logger: silent } as any);
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: silent,
    });
    svc.attachAutomation(automation as any);
    svc.attachMessaging({ async emit(input) { emits.push(input as Emitted); } });
    registerApprovalNode(automation as any, svc, silent);

    automation.registerFlow('deal_review', oneStep('deal_review', { approvers: [user('u_alice')] }));
    automation.registerFlow('own_review', oneStep('own_review', { approvers: [user('u_sub')] }));
    automation.registerFlow('co_sign', oneStep('co_sign', {
      approvers: [user('u_alice'), user('u_bob')], behavior: 'unanimous',
    }));
    automation.registerFlow('deal_ladder', LADDER as any);
    for (const [name, notifySubmitter] of [['sla_told', true], ['sla_quiet', false]] as const) {
      automation.registerFlow(name, oneStep(name, {
        approvers: [user('u_alice')],
        escalation: { enabled: true, timeoutHours: 1, action: 'auto_approve', notifySubmitter },
      }));
    }
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('an approval sends the submitter one approval.approved: the record, the outcome, the link', async () => {
    const req = await submit('deal_review', 'won');
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'u_alice' }, asUser('u_alice'));
    expect([out.finalized, out.resumed, (await stored(req.id)).status]).toEqual([true, true, 'approved']);

    const told = outcomesAbout(req.id);
    expect(told.map((e) => [e.topic, e.audience])).toEqual([['approval.approved', ['u_sub']]]);
    expect(told[0].payload).toEqual({
      title: 'Request approved',
      body: 'Your Deal D_won was approved.',
      actionUrl: `/system/approvals?request=${encodeURIComponent(req.id)}`,
    });
    expect(told[0].source).toEqual({ object: 'sys_approval_request', id: req.id });
    expect(told[0].actorId).toBe('u_alice');
    expect(told[0].organizationId).toBe(ORG);
    expect((await stored(req.id)).organization_id).toBe(ORG);
  });

  it("a rejection sends the submitter one approval.rejected, carrying the decider's comment", async () => {
    const req = await submit('deal_review', 'lost');
    await svc.decide(req.id, { decision: 'reject', actorId: 'u_alice', comment: `  ${REJECT_NOTE}  ` }, asUser('u_alice'));

    const told = outcomesAbout(req.id);
    expect(told.map((e) => [e.topic, e.audience])).toEqual([['approval.rejected', ['u_sub']]]);
    expect(told[0].payload).toEqual({
      title: 'Request rejected',
      body: `Your Deal D_lost was rejected.\n\n${REJECT_NOTE}`,
      actionUrl: `/system/approvals?request=${encodeURIComponent(req.id)}`,
    });
    expect(told[0].actorId).toBe('u_alice');
  });

  it('a submitter who decides their own request is told nothing; another decider on the same flow is the control', async () => {
    const own = await submit('own_review', 'self');
    await svc.decide(own.id, { decision: 'approve', actorId: 'u_sub' }, asUser('u_sub'));
    // The scene: the request really finalized, so the silence is the rule, not a no-op.
    expect((await stored(own.id)).status).toBe('approved');
    expect(outcomesAbout(own.id)).toEqual([]);

    // Control: the same decision by someone else does tell the submitter.
    const other = await submit('deal_review', 'other');
    await svc.decide(other.id, { decision: 'approve', actorId: 'u_alice' }, asUser('u_alice'));
    expect(outcomesAbout(other.id).map((e) => [e.topic, e.audience])).toEqual([['approval.approved', ['u_sub']]]);
  });

  it('a co-sign vote that leaves the request pending tells no one; the vote that finalizes it does', async () => {
    const req = await submit('co_sign', 'cosign');
    const first = await svc.decide(req.id, { decision: 'approve', actorId: 'u_alice' }, asUser('u_alice'));
    expect(first.finalized).toBe(false);
    expect(outcomesAbout(req.id)).toEqual([]);

    const last = await svc.decide(req.id, { decision: 'approve', actorId: 'u_bob' }, asUser('u_bob'));
    expect(last.finalized).toBe(true);
    expect(outcomesAbout(req.id).map((e) => [e.topic, e.audience, e.actorId])).toEqual([
      ['approval.approved', ['u_sub'], 'u_bob'],
    ]);
  });

  it('on a two-step process the first step tells no one; the step that ends the run tells its submitter', async () => {
    const step1 = await submit('deal_ladder', 'ladder', 5000);
    expect(step1.flow_node_id).toBe('mgr');
    await svc.decide(step1.id, { decision: 'approve', actorId: 'u_mgr' }, asUser('u_mgr'));
    expect((await stored(step1.id)).status).toBe('approved');

    // The run moved on to the executive step, so the manager's approval was a step, not the outcome.
    const step2 = await pendingOn('D_ladder');
    expect([step2?.flow_node_id, step2?.flow_run_id]).toEqual(['exec', step1.flow_run_id]);
    expect(emits.filter((e) => OUTCOME_TOPICS.includes(e.topic) && [step1.id, step2.id].includes(e.source?.id ?? '')))
      .toEqual([]);

    await svc.decide(step2.id, { decision: 'approve', actorId: 'u_exec' }, asUser('u_exec'));
    expect(await pendingOn('D_ladder')).toBeUndefined();
    // The notice follows the terminal request's own `submitter_id`, the field
    // every submitter-facing approval notice reads.
    const submitter = String((await stored(step2.id)).submitter_id);
    expect(outcomesAbout(step2.id).map((e) => [e.topic, e.audience])).toEqual([['approval.approved', [submitter]]]);
    expect(outcomesAbout(step1.id)).toEqual([]);
  });

  it('a rejection at the first step ends the process, so it tells the submitter', async () => {
    const step1 = await submit('deal_ladder', 'vetoed', 5000);
    await svc.decide(step1.id, { decision: 'reject', actorId: 'u_mgr' }, asUser('u_mgr'));
    expect(await pendingOn('D_vetoed')).toBeUndefined();
    expect(outcomesAbout(step1.id).map((e) => [e.topic, e.audience])).toEqual([['approval.rejected', ['u_sub']]]);
  });

  it('a gateway that skips the later step makes the first decision the outcome — measured on the run, not read off the graph', async () => {
    // The graph still holds the executive step; this deal's amount routes around it.
    const step1 = await submit('deal_ladder', 'small', 500);
    await svc.decide(step1.id, { decision: 'approve', actorId: 'u_mgr' }, asUser('u_mgr'));
    expect(await pendingOn('D_small')).toBeUndefined();
    expect(outcomesAbout(step1.id).map((e) => [e.topic, e.audience])).toEqual([['approval.approved', ['u_sub']]]);
  });

  it("the SLA sweep's auto-decision is told by the escalation's submitter notice under notifySubmitter, never a second time", async () => {
    const told = await submit('sla_told', 'sla_told');
    const quiet = await submit('sla_quiet', 'sla_quiet');
    now += 2 * 3600_000;
    expect(await svc.runEscalations()).toMatchObject({ escalated: 2 });
    for (const req of [told, quiet]) {
      expect((await stored(req.id)).status, `${req.record_id} was auto-approved`).toBe('approved');
      expect(outcomesAbout(req.id)).toEqual([]);
    }
    const toSubmitter = (req: any) => emits
      .filter((e) => e.source?.id === req.id && e.audience.includes('u_sub'))
      .map((e) => e.topic);
    // The one message the submitter gets names the action the sweep took …
    expect(toSubmitter(told)).toEqual(['approval.sla_breached']);
    expect(String(emits.find((e) => e.source?.id === told.id && e.audience.includes('u_sub'))?.payload?.body))
      .toContain("escalation action 'auto_approve' was taken");
    // … and `notifySubmitter: false` still means the submitter hears nothing.
    expect(toSubmitter(quiet)).toEqual([]);

    // Control: a person deciding the same flow's request does tell the submitter.
    const human = await submit('sla_told', 'sla_human');
    await svc.decide(human.id, { decision: 'approve', actorId: 'u_alice' }, asUser('u_alice'));
    expect(outcomesAbout(human.id).map((e) => [e.topic, e.audience])).toEqual([['approval.approved', ['u_sub']]]);
  });
});
