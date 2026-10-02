// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19834] A per-kernel `ScheduledWorkPolicy` on the engine — the engine half.
 *
 * `resolveScheduledWorkPolicy()` reads ONE process-wide environment, so a host
 * running several kernels of different plans in one Node process had nowhere
 * to say "this kernel: scheduled work OFF". `AutomationEngineOptions` (and
 * `AutomationServicePluginOptions`, which forwards it) now carry an optional
 * `scheduledWorkPolicy` — a value or a resolver — read in place of the
 * deployment resolver when present.
 *
 * What is pinned here, all against the engine SOURCE (this package aliases
 * nothing it tests):
 *
 *   1. two engines in one process disagree exactly as their options say, in
 *      BOTH deployment states — the option outranks the environment both ways;
 *   2. a policy-unarmed flow is reported exactly as a deployment-unarmed one
 *      (the policy sentence, ⛔ never "add requires: ['triggers']");
 *   3. a resolver is called at each bind, not once;
 *   4. the zero-argument path is unchanged: no option ⇒ the environment.
 *
 * The acceptance case with the REAL schedule triggers lives in
 * `@objectstack/trigger-schedule`'s `per-kernel-scheduled-work-policy.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import {
    SCHEDULED_WORK_ENV,
    SCHEDULED_WORK_DISABLED_REASON,
    type ScheduledWorkPolicy,
} from '@objectstack/types';

const POSTURE_ENV = 'OS_TENANCY_POSTURE';

const OFF: ScheduledWorkPolicy = {
    enabled: false,
    posture: 'single',
    requiresActingOrganization: false,
    runOwnership: 'unscoped',
};
const ON: ScheduledWorkPolicy = { ...OFF, enabled: true };

function silentLogger() {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

function scheduleFlow(name: string) {
    return {
        name,
        label: name,
        type: 'schedule' as const,
        status: 'active',
        nodes: [
            {
                id: 'start',
                type: 'start' as const,
                label: 'Start',
                config: { schedule: { type: 'cron', expression: '0 8 * * *' } },
            },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

/** A `schedule` trigger that records every binding it is asked to arm. */
function recordingTrigger() {
    const started: string[] = [];
    return {
        started,
        trigger: {
            type: 'schedule',
            start(binding: { flowName: string }) {
                started.push(binding.flowName);
            },
            stop() {},
        },
    };
}

/** Engine + trigger + one schedule flow; returns what the trigger was asked to arm. */
function bindOne(options?: ConstructorParameters<typeof AutomationEngine>[2]) {
    const engine = new AutomationEngine(silentLogger(), undefined, options);
    const rec = recordingTrigger();
    engine.registerTrigger(rec.trigger);
    engine.registerFlow('digest', scheduleFlow('digest'));
    return { engine, started: rec.started };
}

function withDeployment(value: string | undefined) {
    if (value === undefined) delete process.env[SCHEDULED_WORK_ENV];
    else process.env[SCHEDULED_WORK_ENV] = value;
    delete process.env[POSTURE_ENV];
}

describe('AutomationEngine — a per-kernel scheduled-work policy (#19834)', () => {
    const PRIOR_SWITCH = process.env[SCHEDULED_WORK_ENV];
    const PRIOR_POSTURE = process.env[POSTURE_ENV];
    afterEach(() => {
        if (PRIOR_SWITCH === undefined) delete process.env[SCHEDULED_WORK_ENV];
        else process.env[SCHEDULED_WORK_ENV] = PRIOR_SWITCH;
        if (PRIOR_POSTURE === undefined) delete process.env[POSTURE_ENV];
        else process.env[POSTURE_ENV] = PRIOR_POSTURE;
    });

    for (const [label, deployment] of [
        ['deployment OFF (unset)', undefined],
        ['deployment ON', 'true'],
    ] as const) {
        it(`${label}: two engines in one process — OFF arms nothing, its ON sibling arms`, () => {
            withDeployment(deployment);
            const off = bindOne({ scheduledWorkPolicy: OFF });
            const on = bindOne({ scheduledWorkPolicy: ON });

            expect(off.started, 'the OFF kernel called its trigger').toEqual([]);
            expect(on.started, 'the ON kernel did not arm its flow').toEqual(['digest']);

            // The refusal is structured exactly as a deployment refusal is.
            const audit = off.engine.getTriggerBindingAudit();
            expect(audit.map((a) => a.flowName)).toEqual(['digest']);
            expect(audit[0].reason).toBe(SCHEDULED_WORK_DISABLED_REASON);
            expect(audit[0].reason).not.toMatch(/requires: \['triggers'\]/);
            expect(audit[0].reason).not.toMatch(/binding failed/);
            const row = off.engine.getFlowRuntimeStates().find((s) => s.name === 'digest');
            expect(row).toMatchObject({ enabled: true, bound: false, triggerType: 'schedule' });
            expect(row?.reason).toBe(SCHEDULED_WORK_DISABLED_REASON);

            expect(on.engine.getTriggerBindingAudit()).toEqual([]);
        });
    }

    it('a policy-unarmed flow with NO trigger registered still names the policy, never the missing trigger', () => {
        // The ordering #17396 set for the deployment switch holds for the
        // per-kernel one: with the policy off, registering the trigger would
        // change nothing, so "add requires: ['triggers']" is the wrong remedy.
        withDeployment('true');
        const engine = new AutomationEngine(silentLogger(), undefined, { scheduledWorkPolicy: OFF });
        engine.registerFlow('digest', scheduleFlow('digest'));
        const audit = engine.getTriggerBindingAudit();
        expect(audit).toHaveLength(1);
        expect(audit[0].reason).toBe(SCHEDULED_WORK_DISABLED_REASON);
        expect(audit[0].reason).not.toMatch(/requires: \['triggers'\]/);
    });

    it('a resolver is called at each bind, not once at construction', () => {
        withDeployment(undefined);
        let current: ScheduledWorkPolicy = OFF;
        let calls = 0;
        const engine = new AutomationEngine(silentLogger(), undefined, {
            scheduledWorkPolicy: () => {
                calls += 1;
                return current;
            },
        });
        expect(calls, 'nothing is read before a bind').toBe(0);
        const rec = recordingTrigger();
        engine.registerTrigger(rec.trigger);
        engine.registerFlow('a', scheduleFlow('a'));
        expect(rec.started).toEqual([]);

        current = ON;
        engine.registerFlow('b', scheduleFlow('b'));
        expect(rec.started).toEqual(['b']);
        expect(calls).toBeGreaterThanOrEqual(2);
    });

    it('ZERO-ARGUMENT PATH UNCHANGED: no option ⇒ the deployment environment decides', () => {
        withDeployment(undefined);
        expect(bindOne().started, 'unset switch must still refuse').toEqual([]);
        expect(bindOne({}).started, 'an options bag without the key must still refuse').toEqual([]);
        expect(bindOne({ scheduledWorkPolicy: undefined }).started).toEqual([]);

        withDeployment('true');
        expect(bindOne().started, 'switch on must still arm').toEqual(['digest']);
        expect(bindOne({ maxLogSize: 10 }).started).toEqual(['digest']);
    });
});

// ─── the plugin forwards it — two kernels, one process ──────────────

/** The `objectql` seam the boot flow-pull reads (see flow-node-type-audit.test.ts). */
function fakeObjectqlPlugin(flows: unknown[]): Plugin {
    return {
        name: 'fake-objectql',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? flows : []),
                    getObject: () => undefined,
                },
            });
        },
    };
}

/** Registers a recording `schedule` trigger on `kernel:ready`, as the real trigger plugin does. */
function recordingTriggerPlugin(started: string[]): Plugin {
    return {
        name: 'recording-schedule-trigger',
        version: '1.0.0',
        async init() {},
        async start(ctx: PluginContext) {
            ctx.hook('kernel:ready', async () => {
                ctx.getService<AutomationEngine>('automation').registerTrigger({
                    type: 'schedule',
                    start(binding: { flowName: string }) {
                        started.push(binding.flowName);
                    },
                    stop() {},
                });
            });
        },
    };
}

async function bootKernel(scheduledWorkPolicy: ScheduledWorkPolicy | undefined) {
    const started: string[] = [];
    const kernel = new LiteKernel();
    kernel.use(fakeObjectqlPlugin([scheduleFlow('digest')]));
    kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory', scheduledWorkPolicy }));
    kernel.use(recordingTriggerPlugin(started));
    await kernel.bootstrap();
    return { kernel, started, engine: kernel.getService<AutomationEngine>('automation') };
}

describe('AutomationServicePlugin — forwards the per-kernel policy (#19834)', () => {
    const PRIOR_SWITCH = process.env[SCHEDULED_WORK_ENV];
    afterEach(() => {
        if (PRIOR_SWITCH === undefined) delete process.env[SCHEDULED_WORK_ENV];
        else process.env[SCHEDULED_WORK_ENV] = PRIOR_SWITCH;
    });

    it('two kernels in one process: OFF arms nothing, its ON sibling arms, under a deployment that is ON', async () => {
        withDeployment('true');
        const off = await bootKernel(OFF);
        const on = await bootKernel(ON);
        const control = await bootKernel(undefined);
        try {
            expect(off.started).toEqual([]);
            expect(off.engine.getTriggerBindingAudit().map((a) => a.reason)).toEqual([SCHEDULED_WORK_DISABLED_REASON]);
            expect(on.started).toEqual(['digest']);
            // Control: the kernel with no option follows the deployment (ON).
            expect(control.started).toEqual(['digest']);
        } finally {
            await off.kernel.shutdown();
            await on.kernel.shutdown();
            await control.kernel.shutdown();
        }
    });
});

// ─── [#21110] a host-injected OFF reports the HOST's reason ─────────
//
// The #19834 seam had no reason slot, so a kernel a host turned off for its
// own reason (cloud's free plan) was reported with the deployment sentence —
// "set OS_AUTOMATION_SCHEDULED_WORK_ENABLED=true" — on a process where that
// variable IS set, to a tenant who cannot set it. `ScheduledWorkPolicy` now
// carries an optional `hostDisabledReason`, and `scheduledWorkDisabledReason`
// is the one answer the bind log, the audit and the `/_status` row read.
//
// `getFlowRuntimeStates()` is the row `GET /automation/_status` serves,
// verbatim (`packages/runtime/src/domains/automation.ts`, the `_status`
// branch), so the status-door half is pinned on it here.

const HOST_REASON = 'Scheduled flows are not included in the Free plan; upgrade the plan to run them.';
const HOST_OFF: ScheduledWorkPolicy = { ...OFF, hostDisabledReason: HOST_REASON };

/** A logger that keeps every `info` line — the bind log is said at `info`. */
function recordingLogger() {
    const infos: string[] = [];
    const l: any = { info: (m: string) => void infos.push(String(m)), warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return { logger: l, infos };
}

/** Engine + trigger + one schedule flow, with the bind log captured. */
function bindOneLogged(options?: ConstructorParameters<typeof AutomationEngine>[2]) {
    const { logger, infos } = recordingLogger();
    const engine = new AutomationEngine(logger, undefined, options);
    const rec = recordingTrigger();
    engine.registerTrigger(rec.trigger);
    engine.registerFlow('digest', scheduleFlow('digest'));
    // Every `info` line naming the flow: the bind log is the only one at this
    // point, and selecting it by the flow's name rather than by its framing
    // words keeps the refusal's wording out of the pin.
    const bindLog = infos.filter((m) => m.includes("'digest'"));
    return { engine, started: rec.started, bindLog };
}

/** The three surfaces' reasons for 'digest': bind log line, audit, `/_status` row. */
function reasonsOf(bound: ReturnType<typeof bindOneLogged>) {
    const audit = bound.engine.getTriggerBindingAudit();
    const row = bound.engine.getFlowRuntimeStates().find((s) => s.name === 'digest');
    return { audit, row, bindLog: bound.bindLog };
}

describe("AutomationEngine — a host-injected OFF reports the host's reason (#21110)", () => {
    const PRIOR_SWITCH = process.env[SCHEDULED_WORK_ENV];
    const PRIOR_POSTURE = process.env[POSTURE_ENV];
    afterEach(() => {
        if (PRIOR_SWITCH === undefined) delete process.env[SCHEDULED_WORK_ENV];
        else process.env[SCHEDULED_WORK_ENV] = PRIOR_SWITCH;
        if (PRIOR_POSTURE === undefined) delete process.env[POSTURE_ENV];
        else process.env[POSTURE_ENV] = PRIOR_POSTURE;
    });

    for (const [label, deployment] of [
        ['deployment ON (the measured case: the variable IS set)', 'true'],
        ['deployment OFF (unset)', undefined],
    ] as const) {
        it(`${label}: the bind log, the audit and the /_status row all carry the host's reason`, () => {
            withDeployment(deployment);
            const bound = bindOneLogged({ scheduledWorkPolicy: HOST_OFF });
            expect(bound.started, 'the host-OFF kernel called its trigger').toEqual([]);
            const { audit, row, bindLog } = reasonsOf(bound);

            expect(audit).toEqual([{ flowName: 'digest', triggerType: 'schedule', reason: HOST_REASON }]);
            expect(row).toMatchObject({ enabled: true, bound: false, triggerType: 'schedule', reason: HOST_REASON });
            expect(bindLog, 'the bind log is said once').toHaveLength(1);
            expect(bindLog[0]).toContain(HOST_REASON);
            // ⛔ The defect: the deployment switch named as the cause on a
            // kernel whose host decided. Pinned by absence on all three.
            for (const reason of [audit[0].reason, row?.reason, bindLog[0]]) {
                expect(reason).not.toContain(SCHEDULED_WORK_ENV);
            }
        });
    }

    it('a host policy with enabled:false and NO reason keeps the deployment sentence, byte for byte', () => {
        withDeployment('true');
        const { audit, row, bindLog } = reasonsOf(bindOneLogged({ scheduledWorkPolicy: OFF }));
        expect(audit.map((a) => a.reason)).toEqual([SCHEDULED_WORK_DISABLED_REASON]);
        expect(row?.reason).toBe(SCHEDULED_WORK_DISABLED_REASON);
        expect(bindLog).toHaveLength(1);
        expect(bindLog[0]).toContain(SCHEDULED_WORK_DISABLED_REASON);
    });

    it('CONTROL: an unset variable with no host policy keeps the deployment sentence on every surface', () => {
        withDeployment(undefined);
        const { audit, row, bindLog } = reasonsOf(bindOneLogged());
        expect(audit.map((a) => a.reason)).toEqual([SCHEDULED_WORK_DISABLED_REASON]);
        expect(row?.reason).toBe(SCHEDULED_WORK_DISABLED_REASON);
        expect(bindLog).toHaveLength(1);
        expect(bindLog[0]).toContain(SCHEDULED_WORK_DISABLED_REASON);
    });

    it('the reason is read from the RECORDED refusal, not re-asked of the resolver at report time', () => {
        // A resolver may answer something else by the time the audit or the
        // status door runs. What is reported is the sentence of the reading
        // that refused.
        withDeployment('true');
        let current: ScheduledWorkPolicy = HOST_OFF;
        const engine = new AutomationEngine(silentLogger(), undefined, { scheduledWorkPolicy: () => current });
        engine.registerFlow('digest', scheduleFlow('digest'));
        current = { ...OFF, hostDisabledReason: 'a later, different reason' };
        expect(engine.getTriggerBindingAudit().map((a) => a.reason)).toEqual([HOST_REASON]);
        expect(engine.getFlowRuntimeStates().find((s) => s.name === 'digest')?.reason).toBe(HOST_REASON);
    });

    it('through the plugin: a kernel booted with a host reason reports it under a deployment that is ON', async () => {
        withDeployment('true');
        const off = await bootKernel(HOST_OFF);
        try {
            expect(off.started).toEqual([]);
            expect(off.engine.getTriggerBindingAudit().map((a) => a.reason)).toEqual([HOST_REASON]);
            expect(off.engine.getFlowRuntimeStates().find((s) => s.name === 'digest')?.reason).toBe(HOST_REASON);
        } finally {
            await off.kernel.shutdown();
        }
    });
});
