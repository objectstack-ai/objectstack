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
 *
 * The record-delete void (#37763) cancels a run for the same want of a
 * decision and wakes its batch through the same call, so its pins share this
 * harness: the last `describe` below.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, ObjectStoreSuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
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

/** Ticking clock: rounds of a revise loop must not share created_at. */
function tickingClock() {
  let t = Date.parse('2026-10-30T00:00:00Z');
  return { now: () => new Date((t += 1000)) };
}

/**
 * One process: an automation engine over `store` and an approval service over
 * `fake`. Two of these over one durable store and one `fake` are two replicas
 * (or one process before and after a restart).
 */
function wireReplica(
  fake: ReturnType<typeof makeFakeEngine>,
  store: InMemorySuspendedRunStore | ObjectStoreSuspendedRunStore,
  clock: { now: () => Date },
  onPeek: (seen: { results: unknown; count: unknown }) => void | Record<string, unknown>,
  serviceLogger: any = silentLogger(),
) {
  const service = new ApprovalService({ engine: fake as any, logger: serviceLogger, clock });
  const automation = new AutomationEngine(silentLogger(), store);
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
      // A peek may answer a failure of its own (#34638's refused batch resume).
      return onPeek({ results: variables.get('signoffResults'), count: variables.get('signoffs.count') }) ?? { success: true };
    },
  } as never);
  automation.registerFlow('task_signoff', TASK_SIGNOFF as never);
  automation.registerFlow('release_signoff', RELEASE_SIGNOFF as never);
  service.attachAutomation(automation);
  return { automation, service };
}

describe('a revise-window recall on a batch item resumes the batch (#28183)', () => {
  let automation: AutomationEngine;
  let service: ApprovalService;
  let fake: ReturnType<typeof makeFakeEngine>;
  let seen: { results: unknown; count: unknown } | undefined;

  beforeEach(() => {
    seen = undefined;
    fake = makeFakeEngine();
    ({ automation, service } = wireReplica(fake, new InMemorySuspendedRunStore(), tickingClock(), (s) => { seen = s; }));
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
    await service.decide(round2.id, { decision: 'reject', comment: 'Over budget.', actorId: 'u1' }, SYSTEM_CTX);
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

/**
 * #28230: the recall finds the batch above the item it cancels past the first
 * page of parked runs.
 *
 * A DB-backed store lists one 1000-row page of `paused` rows in driver order,
 * and a process lists what it parked itself beside that page. So the batch is
 * missing from the listing exactly when it was parked by ANOTHER process (a
 * replica, or this one before a restart) and more than 1000 runs are parked
 * ahead of it. Both replicas below share one store and one table set; the
 * batch is launched and sent back on `a` and recalled on `b`.
 */
describe('a revise-window recall finds its batch past the first page of parked runs (#28230)', () => {
  let fake: ReturnType<typeof makeFakeEngine>;
  let a: ReturnType<typeof wireReplica>;
  let b: ReturnType<typeof wireReplica>;
  let seen: { results: unknown; count: unknown } | undefined;

  /** `count` parked runs of some other flow, stored ahead of everything this test parks. */
  const parkOthers = (count: number) => {
    const rows = fake.tables.get('sys_automation_run') ?? (fake.tables.set('sys_automation_run', []), fake.tables.get('sys_automation_run')!);
    for (let i = 0; i < count; i++) {
      rows.push({ id: `other-${String(i).padStart(4, '0')}`, flow_name: 'other_flow', node_id: 'wait', status: 'paused' });
    }
  };

  beforeEach(() => {
    seen = undefined;
    fake = makeFakeEngine();
    const store = new ObjectStoreSuspendedRunStore(fake as any, silentLogger());
    const clock = tickingClock();
    a = wireReplica(fake, store, clock, (s) => { seen = s; });
    b = wireReplica(fake, store, clock, (s) => { seen = s; });
  });

  const requestFor = async (recordId: string, status: string) =>
    (await fake.find('sys_approval_request', { where: { record_id: recordId, status } }))[0];
  const storedRun = async (runId: string) =>
    (await fake.find('sys_automation_run', { where: { id: runId } }))[0];

  /** Launch the batch on `a` and send its first item back into the revise window. */
  const batchInReviseWindow = async () => {
    const paused = await a.automation.execute('release_signoff', {
      userId: 'submitter', params: { items: [{ id: 't1', title: 'Task t1' }, { id: 't2', title: 'Task t2' }] },
    } as never);
    expect(paused.status, 'the batch parks on its first item').toBe('paused');
    const first = await requestFor('t1', 'pending');
    await a.service.sendBack(first.id, { actorId: 'u1', comment: 'rework' }, asUser('u1'));
    return { batchRunId: paused.runId!, first };
  };

  it('the batch past the first page resumes, and the item keeps its slot as the cancelled marker', async () => {
    parkOthers(1000);
    const { batchRunId, first } = await batchInReviseWindow();
    expect((await b.automation.listSuspendedRunsDurable()).some(r => r.runId === batchRunId),
      'premise: the batch is not on the listing replica b reads').toBe(false);

    const out = await b.service.recall(first.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out.request.status).toBe('recalled');
    expect(out.resumed).toBe(false);
    expect(out.resumeError).toBeUndefined();
    expect((await b.automation.getRun(first.flow_run_id))?.status).toBe('cancelled');
    const second = await requestFor('t2', 'pending');
    expect(second, 'the batch opened the next item').toBeDefined();
    expect(await storedRun(batchRunId)).toMatchObject({ node_id: 'signoffs', correlation: `map:${second.flow_run_id}` });

    await b.service.decide(second.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    expect(seen).toEqual({ results: [{ $status: 'cancelled', $itemRunId: first.flow_run_id }, { decision: 'approved' }], count: 1 });
    expect((await b.automation.getRun(batchRunId))?.status).toBe('completed');
  });

  it('control: a batch within the first page behaves as before', async () => {
    parkOthers(10);
    const { batchRunId, first } = await batchInReviseWindow();
    expect((await b.automation.listSuspendedRunsDurable()).some(r => r.runId === batchRunId),
      'premise: the batch is on the listing replica b reads').toBe(true);

    const out = await b.service.recall(first.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out).toMatchObject({ resumed: false });
    expect(out.resumeError).toBeUndefined();
    const second = await requestFor('t2', 'pending');
    expect(second, 'the batch opened the next item').toBeDefined();
    await b.service.decide(second.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);
    expect(seen).toEqual({ results: [{ $status: 'cancelled', $itemRunId: first.flow_run_id }, { decision: 'approved' }], count: 1 });
  });

  it('control: a recall with no batch above it past the first page behaves as before, and the batch beside it is untouched', async () => {
    parkOthers(1000);
    const { batchRunId, first } = await batchInReviseWindow();
    const lone = await a.automation.execute('task_signoff', {
      object: 'rel_task', record: { id: 'solo' }, userId: 'submitter',
    } as never);
    const req = await requestFor('solo', 'pending');
    await a.service.sendBack(req.id, { actorId: 'u1' }, asUser('u1'));

    const out = await b.service.recall(req.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out).toMatchObject({ runId: lone.runId, resumed: false });
    expect(out.resumeError).toBeUndefined();
    expect('resumeFailure' in out).toBe(false);
    expect((await b.automation.getRun(lone.runId!))?.status).toBe('cancelled');
    expect(await storedRun(batchRunId)).toMatchObject({ node_id: 'signoffs', correlation: `map:${first.flow_run_id}` });
    expect(await storedRun(first.flow_run_id)).toMatchObject({ node_id: 'wait_revision', status: 'paused' });
    expect(await requestFor('t2', 'pending')).toBeUndefined();
  });

  it('control: a parent linked to the item but parked at a node other than the built-in map is left alone', async () => {
    // A home-grown fan-out that launches its child with the same linkage the
    // `map` node writes, so the engine answers it as the item's parent; it is
    // the recall's own `map` check that leaves it parked.
    let entries = 0;
    for (const replica of [a, b]) {
      replica.automation.registerNodeExecutor({
        type: 'fan_out',
        descriptor: defineActionDescriptor({
          type: 'fan_out', version: '1.0.0', name: 'Fan out', supportsPause: true, resumeAuthority: 'any',
        }),
        async execute(node: any, variables: Map<string, unknown>, context: any) {
          entries++;
          const child = await replica.automation.execute('task_signoff', {
            ...context, object: 'rel_task', record: { id: `f${entries}` },
            $parentRunId: String(variables.get('$runId')), $parentMapNode: node.id,
          } as never);
          return { success: true, suspend: true, correlation: `map:${child.runId}` };
        },
      } as never);
      replica.automation.registerFlow('fan_signoff', {
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
    }
    parkOthers(1000);
    const fan = await a.automation.execute('fan_signoff', { userId: 'submitter' } as never);
    const req = await requestFor('f1', 'pending');
    await a.service.sendBack(req.id, { actorId: 'u1' }, asUser('u1'));
    expect(await b.automation.suspendedMapParentOf(req.flow_run_id),
      'premise: the engine answers the fan-out as the item\'s parent').toMatchObject({ runId: fan.runId, nodeId: 'fan' });

    const out = await b.service.recall(req.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out).toMatchObject({ resumed: false });
    expect(out.resumeError).toBeUndefined();
    expect(entries).toBe(1);
    expect(await requestFor('f2', 'pending')).toBeUndefined();
    expect(await storedRun(fan.runId!)).toMatchObject({ node_id: 'fan', correlation: `map:${req.flow_run_id}`, status: 'paused' });
  });
});

describe('#34638 — a refused batch resume after a revise-window recall tells the refusal on resumeFailure', () => {
  it('the batch strands on its next step\'s refusal: resumeFailure names the batch run and carries the pair', async () => {
    const fake = makeFakeEngine();
    const refusal = { innerRefusal: { code: 'VALIDATION_FAILED', message: 'over capacity' }, userMessage: 'Capacity is already taken.' };
    const { automation, service } = wireReplica(fake, new InMemorySuspendedRunStore(), tickingClock(),
      () => ({ success: false, error: 'peek refused', ...refusal }));
    const paused = await automation.execute('release_signoff', {
      userId: 'submitter', params: { items: [{ id: 't1', title: 'Task t1' }] },
    } as never);
    const batchRunId = paused.runId!;
    const item = (await fake.find('sys_approval_request', { where: { record_id: 't1', status: 'pending' } }))[0];
    await service.sendBack(item.id, { actorId: 'u1' }, asUser('u1'));

    const out = await service.recall(item.id, { actorId: 'submitter' }, asUser('submitter'));

    expect(out.request.status).toBe('recalled');
    expect(out.resumeError, 'the batch resume is the failure told').toContain(`resuming the batch run '${batchRunId}'`);
    expect(out.resumeFailure).toEqual({
      code: 'RESUME_FAILED', runId: batchRunId, status: 'stranded', repairable: true, ...refusal,
    });
  });
});

/** An outer flow whose `subflow` node runs the sign-off: the approval parks in the child. */
const WRAPPED_SIGNOFF = {
  name: 'wrapped_signoff', label: 'Wrapped Sign-off', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'call', type: 'subflow', label: 'Sign off', config: { flowName: 'task_signoff' } },
    { id: 'peek', type: 'peek', label: 'After the sign-off' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'w1', source: 'start', target: 'call' },
    { id: 'w2', source: 'call', target: 'peek' },
    { id: 'w3', source: 'peek', target: 'end' },
  ],
};

/** Two `subflow` levels above the approval: outer → wrapped → sign-off. */
const DOUBLY_WRAPPED_SIGNOFF = {
  name: 'doubly_wrapped_signoff', label: 'Doubly Wrapped Sign-off', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'call', type: 'subflow', label: 'Wrapped', config: { flowName: 'wrapped_signoff' } },
    { id: 'peek', type: 'peek', label: 'After the wrapped sign-off' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'd1', source: 'start', target: 'call' },
    { id: 'd2', source: 'call', target: 'peek' },
    { id: 'd3', source: 'peek', target: 'end' },
  ],
};

/** A batch whose every item runs the sign-off inside a `subflow`. */
const BATCH_OF_WRAPPED = {
  ...RELEASE_SIGNOFF,
  name: 'batch_of_wrapped',
  nodes: RELEASE_SIGNOFF.nodes.map(n => (n.id === 'signoffs'
    ? { ...n, config: { ...(n as any).config, flowName: 'wrapped_signoff' } }
    : n)),
};

describe('a record delete cancels the run its voided request gated (#37763)', () => {
  let automation: AutomationEngine;
  let service: ApprovalService;
  let fake: ReturnType<typeof makeFakeEngine>;
  let peeks: Array<{ results: unknown; count: unknown }>;
  let logged: Array<{ level: string; msg: string; meta: any }>;

  beforeEach(() => {
    peeks = [];
    logged = [];
    fake = makeFakeEngine();
    const capture = (level: string) => (msg: any, meta?: any) => { logged.push({ level, msg: String(msg), meta }); };
    const serviceLogger = { info() {}, debug() {}, warn: capture('warn'), error: capture('error'), child() { return serviceLogger; } };
    ({ automation, service } = wireReplica(fake, new InMemorySuspendedRunStore(), tickingClock(), (s) => { peeks.push(s); }, serviceLogger));
    automation.registerFlow('wrapped_signoff', WRAPPED_SIGNOFF as never);
    automation.registerFlow('doubly_wrapped_signoff', DOUBLY_WRAPPED_SIGNOFF as never);
    automation.registerFlow('batch_of_wrapped', BATCH_OF_WRAPPED as never);
  });

  const requestFor = async (recordId: string, status: string) =>
    (await fake.find('sys_approval_request', { where: { record_id: recordId, status } }))[0];
  const parked = () => automation.listSuspendedRuns().map(r => ({ runId: r.runId, nodeId: r.nodeId, correlation: r.correlation }));
  const REASON = /record it is about was deleted/;
  /** The delete hook's call, with what the service logs from here on captured alone. */
  const deleteRecord = (recordId: string) => {
    logged.length = 0;
    return service.cancelForDeletedRecord('rel_task', recordId);
  };
  /** What was logged about runs: the fake holds no `rel_task` rows, so opening a request always warns about that. */
  const runLogs = () => logged.filter(l => !l.msg.includes('not found at node entry'));

  it('cancels the run parked on the approval, with the reason; neither branch runs', async () => {
    const run = await automation.execute('task_signoff', { object: 'rel_task', record: { id: 'solo' }, userId: 'submitter' } as never);
    const req = await requestFor('solo', 'pending');

    const out = await deleteRecord('solo');

    expect(out).toEqual({ cancelled: [req.id], cancelledRuns: [run.runId], suspendedRuns: [] });
    const history: any = await automation.getRun(run.runId!);
    expect(history?.status).toBe('cancelled');
    expect(history?.error).toMatch(REASON);
    // Neither `mark_ok` nor `mark_no` ran: the run never left the approval.
    expect(history?.steps?.map((s: any) => s.nodeId)).not.toEqual(expect.arrayContaining(['mark_ok']));
    expect(history?.steps?.map((s: any) => s.nodeId)).not.toEqual(expect.arrayContaining(['mark_no']));
    expect(parked()).toEqual([]);
    expect(await automation.hasSuspendedRun(run.runId!)).toBe(false);
    expect((await requestFor('solo', 'cancelled'))?.cancel_reason).toBe('record_deleted');
    expect(runLogs()).toEqual([]);
  });

  it('a batch item: the item is cancelled and the batch goes on to the next one', async () => {
    const batch = await automation.execute('release_signoff', {
      userId: 'submitter', params: { items: [{ id: 't1' }, { id: 't2' }] },
    } as never);
    const first = await requestFor('t1', 'pending');

    const out = await deleteRecord('t1');

    expect(out).toMatchObject({ cancelledRuns: [first.flow_run_id], suspendedRuns: [] });
    expect((await automation.getRun(first.flow_run_id))?.status).toBe('cancelled');
    const second = await requestFor('t2', 'pending');
    expect(second, 'the batch opened the next item').toBeDefined();
    expect(parked()).toContainEqual({ runId: batch.runId, nodeId: 'signoffs', correlation: `map:${second.flow_run_id}` });

    await service.decide(second.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    expect(peeks).toEqual([{ results: [{ $status: 'cancelled', $itemRunId: first.flow_run_id }, { decision: 'approved' }], count: 1 }]);
    expect((await automation.getRun(batch.runId!))?.status).toBe('completed');
    expect(runLogs()).toEqual([]);
  });

  it('inside subflows: every run up the chain is cancelled, deepest first, and no parent is resumed', async () => {
    const outer = await automation.execute('doubly_wrapped_signoff', {
      object: 'rel_task', record: { id: 'w1' }, userId: 'submitter',
    } as never);
    const req = await requestFor('w1', 'pending');
    expect(parked()).toHaveLength(3);
    const cancelRun = vi.spyOn(automation, 'cancelRun');
    const resume = vi.spyOn(automation, 'resume');

    const out = await deleteRecord('w1');

    expect(out.suspendedRuns).toEqual([]);
    expect(out.cancelledRuns).toHaveLength(3);
    const order = cancelRun.mock.calls.map(([id]) => id);
    expect(order[0]).toBe(req.flow_run_id);
    expect(order[2]).toBe(outer.runId);
    for (const [, reason] of cancelRun.mock.calls) expect(reason).toMatch(REASON);
    // ⛔ A resume of a subflow parent would read as the subflow completing.
    expect(resume).not.toHaveBeenCalled();
    expect((await automation.getRun(outer.runId!))?.status).toBe('cancelled');
    expect(peeks).toEqual([]);
    expect(parked()).toEqual([]);
  });

  it('a batch item that runs its sign-off in a subflow: the item chain is cancelled and the batch goes on', async () => {
    const batch = await automation.execute('batch_of_wrapped', {
      userId: 'submitter', params: { items: [{ id: 'k1' }, { id: 'k2' }] },
    } as never);
    const first = await requestFor('k1', 'pending');
    expect(parked()).toHaveLength(3);

    const out = await deleteRecord('k1');

    expect(out.cancelledRuns).toHaveLength(2);
    expect(out.cancelledRuns).toContain(first.flow_run_id);
    const second = await requestFor('k2', 'pending');
    expect(second).toBeDefined();
    await service.decide(second.id, { decision: 'approve', actorId: 'u1' }, SYSTEM_CTX);

    // The batch's own reader, not the wrapped flow's (whose peek sees no batch).
    expect(peeks.filter(p => p.count !== undefined)).toEqual([
      { results: [{ $status: 'cancelled', $itemRunId: out.cancelledRuns[1] }, {}], count: 1 },
    ]);
    expect((await automation.getRun(batch.runId!))?.status).toBe('completed');
    expect(parked()).toEqual([]);
  });

  it('a request that names no record run cancels its own run alone, and says nothing', async () => {
    const outer = await automation.execute('wrapped_signoff', {
      object: 'rel_task', record: { id: 'old' }, userId: 'submitter',
    } as never);
    const req = await requestFor('old', 'pending');
    // A request opened before requests recorded the column.
    await fake.update('sys_approval_request', { id: req.id, record_run_id: null });

    const out = await deleteRecord('old');

    expect(out).toMatchObject({ cancelledRuns: [req.flow_run_id], suspendedRuns: [] });
    // Nothing reached the parent: it stays parked, exactly as before this card.
    expect(parked()).toEqual([{ runId: outer.runId, nodeId: 'call', correlation: `subflow:${req.flow_run_id}` }]);
    expect(peeks).toEqual([]);
    // Silent by design: a request with no record run is also every flat run
    // on an engine that hands none, where a warning would be noise.
    expect(runLogs()).toEqual([]);
  });

  it('a request whose record run cannot be walked to its own run cancels that run alone, and warns', async () => {
    const outer = await automation.execute('wrapped_signoff', {
      object: 'rel_task', record: { id: 'gap' }, userId: 'submitter',
    } as never);
    const req = await requestFor('gap', 'pending');
    vi.spyOn(automation, 'suspensionOf').mockRejectedValueOnce(new Error('store unavailable'));

    const out = await deleteRecord('gap');

    expect(out).toMatchObject({ cancelledRuns: [req.flow_run_id], suspendedRuns: [] });
    expect(parked()).toEqual([{ runId: outer.runId, nodeId: 'call', correlation: `subflow:${req.flow_run_id}` }]);
    expect(runLogs()).toContainEqual(expect.objectContaining({
      level: 'warn', meta: expect.objectContaining({ run: req.flow_run_id, recordRun: outer.runId }),
    }));
  });

  it('a cancel that throws leaves that run and the runs above it parked, named, and never throws', async () => {
    const outer = await automation.execute('wrapped_signoff', {
      object: 'rel_task', record: { id: 'boom' }, userId: 'submitter',
    } as never);
    const req = await requestFor('boom', 'pending');
    vi.spyOn(automation, 'cancelRun').mockRejectedValueOnce(new Error('store unavailable'));

    const out = await deleteRecord('boom');

    expect(out).toMatchObject({ cancelled: [req.id], cancelledRuns: [], suspendedRuns: [req.flow_run_id, outer.runId] });
    expect(parked()).toHaveLength(2);
    expect(runLogs().map(l => l.level)).toEqual(['error', 'warn']);
    expect(runLogs()[1].meta.runs).toEqual([req.flow_run_id, outer.runId]);
  });
});
