// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8362 — BOTH schedule triggers must survive a kernel rebuild.
//
// Kernel eviction is routine in the cloud runtime (a freshness probe every few
// seconds; every AI auto-publish bumps freshness), so "AI builds a scheduled
// automation -> the user edits one piece of metadata -> the automation is
// silently dead, permanently" was the NORMAL path, not an edge case. The
// four-layer chain behind it was: a job name with no kernel scope, an
// instance-local `bound` map that makes the rebuilt trigger's pre-bind cleanup
// a no-op, croner's process-global named registry, and — the single point —
// `DbJobAdapter.destroy()` never destroying the cron adapter.
//
// WHAT THIS FILE IS, AND IS NOT. The destroy chain and the registry mechanics
// are pinned where they live, against the real adapters and the real croner
// registry: `service-job/src/db-job-adapter.test.ts` and
// `cron-job-adapter.test.ts`. This file pins the TRIGGER half of the same
// scenario — that both triggers name their job deterministically enough to be
// re-bindable at all, that a rebuilt kernel ends up with exactly one live job
// which fires the NEW kernel's callback, and that a bind failure is reported
// where an operator will see it.
//
// The job service double is backed by REAL croner rather than a Map, on
// purpose: the card's own control experiment showed that an `interval` fixture
// bypasses croner's named registry entirely and would pass against a
// completely unfixed tree. Every case here goes through the `cron` path.

import { describe, it, expect } from 'vitest';
import { Cron, scheduledJobs } from 'croner';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import { ScheduleTrigger, type FlowTriggerBinding, type JobServiceSurface, type TriggerLogger } from './schedule-trigger.js';
import { TimeRelativeTrigger, type TimeRelativeDataEngine } from './time-relative-trigger.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let KERNEL_SEQ = 0;

/**
 * One kernel's job service: croner-backed, with the two properties the real
 * `CronJobAdapter` guarantees — a registry key scoped to this instance, and a
 * `destroy()` that STOPS every job it holds (which is what frees the name).
 */
function cronBackedJobService() {
    const kernelId = `test-kernel-${++KERNEL_SEQ}`;
    const jobs = new Map<string, Cron>();
    const service: JobServiceSurface = {
        async schedule(name, schedule: JobSchedule, handler: JobHandler) {
            if (schedule.type !== 'cron' || !schedule.expression) {
                throw new Error(`this fixture only exercises the cron path, got ${schedule.type}`);
            }
            jobs.get(name)?.stop();
            const job = new Cron(
                schedule.expression,
                { name: `${kernelId}::${name}` },
                async () => { await handler({ jobId: name }); },
            );
            jobs.set(name, job);
        },
        async cancel(name) {
            jobs.get(name)?.stop();
            jobs.delete(name);
        },
    };
    return {
        service,
        /** What kernel eviction reaches: every timer stopped, every name freed. */
        async destroy() {
            for (const job of jobs.values()) job.stop();
            jobs.clear();
        },
    };
}

/** croner's PROCESS-GLOBAL registry, narrowed to one job name. */
const registeredFor = (jobName: string) =>
    scheduledJobs.filter((j) => (j.name ?? '').endsWith(jobName));

function recordingLogger(): TriggerLogger & { errors: string[]; warns: string[] } {
    const errors: string[] = [];
    const warns: string[] = [];
    return {
        errors,
        warns,
        info: () => {},
        debug: () => {},
        warn: (msg: string) => { warns.push(msg); },
        error: (msg: string) => { errors.push(msg); },
    };
}

const DAILY = { type: 'cron', expression: '0 8 * * *' } as const;

/** A data engine with exactly one row in every window, so a sweep launches once. */
function oneRowEngine(): TimeRelativeDataEngine {
    return {
        async find() { return [{ id: 'rec_1' }]; },
        getObject: (name: string) => ({ name }),
    };
}

describe('#8362 — a rebuilt kernel re-binds scheduled flows (both triggers)', () => {
    it('ScheduleTrigger: bind -> evict -> re-bind is scheduled exactly once and fires the NEW kernel', async () => {
        const FLOW = 'nightly_contract_rollup';
        const JOB = `flow-schedule:${FLOW}`;
        const fired: string[] = [];
        const binding: FlowTriggerBinding = { flowName: FLOW, schedule: DAILY };

        // ── kernel 1 ──────────────────────────────────────────────────────
        const k1 = cronBackedJobService();
        const trigger1 = new ScheduleTrigger(() => k1.service, recordingLogger());
        trigger1.start(binding, async () => { fired.push('kernel-1'); });
        await flush();

        // The FIRST bind must really have registered: a rebind pin whose first
        // bind registered nothing passes for the wrong reason.
        expect(registeredFor(JOB)).toHaveLength(1);
        const oldJob = registeredFor(JOB)[0];

        // ── eviction ──────────────────────────────────────────────────────
        await k1.destroy();
        expect(oldJob.isStopped()).toBe(true);
        expect(registeredFor(JOB)).toHaveLength(0);

        // ── kernel 2: fresh plugin instance, so the trigger's `bound` map is
        // empty and its pre-bind `stop()` is a no-op — the shape that used to
        // make the rebind unrecoverable.
        const k2 = cronBackedJobService();
        const trigger2 = new ScheduleTrigger(() => k2.service, recordingLogger());
        trigger2.start(binding, async () => { fired.push('kernel-2'); });
        await flush();

        const live = registeredFor(JOB);
        expect(live).toHaveLength(1); // exactly once — not one live + one zombie
        await live[0].trigger();
        expect(fired).toEqual(['kernel-2']); // the evicted kernel's closure never runs

        await k2.destroy();
    });

    it('TimeRelativeTrigger: bind -> evict -> re-bind is scheduled exactly once and sweeps for the NEW kernel', async () => {
        const FLOW = 'xqao_contract_expiry_reminder_flow';
        const JOB = `flow-time-relative:${FLOW}`;
        const swept: string[] = [];
        const binding: FlowTriggerBinding = {
            flowName: FLOW,
            schedule: DAILY,
            config: {
                timeRelative: { object: 'xqao_contract', dateField: 'expiry_date', offsetDays: [3] },
            },
        };

        const k1 = cronBackedJobService();
        const trigger1 = new TimeRelativeTrigger(() => k1.service, oneRowEngine, recordingLogger());
        trigger1.start(binding, async (_ctx: AutomationContext) => { swept.push('kernel-1'); });
        await flush();

        expect(registeredFor(JOB)).toHaveLength(1);
        const oldJob = registeredFor(JOB)[0];

        await k1.destroy();
        expect(oldJob.isStopped()).toBe(true);

        const k2 = cronBackedJobService();
        const trigger2 = new TimeRelativeTrigger(() => k2.service, oneRowEngine, recordingLogger());
        trigger2.start(binding, async (_ctx: AutomationContext) => { swept.push('kernel-2'); });
        await flush();

        const live = registeredFor(JOB);
        expect(live).toHaveLength(1);
        await live[0].trigger();
        expect(swept).toEqual(['kernel-2']);

        await k2.destroy();
    });
});

describe('#8362 — a failed bind is reported where an operator sees it', () => {
    /** A job service whose schedule() always rejects, as croner did on a taken name. */
    const rejectingService = (): JobServiceSurface => ({
        async schedule(name) {
            throw new Error(`Cron: Tried to initialize new named job '${name}', but name already taken.`);
        },
        async cancel() {},
    });

    it('ScheduleTrigger reports at ERROR, naming the consequence and the remedy', async () => {
        const logger = recordingLogger();
        const trigger = new ScheduleTrigger(() => rejectingService(), logger);
        trigger.start({ flowName: 'nightly_rollup', schedule: DAILY }, async () => {});
        await flush();

        expect(logger.errors).toHaveLength(1);
        const [line] = logger.errors;
        // The failure itself, and the flow it belongs to.
        expect(line).toContain("flow 'nightly_rollup'");
        expect(line).toContain('name already taken');
        // The consequence: everything else keeps looking healthy.
        expect(line).toMatch(/stays published and active/);
        // The remedy.
        expect(line).toMatch(/Re-publish the flow/);
        // A silent WARN was the whole problem — it must not degrade back to one.
        expect(logger.warns).toHaveLength(0);
    });

    it('TimeRelativeTrigger reports at ERROR, naming the consequence and the remedy', async () => {
        const logger = recordingLogger();
        const trigger = new TimeRelativeTrigger(() => rejectingService(), oneRowEngine, logger);
        trigger.start(
            {
                flowName: 'xqao_contract_expiry_reminder_flow',
                schedule: DAILY,
                config: {
                    timeRelative: { object: 'xqao_contract', dateField: 'expiry_date', offsetDays: [3] },
                },
            },
            async () => {},
        );
        await flush();

        expect(logger.errors).toHaveLength(1);
        const [line] = logger.errors;
        expect(line).toContain("flow 'xqao_contract_expiry_reminder_flow'");
        expect(line).toContain('name already taken');
        expect(line).toMatch(/stays published and active/);
        expect(line).toMatch(/Re-publish the flow/);
        expect(logger.warns).toHaveLength(0);
    });
});
