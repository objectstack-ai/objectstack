// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: `os dev` recompiles dist/objectstack.json on a src edit, and
// MetadataPlugin reloads it into the metadata service + fires 'metadata:reloaded'.
// The automation engine, however, pulled its flow definitions + trigger bindings
// ONCE at boot — so without re-syncing, an edited SCHEDULE-triggered flow keeps
// firing its OLD definition (old runAs / schedule / logic) until a full restart.
//
// This proves the fix end-to-end on the automation side: the 'metadata:reloaded'
// hook re-registers every current flow (re-binding its trigger — for a scheduled
// flow that is the job cancel + reschedule the ScheduleTrigger performs) and
// tears down flows that vanished from the artifact. The re-sync reads the
// protocol's flattened flow view (`getMetaItems({type:'flow'})`) — the SAME
// source #2560's cold-boot bind uses — so the fake here is a `protocol` service,
// not a `metadata` one (`metadata.list('flow')` returns 0 in a real server; the
// same hook also fires on a Studio publish). A recording trigger stands in for
// the concrete ScheduleTrigger (whose idempotent job re-bind is covered by
// trigger-schedule's schedule-runas-e2e test) so this stays dependency-light.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A schedule-triggered flow that touches data, parameterized by runAs + interval. */
function scheduledFlow(name: string, runAs: 'system' | 'user', intervalMs: number) {
    return {
        name,
        label: name,
        type: 'schedule',
        runAs,
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { schedule: { type: 'interval', intervalMs } } },
            { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { a: 1 } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'mk' },
            { id: 'e2', source: 'mk', target: 'end' },
        ],
    };
}

/**
 * A FlowTrigger of type 'schedule' that records start/stop and, like the real
 * ScheduleTrigger, keeps exactly one binding per flow (re-bind drops the prior).
 * `fire()` invokes the engine callback the way a cron tick would.
 */
function recordingScheduleTrigger() {
    const bound = new Map<string, { schedule: any; cb: (ctx: AutomationContext) => Promise<void> }>();
    const events: Array<{ op: 'start' | 'stop'; flow: string }> = [];
    const trigger: FlowTrigger = {
        type: 'schedule',
        start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
            const schedule = binding.schedule ?? (binding.config as any)?.schedule;
            bound.set(binding.flowName, { schedule, cb });
            events.push({ op: 'start', flow: binding.flowName });
        },
        stop(flowName: string) {
            if (bound.delete(flowName)) events.push({ op: 'stop', flow: flowName });
        },
    };
    return {
        trigger,
        has: (n: string) => bound.has(n),
        intervalOf: (n: string) => bound.get(n)?.schedule?.intervalMs,
        fire: async (n: string) => {
            await bound.get(n)?.cb({ event: 'schedule', params: { flowName: n } } as AutomationContext);
        },
        events,
    };
}

/** Stub `create_record` executor that captures the runAs it is handed. */
function captureRunAs(engine: AutomationEngine): Array<string | undefined> {
    const seen: Array<string | undefined> = [];
    engine.registerNodeExecutor({
        type: 'create_record',
        async execute(_node: unknown, _vars: unknown, context: AutomationContext) {
            seen.push(context.runAs);
            return { success: true, output: {} };
        },
    } as never);
    return seen;
}

/**
 * A mutable fake `protocol` service exposing just the flattened
 * `getMetaItems({type:'flow'})` view the re-sync reads (returned as the
 * `{ items: [...] }` envelope the real protocol serves).
 */
function fakeProtocolService(initial: unknown[]) {
    let flows = initial;
    return {
        service: {
            async getMetaItems(q: { type: string }) {
                return { items: q.type === 'flow' ? flows : [] };
            },
        },
        setFlows: (next: unknown[]) => { flows = next; },
    };
}

async function bootKernel(proto: { service: unknown }) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: [] as string[],
        async init(ctx: any) {
            ctx.registerService('protocol', proto.service);
        },
        async start() {},
    };
    kernel.use(harness as never);
    kernel.use(new AutomationServicePlugin());
    await kernel.bootstrap();
    return kernel;
}

const reload = (kernel: LiteKernel) => (kernel as any).context.trigger('metadata:reloaded', {});

// [#17396] Time-triggered flows arm only where the deployment runs
// package-authored scheduled work, and the switch is OFF by default in every
// posture. Without this, every trigger-wiring assertion below fails for a
// reason that has nothing to do with wiring.
withScheduledWorkOn();

describe("scheduled flow hot-reload re-bind (metadata:reloaded re-sync)", () => {
    it('re-binds an edited scheduled flow to its NEW definition without a restart', async () => {
        const proto = fakeProtocolService([scheduledFlow('sweep', 'user', 1000)]);
        const kernel = await bootKernel(proto);
        const engine = kernel.getService<AutomationEngine>('automation');
        const seen = captureRunAs(engine);
        const sched = recordingScheduleTrigger();
        engine.registerTrigger(sched.trigger);

        // First reload binds v1 (runAs:user, interval 1000) — like the boot bind.
        await reload(kernel);
        await flush();
        expect(sched.has('sweep'), 'flow bound to the schedule trigger').toBe(true);
        expect(sched.intervalOf('sweep')).toBe(1000);
        await sched.fire('sweep');
        expect(seen[seen.length - 1], 'v1 runs as user').toBe('user');

        // Edit the flow: runAs:system + interval 5000. Recompile → reload.
        sched.events.length = 0;
        proto.setFlows([scheduledFlow('sweep', 'system', 5000)]);
        await reload(kernel);
        await flush();

        // The OLD binding was torn down and a NEW one created (not left stale).
        expect(sched.events).toEqual([
            { op: 'stop', flow: 'sweep' },
            { op: 'start', flow: 'sweep' },
        ]);
        expect(sched.intervalOf('sweep'), 'schedule re-bound to the new interval').toBe(5000);

        // The fired job now runs the NEW definition — the actual footgun fixed.
        await sched.fire('sweep');
        expect(seen[seen.length - 1], 'v2 runs elevated as system after reload').toBe('system');

        await kernel.shutdown();
    });

    it('tears down a scheduled flow that was deleted from the artifact', async () => {
        const proto = fakeProtocolService([scheduledFlow('sweep', 'user', 1000)]);
        const kernel = await bootKernel(proto);
        const engine = kernel.getService<AutomationEngine>('automation');
        const sched = recordingScheduleTrigger();
        engine.registerTrigger(sched.trigger);

        await reload(kernel);
        await flush();
        expect(sched.has('sweep')).toBe(true);

        // Delete the flow file → recompiled artifact no longer carries it.
        proto.setFlows([]);
        await reload(kernel);
        await flush();

        expect(sched.has('sweep'), 'deleted flow unbound — its job stops firing').toBe(false);
        expect(await engine.listFlows()).not.toContain('sweep');

        await kernel.shutdown();
    });
});
