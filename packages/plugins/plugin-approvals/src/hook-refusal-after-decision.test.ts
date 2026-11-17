// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #34579 — a record hook refuses the step AFTER an approval decision.
 *
 * ## The reported case
 *
 * A special-approval flow parks at an `approval` node; on `approve` an
 * `update_record` moves the plan to `approved`. The plan's `beforeUpdate` hook
 * re-checks capacity and refuses with a declared refusal. The approver's
 * `POST …/approve` then answered `500 RESUME_FAILED`, the decision stood, the
 * run stranded, and the approver could not read WHY: the engine reported the
 * refusal (`AutomationResult.innerRefusal` / `.userMessage`, ruling B′ on
 * #24914), and the approvals door dropped it before building the envelope.
 *
 * ## What is pinned, within the rulings on file
 *
 * ⛔ The status code does not move and the decision is not rolled back or made
 * atomic: #13807 B keeps the 500 and the #13937 shape-4 ruling excludes undoing
 * a human decision. So the card is pinned on its fallback route:
 *
 *  1. NO fault edge: the `RESUME_FAILED` envelope carries the refusal the step
 *     met — `innerRefusal` in the engine's own shape and the hook's marked
 *     `userMessage` — beside the four #13807 facts, which are unchanged.
 *  2. A declared FAULT edge on that step: the hook refusal is routed down it,
 *     like any run-time failure (`dag-traversal.ts`; only guard refusals are
 *     not routed). The decision answers normally, `resumed: true`, and the run
 *     completes through the author's handler. A flow author can bounce the
 *     record back without an administrator.
 *  3. Reverse control: a step that FAULTS (a throw that declares no HTTP
 *     answer) met no refusal, so the envelope carries neither member — nothing
 *     is synthesised from the prose.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, registerCrudNodes } from '@objectstack/service-automation';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { strandedDecisionDetails } from '@objectstack/types';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const noopLogger: any = { info() {}, warn() {}, error() {}, debug() {} };
noopLogger.child = () => noopLogger;

/** The hook's declared sentence, in the caller's locale — what the approver should read. */
const HOOK_USER_TEXT = '产能已被其他订单占用，该方案无法按当前产能通过。';

/**
 * A declared hook refusal as the runtime answers one
 * (`resolveHookRefusal`, `runtime/src/sandbox/hook-refusal-catalogue.ts`):
 * the diagnostic message names the hook, the declared code and status ride
 * the error, and the declared sentence is both the caller-facing message and
 * the marked `userMessage`.
 */
const hookRefusal = () => Object.assign(
  new Error("hook 'alloc_plan_capacity_recheck' threw: Error: over_capacity"),
  { name: 'SandboxError', innerMessage: HOOK_USER_TEXT, code: 'VALIDATION_FAILED', status: 400, userMessage: HOOK_USER_TEXT },
);

/** In-memory ObjectQL stand-in: approvals tables plus the plan the flow writes. */
function makeFakeEngine(refuseUpdateOf: string, refusal: () => unknown) {
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
      const out = rows(object).filter(r => matches(r, where));
      const start = opts.offset ?? 0;
      const page = typeof opts.limit === 'number' ? out.slice(start, start + opts.limit) : out.slice(start);
      return page.map(r => ({ ...r }));
    },
    async insert(object: string, data: any) { rows(object).push({ ...data }); return { ...data }; },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      // The record hook: accepts the call the way ObjectQL does, then refuses.
      if (object === refuseUpdateOf) throw refusal();
      const table = rows(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < table.length; i++) {
          if (matches(table[i], options?.where)) { table[i] = { ...table[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return i >= 0 ? { ...table[i] } : null;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const table = rows(object);
      const i = table.findIndex(r => r.id === (dispatch as any).id);
      if (i >= 0) table.splice(i, 1);
      return { id: (dispatch as any).id };
    },
  };
}

/** start → approval → (approve) adopt the plan → end; (reject) → end. */
function specialApprovalFlow(withFaultEdge: boolean) {
  return {
    name: 'plan_special_approval',
    label: 'Plan Special Approval',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'director', type: 'approval', label: 'Director Approval',
        config: { approvers: [{ type: 'user', value: 'director' }] },
      },
      {
        id: 'adopt_plan', type: 'update_record', label: 'Adopt Plan',
        config: { objectName: 'alloc_plan', filter: { id: 'p1' }, fields: { status: 'approved' } },
      },
      { id: 'bounce_back', type: 'mark', label: 'Bounce back to the rep' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'director' },
      { id: 'e2', source: 'director', target: 'adopt_plan', label: 'approve' },
      { id: 'e3', source: 'director', target: 'end', label: 'reject' },
      { id: 'e4', source: 'adopt_plan', target: 'end' },
      ...(withFaultEdge
        ? [
          { id: 'ef', source: 'adopt_plan', target: 'bounce_back', type: 'fault' },
          { id: 'e5', source: 'bounce_back', target: 'end' },
        ]
        : []),
    ],
  };
}

describe('#34579 — a hook refusal on the step after an approval decision', () => {
  let marks: string[];

  beforeEach(() => { marks = []; });

  /** One live process: real engine, real CRUD + approval nodes, real approvals service. */
  function boot(opts: { withFaultEdge: boolean; refusal?: () => unknown }) {
    const data = makeFakeEngine('alloc_plan', opts.refusal ?? hookRefusal);
    data.tables.set('alloc_plan', [{ id: 'p1', status: 'submitted' }]);
    const service = new ApprovalService({ engine: data as any, logger: noopLogger });
    const automation = new AutomationEngine(noopLogger, new InMemorySuspendedRunStore());
    registerCrudNodes(automation, { logger: noopLogger, getService: (n: string) => (n === 'data' ? data : undefined) } as any);
    registerApprovalNode(automation, service, noopLogger);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) { marks.push(node.id); return { success: true }; },
    } as never);
    automation.registerFlow('plan_special_approval', specialApprovalFlow(opts.withFaultEdge) as never);
    service.attachAutomation(automation);
    return { data, service, automation };
  }

  async function park(env: ReturnType<typeof boot>) {
    const started = await env.automation.execute('plan_special_approval', {
      object: 'alloc_plan', record: { id: 'p1', status: 'submitted' }, userId: 'rep',
    } as never);
    expect(started.status, 'the run must park at the approval node').toBe('paused');
    const req = (await env.data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    expect(req?.flow_run_id, 'the request must name the run it gates').toBeTruthy();
    return req;
  }

  it('NO fault edge: still 500 RESUME_FAILED, and the envelope now carries the refusal the step met', async () => {
    const env = boot({ withFaultEdge: false });
    const req = await park(env);
    const runId = req.flow_run_id;

    const err = await env.service
      .decide(req.id, { decision: 'approve', actorId: 'director' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    // #13807 B, unchanged: the door still throws, and the prose still names the run.
    expect(err, '⛔ not "return 200" — the status code does not move').toBeTruthy();
    expect(err?.message).toMatch(/^RESUME_FAILED: the approve decision was recorded on request /);
    expect(err?.message).toMatch(/could not be resumed and is now stranded/);

    // The decision is durable and the plan did not move: the reported state.
    const row = (await env.data.find('sys_approval_request', { where: { id: req.id } }))[0];
    expect(row.status).toBe('approved');
    expect((await env.data.find('alloc_plan', { where: { id: 'p1' } }))[0].status).toBe('submitted');

    // ⭐ The card's deliverable: the refusal, structured, beside the four facts.
    expect(strandedDecisionDetails(err)).toEqual({
      finalized: true,
      decision: 'approve',
      runId,
      repairable: true,
      innerRefusal: { code: 'VALIDATION_FAILED', message: hookRefusal().message },
      userMessage: HOOK_USER_TEXT,
    });
  });

  it('a declared FAULT edge on that step routes the hook refusal to the handler — the decision answers normally and the run does not strand', async () => {
    const env = boot({ withFaultEdge: true });
    const req = await park(env);
    const runId = req.flow_run_id;

    const out = await env.service.decide(req.id, { decision: 'approve', actorId: 'director' }, SYSTEM_CTX);

    expect(out.finalized).toBe(true);
    expect(out.decision).toBe('approve');
    expect(out.resumed, 'the run advanced through the fault edge').toBe(true);
    expect(out.resumeError).toBeUndefined();
    expect(marks, "the author's handler ran").toEqual(['bounce_back']);
    // Nothing left parked and nothing to repair: the run ended.
    expect(await env.automation.hasSuspendedRun(runId)).toBe(false);
    expect(strandedDecisionDetails(out as unknown)).toBeUndefined();
  });

  it('reverse control: a step that FAULTS met no refusal — the envelope carries neither member', async () => {
    const env = boot({ withFaultEdge: false, refusal: () => new Error('ECONNREFUSED: could not reach the store') });
    const req = await park(env);

    const err = await env.service
      .decide(req.id, { decision: 'approve', actorId: 'director' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    const details = strandedDecisionDetails(err);
    expect(details).toEqual({ finalized: true, decision: 'approve', runId: req.flow_run_id, repairable: true });
    expect(details && 'innerRefusal' in details).toBe(false);
    expect(details && 'userMessage' in details).toBe(false);
  });
});
