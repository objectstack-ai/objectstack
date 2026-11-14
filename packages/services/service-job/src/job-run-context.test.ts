// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D7] A job handler is told which run it is executing:
 * `JobHandler`'s context carries `trigger` (`schedule` for a timer's fire,
 * `manual` for `trigger()`) and, where `DbJobAdapter` wrote one, the
 * `sys_job_run` id of the attempt (`runId`). A sync-in pull records both on
 * its run record (`sys_sync_run`).
 *
 * Pinned per adapter and per path, because each path is its own line:
 *
 *   - `IntervalJobAdapter`: a scheduled fire, and `trigger()`;
 *   - `CronJobAdapter`: a scheduled fire with no cluster lock, one under a
 *     held lock, and `trigger()`;
 *   - `DbJobAdapter`: the run id is the attempt's own `sys_job_run` row (a
 *     retried run hands each attempt its own), none is sent with
 *     `recordRuns: false`, and the inner adapter's trigger reaches the
 *     handler through the wrapper.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobHandler } from '@objectstack/spec/contracts';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { IntervalJobAdapter } from './interval-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';
import { DbJobAdapter } from './db-job-adapter.js';
import { NEVER_FIRES_SCHEDULE as CRON } from './never-fires.fixture.js';

type Ctx = Parameters<JobHandler>[0];

const TICK = 60_000;

/** A handler that keeps every context it was handed. */
function recording() {
  const seen: Ctx[] = [];
  const handler: JobHandler = async (ctx) => { seen.push(ctx); };
  return { seen, handler };
}

/**
 * The store `DbJobAdapter` writes `sys_job` / `sys_job_run` through: equality
 * filters only (a combinator is refused, not read as a field), the caller's
 * bound applied by presence, and `update` held to the engine's dispatch rule.
 */
function fakeEngine() {
  const tables = new Map<string, Array<Record<string, unknown>>>();
  return {
    tables,
    async find(table: string, opts: { where?: Record<string, unknown>; limit?: number } = {}) {
      const rows = (tables.get(table) ?? []).filter((r) =>
        Object.entries(opts.where ?? {}).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
          return r[k] === v;
        }));
      return typeof opts.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async insert(table: string, data: Record<string, unknown>) {
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, patch: Record<string, unknown>, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      const row = (tables.get(table) ?? []).find((r) => r.id === patch.id);
      if (row) Object.assign(row, patch);
      return row;
    },
  };
}

const adapters: Array<{ destroy(): Promise<void> }> = [];
afterEach(async () => {
  vi.useRealTimers();
  while (adapters.length) await adapters.pop()!.destroy();
});

describe('[ADR-0153 D7] IntervalJobAdapter tells the handler why the run started', () => {
  it('a scheduled fire is `schedule`', async () => {
    vi.useFakeTimers();
    const adapter = new IntervalJobAdapter();
    adapters.push(adapter);
    const r = recording();
    await adapter.schedule('tick', { type: 'interval', intervalMs: TICK }, r.handler);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(r.seen).toEqual([{ jobId: 'tick', data: undefined, trigger: 'schedule' }]);
  });

  it('`trigger()` is `manual`, beside its data', async () => {
    const adapter = new IntervalJobAdapter();
    adapters.push(adapter);
    const r = recording();
    await adapter.schedule('now', CRON, r.handler);

    await adapter.trigger('now', { key: 'val' });
    expect(r.seen).toEqual([{ jobId: 'now', data: { key: 'val' }, trigger: 'manual' }]);
  });
});

describe('[ADR-0153 D7] CronJobAdapter tells the handler why the run started', () => {
  it('a scheduled fire with no cluster lock is `schedule`', async () => {
    vi.useFakeTimers();
    const adapter = new CronJobAdapter();
    adapters.push(adapter);
    const r = recording();
    await adapter.schedule('tick', { type: 'interval', intervalMs: TICK }, r.handler);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(r.seen).toEqual([{ jobId: 'tick', data: undefined, trigger: 'schedule' }]);
  });

  it('a scheduled fire this node won the lock for is `schedule`', async () => {
    vi.useFakeTimers();
    const acquire = vi.fn(async () => ({ release: async () => {} }));
    const adapter = new CronJobAdapter({ cluster: { lock: { acquire } } });
    adapters.push(adapter);
    const r = recording();
    await adapter.schedule('tick', { type: 'interval', intervalMs: TICK }, r.handler);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(acquire, 'the fire went through the elected path').toHaveBeenCalledTimes(1);
    expect(r.seen).toEqual([{ jobId: 'tick', data: undefined, trigger: 'schedule' }]);
  });

  it('`trigger()` is `manual`, beside its data', async () => {
    const adapter = new CronJobAdapter();
    adapters.push(adapter);
    const r = recording();
    await adapter.schedule('now', CRON, r.handler);

    await adapter.trigger('now', { key: 'val' });
    expect(r.seen).toEqual([{ jobId: 'now', data: { key: 'val' }, trigger: 'manual' }]);
  });
});

describe('[ADR-0153 D7] DbJobAdapter hands the handler the sys_job_run row of the attempt', () => {
  const build = (options?: { recordRuns?: boolean }) => {
    const engine = fakeEngine();
    const adapter = new DbJobAdapter({ engine, options });
    adapters.push(adapter);
    return { engine, adapter };
  };
  const runRows = (engine: ReturnType<typeof fakeEngine>) => engine.tables.get('sys_job_run') ?? [];

  it('a manual run: the run id is the row the adapter wrote, and the trigger is `manual`', async () => {
    const { engine, adapter } = build();
    const r = recording();
    await adapter.schedule('pull', CRON, r.handler);

    await adapter.trigger('pull');
    const rows = runRows(engine);
    expect(rows).toHaveLength(1);
    expect(r.seen).toEqual([{ jobId: 'pull', data: undefined, trigger: 'manual', runId: rows[0].id }]);
  });

  it('a scheduled fire: the run id is that fire\'s row, and the trigger is `schedule`', async () => {
    vi.useFakeTimers();
    const { engine, adapter } = build();
    const r = recording();
    await adapter.schedule('pull', { type: 'interval', intervalMs: TICK }, r.handler);

    await vi.advanceTimersByTimeAsync(TICK);
    const rows = runRows(engine);
    expect(rows).toHaveLength(1);
    expect(r.seen).toEqual([{ jobId: 'pull', data: undefined, trigger: 'schedule', runId: rows[0].id }]);
  });

  it('a retried run hands each attempt its own row', async () => {
    const { engine, adapter } = build();
    const seen: Ctx[] = [];
    await adapter.schedule('pull', CRON, async (ctx) => {
      seen.push(ctx);
      if (seen.length === 1) throw new Error('first attempt fails');
    }, { retryPolicy: { maxRetries: 1, backoffMs: 1 } });

    await adapter.trigger('pull');
    const rows = runRows(engine);
    expect(rows.map((row) => row.attempt)).toEqual([1, 2]);
    expect(seen.map((ctx) => ctx.runId)).toEqual([rows[0].id, rows[1].id]);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('CONTROL: with recordRuns: false no row is written and no run id is sent; the trigger still is', async () => {
    const { engine, adapter } = build({ recordRuns: false });
    const r = recording();
    await adapter.schedule('pull', CRON, r.handler);

    await adapter.trigger('pull');
    expect(runRows(engine)).toHaveLength(0);
    expect(r.seen).toEqual([{ jobId: 'pull', data: undefined, trigger: 'manual' }]);
    expect('runId' in r.seen[0]).toBe(false);
  });
});
