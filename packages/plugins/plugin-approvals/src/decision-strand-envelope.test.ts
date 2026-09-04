// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A recorded decision whose run strands says so in FIELDS, not only in prose
 * (#13807 — maintainer ruling 2026-09-04, decision batch #37, option B).
 *
 * ## The reported defect
 *
 * One `POST /api/v1/approvals/requests/{id}/reject` produced three coexisting
 * outcomes: the caller read HTTP 500, the request row WAS `rejected` and had
 * left the pending inbox, and the workflow run was stranded. A caller — human,
 * script, or agent — reads 500 as "the rejection did not happen" and retries
 * or escalates. It did happen.
 *
 * ## What the ruling did and did NOT change
 *
 * ⛔ The status code does not move. Returning 200 is named forbidden on the
 * card and the ruling upholds it: the effect landing while the run strands is
 * still a failure. ⛔ The door does not become atomic either — the #13937
 * shape-4 ruling binds this door's own writes too, so there is no
 * approvals-side revert of the mirrored status, no automatic restore, and no
 * discarding a decision a person actually made. The contract
 * (`ApprovalDecisionResult`) declares the throw-rather-than-half-state
 * deliberate, and this makes that throw TRUTHFUL rather than replacing it.
 *
 * What changed is that the door stops discarding what the engine said. The
 * engine stamps `AutomationResult.status: 'stranded'` on exactly the exit that
 * journals a repair snapshot — and until this change that member had a
 * producer and ZERO consumers, because `serviceResume` read only
 * `success` / `code` / `error` and dropped it one line before the envelope was
 * built. The literal object the door receives on this exit carries
 * `status: 'stranded'` and NO `code` at all, so a door reading only the code
 * sees an unnamed failure.
 *
 * ## The three pins the ruling asked for
 *
 *  1. the three-outcome reproduction, asserting the new fields;
 *  2. a healthy decision, unchanged;
 *  3. `'stranded'` observed AT THE DOOR, not dropped — with its reverse
 *     control, a resume failure the engine does NOT call stranded, which must
 *     report `repairable: false` rather than inheriting a default.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
// [#4550] The engine doubles below route their write verbs through ObjectQL's
// OWN dispatch predicates rather than a hand-mirrored copy — a double looser
// than the engine it stands in for is how #4434 shipped a dead REST route with
// its suite green.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
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
      // The caller's bound is honoured by PRESENCE, never truthiness: `limit: 0`
      // is a real bound that must return no rows, and a falsy test hands back
      // the whole table instead.
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
  name: 'deal_approval',
  label: 'Deal Approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'approve_step', type: 'approval', label: 'Manager Approval',
      config: { approvers: [{ type: 'user', value: 'u1' }] },
    },
    { id: 'on_approved', type: 'mark', label: 'Approved' },
    // The card's own failing node: the reject branch writes back to the
    // record, and on the reported deployment that record was gone.
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

describe('#13807 — a stranded decision publishes its facts, and keeps its status code', () => {
  let data: ReturnType<typeof makeFakeEngine>;
  let service: ApprovalService;
  let marks: string[];
  /** When set, `mark_rejected` throws it — the card's downstream failure. */
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

  const pendingRequest = async () =>
    (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];

  const actionsOn = async (requestId: string) =>
    (await data.find('sys_approval_action', { where: { request_id: requestId } })).map(a => a.action);

  beforeEach(() => {
    marks = [];
    rejectBranchThrows = undefined;
    data = makeFakeEngine();
    service = new ApprovalService({ engine: data as any, logger: noopLogger });
  });

  /** Park a run at the approval node and hand back its pending request. */
  async function park(automation: AutomationEngine) {
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    } as never);
    return pendingRequest();
  }

  it('PIN 1 — the three coexisting outcomes, with the new fields naming all three', async () => {
    // The card's own node failure text, verbatim in shape: the reject branch
    // updates a record that no longer exists.
    rejectBranchThrows = 'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';
    const automation = boot();
    const req = await park(automation);
    const runId = req.flow_run_id;
    expect(runId, 'the request must name the run it gates').toBeTruthy();

    const err = await service
      .decide(req.id, { decision: 'reject', actorId: 'u1', comment: 'no' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    // ── OUTCOME 1: the caller is told this FAILED. Unchanged, deliberately.
    expect(err, 'the door still throws — ⛔ not "return 200"').toBeTruthy();
    expect(err?.message).toMatch(/^RESUME_FAILED/);
    // The prose is untouched: it is what a human reads in a log, and the
    // ruling added a machine-readable half rather than rewriting the sentence.
    expect(err?.message).toMatch(/could not be resumed and is now stranded/);
    expect(err?.message).toContain(rejectBranchThrows);

    // ── OUTCOME 2: the decision IS durable, and the envelope says so.
    const row = (await data.find('sys_approval_request', { where: { id: req.id } }))[0];
    expect(row.status, 'the effect landed — this is the fact the 500 used to hide').toBe('rejected');
    expect(row.completed_at).toBeTruthy();
    expect(await actionsOn(req.id)).toContain('reject');

    // ── OUTCOME 3: the run is stranded, and it is NAMED.
    expect(await automation.hasSuspendedRun(runId)).toBe(false);
    expect((await automation.resume(runId)).code).toBe('RUN_NOT_FOUND');

    // ⭐ The ruling's deliverable: all three readable as fields, by a caller
    // that never parses the sentence. Before this an operator had to regex the
    // run id out of prose and had no way at all to learn `finalized`.
    const details = strandedDecisionDetails(err);
    expect(details, 'the error must carry the machine-readable half').toBeDefined();
    expect(details).toEqual({
      finalized: true,
      decision: 'reject',
      runId,
      repairable: true,
    });
  });

  it("PIN 2 — a healthy decision is unchanged: no throw, no envelope", async () => {
    // The reverse control for PIN 1. Only the downstream node changes; if this
    // answered the same way, PIN 1 would be measuring the harness.
    const automation = boot();
    const req = await park(automation);

    const out = await service.decide(
      req.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX,
    );

    expect(out.finalized).toBe(true);
    expect(out.decision).toBe('reject');
    expect(out.resumed, 'the run advanced — nothing to report').toBe(true);
    expect(out.resumeError).toBeUndefined();
    expect(marks).toEqual(['mark_rejected']);
    // A success carries no stranded envelope anywhere: the fields exist to
    // describe a failure, and a healthy call must not grow a failure shape.
    expect(strandedDecisionDetails(out as unknown)).toBeUndefined();
  });

  it("PIN 3 — 'stranded' is read AT THE DOOR, and its absence is not read as repairable", async () => {
    // The signal the platform already produced and nobody consumed. This pins
    // the DOOR's reading of it, which is the half that was missing: the
    // engine's own suite proves the stamp exists.
    rejectBranchThrows = 'the node blew up';
    const automation = boot();
    const req = await park(automation);

    // What the engine actually hands the door on this exit — captured here so
    // the pin fails if the producer's shape moves, not only if the door does.
    // ⚠️ It carries a `status` and NO `code`: a door reading only `code` (as
    // this one did) sees an unnamed failure and cannot tell a repairable
    // strand from a dead run.
    const seen: any[] = [];
    const realResume = automation.resume.bind(automation);
    (automation as any).resume = async (...args: any[]) => {
      const r = await (realResume as any)(...args);
      seen.push(r);
      return r;
    };

    const err = await service
      .decide(req.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    expect(seen.length).toBe(1);
    expect(seen[0].success).toBe(false);
    expect(seen[0].status, "the producer's discriminator, #13937 shape 4").toBe('stranded');
    expect(seen[0].code, 'and it names no code — which is why status had to be carried').toBeUndefined();
    expect(strandedDecisionDetails(err)?.repairable).toBe(true);

    // ── REVERSE CONTROL: a resume failure the engine does NOT call stranded.
    // `repairable` must be false, not defaulted-true and not inherited: the
    // run has no journalled snapshot, so the repair verb would refuse. ⛔ The
    // absence of the signal is not the presence of repairability.
    const fresh = makeFakeEngine();
    const lost = new ApprovalService({ engine: fresh as any, logger: noopLogger });
    const lostAutomation = new AutomationEngine(noopLogger as any, new InMemorySuspendedRunStore());
    registerApprovalNode(lostAutomation, lost, noopLogger as any);
    lostAutomation.registerNodeExecutor({
      type: 'mark', async execute() { return { success: true }; },
    } as never);
    lostAutomation.registerFlow('deal_approval', DEAL_APPROVAL as never);
    lost.attachAutomation({
      hasSuspendedRun: async () => true,
      // The #4420 shape: the engine REPORTS the failure rather than throwing,
      // names a code, and reports no run status at all.
      resume: async () => ({ success: false, code: 'RUN_NOT_FOUND', error: "No suspended run 'run_x'" }),
    } as never);
    await lostAutomation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd2', amount: 7 }, userId: 'submitter',
    } as never);
    const lostReq = (await fresh.find('sys_approval_request', { where: { status: 'pending' } }))[0];

    const lostErr = await lost
      .decide(lostReq.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    const lostDetails = strandedDecisionDetails(lostErr);
    expect(lostDetails, 'still a truthful envelope — the decision still stands').toBeDefined();
    expect(lostDetails?.finalized).toBe(true);
    expect(lostDetails?.decision).toBe('approve');
    expect(lostDetails?.repairable, 'no stranded stamp ⇒ no repair promise').toBe(false);
    expect(lostDetails?.runId, 'and it still names the run an operator must look at')
      .toBe(lostReq.flow_run_id);
  });
});
