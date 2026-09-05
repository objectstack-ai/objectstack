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
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
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
      // ⚠️ `orderBy` is honoured, and that is load-bearing rather than polish:
      // `assertLatestForRun` selects the newest request with
      // `orderBy [{field:'created_at', order:'desc'}], limit 1`. A double that
      // ignored it returned the OLDEST row, so the guard passed on every input
      // and a pin naming it would have measured nothing — the phantom-check
      // shape. SortNode's key is `order`, not `direction` (spec/data/query.zod.ts).
      if (Array.isArray(opts.orderBy)) {
        for (const sort of [...opts.orderBy].reverse()) {
          const field = sort?.field;
          if (!field) continue;
          const dir = sort?.order === 'desc' ? -1 : 1;
          out.sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * dir);
        }
      }
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

/**
 * TWO approval nodes in sequence. The run parks at `a2` after `a1` is decided,
 * so `a1`'s terminal request coexists with a live pause that is NOT its own —
 * the shape that separates "a pause exists on this run" from "this request's
 * pause is back".
 */
const TWO_STEP = {
  name: 'two_step', label: 'Two Step', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'a1', type: 'approval', label: 'Manager', config: { approvers: [{ type: 'user', value: 'u1' }] } },
    { id: 'a2', type: 'approval', label: 'Finance', config: { approvers: [{ type: 'user', value: 'u2' }] } },
    { id: 'done', type: 'mark', label: 'Done' },
    { id: 'nope', type: 'mark', label: 'Nope' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'a1' },
    { id: 'e2', source: 'a1', target: 'a2', label: 'approve' },
    { id: 'e3', source: 'a1', target: 'nope', label: 'reject' },
    { id: 'e4', source: 'a2', target: 'done', label: 'approve' },
    { id: 'e5', source: 'a2', target: 'nope', label: 'reject' },
    { id: 'e6', source: 'done', target: 'end' },
    { id: 'e7', source: 'nope', target: 'end' },
  ],
};

/** ADR-0044 revise window: send-back parks the run at a node the approval request never gated. */
const REVISE_FLOW = {
  name: 'revise_flow', label: 'Revise Flow', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'review', type: 'approval', label: 'Review', config: { approvers: [{ type: 'user', value: 'u1' }] } },
    { id: 'wait_revision', type: APPROVAL_REVISE_NODE_TYPE, label: 'Awaiting Revision' },
    { id: 'on_approved', type: 'mark', label: 'Approved' },
    { id: 'on_rejected', type: 'mark', label: 'Rejected' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'review' },
    { id: 'e2', source: 'review', target: 'on_approved', label: 'approve' },
    { id: 'e3', source: 'review', target: 'on_rejected', label: 'reject' },
    { id: 'e4', source: 'review', target: 'wait_revision', label: 'revise' },
    { id: 'e5', source: 'wait_revision', target: 'review', label: 'resubmit', type: 'back' },
    { id: 'e6', source: 'on_approved', target: 'end' },
    { id: 'e7', source: 'on_rejected', target: 'end' },
  ],
};

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
    automation.registerFlow('two_step', TWO_STEP as never);
    automation.registerFlow('revise_flow', REVISE_FLOW as never);
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

    // ── The pause is still there through all of it.
    expect(await automation.hasSuspendedRun(runId)).toBe(true);

    // ── The only verb the card found: cancel. It works, and it is a loss —
    // `mark_rejected` never ran.
    expect(await automation.cancelRun(runId)).toBe(true);
    expect(marks, 'the reject branch never happened — what cancelling costs').toEqual([]);

    // ── ⭐ THE MECHANISM, measured without any of this card's own code.
    // A SECOND stranded-and-restored run (so the cancel above is undisturbed),
    // driven with the very resume the doors would have issued — marker stamped,
    // straight at the engine. It COMPLETES. So the restored suspension lacks
    // nothing and the `resumeAuthority` gate is not in the way: what is missing
    // is an ISSUER permitted to stamp that marker, and the four `pending`
    // guards are the only thing standing between an operator and this call.
    // That is why the repair belongs on the approvals side, not in the engine.
    const other = await strandThenRestore(automation);
    rejectBranchThrows = undefined;
    const marked: any = await automation.resume(other.flow_run_id, {
      branchLabel: 'reject',
      output: { decision: 'reject', requestId: other.id },
      [RESUME_AUTHORITY_SERVICE]: true,
    } as never);
    expect(marked.success, 'the re-armed pause IS resumable — the engine side is whole').toBe(true);
    expect(marks, 'and the branch the cancel would have discarded runs').toEqual(['mark_rejected']);
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

    // ⛔ POPULATION: all FOUR `pending`-guarded doors, each asserted here by
    // name. The earlier revision of this pin asserted `decide` alone while its
    // prose claimed all four — a pin cited for a wider population than its
    // cases, which is the shape that lets a real regression through.
    const refusals = {
      decide: await service.decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
        .then(() => null, (e: Error) => e.message),
      recall: await service.recall(req.id, { actorId: 'submitter' }, SYSTEM_CTX)
        .then(() => null, (e: Error) => e.message),
      sendBack: await service.sendBack(req.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX)
        .then(() => null, (e: Error) => e.message),
      resubmit: await service.resubmit(req.id, { actorId: 'submitter' } as any, SYSTEM_CTX)
        .then(() => null, (e: Error) => e.message),
    };
    expect(refusals.decide).toBe('INVALID_STATE: request is rejected');
    expect(refusals.recall, 'recall refuses a terminal row').toMatch(/INVALID_STATE|FORBIDDEN/);
    expect(refusals.sendBack, 'send-back refuses a terminal row').toMatch(/INVALID_STATE|FORBIDDEN/);
    expect(refusals.resubmit, 'resubmit refuses a non-returned row').toMatch(/INVALID_STATE|FORBIDDEN/);
  });

  it('PIN 6 — GUARD 1 (superseded): a terminal request cannot drive a pause its run moved on to', async () => {
    // POPULATION: two approval nodes in sequence, `a1` decided and `a2` live.
    // Before this guard, request 1's continuation walked a2's `approve` edge
    // and completed the run while request 2 sat `pending` with no decision.
    const automation = boot();
    await automation.execute('two_step', {
      object: 'crm_deal', record: { id: 'd9', amount: 5 }, userId: 'submitter',
    } as never);
    const req1 = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    await service.decide(req1.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    const req2 = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    expect(req2.id, 'the run moved on to a SECOND approval').not.toBe(req1.id);
    expect(await automation.hasSuspendedRun(req1.flow_run_id), 'a pause exists on the run').toBe(true);

    const refused = await service.continueRestoredRun(req1.id).then(() => null, (e: Error) => e);
    // Two identity guards independently reject this shape; the pin asserts the
    // OUTCOME and names which one spoke, rather than pretending to isolate.
    expect(refused?.message).toMatch(/^INVALID_STATE: (a newer approval request supersedes this one|run '.*' is parked at node 'a2')/);

    // ⭐ The point of the refusal: a2's pending approval was NOT advanced.
    const after = (await data.find('sys_approval_request', { where: { id: req2.id } }))[0];
    expect(after.status, 'still awaiting a real decision').toBe('pending');
    expect(marks, 'and no downstream node ran').toEqual([]);
    expect(await automation.hasSuspendedRun(req1.flow_run_id)).toBe(true);

    // GUARD 1 IN ISOLATION. The shape above is also caught by guard 3, so the
    // supersede check is driven on its own here: a newer row on the SAME node,
    // with `created_at` controlled so the ordering is the thing under test and
    // not the clock's resolution.
    await data.insert('sys_approval_request', {
      id: 'areq_newer', flow_run_id: req1.flow_run_id, flow_node_id: 'a1',
      status: 'pending', created_at: '2099-01-01T00:00:00.000Z', node_config_json: '{}',
    });
    const superseded = await service.continueRestoredRun(req1.id).then(() => null, (e: Error) => e);
    expect(superseded?.message, 'guard 1, driven and asserted alone')
      .toBe('INVALID_STATE: a newer approval request supersedes this one');
  });

  it('PIN 7 — GUARD 3 (node identity): a pause at another node is refused, and a retry cannot re-walk', async () => {
    // POPULATION (a): a `recalled` request whose run is parked at the
    // revise-window node — a pause this request never gated. Before this guard
    // the verb issued `reject` there and opened a NEW pending round on a
    // request somebody deliberately withdrew.
    const automation = boot();
    await automation.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd7', amount: 3 }, userId: 'submitter',
    } as never);
    const rev = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    await service.sendBack(rev.id, { actorId: 'u1', comment: 'fix it' } as any, SYSTEM_CTX);

    const parked = await automation.listSuspendedRunsDurable();
    expect(parked.find(r => r.runId === rev.flow_run_id)?.nodeId,
      'the run is parked at the revise window, not at the approval node').toBe('wait_revision');

    const refusedNode = await service.continueRestoredRun(rev.id).then(() => null, (e: Error) => e);
    expect(refusedNode?.message).toMatch(/is parked at node 'wait_revision', not at request .* own node 'review'/);
    const rounds = await data.find('sys_approval_request', { where: { flow_run_id: rev.flow_run_id } });
    expect(rounds, '⭐ no new pending round was opened').toHaveLength(1);

    // POPULATION (b): a plain RETRY of the verb — the ordinary shape of using
    // an operator tool, not a hostile construction. The first call consumes the
    // re-armed pause; a second must not walk whatever the run parked on next.
    const second = boot();
    rejectBranchThrows = DOWNSTREAM_FAILURE;
    await second.execute('two_step', {
      object: 'crm_deal', record: { id: 'd8', amount: 4 }, userId: 'submitter',
    } as never);
    const r1 = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    // Strand a1's approve continuation by making the run's next step throw.
    await second.restoreConsumedSuspension(r1.flow_run_id);
    const firstCall = await service.continueRestoredRun(r1.id).then(r => r, (e: Error) => e);
    const retry = await service.continueRestoredRun(r1.id).then(() => null, (e: Error) => e);
    expect(retry, 'a retry must not silently advance something else').toBeTruthy();
    expect(retry?.message).toMatch(/INVALID_STATE/);
    void firstCall;
  });

  it('PIN 8 — B2: `returned` is discriminated by the resubmit row, and `recalled` is refused', async () => {
    // POPULATION (a): a `returned` row whose LAST continuation was a resubmit,
    // with the journal removed to force the rebuild path — the pre-ship
    // population. One status writer, two issuers; rebuilding both as `revise`
    // sent a stranded resubmit down the wrong edge, and the engine's
    // unmatched-label fallback (#4414) let it proceed rather than fail loudly.
    const automation = boot();
    await automation.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd6', amount: 2 }, userId: 'submitter',
    } as never);
    const req = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    await service.sendBack(req.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX);
    // The row is `returned`; record the resubmit action the real door writes.
    await data.insert('sys_approval_action', {
      id: 'aact_resub_1', request_id: req.id, action: 'resubmit', step_index: 0,
    });
    const rebuilt = await (service as any).resolveRecordedContinuation(
      (await data.find('sys_approval_request', { where: { id: req.id } }))[0], req.id,
    );
    expect(rebuilt.source).toBe('reconstructed');
    expect(rebuilt.signal.decision, '⭐ resubmit, NOT revise').toBe('resubmit');
    expect(rebuilt.signal.branchLabel).toBe('resubmit');
    expect(rebuilt.signal.output).toEqual({ resubmitted: true, requestId: req.id });

    // POPULATION (b): the same row with NO resubmit action row rebuilds as the
    // send-back — the reverse control that keeps (a) from being a constant.
    const other = boot();
    await other.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd5', amount: 1 }, userId: 'submitter',
    } as never);
    const req2 = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    await service.sendBack(req2.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX);
    const rebuilt2 = await (service as any).resolveRecordedContinuation(
      (await data.find('sys_approval_request', { where: { id: req2.id } }))[0], req2.id,
    );
    expect(rebuilt2.signal.decision, 'no resubmit row ⇒ the send-back').toBe('revise');
    expect(rebuilt2.signal.branchLabel).toBe('revise');

    // POPULATION (c): `recalled` with no journal is REFUSED, not guessed —
    // two status writers, three behaviours, two issuing no continuation.
    const recalledRow = { id: 'areq_r', status: 'recalled', flow_run_id: 'run_r', flow_node_id: 'review', node_config_json: '{}' };
    const refused = await (service as any).resolveRecordedContinuation(recalledRow, 'areq_r')
      .then(() => null, (e: Error) => e);
    expect(refused?.message).toMatch(/is 'recalled' and carries no journalled continuation/);
    expect(refused?.message, 'and it names what the operator can do instead').toMatch(/cancelRun/);
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
    });

    const ambiguous = await service.continueRestoredRun(amb.id).then(() => null, (e: Error) => e);
    expect(ambiguous?.message).toMatch(/cannot tell a decided rejection from an ADR-0044/);
    // ⛔ And it refused by NOT resuming — the run is still parked, still repairable.
    expect(await second.hasSuspendedRun(amb.flow_run_id)).toBe(true);
  });
});
