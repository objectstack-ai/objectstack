// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every step of an approval run names the run's ORIGINAL submitter (#24817).
 *
 * ## The defect
 *
 * Since an approval decision resumes its flow as the person who decided
 * (`ResumeSignal.resumedBy`, ruling A on `FlowSchema.runAs`), the segment after
 * a decision runs with `context.userId` = the DECIDER. The approval node opened
 * each step with `submitterId: context.userId`, so every step after the first
 * recorded the previous step's decider as its submitter: the "I Submitted"
 * list, recall / resubmit (submitter-only) and every submitter-facing notice
 * (`approval.returned`, `approval.request_info`, `approval.sla_breached`,
 * `approval.approved` / `approval.rejected`) moved to the wrong person. The
 * governing text is `ApprovalEscalationSchema.notifySubmitter`: "Notify the
 * original submitter on escalation".
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the real
 * `AutomationEngine` running the flows, the real approval node opening each
 * step and the real resume-as-decider switch moving the segment's acting user:
 *
 * - each step of a three-step run carries the trigger user as `submitter_id`
 *   (and as the actor of its `submit` timeline row), on both `runAs` postures,
 *   and the "I Submitted" filter finds every step under that user. Who ACTS in
 *   the resumed segment is not this file's question: the decider stays its
 *   actor, pinned by `resume-decider-identity.integration.test.ts` in
 *   `@objectstack/service-automation`;
 * - the step after a gateway-skipped step carries it too;
 * - a run whose trigger resolved no user opens its later step with no
 *   submitter, never with the decider;
 * - recall and resubmit on step 2 admit the original submitter and refuse the
 *   step-1 decider with the `FORBIDDEN` code;
 * - the decision outcome notice at the end of a two-step run reaches the
 *   original submitter;
 * - control: a one-step run is unchanged.
 *
 * Every refusal carries its admitted control on the same request, so a build
 * that refuses everyone cannot pass one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine, registerLogicNodes } from '@objectstack/service-automation';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const ORG = 'org_later_step';
const SUBMITTER = 'u_sub';

const USERS = [
  { id: SUBMITTER, name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_mgr', name: 'Mona Manager', email: 'mona@example.com' },
  { id: 'u_exec', name: 'Eve Exec', email: 'eve@example.com' },
  { id: 'u_cfo', name: 'Carl CFO', email: 'carl@example.com' },
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
const step = (id: string, label: string, approver: string) =>
  ({ id, type: 'approval', label, config: { approvers: [user(approver)] } });

/** One approval step between start and two ends: the control. */
const ONE_STEP = {
  name: 'deal_one_step', label: 'Deal One Step', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    step('mgr', 'Manager Review', 'u_mgr'),
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mgr' },
    { id: 'e2', source: 'mgr', target: 'ok', label: 'approve' },
    { id: 'e3', source: 'mgr', target: 'no', label: 'reject' },
  ],
};

/**
 * A manager, then — above the threshold — an executive, then a CFO; below it
 * the gateway skips the executive and the manager's approval lands on the CFO.
 * The showcase's `showcase_budget_approval` (`manager_review` → `exec_review`
 * above 500000) and `showcase_dynamic_approval` (`lead_review` → `co_sign`)
 * walk the same resumed-segment path.
 */
function chain(name: string, runAs?: 'user' | 'system'): any {
  return {
    name, label: name, type: 'autolaunched',
    ...(runAs ? { runAs } : {}),
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      step('mgr', 'Manager Review', 'u_mgr'),
      { id: 'big', type: 'decision', label: 'Above 1000?' },
      step('exec', 'Executive Review', 'u_exec'),
      step('cfo', 'CFO Review', 'u_cfo'),
      { id: 'ok', type: 'end', label: 'Approved' },
      { id: 'no', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'mgr' },
      { id: 'e2', source: 'mgr', target: 'big', label: 'approve' },
      { id: 'e3', source: 'mgr', target: 'no', label: 'reject' },
      { id: 'e4', source: 'big', target: 'exec', label: 'true', condition: 'record.amount > 1000' },
      { id: 'e5', source: 'big', target: 'cfo', label: 'false', condition: 'record.amount <= 1000' },
      { id: 'e6', source: 'exec', target: 'cfo', label: 'approve' },
      { id: 'e7', source: 'exec', target: 'no', label: 'reject' },
      { id: 'e8', source: 'cfo', target: 'ok', label: 'approve' },
      { id: 'e9', source: 'cfo', target: 'no', label: 'reject' },
    ],
  };
}

/** Two steps; the second can send back into its own ADR-0044 revise window. */
const REVISABLE = {
  name: 'deal_revisable', label: 'Deal Revisable', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    step('mgr', 'Manager Review', 'u_mgr'),
    step('exec', 'Executive Review', 'u_exec'),
    { id: 'exec_rework', type: APPROVAL_REVISE_NODE_TYPE, label: 'Awaiting Revision' },
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mgr' },
    { id: 'e2', source: 'mgr', target: 'exec', label: 'approve' },
    { id: 'e3', source: 'mgr', target: 'no', label: 'reject' },
    { id: 'e4', source: 'exec', target: 'ok', label: 'approve' },
    { id: 'e5', source: 'exec', target: 'no', label: 'reject' },
    { id: 'e6', source: 'exec', target: 'exec_rework', label: 'revise' },
    { id: 'e7', source: 'exec_rework', target: 'exec', label: 'resubmit', type: 'back' },
  ],
};

/**
 * The service-seam form of the ADR-0112 refusal: the code prefix
 * `@objectstack/rest`'s `handleApprovalError` maps to the wire `code` (and
 * `FORBIDDEN` to status 403, pinned live in `rest-approvals-wire-codes.test.ts`)
 * before stripping it from the body. `undefined` when the call was admitted.
 */
async function refusalCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err: any) {
    const code = /^([A-Z][A-Z0-9_]*):\s/.exec(String(err?.message ?? ''))?.[1];
    // A throw with no code prefix is not a refusal the door can classify.
    expect(code, `a coded refusal, got: ${String(err?.message ?? err)}`).toBeDefined();
    return code;
  }
}

interface Emitted {
  topic: string;
  audience: string[];
  source?: { object: string; id: string };
}

describe('every step of an approval run names the run\'s original submitter (#24817)', () => {
  let engine: ObjectQL;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-20T09:00:00.000Z');
  const emits: Emitted[] = [];

  /** Start `flow` on a fresh deal as `userId`; answer the step it paused on. */
  const submit = async (flow: string, key: string, amount = 100, userId: string | undefined = SUBMITTER): Promise<any> => {
    const record = { id: `D_${key}`, title: key, amount, organization_id: ORG };
    await engine.insert('crm_deal', record, { context: SYSTEM } as any);
    const run = await automation.execute(flow, {
      object: 'crm_deal', record, ...(userId ? { userId } : {}),
    } as any);
    expect(run.status, `${flow} on D_${key} paused on its first step`).toBe('paused');
    return pendingOn(`D_${key}`);
  };
  /** The one pending request on a deal, or `undefined`. */
  const pendingOn = async (recordId: string): Promise<any> => {
    const rows: any[] = await engine.find('sys_approval_request', {
      where: { record_id: recordId, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows.length, `at most one pending request on ${recordId}`).toBeLessThanOrEqual(1);
    return rows[0];
  };
  const stored = async (requestId: string): Promise<any> =>
    engine.findOne('sys_approval_request', { where: { id: requestId } }, { context: SYSTEM });
  /** Who the request's own `submit` timeline row names. */
  const submitActor = async (requestId: string): Promise<unknown> => {
    const rows: any[] = await engine.find('sys_approval_action', {
      where: { request_id: requestId, action: 'submit' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows.length, `one submit row on ${requestId}`).toBe(1);
    return rows[0].actor_id ?? null;
  };
  /** `decider` approves `req`; the run resumes as them onto its next node. */
  const approve = async (req: any, decider: string) => {
    const out = await svc.decide(req.id, { decision: 'approve', actorId: decider }, asUser(decider));
    expect([out.finalized, out.resumed], `${decider} approved ${req.flow_node_id}`).toEqual([true, true]);
  };

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
    // The gateway is a `decision` node, one of the built-ins the automation
    // plugin seeds; a bare engine starts without them.
    registerLogicNodes(automation, { logger: silent } as any);
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: silent,
    });
    svc.attachAutomation(automation as any);
    svc.attachMessaging({ async emit(input) { emits.push(input as Emitted); } });
    registerApprovalNode(automation as any, svc, silent);

    automation.registerFlow('deal_one_step', ONE_STEP as any);
    automation.registerFlow('deal_chain', chain('deal_chain'));
    automation.registerFlow('deal_chain_system', chain('deal_chain_system', 'system'));
    automation.registerFlow('deal_revisable', REVISABLE as any);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  for (const flow of ['deal_chain', 'deal_chain_system'] as const) {
    it(`${flow}: each of three steps names the trigger user as submitter, whoever decided the step before`, async () => {
      const step1 = await submit(flow, `${flow}_three`, 5000);
      expect([step1.flow_node_id, step1.submitter_id]).toEqual(['mgr', SUBMITTER]);

      await approve(step1, 'u_mgr');
      const step2 = await pendingOn(`D_${flow}_three`);
      expect([step2?.flow_node_id, step2?.flow_run_id]).toEqual(['exec', step1.flow_run_id]);
      expect(step2.submitter_id, 'step 2 names the trigger user, not the step-1 decider').toBe(SUBMITTER);
      expect(await submitActor(step2.id)).toBe(SUBMITTER);

      // A second decision by a different person: the trigger the engine keeps
      // survives the second switch of the segment's acting user.
      await approve(step2, 'u_exec');
      const step3 = await pendingOn(`D_${flow}_three`);
      expect([step3?.flow_node_id, step3?.flow_run_id]).toEqual(['cfo', step1.flow_run_id]);
      expect(step3.submitter_id, 'step 3 names the trigger user, not the step-2 decider').toBe(SUBMITTER);
      expect(await submitActor(step3.id)).toBe(SUBMITTER);

      // The "I Submitted" filter finds all three steps under the trigger user
      // and none under a decider.
      const listed = async (submitterId: string) =>
        (await svc.listRequests({ submitterId, recordId: `D_${flow}_three` }, SYSTEM))
          .map((r) => r.current_step).sort();
      expect(await listed(SUBMITTER)).toEqual(['cfo', 'exec', 'mgr']);
      expect(await listed('u_mgr')).toEqual([]);
      expect(await listed('u_exec')).toEqual([]);
    });
  }

  it('the step after a gateway-skipped step names the trigger user as submitter', async () => {
    // The graph still holds the executive step; this deal's amount routes around it.
    const step1 = await submit('deal_chain', 'skip', 500);
    await approve(step1, 'u_mgr');
    const next = await pendingOn('D_skip');
    expect([next?.flow_node_id, next?.flow_run_id]).toEqual(['cfo', step1.flow_run_id]);
    expect(next.submitter_id, 'the step after the skipped one names the trigger user').toBe(SUBMITTER);
    expect(await submitActor(next.id)).toBe(SUBMITTER);
  });

  it('a run whose trigger resolved no user opens its later step with no submitter, never the decider', async () => {
    const step1 = await submit('deal_chain', 'userless', 5000, undefined);
    expect(step1.submitter_id ?? null).toBeNull();
    await approve(step1, 'u_mgr');
    const step2 = await pendingOn('D_userless');
    expect(step2?.flow_node_id).toBe('exec');
    expect(step2.submitter_id ?? null, 'nobody submitted this run, so nobody submitted step 2').toBeNull();
    expect(await submitActor(step2.id)).toBeNull();
  });

  it('recall on step 2: the step-1 decider is refused FORBIDDEN; the original submitter is admitted', async () => {
    const step1 = await submit('deal_chain', 'recall', 5000);
    await approve(step1, 'u_mgr');
    const step2 = await pendingOn('D_recall');
    expect(step2?.flow_node_id).toBe('exec');

    expect(await refusalCode(svc.recall(step2.id, { actorId: 'u_mgr' }, asUser('u_mgr')))).toBe('FORBIDDEN');
    expect((await stored(step2.id)).status, 'the refused recall moved nothing').toBe('pending');

    expect(await refusalCode(svc.recall(step2.id, { actorId: SUBMITTER }, asUser(SUBMITTER)))).toBeUndefined();
    expect((await stored(step2.id)).status).toBe('recalled');
  });

  it('resubmit on step 2: the step-1 decider is refused FORBIDDEN; the original submitter is admitted', async () => {
    const step1 = await submit('deal_revisable', 'resubmit', 5000);
    await approve(step1, 'u_mgr');
    const step2 = await pendingOn('D_resubmit');
    expect([step2?.flow_node_id, step2?.submitter_id]).toEqual(['exec', SUBMITTER]);

    await svc.sendBack(step2.id, { actorId: 'u_exec', comment: 'Attach the quote.' }, asUser('u_exec'));
    expect((await stored(step2.id)).status).toBe('returned');
    // The send-back tells the submitter it came back — the original one.
    expect(emits.filter((e) => e.topic === 'approval.returned' && e.source?.id === step2.id).map((e) => e.audience))
      .toEqual([[SUBMITTER]]);

    expect(await refusalCode(svc.resubmit(step2.id, { actorId: 'u_mgr' }, asUser('u_mgr')))).toBe('FORBIDDEN');
    expect((await stored(step2.id)).status, 'the refused resubmit moved nothing').toBe('returned');
    expect(await pendingOn('D_resubmit')).toBeUndefined();

    expect(await refusalCode(svc.resubmit(step2.id, { actorId: SUBMITTER }, asUser(SUBMITTER)))).toBeUndefined();
    const round2 = await pendingOn('D_resubmit');
    expect([round2?.flow_node_id, round2?.flow_run_id, round2?.submitter_id])
      .toEqual(['exec', step1.flow_run_id, SUBMITTER]);
  });

  it('the decision that ends a two-step run tells the original submitter (approval.approved)', async () => {
    const step1 = await submit('deal_revisable', 'outcome', 5000);
    await approve(step1, 'u_mgr');
    const step2 = await pendingOn('D_outcome');
    await approve(step2, 'u_exec');
    expect(await pendingOn('D_outcome')).toBeUndefined();
    expect((await stored(step2.id)).status).toBe('approved');

    const told = emits.filter((e) => ['approval.approved', 'approval.rejected'].includes(e.topic)
      && [step1.id, step2.id].includes(e.source?.id ?? ''));
    expect(told.map((e) => [e.topic, e.source?.id, e.audience])).toEqual([['approval.approved', step2.id, [SUBMITTER]]]);
  });

  it('control: a one-step run names its trigger user, and that user may recall it', async () => {
    const only = await submit('deal_one_step', 'control');
    expect([only.flow_node_id, only.submitter_id]).toEqual(['mgr', SUBMITTER]);
    expect(await submitActor(only.id)).toBe(SUBMITTER);
    expect(await refusalCode(svc.recall(only.id, { actorId: 'u_mgr' }, asUser('u_mgr')))).toBe('FORBIDDEN');
    expect(await refusalCode(svc.recall(only.id, { actorId: SUBMITTER }, asUser(SUBMITTER)))).toBeUndefined();
    expect((await stored(only.id)).status).toBe('recalled');
  });
});
