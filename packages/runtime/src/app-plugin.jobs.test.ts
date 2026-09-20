// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { defineJob } from '@objectstack/spec/system';
import { InMemoryMetricsRegistry, OBSERVABILITY_METRICS_SERVICE, SEMCONV } from '@objectstack/observability';
import { CronJobAdapter } from '@objectstack/service-job';
import { AppPlugin } from './app-plugin.js';
import { withScheduledWorkOn } from './scheduled-work.test-support.js';

/**
 * #4567 — declarative cron jobs must actually reach the scheduler.
 *
 * These run AppPlugin against the REAL `CronJobAdapter` (croner underneath),
 * not a recording double: the bug was that the authored schedule was rejected
 * *inside* the adapter and the throw was swallowed, so a double that records
 * whatever it is handed cannot see it.
 */
// [#17396] `AppPlugin` schedules package-authored jobs only where the
// deployment runs package-authored scheduled work, and that switch is OFF by
// default in every posture. These suites measure the READER, not the
// deployment, so without this line every assertion below fails for a reason
// that has nothing to do with its subject.
withScheduledWorkOn();

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

    // ── [#17396 · ruled Q3] the deployment switch ───────────────────────
    //
    // Package-authored `defineJob` cron jobs fall under the SAME deployment
    // switch as time-triggered flows: one switch for all package-authored
    // scheduled work, because the resource risk is the same and a second switch
    // would be a special case. The boundary is *authored by a package*, ⛔ NOT
    // *runs on the job service* — platform-internal jobs (approvals escalation,
    // the lifecycle Reaper, the messaging dispatch loop, membership backfill)
    // schedule themselves from their own service plugins and never reach this
    // loop, so they are outside it by construction rather than by an exemption
    // this file could weaken.
    describe('the deployment switch is OFF (#17396)', () => {
        const OFF = { ...process.env };
        beforeEach(() => { delete process.env.OS_AUTOMATION_SCHEDULED_WORK_ENABLED; });
        afterEach(() => {
            if (OFF.OS_AUTOMATION_SCHEDULED_WORK_ENABLED === undefined) {
                delete process.env.OS_AUTOMATION_SCHEDULED_WORK_ENABLED;
            } else {
                process.env.OS_AUTOMATION_SCHEDULED_WORK_ENABLED = OFF.OS_AUTOMATION_SCHEDULED_WORK_ENABLED;
            }
        });

        it('schedules NOTHING — a perfectly well-formed packaged job simply does not run here', async () => {
            const sweep = vi.fn(async () => { /* handler body */ });
            const plugin = new AppPlugin({
                id: 'com.test.jobs',
                jobs: [defineJob({
                    name: 'health_sweep',
                    schedule: { type: 'cron', expression: '0 1 * * *' },
                    handler: 'sweep',
                })],
                functions: { sweep },
            });

            await plugin.start!(ctx);
            await fireReady();

            // Scheduler state, like the end-to-end case above: nothing was
            // handed to the adapter at all.
            expect(await adapter.listJobs()).toEqual([]);
            expect(sweep, 'and nothing ran').not.toHaveBeenCalled();
        });

        it('says so ONCE per app, at `info`, with the count — and ⛔ not at `warn` or `error`', async () => {
            const plugin = new AppPlugin({
                id: 'com.test.jobs',
                jobs: [
                    defineJob({ name: 'a', schedule: { type: 'cron', expression: '0 1 * * *' }, handler: 'sweep' }),
                    defineJob({ name: 'b', schedule: { type: 'cron', expression: '0 2 * * *' }, handler: 'sweep' }),
                ],
                functions: { sweep: vi.fn(async () => { /* noop */ }) },
            });

            await plugin.start!(ctx);
            await fireReady();

            const infos = vi.mocked(ctx.logger.info).mock.calls;
            const said = infos.filter((c) => String(c[0]).includes('declarative jobs NOT scheduled'));
            expect(
                said.length,
                'the remedy is ONE variable — repeating it per job is how a line stops being read',
            ).toBe(1);
            expect(String(said[0][0])).toContain('OS_AUTOMATION_SCHEDULED_WORK_ENABLED');
            expect(String(said[0][0]), 'and it must say this is policy, not a defect').toContain('deployment policy');
            expect(
                (said[0][1] as { jobCount?: number } | undefined)?.jobCount,
                'the count is what tells an operator how much is not running',
            ).toBe(2);

            // ⛔ The DEFAULT configuration of every deployment must not print a
            // warning or an error ABOUT ITS JOBS. Nothing is wrong: the
            // deployment declared this state and the operator can see it in
            // `os doctor`.
            //
            // ⚠️ Scoped to job/schedule lines rather than asserting an empty
            // `warnLogs()`. This harness's `ctx` has no `ql.bindHooks`, so it
            // always warns once about declarative hooks — a line this suite
            // does not own and must not start owning. A bare `toEqual([])`
            // here would be an assertion about the fixture, and it would go red
            // the day an unrelated warn is added.
            const jobNoise = (lines: string[]) =>
                lines.filter((m) => /job|schedule/i.test(m));
            expect(jobNoise(warnLogs())).toEqual([]);
            expect(jobNoise(errorLogs())).toEqual([]);
            expect(metrics.totalCounter(SEMCONV.jobScheduleFailuresTotal)).toBe(0);
        });

        it('returns BEFORE the job service is probed — the missing-service warn is a different state', async () => {
            // Otherwise a deployment that simply has not switched scheduled work
            // on is told its job service is not registered, which is a composition
            // defect with a composition remedy, and neither is true here.
            const ctxNoJobService = {
                ...ctx,
                getService: vi.fn((name: string) => (name === 'job' ? undefined : undefined)),
            } as unknown as PluginContext;
            const plugin = new AppPlugin({
                id: 'com.test.jobs',
                jobs: [defineJob({ name: 'a', schedule: { type: 'cron', expression: '0 1 * * *' }, handler: 'sweep' })],
                functions: { sweep: vi.fn(async () => { /* noop */ }) },
            });

            await plugin.start!(ctxNoJobService);
            for (const cb of readyHooks) await cb();

            expect(
                vi.mocked(ctxNoJobService.logger.warn).mock.calls.map((c) => String(c[0]))
                    .filter((m) => m.includes('job service not registered')),
                'the job-service verdict must not be reported — it was never reached',
            ).toEqual([]);
        });
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
