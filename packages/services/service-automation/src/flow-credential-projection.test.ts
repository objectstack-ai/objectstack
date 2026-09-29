// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20552 — a flow's inbound-hook secret is withheld from every SERVED
 * definition, and never from what the engine binds.
 *
 * Three facts, one file, because each is worthless without the others:
 *
 *  1. `redactFlowCredentials` — the one definition of what a served flow
 *     withholds — removes the start node's `config.secret` and nothing else.
 *  2. The automation plugin registers it as the `flow` metadata-type redactor,
 *     so every metadata read exit that applies the per-type redaction
 *     withholds it without a line of its own.
 *  3. The engine binds from the protocol's EXECUTION face, not the served one.
 *     This is the half the card's route did not foresee: the plugin (re)binds
 *     flows from the protocol at `kernel:ready` and on every
 *     `metadata:reloaded`, and once (2) holds the SERVED face has no secret to
 *     give — an `api` flow bound from it is refused, and a published rotation
 *     never reaches the hook. The binding's `config` asserted below is the very
 *     object `trigger-api`'s `start()` reads the HMAC secret from.
 *
 * The fake protocol's served face runs the REAL registered redactor (looked up
 * through the registry the plugin wrote), so the "served face withholds it"
 * control is a statement about this package's registration, not a fixture.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine, FlowTrigger, FlowTriggerBinding } from './engine.js';
import { FLOW_HOOK_SECRET_KEY, redactFlowCredentials } from './flow-credential-projection.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const STORED_SECRET = 'stored-hook-secret-20552';
const ROTATED_SECRET = 'rotated-hook-secret-20552';

/** An inbound (`api`) flow whose start node carries its hook secret — not at index 0 on purpose. */
function apiFlow(name: string, secret: string = STORED_SECRET) {
    return {
        name,
        label: `Inbound ${name}`,
        type: 'api',
        runAs: 'system',
        nodes: [
            { id: 'finish', type: 'end', label: 'End' },
            {
                id: 'begin',
                type: 'start',
                label: 'On Webhook',
                config: { triggerType: 'api', hookId: 'intake', [FLOW_HOOK_SECRET_KEY]: secret },
            },
        ],
        edges: [{ id: 'e1', source: 'begin', target: 'finish' }],
    };
}

describe('redactFlowCredentials — what a served flow withholds', () => {
    it('removes the start node `config.secret` and leaves every other byte of the flow', () => {
        const flow = apiFlow('inbound_one');
        const before = structuredClone(flow);

        const { item, redactedKeys } = redactFlowCredentials(flow);

        expect(redactedKeys).toEqual(['nodes.1.config.secret']);
        expect(JSON.stringify(item)).not.toContain(STORED_SECRET);
        const nodes = item.nodes as Array<Record<string, unknown>>;
        expect(nodes[1]!.config).toEqual({ triggerType: 'api', hookId: 'intake' });
        // Everything that is not the credential survives exactly.
        expect({ ...item, nodes: undefined }).toEqual({ ...flow, nodes: undefined });
        expect(nodes[0]).toBe(flow.nodes[0]);
        expect({ ...nodes[1], config: undefined }).toEqual({ ...flow.nodes[1], config: undefined });
        // Pure: the stored body the engine keeps executing is untouched.
        expect(flow).toEqual(before);
    });

    it('withholds a secret on EVERY start node, whatever the flow’s trigger kind', () => {
        const flow = {
            name: 'odd_shape',
            label: 'Odd',
            type: 'autolaunched',
            nodes: [
                { id: 's1', type: 'start', label: 'S1', config: { secret: 'one' } },
                { id: 's2', type: 'start', label: 'S2', config: { secret: 'two', hookId: 'h' } },
                { id: 'n', type: 'assignment', label: 'N', config: { secret: 'not-a-start-node' } },
            ],
            edges: [],
        };
        const { item, redactedKeys } = redactFlowCredentials(flow);
        expect(redactedKeys).toEqual(['nodes.0.config.secret', 'nodes.1.config.secret']);
        const nodes = item.nodes as Array<{ config: Record<string, unknown> }>;
        expect(nodes[0]!.config).toEqual({});
        expect(nodes[1]!.config).toEqual({ hookId: 'h' });
        // Only the start node's key is the hook credential — nothing else is touched.
        expect(nodes[2]!.config).toEqual({ secret: 'not-a-start-node' });
    });

    it('answers "ran, withheld nothing" — the input by reference — when there is no secret', () => {
        const flow = { name: 'plain', label: 'Plain', nodes: [{ id: 's', type: 'start', label: 'S', config: {} }], edges: [] };
        const result = redactFlowCredentials(flow);
        expect(result.redactedKeys).toEqual([]);
        expect(result.item).toBe(flow);
        const noNodes = { name: 'weird', label: 'W' };
        expect(redactFlowCredentials(noNodes).item).toBe(noNodes);
    });
});

/** A recording `api` trigger — captures the binding config `trigger-api` would verify posts against. */
function recordingApiTrigger() {
    const bound = new Map<string, Record<string, unknown>>();
    const trigger: FlowTrigger = {
        type: 'api',
        start(binding: FlowTriggerBinding, _cb: (ctx: AutomationContext) => Promise<void>) {
            bound.set(binding.flowName, { ...(binding.config ?? {}) });
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, secretOf: (flowName: string) => bound.get(flowName)?.[FLOW_HOOK_SECRET_KEY] };
}

/**
 * A protocol service with BOTH faces, the way `ObjectStackProtocolImplementation`
 * has them: `getMetaItems` serves each item through the registered `flow`
 * redactor (what every metadata read exit does), `getMetaItemsForExecution`
 * hands back the stored body. `stored` is mutable so a test can model a
 * republish.
 */
function twoFacedProtocol(initial: unknown[]) {
    let stored = initial;
    const served = (item: unknown) => {
        const redactor = getMetadataTypeRedactor('flow');
        return redactor ? redactor(item as Record<string, unknown>).item : item;
    };
    return {
        service: {
            async getMetaItems(q: { type: string }) {
                return { items: q.type === 'flow' ? stored.map(served) : [] };
            },
            async getMetaItemsForExecution(q: { type: string }) {
                return { items: q.type === 'flow' ? stored : [] };
            },
        },
        setStored: (next: unknown[]) => { stored = next; },
    };
}

async function bootKernel(proto: ReturnType<typeof twoFacedProtocol>, rec: ReturnType<typeof recordingApiTrigger>) {
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
            ctx.getService('automation').registerTrigger(rec.trigger);
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    return { kernel, ctx: () => captured };
}

describe('the automation plugin — registration, and binding from the execution face', () => {
    it('registers the projection as the `flow` metadata-type redactor', async () => {
        const { kernel } = await bootKernel(twoFacedProtocol([]), recordingApiTrigger());
        expect(getMetadataTypeRedactor('flow')).toBe(redactFlowCredentials);
        await kernel.shutdown();
    });

    it('arms an inbound hook with the STORED secret while the served face withholds it', async () => {
        const rec = recordingApiTrigger();
        const proto = twoFacedProtocol([apiFlow('inbound_hook')]);
        const { kernel } = await bootKernel(proto, rec);
        await flush();

        // Control: the served face — what `GET /meta/flow` answers — has no secret.
        const served = await proto.service.getMetaItems({ type: 'flow' });
        expect(JSON.stringify(served)).not.toContain(STORED_SECRET);

        // The hook is armed with the stored secret: the binding config is the
        // object `trigger-api`'s `start()` reads it from.
        expect(rec.secretOf('inbound_hook')).toBe(STORED_SECRET);
        const engine = kernel.getService<AutomationEngine>('automation');
        expect(JSON.stringify(await engine.getFlow('inbound_hook'))).toContain(STORED_SECRET);

        await kernel.shutdown();
    });

    it('a republish keeps the hook verifiable with the original secret; a rotation replaces it', async () => {
        const rec = recordingApiTrigger();
        const proto = twoFacedProtocol([apiFlow('inbound_hook')]);
        const { kernel, ctx } = await bootKernel(proto, rec);
        await flush();
        expect(rec.secretOf('inbound_hook')).toBe(STORED_SECRET);

        // An edit-and-republish whose save carried the projected form: the store
        // kept the secret (the metadata plane's carry-forward), the label moved.
        proto.setStored([{ ...apiFlow('inbound_hook'), label: 'Edited in the designer' }]);
        await ctx().trigger('metadata:reloaded', { changed: ['flow/inbound_hook'] });
        await flush();
        expect(rec.secretOf('inbound_hook')).toBe(STORED_SECRET);
        const engine = kernel.getService<AutomationEngine>('automation');
        expect((await engine.getFlow('inbound_hook'))?.label).toBe('Edited in the designer');

        // An explicit rotation reaches the hook on the same re-sync path.
        proto.setStored([apiFlow('inbound_hook', ROTATED_SECRET)]);
        await ctx().trigger('metadata:reloaded', { changed: ['flow/inbound_hook'] });
        await flush();
        expect(rec.secretOf('inbound_hook')).toBe(ROTATED_SECRET);

        await kernel.shutdown();
    });
});
