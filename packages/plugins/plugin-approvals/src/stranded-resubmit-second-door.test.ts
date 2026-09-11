// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17601 PROBE — RECORDED DEFECT, not endorsed behaviour.
 *
 * ⛔ Nothing here asserts that a second `resubmit` on a stranded-resubmit strand
 * is CORRECT. This file records what the door does today, because the card it
 * came from was a hypothesis derived from reading and explicitly not executed,
 * and the next reader of `continueRestoredRun` should not have to re-derive the
 * same chain from the same lines. Whether the door should be closed, or the
 * discriminator's prose scoped instead, is a ruling-grade question the card
 * routed to the decision box. ⇒ When that ruling lands and the repair changes
 * this behaviour, THIS PIN is the thing to update, and its update is the
 * repair's evidence.
 *
 * ⭐ THAT RULING LANDED (#17601, 2026-09-11): option B — the discriminator's
 * prose in `approval-service.ts` was scoped to this measurement and NO door was
 * narrowed, so the doubling measured below is ACCEPTED RESIDUE and every
 * assertion in this file stands exactly as it was.
 *
 * ## The hypothesis, and what it tested
 *
 * `resolveRecordedContinuation` discriminates the two continuation issuers of a
 * `returned` row by the presence of an `action: 'resubmit'` audit row, and
 * argues the discriminator is *"exact and structural"* on three clauses:
 * `action: 'resubmit'` has exactly one writer in the file, it is inserted
 * before that resume, and a resubmit opens the next round as a NEW row — *"so
 * at most one such action row exists per request"*.
 *
 * ⭐ MEASURED: the third clause does not hold on the stranded-resubmit strand.
 * A `resubmit` whose resume strands writes its audit row and opens NO new round
 * (the row stays `returned`), so once an operator re-arms the pause with
 * `restoreConsumedSuspension` — the state `continueRestoredRun` exists to serve
 * — a second `resubmit` by the same submitter passes all five door guards and
 * writes a SECOND `action: 'resubmit'` row on the same request.
 *
 * ## The bound on it, measured too, so the finding is not read wider than it is
 *
 * The discriminator's own READ is a presence check (`limit: 1`), so two rows
 * decide exactly as one does: MEASUREMENT C drives the resolver on the doubled
 * row and it still answers `resubmit`. ⇒ What is falsified is the stated
 * invariant and the audit trail's one-row-per-advancement shape, ⛔ not (on
 * today's code) the edge the repair verb reads.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
// [#4550] The engine double routes its write verbs through ObjectQL's OWN
// dispatch predicates rather than a hand-mirrored copy.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import { strandedDecisionDetails } from '@objectstack/types';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) =>
  ({ isSystem: false, userId, positions: [], permissions: [] }) as any;
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory ObjectQL stand-in for the approvals tables. */
function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  const rows = (o: string) => (tables.get(o) ?? (tables.set(o, []), tables.get(o)!));
  // The lever that makes a REAL strand reachable from a test: fail the very next
  // insert into one table, once. The approval node's executor opens the next
  // round by inserting a `sys_approval_request`, so failing that insert strands
  // the resume the same way a downstream node's throw does — `RESUME_FAILED`
  // with `repairable: true`, the suspension already consumed.
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
      // shape. SortNode's key is `order`, not `direction`.
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

/** ADR-0044 revise window: send-back parks the run at the `approval_revise` node. */
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

/**
 * One live process per scenario — real engine, real approval node, real
 * approvals service. Each scenario owns its own tables, so no leg can select a
 * row another leg left behind.
 */
function scenario() {
  const marks: string[] = [];
  const data = makeFakeEngine();
  const service = new ApprovalService({ engine: data as any, logger: noopLogger });
  const automation = new AutomationEngine(noopLogger as any, new InMemorySuspendedRunStore());
  registerApprovalNode(automation, service, noopLogger as any);
  automation.registerNodeExecutor({
    type: 'mark',
    async execute(node: any) { marks.push(node.id); return { success: true }; },
  } as never);
  automation.registerFlow('revise_flow', REVISE_FLOW as never);
  service.attachAutomation(automation);

  const countActions = async (requestId: string, action: string) =>
    (await data.find('sys_approval_action', { where: { request_id: requestId, action } })).length;
  const runRows = async (runId: string) =>
    await data.find('sys_approval_request', { where: { flow_run_id: runId } });
  const rowOf = async (id: string) =>
    (await data.find('sys_approval_request', { where: { id } }))[0];
  const parkedAt = async (runId: string) =>
    (await automation.listSuspendedRunsDurable()).find((r: any) => String(r.runId) === String(runId))?.nodeId;
  const tryResubmit = (requestId: string, userId: string) => service
    .resubmit(requestId, { actorId: userId } as any, asUser(userId))
    .then((value: any) => ({ ok: true as const, value }), (e: Error) => ({ ok: false as const, message: e.message }));

  /**
   * ⛔ PRECONDITION, asserted step by step. A probe that never reached the
   * stranded state is a probe that measured NOTHING about the second call, so
   * every step of getting there is a hard assertion rather than a setup line.
   */
  async function strandAResubmit(recordId: string) {
    await automation.execute('revise_flow', {
      object: 'crm_deal', record: { id: recordId, amount: 100 }, userId: 'submitter',
    } as never);
    const req: any = (await data.find('sys_approval_request', {
      where: { record_id: recordId, status: 'pending' },
    }))[0];
    expect(req?.flow_node_id, 'PRECONDITION: parked at the approval node').toBe('review');
    const runId = String(req.flow_run_id);

    await service.sendBack(req.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX);
    expect(await parkedAt(runId), 'PRECONDITION: the send-back parked the run at the revise window')
      .toBe('wait_revision');
    expect((await rowOf(req.id)).status, 'PRECONDITION: and the row reads `returned`').toBe('returned');

    // Strand the resubmit: the back-edge re-enters `review`, whose executor
    // opens round 2 by inserting a request — fail that insert, once.
    data.failNextInsert = 'sys_approval_request';
    const stranded = await service
      .resubmit(req.id, { actorId: 'submitter' } as any, asUser('submitter'))
      .then(() => null, (e: Error) => e);
    expect(stranded?.message, 'PRECONDITION: a REAL stranded resubmit').toMatch(/^RESUME_FAILED/);
    expect(strandedDecisionDetails(stranded)?.repairable,
      'PRECONDITION: the repairable strand this card is about').toBe(true);
    expect(data.failNextInsert, 'PRECONDITION: the injected failure fired and was consumed').toBeUndefined();

    // ⭐ The card's own description of the third strand shape, measured rather
    // than assumed: `returned`, no newer row, one audit row, pause consumed.
    expect((await rowOf(req.id)).status, 'PRECONDITION: the row is left `returned`').toBe('returned');
    expect(await runRows(runId), 'PRECONDITION: with NO newer row on the run').toHaveLength(1);
    expect(await countActions(req.id, 'resubmit'),
      'PRECONDITION: exactly one `action: resubmit` row so far').toBe(1);
    expect(await automation.hasSuspendedRun(runId),
      'PRECONDITION: the stranded resume consumed the suspension').toBe(false);

    return { req, runId };
  }

  return { data, service, automation, marks, countActions, runRows, rowOf, parkedAt, tryResubmit, strandAResubmit };
}

describe('#17601 — a second `resubmit` on a stranded-resubmit strand', () => {
  it('MEASUREMENT A — re-armed: every door guard passes and a SECOND `resubmit` audit row lands', async () => {
    const s = scenario();
    const { req, runId } = await s.strandAResubmit('d1');

    // The re-arm the card's `assertRunResumable → passes via hasSuspendedRun`
    // row depends on. This is not an exotic state: it is exactly the state
    // `restoreConsumedSuspension` puts a stranded run into, and the one
    // `continueRestoredRun` was built to serve.
    const rearmed = await s.automation.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
    expect(rearmed.restored, 'PRECONDITION: the pause really is back').toBe(true);
    expect(await s.automation.hasSuspendedRun(runId)).toBe(true);
    expect(await s.parkedAt(runId), 'PRECONDITION: re-armed at the revise window').toBe('wait_revision');

    // ── ⛔ FIRING CONTROLS. Each guard the card reads as "passes" is shown able
    // to REFUSE on this very row, in this very state — otherwise "it passed" is
    // indistinguishable from "it was never consulted".
    const foreign = await s.tryResubmit(req.id, 'u1');
    expect(foreign.ok, 'CONTROL: the submitter-only guard still fires').toBe(false);
    expect(foreign.ok === false && foreign.message).toMatch(/^FORBIDDEN: only the submitter may resubmit/);

    const requests = s.data.tables.get('sys_approval_request')!;
    const before = requests.length;
    // A colliding PENDING request on the same record, on another run so the
    // supersede guard cannot be the thing that speaks.
    requests.push({
      id: 'areq_collider', object_name: 'crm_deal', record_id: 'd1', status: 'pending',
      flow_run_id: 'run_other', created_at: '2020-01-01T00:00:00.000Z',
    });
    const collided = await s.tryResubmit(req.id, 'submitter');
    expect(collided.ok, 'CONTROL: the collision check still fires').toBe(false);
    expect(collided.ok === false && collided.message).toMatch(/^DUPLICATE_REQUEST/);
    requests.pop();

    // A newer row on the SAME run, so `assertLatestForRun` is the speaker.
    requests.push({
      id: 'areq_newer', object_name: 'crm_deal', record_id: 'd1', status: 'pending',
      flow_run_id: runId, created_at: '2099-01-01T00:00:00.000Z',
    });
    const superseded = await s.tryResubmit(req.id, 'submitter');
    expect(superseded.ok, 'CONTROL: the supersede guard still fires').toBe(false);
    expect(superseded.ok === false && superseded.message)
      .toBe('INVALID_STATE: a newer approval request supersedes this one');
    requests.pop();
    expect(requests.length, 'CONTROL: both control rows removed — the state is the one under test')
      .toBe(before);
    expect(await s.countActions(req.id, 'resubmit'),
      'CONTROL: and not one refusal wrote an audit row').toBe(1);

    // ── ⭐ THE MEASUREMENT. Same submitter, nothing else changed.
    const second = await s.tryResubmit(req.id, 'submitter');

    expect(second.ok, '⭐ the second `resubmit` is ADMITTED — the hypothesis reproduces').toBe(true);
    expect(second.ok === true && second.value.resumed, 'and the run moved').toBe(true);
    expect(second.ok === true && second.value.runId).toBe(runId);

    // ⭐ The falsified clause: `action: 'resubmit'` is written twice for one
    // request, where `resolveRecordedContinuation` records that at most one
    // such row exists per request.
    expect(await s.countActions(req.id, 'resubmit'),
      '⭐ TWO `action: resubmit` rows on one request').toBe(2);

    // What did and did not follow from it. Round 2 opened exactly ONCE — the
    // flow is not doubly advanced — and the row the second call acted on is
    // still the `returned` round-1 row, untouched.
    expect(await s.runRows(runId), 'round 2 opened, once').toHaveLength(2);
    expect((await s.rowOf(req.id)).status, 'the round-1 row is still `returned`').toBe('returned');
    expect(await s.parkedAt(runId), 'and the run is parked back at the approval node').toBe('review');
    expect(s.marks, 'no downstream mark node ran — the back-edge re-parks at `review`').toEqual([]);
  });

  it('MEASUREMENT B — CONTROL, un-re-armed: `assertRunResumable` refuses before anything is written', async () => {
    // The same second call with the ONE difference that matters: no re-arm, so
    // the suspension the stranded resume consumed is still gone. This is what
    // keeps MEASUREMENT A from being a statement about `resubmit` in general —
    // the re-armed pause is the specific thing that opens the door.
    const s = scenario();
    const { req, runId } = await s.strandAResubmit('d2');

    const second = await s.tryResubmit(req.id, 'submitter');
    expect(second.ok, 'refused').toBe(false);
    expect(second.ok === false && second.message).toMatch(/^RESUME_TARGET_LOST: the flow run/);

    // ⭐ And the refusal lands BEFORE the insert, which is why the audit row
    // count is the discriminating reading between the two measurements.
    expect(await s.countActions(req.id, 'resubmit'), 'still exactly one audit row').toBe(1);
    expect(await s.runRows(runId), 'and no round 2').toHaveLength(1);
  });

  it('MEASUREMENT C — the BOUND: the doubled row still rebuilds as `resubmit`, not as something else', async () => {
    // ⛔ Keeps the finding from being read wider than it is. The discriminator's
    // read is a PRESENCE check (`limit: 1`), so two rows answer exactly as one
    // does. What the doubling falsifies is the stated invariant and the audit
    // trail's one-row-per-advancement shape — ⛔ not, on today's code, the edge
    // the repair verb reads.
    const s = scenario();
    const { req, runId } = await s.strandAResubmit('d3');
    await s.automation.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
    const second = await s.tryResubmit(req.id, 'submitter');
    expect(second.ok, 'PRECONDITION: the doubling happened').toBe(true);
    expect(await s.countActions(req.id, 'resubmit')).toBe(2);

    // Force the rebuild path: strip the journal the failing door wrote, which
    // is also what a run stranded before the journal shipped looks like.
    const config = JSON.parse((await s.rowOf(req.id)).node_config_json);
    expect(config.__strandedContinuation, 'PRECONDITION: the door journalled it').toBeTruthy();
    delete config.__strandedContinuation;
    await s.data.update('sys_approval_request', {
      id: req.id, node_config_json: JSON.stringify(config),
    }, { context: SYSTEM_CTX });

    const rebuilt = await (s.service as any).resolveRecordedContinuation(await s.rowOf(req.id), req.id);
    expect(rebuilt.source).toBe('reconstructed');
    expect(rebuilt.signal.decision, 'two rows decide as one row does').toBe('resubmit');
    expect(rebuilt.signal.branchLabel).toBe('resubmit');

    // REVERSE CONTROL: the same resolver on a `returned` row with NO resubmit
    // action row answers `revise` — so the line above is a reading, not a
    // constant this resolver returns for every input.
    const bare = scenario();
    await bare.automation.execute('revise_flow', {
      object: 'crm_deal', record: { id: 'd4', amount: 4 }, userId: 'submitter',
    } as never);
    const other: any = (await bare.data.find('sys_approval_request', {
      where: { record_id: 'd4', status: 'pending' },
    }))[0];
    await bare.service.sendBack(other.id, { actorId: 'u1', comment: 'redo' } as any, SYSTEM_CTX);
    expect(await bare.countActions(other.id, 'resubmit'), 'CONTROL: no resubmit row on this one').toBe(0);
    const rebuiltBare = await (bare.service as any)
      .resolveRecordedContinuation(await bare.rowOf(other.id), other.id);
    expect(rebuiltBare.signal.decision, 'CONTROL: no resubmit row ⇒ the send-back').toBe('revise');
  });
});
