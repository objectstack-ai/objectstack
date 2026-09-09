// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END: the REAL ScheduleTrigger wired to the REAL AutomationEngine, proving
// that a scheduled flow's JOB FIRE produces a USER-LESS context that reaches the
// engine and trips the unscoped-run fail-open warning (#1888 follow-up, ADR-0049).
//
// The unit + dogfood tests for this fix call `engine.execute()` with a hand-made
// `{ event:'schedule' }` context. This test closes that gap by exercising the
// ACTUAL cron path the platform runs:
//
//   job fires -> ScheduleTrigger builds { event:'schedule', params } (NO userId)
//   -> engine's activateFlowTrigger callback -> engine.execute -> resolveRunContext
//   -> warns AND threads the unscoped (user-mode, user-less) identity to the data node.
//
// ScheduleTrigger declares the FlowTrigger contract structurally (no build dep on
// the automation package), so this is the first place the two real halves meet.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import { ScheduleTrigger } from './schedule-trigger.js';

function recordingLogger(): { logger: any; warns: string[] } {
  const warns: string[] = [];
  const l: any = { info() {}, warn: (m: string) => warns.push(m), error() {}, debug() {} };
  l.child = () => l;
  return { logger: l, warns };
}
const runAsWarns = (warns: string[]) => warns.filter((w) => w.includes('[runAs]'));

const silent = { info() {}, warn() {}, debug() {} };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Fake IJobService slice with a deterministic `fire()` standing in for the cron tick. */
function fakeJobService() {
  const jobs = new Map<string, { schedule: JobSchedule; handler: JobHandler }>();
  return {
    service: {
      async schedule(name: string, schedule: JobSchedule, handler: JobHandler) {
        jobs.set(name, { schedule, handler });
      },
      async cancel(name: string) {
        jobs.delete(name);
      },
    },
    has: (name: string) => jobs.has(name),
    fire: async (name: string, jobId = 'tick1') => {
      await jobs.get(name)?.handler({ jobId } as never);
    },
  };
}

/** A schedule-triggered flow that touches data, parameterized by runAs. */
function scheduledDataFlow(name: string, runAs?: 'system' | 'user') {
  return {
    name,
    label: name,
    type: 'schedule',
    ...(runAs ? { runAs } : {}),
    nodes: [
      // [#16659] The acting organization a time-triggered flow declares. The
      // engine lifts it onto the binding and the trigger threads it onto the
      // run as `tenantId`; a flow without it is refused at bind.
      { id: 'start', type: 'start', label: 'Start', config: { schedule: { type: 'interval', intervalMs: 1000 }, organization: 'org_2mtx1w9d0k4bqf7v' } },
      { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { a: 1 } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'mk' },
      { id: 'e2', source: 'mk', target: 'end' },
    ],
  } as never;
}

/** Register a stub data executor that captures the context it is handed. */
function captureDataContext(engine: AutomationEngine): AutomationContext[] {
  const seen: AutomationContext[] = [];
  engine.registerNodeExecutor({
    type: 'create_record',
    async execute(_node: unknown, _vars: unknown, context: AutomationContext) {
      seen.push(context);
      return { success: true, output: {} };
    },
  } as never);
  return seen;
}

describe('schedule trigger -> engine: user-less runAs fail-open via the REAL cron path (#1888)', () => {
  it('a fired scheduled job runs the flow UNSCOPED (user-less) and the engine warns', async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const seen = captureDataContext(engine);

    engine.registerFlow('nightly_sweep', scheduledDataFlow('nightly_sweep')); // no runAs -> default 'user'
    const job = fakeJobService();
    engine.registerTrigger(new ScheduleTrigger(() => job.service, silent));
    await flush(); // let ScheduleTrigger.start() schedule the job

    expect(job.has('flow-schedule:nightly_sweep'), 'flow was not bound to the schedule trigger').toBe(true);

    // Simulate the cron tick - this is what the job service does on schedule.
    await job.fire('flow-schedule:nightly_sweep', 'tick-42');

    // The data node ran with the schedule's USER-LESS, user-mode context.
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toBe('schedule');
    expect(seen[0].params).toMatchObject({ jobId: 'tick-42', flowName: 'nightly_sweep' });
    expect(seen[0].userId, 'a scheduled run must carry no trigger user').toBeUndefined();
    expect(seen[0].runAs, 'effective identity is user (the default)').toBe('user');

    // ...and the engine made the fail-open AUDIBLE.
    const w = runAsWarns(warns);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("flow 'nightly_sweep'");
    expect(w[0]).toMatch(/UNSCOPED/);
    expect(w[0]).toMatch(/runAs:'system'/);
  });

  it("a scheduled runAs:'system' flow reaches the engine elevated, with NO warning", async () => {
    const { logger, warns } = recordingLogger();
    const engine = new AutomationEngine(logger);
    const seen = captureDataContext(engine);

    engine.registerFlow('sys_sweep', scheduledDataFlow('sys_sweep', 'system'));
    const job = fakeJobService();
    engine.registerTrigger(new ScheduleTrigger(() => job.service, silent));
    await flush();
    await job.fire('flow-schedule:sys_sweep');

    expect(seen).toHaveLength(1);
    expect(seen[0].runAs, 'explicit elevation propagated through the cron path').toBe('system');
    expect(runAsWarns(warns), 'an explicitly-elevated scheduled run must not warn').toHaveLength(0);
  });
});
