// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import {
    ScheduleTrigger,
    normalizeSchedule,
    type FlowTriggerBinding,
    type JobServiceSurface,
    type TriggerLogger,
} from './schedule-trigger.js';
import { ScheduleTriggerPlugin } from './plugin.js';

// ─── Test doubles ───────────────────────────────────────────────────

interface ScheduledJob {
    name: string;
    schedule: JobSchedule;
    handler: JobHandler;
}

/** Fake IJobService slice: records schedule()/cancel() and can fire a job. */
function fakeJobService() {
    const jobs = new Map<string, ScheduledJob>();
    const service: JobServiceSurface = {
        async schedule(name, schedule, handler) {
            jobs.set(name, { name, schedule, handler });
        },
        async cancel(name) {
            jobs.delete(name);
        },
    };
    return {
        service,
        jobs,
        async fire(name: string, jobId = 'run1') {
            await jobs.get(name)?.handler({ jobId });
        },
    };
}

function silentLogger(): TriggerLogger {
    return { info: () => {}, warn: () => {}, debug: () => {} };
}

function binding(overrides: Partial<FlowTriggerBinding> = {}): FlowTriggerBinding {
    return {
        flowName: 'nightly_health_sweep',
        schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
        // [#16659] A time-triggered binding carries its acting organization;
        // a binding without one is refused, which is its own suite below.
        organization: 'org_2mtx1w9d0k4bqf7v',
        ...overrides,
    };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ─── normalizeSchedule ──────────────────────────────────────────────

describe('normalizeSchedule', () => {
    it('passes through canonical cron/interval/once shapes', () => {
        expect(normalizeSchedule({ type: 'cron', expression: '* * * * *', timezone: 'UTC' })).toEqual({
            type: 'cron',
            expression: '* * * * *',
            timezone: 'UTC',
        });
        expect(normalizeSchedule({ type: 'interval', intervalMs: 5000 })).toEqual({
            type: 'interval',
            intervalMs: 5000,
        });
        expect(normalizeSchedule({ type: 'once', at: '2026-01-01T00:00:00Z' })).toEqual({
            type: 'once',
            at: '2026-01-01T00:00:00Z',
        });
    });

    it('treats a bare string as a cron expression', () => {
        expect(normalizeSchedule('0 1 * * *')).toEqual({ type: 'cron', expression: '0 1 * * *' });
    });

    it('accepts shorthands { cron } / { expression } / { every } / { at }', () => {
        expect(normalizeSchedule({ cron: '*/5 * * * *' })).toEqual({ type: 'cron', expression: '*/5 * * * *' });
        expect(normalizeSchedule({ expression: '0 0 * * *' })).toEqual({ type: 'cron', expression: '0 0 * * *' });
        expect(normalizeSchedule({ every: 1000 })).toEqual({ type: 'interval', intervalMs: 1000 });
        expect(normalizeSchedule({ at: '2026-06-01T00:00:00Z' })).toEqual({
            type: 'once',
            at: '2026-06-01T00:00:00Z',
        });
    });

    it('returns null for missing / unusable descriptors', () => {
        expect(normalizeSchedule(undefined)).toBeNull();
        expect(normalizeSchedule(null)).toBeNull();
        expect(normalizeSchedule('')).toBeNull();
        expect(normalizeSchedule({ type: 'cron' })).toBeNull(); // no expression
        expect(normalizeSchedule({ type: 'interval', intervalMs: 0 })).toBeNull();
        expect(normalizeSchedule({ type: 'once' })).toBeNull(); // no at
        expect(normalizeSchedule(42)).toBeNull();
    });
});

// ─── ScheduleTrigger ────────────────────────────────────────────────

describe('ScheduleTrigger', () => {
    it('schedules a job for the flow with the normalized schedule', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        trigger.start(binding(), async () => {});
        await flush();

        expect(job.jobs.size).toBe(1);
        const scheduled = job.jobs.get('flow-schedule:nightly_health_sweep');
        expect(scheduled?.schedule).toEqual({ type: 'cron', expression: '0 1 * * *', timezone: 'UTC' });
    });

    it('reads schedule from binding.config.schedule as a fallback', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        trigger.start(
            binding({ schedule: undefined, config: { schedule: { type: 'interval', intervalMs: 2000 } } }),
            async () => {},
        );
        await flush();

        expect(job.jobs.get('flow-schedule:nightly_health_sweep')?.schedule).toEqual({
            type: 'interval',
            intervalMs: 2000,
        });
    });

    it('does not schedule when no schedule descriptor is present', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        trigger.start(binding({ schedule: undefined }), async () => {});
        await flush();

        expect(job.jobs.size).toBe(0);
    });

    it('does not schedule when the job service is unavailable', async () => {
        const trigger = new ScheduleTrigger(() => null, silentLogger());
        expect(() => trigger.start(binding(), async () => {})).not.toThrow();
    });

    it('fires the callback with a schedule context when the job runs', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        const seen: AutomationContext[] = [];

        trigger.start(binding(), async (ctx) => {
            seen.push(ctx);
        });
        await flush();
        await job.fire('flow-schedule:nightly_health_sweep', 'run42');

        expect(seen).toHaveLength(1);
        expect(seen[0].event).toBe('schedule');
        expect(seen[0].params).toMatchObject({ jobId: 'run42', flowName: 'nightly_health_sweep' });
    });

    it('isolates flow errors so the job runner is never broken', async () => {
        const job = fakeJobService();
        const warn = vi.fn();
        const trigger = new ScheduleTrigger(() => job.service, { info: () => {}, warn, debug: () => {} });

        trigger.start(binding(), async () => {
            throw new Error('flow blew up');
        });
        await flush();

        await expect(job.fire('flow-schedule:nightly_health_sweep')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
    });

    it('stop() cancels the flow\'s job', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        trigger.start(binding(), async () => {});
        await flush();
        expect(job.jobs.size).toBe(1);

        trigger.stop('nightly_health_sweep');
        await flush();
        expect(job.jobs.size).toBe(0);
    });

    it('re-binding the same flow is idempotent (one job)', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        trigger.start(binding(), async () => {});
        await flush();
        trigger.start(binding({ schedule: { type: 'interval', intervalMs: 9000 } }), async () => {});
        await flush();

        expect(job.jobs.size).toBe(1);
        expect(job.jobs.get('flow-schedule:nightly_health_sweep')?.schedule).toEqual({
            type: 'interval',
            intervalMs: 9000,
        });
    });

    it('stop() on an unknown flow is a no-op', () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        expect(() => trigger.stop('never_bound')).not.toThrow();
    });
});

// ─── ScheduleTriggerPlugin ──────────────────────────────────────────

describe('ScheduleTriggerPlugin', () => {
    interface FakeCtx {
        readyHandlers: Array<() => Promise<void> | void>;
        ctx: {
            logger: TriggerLogger;
            getService: <T>(name: string) => T;
            hook: (event: string, handler: () => Promise<void> | void) => void;
        };
    }

    function fakePluginCtx(services: Record<string, unknown>): FakeCtx {
        const readyHandlers: Array<() => Promise<void> | void> = [];
        return {
            readyHandlers,
            ctx: {
                logger: silentLogger() as TriggerLogger,
                getService<T>(name: string): T {
                    if (!(name in services)) throw new Error(`no service '${name}'`);
                    return services[name] as T;
                },
                hook(event: string, handler: () => Promise<void> | void) {
                    if (event === 'kernel:ready') readyHandlers.push(handler);
                },
            },
        };
    }

    it('registers the trigger when automation + job services exist', async () => {
        const registerTrigger = vi.fn();
        const job = fakeJobService();
        const fake = fakePluginCtx({ automation: { registerTrigger }, job: job.service });

        const plugin = new ScheduleTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        expect(registerTrigger).toHaveBeenCalledTimes(1);
        expect((registerTrigger.mock.calls[0][0] as ScheduleTrigger).type).toBe('schedule');
    });

    it('still registers the trigger when the job service is missing (warns)', async () => {
        const registerTrigger = vi.fn();
        const fake = fakePluginCtx({ automation: { registerTrigger } });

        const plugin = new ScheduleTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        // Registered so it can lazily pick up a job service later.
        expect(registerTrigger).toHaveBeenCalledTimes(1);
    });

    it('skips gracefully when the automation service is absent', async () => {
        const job = fakeJobService();
        const fake = fakePluginCtx({ job: job.service });

        const plugin = new ScheduleTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await expect(fake.readyHandlers[0]()).resolves.toBeUndefined();
    });

    it('lazily resolves the job service at fire time (adapter upgrade)', async () => {
        const registerTrigger = vi.fn();
        const job = fakeJobService();
        // Job service appears AFTER the trigger is registered.
        const services: Record<string, unknown> = { automation: { registerTrigger } };
        const fake = fakePluginCtx(services);

        const plugin = new ScheduleTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        // Now the job service becomes available.
        services.job = job.service;

        const trigger = registerTrigger.mock.calls[0][0] as ScheduleTrigger;
        trigger.start(binding(), async () => {});
        await flush();

        expect(job.jobs.size).toBe(1);
    });
});
