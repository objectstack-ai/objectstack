// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerWaitNode, parseIsoDuration, rearmSuspendedWaitTimers } from './wait-node.js';
import type { IJobService, JobHandler, JobSchedule } from '@objectstack/spec/contracts';
// #6758 — the wait tombstone's prescription is checked against BOTH gates an
// author's value must clear: the spec schema and `parseIsoDuration` above.
import { FlowNodeSchema } from '@objectstack/spec/automation';

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

/**
 * #6758 — the spec's own upgrade prescription, EXECUTED rather than read.
 *
 * `waitEventConfig.timeoutMs` is a #4158 tombstone whose message tells an
 * upgrading author which `timerDuration` value to write instead. That value has
 * to survive TWO gates, and each gate is blind to the other's failure:
 *
 *   1. **The schema.** `timerDuration` is `z.string()`, so an unquoted number is
 *      TS2322 at the authoring site and `expected string, received number` at
 *      the parse. This is what the message printed until #6758 — `parseIsoDuration`
 *      below does accept a bare JS number, which is where the wrong wording came
 *      from, but no number can REACH it through `timerDuration`.
 *   2. **This reader.** `z.string()` takes any string at all, so schema-green
 *      cannot tell `'60000'` from `'about a minute'` (the latter parses to
 *      `undefined` here and silently waits on nothing).
 *
 * The spec package can only check gate 1 — it does not depend on this one — so
 * the round trip is pinned here, where both halves are importable. Every value
 * is EXTRACTED from the live message, never compared to a copy: a hard-coded
 * `'60000'` would go green the moment someone reworded the prose, which is
 * exactly when this needs to be checked.
 */
describe("the spec's `timeoutMs` → `timerDuration` prescription round-trips (#6758)", () => {
  const waitNode = (waitEventConfig: Record<string, unknown>) => ({
    id: 'w', type: 'wait', label: 'Wait', waitEventConfig,
  });
  const issueMessage = (waitEventConfig: Record<string, unknown>, code: string) => {
    const result = FlowNodeSchema.safeParse(waitNode(waitEventConfig));
    expect(result.success).toBe(false);
    return result.error!.issues.find((i) => i.code === code)?.message;
  };

  it('every `timerDuration` it prints parses AND yields the wait it promises', () => {
    // Channel 1 — the tombstone itself. Channel 2 — the `timeout` misspelling's
    // `guidance` entry, which repeats the same advice to an author who has had
    // no first failure to learn from.
    const tombstone = issueMessage({ eventType: 'timer', timeoutMs: 60_000 }, 'invalid_type');
    const guidance = issueMessage({ eventType: 'timer', timeout: 60_000 }, 'unrecognized_keys');

    for (const [channel, message] of Object.entries({ tombstone, guidance })) {
      // Anti-vacuity: gut either channel and this fails, rather than the loop
      // below passing because it found nothing to check.
      expect(message, `${channel}: raised no message at all`).toBeDefined();
      const printed = [...message!.matchAll(/`timerDuration:\s*([^`]+)`/g)].map((m) => m[1]);
      expect(printed.length, `${channel} must PRINT a \`timerDuration\` value to copy`)
        .toBeGreaterThan(0);

      for (const literal of printed) {
        // Read the literal exactly as an author retypes it: `'60000'` is a
        // string, a bare `60000` is a number — and that gap IS the defect.
        const authored: unknown = JSON.parse(literal.replace(/^'(.*)'$/, '"$1"'));

        // Gate 1 — the schema.
        const parsed = FlowNodeSchema.safeParse(waitNode({ eventType: 'timer', timerDuration: authored }));
        expect(
          parsed.success,
          `${channel} prints \`timerDuration: ${literal}\`, but the spec REJECTS it: `
          + JSON.stringify(parsed.error?.issues),
        ).toBe(true);

        // Gate 2 — this reader. A wait it cannot parse is a wait on nothing.
        const ms = parseIsoDuration(parsed.data!.waitEventConfig?.timerDuration);
        expect(ms, `${channel} prints \`timerDuration: ${literal}\`, which this reader cannot parse`)
          .toBeGreaterThan(0);
      }
    }

    // The tombstone does not merely prescribe a value, it claims an EQUALITY:
    // "`timeoutMs: N` and `timerDuration: X` the same wait". Read both sides out
    // of the message and hold it to that claim.
    const claimedMs = Number(/`timeoutMs:\s*(\d+)`/.exec(tombstone!)?.[1]);
    expect(claimedMs, 'the tombstone must still name the `timeoutMs` wait it is equating')
      .toBeGreaterThan(0);
    for (const literal of [...tombstone!.matchAll(/`timerDuration:\s*([^`]+)`/g)].map((m) => m[1])) {
      const authored = JSON.parse(literal.replace(/^'(.*)'$/, '"$1"')) as string;
      expect(
        parseIsoDuration(authored),
        `the tombstone equates \`timeoutMs: ${claimedMs}\` with \`timerDuration: ${literal}\`, `
        + 'but they are not the same wait',
      ).toBe(claimedMs);
    }
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

/**
 * #5512 — the one-shot wake-up job is dropped when the run leaves the wait node,
 * whichever route it leaves by.
 *
 * The reported symptom: a `wait P1D` pause resumed early through the REST resume
 * endpoint (a door the #3801 gate deliberately leaves open for `wait`) ran to
 * completion while its `flow-wait:<runId>:<nodeId>` one-shot stayed `active` in
 * `sys_job` with tomorrow's deadline — for 24h it read as "a run is still waiting
 * to be woken", and then fired a ghost `resume` at a run that had completed the
 * day before. Only the timer's OWN callback dropped its job.
 *
 * `cancelled` here is the fake job service's log of `IJobService.cancel(name)` —
 * the call the DbJobAdapter turns into `active: false` on the `sys_job` row.
 */
describe('wait timer teardown when the pause ends another way (#5512)', () => {
  let engine: AutomationEngine;
  let ran: string[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    ran = [];
    engine.registerNodeExecutor(markerExecutor(ran));
  });

  it('cancels the one-shot when an external resume cuts a timer wait short', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'timer', timerDuration: 'P1D' }));

    const paused = await engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    expect(scheduled).toHaveLength(1); // armed for +24h
    expect(cancelled).toEqual([]);

    // The REST resume door: no signal, no job involvement — exactly the repro.
    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(ran).toEqual(['after']); // the run completed
    expect(engine.listSuspendedRuns()).toEqual([]);

    // …and tomorrow's wake-up is gone with it, instead of lingering `active`.
    expect(cancelled).toEqual([scheduled[0].name]);
    expect(scheduled[0].name).toBe(`flow-wait:${paused.runId}:pause`);
  });

  it('cancels the one-shot when the parked run is cancelled (ADR-0044)', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'timer', timerDuration: 'P1D' }));

    const paused = await engine.execute('wait_flow');
    expect(await engine.cancelRun(paused.runId!, 'window abandoned')).toBe(true);

    expect(cancelled).toEqual([scheduled[0].name]);
    expect(ran).toEqual([]); // cancelled, not continued
  });

  it('cancels the re-armed one-shot too (cold boot, then an external resume)', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'P1D' };

    // Process 1: suspend at the wait, then "die".
    const boot1 = fakeJobCtx();
    const e1 = new AutomationEngine(silentLogger());
    e1.registerNodeExecutor(markerExecutor([]));
    registerWaitNode(e1, boot1.ctx);
    e1.setSuspendedRunStore(store);
    e1.registerFlow('wait_flow', waitFlow(config));
    const paused = await e1.execute('wait_flow');

    // Process 2: cold boot + re-arm, then someone resumes the run by hand.
    const boot2 = fakeJobCtx();
    registerWaitNode(engine, boot2.ctx);
    engine.setSuspendedRunStore(store);
    engine.registerFlow('wait_flow', waitFlow(config));
    const job = boot2.ctx.getService('job') as IJobService;
    expect(await rearmSuspendedWaitTimers(engine, store, job, silentLogger())).toBe(1);
    expect(boot2.scheduled).toHaveLength(1);

    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(ran).toEqual(['after']);
    // The re-armed job carries the same name, so the same teardown reaches it.
    expect(boot2.cancelled).toEqual([`flow-wait:${paused.runId}:pause`]);
  });

  it('cancels nothing for a signal wait — it armed no job to cancel', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'signal', signalName: 'contract.renewed' }));

    const paused = await engine.execute('wait_flow');
    expect(scheduled).toEqual([]);
    const resumed = await engine.resume(paused.runId!);

    expect(resumed.success).toBe(true);
    expect(ran).toEqual(['after']);
    // The correlation of a signal wait is the AUTHOR's signal name, not a job
    // name — the teardown must not hand it to `cancel()`.
    expect(cancelled).toEqual([]);
  });

  it('cancels nothing for a timer wait that armed no job (no parseable duration)', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    // No `timerDuration` ⇒ no deadline ⇒ nothing scheduled; the pause carries
    // the degraded `timer:<nodeId>` correlation instead of a job name.
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'timer' }));

    const paused = await engine.execute('wait_flow');
    expect(scheduled).toEqual([]);
    expect(engine.listSuspendedRuns()[0]).toMatchObject({ correlation: 'timer:pause' });

    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(cancelled).toEqual([]);
  });

  it('still cancels exactly once when the timer itself fires (idempotent teardown)', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow({ eventType: 'timer', timerDuration: 'PT2H' }));

    const paused = await engine.execute('wait_flow');
    await scheduled[0].handler({ jobId: scheduled[0].name });

    expect(ran).toEqual(['after']);
    // Two teardowns now cover this path — the release hook (the run left the
    // node) and the one-shot's own `finally` (the job had its single shot) — and
    // they target the same name. `cancel` is idempotent, so what is pinned is
    // "cancelled, and nothing else cancelled"; the call COUNT is deliberately
    // not pinned, since which of the two fires is not a behavioural promise.
    expect(cancelled.length).toBeGreaterThan(0);
    expect([...new Set(cancelled)]).toEqual([`flow-wait:${paused.runId}:pause`]);
  });
});

/**
 * The other half of "when may the one-shot disarm itself?" (#5529).
 *
 * #5512 gave the RUN-side question a hook (`onSuspensionReleased` — the pause
 * ended, so drop the job). The JOB-side question stayed in the timer callback's
 * `finally`, and that `finally` read nothing: `engine.resume()` reports failure
 * by RETURNING a code, so a shot that consumed the pause and a shot that missed
 * it looked identical, and both were cancelled. On `STORE_UNAVAILABLE` — the
 * durable store unreadable, so per #4420 the pause is emphatically NOT gone —
 * that cancelled the only thing left that would ever wake the run.
 *
 * Reachability is not equal across the two sites, and these tests are built to
 * say so rather than to look symmetric: `resumeInternal` reads the durable store
 * only on a hot-cache MISS, and a run that paused in this process stays cached
 * for the life of its suspension. So the end-to-end specimen below is the
 * **re-arm** callback (fresh process, empty cache, store consulted for real);
 * the arming callback's branch is latent by construction and is pinned at the
 * handler level, with the code injected rather than provoked.
 */
describe('wait timer one-shot vs. a shot that never consumed the pause (#5529)', () => {
  /** A logger that keeps its `error` lines so the diagnostic can be asserted. */
  function capturingLogger() {
    const errors: string[] = [];
    // Since #5737 the cause is in the record's meta — `error(message, error?,
    // meta?)`, the `Logger` contract's third slot — so this captures it too.
    const causes: string[] = [];
    const logger = {
      info() {}, warn() {}, debug() {},
      error(msg: string, _error?: unknown, meta?: Record<string, unknown>) {
        errors.push(msg);
        causes.push(String((meta as { error?: unknown } | undefined)?.error ?? ''));
      },
      child() { return logger; },
    } as any;
    return { logger, errors, causes };
  }

  /**
   * A durable store that is fully working except that `load` — the read
   * `resumeInternal` makes on a cache miss — is unreachable. Everything else
   * delegates, so the underlying rows stay inspectable: that is how these tests
   * prove the pause SURVIVED the failed shot instead of assuming it.
   */
  function storeWithUnreadableLoad(inner: InMemorySuspendedRunStore) {
    return {
      inner,
      async save(run: any) { return inner.save(run); },
      async load(_runId: string): Promise<any> { throw new Error('connection refused'); },
      async delete(runId: string) { return inner.delete(runId); },
      async list() { return inner.list(); },
    };
  }

  const config = { eventType: 'timer', timerDuration: 'P1D' };

  /**
   * Suspend a run in "process 1", then cold-boot "process 2" whose durable
   * `load` is broken, and let its re-arm pass re-schedule the wake-up. Returns
   * the re-armed job so a test can fire it.
   */
  async function coldBootWithBrokenLoad() {
    const inner = new InMemorySuspendedRunStore();
    const boot1 = fakeJobCtx();
    const e1 = new AutomationEngine(silentLogger());
    e1.registerNodeExecutor(markerExecutor([]));
    registerWaitNode(e1, boot1.ctx);
    e1.setSuspendedRunStore(inner);
    e1.registerFlow('wait_flow', waitFlow(config));
    const paused = await e1.execute('wait_flow');
    expect(paused.status).toBe('paused');

    // Process 2: same durable rows, but the resume-time read fails.
    const broken = storeWithUnreadableLoad(inner);
    const boot2 = fakeJobCtx();
    const ran: string[] = [];
    const e2 = new AutomationEngine(silentLogger());
    e2.registerNodeExecutor(markerExecutor(ran));
    registerWaitNode(e2, boot2.ctx);
    e2.setSuspendedRunStore(broken as any);
    e2.registerFlow('wait_flow', waitFlow(config));

    const { logger, errors, causes } = capturingLogger();
    const job = boot2.ctx.getService('job') as IJobService;
    // The deadline is +24h, so the re-arm re-schedules rather than resuming now.
    expect(await rearmSuspendedWaitTimers(e2, broken as any, job, logger)).toBe(1);
    expect(boot2.scheduled).toHaveLength(1);
    expect(boot2.cancelled).toEqual([]);

    return { paused, inner, boot2, ran, errors, causes, jobName: `flow-wait:${paused.runId}:pause` };
  }

  it('re-arm path: a STORE_UNAVAILABLE shot leaves the one-shot ARMED', async () => {
    const { paused, inner, boot2, ran, jobName } = await coldBootWithBrokenLoad();

    // The deadline arrives and the wake-up fires — into an unreachable store.
    await boot2.scheduled[0].handler({ jobId: jobName });

    // The pause was never consumed: the run is still parked, its row still there.
    expect(ran).toEqual([]);
    expect((await inner.list()).map((r) => r.runId)).toEqual([paused.runId]);
    // …so the job that would wake it MUST survive. This is the regression: the
    // unconditional `finally` cancelled here, and nothing would have re-armed
    // until the next process start.
    expect(boot2.cancelled).toEqual([]);
  });

  it('re-arm path: the failed shot is reported at error, naming the job and the run', async () => {
    const { paused, boot2, errors, causes, jobName } = await coldBootWithBrokenLoad();
    await boot2.scheduled[0].handler({ jobId: jobName });

    // Previously silent: the callback discarded the result without a single line.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(jobName);
    expect(errors[0]).toContain(paused.runId!);
    // Both remedies an operator can act on, and the reason the job was kept.
    expect(errors[0]).toMatch(/left ARMED on purpose/);
    expect(errors[0]).toMatch(new RegExp(`trigger\\('${jobName}'\\)`));
    expect(errors[0]).toMatch(new RegExp(`resume\\('${paused.runId}'\\)`));
    // The resume envelope's reason still reaches the record — in its meta since
    // #5737, because the engine composes that envelope by interpolating the
    // driver's own message into it and a driver's message can be multi-line.
    expect(causes[0]).toContain('connection refused');
    expect(errors[0]).not.toContain('connection refused');
  });

  it('re-arm path: a shot that DOES resume still disarms the one-shot (unchanged)', async () => {
    // Same cold boot, working store — the branch must not have swallowed the
    // ordinary teardown along with the failing one.
    const inner = new InMemorySuspendedRunStore();
    const boot1 = fakeJobCtx();
    const e1 = new AutomationEngine(silentLogger());
    e1.registerNodeExecutor(markerExecutor([]));
    registerWaitNode(e1, boot1.ctx);
    e1.setSuspendedRunStore(inner);
    e1.registerFlow('wait_flow', waitFlow(config));
    const paused = await e1.execute('wait_flow');

    const ran: string[] = [];
    const boot2 = fakeJobCtx();
    const e2 = new AutomationEngine(silentLogger());
    e2.registerNodeExecutor(markerExecutor(ran));
    registerWaitNode(e2, boot2.ctx);
    e2.setSuspendedRunStore(inner);
    e2.registerFlow('wait_flow', waitFlow(config));
    const { logger, errors } = capturingLogger();
    await rearmSuspendedWaitTimers(e2, inner, boot2.ctx.getService('job') as IJobService, logger);

    await boot2.scheduled[0].handler({ jobId: boot2.scheduled[0].name });

    expect(ran).toEqual(['after']);
    expect([...new Set(boot2.cancelled)]).toEqual([`flow-wait:${paused.runId}:pause`]);
    expect(errors).toEqual([]);
  });

  it('arming path: the same handler keeps the job armed on STORE_UNAVAILABLE', async () => {
    // The arming callback shares one handler with the re-arm callback, so this
    // pins the branch on THAT site too. The code is injected, not provoked: a run
    // that paused in this process is in the engine's hot cache, so its own resume
    // never reads the durable store and cannot produce STORE_UNAVAILABLE here.
    // Fabricating a cache miss to "prove" otherwise would pin a scenario the
    // engine does not have — what is verified is the handler's branch, and that
    // the arming site routes through it rather than keeping its own `finally`.
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    const engine = new AutomationEngine(silentLogger());
    const ran: string[] = [];
    engine.registerNodeExecutor(markerExecutor(ran));
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow(config));

    const paused = await engine.execute('wait_flow');
    expect(scheduled).toHaveLength(1);

    engine.resume = async () => ({
      success: false,
      code: 'STORE_UNAVAILABLE',
      error: `Durable suspended-run store unreachable for run '${paused.runId}'`,
    });
    await scheduled[0].handler({ jobId: scheduled[0].name });

    expect(cancelled).toEqual([]);
    expect(ran).toEqual([]);
  });

  it('RESUME_IN_PROGRESS still disarms — the other resume owns the pause', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    const engine = new AutomationEngine(silentLogger());
    const ran: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    engine.registerNodeExecutor({
      type: 'mark',
      async execute(node) { ran.push(node.id); await gate; return { success: true }; },
    });
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow(config));
    const paused = await engine.execute('wait_flow');

    // A concurrent resume claims the pause and parks inside the next node.
    const inFlight = engine.resume(paused.runId!);
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toEqual(['after']); // it really is mid-flight, holding the guard

    // Ignore the release-hook teardown that claim already triggered, so what is
    // asserted below can only have come from the timer's own settle step.
    cancelled.length = 0;
    await scheduled[0].handler({ jobId: scheduled[0].name });
    expect(cancelled).toEqual([`flow-wait:${paused.runId}:pause`]);

    release();
    expect((await inFlight).success).toBe(true);
  });

  it('a thrown resume still disarms — a throw is not a store outage', async () => {
    const { ctx, scheduled, cancelled } = fakeJobCtx();
    const engine = new AutomationEngine(silentLogger());
    engine.registerNodeExecutor(markerExecutor([]));
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', waitFlow(config));
    await engine.execute('wait_flow');

    engine.resume = async () => { throw new Error('boom'); };
    await expect(scheduled[0].handler({ jobId: scheduled[0].name })).rejects.toThrow('boom');
    expect(cancelled).toEqual([scheduled[0].name]);
  });
});

/**
 * The loose `config.*` back door the executor used to read alongside
 * `waitEventConfig` graduated into the ADR-0087 D2 conversion layer
 * (`flow-node-wait-event-config-lift`, #4045), so the executor now reads the
 * declared block only (PD #12).
 *
 * These go through `registerFlow`, which is the seam that applies the conversion
 * — so they prove the graduation end-to-end on a legacy source, not merely that
 * the executor stopped looking. Both spellings under test (`duration`, `signal`)
 * are ones the spec never declared; they existed only as the tail of the `??`
 * chains this change deleted.
 */
describe('wait config graduation — legacy loose `config` still works via the conversion (#4045)', () => {
  let engine: AutomationEngine;
  let ran: string[];

  /** The same flow, but authored the legacy way: event keys loose under `config`. */
  const looseWaitFlow = (config: Record<string, unknown>) => ({
    ...waitFlow({ eventType: 'timer' }),
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'pause', type: 'wait', label: 'Wait', config },
      { id: 'after', type: 'mark', label: 'After' },
      { id: 'end', type: 'end', label: 'End' },
    ],
  });

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    ran = [];
    engine.registerNodeExecutor(markerExecutor(ran));
  });

  it('schedules the same timer from a loose `config.duration` (undeclared spelling, no eventType)', async () => {
    const { ctx, scheduled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    // No eventType anywhere: the conversion stamps the executor's own 'timer'
    // default, without which the converted flow would not even parse.
    engine.registerFlow('wait_flow', looseWaitFlow({ duration: 'PT2H' }));

    const before = Date.now();
    const paused = await engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    expect(ran).toEqual([]);

    expect(scheduled).toHaveLength(1);
    const at = new Date(scheduled[0].schedule.at!).getTime();
    expect(at).toBeGreaterThanOrEqual(before + 7_200_000 - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 7_200_000 + 1000);
  });

  it('suspends on a loose `config.signal` (undeclared spelling) as its declared counterpart', async () => {
    registerWaitNode(engine, ctxNoJob());
    engine.registerFlow('wait_flow', looseWaitFlow({ eventType: 'signal', signal: 'contract.renewed' }));

    const paused = await engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    expect(engine.listSuspendedRuns()[0]).toMatchObject({ nodeId: 'pause', correlation: 'contract.renewed' });

    const resumed = await engine.resume(paused.runId!);
    expect(resumed.success).toBe(true);
    expect(ran).toEqual(['after']);
  });

  // Unlike the two above, this one passes with the conversion unregistered too —
  // it pins the EXECUTOR's side of the precedence (a declared value is what gets
  // read), not the conversion's. Kept because that is the half a future
  // "simplification" of the lift could silently invert.
  it('reads the declared value, not its loose counterpart, when both are present', async () => {
    const { ctx, scheduled } = fakeJobCtx();
    registerWaitNode(engine, ctx);
    engine.registerFlow('wait_flow', {
      ...waitFlow({ eventType: 'timer' }),
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'pause',
          type: 'wait',
          label: 'Wait',
          waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' },
          config: { duration: 'PT9H' },
        },
        { id: 'after', type: 'mark', label: 'After' },
        { id: 'end', type: 'end', label: 'End' },
      ],
    });

    const before = Date.now();
    await engine.execute('wait_flow');
    // 1h (declared) — not 9h (loose). Same precedence the deleted `??` had.
    const at = new Date(scheduled[0].schedule.at!).getTime();
    expect(at).toBeLessThanOrEqual(before + 3_600_000 + 1000);
  });
});

describe('rearmSuspendedWaitTimers (cold-boot timer re-arm)', () => {
  /** Boot a fresh engine wired to `store` with the wait flow registered — one "process". */
  function bootEngine(store: InMemorySuspendedRunStore, ctx: any, waitConfig: Record<string, unknown>) {
    const engine = new AutomationEngine(silentLogger());
    const ran: string[] = [];
    engine.registerNodeExecutor(markerExecutor(ran));
    registerWaitNode(engine, ctx);
    engine.setSuspendedRunStore(store);
    engine.registerFlow('wait_flow', waitFlow(waitConfig));
    return { engine, ran };
  }

  it('re-schedules a future timer on a new engine and resumes when it fires', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'PT2H' };

    // Process 1: suspend at the wait, then "die" (engine discarded).
    const boot1 = fakeJobCtx();
    const a = bootEngine(store, boot1.ctx, config);
    const paused = await a.engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    const storedAt = boot1.scheduled[0]?.schedule.at;
    expect(storedAt).toBeTruthy();

    // Process 2: cold boot — fresh engine + fresh (empty) job service.
    const boot2 = fakeJobCtx();
    const b = bootEngine(store, boot2.ctx, config);
    const job = boot2.ctx.getService('job') as IJobService;
    const rearmed = await rearmSuspendedWaitTimers(b.engine, store, job, silentLogger());
    expect(rearmed).toBe(1);

    // Same one-shot job name + the persisted deadline (not a fresh now+2h).
    expect(boot2.scheduled).toHaveLength(1);
    expect(boot2.scheduled[0].name).toBe(`flow-wait:${paused.runId}:pause`);
    expect(boot2.scheduled[0].schedule).toMatchObject({ type: 'once', at: storedAt });

    // Firing the re-armed job resumes the run on the new engine.
    await boot2.scheduled[0].handler({ jobId: boot2.scheduled[0].name });
    expect(b.ran).toEqual(['after']);
    expect(await store.list()).toHaveLength(0); // consumed
  });

  it('resumes an overdue timer immediately (deadline elapsed while down)', async () => {
    const store = new InMemorySuspendedRunStore();
    // `timerDuration: '1'`, not the retired `timeoutMs: 1` (#4158) — a bare
    // numeric string is milliseconds, so this is the same 1ms deadline.
    const config = { eventType: 'timer', timerDuration: '1' };

    const a = bootEngine(store, ctxNoJob(), config); // degraded: no job service
    const paused = await a.engine.execute('wait_flow');
    expect(paused.status).toBe('paused');
    await new Promise((r) => setTimeout(r, 10)); // let the 1ms deadline lapse

    const boot2 = fakeJobCtx();
    const b = bootEngine(store, boot2.ctx, config);
    const rearmed = await rearmSuspendedWaitTimers(b.engine, store, undefined, silentLogger());
    expect(rearmed).toBe(1);
    expect(b.ran).toEqual(['after']); // resumed inline, no job needed
    expect(boot2.scheduled).toHaveLength(0);
  });

  it('skips non-timer pauses (signal waits have no persisted deadline)', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'signal', signalName: 'contract.renewed' };

    const a = bootEngine(store, ctxNoJob(), config);
    await a.engine.execute('wait_flow');

    const boot2 = fakeJobCtx();
    const b = bootEngine(store, boot2.ctx, config);
    const job = boot2.ctx.getService('job') as IJobService;
    const rearmed = await rearmSuspendedWaitTimers(b.engine, store, job, silentLogger());
    expect(rearmed).toBe(0);
    expect(boot2.scheduled).toHaveLength(0);
    expect(await store.list()).toHaveLength(1); // still suspended, untouched
  });

  it('leaves a future timer suspended (with a warning) when no job service exists', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'PT2H' };

    const a = bootEngine(store, ctxNoJob(), config);
    await a.engine.execute('wait_flow');

    const b = bootEngine(store, ctxNoJob(), config);
    const rearmed = await rearmSuspendedWaitTimers(b.engine, store, undefined, silentLogger());
    expect(rearmed).toBe(0);
    expect(b.ran).toEqual([]);
    expect(await store.list()).toHaveLength(1); // resumable externally later
  });
});
