// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { JobRunOutcome } from '@objectstack/spec/contracts';
import { DbJobAdapter } from './db-job-adapter.js';
import { IntervalJobAdapter } from './interval-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';

/**
 * #5548 — the job audit surface stops recording "the handler did not throw" as
 * `sys_job_run.status: 'success'`.
 *
 * The consuming half of the 2026-08-08 B-minimal ruling: #6617 gave
 * {@link JobHandler} a `JobRunOutcome` return channel and #7072 widened the
 * status vocabulary (`JobExecutionStatus` + both `Field.select`s) with
 * `degraded`; here the adapters finally read the resolved value.
 *
 * **What these cases assert is the value that lands in the row** — the
 * `sys_job_run` / `sys_job` cell itself, never "the handler was called" or "it
 * did not throw". The defect being fixed IS "did not throw was read as
 * success", so a test written on that criterion would reproduce it.
 */

function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  return {
    tables,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      let out = opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => r[k] === v))
        : [...t];
      if (opts.limit) out = out.slice(0, opts.limit);
      return out;
    },
    async insert(table: string, data: any) {
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, patch: any) {
      const t = tables.get(table) ?? [];
      const r = t.find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not in ${table}`);
      Object.assign(r, patch);
      return r;
    },
  };
}

const CRON = { type: 'cron', expression: '* * * * *' } as const;

describe('DbJobAdapter — the three-outcome handler table (#5548)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let adapter: DbJobAdapter;

  beforeEach(() => {
    engine = makeFakeEngine();
    adapter = new DbJobAdapter({ engine });
  });
  afterEach(async () => { await adapter.destroy(); });

  const runRows = () => engine.tables.get('sys_job_run') ?? [];
  const jobRow = () => (engine.tables.get('sys_job') ?? [])[0];

  it('a handler resolving `degraded` lands sys_job_run.status = "degraded", with the reason in `error`', async () => {
    await adapter.schedule('wake', CRON, async (): Promise<JobRunOutcome> => ({
      outcome: 'degraded',
      reason: 'STORE_UNAVAILABLE',
    }));
    await adapter.trigger('wake');

    expect(runRows()).toHaveLength(1);
    // The cell itself — this is the defect's coordinate.
    expect(runRows()[0].status).toBe('degraded');
    expect(runRows()[0].error).toBe('STORE_UNAVAILABLE');
    expect(runRows()[0].job_name).toBe('wake');
    expect(typeof runRows()[0].duration_ms).toBe('number');
  });

  it('a degraded run mirrors onto sys_job.last_status and leaves failure_count flat', async () => {
    await adapter.schedule('wake', CRON, async (): Promise<JobRunOutcome> => ({
      outcome: 'degraded',
      reason: 'STORE_UNAVAILABLE',
    }));
    await adapter.trigger('wake');

    // `degraded` is NOT a failure (spec/contracts/job-service.ts): the summary
    // row says the last shot missed, and the failure signal does not move.
    expect(jobRow().last_status).toBe('degraded');
    expect(jobRow().last_error).toBe('STORE_UNAVAILABLE');
    expect(jobRow().failure_count).toBe(0);
    expect(jobRow().run_count).toBe(1);
    expect(jobRow().active).toBe(true);
  });

  it('a degraded outcome without a reason writes a null `error`, not the string "undefined"', async () => {
    await adapter.schedule('bare', CRON, async (): Promise<JobRunOutcome> => ({ outcome: 'degraded' }));
    await adapter.trigger('bare');

    expect(runRows()[0].status).toBe('degraded');
    expect(runRows()[0].error).toBeNull();
    expect(jobRow().last_error).toBeNull();
  });

  // ── additivity: the reverse evidence the ruling's 可加性 clause demands ────

  it('ADDITIVITY: a pre-#6617 handler resolving `undefined` is still recorded as "success"', async () => {
    // The whole compatibility promise of the ruling, pinned on the exact shape
    // every handler written before the outcome channel has: `Promise<void>`.
    await adapter.schedule('legacy', CRON, async () => {});
    await adapter.trigger('legacy');

    expect(runRows()[0].status).toBe('success');
    expect(runRows()[0].error).toBeNull();
    expect(jobRow().last_status).toBe('success');
    expect(jobRow().last_error).toBeNull();
    expect(jobRow().failure_count).toBe(0);
  });

  it('an explicit `{ outcome: "completed" }` is recorded as "success" — same as resolving undefined', async () => {
    await adapter.schedule('explicit', CRON, async (): Promise<JobRunOutcome> => ({ outcome: 'completed' }));
    await adapter.trigger('explicit');

    expect(runRows()[0].status).toBe('success');
    expect(runRows()[0].error).toBeNull();
    expect(jobRow().last_status).toBe('success');
  });

  it('a throwing handler is unchanged: "failed", the message in `error`, failure_count +1', async () => {
    await adapter.schedule('boom', CRON, async () => { throw new Error('oops'); });
    await adapter.trigger('boom');

    expect(runRows()[0].status).toBe('failed');
    expect(runRows()[0].error).toBe('oops');
    expect(jobRow().last_status).toBe('failed');
    expect(jobRow().failure_count).toBe(1);
  });

  // ── degraded is not a retry signal ───────────────────────────────────────

  it('a degraded run does NOT retry, even under a retry policy that retries twice', async () => {
    let calls = 0;
    await adapter.schedule(
      'norerun',
      CRON,
      async (): Promise<JobRunOutcome> => { calls++; return { outcome: 'degraded', reason: 'nothing to do' }; },
      { retryPolicy: { maxRetries: 2, backoffMs: 1 } },
    );
    await adapter.trigger('norerun');

    // Retry keys on a REJECTED promise only; a resolved outcome — whatever it
    // says — returns on the first attempt.
    expect(calls).toBe(1);
    expect(runRows()).toHaveLength(1);
    expect(runRows()[0].status).toBe('degraded');
  });

  // ── the rest of the audit surface agrees with the row ────────────────────

  it('listExecutionsByStatus("degraded") finds the run, and "success" does not', async () => {
    await adapter.schedule('wake', CRON, async (): Promise<JobRunOutcome> => ({
      outcome: 'degraded',
      reason: 'STORE_UNAVAILABLE',
    }));
    await adapter.trigger('wake');

    const degraded = await adapter.listExecutionsByStatus('degraded');
    expect(degraded.map((r) => r.jobId)).toEqual(['wake']);
    expect(degraded[0].error).toBe('STORE_UNAVAILABLE');
    expect(await adapter.listExecutionsByStatus('success')).toEqual([]);
  });

  it('getExecutions() reports the same verdict as the persisted row', async () => {
    // `DbJobAdapter.getExecutions` delegates to the inner adapter's in-memory
    // history. Left unmapped, the two faces of ONE run would disagree.
    await adapter.schedule('wake', CRON, async (): Promise<JobRunOutcome> => ({
      outcome: 'degraded',
      reason: 'STORE_UNAVAILABLE',
    }));
    await adapter.trigger('wake');

    const execs = await adapter.getExecutions('wake');
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe('degraded');
    expect(execs[0].error).toBe('STORE_UNAVAILABLE');
    expect(runRows()[0].status).toBe('degraded');
  });

  it('replay of a degraded job writes BOTH rows as degraded — no success row alongside', async () => {
    await adapter.schedule('wake', CRON, async (): Promise<JobRunOutcome> => ({
      outcome: 'degraded',
      reason: 'STORE_UNAVAILABLE',
    }));
    await adapter.replay('wake');

    // One synthetic `replay` row + one wrapped row, and they must agree.
    expect(runRows().map((r) => r.trigger).sort()).toEqual(['replay', 'schedule']);
    expect(runRows().map((r) => r.status)).toEqual(['degraded', 'degraded']);
    expect(runRows().map((r) => r.error)).toEqual(['STORE_UNAVAILABLE', 'STORE_UNAVAILABLE']);
  });

  it('replay of an ordinary job still writes success rows (the replay path stays additive too)', async () => {
    await adapter.schedule('plain', CRON, async () => {});
    await adapter.replay('plain');

    expect(runRows().map((r) => r.status)).toEqual(['success', 'success']);
  });
});

describe('the timer adapters record the same third state (#5548)', () => {
  it('IntervalJobAdapter.getExecutions maps a degraded outcome, not "success"', async () => {
    const adapter = new IntervalJobAdapter();
    await adapter.schedule('i', { type: 'interval', intervalMs: 60_000 }, async (): Promise<JobRunOutcome> => ({
      outcome: 'degraded',
      reason: '0 rows matched',
    }));
    await adapter.trigger('i');

    const [exec] = await adapter.getExecutions('i');
    expect(exec.status).toBe('degraded');
    expect(exec.error).toBe('0 rows matched');

    await adapter.schedule('ok', { type: 'interval', intervalMs: 60_000 }, async () => {});
    await adapter.trigger('ok');
    expect((await adapter.getExecutions('ok'))[0].status).toBe('success');
    await adapter.destroy();
  });

  it('CronJobAdapter.getExecutions maps a degraded outcome, not "success"', async () => {
    const adapter = new CronJobAdapter();
    await adapter.schedule('c', CRON, async (): Promise<JobRunOutcome> => ({
      outcome: 'degraded',
      reason: '0 rows matched',
    }));
    await adapter.trigger('c');

    const [exec] = await adapter.getExecutions('c');
    expect(exec.status).toBe('degraded');
    expect(exec.error).toBe('0 rows matched');

    await adapter.schedule('cok', CRON, async () => {});
    await adapter.trigger('cok');
    expect((await adapter.getExecutions('cok'))[0].status).toBe('success');
    await adapter.destroy();
  });
});
