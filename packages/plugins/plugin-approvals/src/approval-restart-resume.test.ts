// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approval decisions across a process restart (#4420).
 *
 * The reported failure: a flow parks at an `approval` node in process A, the
 * process restarts, and the approver clicks Approve in process B. The request
 * row flips to `approved`, the UI toasts success — and the flow never moves.
 * The next stage's request is never opened, the record's mirrored status
 * freezes mid-workflow, and nothing anywhere logs an error. Approval flows
 * pause for days by design, so a deploy in the middle is the normal case, not
 * the edge one: every release could silently zombify every in-flight approval.
 *
 * Two independent defects produced it, and both are pinned here:
 *
 *  1. The run state has to SURVIVE the restart (#1518's durable store, driven
 *     end to end through the approvals surface for the first time — the store's
 *     own suite proves the engine half, not that a decision can cross it).
 *  2. When it did not survive, every layer read the failure as success:
 *     `engine.resume()` REPORTS `{ success: false }` rather than throwing,
 *     `serviceResume` discarded that return value, and `decide()` counted only
 *     a thrown error as failure — so it answered `resumed: true`, HTTP 200.
 *
 * The fix refuses the decision instead: the run is checked BEFORE the decision
 * is written, so the zombie half-state (recorded decision + stranded run) is
 * never created rather than merely reported.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory ObjectQL stand-in — the approvals tables outlive the "restart". */
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
    async insert(object: string, data: any) { rows(object).push({ ...data }); return { ...data }; },
    async update(object: string, idOrData: any) {
      const row = rows(object).find(r => r.id === idOrData.id);
      if (row) Object.assign(row, idOrData);
      return row ? { ...row } : null;
    },
    async delete(object: string, opts: any = {}) {
      const list = rows(object);
      for (let i = list.length - 1; i >= 0; i--) if (matches(list[i], opts.where ?? {})) list.splice(i, 1);
      return { affected: 1 };
    },
  };
}

function registerDecisionFlow(engine: AutomationEngine) {
  engine.registerFlow('deal_approval', {
    name: 'deal_approval',
    label: 'Deal Approval',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'approve_step', type: 'approval', label: 'Manager Approval', config: { approvers: [{ type: 'user', value: 'u1' }] } },
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
  } as never);
}

describe('approval decisions across a process restart (#4420)', () => {
  let data: ReturnType<typeof makeFakeEngine>;
  let service: ApprovalService;
  let marks: string[];

  /**
   * One process lifetime: a fresh engine over the shared approvals tables,
   * optionally sharing a durable suspended-run store with earlier lifetimes.
   * Nothing carries over in memory — that is the whole point.
   */
  function boot(store?: InMemorySuspendedRunStore) {
    const automation = new AutomationEngine(noopLogger as any, store);
    registerApprovalNode(automation, service, noopLogger as any);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) { marks.push(node.id); return { success: true }; },
    });
    registerDecisionFlow(automation);
    service.attachAutomation(automation);
    return automation;
  }

  const pendingRequest = async () =>
    (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];

  beforeEach(() => {
    marks = [];
    data = makeFakeEngine();
    service = new ApprovalService({ engine: data as any, logger: noopLogger });
  });

  it('approves a run that paused in a previous process, and the flow advances', async () => {
    // #1518's promise, exercised the way a user reaches it: submit in one
    // process, decide in the next.
    const store = new InMemorySuspendedRunStore();
    const processA = boot(store);
    const paused = await processA.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    });
    expect(paused.status).toBe('paused');
    const request = await pendingRequest();

    // ── restart ── nothing of process A survives except the two stores.
    const processB = boot(store);
    expect(processB.listSuspendedRuns(), 'no in-memory state carried over').toHaveLength(0);

    const out = await service.decide(request.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    expect(out).toMatchObject({ finalized: true, decision: 'approve', resumed: true });
    expect(marks, 'the flow continued down the approve branch').toEqual(['on_approved']);
    expect((await data.find('sys_approval_request', { where: { id: request.id } }))[0].status).toBe('approved');
  });

  it('refuses the decision, writing nothing, when the run did not survive the restart', async () => {
    // Process A keeps its pauses in memory only — the 17.0.0-rc.1 deployment.
    const processA = boot();
    await processA.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    });
    const request = await pendingRequest();

    // ── restart ── the suspension is gone for good.
    boot();

    await expect(
      service.decide(request.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX),
    ).rejects.toThrow(/RESUME_TARGET_LOST/);

    // The half-state is not merely reported — it is never created. The request
    // is still actionable once an operator sorts the run out, and the audit
    // trail does not claim an approval that had no effect.
    const after = (await data.find('sys_approval_request', { where: { id: request.id } }))[0];
    expect(after.status, 'still pending, not a zombie "approved"').toBe('pending');
    expect(after.pending_approvers).toContain('u1');
    expect(
      await data.find('sys_approval_action', { where: { request_id: request.id, action: 'approve' } }),
      'no approval was audited for a decision that could not take effect',
    ).toHaveLength(0);
    expect(marks).toEqual([]);
  });

  it('names the stranded run when the resume fails after the decision was written', async () => {
    // The residual race: the run passes the pre-flight and dies before the
    // resume. The decision IS durable by then, so this cannot be undone — but
    // it must not read as success, and it must name what needs rescuing.
    const processA = boot();
    await processA.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    });
    const req = await pendingRequest();

    service.attachAutomation({
      hasSuspendedRun: async () => true,
      resume: async () => ({ success: false, code: 'RUN_NOT_FOUND', error: `No suspended run 'run_x'` }),
    } as any);

    const err = await service
      .decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    expect(err?.message).toMatch(/^RESUME_FAILED/);
    expect(err?.message, 'says which run an operator has to rescue').toMatch(
      /could not be resumed and is now stranded/,
    );
    // The decision itself stands — it is durable, and pretending otherwise
    // would put the row and the audit trail out of step.
    expect((await data.find('sys_approval_request', { where: { id: req.id } }))[0].status).toBe('approved');
  });

  it('treats a concurrent duplicate resume as benign, not as a failure', async () => {
    const processA = boot();
    await processA.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    });
    const req = await pendingRequest();

    // The engine's own idempotency guard: another caller is already advancing
    // this run. Surfacing that as an error would turn a working safeguard into
    // a user-visible failure.
    service.attachAutomation({
      hasSuspendedRun: async () => true,
      resume: async () => ({ success: false, code: 'RESUME_IN_PROGRESS', error: `Run 'run_x' is already being resumed` }),
    } as any);

    const out = await service.decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(out.finalized).toBe(true);
    expect(out.resumed).toBe(false);
    expect(out.resumeError).toMatch(/already being resumed/);
  });

  it('does not block a decision when the suspended-run store is merely unreachable', async () => {
    const processA = boot();
    await processA.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    });
    const req = await pendingRequest();
    const realResume = service['automation']!.resume!.bind(service['automation']);

    // A transient outage means "unknown", not "dead". Failing closed here would
    // reject every decision in the tenant for the duration of a blip.
    service.attachAutomation({
      hasSuspendedRun: async () => { throw new Error('connection refused'); },
      resume: realResume,
    } as any);

    const out = await service.decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(out).toMatchObject({ finalized: true, resumed: true });
    expect(marks).toEqual(['on_approved']);
  });

  it('still records the decision with no automation engine attached — but never silently', async () => {
    // Approvals runs with no engine attached, and the decision must still
    // stand: a human really decided, the row is durable, and refusing every
    // such call would break the standalone compositions the pre-flight
    // deliberately protects. So `finalized` / `resumed` are unchanged.
    //
    // What changed is the silence. The request row NAMES a run, which is its
    // own declaration that a flow is parked on this decision — and every guard
    // the #4420 fix added hangs off an engine that is not there, so this was
    // the one path left answering 200 / `resumed: false` with nothing logged:
    // #4420's exact reported symptom, in the one composition its fix could not
    // see. The gap is now reported at `error` (persisted state and runtime
    // state disagree, and nothing looks broken) and carried on `resumeError`.
    const logs: Array<{ level: string; msg: string }> = [];
    const capturing = {
      info() {}, warn() {}, debug() {},
      error(msg: any) { logs.push({ level: 'error', msg: String(msg) }); },
    };
    const standalone = new ApprovalService({ engine: data as any, logger: capturing as any });
    const opened = await standalone.openNodeRequest({
      object: 'crm_deal', recordId: 'd1', runId: 'run_from_another_process',
      nodeId: 'approve_step', config: { approvers: [{ type: 'user', value: 'u1' }] } as any,
    }, SYSTEM_CTX);

    const out = await standalone.decide((opened as any).id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(out.finalized).toBe(true);
    expect(out.resumed).toBe(false);

    // The divergence is machine-visible, not a bare `resumed: false` the
    // caller has to guess about, and it names the run that stayed parked.
    expect(out.resumeError, 'the composition gap must reach the caller').toBeTruthy();
    expect(out.resumeError).toMatch(/RESUME_FAILED/);
    expect(out.resumeError).toMatch(/run_from_another_process/);

    // …and it is loud in the log at `error`, per AGENTS.md's durability rule.
    expect(logs.some(l => /no automation engine to advance/.test(l.msg)),
      `expected a loud error log, got: ${JSON.stringify(logs)}`).toBe(true);
  });

  it('reports the same gap on a request that names no run — by staying quiet', async () => {
    // The counterpart that keeps the rule honest: a standalone approvals
    // request with NO `flow_run_id` has nothing parked on it, so there is no
    // divergence to report. Reporting one here would be the mirror-image
    // failure — training operators to skim `error`, which is what made #4420's
    // original `warn` unreadable in the first place.
    const logs: string[] = [];
    const capturing = {
      info() {}, warn() {}, debug() {}, error(msg: any) { logs.push(String(msg)); },
    };
    const standalone = new ApprovalService({ engine: data as any, logger: capturing as any });
    const opened = await standalone.openNodeRequest({
      object: 'crm_deal', recordId: 'd1', runId: 'run_x',
      nodeId: 'approve_step', config: { approvers: [{ type: 'user', value: 'u1' }] } as any,
    }, SYSTEM_CTX);
    // `openNodeRequest` requires a run, so the only way a stored row names none
    // is the one the `if (!runId)` guards are written for: a legacy or
    // externally-created request that no flow node ever owned. Model it here.
    data.tables.get('sys_approval_request')!
      .find((r: any) => r.id === (opened as any).id).flow_run_id = null;

    const out = await standalone.decide((opened as any).id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(out.finalized).toBe(true);
    expect(out.resumed).toBe(false);
    expect(out.resumeError, 'nothing was parked — nothing to report').toBeUndefined();
    expect(logs, `no run named, so no degradation: ${JSON.stringify(logs)}`).toEqual([]);
  });
});
