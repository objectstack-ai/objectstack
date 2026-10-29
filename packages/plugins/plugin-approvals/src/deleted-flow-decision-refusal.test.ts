// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A decision on a request whose flow was deleted while its run was paused is
 * refused BEFORE anything is written (#26477).
 *
 * The reported failure: an admin deletes a scratch approval flow
 * (`DELETE /api/v1/automation/:name`) while a request is pending, and the
 * approver's Approve answers 500 `RESUME_FAILED` — after the decision row was
 * written and the request flipped to `approved`. The run never continued, and
 * nothing could repair it.
 *
 * The pre-flight (`assertRunResumable`, #4420) asked one question: does a
 * suspension still exist for the run? For a deleted flow it does — the parked
 * row outlives the flow — so the decision passed, was recorded, and the resume
 * then hit the engine's flow-gone exit (`RUN_NOT_FOUND`). The pre-flight now
 * also asks the engine the resume's own never-dispatched question
 * (`AutomationEngine.unresumableSuspensionCause`), so a run whose flow or
 * parked node is gone answers the same 409 `RESUME_TARGET_LOST` a cancelled
 * run gets, and records nothing.
 *
 * Real automation engine (durable in-memory suspended-run store, sealed as the
 * plugin seals it at `kernel:bootstrapped`), real `approval` node executor,
 * real `ApprovalService`; the approvals tables are an in-memory stand-in. The
 * REST door maps the message prefix to the status (`RESUME_TARGET_LOST` → 409,
 * `RESUME_FAILED` → 500); that mapping is pinned in `@objectstack/rest`'s
 * `rest-approvals-wire-codes.test.ts`, so these pins assert the thrown code.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * The accounts this suite routes `user` approver slots to: a `user` approver
 * holds a slot only when an account carries it (#27397), so the double's
 * directory starts with them.
 */
const ROUTED_USERS = ['u1'];

/**
 * In-memory ObjectQL stand-in for the approvals tables: the pinned double of
 * `decision-strand-envelope.test.ts`, copied whole (bound by presence, writes
 * through the engine-dispatch assertions).
 */
function makeFakeEngine() {
  const tables = new Map<string, any[]>([['sys_user', ROUTED_USERS.map((id) => ({ id }))]]);
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

/** A scratch flow with one approval node, as the card's reproduction registers it. */
function scratchFlow(opts: { withApprovalNode: boolean } = { withApprovalNode: true }) {
  return {
    name: 'scratch_approval',
    label: 'Scratch Approval',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      ...(opts.withApprovalNode
        ? [{ id: 'approve_step', type: 'approval', label: 'Approval', config: { approvers: [{ type: 'user', value: 'u1' }] } }]
        : []),
      { id: 'on_approved', type: 'mark', label: 'Approved' },
      { id: 'on_rejected', type: 'mark', label: 'Rejected' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: opts.withApprovalNode
      ? [
        { id: 'e1', source: 'start', target: 'approve_step' },
        { id: 'e2', source: 'approve_step', target: 'on_approved', label: 'approve' },
        { id: 'e3', source: 'approve_step', target: 'on_rejected', label: 'reject' },
        { id: 'e4', source: 'on_approved', target: 'end' },
        { id: 'e5', source: 'on_rejected', target: 'end' },
      ]
      : [
        { id: 'e1', source: 'start', target: 'on_approved' },
        { id: 'e4', source: 'on_approved', target: 'end' },
      ],
  };
}

describe('a decision on a run whose flow is gone is refused before it is recorded (#26477)', () => {
  let data: ReturnType<typeof makeFakeEngine>;
  let service: ApprovalService;
  let automation: AutomationEngine;
  let marks: string[];
  let runId: string;
  let requestId: string;

  beforeEach(async () => {
    marks = [];
    data = makeFakeEngine();
    service = new ApprovalService({ engine: data as any, logger: noopLogger });
    automation = new AutomationEngine(noopLogger as any, new InMemorySuspendedRunStore());
    registerApprovalNode(automation, service, noopLogger as any);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) { marks.push(node.id); return { success: true }; },
    });
    automation.registerFlow('scratch_approval', scratchFlow() as never);
    // The plugin seals at `kernel:bootstrapped`; a live server is past it.
    automation.sealNodeTypeVocabulary();
    service.attachAutomation(automation);

    const paused = await automation.execute('scratch_approval', {
      object: 'showcase_field_zoo', record: { id: 'r1' }, userId: 'submitter',
    });
    expect(paused.status).toBe('paused');
    runId = paused.runId!;
    requestId = (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0].id;
  });

  /** The half-state the card reported, asserted absent: nothing of the decision was written. */
  async function expectNothingRecorded() {
    const request = (await data.find('sys_approval_request', { where: { id: requestId } }))[0];
    expect(request.status, 'still pending, not a recorded "approved"').toBe('pending');
    expect(request.pending_approvers).toContain('u1');
    expect(
      await data.find('sys_approval_action', { where: { request_id: requestId, action: 'approve' } }),
      'no approve row for a decision that could not take effect',
    ).toHaveLength(0);
    expect(marks, 'no branch of the flow ran').toEqual([]);
  }

  const approve = () => service
    .decide(requestId, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
    .then(() => null, (e: Error) => e);

  it('flow deleted while paused: 409 RESUME_TARGET_LOST naming the cause, nothing recorded', async () => {
    // `DELETE /api/v1/automation/:name` → `unregisterFlow`. The parked row
    // outlives the flow, so a suspension still exists for the run.
    automation.unregisterFlow('scratch_approval');
    expect(await automation.hasSuspendedRun(runId), 'the parked row outlived its flow').toBe(true);

    const err = await approve();

    expect(err?.message).toMatch(/^RESUME_TARGET_LOST/);
    expect(err?.message, 'says why the run cannot continue').toContain(
      `Flow 'scratch_approval' not found for run '${runId}'`,
    );
    await expectNothingRecorded();
    // The pre-flight is a read: it settles nothing on the run either.
    expect(await automation.hasSuspendedRun(runId), 'the run row is untouched by the refusal').toBe(true);
  });

  it('parked node edited away: the same refusal, nothing recorded', async () => {
    automation.registerFlow('scratch_approval', scratchFlow({ withApprovalNode: false }) as never);

    const err = await approve();

    expect(err?.message).toMatch(/^RESUME_TARGET_LOST/);
    expect(err?.message).toContain(`Suspended node 'approve_step' no longer exists in flow 'scratch_approval'`);
    await expectNothingRecorded();
  });

  it('contrast — run cancelled first: the 409 RESUME_TARGET_LOST it already answered, nothing recorded', async () => {
    expect(await automation.cancelRun(runId, 'operator cancelled')).toBe(true);

    const err = await approve();

    expect(err?.message).toMatch(/^RESUME_TARGET_LOST/);
    expect(err?.message).toContain('no longer exists');
    await expectNothingRecorded();
  });

  it('a probe that cannot read the store fails OPEN, as the existence check does: the decision proceeds', async () => {
    vi.spyOn(automation, 'unresumableSuspensionCause').mockRejectedValue(new Error('store connection reset'));

    const out = await service.decide(requestId, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    expect(out).toMatchObject({ finalized: true, decision: 'approve', resumed: true });
    expect(marks).toEqual(['on_approved']);
  });

  it('the refusal\'s remedy holds: a recall releases the request and settles the orphaned run', async () => {
    automation.unregisterFlow('scratch_approval');
    expect((await approve())?.message).toMatch(/^RESUME_TARGET_LOST/);

    const recalled = await service.recall(requestId, { actorId: 'submitter' }, SYSTEM_CTX);

    expect(recalled.resumed, 'the recall could not resume a run whose flow is gone').toBe(false);
    expect((await data.find('sys_approval_request', { where: { id: requestId } }))[0].status).toBe('recalled');
    expect(await automation.hasSuspendedRun(runId), 'the recall\'s resume settled the orphan (#23963)').toBe(false);
  });
});
