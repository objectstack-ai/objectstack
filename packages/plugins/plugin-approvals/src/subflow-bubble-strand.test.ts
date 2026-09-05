// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REPRODUCTION PROBE for #15556 — an approval hosted inside a SUBFLOW CHILD.
 * Not a deliverable yet: this file exists to measure what the decision door
 * actually answers when `bubbleToParent` fails, with its controls in the
 * same run.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { strandedDecisionDetails } from '@objectstack/types';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;

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

describe('#15556 probe — approval inside a subflow child, parent bubble fails', () => {
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

  it('MEASUREMENT — parent bubble fails: what does the door answer?', async () => {
    throwOn.after_sub = 'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';
    const automation = boot();

    const started = await automation.execute('deal_parent', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    } as never);
    // eslint-disable-next-line no-console
    console.log('PROBE started =', JSON.stringify(started));
    const parentRunId = (started as any).runId as string;

    const req = await pendingRequest();
    // eslint-disable-next-line no-console
    console.log('PROBE request =', JSON.stringify(req && { id: req.id, run: req.flow_run_id, status: req.status }));
    const childRunId = req?.flow_run_id as string;
    expect(childRunId, 'the request must name the CHILD run').toBeTruthy();
    expect(childRunId).not.toBe(parentRunId);
    expect(await automation.hasSuspendedRun(parentRunId)).toBe(true);

    // Capture the envelope `bubbleToParent` receives for the PARENT resume —
    // the thing the swallowing catch throws away.
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

    // eslint-disable-next-line no-console
    console.log('PROBE door =', JSON.stringify(outcome.ok ? outcome.r : { threw: outcome.e.message, details: strandedDecisionDetails(outcome.e) }));
    // eslint-disable-next-line no-console
    console.log('PROBE marks =', JSON.stringify(marks));
    // eslint-disable-next-line no-console
    console.log('PROBE parent suspended?', await automation.hasSuspendedRun(parentRunId));
    // eslint-disable-next-line no-console
    console.log('PROBE parent resume =', JSON.stringify(await automation.resume(parentRunId)));
    const parentRow = await automation.getRun(parentRunId);
    // eslint-disable-next-line no-console
    console.log('PROBE parent run row =', JSON.stringify(parentRow && {
      status: (parentRow as any).status, error: (parentRow as any).error,
      consumedSuspension: Boolean((parentRow as any).consumedSuspension),
    }));
    // eslint-disable-next-line no-console
    console.log('PROBE child run row =', JSON.stringify(await automation.getRun(childRunId).then(r => r && { status: (r as any).status })));
    // eslint-disable-next-line no-console
    console.log('PROBE request row =', JSON.stringify((await data.find('sys_approval_request', { where: { id: req.id } }))[0]?.status));
    // eslint-disable-next-line no-console
    console.log('PROBE parent bubble envelope =', JSON.stringify(bubbled.map(b => ({ success: b.success, code: b.code, status: b.status, error: b.error }))));
    // eslint-disable-next-line no-console
    console.log('PROBE parent restore =', JSON.stringify(await automation.restoreConsumedSuspension(parentRunId, { requestedBy: 'probe' })));
    // eslint-disable-next-line no-console
    console.log('PROBE log lines =', JSON.stringify(logger.lines.filter((l: any) => l.level !== 'debug' && l.level !== 'info').map((l: any) => [l.level, l.msg])));
  });

  it('CONTROL A — same composition, parent downstream node healthy', async () => {
    const automation = boot();
    const started = await automation.execute('deal_parent', {
      object: 'crm_deal', record: { id: 'd2', amount: 100 }, userId: 'submitter',
    } as never);
    const parentRunId = (started as any).runId as string;
    const req = await pendingRequest();
    const outcome = await service
      .decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(r => ({ ok: true as const, r }), (e: Error) => ({ ok: false as const, e }));
    // eslint-disable-next-line no-console
    console.log('CTRL-A door =', JSON.stringify(outcome.ok ? outcome.r : { threw: outcome.e.message }));
    // eslint-disable-next-line no-console
    console.log('CTRL-A marks =', JSON.stringify(marks));
    // eslint-disable-next-line no-console
    console.log('CTRL-A parent run row =', JSON.stringify(await automation.getRun(parentRunId).then(r => r && { status: (r as any).status })));
  });

  it('CONTROL B — no subflow: the #13807 shape still throws at this door', async () => {
    throwOn.on_approved = 'the child branch blew up';
    const automation = boot();
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd3', amount: 100 }, userId: 'submitter',
    } as never);
    const req = await pendingRequest();
    const outcome = await service
      .decide(req.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX)
      .then(r => ({ ok: true as const, r }), (e: Error) => ({ ok: false as const, e }));
    // eslint-disable-next-line no-console
    console.log('CTRL-B door =', JSON.stringify(outcome.ok ? outcome.r : { threw: outcome.e.message, details: strandedDecisionDetails(outcome.e) }));
  });
});
