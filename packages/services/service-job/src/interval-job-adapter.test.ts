// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { IntervalJobAdapter } from './interval-job-adapter';
import type { IJobService } from '@objectstack/spec/contracts';

describe('IntervalJobAdapter', () => {
  let adapter: IntervalJobAdapter;

  afterEach(async () => {
    await adapter?.destroy();
  });

  it('should implement IJobService contract', () => {
    adapter = new IntervalJobAdapter();
    const job: IJobService = adapter;
    expect(typeof job.schedule).toBe('function');
    expect(typeof job.cancel).toBe('function');
    expect(typeof job.trigger).toBe('function');
    expect(typeof job.getExecutions).toBe('function');
    expect(typeof job.listJobs).toBe('function');
  });

  it('should schedule and list jobs', async () => {
    adapter = new IntervalJobAdapter();
    await adapter.schedule('daily-report', { type: 'cron', expression: '0 0 * * *' }, async () => {});
    expect(await adapter.listJobs()).toEqual(['daily-report']);
  });

  it('should cancel a job', async () => {
    adapter = new IntervalJobAdapter();
    await adapter.schedule('temp-job', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.cancel('temp-job');
    expect(await adapter.listJobs()).toEqual([]);
  });

  it('should trigger a job handler with data', async () => {
    adapter = new IntervalJobAdapter();
    let triggered = false;
    let receivedCtx: any;

    await adapter.schedule('my-job', { type: 'cron', expression: '* * * * *' }, async (ctx) => {
      triggered = true;
      receivedCtx = ctx;
    });

    await adapter.trigger('my-job', { key: 'val' });
    expect(triggered).toBe(true);
    expect(receivedCtx.jobId).toBe('my-job');
    expect(receivedCtx.data).toEqual({ key: 'val' });
  });

  it('should throw when triggering non-existent job', async () => {
    adapter = new IntervalJobAdapter();
    await expect(adapter.trigger('missing')).rejects.toThrow('Job "missing" not found');
  });

  it('should record execution history', async () => {
    adapter = new IntervalJobAdapter();
    await adapter.schedule('tracked-job', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.trigger('tracked-job');

    const execs = await adapter.getExecutions('tracked-job');
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe('success');
    expect(execs[0].jobId).toBe('tracked-job');
    expect(execs[0].startedAt).toBeTruthy();
    expect(execs[0].completedAt).toBeTruthy();
    expect(typeof execs[0].durationMs).toBe('number');
  });

  it('should record failed executions', async () => {
    adapter = new IntervalJobAdapter();
    await adapter.schedule('fail-job', { type: 'cron', expression: '* * * * *' }, async () => {
      throw new Error('Job failed');
    });

    await adapter.trigger('fail-job');

    const execs = await adapter.getExecutions('fail-job');
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe('failed');
    expect(execs[0].error).toBe('Job failed');
  });

  it('should return empty executions for non-existent job', async () => {
    adapter = new IntervalJobAdapter();
    expect(await adapter.getExecutions('missing')).toEqual([]);
  });

  it('should limit execution history with limit param', async () => {
    adapter = new IntervalJobAdapter();
    await adapter.schedule('multi-job', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.trigger('multi-job');
    await adapter.trigger('multi-job');
    await adapter.trigger('multi-job');

    const execs = await adapter.getExecutions('multi-job', 2);
    expect(execs).toHaveLength(2);
  });

  it('should replace existing job with same name', async () => {
    adapter = new IntervalJobAdapter();
    let count = 0;
    await adapter.schedule('dup', { type: 'cron', expression: '* * * * *' }, async () => { count = 1; });
    await adapter.schedule('dup', { type: 'cron', expression: '* * * * *' }, async () => { count = 2; });

    await adapter.trigger('dup');
    expect(count).toBe(2);
    expect(await adapter.listJobs()).toEqual(['dup']);
  });

  it('should clean up all timers on destroy', async () => {
    adapter = new IntervalJobAdapter();
    await adapter.schedule('j1', { type: 'interval', intervalMs: 100000 }, async () => {});
    await adapter.schedule('j2', { type: 'interval', intervalMs: 100000 }, async () => {});
    await adapter.destroy();
    expect(await adapter.listJobs()).toEqual([]);
  });
});

describe('IntervalJobAdapter retryPolicy / timeout (#3494)', () => {
  let adapter: IntervalJobAdapter;
  afterEach(async () => { await adapter?.destroy(); });

  it('retries a failing handler per retryPolicy and succeeds', async () => {
    adapter = new IntervalJobAdapter();
    let calls = 0;
    await adapter.schedule(
      'flaky',
      { type: 'interval', intervalMs: 100000 },
      async () => {
        calls++;
        if (calls < 2) throw new Error('boom');
      },
      { retryPolicy: { maxRetries: 2, backoffMs: 1 } },
    );
    await adapter.trigger('flaky');
    expect(calls).toBe(2);
    const execs = await adapter.getExecutions('flaky');
    expect(execs).toHaveLength(1);
    expect(execs[0].status).toBe('success');
  });

  it('enforces a per-attempt timeout and records status "timeout"', async () => {
    adapter = new IntervalJobAdapter();
    await adapter.schedule(
      'slow',
      { type: 'interval', intervalMs: 100000 },
      async () => { await new Promise((r) => setTimeout(r, 150)); },
      { timeout: 25 },
    );
    await adapter.trigger('slow');
    const execs = await adapter.getExecutions('slow');
    expect(execs[0].status).toBe('timeout');
    expect(execs[0].error).toMatch(/timed out after 25ms/);
  });
});
