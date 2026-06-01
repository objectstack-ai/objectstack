// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerWaitNode, parseIsoDuration } from './wait-node.js';
import type { IJobService, JobHandler, JobSchedule } from '@objectstack/spec/contracts';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}

/** ctx with no job service (timer degrades to suspend-only). */
function ctxNoJob() {
  return { logger: silentLogger(), getService() { throw new Error('no service'); } } as any;
}

/** A fake job service that records `schedule()` calls and exposes the handler. */
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

/** A marker executor that records the order it ran, to prove traversal resumed. */
function markerExecutor(ran: string[]): NodeExecutor {
  return { type: 'mark', async execute(node) { ran.push(node.id); return { success: true }; } };
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

describe('parseIsoDuration', () => {
  it('parses ISO-8601 durations to ms', () => {
    expect(parseIsoDuration('PT1H')).toBe(3_600_000);
    expect(parseIsoDuration('P3D')).toBe(259_200_000);
    expect(parseIsoDuration('PT90M')).toBe(5_400_000);
    expect(parseIsoDuration('P1DT12H')).toBe(129_600_000);
    expect(parseIsoDuration('PT30S')).toBe(30_000);
    expect(parseIsoDuration('P1W')).toBe(604_800_000);
  });
  it('treats a plain number / numeric string as ms', () => {
    expect(parseIsoDuration(5000)).toBe(5000);
    expect(parseIsoDuration('5000')).toBe(5000);
  });
  it('returns undefined for unparseable / non-positive input', () => {
    expect(parseIsoDuration('')).toBeUndefined();
    expect(parseIsoDuration('1 hour')).toBeUndefined();
    expect(parseIsoDuration('P')).toBeUndefined();
    expect(parseIsoDuration(0)).toBeUndefined();
    expect(parseIsoDuration(-5)).toBeUndefined();
    expect(parseIsoDuration(undefined)).toBeUndefined();
  });
});

describe('wait node executor', () => {
  let engine: AutomationEngine;
  let ran: string[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    ran = [];
    engine.registerNodeExecutor(markerExecutor(ran));
  });

  it('suspends the run on entry and resumes downstream via resume(runId)', async () => {
    registerWaitNode(engine, ctxNoJob());
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'timer', timerDuration: 'PT1H' }));

    const paused = await engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    expect(paused.runId).toBeTruthy();
    expect(ran).toEqual([]); // downstream not yet run — the wait held the run

    const suspended = engine.listSuspendedRuns();
    expect(suspended).toHaveLength(1);
    expect(suspended[0]).toMatchObject({ nodeId: 'pause', flowName: 'wait_flow' });

    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(resumed.status).toBeUndefined(); // ran to completion
    expect(ran).toEqual(['after']); // traversal continued past the wait
  });

  it('schedules a one-shot job that resumes the run when a job service is present', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'timer', timerDuration: 'PT2H' }));

    const before = Date.now();
    const paused = await engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    expect(ran).toEqual([]);

    // A single one-shot job was scheduled ~2h out.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].schedule.type).toBe('once');
    const at = new Date(scheduled[0].schedule.at!).getTime();
    expect(at).toBeGreaterThanOrEqual(before + 7_200_000 - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 7_200_000 + 1000);

    // Firing the scheduled handler resumes the run + cancels the one-shot.
    await scheduled[0].handler({ jobId: scheduled[0].name });
    expect(ran).toEqual(['after']);
    expect(cancelled).toContain(scheduled[0].name);
  });

  it('suspends on a named signal and resumes when the signal arrives', async () => {
    registerWaitNode(engine, ctxNoJob());
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'signal', signalName: 'contract.renewed' }));

    const paused = await engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    expect(engine.listSuspendedRuns()[0]).toMatchObject({ nodeId: 'pause', correlation: 'contract.renewed' });

    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(ran).toEqual(['after']);
  });
});
