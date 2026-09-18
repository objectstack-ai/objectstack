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
import { withScheduledWorkOff, withScheduledWorkOn } from './deployment-switch.test-support.js';
import { SCHEDULED_WORK_ENV } from '@objectstack/types';

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
    // [#17396] Every assertion in this suite is about a deployment that RUNS
    // package-authored scheduled work. Without the switch nothing binds — which
    // is its own suite further down, not a wrinkle in these.
    withScheduledWorkOn();

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
    withScheduledWorkOn();

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
    // [#17396] `isolated`, and the posture is now load-bearing: this refusal
    // exists behind a WALL. The same binding under `single` is armed, not
    // refused — see the deployment-switch suite below, which pins exactly that.
    withScheduledWorkOn('isolated');

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

// ─── the deployment switch: the three bind states (#17396) ──────────
//
// Ruling G, recorded on #17396 (director seat, decision batch #116 item 4,
// amended by batch #118): a deployment-level variable gates time-triggered
// flows, the global default is OFF in every posture and every kernel, and when
// it is ON the 2026-09-08 declaration requirement applies behind a WALL only.
//
// Three states, three suites, and each one asserts what BINDS rather than only
// what is logged: a refusal that logs correctly and arms the job anyway is the
// exact defect #16659's own refusal was shaped to avoid.
describe('ScheduleTrigger — the deployment switch is OFF (#17396)', () => {
    withScheduledWorkOff();

    it('arms nothing, whatever the flow declares', () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        // Declares an organization AND a valid cadence — nothing about this
        // flow is wrong. The deployment simply does not run scheduled work.
        expect(() => trigger.start(binding(), async () => {})).toThrow(/deployment policy/);
        expect(job.jobs.size, 'a policy-disabled flow must have no job at all').toBe(0);
    });

    it('names the switch and its remedy, and ⛔ never says the binding failed', () => {
        const job = fakeJobService();
        const infos: string[] = [];
        const log = recordingLogger();
        const trigger = new ScheduleTrigger(() => job.service, {
            ...log.logger,
            info: (msg: string) => void infos.push(String(msg)),
        });

        expect(() => trigger.start(binding(), async () => {})).toThrow();

        const said = infos.join('\n');
        expect(said, 'the operator is owed the variable by name').toContain(SCHEDULED_WORK_ENV);
        expect(said, 'and the flow it is about').toContain('nightly_health_sweep');
        expect(said, 'and that this is policy, not a defect').toMatch(/deployment policy/);
        expect(said, 'the remedy is the switch, not the flow').toMatch(/nothing about the flow needs fixing/);
        // ⭐ The distinction ruled item 6 is entirely about.
        expect(said).not.toMatch(/binding failed/);
        expect(
            log.errors.concat(log.warns).join('\n'),
            'the DEFAULT configuration of every deployment must not print a warning or an error',
        ).toBe('');
    });

    it('refuses BEFORE the descriptor and the declaration are judged', () => {
        // Otherwise an operator on a deployment that was never going to run
        // this flow is sent to fix a descriptor nothing would have read, or to
        // write a key nothing would have wanted.
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        const broken = binding({ organization: undefined, config: {}, schedule: 'not-a-cron-…' });

        expect(() => trigger.start(broken, async () => {})).toThrow(/deployment policy/);
    });

    it('drops a job armed while the switch was on, so flipping it off disarms', () => {
        // The switch is read at BIND, so this is what a rebind after an
        // operator turned it off has to do: the previous job must not survive
        // behind a refusal that says the flow is not armed.
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        process.env[SCHEDULED_WORK_ENV] = 'true';
        trigger.start(binding(), async () => {});
        expect(job.jobs.size, 'control: it really did arm while the switch was on').toBe(1);

        delete process.env[SCHEDULED_WORK_ENV];
        expect(() => trigger.start(binding(), async () => {})).toThrow(/deployment policy/);
        expect(job.jobs.size, 'the prior job must be gone, not left ticking').toBe(0);
    });
});

describe('ScheduleTrigger — switched ON under `single` (#17396)', () => {
    withScheduledWorkOn('single');

    const orgLess = () => binding({ organization: undefined, config: {} });

    it('arms a flow that declares NO organization', () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());

        // ⭐ The widening the whole card turns on: this exact binding is
        // REFUSED under a wall (the #16659 suite above) and armed here.
        trigger.start(orgLess(), async () => {});
        expect(job.jobs.size).toBe(1);
    });

    it('the run carries NO organization — the key is absent, not undefined', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        const seen: AutomationContext[] = [];

        trigger.start(orgLess(), async (ctx) => void seen.push(ctx));
        await flush();
        await job.fire('flow-schedule:nightly_health_sweep');

        expect(seen).toHaveLength(1);
        // ⛔ `'tenantId' in ctx` rather than `ctx.tenantId === undefined`: the
        // ruling says the run carries no organization, and a present-but-
        // undefined key is a different thing to every consumer that asks `in`.
        expect('tenantId' in seen[0], 'no tenantId key at all').toBe(false);
    });

    it('still threads a DECLARED organization onto the run', async () => {
        // `single` removes the REQUIREMENT, not the capability: a deployment
        // that declares one still gets it, so nothing that worked stops.
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        const seen: AutomationContext[] = [];

        trigger.start(binding(), async (ctx) => void seen.push(ctx));
        await flush();
        await job.fire('flow-schedule:nightly_health_sweep');

        expect(seen[0]?.tenantId).toBe('org_2mtx1w9d0k4bqf7v');
    });

    it('⛔ still never invents one', () => {
        // The one limb the 2026-09-08 ruling forbids outright. `single` omits
        // the key; it does not fill it from the install, the platform
        // organization, or anything else.
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        expect(resolveBindingOrganization(orgLess())).toBeNull();
        trigger.start(orgLess(), async () => {});
        expect(job.jobs.size).toBe(1);
    });
});

describe('ScheduleTrigger — switched ON under `isolated` (#17396)', () => {
    withScheduledWorkOn('isolated');

    it('an undeclared flow is refused', () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        expect(() =>
            trigger.start(binding({ organization: undefined, config: {} }), async () => {}),
        ).toThrow(/declares no acting organization/);
        expect(job.jobs.size).toBe(0);
    });

    it('and a declared one binds', () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        trigger.start(binding(), async () => {});
        expect(job.jobs.size).toBe(1);
    });
});

/**
 * [#18378, ruling A′] ⚠️ RETIRED PIN, replaced rather than deleted.
 *
 * This block used to be `ScheduleTrigger — switched ON under a wall` with
 * `withScheduledWorkOn('group')` and a case named "`group` is walled: an
 * undeclared flow is refused there too". Its reason was explicit and is quoted
 * here so the reversal is legible rather than looking like an erosion: `group`
 * behaved as walled *while the question of which organization a group-wide
 * sweep's inserts belong to was unanswered*. That question is answered now —
 * the swept record's own — so the condition the old pin rested on is gone.
 *
 * The `isolated` half above is that pin, kept whole: nothing about `isolated`
 * was reopened, and the refusal it asserts is byte-identical.
 */
describe('ScheduleTrigger — switched ON under `group` (#18378)', () => {
    withScheduledWorkOn('group');

    it('an undeclared flow BINDS — it is not refused, and the job is armed', async () => {
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        expect(() =>
            trigger.start(binding({ organization: undefined, config: {} }), async () => {}),
        ).not.toThrow();
        await flush();
        expect(job.jobs.size).toBe(1);
    });

    it('…and its run carries NO organization — a cron flow has no record to derive one from', async () => {
        // The half that keeps A′ apart from the rejected option A. `group`
        // binding without a declaration does NOT mean the run acquires an
        // organization from somewhere: a plain `schedule` flow sweeps nothing,
        // so there is nothing to derive, and the key is OMITTED. The write that
        // needs one is refused downstream by the tenancy guard, which is the
        // loud failure A′ chose over a bootstrap-organization fallback.
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        const seen: AutomationContext[] = [];

        trigger.start(binding({ organization: undefined, config: {} }), async (ctx) => void seen.push(ctx));
        await flush();
        await job.fire('flow-schedule:nightly_health_sweep');

        expect(seen).toHaveLength(1);
        // Same `in` spelling as the `single` pin above, and for the same
        // reason: a present-but-undefined key is a different thing to every
        // consumer that asks `in`.
        expect('tenantId' in seen[0], 'no tenantId key at all').toBe(false);
    });

    it('⛔ and it still never invents one — no bootstrap organization, no first row', async () => {
        // The rejected arm of the card, pinned NEGATIVELY so a later edit that
        // "helpfully" adds a fallback fails here by name.
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        const seen: AutomationContext[] = [];
        const orgLessBinding = binding({ organization: undefined, config: {} });

        expect(resolveBindingOrganization(orgLessBinding)).toBeNull();
        trigger.start(orgLessBinding, async (ctx) => void seen.push(ctx));
        await flush();
        await job.fire('flow-schedule:nightly_health_sweep');

        expect(seen[0]?.tenantId).toBeUndefined();
    });

    it('a DECLARED flow under `group` still acts as its declaration', async () => {
        // `group` removes the REQUIREMENT, not the capability — the same
        // sentence the `single` block records, and the reason the declaration
        // outranks per-record ownership everywhere below.
        const job = fakeJobService();
        const trigger = new ScheduleTrigger(() => job.service, silentLogger());
        const seen: AutomationContext[] = [];

        trigger.start(binding(), async (ctx) => void seen.push(ctx));
        await flush();
        await job.fire('flow-schedule:nightly_health_sweep');

        expect(seen[0]?.tenantId).toBe('org_2mtx1w9d0k4bqf7v');
    });
});
