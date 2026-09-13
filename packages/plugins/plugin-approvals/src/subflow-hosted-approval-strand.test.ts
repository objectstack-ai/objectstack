// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15556 — an approval hosted inside a SUBFLOW CHILD, whose parent's
 * continuation fails.
 *
 * The card was filed NOT MEASURED — the seam and its swallowing `catch` were
 * found by reading `engine.ts`, and nobody had driven the composition. This
 * file is that drive, with its controls in the same run. It reproduced the
 * defect, and now pins the fix (#16472 family ruling, maintainer 2026-09-07,
 * decision batch #76, option A).
 *
 * ## The composition
 *
 * `deal_parent` parks at a `subflow` node; the child `deal_approval` parks at
 * an `approval` node, so the approvals row names the CHILD run. The decision
 * door resumes the child, the child completes, `bubbleToParent` resumes the
 * parent, and the parent's own downstream node throws.
 *
 * ## What was measured, and what the ruling fixed
 *
 * MEASURED, unchanged by this fix: the parent lands on the engine's stranded
 * exit — `{ success: false, status: 'stranded' }`, journalled and repairable
 * — and `bubbleToParent` logs that at `error`, naming the run and the repair
 * verb (`subflow-bubble-strand-log-level.test.ts` in `service-automation`
 * holds those pins, both directions; the #16472 ruling explicitly leaves the
 * log alone).
 *
 * FIXED here: before this ruling the decision door's resume-facing answer was
 * IDENTICAL to a healthy composition's — no caller could tell the two apart,
 * and the `runId` it handed back named the CHILD, which completed, never the
 * stranded parent. The door's status code still does not move (`resumed`
 * stays `true` — the CHILD really did resume) but the answer now carries the
 * strand behind it: `resumeFailure` names the PARENT's `runId` and
 * `repairable`, and `resumeError` tells the same fact in prose. Read off
 * `AutomationEngine.takeSubflowParentStrand` (added for this card), which
 * `serviceResume` consults right after its own resume reports success.
 *
 * ## The controls that make the reading trustworthy
 *
 * `CONTROL A` drives the healthy composition through the SAME door in the
 * same run — proof that the two answers now genuinely DIVERGE, not that this
 * test's plumbing merely stopped checking. `CONTROL B` drives the #13807
 * shape — no subflow, the child's own branch throws — where the door still
 * throws `RESUME_FAILED` with its stranded envelope, unaffected by this card.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { strandedDecisionDetails } from '@objectstack/types';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;

/** The card's own downstream failure text, in shape. */
const DOWNSTREAM_FAILURE = 'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';

/**
 * The resume-facing answer a caller reads, minus the run id — CONTROL A's
 * shape: a plain healthy resume with nothing behind it to tell. Before the
 * fix this was ALSO the stranded composition's answer, byte for byte — the
 * defect this file reproduced. It no longer is; the stranded test asserts
 * its own, divergent shape below instead of reusing this constant.
 */
const FULL_SUCCESS = { finalized: true, decision: 'approve', resumed: true, resumeError: undefined };

/** Records every level so the "only artefact is a log line" claim is measurable. */
function recordingLogger() {
  const lines: Array<{ level: string; msg: string; meta?: unknown }> = [];
  const mk = (level: string) => (msg: string, meta?: unknown) => { lines.push({ level, msg, meta }); };
  const self: any = {
    lines,
    info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug'),
    child() { return self; },
  };
  return self;
}

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

/** The CHILD: an approval node, exactly the #13807 fixture. */
const CHILD = {
  name: 'deal_approval',
  label: 'Deal Approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'approve_step', type: 'approval', label: 'Manager Approval', config: { approvers: [{ type: 'user', value: 'u1' }] } },
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

/** The PARENT: hosts the child in a `subflow` node, then does more work. */
const PARENT = {
  name: 'deal_parent',
  label: 'Deal Parent',
  type: 'autolaunched',
  nodes: [
    { id: 'pstart', type: 'start', label: 'Start' },
    { id: 'sub', type: 'subflow', label: 'Run the approval subflow', config: { flowName: 'deal_approval', outputVariable: 'subOut' } },
    { id: 'after_sub', type: 'mark', label: 'After the subflow' },
    { id: 'pend', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'p1', source: 'pstart', target: 'sub' },
    { id: 'p2', source: 'sub', target: 'after_sub' },
    { id: 'p3', source: 'after_sub', target: 'pend' },
  ],
};

describe('#15556 — an approval hosted in a subflow child, whose parent bubble fails', () => {
  let data: ReturnType<typeof makeFakeEngine>;
  let service: ApprovalService;
  let logger: ReturnType<typeof recordingLogger>;
  let marks: string[];
  let throwOn: Record<string, string | undefined>;

  beforeEach(() => {
    marks = [];
    throwOn = {};
    logger = recordingLogger();
    data = makeFakeEngine();
    service = new ApprovalService({ engine: data as any, logger });
  });

  function boot() {
    const automation = new AutomationEngine(logger, new InMemorySuspendedRunStore());
    installBuiltinNodes(automation, { logger, getService() { throw new Error('none'); } } as any);
    registerApprovalNode(automation, service, logger);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) {
        const boom = throwOn[node.id];
        if (boom) throw new Error(boom);
        marks.push(node.id);
        return { success: true };
      },
    } as never);
    automation.registerFlow('deal_approval', CHILD as never);
    automation.registerFlow('deal_parent', PARENT as never);
    service.attachAutomation(automation);
    return automation;
  }

  const pendingRequest = async () =>
    (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];

  /** The resume-facing projection of the door's answer — everything a caller reads about the run. */
  const resumeFacing = (r: any) => ({
    finalized: r.finalized, decision: r.decision, resumed: r.resumed, resumeError: r.resumeError,
  });

  it('the parent STRANDS, and the door now tells the caller so on `resumeFailure`', async () => {
    throwOn.after_sub = DOWNSTREAM_FAILURE;
    const automation = boot();

    const started = await automation.execute('deal_parent', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    } as never);
    const parentRunId = (started as any).runId as string;
    expect((started as any).status, 'the parent parks at its subflow node').toBe('paused');

    const req = await pendingRequest();
    const childRunId = req?.flow_run_id as string;
    expect(childRunId, 'the request names the CHILD run, never the parent').toBeTruthy();
    expect(childRunId).not.toBe(parentRunId);
    expect(await automation.hasSuspendedRun(parentRunId)).toBe(true);

    // The envelope `bubbleToParent` receives for the PARENT — the thing this
    // card is about. Captured through `resumeInternal` because the up-bubble
    // never goes through the public `resume` door.
    const bubbled: any[] = [];
    const realInternal = (automation as any).resumeInternal.bind(automation);
    (automation as any).resumeInternal = async (...args: any[]) => {
      const r = await realInternal(...args);
      if (args[0] === parentRunId) bubbled.push(r);
      return r;
    };

    const outcome = await service
      .decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(r => ({ ok: true as const, r }), (e: Error) => ({ ok: false as const, e }));

    // ── The parent's resume answers the #13937 discriminator, and no `code`.
    expect(bubbled.length).toBe(1);
    expect(bubbled[0].success).toBe(false);
    expect(bubbled[0].status, "the producer's own verdict").toBe('stranded');
    expect(bubbled[0].code, 'and it names no code at all').toBeUndefined();
    expect(bubbled[0].error).toBe(DOWNSTREAM_FAILURE);

    // ── The parent really is dead, and really is repairable.
    expect(await automation.hasSuspendedRun(parentRunId)).toBe(false);
    expect((await automation.resume(parentRunId)).code).toBe('RUN_NOT_FOUND');
    expect((await automation.getRun(parentRunId))?.status).toBe('failed');

    // ── The child is fine, and so is the decision: both halves of the
    //    divergence are real, which is what makes it a divergence.
    expect((await automation.getRun(childRunId))?.status).toBe('completed');
    expect(marks, 'the child advanced; the parent died on the node after the subflow')
      .toEqual(['on_approved']);
    expect((await data.find('sys_approval_request', { where: { id: req.id } }))[0].status).toBe('approved');

    // FIXED — see the file header. The door still does not throw (#13807's
    // status code does not move) and `resumed` stays `true` — this decision's
    // OWN run, the child, really did resume. But it no longer reads as a
    // clean success: `resumeFailure` names the PARENT, never the healthy
    // child `runId` still names, and `resumeError` tells the same fact in
    // prose.
    expect(outcome.ok, 'the door still does not throw for this shape').toBe(true);
    const answer = outcome.ok ? outcome.r : (undefined as never);
    expect(answer.finalized).toBe(true);
    expect(answer.decision).toBe('approve');
    expect(answer.resumed, "this decision's own run — the child — really did resume").toBe(true);
    expect(answer.runId, 'the id handed back is still the CHILD — the run that is fine').toBe(childRunId);
    expect(strandedDecisionDetails(answer as unknown)).toBeUndefined();

    // ── The machine-readable half: the PARENT's id, never the child's.
    expect(answer.resumeFailure).toEqual({
      code: 'RESUME_FAILED',
      runId: parentRunId,
      status: 'stranded',
      repairable: true,
    });
    // ── The human-readable half — presence decided by the telling, never by
    //    `resumed`, which is `true` right here (the spec docblock's rule).
    expect(answer.resumeError).toContain('RESUME_FAILED');
    expect(answer.resumeError).toContain(parentRunId);
    expect(answer.resumeError).toContain(DOWNSTREAM_FAILURE);

    // ── And the two answers now genuinely DIVERGE — no longer the shared
    //    `FULL_SUCCESS` literal CONTROL A asserts below.
    expect(resumeFacing(answer)).not.toEqual(FULL_SUCCESS);

    // The one LOG artefact the operator gets, at the level AGENTS.md's
    // durability rule requires, naming the run and the repair verb — the
    // #16472 ruling left this log line alone; it is now a SIBLING to
    // `resumeFailure`, not this card's only telling.
    const durability = logger.lines.filter(
      (l: any) => l.level === 'error' && String(l.msg).includes('STRANDED'),
    );
    expect(durability.length, 'exactly one, at `error`').toBe(1);
    expect(durability[0].msg).toContain(`restoreConsumedSuspension('${parentRunId}')`);

    // …and the repair verb it promises actually works.
    expect((await automation.restoreConsumedSuspension(parentRunId, { requestedBy: 'ops' })).restored).toBe(true);

  });

  it('CONTROL A — a healthy composition answers plain success, with nothing behind it to tell', async () => {
    const automation = boot();
    const started = await automation.execute('deal_parent', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    } as never);
    const parentRunId = (started as any).runId as string;
    const req = await pendingRequest();

    const answer = await service.decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    // The parent ran to completion this time — the only thing that changed.
    expect(marks).toEqual(['on_approved', 'after_sub']);
    expect((await automation.getRun(parentRunId))?.status).toBe('completed');
    expect(logger.lines.filter((l: any) => l.level === 'error')).toEqual([]);

    // ⭐ Before the fix this was the SAME literal the stranded composition
    // asserted — a caller comparing the two answers had nothing to compare.
    // Kept here as the reverse control: it still holds for a run that really
    // has nothing to report, which is what proves the stranded test's new
    // divergent shape is about the strand and not a plumbing change that
    // fires unconditionally.
    expect(resumeFacing(answer)).toEqual(FULL_SUCCESS);
    expect(answer.runId).toBe(req.flow_run_id);
    expect(answer.resumeFailure, 'nothing to report — absence is the correct reading here').toBeUndefined();
  });

  it("CONTROL B — the #13807 shape still throws at this door, so the harness is live", async () => {
    // Without this control, "the door did not throw" above would be
    // indistinguishable from a door that was never wired to throw at all.
    throwOn.on_approved = 'the child branch blew up';
    const automation = boot();
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd3', amount: 100 }, userId: 'submitter',
    } as never);
    const req = await pendingRequest();

    const err = await service
      .decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    expect(err, 'the direct shape is reported — this door can fail').toBeTruthy();
    expect(err?.message).toMatch(/^RESUME_FAILED/);
    expect(strandedDecisionDetails(err)).toEqual({
      finalized: true, decision: 'approve', runId: req.flow_run_id, repairable: true,
    });
  });
});
