// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15358 — THE REPRODUCTION: `inspectStrandedRequests` labels a repairable
 * strand and an UNREPAIRABLE cascade-failed ancestor identically.
 *
 * The card was filed from a reading of the sources. This file is the drive,
 * against a real `AutomationEngine` and a real `ApprovalService`, and it
 * reproduces: one fixture produces both rows, the inspection returns both as
 * `runState: 'failed'`, and the repair verb an operator would reach for next
 * answers `restored: true` for one and refuses the other.
 *
 * ## The two rows, from one fixture
 *
 * `deal_subflow` parks at an `approval`, and its approve edge leads to a
 * `subflow` node hosting `post_approval`, which parks at a SECOND `approval`
 * whose approve edge throws.
 *
 *  - CHILD run — the #13909 strand: its resume consumed the pause and the
 *    downstream node threw. The engine journals the consumed suspension, so
 *    `restoreConsumedSuspension` re-arms it. REPAIRABLE.
 *  - PARENT run — the cascade-failed ancestor (#15222's shape): it was parked
 *    at its `subflow` node when the descendant failed, so `failAncestors` ran
 *    `failSuspendedRun` on it, which consumes the pause and journals NOTHING.
 *    `restoreConsumedSuspension` refuses it `NO_CONSUMED_SUSPENSION`. The
 *    engine's own words for a terminal record carrying neither
 *    `consumedSuspension` nor `consumedSuspensionDropped` (`RunRecord`):
 *    "a run that reached a terminal state which was NOT a strand (completed,
 *    cancelled, cascade-failed)". UNREPAIRABLE — and this row's decision did
 *    advance its flow, which is the half the shared label denies.
 *
 * ## What must turn these assertions RED
 *
 * ⛔ The `runState` assertions below record what the inspection reports
 * TODAY. The maintainer ruling on this card (2026-09-04, decision batch #36,
 * option B) splits `StrandedRunState` into a repairable and an unrepairable
 * member and reports both, labelled apart — so whatever lands for B MUST turn
 * the "both come back identical" assertion red on purpose. It is written as a
 * single `toEqual` over both rows for exactly that reason: a split that
 * relabels only one of them still fails it.
 *
 * ## The measurement that sent the card back to the decision box
 *
 * `PIN 3` is the load-bearing one. B's first clause is "`getRun` widens to
 * carry the discriminator the engine already records". The engine records it
 * on the DURABLE `RunRecord`, and `AutomationEngine.getRun` answers an
 * `ExecutionLogEntry`, which carries neither field — deliberately: `recordLog`
 * says the snapshot is "a parameter rather than a field of
 * `ExecutionLogEntry`" because that interface "is served verbatim by
 * `GET /automation/:name/runs/:runId`". So widening the plugin-side
 * declaration alone cannot separate these two rows: on a real engine the
 * discriminator is absent for BOTH, and a classifier reading absence as "not a
 * strand" would answer UNREPAIRABLE for the repairable row — the #15555
 * false-negative harm, one surface over. Where the discriminator gets
 * published is a producer-side contract decision, and it is open.
 *
 * ## The control that makes the readings trustworthy
 *
 * `PIN 4` drives the SAME strand through a different door in the same run.
 * `decide` throws `RESUME_FAILED` carrying `{ finalized, decision, runId,
 * repairable: true }` (#13807, batch #37); `recall` reports the same strand as
 * a plain `resumeError` string with no envelope at all. ⇒ the difference is
 * the DOOR, not the strand — so a reading taken at one door is not a fact
 * about strands until the other door is driven too.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
// [#4550] The engine double's write verbs route through ObjectQL's OWN dispatch
// predicates rather than a hand-mirrored copy — a double looser than the engine
// it stands in for is how #4434 shipped a dead REST route with its suite green.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { strandedDecisionDetails } from '@objectstack/types';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const noopLogger: any = {
  info() {}, warn() {}, error() {}, debug() {}, child() { return noopLogger; },
};

/** The downstream failure, in the card's own shape. */
const DOWNSTREAM_FAILURE = 'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';

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
      // is a real bound that must return no rows.
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
    registerHook() {}, unregisterHooksByPackage() { return 0; }, async fire() {},
  };
}

/** PARENT: approval, then a subflow that hosts a second approval. */
const DEAL_SUBFLOW = {
  name: 'deal_subflow',
  label: 'Deal Approval With Follow-up Subflow',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'approve_step', type: 'approval', label: 'Manager Approval',
      config: { approvers: [{ type: 'user', value: 'u1' }] },
    },
    {
      id: 'sub', type: 'subflow', label: 'Post-approval subflow',
      config: { flowName: 'post_approval', outputVariable: 'subOut' },
    },
    { id: 'rejected', type: 'mark', label: 'Rejected' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'approve_step' },
    { id: 'e2', source: 'approve_step', target: 'sub', label: 'approve' },
    { id: 'e3', source: 'approve_step', target: 'rejected', label: 'reject' },
    { id: 'e4', source: 'sub', target: 'end' },
    { id: 'e5', source: 'rejected', target: 'end' },
  ],
};

/** CHILD: a second approval whose approve edge is the node that throws. */
const POST_APPROVAL = {
  name: 'post_approval',
  label: 'Post-approval follow-up',
  type: 'autolaunched',
  nodes: [
    { id: 'cstart', type: 'start', label: 'Start' },
    {
      id: 'hold', type: 'approval', label: 'Second Approval',
      config: { approvers: [{ type: 'user', value: 'u2' }] },
    },
    { id: 'boom', type: 'mark', label: 'Follow-up write' },
    { id: 'child_rejected', type: 'mark', label: 'Child rejected' },
    { id: 'cend', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'c1', source: 'cstart', target: 'hold' },
    { id: 'c2', source: 'hold', target: 'boom', label: 'approve' },
    { id: 'c3', source: 'hold', target: 'child_rejected', label: 'reject' },
    { id: 'c4', source: 'boom', target: 'cend' },
    { id: 'c5', source: 'child_rejected', target: 'cend' },
  ],
};

/** A single-approval flow, for the door control. */
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

describe('#15358 — a cascade-failed ancestor is reported as the repairable strand it is not', () => {
  let data: ReturnType<typeof makeFakeEngine>;
  let service: ApprovalService;
  /** Node id → the message it throws when reached. */
  let throwOn: Record<string, string | undefined>;

  beforeEach(() => {
    throwOn = {};
    data = makeFakeEngine();
    service = new ApprovalService({ engine: data as any, logger: noopLogger });
  });

  /** One live process: real engine, real builtin nodes, real approval node, real service. */
  function boot() {
    const automation = new AutomationEngine(noopLogger, new InMemorySuspendedRunStore());
    installBuiltinNodes(automation, { logger: noopLogger, getService() { throw new Error('none'); } } as any);
    registerApprovalNode(automation, service, noopLogger);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) {
        const boom = throwOn[node.id];
        if (boom) throw new Error(boom);
        return { success: true };
      },
    } as never);
    automation.registerFlow('deal_subflow', DEAL_SUBFLOW as never);
    automation.registerFlow('post_approval', POST_APPROVAL as never);
    automation.registerFlow('deal_approval', DEAL_APPROVAL as never);
    service.attachAutomation(automation);
    return automation;
  }

  const pendingRequest = async () =>
    (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];

  /**
   * Drive the composition to its two terminal requests: a CHILD run stranded
   * mid-continuation, and a PARENT run cascade-failed while parked at its
   * `subflow` node.
   */
  async function driveBothShapes(automation: AutomationEngine) {
    throwOn.boom = DOWNSTREAM_FAILURE;
    await automation.execute('deal_subflow', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    } as never);

    const parentReq = await pendingRequest();
    const parentRunId = parentReq.flow_run_id as string;
    expect(parentRunId, 'the first request names the parent run').toBeTruthy();

    // The parent's decision SUCCEEDS — it advances the flow into the subflow,
    // which is the whole reason its later `failed` row must not read as a
    // decision that never moved.
    const advanced = await service.decide(
      parentReq.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX,
    );
    expect(advanced.resumed, 'the parent decision DID advance the flow').toBe(true);
    expect(advanced.resumeError).toBeUndefined();
    expect(await automation.hasSuspendedRun(parentRunId), 'the parent is now parked at its subflow node').toBe(true);

    const childReq = await pendingRequest();
    const childRunId = childReq.flow_run_id as string;
    expect(childRunId, 'the child run hosts the second approval').toBeTruthy();
    expect(childRunId).not.toBe(parentRunId);

    // The child's decision strands the child AND cascade-fails the parent.
    const err = await service
      .decide(childReq.id, { decision: 'approve', actorId: 'u2' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(err?.message, 'the child door throws its stranded refusal').toMatch(/^RESUME_FAILED/);

    return { parentReq, parentRunId, childReq, childRunId, childError: err };
  }

  it('PIN 1 — the two rows come back with the SAME `runState`, and one of them cannot be repaired', async () => {
    const automation = boot();
    const { parentReq, parentRunId, childReq, childRunId } = await driveBothShapes(automation);

    // ⚠️ INSPECT BEFORE RESTORING ANYTHING: `restoreConsumedSuspension` re-arms
    // the pause, which would move the row out of the inspection's answer.
    const out = await service.inspectStrandedRequests();
    expect(out.scanned).toBe(2);
    expect(out.undetermined).toBe(0);

    const labelled = out.stranded
      .map(s => [s.requestId === parentReq.id ? 'cascade-failed ancestor' : 'genuine strand', s.runState])
      .sort((a, b) => a[0].localeCompare(b[0]));
    // ⛔ THE DEFECT, as one assertion: the label does not distinguish them.
    // Option B splits `StrandedRunState`, so this MUST go red when B lands.
    expect(labelled).toEqual([
      ['cascade-failed ancestor', 'failed'],
      ['genuine strand', 'failed'],
    ]);

    // …and both are reported with their decision durable, which is the true
    // half the report gets right for both rows.
    expect(out.stranded.map(s => s.status)).toEqual(['approved', 'approved']);
    expect(new Set(out.stranded.map(s => s.runId))).toEqual(new Set([parentRunId, childRunId]));
    void childReq;
  });

  it('PIN 2 — the repair verb DOES tell them apart: one is re-armed, the other refused', async () => {
    // This is the fact the shared label hides, and the operator-visible cost
    // named on the card: a reported row the repair verb declines.
    const automation = boot();
    const { parentRunId, childRunId } = await driveBothShapes(automation);

    const child = await automation.restoreConsumedSuspension(childRunId);
    expect(child.restored, 'the genuine strand is repairable').toBe(true);

    const parent = await automation.restoreConsumedSuspension(parentRunId);
    expect(parent.restored, 'the cascade-failed ancestor is NOT').toBe(false);
    // The refusal is named, and its name is the engine's own reading of a
    // terminal record carrying no consumed-suspension snapshot.
    expect((parent as { refusal?: string }).refusal).toBe('NO_CONSUMED_SUSPENSION');
  });

  it('PIN 3 — `getRun` carries NEITHER discriminator field, for either run', async () => {
    // Why B's first clause cannot be executed on the plugin side alone. The
    // engine records `consumedSuspension` / `consumedSuspensionDropped` on the
    // durable `RunRecord`; `getRun` answers an `ExecutionLogEntry`, and
    // `recordLog` keeps the snapshot OFF that interface on purpose because
    // `GET /automation/:name/runs/:runId` serves it verbatim.
    const automation = boot();
    const { parentRunId, childRunId } = await driveBothShapes(automation);

    for (const [what, runId] of [['strand', childRunId], ['cascade', parentRunId]] as const) {
      const run = await automation.getRun(runId);
      // Positive control FIRST: this read reached a real terminal record, so
      // the absences below are absences IN one, not the shape of a null.
      expect(run, `${what}: the run history answers`).toBeTruthy();
      expect(run?.status, `${what}: and answers 'failed'`).toBe('failed');
      expect(typeof run?.error, `${what}: carrying the failure text`).toBe('string');
      // ⛔ The measurement: the property the inspector would have to read is
      // not on the object it reads.
      expect(Object.keys(run as object)).not.toContain('consumedSuspension');
      expect(Object.keys(run as object)).not.toContain('consumedSuspensionDropped');
    }
  });

  it('PIN 4 — CONTROL: the same strand says `repairable: true` at one door and nothing at the other', async () => {
    // Without this, a reading taken at one door is not a reading about strands.
    throwOn.mark_rejected = DOWNSTREAM_FAILURE;
    const automation = boot();

    // Door A — `decide`, which throws the #13807 envelope.
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd2', amount: 10 }, userId: 'submitter',
    } as never);
    const decided = await pendingRequest();
    const decidedRunId = decided.flow_run_id as string;
    const err = await service
      .decide(decided.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);
    expect(strandedDecisionDetails(err)).toEqual({
      finalized: true, decision: 'reject', runId: decidedRunId, repairable: true,
    });

    // Door B — `recall`, same flow, same throwing node, same strand.
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd3', amount: 20 }, userId: 'submitter',
    } as never);
    const recalled = await pendingRequest();
    const recalledRunId = recalled.flow_run_id as string;
    const result = await service.recall(recalled.id, { actorId: 'submitter' }, SYSTEM_CTX);

    expect(result.resumed, 'the recall could not advance the run either').toBe(false);
    expect(result.resumeError, 'and reports it as a bare string').toContain(DOWNSTREAM_FAILURE);
    // ⛔ No envelope at this door — `repairable` is not stated at all…
    expect(strandedDecisionDetails(result as unknown)).toBeUndefined();
    // …while the strand behind it is every bit as repairable as door A's.
    expect((await automation.restoreConsumedSuspension(recalledRunId)).restored).toBe(true);
  });
});
