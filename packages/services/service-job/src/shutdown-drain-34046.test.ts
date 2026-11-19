// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Kernel shutdown with a SCHEDULED run in flight.
 *
 * The kernel destroys plugins in reverse order (`kernel.shutdown()` ->
 * `performShutdown()`), so the job plugin's `destroy()` returns BEFORE the
 * driver's plugin releases the driver. A timer adapter whose `destroy()` only
 * clears its timers hands back a run that is still executing: the run then
 * reaches a released driver, its `sys_job_run` row's terminal write fails and
 * the row stays `running` for good.
 *
 * The harness below models exactly that order: each case awaits
 * `DbJobAdapter.destroy()` and then releases the engine. Every WRITE after the
 * release is RECORDED and throws, the way a released driver answers
 * (`No driver available for object …`), so "nothing touched the driver after
 * shutdown" is a count, not an absence of log lines alone. `find` stays a plain
 * double: every path that settles a run ends in a write (`finishRun` updates,
 * `bumpJob` finds and then updates, `startRun` inserts), so the writes see it.
 *
 * Both timer adapters are covered: `IntervalJobAdapter` (the no-cron fallback,
 * where `DbJobAdapter`'s own `inner` owns the timer) and `CronJobAdapter` (the
 * leader-elected path every schedule takes once a cron adapter is assembled),
 * the latter on a real croner expression.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JobSchedule } from '@objectstack/spec/contracts';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DbJobAdapter } from './db-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';
import { IntervalJobAdapter } from './interval-job-adapter.js';

const TICK = 1_000;
const DRAIN = 2_000;

/** The lines a run that outlived its kernel used to leave. */
const DRIVER_FAILURE = /failed to update sys_job_run|bumpJob failed|failed to insert sys_job_run/;

/** An engine double whose writes a "driver release" turns into refusals. */
function makeReleasableEngine() {
  const tables = new Map<string, any[]>();
  let released = false;
  const afterRelease: string[] = [];
  const guard = (op: string, table: string) => {
    if (!released) return;
    afterRelease.push(`${op} ${table}`);
    throw new Error(`No driver available for object '${table}'`);
  };
  return {
    tables,
    afterRelease,
    release() { released = true; },
    rows(table: string) { return tables.get(table) ?? []; },
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      const matched = opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
            return r[k] === v;
          }))
        : [...t];
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
    async insert(table: string, data: any) {
      guard('insert', table);
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, data: any, options?: Record<string, unknown>) {
      guard('update', table);
      assertEngineUpdateDispatch(data, options);
      const r = (tables.get(table) ?? []).find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
      return r;
    },
  };
}

function makeLogger() {
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    warns,
    errors,
    info: vi.fn(),
    warn: vi.fn((msg: string) => { warns.push(msg); }),
    error: vi.fn((msg: string) => { errors.push(msg); }),
  };
}

/** A handler that runs for `ms` of (fake) time, counting its calls. */
function slowHandler(ms: number) {
  const calls: number[] = [];
  const handler = vi.fn(async () => {
    calls.push(Date.now());
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
  return { handler, calls };
}

type Leg = {
  label: string;
  /** Build the adapter under test, with the drain bound it is given. */
  build(engine: ReturnType<typeof makeReleasableEngine>, logger: ReturnType<typeof makeLogger>): DbJobAdapter;
  schedule: JobSchedule;
  /** Fake time until the first scheduled fire has started. */
  firstFireAfter: number;
};

const LEGS: Leg[] = [
  {
    label: 'interval leg (IntervalJobAdapter owns the timer — no cron adapter assembled)',
    build: (engine, logger) =>
      new DbJobAdapter({ engine, logger, options: { shutdownDrainMs: DRAIN } }),
    schedule: { type: 'interval', intervalMs: TICK },
    firstFireAfter: TICK,
  },
  {
    label: 'cron leg (CronJobAdapter fires a croner expression)',
    build: (engine, logger) =>
      new DbJobAdapter({
        engine,
        logger,
        cron: new CronJobAdapter({ logger, shutdownDrainMs: DRAIN }),
      }),
    // Every second; croner fires at the next whole second.
    schedule: { type: 'cron', expression: '* * * * * *' },
    firstFireAfter: TICK,
  },
];

afterEach(() => {
  vi.useRealTimers();
});

/** Settle every microtask queued by the last timer advance. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe.each(LEGS)('shutdown with a scheduled run in flight — $label', (leg) => {
  it('waits for a run that finishes inside the drain bound, and its row ends terminal', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    const engine = makeReleasableEngine();
    const logger = makeLogger();
    const db = leg.build(engine, logger);
    const { handler } = slowHandler(DRAIN / 2);
    await db.schedule('rp_tick', leg.schedule, handler);

    await vi.advanceTimersByTimeAsync(leg.firstFireAfter);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(engine.rows('sys_job_run').map((r) => r.status)).toEqual(['running']);

    // Kernel-like teardown: the job plugin's destroy, THEN the driver.
    let destroyed = false;
    const destroying = db.destroy().then(() => { destroyed = true; });
    await flush();
    expect(destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(DRAIN / 2);
    await destroying;
    engine.release();

    expect(engine.rows('sys_job_run').map((r) => r.status)).toEqual(['success']);
    expect(engine.rows('sys_job')[0]).toMatchObject({ last_status: 'success', run_count: 1 });
    // No new fire started while destroy ran, nor after it.
    await vi.advanceTimersByTimeAsync(TICK * 5);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(engine.afterRelease).toEqual([]);
    expect(logger.warns.filter((w) => DRIVER_FAILURE.test(w))).toEqual([]);
  });

  it('records a run still going past the drain bound as interrupted, never leaves it running', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    const engine = makeReleasableEngine();
    const logger = makeLogger();
    const db = leg.build(engine, logger);
    const { handler } = slowHandler(DRAIN * 10);
    await db.schedule('rp_tick', leg.schedule, handler);

    await vi.advanceTimersByTimeAsync(leg.firstFireAfter);
    expect(handler).toHaveBeenCalledTimes(1);

    let destroyed = false;
    const destroying = db.destroy().then(() => { destroyed = true; });
    await vi.advanceTimersByTimeAsync(DRAIN - 1);
    expect(destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await destroying;
    engine.release();

    const [run] = engine.rows('sys_job_run');
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/interrupted by shutdown/);
    expect(run.completed_at).toEqual(expect.any(String));
    expect(engine.rows('sys_job')[0]).toMatchObject({ last_status: 'failed', run_count: 1, failure_count: 1 });

    // The abandoned handler finishes long after the driver is gone: nothing
    // it settles reaches the engine, and nothing logs a driver failure.
    await vi.advanceTimersByTimeAsync(DRAIN * 10);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(engine.afterRelease).toEqual([]);
    expect(engine.rows('sys_job_run').map((r) => r.status)).toEqual(['failed']);
    expect(logger.warns.filter((w) => DRIVER_FAILURE.test(w))).toEqual([]);
  });

  it('starts no retry attempt once shutdown has begun', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    const engine = makeReleasableEngine();
    const logger = makeLogger();
    const db = leg.build(engine, logger);
    const handler = vi.fn(async () => { throw new Error('first attempt fails'); });
    // The retry is due 5 s after the first attempt fails — past the drain bound.
    await db.schedule('rp_tick', leg.schedule, handler, {
      retryPolicy: { maxRetries: 1, backoffMs: DRAIN * 2.5, backoffMultiplier: 1, maxRetryDelayMs: 30_000, jitter: false },
    });

    await vi.advanceTimersByTimeAsync(leg.firstFireAfter);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(engine.rows('sys_job_run').map((r) => r.status)).toEqual(['failed']);

    const destroying = db.destroy();
    await vi.advanceTimersByTimeAsync(DRAIN);
    await destroying;
    engine.release();

    await vi.advanceTimersByTimeAsync(DRAIN * 5);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(engine.afterRelease).toEqual([]);
    expect(engine.rows('sys_job_run').map((r) => r.status)).toEqual(['failed']);
    expect(logger.warns.filter((w) => DRIVER_FAILURE.test(w))).toEqual([]);
  });
});

describe('the timer adapters themselves await their in-flight scheduled fire', () => {
  it('IntervalJobAdapter.destroy() resolves only once the in-flight fire settles', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    const adapter = new IntervalJobAdapter({ shutdownDrainMs: DRAIN });
    const { handler } = slowHandler(DRAIN / 4);
    await adapter.schedule('j', { type: 'interval', intervalMs: TICK }, handler);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(handler).toHaveBeenCalledTimes(1);

    let destroyed = false;
    const destroying = adapter.destroy().then(() => { destroyed = true; });
    await flush();
    expect(destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(DRAIN / 4);
    await destroying;
    expect(destroyed).toBe(true);
  });

  it('CronJobAdapter.destroy() gives up at its bound and says which job it left running', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    const logger = makeLogger();
    const adapter = new CronJobAdapter({ logger, shutdownDrainMs: DRAIN });
    const { handler } = slowHandler(DRAIN * 10);
    await adapter.schedule('long_job', { type: 'interval', intervalMs: TICK }, handler);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(handler).toHaveBeenCalledTimes(1);

    let destroyed = false;
    const destroying = adapter.destroy().then(() => { destroyed = true; });
    await vi.advanceTimersByTimeAsync(DRAIN - 1);
    expect(destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await destroying;
    expect(logger.warns.some((w) => w.includes('"long_job"') && w.includes(`${DRAIN} ms`))).toBe(true);
    await vi.advanceTimersByTimeAsync(DRAIN * 10);
  });
});
