// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: a flow PUBLISHED while the server runs must bind its trigger
// WITHOUT a restart (follow-up to #2560's cold-boot bind).
//
// #2560 bound flows at 'kernel:ready' from `protocol.getMetaItems({type:'flow'})`,
// fixing the cold boot. But a flow authored + published in the Studio while the
// server was up still did NOT bind until the next restart:
//   1. the publish path (POST /packages/:id/publish-drafts) fired no rebind event
//      the automation service listened to, and
//   2. the 'metadata:reloaded' re-sync read the WRONG source —
//      `metadata.list('flow')`, which returns 0 in a real running server (it does
//      not surface inline app flows) — so even when the hook DID fire it bound
//      nothing.
//
// The fix routes the 'metadata:reloaded' re-sync through the SAME protocol view
// the cold-boot bind uses, and the runtime dispatcher fires 'metadata:reloaded'
// after publishPackageDrafts. These tests exercise the re-sync half directly:
// once 'metadata:reloaded' fires, a flow the protocol now serves binds, a flow it
// no longer serves is torn down, and neither depends on `metadata.list`.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A record-after-update triggered flow, the shape the protocol view serves. */
function recordTriggeredFlow(name: string, object: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: { objectName: object, triggerType: 'record-after-update', condition: 'status == "closed"' },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

/** A recording FlowTrigger of type 'record_change' (stands in for the real one). */
function recordingRecordChangeTrigger() {
    const bound = new Map<string, (ctx: AutomationContext) => Promise<void>>();
    const trigger: FlowTrigger = {
        type: 'record_change',
        start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
            bound.set(binding.flowName, cb);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return {
        trigger,
        has: (n: string) => bound.has(n),
    };
}

/**
 * A MUTABLE protocol whose flow set can change after boot — models a Studio
 * publish promoting a draft flow to active (or a delete removing one), which the
 * flattened `getMetaItems({type:'flow'})` view then reflects. `setFail(true)`
 * models a transient protocol read failure.
 */
function mutableProtocolService(initial: unknown[]) {
    let flows = [...initial];
    let fail = false;
    return {
        service: {
            // [#20552] The engine reads the protocol's EXECUTION face.
            async getMetaItemsForExecution(q: { type: string }) {
                if (fail) throw new Error('protocol unavailable');
                return { items: q.type === 'flow' ? flows : [] };
            },
        },
        setFlows: (next: unknown[]) => {
            flows = [...next];
        },
        setFail: (v: boolean) => {
            fail = v;
        },
    };
}

/**
 * Boot a kernel with the automation plugin, a mutable protocol service, and a
 * recording record-change trigger (registered during init, before kernel:ready,
 * the way the real RecordChangeTriggerPlugin registers its trigger). Captures the
 * harness PluginContext so a test can fire 'metadata:reloaded' — the signal the
 * dispatcher fires after a publish. Optionally registers a `metadata` service so
 * a test can prove the re-sync does NOT depend on `metadata.list`.
 */
async function bootKernel(
    proto: ReturnType<typeof mutableProtocolService>,
    rec: ReturnType<typeof recordingRecordChangeTrigger>,
    opts: { metadata?: unknown } = {},
) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    let captured: any;
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: [] as string[],
        async init(ctx: any) {
            captured = ctx;
            ctx.registerService('protocol', proto.service);
            if (opts.metadata) ctx.registerService('metadata', opts.metadata);
            // AutomationServicePlugin.init() ran first, so the engine service
            // exists; register the trigger before kernel:ready so the bind finds it.
            ctx.getService('automation').registerTrigger(rec.trigger);
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    return { kernel, ctx: () => captured };
}

describe('flow published at runtime binds on metadata:reloaded (publish rebind, #2560 follow-up)', () => {
    it('binds a flow that appears in the protocol AFTER boot — no restart', async () => {
        const rec = recordingRecordChangeTrigger();
        const proto = mutableProtocolService([]); // boot with NO flows
        const { kernel, ctx } = await bootKernel(proto, rec);
        await flush();
        expect(rec.has('ticket_closed'), 'nothing bound at boot').toBe(false);

        // Simulate the Studio publish: the draft flow is now active and served by
        // the protocol, and the dispatcher fires 'metadata:reloaded'.
        proto.setFlows([recordTriggeredFlow('ticket_closed', 'ticket')]);
        await ctx().trigger('metadata:reloaded', { changed: ['flow/ticket_closed'] });
        await flush();

        expect(rec.has('ticket_closed'), 'published flow bound without a restart').toBe(true);
        const engine = kernel.getService<AutomationEngine>('automation');
        expect(engine.getActiveTriggerBindings().map((b) => b.flowName)).toContain('ticket_closed');

        await kernel.shutdown();
    });

    it('tears down a flow the protocol no longer serves on re-sync', async () => {
        const rec = recordingRecordChangeTrigger();
        const proto = mutableProtocolService([recordTriggeredFlow('temp_flow', 'ticket')]);
        const { kernel, ctx } = await bootKernel(proto, rec);
        await flush();
        expect(rec.has('temp_flow'), 'bound at kernel:ready').toBe(true);

        // The flow was deleted + the deletion published away.
        proto.setFlows([]);
        await ctx().trigger('metadata:reloaded', { changed: [] });
        await flush();

        expect(rec.has('temp_flow'), 'removed flow unbound on re-sync').toBe(false);
        await kernel.shutdown();
    });

    it('reads the protocol, NOT metadata.list (which returns 0 in a real server)', async () => {
        const rec = recordingRecordChangeTrigger();
        const proto = mutableProtocolService([]);
        // A metadata service that ALWAYS serves 0 flows — the exact real-server
        // behavior that made the pre-fix `metadata.list('flow')` re-sync a silent
        // no-op. The re-sync must ignore it and read the protocol.
        const metadata = { async list() { return []; } };
        const { kernel, ctx } = await bootKernel(proto, rec, { metadata });
        await flush();

        proto.setFlows([recordTriggeredFlow('ticket_closed', 'ticket')]);
        await ctx().trigger('metadata:reloaded', { changed: [] });
        await flush();

        expect(
            rec.has('ticket_closed'),
            'bound from the protocol despite an empty metadata.list',
        ).toBe(true);
        await kernel.shutdown();
    });

    it('does not tear down live flows when the protocol read fails', async () => {
        const rec = recordingRecordChangeTrigger();
        const proto = mutableProtocolService([recordTriggeredFlow('keep_me', 'ticket')]);
        const { kernel, ctx } = await bootKernel(proto, rec);
        await flush();
        expect(rec.has('keep_me'), 'bound at kernel:ready').toBe(true);

        // A transient protocol failure must be a no-op, never an unbind: a failed
        // read is "couldn't read", not "zero flows".
        proto.setFail(true);
        await ctx().trigger('metadata:reloaded', { changed: [] });
        await flush();

        expect(rec.has('keep_me'), 'live flow survives a failed protocol read').toBe(true);
        await kernel.shutdown();
    });
});
