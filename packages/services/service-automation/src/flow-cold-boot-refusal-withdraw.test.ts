// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A flow the `kernel:ready` cold-boot bind refuses is withdrawn, not left
 * registered from the boot pull (#21848).
 *
 * A boot registers flows twice. The boot pull (`AutomationServicePlugin.start()`)
 * runs before a plugin that contributes a node type has registered its executor
 * from its own `start()`, so it cannot check that node's config keys against the
 * descriptor's `configSchema`. The `kernel:ready` bind re-registers every flow
 * once the executor exists. When that bind refused the flow, it only warned: the
 * boot pull's registration stayed, `active` and bound to its trigger.
 *
 * Pinned on the real plugin path (a `LiteKernel`, the boot pull and the
 * protocol view serving the same packaged flows, the node type's executor
 * registered from a later plugin's `start()`):
 *  - the refused flow is withdrawn — not registered, not bound;
 *  - only that flow: the package's valid flow stays registered and bound.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding, NodeExecutor } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A plugin node type the spec knows nothing about: its descriptor declares `count`. */
const STAMP = 'test_stamp';

function stampExecutor(): NodeExecutor {
    return {
        type: STAMP,
        descriptor: defineActionDescriptor({
            type: STAMP,
            version: '1.0.0',
            name: 'Stamp',
            category: 'custom',
            paradigms: ['flow'],
            source: 'plugin',
            configSchema: { type: 'object', properties: { count: { type: 'number' } } },
        }),
        async execute() {
            return { success: true };
        },
    };
}

/** An active, record-triggered, packaged flow whose one plugin node carries `config`. */
function stampFlow(name: string, config: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        status: 'active',
        _packageId: 'app.fixture',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'expense', triggerType: 'record-after-create' } },
            { id: 'stamp', type: STAMP, label: 'Stamp', config },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'stamp' },
            { id: 'e2', source: 'stamp', target: 'end' },
        ],
    };
}

/** A recording `record_change` trigger (stands in for the real one). */
function recordingRecordChangeTrigger() {
    const bound = new Set<string>();
    const trigger: FlowTrigger = {
        type: 'record_change',
        start(binding: FlowTriggerBinding, _cb: (ctx: AutomationContext) => Promise<void>) {
            bound.add(binding.flowName);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, has: (n: string) => bound.has(n) };
}

/**
 * The two reads a boot binds flows from: the `objectql` registry (the boot
 * pull) and the protocol's flow view (the `kernel:ready` bind), both serving
 * the same packaged flows, as a real boot does.
 */
function flowSourcesPlugin(flows: unknown[], rec: ReturnType<typeof recordingRecordChangeTrigger>): Plugin {
    return {
        name: 'test.flow-sources',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            const c = ctx as unknown as {
                registerService(n: string, s: unknown): void;
                getService<T>(n: string): T;
            };
            c.registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? flows : []),
                    getObject: () => undefined,
                },
            });
            c.registerService('protocol', {
                async getMetaItemsForExecution(q: { type: string }) {
                    return { items: q.type === 'flow' ? flows : [] };
                },
            });
            c.getService<AutomationEngine>('automation').registerTrigger(rec.trigger);
        },
    };
}

/** Contributes the plugin node type from its own `start()`, after the boot pull. */
function lateStampPlugin(): Plugin {
    return {
        name: 'test.late-stamp',
        version: '1.0.0',
        async init() {},
        async start(ctx: PluginContext) {
            (ctx as unknown as { getService<T>(n: string): T })
                .getService<AutomationEngine>('automation')
                .registerNodeExecutor(stampExecutor());
        },
    };
}

describe('boot: a flow the kernel:ready bind refuses does not stay registered from the boot pull', () => {
    it('withdraws the refused flow and keeps the valid one bound', async () => {
        const rec = recordingRecordChangeTrigger();
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        // `cuont` is a key the node type's descriptor does not declare.
        kernel.use(flowSourcesPlugin([stampFlow('typo', { cuont: 2 }), stampFlow('valid', { count: 2 })], rec));
        kernel.use(lateStampPlugin());
        await kernel.bootstrap();
        await flush();

        const engine = kernel.getService<AutomationEngine>('automation');
        expect(await engine.getFlow('typo'), 'refused at load ⇒ not registered').toBeNull();
        expect(rec.has('typo'), 'refused at load ⇒ not bound').toBe(false);
        expect(engine.getActiveTriggerBindings().map((b) => b.flowName)).not.toContain('typo');

        // Only the refused flow: the package's valid flow is registered and bound.
        expect(await engine.getFlow('valid')).not.toBeNull();
        expect(rec.has('valid')).toBe(true);

        await kernel.shutdown();
    });

    it('the refusal is the kernel:ready bind\'s: the same body registers when the executor is absent', async () => {
        // The control for the pin above: with no plugin contributing the node
        // type, neither boot step can check its keys, so the flow registers.
        // A green pin above therefore reads the bind's refusal, not one the
        // boot pull or the flow parse made on its own.
        const rec = recordingRecordChangeTrigger();
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use(flowSourcesPlugin([stampFlow('typo', { cuont: 2 })], rec));
        await kernel.bootstrap();
        await flush();

        const engine = kernel.getService<AutomationEngine>('automation');
        expect(await engine.getFlow('typo')).not.toBeNull();

        await kernel.shutdown();
    });
});
