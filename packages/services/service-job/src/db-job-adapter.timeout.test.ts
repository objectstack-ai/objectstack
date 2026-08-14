// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DbJobAdapter } from './db-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';

/**
 * #7734 — a job that blows its `timeout` must say so in the DURABLE record.
 *
 * Every assertion here reads a `sys_job_run` / `sys_job` cell, never the
 * in-memory `JobExecution` history. That is the whole point of the card: the
 * in-memory "records status 'timeout'" assertion in `interval-job-adapter.test.ts`
 * stayed green throughout the defect, because the timeout was computed in a
 * place `sys_job_run` never reads. An operator reading the run log saw
 * `status: 'success'` with a `duration_ms` five times the declared `timeout`.
 */

function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  return {
    tables,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      let out = opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }))
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
    async update(table: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      const t = tables.get(table) ?? [];
      const r = t.find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not in ${table}`);
      Object.assign(r, patch);
      return r;
    },
  };
}

const CRON = { type: 'cron', expression: '* * * * *' } as const;
const TIMEOUT_MS = 20;
const HANDLER_MS = 300;

/** A handler that outlives its timeout, then resolves — the reported symptom. */
function slowHandler() {
  const state = { calls: 0, resolved: 0 };
  const handler = async () => {
    state.calls++;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { state.resolved++; resolve(); }, HANDLER_MS);
      (t as any)?.unref?.();
    });
  };
  return { state, handler };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as any)?.unref?.();
  });
}

describe('DbJobAdapter — a timed-out run is recorded as one (#7734)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let adapter: DbJobAdapter;

  beforeEach(() => {
    engine = makeFakeEngine();
    adapter = new DbJobAdapter({ engine });
  });
  afterEach(async () => { await adapter.destroy(); });

  const runRows = () => engine.tables.get('sys_job_run') ?? [];
  const jobRow = () => (engine.tables.get('sys_job') ?? [])[0];

  it('persists sys_job_run.status = "timeout", not "success"', async () => {
    const { handler } = slowHandler();
    await adapter.schedule('slow', CRON, handler, { timeout: TIMEOUT_MS });
    await adapter.trigger('slow');

    expect(runRows()).toHaveLength(1);
    // The cell an operator reads. Before #7734 this said 'success'.
    expect(runRows()[0].status).toBe('timeout');
    expect(runRows()[0].error).toMatch(/timed out after 20ms/);
    expect(runRows()[0].completed_at).toBeTruthy();
  });

  it('counts the timeout as a failure on sys_job', async () => {
    const { handler } = slowHandler();
    await adapter.schedule('slow', CRON, handler, { timeout: TIMEOUT_MS });
    await adapter.trigger('slow');

    expect(jobRow().last_status).toBe('timeout');
    expect(jobRow().last_error).toMatch(/timed out after 20ms/);
    // A run abandoned mid-flight is a failure — alerting keys on this count.
    expect(jobRow().failure_count).toBe(1);
    expect(jobRow().run_count).toBe(1);
  });

  it('records the ABANDONED duration, not how long the handler kept running', async () => {
    const { handler } = slowHandler();
    await adapter.schedule('slow', CRON, handler, { timeout: TIMEOUT_MS });
    await adapter.trigger('slow');

    // The symptom row carried duration_ms ≈ the handler's full runtime, which
    // is only possible if the recorder waited for the abandoned handler.
    expect(runRows()[0].duration_ms).toBeLessThan(HANDLER_MS);
  });

  // ── the overwrite race, head-on ──────────────────────────────────────────

  it('a handler that resolves AFTER the guard fired cannot overwrite the timeout row', async () => {
    const { state, handler } = slowHandler();
    await adapter.schedule('late', CRON, handler, { timeout: TIMEOUT_MS });
    await adapter.trigger('late');

    expect(runRows()[0].status).toBe('timeout');
    expect(state.resolved).toBe(0); // the handler is still running right now

    // Let the abandoned handler run to completion — this is the window in
    // which the old wrapper wrote `finishRun(runId, 'success')` over the row.
    await sleep(HANDLER_MS * 2);
    expect(state.resolved).toBe(1);

    expect(runRows()).toHaveLength(1);
    expect(runRows()[0].status).toBe('timeout');
    expect(jobRow().last_status).toBe('timeout');
    expect(jobRow().run_count).toBe(1);
    expect(jobRow().failure_count).toBe(1);
  });

  // ── attempt numbering ────────────────────────────────────────────────────

  it('a retried timeout persists attempt 2 on its second row', async () => {
    const { state, handler } = slowHandler();
    await adapter.schedule('retried', CRON, handler, {
      timeout: TIMEOUT_MS,
      retryPolicy: { maxRetries: 1, backoffMs: 1 },
    });
    await adapter.trigger('retried');

    expect(state.calls).toBe(2); // initial + one retry
    expect(runRows()).toHaveLength(2);
    // Every row used to read `attempt: 1` — the number was hardcoded.
    expect(runRows().map((r) => r.attempt)).toEqual([1, 2]);
    expect(runRows().map((r) => r.status)).toEqual(['timeout', 'timeout']);
    expect(jobRow().failure_count).toBe(2);
  });

  it('a retried FAILURE numbers its attempts too', async () => {
    let calls = 0;
    await adapter.schedule('flaky', CRON, async () => {
      calls++;
      if (calls < 3) throw new Error('boom');
    }, { retryPolicy: { maxRetries: 3, backoffMs: 1 } });
    await adapter.trigger('flaky');

    expect(runRows().map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect(runRows().map((r) => r.status)).toEqual(['failed', 'failed', 'success']);
  });

  // ── additivity ───────────────────────────────────────────────────────────

  it('a handler that finishes inside its timeout is unchanged: success, attempt 1', async () => {
    await adapter.schedule('quick', CRON, async () => {}, { timeout: 60_000 });
    await adapter.trigger('quick');

    expect(runRows()[0].status).toBe('success');
    expect(runRows()[0].attempt).toBe(1);
    expect(runRows()[0].error).toBeNull();
    expect(jobRow().last_status).toBe('success');
    expect(jobRow().failure_count).toBe(0);
  });

  it('the in-memory execution and the persisted row report the SAME verdict', async () => {
    const { handler } = slowHandler();
    await adapter.schedule('agree', CRON, handler, { timeout: TIMEOUT_MS });
    await adapter.trigger('agree');

    const [exec] = await adapter.getExecutions('agree');
    expect(exec.status).toBe('timeout');
    expect(runRows()[0].status).toBe('timeout');
    expect(await adapter.listExecutionsByStatus('timeout')).toHaveLength(1);
    expect(await adapter.listExecutionsByStatus('success')).toEqual([]);
  });

  it('replay of a timing-out job writes NO success row', async () => {
    const { handler } = slowHandler();
    await adapter.schedule('rp', CRON, handler, { timeout: TIMEOUT_MS });
    await adapter.replay('rp');

    // One synthetic `replay` row + one wrapped row, and they must agree.
    expect(runRows().map((r) => r.trigger).sort()).toEqual(['replay', 'schedule']);
    expect(runRows().map((r) => r.status)).toEqual(['timeout', 'timeout']);
  });
});

describe('the timeout policy still applies through an injected cron adapter (#7734)', () => {
  it('a cron-scheduled run lands a timeout row even though the adapter no longer sees the policy', async () => {
    // DbJobAdapter now runs `retryPolicy`/`timeout` itself and hands the timer
    // adapter a policy-free registration. If that stripping ever outran the
    // wrapper that replaces it, this run would record `success`.
    const engine = makeFakeEngine();
    const cron = new CronJobAdapter();
    const adapter = new DbJobAdapter({ engine, cron });
    const { handler } = slowHandler();

    await adapter.schedule('cronic', CRON, handler, { timeout: TIMEOUT_MS });
    await cron.trigger('cronic'); // fire the copy the cron adapter holds

    const runs = engine.tables.get('sys_job_run') ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('timeout');
    expect((engine.tables.get('sys_job') ?? [])[0].failure_count).toBe(1);
    expect((await cron.getExecutions('cronic'))[0].status).toBe('timeout');

    await adapter.destroy();
    await cron.destroy();
  });
});
