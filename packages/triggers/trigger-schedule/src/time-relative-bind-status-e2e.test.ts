// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// END-TO-END: the REAL TimeRelativeTrigger wired to the REAL AutomationEngine,
// pinning what the engine's status row (the rows `GET /automation/_status`
// serves) says about a flow the trigger refused on its descriptor.
//
// `FlowTrigger.start` returns `void`, so a trigger that logs "not bound" and
// returns reads to the engine as a successful arm: the engine marks the flow
// bound, and the status row answers `bound: true` beside the trigger's own
// refusal. The trigger throws instead; the engine's catch never marks the flow
// bound, and the row reads `bound: false` with the `binding_failure` cause.
// A valid descriptor on the same engine is the control that still binds.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import type { JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import { TimeRelativeTrigger, type TimeRelativeDataEngine } from './time-relative-trigger.js';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';

function quietLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

const silent = { info() {}, warn() {}, debug() {} };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function fakeJobService() {
    const jobs = new Map<string, { schedule: JobSchedule; handler: JobHandler }>();
    return {
        service: {
            async schedule(name: string, schedule: JobSchedule, handler: JobHandler) {
                jobs.set(name, { schedule, handler });
            },
            async cancel(name: string) {
                jobs.delete(name);
            },
        },
        has: (name: string) => jobs.has(name),
    };
}

const dataEngine: TimeRelativeDataEngine = {
    async find() {
        return [];
    },
    getObject(name: string) {
        return name === 'contracts' ? { name } : undefined;
    },
};

function timeRelativeFlow(name: string, timeRelative: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { timeRelative } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    } as never;
}

// The switch on: every assertion here is about a deployment that RUNS
// package-authored scheduled work, so a refusal can only come from the
// descriptor, never from the deployment policy.
withScheduledWorkOn('single');

describe('time-relative trigger -> engine status: a descriptor refusal reads unbound', () => {
    it('an invalid descriptor reads bound:false with the binding-failure cause; a valid one reads bound:true', async () => {
        const engine = new AutomationEngine(quietLogger());
        engine.registerFlow(
            'tr_both',
            timeRelativeFlow('tr_both', { object: 'contracts', dateField: 'end_date', withinDays: 30, offsetDays: [7] }),
        );
        engine.registerFlow(
            'tr_ok',
            timeRelativeFlow('tr_ok', { object: 'contracts', dateField: 'end_date', withinDays: 30 }),
        );
        const job = fakeJobService();
        engine.registerTrigger(new TimeRelativeTrigger(() => job.service, () => dataEngine, silent));
        await flush();

        const states = engine.getFlowRuntimeStates();
        const refused = states.find((s) => s.name === 'tr_both');
        const armed = states.find((s) => s.name === 'tr_ok');

        expect(refused, 'the refused flow is listed').toBeTruthy();
        expect(refused).toMatchObject({ bound: false, triggerType: 'time_relative' });
        expect(refused?.unboundCause).toBe('binding_failure');
        expect(job.has('flow-time-relative:tr_both'), 'no sweep armed for the refused flow').toBe(false);

        expect(armed, 'control: the valid flow is listed').toBeTruthy();
        expect(armed).toMatchObject({ bound: true, triggerType: 'time_relative' });
        expect(Object.keys(armed ?? {}), 'control: a bound row carries no unboundCause').not.toContain('unboundCause');
        expect(job.has('flow-time-relative:tr_ok'), 'control: the valid flow armed its sweep').toBe(true);
    });
});
