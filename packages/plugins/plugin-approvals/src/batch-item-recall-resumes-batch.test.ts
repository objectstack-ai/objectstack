// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A revise-window recall on a batch sign-off item resumes the batch, which
 * records the item as cancelled and goes on (#28183).
 *
 * ## The composition
 *
 * `release_signoff` runs a `map` node over its tasks; each item runs
 * `task_signoff`, which parks on an `approval` with a `revise` edge into the
 * revise window (ADR-0044) — the shape of the showcase's
 * `showcase_release_signoff` → `showcase_one_task_signoff`. The approver sends
 * item 1 back; the submitter recalls it from the revise window.
 *
 * ## What was measured before this change
 *
 * The recall cancels the item's run through `cancelRun`, which never touches
 * the parent, and nothing else wakes it: the batch run stayed parked on
 * `map:<item 1's run>` with no request open for item 2 and no row left for
 * item 1, so nothing could ever advance it short of an operator's parent-id
 * resume. That parent-id resume already does the right thing since the
 * cancelled-item ruling (results keep the item's slot as
 * `{ $status: 'cancelled', $itemRunId }`, outside `count`); the recall now
 * issues it itself.
 *
 * ## The pins
 *
 *  1. the recall on a batch item resumes the batch: item 1's slot holds the
 *     marker, `count` leaves it out, and item 2's request opens;
 *  2. a recall on an approval with no batch above it behaves as before, and a
 *     batch parked beside it is not touched;
 *  3. a recall outside the revise window (`pending`) behaves as before: the
 *     item resumes down `reject` and the map records what it output;
 *  4. a batch whose every item is decided behaves as before;
 *  5. a run parked on a `map:` link at a node other than the built-in `map`
 *     is not woken: the engine records the marker for no other node, so
 *     re-running it would advance it past the item with nothing recorded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
import { APPROVAL_REVISE_NODE_TYPE, defineActionDescriptor } from '@objectstack/spec/automation';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ isSystem: false, userId, positions: [], permissions: [] }) as any;

/** The accounts the `user` approver slots route to (#27397). */
const ROUTED_USERS = ['u1'];

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

/** In-memory ObjectQL stand-in: equality/$in/$ne where, orderBy, offset/limit; update/delete dispatch as the engine does. */
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
      let out = rows(object).filter(r => matches(r, where));
      for (const ord of [...(opts.orderBy ?? [])].reverse()) {
        const dir = ord.order === 'desc' ? -1 : 1;
        out = [...out].sort((a, b) => (a[ord.field] < b[ord.field] ? -dir : a[ord.field] > b[ord.field] ? dir : 0));
      }
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

/** One task's sign-off: approve / reject, or a revise window that re-enters the approval. */
const TASK_SIGNOFF = {
  name: 'task_signoff',
  label: 'Task Sign-off',
  type: 'autolaunched',
  variables: [{ name: 'decision', type: 'text', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'review', type: 'approval', label: 'Task Sign-off', config: { approvers: [{ type: 'user', value: 'u1' }] } },
    { id: 'wait_revision', type: APPROVAL_REVISE_NODE_TYPE, label: 'Awaiting Revision' },
    { id: 'mark_ok', type: 'decided', label: 'Approved', config: { decision: 'approved' } },
    { id: 'mark_no', type: 'decided', label: 'Rejected', config: { decision: 'rejected' } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'review' },
    { id: 'e2', source: 'review', target: 'mark_ok', label: 'approve' },
    { id: 'e3', source: 'review', target: 'mark_no', label: 'reject' },
    { id: 'e4', source: 'review', target: 'wait_revision', label: 'revise' },
    { id: 'e5', source: 'wait_revision', target: 'review', label: 'resubmit', type: 'back' },
    { id: 'e6', source: 'mark_ok', target: 'end' },
    { id: 'e7', source: 'mark_no', target: 'end' },
  ],
};

/** The batch: a `map` over the tasks, then a downstream reader of what it recorded. */
const RELEASE_SIGNOFF = {
  name: 'release_signoff',
  label: 'Release Sign-off',
  type: 'autolaunched',
  variables: [{ name: 'items', type: 'list', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'signoffs', type: 'map', label: 'Sign off each task',
      config: {
        collection: { dialect: 'cel', source: 'items' }, flowName: 'task_signoff',
        itemObject: 'rel_task', outputVariable: 'signoffResults',
      },
    },
    { id: 'peek', type: 'peek', label: 'Read the results' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'b1', source: 'start', target: 'signoffs' },
    { id: 'b2', source: 'signoffs', target: 'peek' },
    { id: 'b3', source: 'peek', target: 'end' },
  ],
};

describe('a revise-window recall on a batch item resumes the batch (#28183)', () => {
  let automation: AutomationEngine;
  let service: ApprovalService;
  let fake: ReturnType<typeof makeFakeEngine>;
  let seen: { results: unknown; count: unknown } | undefined;

  beforeEach(() => {
    seen = undefined;
    fake = makeFakeEngine();
    // Ticking clock: rounds of a revise loop must not share created_at.
    let t = Date.parse('2026-10-30T00:00:00Z');
    service = new ApprovalService({ engine: fake as any, logger: silentLogger(), clock: { now: () => new Date((t += 1000)) } });
    automation = new AutomationEngine(silentLogger(), new InMemorySuspendedRunStore());
    installBuiltinNodes(automation, { logger: silentLogger(), getService() { throw new Error('none'); } } as any);
    registerApprovalNode(automation, service, silentLogger());
    automation.registerNodeExecutor({
      type: 'decided',
      async execute(node: any, variables: Map<string, unknown>) {
        variables.set('decision', node.config.decision);
        return { success: true };
      },
    } as never);
    automation.registerNodeExecutor({
      type: 'peek',
      async execute(_node: any, variables: Map<string, unknown>) {
        seen = { results: variables.get('signoffResults'), count: variables.get('signoffs.count') };
        return { success: true };
      },
    } as never);
    automation.registerFlow('task_signoff', TASK_SIGNOFF as never);
    automation.registerFlow('release_signoff', RELEASE_SIGNOFF as never);
    service.attachAutomation(automation);
  });

  const launchBatch = async (ids: string[]) => {
    const paused = await automation.execute('release_signoff', {
      userId: 'submitter', params: { items: ids.map(id => ({ id, title: `Task ${id}` })) },
    } as never);
    expect(paused.status, 'the batch parks on its first item').toBe('paused');
    return paused.runId!;
  };
  const requestFor = async (recordId: string, status: string) =>
    (await fake.find('sys_approval_request', { where: { record_id: recordId, status } }))[0];
  const parked = () => automation.listSuspendedRuns().map(r => ({ runId: r.runId, nodeId: r.nodeId, correlation: r.correlation }));

  it('the recall resumes the batch: the item keeps its slot as the cancelled marker, outside count, and the next item opens', async () => {
    const batchRunId = await launchBatch(['t1', 't2']);
    const first = await requestFor('t1', 'pending');
    await service.sendBack(first.id, { actorId: 'u1', comment: 'rework' }, asUser('u1'));
    expect(parked()).toContainEqual({ runId: first.flow_run_id, nodeId: 'wait_revision', correlation: 'approval_revise:wait_revision' });

    const out = await service.recall(first.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out.request.status).toBe('recalled');
    // The item's own run was cancelled, not resumed — as before.
    expect(out.resumed).toBe(false);
    expect(out.resumeError).toBeUndefined();
    expect((await automation.getRun(first.flow_run_id))?.status).toBe('cancelled');
    // The batch moved on: item 2's request is open and the batch waits on its run.
    const second = await requestFor('t2', 'pending');
    expect(second, 'the batch opened the next item').toBeDefined();
    expect(parked()).toEqual(expect.arrayContaining([
      { runId: batchRunId, nodeId: 'signoffs', correlation: `map:${second.flow_run_id}` },
    ]));

    await service.decide(second.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    const marker = { $status: 'cancelled', $itemRunId: first.flow_run_id };
    expect(seen).toEqual({ results: [marker, { decision: 'approved' }], count: 1 });
    expect((await automation.getRun(batchRunId))?.status).toBe('completed');
    expect(automation.listSuspendedRuns()).toEqual([]);
  });

  it('control: a recall on an approval with no batch above it behaves as before, and a parked batch beside it is untouched', async () => {
    const batchRunId = await launchBatch(['t1']);
    const batchItem = await requestFor('t1', 'pending');
    const lone = await automation.execute('task_signoff', {
      object: 'rel_task', record: { id: 'solo' }, userId: 'submitter',
    } as never);
    const req = await requestFor('solo', 'pending');
    await service.sendBack(req.id, { actorId: 'u1' }, asUser('u1'));

    const out = await service.recall(req.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out).toMatchObject({ runId: lone.runId, resumed: false });
    expect(out.resumeError).toBeUndefined();
    expect('resumeFailure' in out).toBe(false);
    expect((await automation.getRun(lone.runId!))?.status).toBe('cancelled');
    const still = parked();
    expect(still).toHaveLength(2);
    expect(still).toEqual(expect.arrayContaining([
      { runId: batchRunId, nodeId: 'signoffs', correlation: `map:${batchItem.flow_run_id}` },
      { runId: batchItem.flow_run_id, nodeId: 'review', correlation: batchItem.id },
    ]));
  });

  it('control: a recall outside the revise window resumes the item down reject, and the map records its output', async () => {
    const batchRunId = await launchBatch(['t1', 't2']);
    const first = await requestFor('t1', 'pending');

    const out = await service.recall(first.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out).toMatchObject({ resumed: true });
    expect(out.resumeError).toBeUndefined();
    expect((await automation.getRun(first.flow_run_id))?.status).toBe('completed');
    const second = await requestFor('t2', 'pending');
    await service.decide(second.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    expect(seen).toEqual({ results: [{ decision: 'rejected' }, { decision: 'approved' }], count: 2 });
    expect((await automation.getRun(batchRunId))?.status).toBe('completed');
  });

  it('control: a batch whose every item is decided records each output, one through a revise round', async () => {
    const batchRunId = await launchBatch(['t1', 't2']);
    const first = await requestFor('t1', 'pending');
    await service.sendBack(first.id, { actorId: 'u1' }, asUser('u1'));
    await service.resubmit(first.id, { actorId: 'submitter' }, asUser('submitter'));
    const round2 = await requestFor('t1', 'pending');
    await service.decide(round2.id, { decision: 'reject', actorId: 'u1' }, SYSTEM_CTX);
    const second = await requestFor('t2', 'pending');
    await service.decide(second.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    expect(seen).toEqual({ results: [{ decision: 'rejected' }, { decision: 'approved' }], count: 2 });
    expect((await automation.getRun(batchRunId))?.status).toBe('completed');
    expect(automation.listSuspendedRuns()).toEqual([]);
  });

  it('control: a run parked on a map: link at a node other than the built-in map is not woken', async () => {
    // A home-grown fan-out that parks on `map:<child>` the way `map` does, but
    // records nothing for a cancelled item: re-running it would open the next
    // task with the recalled one silently dropped.
    let entries = 0;
    automation.registerNodeExecutor({
      type: 'fan_out',
      descriptor: defineActionDescriptor({
        type: 'fan_out', version: '1.0.0', name: 'Fan out', supportsPause: true, resumeAuthority: 'any',
      }),
      async execute(_node: any, _variables: Map<string, unknown>, context: any) {
        entries++;
        const child = await automation.execute('task_signoff', {
          ...context, object: 'rel_task', record: { id: `f${entries}` },
        } as never);
        return { success: true, suspend: true, correlation: `map:${child.runId}` };
      },
    } as never);
    automation.registerFlow('fan_signoff', {
      name: 'fan_signoff', label: 'Fan Sign-off', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'fan', type: 'fan_out', label: 'Fan out' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'f1', source: 'start', target: 'fan' },
        { id: 'f2', source: 'fan', target: 'end' },
      ],
    } as never);
    const fan = await automation.execute('fan_signoff', { userId: 'submitter' } as never);
    const req = await requestFor('f1', 'pending');
    await service.sendBack(req.id, { actorId: 'u1' }, asUser('u1'));

    const out = await service.recall(req.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out).toMatchObject({ resumed: false });
    expect(out.resumeError).toBeUndefined();
    expect(entries).toBe(1);
    expect(await requestFor('f2', 'pending')).toBeUndefined();
    expect(parked()).toEqual([{ runId: fan.runId, nodeId: 'fan', correlation: `map:${req.flow_run_id}` }]);
  });
});
