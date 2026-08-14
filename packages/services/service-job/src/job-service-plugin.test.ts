// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression: the placeholder→DbJobAdapter upgrade must not strand
 * early registrations.
 *
 * Business plugins `start()` before `kernel:ready`, so every job they register
 * lands on the placeholder IntervalJobAdapter. Before this fix:
 *   1. the placeholder silently ignored `cron` schedules (no timer, no error);
 *   2. the upgrade swapped the service via `replaceService` WITHOUT migrating
 *      the already-registered jobs — cron entries were lost for good;
 *   3. the placeholder's interval timers kept running on the orphaned adapter
 *      (which is why interval jobs appeared healthy while cron jobs never
 *      fired, and none of them showed up in sys_job).
 */

import { describe, it, expect, vi } from 'vitest';
import { JobServicePlugin } from './job-service-plugin.js';

function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  return {
    tables,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      return opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }))
        : [...t];
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

function makeFakeContext(opts: { engine?: any } = {}) {
  const services = new Map<string, any>();
  const hooks = new Map<string, Array<() => Promise<void> | void>>();
  if (opts.engine) services.set('objectql', opts.engine);
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const ctx = {
    logger,
    registerService: (name: string, impl: any) => { services.set(name, impl); },
    replaceService: (name: string, impl: any) => { services.set(name, impl); },
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`service "${name}" not registered`);
      return services.get(name);
    },
    hook: (event: string, cb: () => Promise<void> | void) => {
      const list = hooks.get(event) ?? [];
      list.push(cb);
      hooks.set(event, list);
    },
    async fire(event: string) {
      for (const cb of hooks.get(event) ?? []) await cb();
    },
    services,
  };
  return ctx;
}

describe('JobServicePlugin placeholder→DbJobAdapter upgrade', () => {
  it('migrates jobs registered before kernel:ready onto the DbJobAdapter', async () => {
    const engine = makeFakeEngine();
    const ctx = makeFakeContext({ engine });
    const plugin = new JobServicePlugin();
    await plugin.init(ctx as any);

    // Simulate a business plugin registering during its start(): the service
    // resolved here is the placeholder IntervalJobAdapter.
    const placeholder = ctx.getService('job');
    const cronRuns: string[] = [];
    await placeholder.schedule(
      'nightly-report',
      { type: 'cron', expression: '0 0 * * *' },
      async () => { cronRuns.push('ran'); },
    );
    await placeholder.schedule(
      'heartbeat',
      { type: 'interval', intervalMs: 60_000 },
      async () => {},
    );

    await ctx.fire('kernel:ready');

    // Service was swapped…
    const upgraded = ctx.getService('job');
    expect(upgraded).not.toBe(placeholder);
    // …and BOTH early registrations followed it (the cron one used to vanish).
    expect((await upgraded.listJobs()).sort()).toEqual(['heartbeat', 'nightly-report']);
    // The cron job is now persisted where operators can see it.
    const sysJobs = engine.tables.get('sys_job') ?? [];
    expect(sysJobs.map((r: any) => r.name).sort()).toEqual(['heartbeat', 'nightly-report']);
    // The orphaned placeholder no longer owns any jobs (its timers are stopped).
    expect(await placeholder.listJobs()).toEqual([]);
    // The migrated cron handler still works when triggered through the new adapter.
    await upgraded.trigger('nightly-report');
    expect(cronRuns).toEqual(['ran']);

    await plugin.destroy();
  });

  it('warns loudly when cron jobs stay stranded on the interval adapter (no engine)', async () => {
    const ctx = makeFakeContext();
    const plugin = new JobServicePlugin();
    await plugin.init(ctx as any);

    const job = ctx.getService('job');
    await job.schedule('never-runs', { type: 'cron', expression: '*/5 * * * *' }, async () => {});

    // Registration itself already warned (the per-schedule diagnostic).
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('never-runs'));

    await ctx.fire('kernel:ready');

    // And the no-upgrade path summarizes the stranded cron jobs.
    const warned = ctx.logger.warn.mock.calls.some(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('will NOT run') && c[0].includes('never-runs'),
    );
    expect(warned).toBe(true);

    await plugin.destroy();
  });
});
