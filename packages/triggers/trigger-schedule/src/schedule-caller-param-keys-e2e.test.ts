// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19900] A scheduled run's platform seeds never answer a screen field.
 *
 * The schedule trigger starts a run with three seeds in `params` — `jobId`,
 * `flowName` and `schedule` — and there is no caller behind it at all. A
 * `screen` node on that headless run asks whether the caller already answered
 * each of its fields (`judgeHeadlessScreen` in `@objectstack/service-automation`).
 * With no statement from the producer, that answer is INFERRED from `params`,
 * and the inference can only rule out the row-id and record seeds the other
 * doors write: the schedule trigger's three names read as the caller's own
 * answers, so a screen with a required field named `schedule` was skipped and
 * the run completed with the cron descriptor as the "answer".
 *
 * The producer now states it: `callerParamKeys: []` — "the caller supplied
 * nothing", which the verdict reads instead of inferring (#19846).
 *
 * The rig is the one `schedule-runas-e2e.test.ts` uses: the REAL
 * `ScheduleTrigger` bound through the REAL `AutomationEngine`, the job fired by
 * hand in place of the cron tick. The result read is the one the engine
 * returned to the trigger's own callback — not a hand-made context.
 *
 * ⚠️ `@objectstack/service-automation` resolves to its `dist/` here (no alias:
 * `KNOWN_UNALIASED_TEST_IMPORTS` in `scripts/check-test-source-alias.mjs`), so
 * the engine half is the built one. The half this file pins — the context the
 * trigger builds — is `./schedule-trigger.js`, read from source.
 */

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine, installBuiltinNodes } from '@objectstack/service-automation';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import { ScheduleTrigger } from './schedule-trigger.js';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';

function silentLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}
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
    fire: async (name: string, jobId = 'tick-1') => {
      await jobs.get(name)?.handler({ jobId } as never);
    },
  };
}

type Field = { name: string; label: string; type: string; required?: boolean };

const CRON: JobSchedule = { type: 'cron', expression: '0 2 * * *' } as JobSchedule;

/**
 * `start → screen_1 → end` on a `type: 'schedule'` flow, each screen field an
 * `isInput` variable — so the seed of the same name IS bound into it, which is
 * the only way the skip could happen.
 */
function scheduledScreenFlow(name: string, fields: Field[]) {
  return {
    name,
    label: name,
    type: 'schedule',
    runAs: 'system',
    status: 'active',
    version: 1,
    variables: fields.map((f) => ({ name: f.name, type: 'text', isInput: true, isOutput: true })),
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { schedule: CRON } },
      { id: 'screen_1', type: 'screen', label: 'Ask', config: { fields } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'screen_1', type: 'default' },
      { id: 'e2', source: 'screen_1', target: 'end', type: 'default' },
    ],
  } as never;
}

/**
 * Bind the flow through the real trigger, fire one tick, and hand back what
 * the trigger passed to the engine and what the engine answered it with.
 */
async function fireOnce(flowName: string, fields: Field[]) {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, { logger: silentLogger(), getService: () => undefined } as never);
  const execute = vi.spyOn(engine, 'execute');
  engine.registerFlow(flowName, scheduledScreenFlow(flowName, fields));
  const job = fakeJobService();
  engine.registerTrigger(new ScheduleTrigger(() => job.service, silentLogger()));
  await flush(); // let ScheduleTrigger.start() schedule the job

  const jobName = `flow-schedule:${flowName}`;
  expect(job.has(jobName), 'the flow was not bound to the schedule trigger').toBe(true);
  await job.fire(jobName, 'tick-42');

  expect(execute).toHaveBeenCalledTimes(1);
  const context = execute.mock.calls[0][1] as AutomationContext;
  const result = await execute.mock.results[0].value;
  return { engine, context, result };
}

// [#17396] The switch is OFF by default in every posture; nothing binds without it.
withScheduledWorkOn('single');

describe('[#19900] a scheduled run\'s platform seeds never answer a screen field', () => {
  it('the trigger states that its run has no caller: `callerParamKeys` is an empty list', async () => {
    const { context } = await fireOnce('nightly_ask', [
      { name: 'schedule', label: 'Schedule', type: 'text', required: true },
    ]);
    // The seeds are still there — flows read them — they are just not a caller's.
    expect(context.params).toMatchObject({ jobId: 'tick-42', flowName: 'nightly_ask', schedule: CRON });
    expect(context.callerParamKeys).toEqual([]);
  });

  it.each(['schedule', 'jobId', 'flowName'])(
    'a required screen field named `%s` pauses the run instead of taking the seed as its answer',
    async (seed) => {
      const { engine, result } = await fireOnce('nightly_ask', [
        { name: seed, label: seed, type: 'text', required: true },
      ]);
      // One object, so a skip prints what the run completed WITH.
      expect(result).toMatchObject({ status: 'paused', screen: { nodeId: 'screen_1' } });
      expect(engine.listSuspendedRuns()).toEqual([
        expect.objectContaining({ flowName: 'nightly_ask', nodeId: 'screen_1' }),
      ]);
    },
  );

  it('an all-optional screen named after every seed pauses too — the seeds do not "drive" it', async () => {
    const { result } = await fireOnce('nightly_ask', [
      { name: 'schedule', label: 'Schedule', type: 'text' },
      { name: 'jobId', label: 'Job', type: 'text' },
      { name: 'flowName', label: 'Flow', type: 'text' },
    ]);
    expect(result).toMatchObject({ status: 'paused', screen: { nodeId: 'screen_1' } });
  });

  it('control: the same flow on the same engine continues when a context names `schedule` as a caller key', async () => {
    // The pause above is the signal's doing, not "a screen in a schedule flow
    // always pauses": a door that states real caller keys still answers it.
    const engine = new AutomationEngine(silentLogger());
    installBuiltinNodes(engine, { logger: silentLogger(), getService: () => undefined } as never);
    engine.registerFlow('nightly_ask', scheduledScreenFlow('nightly_ask', [
      { name: 'schedule', label: 'Schedule', type: 'text', required: true },
    ]));
    const result = await engine.execute('nightly_ask', {
      event: 'schedule',
      params: { jobId: 'tick-42', flowName: 'nightly_ask', schedule: '0 2 * * *' },
      callerParamKeys: ['schedule'],
    });
    expect(result.status).not.toBe('paused');
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ schedule: '0 2 * * *' });
    expect(engine.listSuspendedRuns()).toEqual([]);
  });
});
