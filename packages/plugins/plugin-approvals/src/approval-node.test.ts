// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as any;

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
      service.decideNode(request.id, { decision: 'approve', actorId: 'intruder' }, { isSystem: false, roles: [], permissions: [] } as any),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
