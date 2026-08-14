// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scheduledJobs } from 'croner';
import { DbJobAdapter } from './db-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';

function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  return {
    tables,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      let out = opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }))
        : [...t];
      if (opts.orderBy) {
        for (const ord of [...opts.orderBy].reverse()) {
          // Canonical SortNode key only (spec/data/query.zod.ts): the real
          // engine strips an unknown `direction:` key and defaults to asc,
          // so the mock must too — honoring both keys masks wrong-key sorts.
          out.sort((a, b) => {
            const av = a[ord.field], bv = b[ord.field];
            if (av === bv) return 0;
            const cmp = av > bv ? 1 : -1;
            return ord.order === 'desc' ? -cmp : cmp;
          });
        }
      }
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

describe('DbJobAdapter', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let adapter: DbJobAdapter;

  beforeEach(() => {
    engine = makeFakeEngine();
    adapter = new DbJobAdapter({ engine });
  });
  afterEach(async () => { await adapter.destroy(); });

  it('upserts sys_job on schedule', async () => {
    await adapter.schedule('cleanup', { type: 'cron', expression: '0 0 * * *' }, async () => {});
    const rows = engine.tables.get('sys_job') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'cleanup',
      schedule_type: 'cron',
      schedule_expression: '0 0 * * *',
      active: true,
    });
  });

  it('updates existing sys_job on re-schedule', async () => {
    await adapter.schedule('daily', { type: 'cron', expression: '0 0 * * *' }, async () => {});
    await adapter.schedule('daily', { type: 'cron', expression: '*/15 * * * *' }, async () => {});
    const rows = engine.tables.get('sys_job') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule_expression).toBe('*/15 * * * *');
  });

  it('records sys_job_run on successful trigger', async () => {
    await adapter.schedule('ok', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.trigger('ok');
    const runs = engine.tables.get('sys_job_run') ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(runs[0].job_name).toBe('ok');
    expect(typeof runs[0].duration_ms).toBe('number');
  });

  it('records sys_job_run on failure and bumps failure_count', async () => {
    await adapter.schedule('bad', { type: 'cron', expression: '* * * * *' }, async () => {
      throw new Error('oops');
    });
    await adapter.trigger('bad');
    const runs = engine.tables.get('sys_job_run') ?? [];
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error).toBe('oops');
    const job = (engine.tables.get('sys_job') ?? [])[0];
    expect(job.last_status).toBe('failed');
    expect(job.failure_count).toBe(1);
    expect(job.run_count).toBe(1);
  });

  it('cancel marks sys_job inactive', async () => {
    await adapter.schedule('temp', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.cancel('temp');
    const row = (engine.tables.get('sys_job') ?? [])[0];
    expect(row.active).toBe(false);
  });

  it('listExecutionsByStatus filters from DB', async () => {
    await adapter.schedule('mix', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.trigger('mix');
    await adapter.schedule('bad', { type: 'cron', expression: '* * * * *' }, async () => {
      throw new Error('x');
    });
    await adapter.trigger('bad');

    const failed = await adapter.listExecutionsByStatus('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].jobId).toBe('bad');
    const ok = await adapter.listExecutionsByStatus('success');
    expect(ok).toHaveLength(1);
    expect(ok[0].jobId).toBe('mix');
  });

  it('listExecutionsByStatus returns the newest run first', async () => {
    // Regression: the query sorted with the non-canonical `direction: 'desc'`
    // key, which SortNode strips — so "latest run" returned the OLDEST run.
    engine.tables.set('sys_job_run', [
      { id: '1', job_name: 'first', status: 'success', started_at: '2026-01-01T00:00:00Z' },
      { id: '2', job_name: 'third', status: 'success', started_at: '2026-03-01T00:00:00Z' },
      { id: '3', job_name: 'second', status: 'success', started_at: '2026-02-01T00:00:00Z' },
    ]);
    const runs = await adapter.listExecutionsByStatus('success');
    expect(runs.map((r) => r.jobId)).toEqual(['third', 'second', 'first']);
  });

  it('replay tags a synthetic run as replay trigger', async () => {
    await adapter.schedule('rj', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.replay('rj');
    const runs = engine.tables.get('sys_job_run') ?? [];
    // One synthetic replay run + one wrapped success run from inner trigger
    const triggers = runs.map((r) => r.trigger).sort();
    expect(triggers).toEqual(['replay', 'schedule']);
  });
});

// ─── #8362 — the destroy chain, and what an evicted kernel leaves behind ─────
//
// Kernel eviction is ROUTINE in the cloud runtime: a freshness probe runs every
// few seconds and every auto-publish bumps freshness, so the eviction chain
// `KernelManager.evict() -> kernel.shutdown() -> plugin.destroy() ->
// JobServicePlugin.destroy() -> dbAdapter.destroy()` runs constantly. It used
// to stop one level short — `destroy()` destroyed `inner` and never `cron` — so
// every evicted kernel left its croner timers running and holding their
// PROCESS-GLOBAL names, and the rebuilt kernel could never re-bind that flow
// again. The only signal was one WARN.
//
// Why the ordering of the two fixes matters, pinned by the second case below:
// the leaked job is not merely holding a name, it is still ALIVE with a closure
// over the shut-down kernel's engine. Namespacing the names WITHOUT closing the
// destroy chain would therefore convert a silent death into a zombie
// double-write — two live jobs, one driving a dead kernel. Hence the assertion
// is `oldJob.isStopped()`, not "a new job exists somewhere".
describe('DbJobAdapter — kernel rebuild (#8362)', () => {
  /** Croner's process-global registry, narrowed to one PUBLIC job name. */
  const registeredFor = (jobName: string) =>
    scheduledJobs.filter((j) => (j.name ?? '').endsWith(jobName));

  const DAILY = { type: 'cron', expression: '0 8 * * *' } as const;

  /** One kernel's job-service wiring: the pair JobServicePlugin builds. */
  function kernel() {
    const cron = new CronJobAdapter();
    return { cron, db: new DbJobAdapter({ engine: makeFakeEngine(), cron }) };
  }

  it('destroy() destroys the CRON adapter too, freeing the process-global name', async () => {
    const NAME = 'flow-time-relative:xqao_contract_expiry_reminder_flow';
    const k = kernel();
    await k.db.schedule(NAME, DAILY, async () => {});

    const [job] = registeredFor(NAME);
    expect(job, 'the first bind must register a REAL croner named job').toBeDefined();
    expect(job.isStopped()).toBe(false);

    // Exactly what the eviction chain reaches, one call short of which was the
    // whole defect.
    await k.db.destroy();

    expect(job.isStopped()).toBe(true);
    expect(registeredFor(NAME)).toHaveLength(0);
  });

  it('a rebuilt kernel re-binds the same flow: scheduled exactly once, and it fires', async () => {
    const NAME = 'flow-time-relative:xqao_contract_expiry_reminder_flow';
    const fired: string[] = [];

    const old = kernel();
    await old.db.schedule(NAME, DAILY, async () => { fired.push('old-kernel'); });
    // Assert the FIRST bind landed before asserting anything about the second.
    expect(registeredFor(NAME)).toHaveLength(1);
    const oldJob = registeredFor(NAME)[0];

    await old.db.destroy(); // kernel evicted by the freshness probe

    const rebuilt = kernel();
    await rebuilt.db.schedule(NAME, DAILY, async () => { fired.push('new-kernel'); });

    const held = registeredFor(NAME);
    expect(held).toHaveLength(1); // exactly once — not one live + one zombie
    expect(oldJob.isStopped()).toBe(true); // the old job is STOPPED, not merely renamed around

    await held[0].trigger();
    expect(fired).toEqual(['new-kernel']); // the dead kernel's closure never runs

    await rebuilt.db.destroy();
  });
});
