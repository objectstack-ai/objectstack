// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { Cron, scheduledJobs } from 'croner';
import { CronJobAdapter } from './cron-job-adapter.js';

describe('CronJobAdapter', () => {
  let adapter: CronJobAdapter;
  afterEach(async () => { await adapter?.destroy(); });

  it('schedules and triggers a cron job', async () => {
    adapter = new CronJobAdapter();
    let calls = 0;
    await adapter.schedule('daily', { type: 'cron', expression: '0 0 * * *' }, async () => { calls++; });
    expect(await adapter.listJobs()).toEqual(['daily']);

    await adapter.trigger('daily');
    expect(calls).toBe(1);
  });

  it('accepts per-job timezone', async () => {
    adapter = new CronJobAdapter({ timezone: 'UTC' });
    await adapter.schedule(
      'tz',
      { type: 'cron', expression: '0 9 * * *', timezone: 'America/New_York' },
      async () => {},
    );
    expect(await adapter.listJobs()).toEqual(['tz']);
  });

  it('throws on cron without expression', async () => {
    adapter = new CronJobAdapter();
    await expect(adapter.schedule('bad', { type: 'cron' } as any, async () => {})).rejects.toThrow(/missing expression/);
  });

  it('records executions', async () => {
    adapter = new CronJobAdapter();
    await adapter.schedule('tracked', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.trigger('tracked');
    const execs = await adapter.getExecutions('tracked');
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe('success');
  });

  it('cancels a job', async () => {
    adapter = new CronJobAdapter();
    await adapter.schedule('temp', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.cancel('temp');
    expect(await adapter.listJobs()).toEqual([]);
  });

  it('supports interval schedule via setInterval', async () => {
    adapter = new CronJobAdapter();
    await adapter.schedule('iv', { type: 'interval', intervalMs: 60_000 }, async () => {});
    expect(await adapter.listJobs()).toEqual(['iv']);
  });

  it('handles failures in cron handlers', async () => {
    adapter = new CronJobAdapter();
    await adapter.schedule('fail', { type: 'cron', expression: '* * * * *' }, async () => {
      throw new Error('boom');
    });
    await adapter.trigger('fail');
    const execs = await adapter.getExecutions('fail');
    expect(execs[0].status).toBe('failed');
    expect(execs[0].error).toBe('boom');
  });
});

describe('CronJobAdapter retryPolicy / timeout (#3494)', () => {
  let adapter: CronJobAdapter;
  afterEach(async () => { await adapter?.destroy(); });

  it('retries a failing handler per retryPolicy and succeeds', async () => {
    adapter = new CronJobAdapter();
    let calls = 0;
    await adapter.schedule(
      'flaky',
      { type: 'cron', expression: '* * * * *' },
      async () => {
        calls++;
        if (calls < 3) throw new Error(`attempt ${calls} boom`);
      },
      { retryPolicy: { maxRetries: 3, backoffMs: 1, backoffMultiplier: 1 } },
    );
    await adapter.trigger('flaky');
    expect(calls).toBe(3);
    const execs = await adapter.getExecutions('flaky');
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe('success');
  });

  it('exhausts retries and records the last failure', async () => {
    adapter = new CronJobAdapter();
    let calls = 0;
    await adapter.schedule(
      'doomed',
      { type: 'cron', expression: '* * * * *' },
      async () => { calls++; throw new Error('always boom'); },
      { retryPolicy: { maxRetries: 2, backoffMs: 1 } },
    );
    await adapter.trigger('doomed');
    expect(calls).toBe(3); // initial + 2 retries
    const execs = await adapter.getExecutions('doomed');
    expect(execs[0].status).toBe('failed');
    expect(execs[0].error).toBe('always boom');
  });

  it('does not retry when no retryPolicy is given (legacy behavior)', async () => {
    adapter = new CronJobAdapter();
    let calls = 0;
    await adapter.schedule('legacy', { type: 'cron', expression: '* * * * *' }, async () => {
      calls++;
      throw new Error('boom');
    });
    await adapter.trigger('legacy');
    expect(calls).toBe(1);
    const execs = await adapter.getExecutions('legacy');
    expect(execs[0].status).toBe('failed');
  });

  it('enforces a per-attempt timeout and records status "timeout"', async () => {
    adapter = new CronJobAdapter();
    await adapter.schedule(
      'slow',
      { type: 'cron', expression: '* * * * *' },
      async () => { await new Promise((r) => setTimeout(r, 150)); },
      { timeout: 25 },
    );
    await adapter.trigger('slow');
    const execs = await adapter.getExecutions('slow');
    expect(execs[0].status).toBe('timeout');
    expect(execs[0].error).toMatch(/timed out after 25ms/);
  });
});

// ─── #8362 — croner's PROCESS-GLOBAL named registry ─────────────────────────
//
// `new Cron(expr, { name }, fn)` pushes into a module-level array inside croner
// and throws `name already taken` when that name is live. That array is scoped
// to the PROCESS, not to this adapter, not to a kernel and not to an
// environment — so two adapter instances that are each perfectly consistent
// with themselves can still collide, and a stopped-but-never-destroyed instance
// keeps its names forever.
//
// Two live-fire consequences these cases pin, both reproduced on a real rig
// before the fix:
//   1. two environments in one container, same AI-generated flow name, NO
//      eviction involved — the second environment's automation never binds;
//   2. an evicted kernel whose cron adapter was never destroyed holds the name
//      forever, so every later rebind of that flow fails permanently.
//
// The pins deliberately go through the `cron` path: `interval` schedules use
// `setInterval` and never enter croner's named registry at all, so an
// interval-shaped fixture would pass on a completely unfixed tree.
describe('CronJobAdapter — process-global croner name registry (#8362)', () => {
  const live: CronJobAdapter[] = [];
  const make = (options?: ConstructorParameters<typeof CronJobAdapter>[0]) => {
    const a = new CronJobAdapter(options);
    live.push(a);
    return a;
  };
  afterEach(async () => {
    while (live.length) await live.pop()!.destroy();
  });

  /** Croner's process-global registry, narrowed to one PUBLIC job name. */
  const registeredFor = (jobName: string) =>
    scheduledJobs.filter((j) => (j.name ?? '').endsWith(jobName));

  const DAILY = { type: 'cron', expression: '0 8 * * *' } as const;

  it('lets two live adapters hold the SAME job name — two environments, one container', async () => {
    const NAME = 'flow-time-relative:contract_expiry_reminder_flow';
    const fired: string[] = [];

    const envA = make();
    await envA.schedule(NAME, DAILY, async () => { fired.push('A'); });
    // The FIRST bind must really have entered the named registry: a rebind pin
    // whose first bind registered nothing passes for the wrong reason.
    expect(registeredFor(NAME)).toHaveLength(1);

    const envB = make();
    await envB.schedule(NAME, DAILY, async () => { fired.push('B'); });

    expect(registeredFor(NAME)).toHaveLength(2);

    // Each environment's timer drives its OWN handler.
    for (const job of registeredFor(NAME)) await job.trigger();
    expect([...fired].sort()).toEqual(['A', 'B']);
  });

  it('frees the process-global name on destroy() — the job is STOPPED, not renamed around', async () => {
    const NAME = 'flow-schedule:nightly_rollup';
    const adapterA = make();
    await adapterA.schedule(NAME, DAILY, async () => {});

    const [job] = registeredFor(NAME);
    expect(job).toBeDefined();
    expect(job.isStopped()).toBe(false);

    await adapterA.destroy();

    expect(job.isStopped()).toBe(true);
    expect(registeredFor(NAME)).toHaveLength(0);
  });

  it('reclaims its registry name from a foreign holder instead of warning and giving up', async () => {
    const NAME = 'flow-schedule:reclaim_me';
    const adapterA = make();
    let calls = 0;

    // Somebody else already holds the exact name this adapter will register
    // under — the residual shape once per-instance namespacing rules out our
    // own collisions. Replace semantics: the holder is stopped, not tolerated.
    const squatter = new Cron(DAILY.expression, { name: adapterA.cronRegistryName(NAME) }, () => {});
    expect(registeredFor(NAME)).toHaveLength(1);

    await adapterA.schedule(NAME, DAILY, async () => { calls++; });

    expect(squatter.isStopped()).toBe(true);
    const held = registeredFor(NAME);
    expect(held).toHaveLength(1);
    await held[0].trigger();
    expect(calls).toBe(1);
  });
});
