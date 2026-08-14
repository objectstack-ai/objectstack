// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;

const noopLogger = {
  info() {}, warn() {}, error() {}, debug() {},
};

/**
 * Tiny in-memory ObjectQL stand-in — supports the `where`-equality + `$in`
 * queries the approval service issues, enough to drive the node bridge.
 */
function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  const rows = (o: string) => (tables.get(o) ?? (tables.set(o, []), tables.get(o)!));
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
    if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
    if (v && typeof v === 'object' && '$ne' in (v as any)) return row[k] !== (v as any).$ne;
    return row[k] === v;
  });
  return {
    tables,
    async find(object: string, opts: any = {}) {
      const where = opts.where ?? opts.filter ?? {};
      let out = rows(object).filter(r => matches(r, where));
      if (opts.limit) out = out.slice(0, opts.limit);
      return out.map(r => ({ ...r }));
    },
    async insert(object: string, data: any) {
      rows(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, idOrData: any) {
      const id = idOrData.id;
      const row = rows(object).find(r => r.id === id);
      if (row) Object.assign(row, idOrData);
      return row ? { ...row } : null;
    },
    async delete(object: string, opts: any = {}) {
      const where = opts.where ?? {};
      const list = rows(object);
      for (let i = list.length - 1; i >= 0; i--) if (matches(list[i], where)) list.splice(i, 1);
      return { affected: 1 };
    },
  };
}

function registerDecisionFlow(engine: AutomationEngine, approvers: Array<{ type: string; value?: string }>, behavior?: 'first_response' | 'unanimous') {
  engine.registerFlow('deal_approval', {
    name: 'deal_approval',
    label: 'Deal Approval',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'approve_step', type: 'approval', label: 'Manager Approval', config: { approvers, behavior } },
      { id: 'on_approved', type: 'mark', label: 'Approved' },
      { id: 'on_rejected', type: 'mark', label: 'Rejected' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'approve_step' },
      { id: 'e2', source: 'approve_step', target: 'on_approved', label: 'approve' },
      { id: 'e3', source: 'approve_step', target: 'on_rejected', label: 'reject' },
      { id: 'e4', source: 'on_approved', target: 'end' },
      { id: 'e5', source: 'on_rejected', target: 'end' },
    ],
  });
}

describe('Approval node bridge (ADR-0019)', () => {
  let automation: AutomationEngine;
  let service: ApprovalService;
  let fake: ReturnType<typeof makeFakeEngine>;
  const marks: string[] = [];

  beforeEach(() => {
    marks.length = 0;
    automation = new AutomationEngine(noopLogger as any);
    fake = makeFakeEngine();
    service = new ApprovalService({ engine: fake as any, logger: noopLogger });
    // The contract `decide()` resumes via the attached automation surface.
    service.attachAutomation(automation);
    registerApprovalNode(automation, service, noopLogger);
    // A terminal "mark" node records which branch ran.
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) { marks.push(node.id); return { success: true }; },
    });
  });

  it('publishes an approval action descriptor that supports pause', () => {
    const descriptors = automation.getActionDescriptors();
    const approval = descriptors.find(d => d.type === 'approval');
    expect(approval).toBeDefined();
    expect(approval!.supportsPause).toBe(true);
    expect(approval!.category).toBe('human');
  });

  it('suspends the run on entry and opens a pending request', async () => {
    registerDecisionFlow(automation, [{ type: 'user', value: 'u1' }]);
    const result = await automation.execute('deal_approval', {
      object: 'crm_deal',
      record: { id: 'd1', amount: 100 },
      userId: 'submitter',
    });
    expect(result.status).toBe('paused');
    expect(result.runId).toBeDefined();
    expect(marks).toHaveLength(0);

    const requests = await fake.find('sys_approval_request', { where: { status: 'pending' } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      object_name: 'crm_deal', record_id: 'd1', flow_run_id: result.runId, flow_node_id: 'approve_step',
    });
    // Surfaced as a suspended run with the request id as correlation.
    const suspended = automation.listSuspendedRuns();
    expect(suspended[0]).toMatchObject({ nodeId: 'approve_step', correlation: requests[0].id });
  });

  it('carries the flow name + authored labels onto the request row', async () => {
    registerDecisionFlow(automation, [{ type: 'user', value: 'u1' }]);
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    });
    const [raw] = await fake.find('sys_approval_request', { where: { status: 'pending' } });
    // Engine-seeded `$flowName` (not the node id) names the source…
    expect(raw.process_name).toBe('flow:deal_approval');
    // …and authored labels ride the config snapshot for inbox display.
    const req = (await service.listRequests({ status: 'pending' }, { isSystem: true } as any))[0];
    expect(req.process_label).toBe('Deal Approval');
    expect(req.step_label).toBe('Manager Approval');
  });

  it('resumes down the approve branch on approval', async () => {
    registerDecisionFlow(automation, [{ type: 'user', value: 'u1' }]);
    const paused = await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1' }, userId: 'submitter',
    });
    const request = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];

    const out = await service.decide(request.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    expect(out).toMatchObject({ finalized: true, decision: 'approve', resumed: true });
    expect(marks).toEqual(['on_approved']);
    expect(automation.listSuspendedRuns()).toHaveLength(0);

    const finalReq = (await fake.find('sys_approval_request', { where: { id: request.id } }))[0];
    expect(finalReq.status).toBe('approved');
    expect(paused.runId).toBeDefined();
  });

  // ── resume authorization gate (#3801) ───────────────────────────────
  //
  // `POST /automation/:name/runs/:runId/resume` reaches
  // `AutomationEngine.resume` with a caller-supplied signal. Before the gate,
  // the only thing between that route and the approvals rules was convention —
  // a comment in the showcase. These pin the enforcement.

  it('declares the approval node resumable only by its owning service', () => {
    const approval = automation.getActionDescriptors().find(d => d.type === 'approval');
    expect(approval!.resumeAuthority).toBe('service');
  });

  it('refuses a raw engine resume of an approval pause, leaving the request untouched', async () => {
    registerDecisionFlow(automation, [{ type: 'user', value: 'u1' }]);
    const paused = await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1' }, userId: 'submitter',
    });
    const request = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];

    // Exactly the signal the resume route builds from `{ branchLabel }`.
    const refused = await automation.resume(paused.runId!, {
      branchLabel: 'approve', output: { decision: 'approve' },
    });

    expect(refused).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
    // The approve branch did NOT run…
    expect(marks).toHaveLength(0);
    // …the request is still pending, with no decision recorded…
    const stillPending = (await fake.find('sys_approval_request', { where: { id: request.id } }))[0];
    expect(stillPending.status).toBe('pending');
    const actions = await fake.find('sys_approval_action', { where: { request_id: request.id } });
    expect(actions.map((a: any) => a.action)).toEqual(['submit']);
    // …and the run is still parked, so the real decision can still land.
    expect(automation.listSuspendedRuns()).toHaveLength(1);

    const out = await service.decide(request.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(out).toMatchObject({ finalized: true, resumed: true });
    expect(marks).toEqual(['on_approved']);
  });

  it('resumes down the reject branch on rejection', async () => {
    registerDecisionFlow(automation, [{ type: 'user', value: 'u1' }]);
    await automation.execute('deal_approval', { object: 'crm_deal', record: { id: 'd1' } });
    const request = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];

    const out = await service.decide(request.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX);

    expect(out).toMatchObject({ finalized: true, decision: 'reject', resumed: true });
    expect(marks).toEqual(['on_rejected']);
  });

  it('holds a unanimous step until every approver acts, then resumes', async () => {
    registerDecisionFlow(automation, [
      { type: 'user', value: 'u1' },
      { type: 'user', value: 'u2' },
    ], 'unanimous');
    await automation.execute('deal_approval', { object: 'crm_deal', record: { id: 'd1' } });
    const request = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];

    const first = await service.decide(request.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(first.finalized).toBe(false);
    expect(first.resumed).toBe(false);
    expect(marks).toHaveLength(0);

    const second = await service.decide(request.id, { decision: 'approve', actorId: 'u2' }, SYSTEM_CTX);
    expect(second.finalized).toBe(true);
    expect(second.resumed).toBe(true);
    expect(marks).toEqual(['on_approved']);
  });

  it('rejects a decision from a non-approver', async () => {
    registerDecisionFlow(automation, [{ type: 'user', value: 'u1' }]);
    await automation.execute('deal_approval', { object: 'crm_deal', record: { id: 'd1' } });
    const request = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];

    await expect(
      service.decideNode(request.id, { decision: 'approve', actorId: 'intruder' }, { isSystem: false, positions: [], permissions: [] } as any),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  // ── #3447 P2: dynamic approvers end-to-end ────────────────────────
  //
  // The issue's headline scenario as one flow: the first approver PICKS the
  // next step's approvers in their decision, the next approval node resolves
  // them from `vars.*` at entry — no record-field detour, no snapshot staleness.

  it('decide outputs feed the NEXT approval node via vars.<nodeId>.<key> (#3447 P2)', async () => {
    automation.registerFlow('two_stage', {
      name: 'two_stage',
      label: 'Two Stage',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'lead_review', type: 'approval', label: 'Lead Review',
          config: { approvers: [{ type: 'user', value: 'lead' }], decisionOutputs: ['next_reviewers'] },
        },
        {
          id: 'co_sign', type: 'approval', label: 'Co-sign',
          config: {
            approvers: [{ type: 'expression', value: 'vars.lead_review.next_reviewers' }],
            behavior: 'unanimous',
          },
        },
        { id: 'on_approved', type: 'mark', label: 'Approved' },
        { id: 'on_rejected', type: 'mark', label: 'Rejected' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'lead_review' },
        { id: 'e2', source: 'lead_review', target: 'co_sign', label: 'approve' },
        { id: 'e3', source: 'lead_review', target: 'on_rejected', label: 'reject' },
        { id: 'e4', source: 'co_sign', target: 'on_approved', label: 'approve' },
        { id: 'e5', source: 'co_sign', target: 'on_rejected', label: 'reject' },
      ],
    });

    const paused = await automation.execute('two_stage', {
      object: 'crm_deal', record: { id: 'd1' }, userId: 'submitter',
    });
    expect(paused.status).toBe('paused');

    // The lead approves AND hands the co-reviewers to the flow.
    const first = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    await service.decide(first.id, {
      decision: 'approve', actorId: 'lead', outputs: { next_reviewers: ['u2', 'u3'] },
    }, SYSTEM_CTX);

    // The co-sign node resolved its slate from the lead's decision outputs.
    const second = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    expect(second).toBeDefined();
    expect(second.flow_node_id).toBe('co_sign');
    expect(String(second.pending_approvers).split(',').sort()).toEqual(['u2', 'u3']);
    expect(marks).toHaveLength(0);

    // Both picked reviewers sign off → the run completes down `approve`.
    await service.decide(second.id, { decision: 'approve', actorId: 'u2' }, SYSTEM_CTX);
    await service.decide(second.id, { decision: 'approve', actorId: 'u3' }, SYSTEM_CTX);
    expect(marks).toEqual(['on_approved']);
    expect(automation.listSuspendedRuns()).toHaveLength(0);
  });

  it('expression current.* resolves against the LIVE row at node entry (#3447 P2)', async () => {
    fake.tables.set('crm_deal', [{ id: 'd1', reviewers: ['u7', 'u8'] }]);
    registerDecisionFlow(automation, [{ type: 'expression', value: 'current.reviewers' }], 'unanimous');
    // The trigger snapshot carries an EMPTY reviewers field — only the live
    // row names them, exactly the mid-flow-written-field shape of the issue.
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', reviewers: [] }, userId: 'submitter',
    });
    const request = (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    expect(String(request.pending_approvers).split(',').sort()).toEqual(['u7', 'u8']);
  });

  it("onEmptyApprovers 'auto_approve' completes down the approve edge without suspending (#3447 P2)", async () => {
    automation.registerFlow('auto_ok', {
      name: 'auto_ok',
      label: 'Auto OK',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'gate', type: 'approval', label: 'Gate',
          config: {
            // Present-but-empty (a missing key would fail loudly instead).
            approvers: [{ type: 'expression', value: 'trigger.reviewers' }],
            onEmptyApprovers: 'auto_approve',
          },
        },
        { id: 'on_approved', type: 'mark', label: 'Approved' },
        { id: 'on_rejected', type: 'mark', label: 'Rejected' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'on_approved', label: 'approve' },
        { id: 'e3', source: 'gate', target: 'on_rejected', label: 'reject' },
      ],
    });

    const result = await automation.execute('auto_ok', {
      object: 'crm_deal', record: { id: 'd1', reviewers: [] }, userId: 'submitter',
    });

    // No pause, no request row — the empty slate waved through, down `approve`
    // ONLY (the branchLabel wiring; unlabelled traversal would hit both marks).
    expect(result.status).not.toBe('paused');
    expect(marks).toEqual(['on_approved']);
    expect(await fake.find('sys_approval_request', {})).toHaveLength(0);
    expect(automation.listSuspendedRuns()).toHaveLength(0);
  });

  it('an expression referencing `record` fails the node loudly, not as an empty slate (#3447 P2)', async () => {
    registerDecisionFlow(automation, [{ type: 'expression', value: 'record.reviewers' }]);
    const result = await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', reviewers: ['u1'] }, userId: 'submitter',
    });
    expect(result.success).toBe(false);
    expect(String(result.error ?? '')).toMatch(/current\.<field>|current\./);
    expect(await fake.find('sys_approval_request', {})).toHaveLength(0);
  });
});
