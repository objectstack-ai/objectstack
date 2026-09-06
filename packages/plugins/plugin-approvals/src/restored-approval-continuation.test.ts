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
import { registerApprovalReviseNode } from './approval-revise-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory ObjectQL stand-in for the approvals tables. */
function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  const rows = (o: string) => (tables.get(o) ?? (tables.set(o, []), tables.get(o)!));
  // ⭐ The lever that makes a REAL strand reachable from a test: fail the very
  // next insert into one table, once. The approval node's executor opens the
  // next round by inserting a `sys_approval_request`, so failing that insert
  // strands the resume the same way the card's own reject-branch throw does —
  // `RESUME_FAILED` with `repairable: true`, the suspension already consumed.
  // Set to a table name; the first insert into it throws and clears the lever.
  let failNextInsertOn: string | undefined;
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
    if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
    if (v && typeof v === 'object' && '$ne' in (v as any)) return row[k] !== (v as any).$ne;
    return row[k] === v;
  });
  return {
    tables,
    set failNextInsert(object: string | undefined) { failNextInsertOn = object; },
    get failNextInsert() { return failNextInsertOn; },
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
    async insert(object: string, data: any) {
      if (failNextInsertOn === object) {
        failNextInsertOn = undefined;
        throw new Error(`injected one-shot insert failure on ${object}`);
      }
      rows(object).push({ ...data }); return { ...data };
    },
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

  it('PIN 7 — GUARD 1 + GUARD 3: a pause this outcome was not issued at, and a plain retry', async () => {
    // POPULATION (a) — GUARD 3, the send-back rebuild. A `returned` request
    // (NOT `recalled`: a `recalled` row is refused by `resolveRecordedContinuation`
    // before any guard runs, so it can never reach guard 3 on the rebuild path)
    // whose run is parked at the revise window. Its recorded outcome is the
    // send-back, which was issued at the approval node and LANDED.
    //
    // ⚠️ NOTHING here was re-armed and nothing was refused: the send-back
    // succeeded, so the pause now at the revise window is an ordinary fresh
    // one that this verb was simply pointed at. The refusal's wording says
    // exactly that — the pause it was ASKED to continue is not the one the
    // outcome was ISSUED AT — because an earlier wording ("this re-armed pause
    // is not the one that outcome was refused on") presumed a re-arm and a
    // refusal that this population does not contain.
    // Before this guard the verb issued `revise` there.
    const automation = boot();
    await automation.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd7', amount: 3 }, userId: 'submitter',
    } as never);
    const rev = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    await service.sendBack(rev.id, { actorId: 'u1', comment: 'fix it' } as any, SYSTEM_CTX);
    expect((await rowOf(rev.id)).status, 'the row is `returned`').toBe('returned');

    const parked = await automation.listSuspendedRunsDurable();
    expect(parked.find(r => r.runId === rev.flow_run_id)?.nodeId,
      'the run is parked at the revise window, not at the approval node').toBe('wait_revision');

    const refusedNode = await service.continueRestoredRun(rev.id).then(() => null, (e: Error) => e);
    // ⚠️ The message must name the node the send-back was ISSUED FROM, which is
    // the approval node — not merely "this request's own node", a phrase that
    // was wrong for the one signal issued from somewhere else (population (c)).
    expect(refusedNode?.message).toMatch(
      /is parked at node 'wait_revision', but the send-back on request .* was issued from its own approval node 'review'/,
    );
    const rounds = await data.find('sys_approval_request', { where: { flow_run_id: rev.flow_run_id } });
    expect(rounds, '⭐ no new pending round was opened').toHaveLength(1);

    // POPULATION (b) — GUARD 1, a plain RETRY of the verb, driven end to end
    // through its own designed flow. This is the ordinary shape of using an
    // operator tool, not a hostile construction: the first call consumes the
    // re-armed pause and the run advances to the NEXT approval node; a second
    // call must not walk that node's pending pause.
    //
    // ⚠️ This replaces a construction that never reached guards 1–3 at all: it
    // set `rejectBranchThrows` for a flow with no `mark_rejected` node, never
    // decided anything, restored a suspension that was never consumed, and then
    // asserted a refusal that was only `request is pending`. It passed on every
    // input — a pin whose condition is unreachable is worse than no pin. The
    // strand below is real, and the lever that produces it is asserted consumed.
    const second = boot();
    await second.execute('two_step', {
      object: 'crm_deal', record: { id: 'd8', amount: 4 }, userId: 'submitter',
    } as never);
    const r1 = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
    expect(r1.flow_node_id, 'parked at the FIRST approval node').toBe('a1');

    // Strand a1's approve continuation: the resume walks the approve edge into
    // `a2`, whose executor opens round 2 by inserting a request — and that
    // insert fails, once.
    data.failNextInsert = 'sys_approval_request';
    const strand = await service
      .decide(r1.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(strand?.message, 'a REAL strand, the state this verb exists to repair').toMatch(/^RESUME_FAILED/);
    expect(strandedDecisionDetails(strand)?.repairable).toBe(true);
    expect(data.failNextInsert, 'the injected failure actually fired and was consumed').toBeUndefined();
    expect(await second.hasSuspendedRun(r1.flow_run_id), 'the suspension was consumed by the resume').toBe(false);
    expect(await data.find('sys_approval_request', { where: { flow_run_id: r1.flow_run_id } }),
      'round 2 never opened — the insert is what failed').toHaveLength(1);

    const rearmed = await second.restoreConsumedSuspension(r1.flow_run_id, { requestedBy: 'ops' });
    expect(rearmed.restored, 'the pause is back at a1').toBe(true);

    // ── The FIRST call is ASSERTED, never discarded. Discarding it is what hid
    // the previous version of this pin: a rejected promise assigned to a name
    // nothing reads is indistinguishable from a resolved one.
    const first = await service.continueRestoredRun(r1.id, { requestedBy: 'ops' });
    expect(first.resumed, '⭐ the first call is the one that must work').toBe(true);
    expect(first.source, 'the failing door journalled the signal it was carrying').toBe('journal');
    expect(first.decision).toBe('approve');
    const round2 = (await data.find('sys_approval_request', {
      where: { flow_run_id: r1.flow_run_id, status: 'pending' },
    }))[0];
    expect(round2?.flow_node_id, 'the run advanced to the SECOND approval node').toBe('a2');
    expect((await second.listSuspendedRunsDurable()).find(r => r.runId === r1.flow_run_id)?.nodeId,
      'and parked there — a live pause that is NOT r1\'s').toBe('a2');

    // ── The RETRY. r1 is terminal and superseded; a2's pause is somebody
    // else's. Guard 1 refuses before the pause is ever read.
    const retry = await service.continueRestoredRun(r1.id).then(() => null, (e: Error) => e);
    expect(retry?.message, 'guard 1, reached by an ordinary retry')
      .toBe('INVALID_STATE: a newer approval request supersedes this one');
    expect((await rowOf(round2.id)).status, '⭐ a2 is STILL pending — nothing decided it').toBe('pending');
    expect(marks, 'and no downstream branch ran').toEqual([]);
    expect(await second.hasSuspendedRun(r1.flow_run_id), 'the run is still parked, not completed').toBe(true);
  });

  it('PIN 8 — B2: a stranded resubmit is replayed as a resubmit, end to end, and `recalled` is refused', async () => {
    // POPULATION (a) — the DISCRIMINATOR ALONE, at `resolveRecordedContinuation`.
    // ⚠️ States its own population: this leg proves only that the rebuild picks
    // `resubmit` over `revise`. It does NOT prove the verb reaches that code —
    // populations (d) and (e) below are the legs through `continueRestoredRun`
    // end to end, and they exist because this leg was green while guard 3
    // refused every real caller before the resolver's answer was ever acted on.
    //
    // A `returned` row whose LAST continuation was a resubmit, with the journal
    // removed to force the rebuild path — the pre-ship population. One status
    // writer, two issuers; rebuilding both as `revise` sent a stranded resubmit
    // down the wrong edge, and the engine's unmatched-label fallback (#4414)
    // let it proceed rather than fail loudly.
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
    // Resolver-level like (a); end to end this shape is refused by guard 3, and
    // that refusal is PIN 7(a).
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

    // ── POPULATION (d) — THE WHOLE PATH, journal leg. A resubmit that stranded,
    // restored, and re-issued through `continueRestoredRun` itself.
    //
    // ⭐ This is the leg guard 3 used to refuse. A resubmit is issued from the
    // revise window, so the pause it strands on — and the pause the restore
    // re-arms — is at `wait_revision`, while the row's `flow_node_id` still
    // reads the approval node `review`. Comparing the parked node against the
    // row's own node refused this, and told the operator the pause was not this
    // request's when it was exactly this request's.
    const live = boot();
    await live.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd9', amount: 9 }, userId: 'submitter',
    } as never);
    // ⚠️ Selected by record, not by "the first pending row": earlier populations
    // in this pin leave their own pending rounds in the shared table, and the
    // bare status filter picked one of THOSE — a run belonging to an engine no
    // longer attached, which failed as `RESUME_TARGET_LOST` rather than as
    // anything about this leg.
    const rq = (await data.find('sys_approval_request', { where: { record_id: 'd9', status: 'pending' } }))[0];
    expect(rq?.flow_node_id, 'this leg owns its own run').toBe('review');
    await service.sendBack(rq.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX);
    expect((await live.listSuspendedRunsDurable()).find(r => r.runId === rq.flow_run_id)?.nodeId,
      'the send-back parked the run at the revise window').toBe('wait_revision');

    // Strand the resubmit: the back-edge re-enters `review`, whose executor
    // opens round 2 by inserting a request — fail that insert, once.
    data.failNextInsert = 'sys_approval_request';
    const strandedResubmit = await service
      .resubmit(rq.id, { actorId: 'submitter' } as any, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(strandedResubmit?.message, 'a real stranded resubmit').toMatch(/^RESUME_FAILED/);
    expect(strandedDecisionDetails(strandedResubmit)?.repairable).toBe(true);
    expect(data.failNextInsert, 'the injected failure fired and was consumed').toBeUndefined();

    const rearmed = await live.restoreConsumedSuspension(rq.flow_run_id, { requestedBy: 'ops' });
    expect(rearmed.restored).toBe(true);
    expect((await live.listSuspendedRunsDurable()).find(r => r.runId === rq.flow_run_id)?.nodeId,
      '⭐ re-armed at the revise window').toBe('wait_revision');
    expect((await rowOf(rq.id)).flow_node_id,
      '⭐ while the row still records the approval node — the two differ, by construction').toBe('review');

    const replayed = await service.continueRestoredRun(rq.id, { requestedBy: 'ops' });
    expect(replayed.resumed, '⭐ guard 3 admits it, because it asks where a RESUBMIT is issued from').toBe(true);
    expect(replayed.source, 'the failing door journalled the literal signal').toBe('journal');
    expect(replayed.decision).toBe('resubmit');
    expect(replayed.branchLabel).toBe('resubmit');
    expect(await data.find('sys_approval_request', { where: { flow_run_id: rq.flow_run_id } }),
      'round 2 opened — the back-edge was walked as a resubmit').toHaveLength(2);
    expect((await live.listSuspendedRunsDurable()).find(r => r.runId === rq.flow_run_id)?.nodeId,
      'and the run is parked back at the approval node').toBe('review');

    // ── POPULATION (e) — THE WHOLE PATH, rebuild leg: the same shape with the
    // journal stripped, which is what a run stranded BEFORE this shipped looks
    // like. This is the population the card names, and it is the one (a) was
    // cited for while nothing exercised it end to end.
    const pre = boot();
    await pre.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd10', amount: 10 }, userId: 'submitter',
    } as never);
    const rq2 = (await data.find('sys_approval_request', { where: { record_id: 'd10', status: 'pending' } }))[0];
    expect(rq2?.flow_node_id, 'this leg owns its own run').toBe('review');
    await service.sendBack(rq2.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX);
    data.failNextInsert = 'sys_approval_request';
    await service.resubmit(rq2.id, { actorId: 'submitter' } as any, SYSTEM_CTX)
      .then(() => null, () => null);
    expect(data.failNextInsert, 'the injected failure fired').toBeUndefined();
    await pre.restoreConsumedSuspension(rq2.flow_run_id, { requestedBy: 'ops' });

    const preConfig = JSON.parse((await rowOf(rq2.id)).node_config_json);
    expect(preConfig.__strandedContinuation, 'the door DID journal it — this leg removes it on purpose').toBeTruthy();
    delete preConfig.__strandedContinuation;
    await data.update('sys_approval_request', {
      id: rq2.id, node_config_json: JSON.stringify(preConfig),
    }, { context: SYSTEM_CTX });

    const rebuiltRun = await service.continueRestoredRun(rq2.id, { requestedBy: 'ops' });
    expect(rebuiltRun.source, 'no journal — rebuilt from the resubmit action row').toBe('reconstructed');
    expect(rebuiltRun.resumed, '⭐ and the rebuild is ACTED ON, not merely computed').toBe(true);
    expect(rebuiltRun.decision).toBe('resubmit');
    expect(await data.find('sys_approval_request', { where: { flow_run_id: rq2.flow_run_id } }),
      'round 2 opened on the rebuild path too').toHaveLength(2);
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


  it('PIN 9 — a journal the row\'s status can no longer have issued is REFUSED, not replayed', async () => {
    // ⭐ THE CLASS: the journal records what the LAST FAILED resume was
    // carrying. Nothing rewrites it when a later door moves the row on, and it
    // was returned before `raw.status` was looked at — so a stale signal
    // outlived the state that issued it and got replayed onto a re-armed pause.
    //
    // ⛔ Neither limb below needs an injected failure beyond the strand itself.
    // The recall is a REAL recall answering ordinarily: `cancelRun` on an
    // already-stranded run answers `false`, so the row is marked `recalled`,
    // the run stays parked, and `recall` returns `resumed: false` with no
    // `resumeError`. Every step is an ordinary operator or submitter action.

    // ── POPULATION (a) — P6b-ii. A stranded RESUBMIT, then a recall.
    // ⚠️ SCOPE, measured rather than assumed. This limb is NEWLY ADMITTED by
    // the signal-aware guard 3 of this revision: driven against the PREVIOUS
    // revision of this file (blob 8514677bd) and against a mutation that
    // removes only the signal-awareness, it is refused by guard 3 instead —
    // "parked at node 'wait_revision' … issued from its own approval node
    // 'review'". ⛔ That makes the signal-awareness the thing that EXPOSED it,
    // not the thing that causes it: the stale journal was always being returned
    // before the row's status was read, and widening guard 3 merely stopped
    // being the accident that hid it. Which is why the check lives at the
    // journal — and why removing the signal-awareness does NOT red this pin:
    // the compatibility check refuses first, before guard 3 is reached. The
    // reverse control that fires here is disabling the check itself; with it
    // disabled this assertion reds, because the verb resumes instead.
    const live = boot();
    await live.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd11', amount: 11 }, userId: 'submitter',
    } as never);
    const rq = (await data.find('sys_approval_request', { where: { record_id: 'd11', status: 'pending' } }))[0];
    expect(rq?.flow_node_id, 'this leg owns its own run').toBe('review');
    await service.sendBack(rq.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX);
    data.failNextInsert = 'sys_approval_request';
    const strandedResubmit = await service
      .resubmit(rq.id, { actorId: 'submitter' } as any, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(strandedResubmit?.message, 'a REAL stranded resubmit').toMatch(/^RESUME_FAILED/);
    expect(data.failNextInsert, 'the injected failure fired and was consumed').toBeUndefined();
    expect(JSON.parse((await rowOf(rq.id)).node_config_json).__strandedContinuation?.decision,
      'the door journalled `resubmit`').toBe('resubmit');

    // The recall: no lever, no injected failure — the real door on a stranded run.
    const recalled = await service.recall(rq.id, { actorId: 'submitter', reason: 'withdrawn' } as any, SYSTEM_CTX);
    expect(recalled.resumed, 'cancelRun on an already-stranded run answers false').toBe(false);
    expect((recalled as any).resumeError, 'and it is not an error path').toBeUndefined();
    expect((await rowOf(rq.id)).status, 'the row is withdrawn').toBe('recalled');

    const rearmed = await live.restoreConsumedSuspension(rq.flow_run_id, { requestedBy: 'ops' });
    expect(rearmed.restored, 'the restore succeeds — it knows nothing about the recall').toBe(true);
    expect((await live.listSuspendedRunsDurable()).find(r => r.runId === rq.flow_run_id)?.nodeId,
      're-armed at the revise window, which is exactly where a resubmit is issued from').toBe('wait_revision');

    const refusedStale = await service.continueRestoredRun(rq.id, { requestedBy: 'ops' })
      .then(() => null, (e: Error) => e);
    expect(refusedStale?.message,
      '⭐ the stale `resubmit` is refused because a `recalled` row cannot have issued it').toMatch(
      /is 'recalled' and its journalled continuation is the resubmit, which a 'recalled' request cannot have issued/,
    );
    expect(refusedStale?.message, 'and it names what the operator can do instead').toMatch(/cancelRun/);
    expect(await data.find('sys_approval_request', { where: { flow_run_id: rq.flow_run_id } }),
      '⭐ NO fresh pending round was opened on a withdrawn request').toHaveLength(1);
    expect((await live.listSuspendedRunsDurable()).find(r => r.runId === rq.flow_run_id)?.nodeId,
      'and the pause is intact, still cancellable').toBe('wait_revision');

    // ── POPULATION (b) — P6c-ii, the revise sibling. A stranded SEND-BACK, then
    // a recall. ⚠️ This limb PREDATES the widening: measured admitted at the
    // previous revision of this file and under M8 as well, so it is not
    // guard 3's doing and no change to guard 3 could have closed it.
    const other = boot();
    let reviseThrowArmed = true;
    other.registerNodeExecutor({
      type: APPROVAL_REVISE_NODE_TYPE,
      async execute() {
        if (reviseThrowArmed) { reviseThrowArmed = false; throw new Error('revise window unavailable'); }
        return { success: true };
      },
    } as never);
    await other.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd12', amount: 12 }, userId: 'submitter',
    } as never);
    const rq2 = (await data.find('sys_approval_request', { where: { record_id: 'd12', status: 'pending' } }))[0];
    const strandedSendBack = await service
      .sendBack(rq2.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(strandedSendBack?.message, 'a REAL stranded send-back').toMatch(/^RESUME_FAILED/);
    expect(reviseThrowArmed, 'the one-shot throw fired and was consumed').toBe(false);
    // Put the real revise-window executor back: the throw was the strand, not
    // the fixture — the replay under test must meet a working window.
    registerApprovalReviseNode(other as any, noopLogger as any);
    expect((await rowOf(rq2.id)).status, 'the send-back landed on the row').toBe('returned');
    expect(JSON.parse((await rowOf(rq2.id)).node_config_json).__strandedContinuation?.decision,
      'the door journalled `revise`').toBe('revise');

    const recalled2 = await service.recall(rq2.id, { actorId: 'submitter', reason: 'withdrawn' } as any, SYSTEM_CTX);
    expect(recalled2.resumed).toBe(false);
    expect((await rowOf(rq2.id)).status).toBe('recalled');
    await other.restoreConsumedSuspension(rq2.flow_run_id, { requestedBy: 'ops' });
    expect((await other.listSuspendedRunsDurable()).find(r => r.runId === rq2.flow_run_id)?.nodeId,
      're-armed at the approval node — which IS where a send-back is issued from, so guard 3 admits it')
      .toBe('review');

    const refusedStale2 = await service.continueRestoredRun(rq2.id, { requestedBy: 'ops' })
      .then(() => null, (e: Error) => e);
    expect(refusedStale2?.message,
      '⭐ the stale `revise` is refused for the same reason, one signal over').toMatch(
      /is 'recalled' and its journalled continuation is the revise, which a 'recalled' request cannot have issued/,
    );
    expect((await other.listSuspendedRunsDurable()).find(r => r.runId === rq2.flow_run_id)?.nodeId,
      '⭐ the run was NOT walked into the revise window for a withdrawn request').toBe('review');

    // ── POPULATION (c) — THE COMPATIBLE CONTROL, and it is what keeps (a)/(b)
    // from being "a `recalled` row is refused". A recall taken on a PENDING
    // request resumes down `reject`; strand that resume and the journal reads
    // `recall` on a `recalled` row — the one continuation that status CAN have
    // issued. It must still replay, or the new check has silently retired the
    // journal-recoverable recall the previous round measured and shipped.
    const third = boot();
    rejectBranchThrows = DOWNSTREAM_FAILURE;
    const req3 = await park(third);
    // ⚠️ `recall` does not THROW its strand — it reports through `resumeError`
    // and returns (the withdrawal is durable either way). Asserting a throw
    // here measured nothing; the strand is the `resumeError` plus a consumed
    // suspension, and both are asserted.
    const strandedRecall = await service
      .recall(req3.id, { actorId: 'submitter', reason: 'withdrawn' } as any, SYSTEM_CTX);
    expect(strandedRecall.resumed, 'the resume down `reject` failed').toBe(false);
    expect(strandedRecall.resumeError, 'a REAL stranded recall, reported not thrown')
      .toContain(DOWNSTREAM_FAILURE);
    expect(await third.hasSuspendedRun(req3.flow_run_id),
      'the suspension was consumed by the failed resume').toBe(false);
    expect((await rowOf(req3.id)).status).toBe('recalled');
    expect(JSON.parse((await rowOf(req3.id)).node_config_json).__strandedContinuation?.decision,
      'the door journalled `recall`').toBe('recall');
    await third.restoreConsumedSuspension(req3.flow_run_id, { requestedBy: 'ops' });

    rejectBranchThrows = undefined;
    marks.length = 0;
    const replayed = await service.continueRestoredRun(req3.id, { requestedBy: 'ops' });
    expect(replayed.resumed, '⭐ a COMPATIBLE journal still replays — the check gates, it does not blanket-refuse')
      .toBe(true);
    expect(replayed.source).toBe('journal');
    expect(replayed.decision).toBe('recall');
    expect(marks, 'and the reject branch it was carrying actually ran').toEqual(['mark_rejected']);
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
