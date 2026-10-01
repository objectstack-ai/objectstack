// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19834] ACCEPTANCE — two kernels in ONE process, each with its own
 * scheduled-work policy.
 *
 * A host that runs several per-environment kernels of mixed plans in one Node
 * process (a hosted runtime with a kernel cache) cannot express "this kernel:
 * scheduled work OFF" through `OS_AUTOMATION_SCHEDULED_WORK_ENABLED`: that
 * switch is one reading for the whole process. The ruled seam is an optional
 * `scheduledWorkPolicy` (a value or a resolver) on `AutomationEngineOptions`
 * and on both schedule trigger plugins, read in place of the zero-argument
 * deployment resolver when present.
 *
 * The case the ruling names as the acceptance test: one kernel constructed with
 * `enabled: false` arms NO package-authored schedule — neither a plain
 * `schedule` flow nor a `time_relative` sweep reaches the job service — while
 * its sibling, in the same process, constructed with `enabled: true`, arms
 * both. Run under BOTH deployment states, so the per-kernel answer is shown to
 * outrank the environment in each direction rather than to agree with it.
 *
 * The kernels are real `LiteKernel`s composing the real
 * `AutomationServicePlugin`, `ScheduleTriggerPlugin` and
 * `TimeRelativeTriggerPlugin`; only the job service and the ObjectQL seam are
 * doubles, because what is measured is which jobs get SCHEDULED.
 *
 * ⚠️ `@objectstack/service-automation` resolves to its `dist/` here (a
 * registered unaliased pair — `check:test-source-alias`), so build it before
 * reading this suite as a verdict about the engine's source; the engine's own
 * source-level pins are in that package's
 * `per-kernel-scheduled-work-policy.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import {
    SCHEDULED_WORK_DISABLED_REASON,
    SCHEDULED_WORK_ENV,
    type ScheduledWorkPolicy,
} from '@objectstack/types';
import type { JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import { ScheduleTriggerPlugin } from './plugin.js';
import { TimeRelativeTriggerPlugin } from './time-relative-plugin.js';
import { ScheduleTrigger, type TriggerLogger } from './schedule-trigger.js';
import { TimeRelativeTrigger } from './time-relative-trigger.js';
import { withScheduledWorkOff, withScheduledWorkOn } from './deployment-switch.test-support.js';

const OFF: ScheduledWorkPolicy = {
    enabled: false,
    posture: 'single',
    requiresActingOrganization: false,
    runOwnership: 'unscoped',
};
const ON: ScheduledWorkPolicy = { ...OFF, enabled: true };

const SCHEDULE_JOB = 'flow-schedule:nightly_digest';
const SWEEP_JOB = 'flow-time-relative:renewal_alert';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A package-authored plain schedule flow. */
const scheduleFlow = {
    name: 'nightly_digest',
    label: 'Nightly digest',
    type: 'schedule',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: { type: 'cron', expression: '0 8 * * *' } } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** A package-authored time-relative sweep. */
const sweepFlow = {
    name: 'renewal_alert',
    label: 'Renewal alert',
    type: 'autolaunched',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { timeRelative: { object: 'contract', dateField: 'end_date', withinDays: 30 } },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** The job service plugin both trigger plugins depend on, recording every schedule() call. */
function recordingJobPlugin(scheduled: string[]): Plugin {
    return {
        name: 'com.objectstack.service.job',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('job', {
                async schedule(name: string, _s: JobSchedule, _h: JobHandler) {
                    scheduled.push(name);
                },
                async cancel() {},
            });
        },
    };
}

/** The ObjectQL seam: the boot flow-pull registry and the sweep's find/getObject. */
function fakeObjectqlPlugin(flows: unknown[]): Plugin {
    return {
        name: 'com.objectstack.engine.objectql',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? flows : []),
                    getObject: () => undefined,
                },
                async find() {
                    return [];
                },
                getObject: (name: string) => ({ name }),
            });
        },
    };
}

interface AutomationSurface {
    getTriggerBindingAudit(): Array<{ flowName: string; reason: string }>;
    getFlowRuntimeStates(): Array<{ name: string; bound: boolean; reason?: string }>;
}

async function bootKernel(scheduledWorkPolicy: ScheduledWorkPolicy | undefined) {
    const scheduled: string[] = [];
    const kernel = new LiteKernel();
    kernel.use(recordingJobPlugin(scheduled));
    kernel.use(fakeObjectqlPlugin([scheduleFlow, sweepFlow]));
    kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory', scheduledWorkPolicy }));
    kernel.use(new ScheduleTriggerPlugin({ scheduledWorkPolicy }));
    kernel.use(new TimeRelativeTriggerPlugin({ scheduledWorkPolicy }));
    await kernel.bootstrap();
    await flush(); // ScheduleTrigger.start() schedules asynchronously
    return {
        kernel,
        scheduled,
        automation: kernel.getService<AutomationSurface>('automation'),
    };
}

function assertTwoKernels(off: Awaited<ReturnType<typeof bootKernel>>, on: Awaited<ReturnType<typeof bootKernel>>) {
    expect(off.scheduled, 'the enabled:false kernel armed a package-authored schedule').toEqual([]);
    expect([...on.scheduled].sort(), 'the enabled:true sibling did not arm both flows').toEqual(
        [SCHEDULE_JOB, SWEEP_JOB].sort(),
    );

    // The refusal is reported the way a deployment refusal is: the policy
    // sentence, per flow — ⛔ never a binding failure, never the missing-trigger
    // remedy.
    const audit = off.automation.getTriggerBindingAudit();
    expect(audit.map((a) => a.flowName).sort()).toEqual(['nightly_digest', 'renewal_alert']);
    for (const entry of audit) {
        expect(entry.reason).toBe(SCHEDULED_WORK_DISABLED_REASON);
        expect(entry.reason).not.toMatch(/requires: \['triggers'\]/);
        expect(entry.reason).not.toMatch(/binding failed/);
    }
    expect(on.automation.getTriggerBindingAudit()).toEqual([]);
}

describe('#19834 ACCEPTANCE — two kernels in one process, deployment switch OFF', () => {
    withScheduledWorkOff();

    it('enabled:false arms nothing while its enabled:true sibling arms both flows', async () => {
        const off = await bootKernel(OFF);
        const on = await bootKernel(ON);
        try {
            assertTwoKernels(off, on);
        } finally {
            await off.kernel.shutdown();
            await on.kernel.shutdown();
        }
    });

    it('ZERO-ARGUMENT PATH UNCHANGED: a kernel with no policy follows the deployment (OFF)', async () => {
        const plain = await bootKernel(undefined);
        try {
            expect(plain.scheduled).toEqual([]);
            expect(plain.automation.getTriggerBindingAudit().map((a) => a.reason)).toEqual([
                SCHEDULED_WORK_DISABLED_REASON,
                SCHEDULED_WORK_DISABLED_REASON,
            ]);
        } finally {
            await plain.kernel.shutdown();
        }
    });
});

describe('#19834 ACCEPTANCE — two kernels in one process, deployment switch ON', () => {
    withScheduledWorkOn('single');

    it('enabled:false arms nothing while its enabled:true sibling arms both flows', async () => {
        const off = await bootKernel(OFF);
        const on = await bootKernel(ON);
        try {
            assertTwoKernels(off, on);
        } finally {
            await off.kernel.shutdown();
            await on.kernel.shutdown();
        }
    });

    it('ZERO-ARGUMENT PATH UNCHANGED: a kernel with no policy follows the deployment (ON)', async () => {
        const plain = await bootKernel(undefined);
        try {
            expect([...plain.scheduled].sort()).toEqual([SCHEDULE_JOB, SWEEP_JOB].sort());
            expect(plain.automation.getTriggerBindingAudit()).toEqual([]);
        } finally {
            await plain.kernel.shutdown();
        }
    });
});

// ─── each trigger's own gate, driven without an engine ──────────────
//
// The triggers keep their own copy of the gate for a host that drives them
// directly; that copy must read the per-kernel policy too, or such a host
// could not turn one kernel off.

function recordingLogger(): TriggerLogger & { infos: string[] } {
    const infos: string[] = [];
    return { infos, info: (m: string) => void infos.push(m), warn: () => {}, debug: () => {}, error: () => {} };
}

function jobs() {
    const names: string[] = [];
    return {
        names,
        service: {
            async schedule(name: string) {
                names.push(name);
            },
            async cancel() {},
        },
    };
}

describe('#19834 — the triggers\' own gate reads the per-kernel policy', () => {
    withScheduledWorkOn('single');

    it('ScheduleTrigger: enabled:false refuses with the policy sentence under a deployment that is ON', async () => {
        const off = jobs();
        const logger = recordingLogger();
        const trigger = new ScheduleTrigger(() => off.service, logger, undefined, undefined, { scheduledWorkPolicy: OFF });
        expect(() =>
            trigger.start({ flowName: 'nightly_digest', schedule: { type: 'cron', expression: '0 8 * * *' } }, async () => {}),
        ).toThrow(SCHEDULED_WORK_DISABLED_REASON);
        await flush();
        expect(off.names).toEqual([]);

        // A resolver is honoured the same way, and read at the bind.
        const on = jobs();
        let current = OFF;
        const lazy = new ScheduleTrigger(() => on.service, recordingLogger(), undefined, undefined, {
            scheduledWorkPolicy: () => current,
        });
        current = ON;
        lazy.start({ flowName: 'nightly_digest', schedule: { type: 'cron', expression: '0 8 * * *' } }, async () => {});
        await flush();
        expect(on.names).toEqual([SCHEDULE_JOB]);
    });

    it('TimeRelativeTrigger: enabled:false refuses with the policy sentence under a deployment that is ON', async () => {
        const off = jobs();
        const engine = { async find() { return []; }, getObject: (name: string) => ({ name }) };
        const trigger = new TimeRelativeTrigger(() => off.service, () => engine, recordingLogger(), undefined, undefined, {
            scheduledWorkPolicy: OFF,
        });
        const binding = {
            flowName: 'renewal_alert',
            object: 'contract',
            config: { timeRelative: { object: 'contract', dateField: 'end_date', withinDays: 30 } },
        };
        expect(() => trigger.start(binding, async () => {})).toThrow(SCHEDULED_WORK_DISABLED_REASON);
        await flush();
        expect(off.names).toEqual([]);

        const on = jobs();
        const armed = new TimeRelativeTrigger(() => on.service, () => engine, recordingLogger(), undefined, undefined, {
            scheduledWorkPolicy: ON,
        });
        armed.start(binding, async () => {});
        await flush();
        expect(on.names).toEqual([SWEEP_JOB]);
    });
});

// ─── [#21110] a host-injected OFF reports the HOST's reason ─────────
//
// Measured before this change, on a real boot with the host policy
// `enabled: false` and `OS_AUTOMATION_SCHEDULED_WORK_ENABLED='true'`: the
// `/_status` reason, the binding audit and the bind log each told the reader to
// set the variable that was already set. The host's reason now reaches every
// surface; a policy with no reason keeps the deployment sentence.

const HOST_REASON = 'Scheduled flows are not included in the Free plan; upgrade the plan to run them.';
const HOST_OFF: ScheduledWorkPolicy = { ...OFF, hostDisabledReason: HOST_REASON };

describe("#21110 ACCEPTANCE — a host-injected OFF reports the host's reason, deployment switch ON", () => {
    withScheduledWorkOn('single');

    it('arms nothing, and the audit and the /_status rows carry the host reason for both flows', async () => {
        const off = await bootKernel(HOST_OFF);
        try {
            expect(off.scheduled).toEqual([]);
            const audit = off.automation.getTriggerBindingAudit();
            expect(audit.map((a) => [a.flowName, a.reason]).sort()).toEqual([
                ['nightly_digest', HOST_REASON],
                ['renewal_alert', HOST_REASON],
            ]);
            const rows = off.automation
                .getFlowRuntimeStates()
                .filter((r) => r.name === 'nightly_digest' || r.name === 'renewal_alert');
            expect(rows).toHaveLength(2);
            for (const row of rows) {
                expect(row.bound).toBe(false);
                expect(row.reason).toBe(HOST_REASON);
                expect(row.reason).not.toContain(SCHEDULED_WORK_ENV);
            }
        } finally {
            await off.kernel.shutdown();
        }
    });
});

describe("#21110 — the triggers' own refusal reads the host reason", () => {
    withScheduledWorkOn('single');

    it('ScheduleTrigger: a host-OFF policy with a reason refuses with that reason, not the deployment sentence', async () => {
        const off = jobs();
        const logger = recordingLogger();
        const trigger = new ScheduleTrigger(() => off.service, logger, undefined, undefined, {
            scheduledWorkPolicy: HOST_OFF,
        });
        let thrown: unknown;
        try {
            trigger.start({ flowName: 'nightly_digest', schedule: { type: 'cron', expression: '0 8 * * *' } }, async () => {});
        } catch (e) {
            thrown = e;
        }
        // The subject is WHICH sentence is reported, so the pins are the host
        // reason's presence and the deployment variable's absence — the
        // refusal's own framing words are not pinned.
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain(HOST_REASON);
        expect((thrown as Error).message).not.toContain(SCHEDULED_WORK_ENV);
        expect(logger.infos).toHaveLength(1);
        expect(logger.infos[0]).toContain(HOST_REASON);
        expect(logger.infos[0]).not.toContain(SCHEDULED_WORK_ENV);
        await flush();
        expect(off.names).toEqual([]);
    });

    it('TimeRelativeTrigger: a host-OFF policy with a reason refuses with that reason, not the deployment sentence', async () => {
        const off = jobs();
        const logger = recordingLogger();
        const engine = { async find() { return []; }, getObject: (name: string) => ({ name }) };
        const trigger = new TimeRelativeTrigger(() => off.service, () => engine, logger, undefined, undefined, {
            scheduledWorkPolicy: HOST_OFF,
        });
        const binding = {
            flowName: 'renewal_alert',
            object: 'contract',
            config: { timeRelative: { object: 'contract', dateField: 'end_date', withinDays: 30 } },
        };
        let thrown: unknown;
        try {
            trigger.start(binding, async () => {});
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain(HOST_REASON);
        expect((thrown as Error).message).not.toContain(SCHEDULED_WORK_ENV);
        expect(logger.infos).toHaveLength(1);
        expect(logger.infos[0]).toContain(HOST_REASON);
        expect(logger.infos[0]).not.toContain(SCHEDULED_WORK_ENV);
        await flush();
        expect(off.names).toEqual([]);
    });

    it('a host-OFF policy with NO reason keeps the deployment sentence', () => {
        const trigger = new ScheduleTrigger(() => jobs().service, recordingLogger(), undefined, undefined, {
            scheduledWorkPolicy: OFF,
        });
        let thrown: unknown;
        try {
            trigger.start({ flowName: 'nightly_digest', schedule: { type: 'cron', expression: '0 8 * * *' } }, async () => {});
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain(SCHEDULED_WORK_DISABLED_REASON);
    });
});
