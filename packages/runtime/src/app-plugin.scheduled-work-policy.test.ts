// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31382 — a package's `jobs` honour the HOST's per-kernel scheduled-work
 * policy, the jobs half of #19834.
 *
 * A host that runs many kernels in one process (cloud's hosted runtime) turns
 * package-authored scheduled work off per kernel by handing each one a
 * `scheduledWorkPolicy`. The engine and both schedule triggers took it since
 * #19834; `AppPlugin` / `scheduleAppArtifactJobs` read only the zero-argument
 * deployment switch, so the same kernel's `jobs` still ran. Pinned here:
 *
 *   - two kernels in one process, the deployment switch ON as the hosted
 *     runtime sets it: the one handed `enabled: false` schedules none of its
 *     package's jobs, the sibling handed `enabled: true` runs the same job;
 *   - a kernel whose policy turns off cancels the jobs its app had scheduled;
 *   - the off line carries the host's own reason (#21110), not the deployment
 *     sentence;
 *   - the policy replaces the posture half too (`requiresActingOrganization`);
 *   - a resolver that throws fails CLOSED;
 *   - absent a policy, the deployment resolvers are read exactly as before.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { defineJob } from '@objectstack/spec/system';
import { CronJobAdapter } from '@objectstack/service-job';
import {
    SCHEDULED_WORK_DISABLED_REASON,
    SCHEDULED_WORK_ENV,
    type ScheduledWorkPolicy,
} from '@objectstack/types';
import { AppPlugin } from './app-plugin.js';
import { scheduleAppArtifactJobs } from './app-artifact-handlers.js';
import { withScheduledWorkOn } from './scheduled-work.test-support.js';

// The deployment switch is ON, as the hosted runtime sets it: what turns a
// kernel's jobs off below is the host's per-kernel policy, nothing else.
withScheduledWorkOn();

const OFF: ScheduledWorkPolicy = {
    enabled: false,
    posture: 'single',
    requiresActingOrganization: false,
    runOwnership: 'unscoped',
};
const ON: ScheduledWorkPolicy = { ...OFF, enabled: true };
const HOST_REASON = 'scheduled work is not part of the Free plan — upgrade this environment to Team to run it.';

const APP_ID = 'com.test.hosted';
const JOB = 'hourly_sweep';

/** One kernel: its own job service (the real cron adapter), logger and `kernel:ready` hooks. */
function kernel(adapter: CronJobAdapter = new CronJobAdapter()) {
    const readyHooks: Array<() => Promise<void>> = [];
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const ctx = {
        logger,
        registerService: vi.fn(),
        getService: vi.fn((name: string) => {
            if (name === 'job') return adapter;
            if (name === 'objectql') return {};
            return undefined;
        }),
        getServices: vi.fn(() => []),
        hook: vi.fn((event: string, cb: () => Promise<void>) => {
            if (event === 'kernel:ready') readyHooks.push(cb);
        }),
        trigger: vi.fn(),
    } as unknown as PluginContext;
    return {
        adapter,
        ctx,
        logger,
        ready: async () => { for (const cb of readyHooks) await cb(); },
        infos: () => logger.info.mock.calls.map((c) => String(c[0])),
    };
}

/** The same package every kernel below boots: one cron job running a `functions` entry. */
function bundle(sweep: () => Promise<void>) {
    return {
        id: APP_ID,
        jobs: [defineJob({ name: JOB, schedule: { type: 'cron', expression: '0 * * * *' }, handler: 'sweep' })],
        functions: { sweep },
    };
}

describe('#31382: AppPlugin — two kernels in one process, each under its host-handed policy', () => {
    const adapters: CronJobAdapter[] = [];
    afterEach(async () => {
        for (const a of adapters.splice(0)) await a.destroy();
    });
    const boot = async (policy: ScheduledWorkPolicy | (() => ScheduledWorkPolicy) | undefined, adapter?: CronJobAdapter) => {
        const k = kernel(adapter);
        if (!adapter) adapters.push(k.adapter);
        const sweep = vi.fn(async () => { /* the job's work */ });
        const plugin = new AppPlugin(bundle(sweep), undefined, policy === undefined ? {} : { scheduledWorkPolicy: policy });
        await plugin.start!(k.ctx);
        await k.ready();
        return { ...k, sweep };
    };

    it('the kernel handed `enabled: false` schedules NONE of its jobs; its sibling handed `enabled: true` runs the same job', async () => {
        const free = await boot(OFF);
        const team = await boot(ON);

        expect(await free.adapter.listJobs(), 'the off kernel holds no job').toEqual([]);
        expect(await team.adapter.listJobs(), 'the on kernel holds it').toEqual([JOB]);

        await team.adapter.trigger(JOB);
        expect(team.sweep).toHaveBeenCalledTimes(1);
        expect(free.sweep).not.toHaveBeenCalled();
    });

    it('a resolver is read at kernel:ready, and the same process keeps a kernel with NO policy on the deployment switch', async () => {
        const free = await boot(() => OFF);
        const plain = await boot(undefined);

        expect(await free.adapter.listJobs()).toEqual([]);
        expect(await plain.adapter.listJobs(), 'no policy ⇒ the deployment switch (ON here) decides').toEqual([JOB]);
    });

    it('a kernel whose policy turned off CANCELS the job its app had scheduled before', async () => {
        const adapter = new CronJobAdapter();
        adapters.push(adapter);
        await boot(ON, adapter);
        expect(await adapter.listJobs()).toEqual([JOB]);

        // The host rebuilds this environment's kernel on a plan that is off.
        const rebuilt = await boot(OFF, adapter);

        expect(await adapter.listJobs(), 'the job the earlier boot scheduled is gone').toEqual([]);
        expect(rebuilt.sweep).not.toHaveBeenCalled();
    });

    it("says so once at `info`, with the HOST's reason — not the deployment sentence", async () => {
        const free = await boot({ ...OFF, hostDisabledReason: HOST_REASON });

        const said = free.infos().filter((m) => m.includes('declarative jobs NOT scheduled'));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(HOST_REASON);
        expect(said[0], 'the variable is set on this deployment — naming it as the remedy is wrong here')
            .not.toContain(SCHEDULED_WORK_ENV);
    });
});

describe('#31382: scheduleAppArtifactJobs — `scheduledWorkPolicy` in place of the zero-argument reads', () => {
    /** `IJobService` as state, `schedule` replacing by name and `cancel` removing. */
    function jobs() {
        const scheduled = new Set<string>();
        const svc = {
            schedule: async (name: string) => { scheduled.add(name); },
            cancel: async (name: string) => { scheduled.delete(name); },
            trigger: async () => undefined,
        };
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const ctx = {
            logger,
            getService: (name: string) => {
                if (name === 'job') return svc;
                throw new Error(`no ${name}`);
            },
        } as unknown as PluginContext;
        const run = (
            jobList: unknown[],
            scheduledWorkPolicy?: ScheduledWorkPolicy | (() => ScheduledWorkPolicy),
        ) => scheduleAppArtifactJobs(
            ctx,
            { id: APP_ID, jobs: jobList, functions: { sweep: async () => undefined } },
            { appId: APP_ID, ql: undefined, source: 'Test', ...(scheduledWorkPolicy ? { scheduledWorkPolicy } : {}) },
        );
        return { scheduled, logger, run };
    }
    const job = (name: string, extra: Record<string, unknown> = {}) =>
        ({ name, schedule: { type: 'interval', intervalMs: 60_000 }, handler: 'sweep', ...extra });

    it('off ⇒ `withheld: scheduled-work-disabled`, nothing scheduled, the prior jobs cancelled', async () => {
        const h = jobs();
        await h.run([job('a_job'), job('b_job')], ON);
        expect([...h.scheduled].sort()).toEqual(['a_job', 'b_job']);

        const out = await h.run([job('a_job'), job('b_job')], OFF);

        expect(out.withheld).toBe('scheduled-work-disabled');
        expect(out.handlers).toEqual([]);
        expect(out.cancelled.sort()).toEqual(['a_job', 'b_job']);
        expect(h.scheduled.size).toBe(0);
    });

    it("the policy's posture half replaces the deployment's: `requiresActingOrganization` refuses an org-less job", async () => {
        const h = jobs();
        const isolated: ScheduledWorkPolicy = {
            enabled: true, posture: 'isolated', requiresActingOrganization: true, runOwnership: 'declared',
        };

        const out = await h.run([job('orgless_job'), job('declared_job', { organization: 'org_1' })], isolated);

        expect(out.missingOrganization).toEqual(['orgless_job']);
        expect(out.handlers).toEqual(['declared_job']);
    });

    it('a resolver that throws fails CLOSED: nothing scheduled, `scheduled-work-policy-unreadable`, said at error', async () => {
        const h = jobs();
        await h.run([job('a_job')], ON);

        const out = await h.run([job('a_job')], () => { throw new Error('plan lookup failed'); });

        expect(out.withheld).toBe('scheduled-work-policy-unreadable');
        expect(out.cancelled).toEqual(['a_job']);
        expect(h.scheduled.size).toBe(0);
        expect(h.logger.error).toHaveBeenCalledTimes(1);
    });

    describe('absent ⇒ the deployment resolvers, exactly as before', () => {
        let prior: string | undefined;
        beforeEach(() => { prior = process.env[SCHEDULED_WORK_ENV]; delete process.env[SCHEDULED_WORK_ENV]; });
        afterEach(() => {
            if (prior === undefined) delete process.env[SCHEDULED_WORK_ENV];
            else process.env[SCHEDULED_WORK_ENV] = prior;
        });

        it('switch OFF and no policy: withheld with the deployment sentence, verbatim', async () => {
            const h = jobs();
            const out = await h.run([job('a_job')]);

            expect(out.withheld).toBe('scheduled-work-disabled');
            expect(h.scheduled.size).toBe(0);
            expect(String(h.logger.info.mock.calls[0][0])).toBe(
                `[Test] declarative jobs NOT scheduled — ${SCHEDULED_WORK_DISABLED_REASON}`,
            );
        });

        it('switch OFF but the host hands `enabled: true`: the policy, not the switch, decides', async () => {
            const h = jobs();
            const out = await h.run([job('a_job')], ON);

            expect(out.withheld).toBeUndefined();
            expect(out.handlers).toEqual(['a_job']);
        });
    });
});
