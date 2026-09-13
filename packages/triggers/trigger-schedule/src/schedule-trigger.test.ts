// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import {
    ScheduleTrigger,
    normalizeSchedule,
    resolveBindingOrganization,
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

/** Keeps every line, so the refusal suite can read the `error` channel. */
function recordingLogger(): { logger: TriggerLogger; errors: string[]; warns: string[] } {
    const errors: string[] = [];
    const warns: string[] = [];
    return {
        logger: {
            info: () => {},
            debug: () => {},
            warn: (msg: string) => void warns.push(String(msg)),
            error: (msg: string) => void errors.push(String(msg)),
        },
        errors,
        warns,
    };
}

function binding(overrides: Partial<FlowTriggerBinding> = {}): FlowTriggerBinding {
    return {
        flowName: 'nightly_health_sweep',
        schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
        // [#16659] A time-triggered binding carries its acting organization; a
        // binding without one is refused — see
        // `ScheduleTrigger — the acting-organization refusal (#16659)` below.
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

// ─── The acting-organization refusal (#16659) ───────────────────────
//
// The unit half of the card's consequence (3): a time-triggered flow that
// declares no acting organization is REFUSED at bind, and the refusal reaches
// the engine rather than only stderr.
//
// ⚠️ Every assertion here would pass vacuously against a trigger that refused
// EVERYTHING, so each limb that expects a refusal is paired with the declaring
// binding from `binding()` above, which must still arm.

describe('ScheduleTrigger — the acting-organization refusal (#16659)', () => {
    const orgLess = () => binding({ organization: undefined, config: {} });

    it('THROWS from start(), so the engine cannot record the flow as bound', () => {
        const job = fakeJobService();
        const log = recordingLogger();
        const trigger = new ScheduleTrigger(() => job.service, log.logger);

        // ⭐ The whole of F1: `FlowTrigger.start` is `void`, so a logged-and-
        // returned refusal is indistinguishable from a successful arm and the
        // engine sets `boundFlowTriggers` anyway. The throw is the engine's
        // designed catch path.
        expect(() => trigger.start(orgLess(), async () => {})).toThrow(/declares no acting organization/);
        expect(job.jobs.size, 'a refused flow must have no job at all').toBe(0);
    });

    it('logs the same sentence at `error`, naming the flow, the key and NOT BOUND', () => {
        const job = fakeJobService();
        const log = recordingLogger();
        const trigger = new ScheduleTrigger(() => job.service, log.logger);

        let thrown = '';
        try {
            trigger.start(orgLess(), async () => {});
        } catch (err) {
            thrown = String((err as Error).message);
        }

        expect(log.errors, 'the refusal is an `error`, not a `warn`').toHaveLength(1);
        const line = log.errors[0];
        expect(line).toContain('NOT BOUND');
        expect(line, 'the refusal must be attributable to a flow, not to "a flow"').toContain(
            'nightly_health_sweep',
        );
        expect(line, 'it must name the key the author has to write').toContain('organization');
        // The loud channel and the thrown text the engine's audit points at
        // must not be able to drift apart.
        expect(line).toContain(thrown);
    });

    it('names the near-miss spelling the author actually wrote', () => {
        const job = fakeJobService();
        const log = recordingLogger();
        const trigger = new ScheduleTrigger(() => job.service, log.logger);

        expect(() =>
            trigger.start(
                binding({ organization: undefined, config: { organizationId: 'org_written_wrong' } }),
                async () => {},
            ),
        ).toThrow();

        // The start node's `config` is an open record, so `organizationId` was
        // accepted and then ignored — the refusal is the only place that
        // becomes visible.
        expect(log.errors[0]).toContain('organizationId');
    });

    it('⛔ never picks an organization for the author', () => {
        const job = fakeJobService();
        const log = recordingLogger();
        const trigger = new ScheduleTrigger(() => job.service, log.logger);

        expect(() =>
            trigger.start(
                binding({ organization: undefined, config: { organizationId: 'org_written_wrong' } }),
                async () => {},
            ),
        ).toThrow();

        // The refusal names the KEY the author misspelt and never their VALUE:
        // echoing an id back is one edit away from acting on it, and the one
        // value in scope here is precisely the one nothing may adopt.
        expect(log.errors[0]).not.toContain('org_written_wrong');
        expect(job.jobs.size).toBe(0);
    });

    it('a hot re-publish that REMOVES the key drops the prior job', async () => {
        const job = fakeJobService();
        const log = recordingLogger();
        const trigger = new ScheduleTrigger(() => job.service, log.logger);

        trigger.start(binding(), async () => {});
        await flush();
        expect(job.jobs.size, 'precondition: the declaring binding armed').toBe(1);

        // ⭐ Without the `stop()` that precedes the throw, the previous, still
        // armed job keeps firing org-less ticks behind an error saying the flow
        // was refused — the exact "armed, listed and inert" shape this card closes.
        expect(() => trigger.start(orgLess(), async () => {})).toThrow();
        await flush();
        expect(job.jobs.size).toBe(0);
    });

    it('refusing one flow does not disarm a sibling', async () => {
        const job = fakeJobService();
        const log = recordingLogger();
        const trigger = new ScheduleTrigger(() => job.service, log.logger);

        trigger.start(binding({ flowName: 'declares_one' }), async () => {});
        await flush();
        expect(() =>
            trigger.start(binding({ flowName: 'declares_none', organization: undefined, config: {} }), async () => {}),
        ).toThrow();
        await flush();

        expect(job.jobs.has('flow-schedule:declares_one')).toBe(true);
        expect(job.jobs.has('flow-schedule:declares_none')).toBe(false);
    });

    it('falls back to `warn` when the logger has no `error` channel', () => {
        const job = fakeJobService();
        const warn = vi.fn();
        const trigger = new ScheduleTrigger(() => job.service, { info: () => {}, warn, debug: () => {} });

        expect(() => trigger.start(orgLess(), async () => {})).toThrow();
        expect(warn, 'the refusal must still be said, not swallowed').toHaveBeenCalled();
    });
});

describe('resolveBindingOrganization (#16659)', () => {
    it('reads the lifted binding field first', () => {
        expect(resolveBindingOrganization(binding())).toBe('org_2mtx1w9d0k4bqf7v');
    });

    it('falls back to the raw start-node config, for an engine that predates the lift', () => {
        // ⭐ Not redundancy: the binding is a STRUCTURAL mirror, so a host on an
        // older engine hands this trigger no `organization` field and a `config`
        // that still carries the author's declaration. Refusing there would
        // report an engine-version skew as an authoring error.
        expect(
            resolveBindingOrganization(
                binding({ organization: undefined, config: { organization: 'org_from_config' } }),
            ),
        ).toBe('org_from_config');
    });

    it('the lifted field wins over the raw config', () => {
        expect(
            resolveBindingOrganization(binding({ config: { organization: 'org_stale' } })),
        ).toBe('org_2mtx1w9d0k4bqf7v');
    });

    it.each([
        ['absent', undefined],
        ['an empty string', ''],
        ['a number', 42],
        ['an object', { id: 'org_x' }],
        ['null', null],
    ])('answers null for a value that is %s', (_label, value) => {
        // A present-but-unusable value takes the refusal path: "declared" must
        // mean "usable", or a flow admitted by one layer and refused by the next
        // is the silent hole again.
        expect(
            resolveBindingOrganization(
                binding({ organization: undefined, config: { organization: value } as Record<string, unknown> }),
            ),
        ).toBeNull();
    });
});
