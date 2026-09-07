// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15556 — the REPRODUCTION: an approval hosted inside a SUBFLOW CHILD, whose
 * parent's continuation fails.
 *
 * The card was filed NOT MEASURED — the seam and its swallowing `catch` were
 * found by reading `engine.ts`, and nobody had driven the composition. This
 * file is that drive, with its controls in the same run, and it reproduces.
 *
 * ## The composition
 *
 * `deal_parent` parks at a `subflow` node; the child `deal_approval` parks at
 * an `approval` node, so the approvals row names the CHILD run. The decision
 * door resumes the child, the child completes, `bubbleToParent` resumes the
 * parent, and the parent's own downstream node throws.
 *
 * ## What is measured, and what is only characterised
 *
 * MEASURED FACT, now fixed engine-side: the parent lands on the engine's
 * stranded exit — `{ success: false, status: 'stranded' }`, journalled and
 * repairable — and `bubbleToParent` logged that at `warn`. The level is now
 * graded by that discriminator (`subflow-bubble-strand-log-level.test.ts` in
 * `service-automation` holds the pins, both directions).
 *
 * ⚠️ CHARACTERISED, NOT BLESSED: the decision door still answers full success.
 * Its resume-facing answer is IDENTICAL to the one a healthy composition
 * produces, so no caller can tell the two apart, and the `runId` it hands back
 * names the CHILD — which completed — never the stranded parent. Making that
 * truthful moves a public contract (`AutomationResult`,
 * `ApprovalDecisionResult`) and is #15556's open decision, the sibling one
 * level up of the #13807 ruling (maintainer 2026-09-04, decision batch #37).
 * ⛔ The assertions below record what the door does TODAY; whatever ruling
 * lands must turn them red on purpose.
 *
 * ## The control that makes the reading trustworthy
 *
 * `CONTROL` drives the #13807 shape through the SAME door in the same run — no
 * subflow, the child's own branch throws — and the door throws `RESUME_FAILED`
 * with its stranded envelope. So the absence of a throw above is a fact about
 * the composition, not about a mis-wired harness.
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
 * The resume-facing answer a caller reads, minus the run id. Asserted by BOTH
 * the stranded composition and the healthy one — that shared literal, and not
 * a value smuggled between tests, is what carries the claim that the two are
 * indistinguishable at the door.
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

  it('the parent STRANDS while the door answers full success', async () => {
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

    // ⚠️ CHARACTERISED, NOT BLESSED — see the file header. The door does not
    // throw, reports `resumed: true`, carries no `resumeError`, and the run it
    // names is the CHILD, which completed. Nothing in the response reaches the
    // stranded parent.
    expect(outcome.ok, 'today the door does not throw').toBe(true);
    const answer = outcome.ok ? outcome.r : (undefined as never);
    expect(resumeFacing(answer)).toEqual(FULL_SUCCESS);
    expect(answer.runId, 'the id handed back is the CHILD — the run that is fine').toBe(childRunId);
    expect(strandedDecisionDetails(answer as unknown)).toBeUndefined();

    // The one artefact the operator gets, at the level AGENTS.md's durability
    // rule requires, naming the run and the repair verb (#15556's shipped half).
    const durability = logger.lines.filter(
      (l: any) => l.level === 'error' && String(l.msg).includes('STRANDED'),
    );
    expect(durability.length, 'exactly one, at `error`').toBe(1);
    expect(durability[0].msg).toContain(`restoreConsumedSuspension('${parentRunId}')`);

    // …and the repair verb it promises actually works.
    expect((await automation.restoreConsumedSuspension(parentRunId, { requestedBy: 'ops' })).restored).toBe(true);

  });

  it('CONTROL A — the healthy composition answers IDENTICALLY, which is the defect', async () => {
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

    // ⭐ The sharpest statement of the defect: the SAME literal the stranded
    // composition asserted. A caller comparing the two answers has nothing to
    // compare — only the run ids differ, and both name a healthy child.
    expect(resumeFacing(answer)).toEqual(FULL_SUCCESS);
    expect(answer.runId).toBe(req.flow_run_id);
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
