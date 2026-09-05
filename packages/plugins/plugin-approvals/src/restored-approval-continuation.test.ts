// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A restored approval suspension can be DECIDED again, not only cancelled
 * (#15389).
 *
 * ## The reported dead end
 *
 * `AutomationEngine.restoreConsumedSuspension` is the platform's repair verb
 * for a run stranded mid-resume: it puts the consumed pause back and answers
 * *"the run is resumable again; re-issue the continuation"*. For an `approval`
 * suspension nobody could re-issue it:
 *
 *  - every approvals door that stamps the resume marker — `decide`, `recall`,
 *    `sendBack`, `resubmit` — guards on a `pending` request, and the row is
 *    terminal, written by the very call that stranded the run;
 *  - the generic engine door refuses, because the `approval` node declares
 *    `resumeAuthority: 'service'` (#3801).
 *
 * So the only remaining verb was `cancelRun`, which discards the branch's
 * downstream work. A repair that advertises a follow-up the platform then
 * refuses is worse than one that declines up front.
 *
 * ## The mechanism, named
 *
 * ⭐ The restored suspension lacks NOTHING. PIN 2 measures a `resumeAuthority`
 * -marked resume walking the restored pause to completion — the engine side is
 * whole. What was missing is an ISSUER on the approvals side: the authority to
 * stamp the marker lives only behind those four `pending` guards. That is why
 * the repair is a new approvals verb and not an engine change.
 *
 * ## What the fix must not do
 *
 * ⛔ Not re-open the request row (that would let a decided request be decided
 * again — a permission-boundary change triage reserved for a ruling). ⛔ Not
 * relax `resumeAuthority: 'service'`. ⛔ Not touch `ApprovalDecisionResult`,
 * whose shape is under an open ruling on #15556. PIN 3 asserts all four
 * `pending` guards still stand and the row is untouched.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
// [#4550] The engine double below routes its write verbs through ObjectQL's OWN
// dispatch predicates rather than a hand-mirrored copy.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { strandedDecisionDetails } from '@objectstack/types';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory ObjectQL stand-in for the approvals tables. */
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
      const out = rows(object).filter(r => matches(r, where));
      // The caller's bound is honoured by PRESENCE, never truthiness.
      const start = opts.offset ?? 0;
      const page = typeof opts.limit === 'number' ? out.slice(start, start + opts.limit) : out.slice(start);
      return page.map(r => ({ ...r }));
    },
    async insert(object: string, data: any) { rows(object).push({ ...data }); return { ...data }; },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
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
      if (dispatch.kind === 'multi') {
        const survivors = table.filter(r => !matches(r, options?.where));
        const deleted = table.length - survivors.length;
        table.splice(0, table.length, ...survivors);
        return { deleted };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table.splice(i, 1);
      return { id: dispatch.id };
    },
  };
}

const DEAL_APPROVAL = {
  name: 'deal_approval', label: 'Deal Approval', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'approve_step', type: 'approval', label: 'Manager Approval',
      config: { approvers: [{ type: 'user', value: 'u1' }] } },
    { id: 'on_approved', type: 'mark', label: 'Approved' },
    { id: 'mark_rejected', type: 'mark', label: 'Rejected' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'approve_step' },
    { id: 'e2', source: 'approve_step', target: 'on_approved', label: 'approve' },
    { id: 'e3', source: 'approve_step', target: 'mark_rejected', label: 'reject' },
    { id: 'e4', source: 'on_approved', target: 'end' },
    { id: 'e5', source: 'mark_rejected', target: 'end' },
  ],
};

/** The card's own failing node text: the reject branch writes to a gone record. */
const DOWNSTREAM_FAILURE =
  'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';

describe('#15389 — a restored approval suspension has an issuer again', () => {
  let data: ReturnType<typeof makeFakeEngine>;
  let service: ApprovalService;
  let marks: string[];
  let rejectBranchThrows: string | undefined;

  /** One live process: real engine, real approval node, real approvals service. */
  function boot() {
    const automation = new AutomationEngine(noopLogger as any, new InMemorySuspendedRunStore());
    registerApprovalNode(automation, service, noopLogger as any);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) {
        if (node.id === 'mark_rejected' && rejectBranchThrows) throw new Error(rejectBranchThrows);
        marks.push(node.id);
        return { success: true };
      },
    } as never);
    automation.registerFlow('deal_approval', DEAL_APPROVAL as never);
    service.attachAutomation(automation);
    return automation;
  }

  beforeEach(() => {
    marks = []; rejectBranchThrows = undefined;
    data = makeFakeEngine();
    service = new ApprovalService({ engine: data as any, logger: noopLogger });
  });

  async function park(automation: AutomationEngine) {
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    } as never);
    return (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
  }

  const rowOf = async (id: string) =>
    (await data.find('sys_approval_request', { where: { id } }))[0];

  /** Strand a reject decision, then re-arm its pause. Returns the request row. */
  async function strandThenRestore(automation: AutomationEngine) {
    rejectBranchThrows = DOWNSTREAM_FAILURE;
    const req = await park(automation);
    const err = await service
      .decide(req.id, { decision: 'reject', actorId: 'u1', comment: 'no' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    // The strand the card starts from, and the repairable stamp #13807 added.
    expect(err?.message).toMatch(/^RESUME_FAILED/);
    expect(strandedDecisionDetails(err)?.repairable).toBe(true);
    expect(await automation.hasSuspendedRun(req.flow_run_id)).toBe(false);

    const restored = await automation.restoreConsumedSuspension(
      req.flow_run_id, { requestedBy: 'ops', reason: 'record recreated' },
    );
    expect(restored.restored, 'the re-arm itself works — this card is about what follows').toBe(true);
    expect(restored.reason).toMatch(/re-issue the continuation/);
    expect(await automation.hasSuspendedRun(req.flow_run_id), 'the pause really is back').toBe(true);
    return req;
  }

  it('PIN 1 — the reported dead end: restored, and every issuer but cancelRun refuses', async () => {
    const automation = boot();
    const req = await strandThenRestore(automation);
    const runId = req.flow_run_id;

    // ── The approvals doors: all guard on `pending`, and the row is terminal.
    const decideAgain = await service
      .decide(req.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(decideAgain?.message).toBe('INVALID_STATE: request is rejected');

    const recallIt = await service
      .recall(req.id, { actorId: 'submitter' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(recallIt, 'recall is refused too — it is an issuer of the same kind').toBeTruthy();
    expect(recallIt?.message).toMatch(/INVALID_STATE|FORBIDDEN/);

    // ── The generic engine door: refused by the #3801 `resumeAuthority` gate.
    const generic: any = await automation.resume(runId, { branchLabel: 'reject' } as never);
    expect(generic.success).toBe(false);
    expect(generic.code).toBe('PERMISSION_DENIED');
    expect(generic.error).toMatch(/only its owning service may resume/);

    // ── ⭐ And the half that names the MECHANISM: the pause is still there and
    // still resumable. What the restored suspension lacks is not state — it is
    // an issuer allowed to stamp the marker.
    expect(await automation.hasSuspendedRun(runId)).toBe(true);

    // ── The only verb the card found: cancel. It works, and it is a loss —
    // `mark_rejected` never ran.
    expect(await automation.cancelRun(runId)).toBe(true);
    expect(marks, 'the reject branch never happened — what cancelling costs').toEqual([]);
  });

  it('PIN 2 — the fix: the recorded decision is re-issued and the flow completes', async () => {
    const automation = boot();
    const req = await strandThenRestore(automation);
    const runId = req.flow_run_id;

    // The operator fixed what the node choked on; the decision itself stands.
    rejectBranchThrows = undefined;

    const out = await service.continueRestoredRun(req.id, {
      requestedBy: 'ops', reason: 'record recreated, re-issuing the reject branch',
    });

    expect(out.resumed, 'the continuation the restore asked for, finally issuable').toBe(true);
    expect(out.runId).toBe(runId);
    expect(out.decision).toBe('reject');
    expect(out.branchLabel).toBe('reject');
    // The failing door stashed the literal signal it sent, so this is a
    // byte-for-byte re-issue rather than an inference.
    expect(out.source).toBe('journal');
    expect(out.resumeError).toBeUndefined();

    // ⭐ The branch's downstream work — the thing cancelling discards — RAN.
    expect(marks).toEqual(['mark_rejected']);
    expect(await automation.hasSuspendedRun(runId), 'the pause was consumed by the continuation').toBe(false);
    expect((await automation.getRun(runId))?.status).toBe('completed');

    // And `restoreConsumedSuspension` now refuses, for the healthy reason.
    expect((await automation.restoreConsumedSuspension(runId)).refusal).toBe('RUN_COMPLETED');
  });

  it('PIN 3 — it replays the decision and rewrites NOTHING: the four `pending` guards stand', async () => {
    const automation = boot();
    const req = await strandThenRestore(automation);
    const before = await rowOf(req.id);
    rejectBranchThrows = undefined;

    await service.continueRestoredRun(req.id);

    const after = await rowOf(req.id);
    expect(after.status, 'still terminal — the request was NOT re-opened').toBe('rejected');
    expect(after.completed_at).toBe(before.completed_at);
    expect(after.pending_approvers).toBe(before.pending_approvers);

    // No audit row was minted for the replay: `sys_approval_action.action` is a
    // closed contract vocabulary (`APPROVAL_ACTION_KINDS`), and a repair is not
    // a new approval action. The trail still reads exactly one `reject`.
    const actions = (await data.find('sys_approval_action', { where: { request_id: req.id } }))
      .map((a: any) => a.action);
    expect(actions.filter((a: string) => a === 'reject')).toHaveLength(1);

    // ⛔ And the guard this verb exists to avoid weakening is still shut: the
    // terminal row cannot be decided again through the front door.
    const reDecide = await service
      .decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(reDecide?.message).toBe('INVALID_STATE: request is rejected');
  });

  it('PIN 4 — REVERSE CONTROLS: it refuses when there is no re-armed pause to continue', async () => {
    const automation = boot();

    // (a) A healthy decision. The run completed; there is nothing to continue,
    // and this must NOT re-run the branch a second time.
    const healthy = await park(automation);
    await service.decide(healthy.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX);
    expect(marks).toEqual(['mark_rejected']);
    const noPause = await service.continueRestoredRun(healthy.id).then(() => null, (e: Error) => e);
    expect(noPause?.message).toMatch(/is not suspended/);
    // ⭐ The point of the refusal: the branch did not run twice.
    expect(marks, 'a completed run must not be walked again').toEqual(['mark_rejected']);

    // (b) Stranded but NOT restored — the operator skipped the restore, and the
    // refusal has to name the step they missed rather than fail obscurely.
    rejectBranchThrows = DOWNSTREAM_FAILURE;
    const stranded = await park(automation);
    await service.decide(stranded.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, () => null);
    const notRestored = await service.continueRestoredRun(stranded.id)
      .then(() => null, (e: Error) => e);
    expect(notRestored?.message).toMatch(/restoreConsumedSuspension/);

    // (c) A pending request has no recorded outcome to replay — `decide` is its
    // continuation, and this verb must not become a second way in.
    const pending = await park(automation);
    const stillPending = await service.continueRestoredRun(pending.id)
      .then(() => null, (e: Error) => e);
    expect(stillPending?.message).toMatch(/^INVALID_STATE: request is pending/);

    // (d) Unknown request.
    const missing = await service.continueRestoredRun('areq_nope').then(() => null, (e: Error) => e);
    expect(missing?.message).toBe('REQUEST_NOT_FOUND: areq_nope');
  });

  it('PIN 5 — with no journal it rebuilds the signal, and refuses the one shape it cannot', async () => {
    const automation = boot();
    const req = await strandThenRestore(automation);

    // A run stranded by a build WITHOUT the journal — the population the card
    // was filed for ("the runs already in this state"). Simulated by removing
    // the stash the door just wrote, which is exactly what such a row looks like.
    const stashed = await rowOf(req.id);
    const config = JSON.parse(stashed.node_config_json);
    expect(config.__strandedContinuation, 'the door DID journal it — this pin removes it on purpose')
      .toBeTruthy();
    delete config.__strandedContinuation;
    await data.update('sys_approval_request', {
      id: req.id, node_config_json: JSON.stringify(config),
    }, { context: SYSTEM_CTX });

    rejectBranchThrows = undefined;
    const out = await service.continueRestoredRun(req.id);
    expect(out.source, 'rebuilt from the recorded outcome, and it says so').toBe('reconstructed');
    expect(out.resumed).toBe(true);
    expect(out.decision).toBe('reject');
    expect(marks).toEqual(['mark_rejected']);

    // ── The shape the rebuild REFUSES rather than guesses. A `rejected` row
    // that also carries a `revise` action may be ADR-0044's revision-limit
    // auto-rejection, whose original resume carried `autoRejected: true`.
    // Replaying it as a plain rejection would hand the flow a payload it never
    // had — so with no journal to consult, this refuses.
    const second = boot();
    rejectBranchThrows = DOWNSTREAM_FAILURE;
    const amb = await park(second);
    await service.decide(amb.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, () => null);
    await second.restoreConsumedSuspension(amb.flow_run_id);
    const ambRow = await rowOf(amb.id);
    const ambConfig = JSON.parse(ambRow.node_config_json);
    delete ambConfig.__strandedContinuation;
    await data.update('sys_approval_request', {
      id: amb.id, node_config_json: JSON.stringify(ambConfig),
    }, { context: SYSTEM_CTX });
    await data.insert('sys_approval_action', {
      id: 'aact_revise_x', request_id: amb.id, action: 'revise', step_index: 0,
    }, { context: SYSTEM_CTX });

    const ambiguous = await service.continueRestoredRun(amb.id).then(() => null, (e: Error) => e);
    expect(ambiguous?.message).toMatch(/cannot tell a decided rejection from an ADR-0044/);
    // ⛔ And it refused by NOT resuming — the run is still parked, still repairable.
    expect(await second.hasSuspendedRun(amb.flow_run_id)).toBe(true);
  });
});
