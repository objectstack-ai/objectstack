// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0044 send-back-for-revision matrix:
 *
 *   multi-round (1→2→3) × unanimous (send-back clears partial approvals) ×
 *   lock states (locked → unlocked → re-locked) × recall crossing the revise
 *   window × maxRevisions overflow auto-reject × flows with no revise edge.
 *
 * Drives the REAL automation engine (back-edge re-entry) against the approval
 * service with an in-memory ObjectQL stand-in — the same harness as
 * approval-node.test.ts, extended with orderBy support (assertLatestForRun
 * sorts by created_at) and a ticking clock (rounds must not share timestamps).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';
import { bindApprovalLockHook, APPROVALS_HOOK_PACKAGE } from './lifecycle-hooks.js';

const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as any;
const USER_CTX = { isSystem: false, roles: [], permissions: [] } as any;

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory ObjectQL stand-in: equality/$in where, orderBy, limit. */
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
      for (const ord of [...(opts.orderBy ?? [])].reverse()) {
        // Canonical SortNode key only (spec/data/query.zod.ts): the real
        // engine strips an unknown `direction:` key and defaults to asc, so
        // the mock must too — honoring both keys masks wrong-key sorts.
        const dir = ord.order === 'desc' ? -1 : 1;
        out = [...out].sort((a, b) => (a[ord.field] < b[ord.field] ? -dir : a[ord.field] > b[ord.field] ? dir : 0));
      }
      if (opts.limit) out = out.slice(0, opts.limit);
      return out.map(r => ({ ...r }));
    },
    async insert(object: string, data: any) {
      rows(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, idOrData: any) {
      const row = rows(object).find(r => r.id === idOrData.id);
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

describe('Send back for revision (ADR-0044)', () => {
  let automation: AutomationEngine;
  let service: ApprovalService;
  let fake: ReturnType<typeof makeFakeEngine>;
  const marks: string[] = [];

  beforeEach(() => {
    marks.length = 0;
    automation = new AutomationEngine(noopLogger as any);
    fake = makeFakeEngine();
    // Ticking clock: every read advances 1s, so rounds never share created_at
    // (assertLatestForRun orders by it).
    let t = Date.parse('2026-06-12T00:00:00Z');
    service = new ApprovalService({
      engine: fake as any,
      logger: noopLogger,
      clock: { now: () => new Date((t += 1000)) },
    });
    service.attachAutomation(automation);
    registerApprovalNode(automation, service, noopLogger);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) { marks.push(node.id); return { success: true }; },
    });
    // Signal-flavor wait stand-in: suspends until an external resume — the
    // same contract as the built-in wait node's non-timer path.
    automation.registerNodeExecutor({
      type: 'wait',
      async execute(node: any) { return { success: true, suspend: true, correlation: `wait:${node.id}` }; },
    });
  });

  function registerReviseFlow(opts?: {
    maxRevisions?: number;
    behavior?: 'first_response' | 'unanimous';
    approvers?: Array<{ type: string; value?: string }>;
  }) {
    automation.registerFlow('expense_approval', {
      name: 'expense_approval',
      label: 'Expense Approval',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'review', type: 'approval', label: 'Manager Review',
          config: {
            approvers: opts?.approvers ?? [{ type: 'user', value: 'u1' }],
            behavior: opts?.behavior,
            ...(opts?.maxRevisions !== undefined ? { maxRevisions: opts.maxRevisions } : {}),
          },
        },
        { id: 'wait_revision', type: 'wait', label: 'Awaiting Revision' },
        { id: 'on_approved', type: 'mark', label: 'Approved' },
        { id: 'on_rejected', type: 'mark', label: 'Rejected' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'on_approved', label: 'approve' },
        { id: 'e3', source: 'review', target: 'on_rejected', label: 'reject' },
        { id: 'e4', source: 'review', target: 'wait_revision', label: 'revise' },
        // The cycle-closing back-edge (ADR-0044): resubmit re-enters the approval node.
        { id: 'e5', source: 'wait_revision', target: 'review', label: 'resubmit', type: 'back' },
        { id: 'e6', source: 'on_approved', target: 'end' },
        { id: 'e7', source: 'on_rejected', target: 'end' },
      ],
    });
  }

  async function startFlow() {
    const paused = await automation.execute('expense_approval', {
      object: 'fin_expense', record: { id: 'x1', amount: 900 }, userId: 'submitter',
    });
    expect(paused.status).toBe('paused');
    const [req] = await fake.find('sys_approval_request', { where: { status: 'pending' } });
    return { runId: paused.runId!, req };
  }

  const pendingReq = async () => (await fake.find('sys_approval_request', { where: { status: 'pending' } }))[0];
  const actionsOf = async (requestId: string) =>
    (await fake.find('sys_approval_action', { where: { request_id: requestId } })).map((a: any) => a.action);

  it('registers a revise flow with a declared back-edge (cycle allowed)', () => {
    expect(() => registerReviseFlow()).not.toThrow();
  });

  it('full round trip: send back → returned + wait → resubmit → round 2 → approve', async () => {
    registerReviseFlow();
    const { runId, req } = await startFlow();

    const sent = await service.sendBack(req.id, { actorId: 'u1', comment: 'fix the totals' }, USER_CTX);
    expect(sent.resumed).toBe(true);
    expect(sent.autoRejected).toBeUndefined();
    expect(sent.request.status).toBe('returned');
    expect(marks).toHaveLength(0);

    // The run is paused at the wait point, not terminal.
    expect(automation.listSuspendedRuns()).toMatchObject([{ runId, nodeId: 'wait_revision' }]);
    expect(await actionsOf(req.id)).toEqual(['submit', 'revise']);

    const re = await service.resubmit(req.id, { actorId: 'submitter', comment: 'totals fixed' }, USER_CTX);
    expect(re.resumed).toBe(true);
    expect(await actionsOf(req.id)).toEqual(['submit', 'revise', 'resubmit']);

    // Round 2: a NEW pending request on the same (run, node), round stamped.
    const round2 = await pendingReq();
    expect(round2.id).not.toBe(req.id);
    expect(round2).toMatchObject({ flow_run_id: runId, flow_node_id: 'review' });
    expect((await service.getRequest(round2.id, SYSTEM_CTX))?.round).toBe(2);
    expect(automation.listSuspendedRuns()).toMatchObject([{ runId, nodeId: 'review' }]);

    // Round 2 approval completes the flow down the approve branch.
    const out = await service.decide(round2.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(out).toMatchObject({ finalized: true, resumed: true });
    expect(marks).toEqual(['on_approved']);
    expect(automation.listSuspendedRuns()).toHaveLength(0);
  });

  it('multi-round: two send-backs stamp rounds 2 and 3', async () => {
    registerReviseFlow();
    const { req } = await startFlow();
    expect((await service.getRequest(req.id, SYSTEM_CTX))?.round).toBeUndefined(); // round 1

    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);
    await service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX);
    const round2 = await pendingReq();
    expect((await service.getRequest(round2.id, SYSTEM_CTX))?.round).toBe(2);

    await service.sendBack(round2.id, { actorId: 'u1' }, USER_CTX);
    await service.resubmit(round2.id, { actorId: 'submitter' }, USER_CTX);
    const round3 = await pendingReq();
    expect((await service.getRequest(round3.id, SYSTEM_CTX))?.round).toBe(3);
  });

  it('maxRevisions overflow auto-rejects instead of returning', async () => {
    registerReviseFlow({ maxRevisions: 1 });
    const { req } = await startFlow();

    // Send-back #1 fits the budget.
    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);
    await service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX);
    const round2 = await pendingReq();

    // Send-back #2 exceeds it → auto-reject, flow takes the reject branch.
    const out = await service.sendBack(round2.id, { actorId: 'u1', comment: 'still wrong' }, USER_CTX);
    expect(out.autoRejected).toBe(true);
    expect(out.resumed).toBe(true);
    expect(out.request.status).toBe('rejected');
    expect(marks).toEqual(['on_rejected']);
    // The trail preserves the approver's actual intent before the auto-reject.
    expect(await actionsOf(round2.id)).toEqual(['submit', 'revise', 'reject']);
    const acts = await fake.find('sys_approval_action', { where: { request_id: round2.id, action: 'reject' } });
    expect(acts[0].comment).toMatch(/revision limit \(1\) exceeded/i);
  });

  it('maxRevisions 0 disables send-back (immediate auto-reject)', async () => {
    registerReviseFlow({ maxRevisions: 0 });
    const { req } = await startFlow();
    const out = await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);
    expect(out.autoRejected).toBe(true);
    expect(marks).toEqual(['on_rejected']);
  });

  it('rejects send-back when the flow has no revise out-edge', async () => {
    automation.registerFlow('no_revise', {
      name: 'no_revise', label: 'No Revise', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'review', type: 'approval', label: 'Review', config: { approvers: [{ type: 'user', value: 'u1' }] } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'end', label: 'approve' },
        { id: 'e3', source: 'review', target: 'end', label: 'reject' },
      ],
    });
    await automation.execute('no_revise', { object: 'fin_expense', record: { id: 'x2' }, userId: 'submitter' });
    const req = await pendingReq();

    await expect(service.sendBack(req.id, { actorId: 'u1' }, USER_CTX)).rejects.toThrow(/no 'revise' out-edge/);
    // Nothing moved: still pending, no revise audit row.
    expect((await fake.find('sys_approval_request', { where: { id: req.id } }))[0].status).toBe('pending');
    expect(await actionsOf(req.id)).toEqual(['submit']);
  });

  it('unanimous: one send-back finalizes immediately and round 2 reopens the full slate', async () => {
    registerReviseFlow({
      behavior: 'unanimous',
      approvers: [{ type: 'user', value: 'u1' }, { type: 'user', value: 'u2' }],
    });
    const { req } = await startFlow();

    // u1 approves — request holds for u2.
    const first = await service.decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(first.finalized).toBe(false);

    // u2 sends back instead: finalizes despite u1's earlier approval.
    const sent = await service.sendBack(req.id, { actorId: 'u2', comment: 'rework' }, USER_CTX);
    expect(sent.request.status).toBe('returned');

    await service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX);
    const round2 = await pendingReq();
    // Fresh slate: BOTH approvers pending again — prior approvals are stale.
    expect((round2.pending_approvers as string).split(',').sort()).toEqual(['u1', 'u2']);
  });

  it('lock lifecycle: locked while pending, unlocked in the revise window, re-locked on resubmit', async () => {
    registerReviseFlow();
    const { req } = await startFlow();

    // Bind the real lock hook against a hook-capturing engine facade.
    let hook: ((ctx: any) => Promise<void>) | undefined;
    bindApprovalLockHook({
      registerHook: (_e: string, h: any) => { hook = h; },
      unregisterHooksByPackage: () => 0,
      find: fake.find.bind(fake),
    } as any, noopLogger);
    expect(hook).toBeDefined();
    const editAttempt = () => hook!({
      object: 'fin_expense',
      input: { id: 'x1', data: { amount: 1200 } },
      session: { isSystem: false, roles: [] },
    });

    await expect(editAttempt()).rejects.toThrow(/RECORD_LOCKED/);          // pending → locked
    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);
    await expect(editAttempt()).resolves.toBeUndefined();                  // returned → unlocked
    await service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX);
    await expect(editAttempt()).rejects.toThrow(/RECORD_LOCKED/);          // round 2 pending → re-locked
  });

  it('recall crossing the revise window cancels the run (returned → recalled)', async () => {
    registerReviseFlow();
    const { runId, req } = await startFlow();
    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);

    // Only the submitter may abandon the revision.
    await expect(service.recall(req.id, { actorId: 'u1' }, USER_CTX)).rejects.toThrow(/FORBIDDEN/);

    const out = await service.recall(req.id, { actorId: 'submitter' }, USER_CTX);
    expect(out.request.status).toBe('recalled');
    expect(out.resumed).toBe(false);
    // The run was terminally cancelled, not resumed down any branch.
    expect(automation.listSuspendedRuns()).toHaveLength(0);
    expect(marks).toHaveLength(0);
    const log = (await automation.listRuns('expense_approval'))[0];
    expect(log.status).toBe('cancelled');
    expect(log.id).toBe(runId);

    // The window is closed: resubmit is no longer possible.
    await expect(service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX)).rejects.toThrow(/INVALID_STATE/);
  });

  it('refuses resubmit while another pending request collides on the record (run stays resumable)', async () => {
    registerReviseFlow();
    const { runId, req } = await startFlow();
    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);

    // Simulate a record-change trigger re-firing off an edit made inside the
    // revise window: a second, unrelated run opened its own pending request.
    await fake.insert('sys_approval_request', {
      id: 'areq_collider', object_name: 'fin_expense', record_id: 'x1',
      status: 'pending', flow_run_id: 'run_other', flow_node_id: 'review',
      submitter_id: 'submitter', process_name: 'flow:expense_approval',
      created_at: new Date().toISOString(),
    });

    await expect(service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX)).rejects.toThrow(/DUPLICATE_REQUEST/);
    // The refusal happened BEFORE the suspension was consumed — clearing the
    // collision makes the same resubmit succeed.
    expect(automation.listSuspendedRuns().some(r => r.runId === runId)).toBe(true);
    await fake.delete('sys_approval_request', { where: { id: 'areq_collider' } });
    const re = await service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX);
    expect(re.resumed).toBe(true);
  });

  it('a superseded returned request can neither resubmit again nor be recalled', async () => {
    registerReviseFlow();
    const { req } = await startFlow();
    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);
    await service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX);

    // Round 2 is the live frontier; the round-1 row is history.
    await expect(service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX)).rejects.toThrow(/supersedes/);
    await expect(service.recall(req.id, { actorId: 'submitter' }, USER_CTX)).rejects.toThrow(/supersedes/);
  });

  it('enforces the actor matrix: only pending approvers send back, only the submitter resubmits', async () => {
    registerReviseFlow();
    const { req } = await startFlow();

    await expect(service.sendBack(req.id, { actorId: 'intruder' }, USER_CTX)).rejects.toThrow(/FORBIDDEN/);
    await expect(service.sendBack(req.id, { actorId: 'submitter' }, USER_CTX)).rejects.toThrow(/FORBIDDEN/);

    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);
    await expect(service.resubmit(req.id, { actorId: 'u1' }, USER_CTX)).rejects.toThrow(/FORBIDDEN/);
    // Resubmit only applies to returned requests — a pending one rejects.
    const fresh = await startFlowSecondRecord();
    await expect(service.resubmit(fresh.id, { actorId: 'submitter' }, USER_CTX)).rejects.toThrow(/INVALID_STATE/);
  });

  /** A second record's pending request, to probe resubmit-on-pending. */
  async function startFlowSecondRecord() {
    await automation.execute('expense_approval', {
      object: 'fin_expense', record: { id: 'x9', amount: 50 }, userId: 'submitter',
    });
    const rows = await fake.find('sys_approval_request', { where: { status: 'pending', record_id: 'x9' } });
    return rows[0];
  }

  it('status mirror follows the rounds when approvalStatusField is configured', async () => {
    automation.registerFlow('mirrored_flow', {
      name: 'mirrored_flow', label: 'Mirrored Flow', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'review', type: 'approval', label: 'Review',
          config: { approvers: [{ type: 'user', value: 'u1' }], approvalStatusField: 'approval_status' },
        },
        { id: 'wait_revision', type: 'wait', label: 'Awaiting Revision' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'end', label: 'approve' },
        { id: 'e3', source: 'review', target: 'end', label: 'reject' },
        { id: 'e4', source: 'review', target: 'wait_revision', label: 'revise' },
        { id: 'e5', source: 'wait_revision', target: 'review', label: 'resubmit', type: 'back' },
      ],
    });
    await fake.insert('fin_expense', { id: 'm1', approval_status: null });
    await automation.execute('mirrored_flow', { object: 'fin_expense', record: { id: 'm1' }, userId: 'submitter' });
    const req = await pendingReq();
    const mirror = async () => (await fake.find('fin_expense', { where: { id: 'm1' } }))[0].approval_status;

    expect(await mirror()).toBe('pending');
    await service.sendBack(req.id, { actorId: 'u1' }, USER_CTX);
    expect(await mirror()).toBe('returned');
    await service.resubmit(req.id, { actorId: 'submitter' }, USER_CTX);
    expect(await mirror()).toBe('pending'); // round 2 re-mirrors
  });
});
