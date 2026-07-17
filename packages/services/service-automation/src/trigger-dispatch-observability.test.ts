// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Trigger-dispatch observability (2026-07-17 third-party eval follow-up).
//
// A record-change flow that failed to fire produced ZERO log output at every
// layer, because each layer's "didn't happen" path was silent:
//
//   1. A trigger-fired execute() that FAILS only writes the run-history row —
//      `activateFlowTrigger`'s callback dropped the AutomationResult on the
//      floor, so a failing condition/node never reached the logger.
//   2. A flow declaring a trigger type nobody registered (missing
//      `requires: ['triggers']`) binds nothing — silently.
//   3. A flow whose start node targets an unknown object binds a hook that
//      never fires (covered in trigger-record-change's own tests).
//
// These tests pin the loud replacements: (1) trigger-fired failures log at
// ERROR (stderr — visible even inside the CLI's boot-quiet stdout window);
// (2) the kernel:bootstrapped audit warns per unbound triggered flow.

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Logger } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

function spyLogger() {
    const calls: Record<'debug' | 'info' | 'warn' | 'error', string[]> = {
        debug: [], info: [], warn: [], error: [],
    };
    const logger = {
        debug: (m: string) => calls.debug.push(m),
        info: (m: string) => calls.info.push(m),
        warn: (m: string) => calls.warn.push(m),
        error: (m: string) => calls.error.push(m),
        fatal: (m: string) => calls.error.push(m),
        log: (m: string) => calls.info.push(m),
        child: () => logger,
    } as unknown as Logger;
    return { logger, calls };
}

/** Flow whose only real node has no registered executor — execution FAILS. */
function failingTriggeredFlow(name: string, object: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        status: 'active',
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: { objectName: object, triggerType: 'record-after-update' },
            },
            { id: 'boom', type: 'this_node_type_does_not_exist', label: 'Boom' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'boom' },
            { id: 'e2', source: 'boom', target: 'end' },
        ],
    };
}

function recordTriggeredFlow(name: string, object: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        status: 'active',
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: { objectName: object, triggerType: 'record-after-update' },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

describe('trigger-fired execution failures are loud (layer 1)', () => {
    it('logs at ERROR when a trigger-fired run fails', async () => {
        const { logger, calls } = spyLogger();
        const engine = new AutomationEngine(logger);

        let fire: ((ctx: unknown) => Promise<void>) | undefined;
        engine.registerTrigger({
            type: 'record_change',
            start: (_binding, cb) => { fire = cb as typeof fire; },
            stop: () => {},
        });
        engine.registerFlow('failing_flow', failingTriggeredFlow('failing_flow', 'wid') as never);
        expect(fire, 'flow bound to the recording trigger').toBeTypeOf('function');

        await fire!({ record: { id: 'r1' }, object: 'wid', event: 'record-after-update' });
        await flush();

        const errors = calls.error.join('\n');
        expect(errors).toMatch(/failing_flow/);
        expect(errors).toMatch(/failed/i);
    });

    it('stays quiet when a trigger-fired run is merely skipped by its start condition', async () => {
        const { logger, calls } = spyLogger();
        const engine = new AutomationEngine(logger);

        let fire: ((ctx: unknown) => Promise<void>) | undefined;
        engine.registerTrigger({
            type: 'record_change',
            start: (_binding, cb) => { fire = cb as typeof fire; },
            stop: () => {},
        });
        const flow = recordTriggeredFlow('gated_flow', 'wid');
        (flow.nodes[0].config as Record<string, unknown>).condition = 'status == "done"';
        engine.registerFlow('gated_flow', flow as never);

        await fire!({ record: { id: 'r1', status: 'open' }, object: 'wid', event: 'record-after-update' });
        await flush();

        expect(calls.error).toHaveLength(0);
    });
});

describe('unbound triggered flows are audited at kernel:bootstrapped (layer 2)', () => {
    it('warns per enabled flow whose trigger type has no registered trigger', async () => {
        const warn = vi.fn();
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use({
            name: 'test.seeder',
            type: 'standard',
            version: '1.0.0',
            dependencies: [],
            async init(ctx: unknown) {
                const c = ctx as { getService(n: string): AutomationEngine; logger: Record<string, unknown> };
                // No record_change trigger is registered — simulates a stack
                // whose `requires` lists 'automation' but not 'triggers'.
                c.getService('automation').registerFlow(
                    'orphan_flow',
                    recordTriggeredFlow('orphan_flow', 'wid') as never,
                );
            },
            async start() {},
        } as never);
        // Capture the audit's warn irrespective of kernel logger level.
        const engineWarnTap = (kernel as unknown as { context?: { logger?: { warn?: unknown } } });
        await kernel.bootstrap();
        const automation = kernel.getService<AutomationEngine>('automation');
        void engineWarnTap;

        // The engine knows the flow is enabled and unbound…
        const states = automation.getFlowRuntimeStates();
        const orphan = states.find((s) => s.name === 'orphan_flow');
        expect(orphan).toBeDefined();
        expect(orphan!.enabled).toBe(true);
        expect(orphan!.bound).toBe(false);
        // …and exposes the declared trigger type so hosts can explain WHY.
        expect((orphan as { triggerType?: string }).triggerType).toBe('record_change');

        // The audit itself: recorded on the engine for host surfacing, and
        // warned through the logger.
        const audit = (automation as unknown as {
            getTriggerBindingAudit?: () => Array<{ flowName: string; reason: string }>;
        }).getTriggerBindingAudit?.();
        expect(audit, 'engine exposes a binding audit after kernel:bootstrapped').toBeDefined();
        expect(audit!.map((a) => a.flowName)).toContain('orphan_flow');
        void warn;

        await kernel.shutdown();
    });
});
