// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { defineJob } from '@objectstack/spec/system';
import { InMemoryMetricsRegistry, OBSERVABILITY_METRICS_SERVICE, SEMCONV } from '@objectstack/observability';
import { CronJobAdapter } from '@objectstack/service-job';
import { AppPlugin } from './app-plugin.js';

/**
 * #4567 — declarative cron jobs must actually reach the scheduler.
 *
 * These run AppPlugin against the REAL `CronJobAdapter` (croner underneath),
 * not a recording double: the bug was that the authored schedule was rejected
 * *inside* the adapter and the throw was swallowed, so a double that records
 * whatever it is handed cannot see it.
 */
describe('AppPlugin — declarative background jobs (#4567)', () => {
    let adapter: CronJobAdapter;
    let metrics: InMemoryMetricsRegistry;
    let ctx: PluginContext;
    let readyHooks: Array<() => Promise<void>>;

    beforeEach(() => {
        adapter = new CronJobAdapter();
        metrics = new InMemoryMetricsRegistry();
        readyHooks = [];
        ctx = {
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn((name: string) => {
                if (name === 'job') return adapter;
                if (name === OBSERVABILITY_METRICS_SERVICE) return metrics;
                if (name === 'objectql') return {};
                return undefined;
            }),
            getServices: vi.fn(() => []),
            hook: vi.fn((event: string, cb: () => Promise<void>) => {
                if (event === 'kernel:ready') readyHooks.push(cb);
            }),
            trigger: vi.fn(),
        } as unknown as PluginContext;
    });

    afterEach(async () => {
        await adapter.destroy();
    });

    const fireReady = async () => {
        for (const cb of readyHooks) await cb();
    };

    const errorLogs = () => vi.mocked(ctx.logger.error).mock.calls.map(c => String(c[0]));
    const warnLogs = () => vi.mocked(ctx.logger.warn).mock.calls.map(c => String(c[0]));

    it('schedules a defineJob cron job end-to-end — the adapter holds a live cron task', async () => {
        const sweep = vi.fn(async () => { /* handler body */ });
        const job = defineJob({
            name: 'health_sweep',
            schedule: { type: 'cron', expression: '0 1 * * *' },
            handler: 'sweep',
        });
        const plugin = new AppPlugin({
            id: 'com.test.jobs',
            jobs: [job],
            functions: { sweep },
        });

        await plugin.start!(ctx);
        await fireReady();

        // Scheduler state, not merely "did not throw": the adapter only records
        // a job after `new Cron(...)` succeeded.
        expect(await adapter.listJobs()).toContain('health_sweep');
        const task = (adapter as unknown as { jobs: Map<string, { task?: { nextRun(): Date | null } }> })
            .jobs.get('health_sweep')?.task;
        const next = task?.nextRun();
        expect(next).toBeInstanceOf(Date);
        // '0 1 * * *' with the schema-defaulted UTC timezone.
        expect(next!.getUTCHours()).toBe(1);
        expect(next!.getUTCMinutes()).toBe(0);

        // And the registered task really runs the bundle handler.
        await adapter.trigger('health_sweep');
        expect(sweep).toHaveBeenCalledTimes(1);

        expect(errorLogs()).toEqual([]);
        expect(metrics.totalCounter(SEMCONV.jobScheduleFailuresTotal)).toBe(0);
    });

    it('REVERT-PROOF: the raw authored schedule still breaks the adapter, exactly as #4567 reported', async () => {
        const job = defineJob({
            name: 'health_sweep',
            schedule: { type: 'cron', expression: '0 1 * * *' },
            handler: 'sweep',
        });

        // What AppPlugin used to pass verbatim. The adapter's contract is a bare
        // string and it stays strict — remove the downgrade in AppPlugin and the
        // end-to-end test above fails with precisely this croner error.
        await expect(
            adapter.schedule('health_sweep', job.schedule as never, async () => { /* noop */ }),
        ).rejects.toThrow(/Pattern has to be of type string/i);
        expect(await adapter.listJobs()).not.toContain('health_sweep');
    });

    it('interval jobs keep working (no envelope on that branch)', async () => {
        const plugin = new AppPlugin({
            id: 'com.test.jobs',
            jobs: [defineJob({ name: 'ping', schedule: { type: 'interval', intervalMs: 60_000 }, handler: 'h' })],
            functions: { h: vi.fn(async () => { /* noop */ }) },
        });

        await plugin.start!(ctx);
        await fireReady();

        expect(await adapter.listJobs()).toContain('ping');
        expect(errorLogs()).toEqual([]);
    });

    it('a job that cannot be scheduled logs ERROR (not a silent warn) and counts', async () => {
        const plugin = new AppPlugin({
            id: 'com.test.jobs',
            jobs: [{
                name: 'bad_job',
                // A CEL envelope where a cron one belongs — unusable at the boundary.
                schedule: { type: 'cron', expression: { dialect: 'cel', source: 'now()' } },
                handler: 'h',
                enabled: true,
            }],
            functions: { h: vi.fn(async () => { /* noop */ }) },
        });

        await plugin.start!(ctx);
        await fireReady();

        expect(await adapter.listJobs()).not.toContain('bad_job');

        // Loud: error level, its own distinct message, and a counter.
        const errors = errorLogs();
        expect(errors.some(m => m.includes('FAILED TO SCHEDULE'))).toBe(true);
        expect(errors.some(m => m.includes('declared but NOT scheduled'))).toBe(true);
        expect(vi.mocked(ctx.logger.error).mock.calls[0][2]).toMatchObject({ job: 'bad_job' });
        expect(metrics.totalCounter(SEMCONV.jobScheduleFailuresTotal, { job: 'bad_job' })).toBe(1);

        // NOT folded into the warn stream that "handler missing"/"disabled" use.
        expect(warnLogs().some(m => /schedule/i.test(m))).toBe(false);
    });

    it('a missing handler stays a warn — the two failures are not one signal', async () => {
        const plugin = new AppPlugin({
            id: 'com.test.jobs',
            jobs: [defineJob({ name: 'orphan', schedule: { type: 'cron', expression: '0 1 * * *' }, handler: 'nope' })],
            functions: {},
        });

        await plugin.start!(ctx);
        await fireReady();

        expect(warnLogs().some(m => m.includes('job handler not found'))).toBe(true);
        expect(errorLogs()).toEqual([]);
        expect(metrics.totalCounter(SEMCONV.jobScheduleFailuresTotal)).toBe(0);
    });
});
