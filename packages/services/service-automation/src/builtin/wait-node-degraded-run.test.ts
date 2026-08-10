// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DbJobAdapter } from '@objectstack/service-job';
import type { IJobService, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerWaitNode, rearmSuspendedWaitTimers } from './wait-node.js';

/**
 * #5548, end to end: the scenario that produced the finding, driven through the
 * REAL job adapter rather than a fake that records calls.
 *
 * The specimen is #5529's wait wake-up firing into an unreachable durable store.
 * That shot consumes nothing — the run stays parked, and the one-shot is kept
 * ARMED on purpose so it can be re-fired — and it deliberately does **not**
 * throw, because a throw is the retry signal `IJobService` implementations key
 * on (which is why option A was rejected). The consequence, until now, was that
 * the job's audit row said `success`: the operator-facing surface reported the
 * one thing that definitely did not happen.
 *
 * Why the real `DbJobAdapter` and not a spy: the defect lives in the mapping
 * from "what the handler reported" to "what got written", so a case that
 * asserts the handler was called, or that it did not throw, cannot see it —
 * that criterion IS the defect. Every assertion below reads the value in the
 * persisted `sys_job_run` / `sys_job` cell.
 */

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}

/** A fake job service for "process 1", which only has to park the run. */
function fakeJobCtx() {
  const scheduled: Array<{ name: string; schedule: JobSchedule; handler: JobHandler }> = [];
  const cancelled: string[] = [];
  const job: IJobService = {
    async schedule(name, schedule, handler) { scheduled.push({ name, schedule, handler }); },
    async cancel(name) { cancelled.push(name); },
    async trigger() {},
  };
  const ctx = { logger: silentLogger(), getService: (id: string) => (id === 'job' ? job : undefined) } as any;
  return { ctx, scheduled, cancelled };
}

function markerExecutor(ran: string[]): NodeExecutor {
  return { type: 'mark', async execute(node) { ran.push(node.id); return { success: true }; } };
}

/** Minimal ObjectQL stand-in for the two audit tables `DbJobAdapter` writes. */
function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  return {
    tables,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      const out = opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => r[k] === v))
        : [...t];
      return opts.limit ? out.slice(0, opts.limit) : out;
    },
    async insert(table: string, data: any) {
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, patch: any, options?: any) {
      // Same binding as the sibling double in `service-job`: the fake refuses
      // exactly what `ObjectQLEngine.update` refuses, so the audit writes this
      // test asserts are writes a real server would have accepted.
      assertEngineUpdateDispatch(patch, options);
      const t = tables.get(table) ?? [];
      const r = t.find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not in ${table}`);
      Object.assign(r, patch);
      return r;
    },
  };
}

const waitFlow = (waitConfig: Record<string, unknown>) => ({
  name: 'wait_flow',
  label: 'Wait Flow',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: waitConfig },
    { id: 'after', type: 'mark', label: 'After' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'pause' },
    { id: 'e2', source: 'pause', target: 'after' },
    { id: 'e3', source: 'after', target: 'end' },
  ],
});

const config = { eventType: 'timer', timerDuration: 'P1D' };

/** A store whose resume-time `load` is unreachable; everything else works. */
function storeWithUnreadableLoad(inner: InMemorySuspendedRunStore) {
  return {
    inner,
    async save(run: any) { return inner.save(run); },
    async load(_runId: string): Promise<any> { throw new Error('connection refused'); },
    async delete(runId: string) { return inner.delete(runId); },
    async list() { return inner.list(); },
  };
}

/**
 * Park a run in "process 1", then cold-boot "process 2" whose durable read is
 * broken and whose job service is a real `DbJobAdapter`. Returns the adapter,
 * the fake ObjectQL tables, and the wake-up job's name.
 */
async function coldBootOntoDbJobAdapter(broken: boolean) {
  const inner = new InMemorySuspendedRunStore();
  const boot1 = fakeJobCtx();
  const e1 = new AutomationEngine(silentLogger());
  e1.registerNodeExecutor(markerExecutor([]));
  registerWaitNode(e1, boot1.ctx);
  e1.setSuspendedRunStore(inner);
  e1.registerFlow('wait_flow', waitFlow(config));
  const paused = await e1.execute('wait_flow');
  expect(paused.status).toBe('paused');

  const store = broken ? (storeWithUnreadableLoad(inner) as any) : inner;
  const ran: string[] = [];
  const objectql = makeFakeEngine();
  const jobService = new DbJobAdapter({ engine: objectql });
  const e2 = new AutomationEngine(silentLogger());
  e2.registerNodeExecutor(markerExecutor(ran));
  // The wait node is registered against the REAL adapter, so the teardown that
  // fires when the run leaves the node (#5512) goes through it too.
  registerWaitNode(e2, {
    logger: silentLogger(),
    getService: (id: string) => (id === 'job' ? jobService : undefined),
  } as any);
  e2.setSuspendedRunStore(store);
  e2.registerFlow('wait_flow', waitFlow(config));
  // The re-arm pass registers the one-shot on the real adapter — from here on
  // every run of that job goes through `DbJobAdapter.wrap`.
  expect(await rearmSuspendedWaitTimers(e2, store, jobService, silentLogger())).toBe(1);

  return { paused, inner, ran, objectql, jobService, jobName: `flow-wait:${paused.runId}:pause` };
}

describe('#5548 — the #5529 wait wake-up that consumed nothing is audited as degraded, not success', () => {
  it('the wake-up into an unreachable store lands sys_job_run.status = "degraded"', async () => {
    const { inner, ran, objectql, jobService, jobName, paused } = await coldBootOntoDbJobAdapter(true);

    // Fire the wake-up the way an operator or the timer would.
    await jobService.trigger(jobName);

    // The pause really was not consumed — the run is still parked, its row still
    // there. This is the premise the audit row has to reflect.
    expect(ran).toEqual([]);
    expect((await inner.list()).map((r) => r.runId)).toEqual([paused.runId]);

    const runs = objectql.tables.get('sys_job_run') ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].job_name).toBe(jobName);
    // The cell this card exists for. Before the wiring it read 'success'.
    expect(runs[0].status).toBe('degraded');
    expect(runs[0].error).toBe('STORE_UNAVAILABLE');

    await jobService.destroy();
  });

  it('the job row mirrors it, stays active, and does NOT count as a failure', async () => {
    const { objectql, jobService, jobName } = await coldBootOntoDbJobAdapter(true);
    await jobService.trigger(jobName);

    const [job] = objectql.tables.get('sys_job') ?? [];
    expect(job.last_status).toBe('degraded');
    expect(job.last_error).toBe('STORE_UNAVAILABLE');
    // #5529's half is untouched: the one-shot is kept ARMED so the stuck run
    // stays visible and the wake-up re-firable.
    expect(job.active).toBe(true);
    // `degraded` is not a failure: the retry/alerting signal does not move.
    expect(job.failure_count).toBe(0);
    expect(job.run_count).toBe(1);

    await jobService.destroy();
  });

  it('a wake-up that DOES resume the run is still audited as success (control)', async () => {
    const { ran, objectql, jobService, jobName } = await coldBootOntoDbJobAdapter(false);
    await jobService.trigger(jobName);

    // The pause was consumed and traversal continued…
    expect(ran).toEqual(['after']);
    const runs = objectql.tables.get('sys_job_run') ?? [];
    expect(runs).toHaveLength(1);
    // …so the row says success, exactly as before this change.
    expect(runs[0].status).toBe('success');
    expect(runs[0].error).toBeNull();
    const [job] = objectql.tables.get('sys_job') ?? [];
    expect(job.last_status).toBe('success');
    // The one-shot had its shot and settled the pause, so it disarms — the
    // `sys_job` row goes inactive, which is the OPPOSITE of the degraded case.
    expect(job.active).toBe(false);

    await jobService.destroy();
  });
});
