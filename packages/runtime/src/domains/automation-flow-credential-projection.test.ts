// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20552 — every `/automation` exit that answers with a flow DEFINITION serves
 * it with its inbound-hook secret withheld, and the two doors that overwrite a
 * definition by name keep the stored secret on a round trip.
 *
 * Measured before the change: `GET /automation/:name` answered the engine's
 * flow verbatim to any authenticated caller, start-node `config.secret`
 * included — the one credential ADR-0041 gives an inbound hook.
 *
 * The door holds no opinion of its own about what a credential is: it applies
 * the `flow` entry of the per-type redactor registry (`@objectstack/spec/kernel`),
 * the same entry every metadata read exit applies. That entry is registered by
 * `@objectstack/service-automation`, which this package does not depend on, so
 * a stand-in with the SAME path shape is registered here
 * (`nodes.<index>.config.secret` — pinned on the real one in service-automation's
 * `flow-credential-projection.test.ts`). What is under test is the door: which
 * definition it serves, and which one it hands the engine.
 *
 * The harness is `automation-flow-clone.test.ts`'s: a fake engine holding what
 * it is given, driven through the real `HttpDispatcher`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMetadataTypeRedactor } from '@objectstack/spec/kernel';

import { HttpDispatcher } from '../http-dispatcher.js';

const SECRET = 'stored-hook-secret-20552';
const ROTATED = 'rotated-hook-secret-20552';

/** A member-level caller: authenticated, and nothing else. */
const MEMBER = { request: {}, executionContext: { userId: 'user_member' } } as any;
/** An authoring caller — the write doors sit behind `manage_metadata` (#10145). */
const AUTHOR = { request: {}, executionContext: { userId: 'user_author', systemPermissions: ['manage_metadata'] } } as any;

const flowRedactorStandIn = (item: Record<string, unknown>) => {
    const nodes = item.nodes;
    if (!Array.isArray(nodes)) return { item, redactedKeys: [] as string[] };
    const redactedKeys: string[] = [];
    const projected = nodes.map((node: any, index: number) => {
        if (node?.type !== 'start' || !node.config || !('secret' in node.config)) return node;
        const { secret: _s, ...rest } = node.config;
        void _s;
        redactedKeys.push(`nodes.${index}.config.secret`);
        return { ...node, config: rest };
    });
    return redactedKeys.length === 0 ? { item, redactedKeys } : { item: { ...item, nodes: projected }, redactedKeys };
};

beforeEach(() => registerMetadataTypeRedactor('flow', flowRedactorStandIn));
// The registry is module-global; leave no identity overlay behind for a later block.
afterEach(() => registerMetadataTypeRedactor('flow', flowRedactorStandIn));

function inboundFlow(name = 'inbound_hook', secret: string = SECRET): Record<string, unknown> {
    return {
        name,
        label: 'Inbound hook',
        type: 'api',
        runAs: 'system',
        nodes: [
            { id: 'finish', type: 'end', label: 'End' },
            { id: 'begin', type: 'start', label: 'On Webhook', config: { triggerType: 'api', hookId: 'intake', secret } },
        ],
        edges: [{ id: 'e1', source: 'begin', target: 'finish' }],
    };
}

function makeDispatcher(seed: Record<string, unknown>[] = [inboundFlow()]) {
    const flows = new Map<string, Record<string, unknown>>(seed.map((f) => [f.name as string, f]));
    const spies = {
        getFlow: vi.fn(async (name: string) => flows.get(name) ?? null),
        registerFlow: vi.fn((name: string, definition: unknown) => {
            flows.set(name, definition as Record<string, unknown>);
            return definition;
        }),
    };
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), spies, flows };
}

const dataOf = (result: any) => result.response?.body?.data ?? result.response?.body;
const startOf = (flow: any) => (flow.nodes as any[]).find((n) => n.type === 'start');

describe('#20552 — a served definition withholds the hook secret', () => {
    it('GET /:name — a member-level read carries no credential, and everything else', async () => {
        const { dispatcher } = makeDispatcher();
        const result = await dispatcher.handleAutomation('/inbound_hook', 'GET', undefined, MEMBER);
        expect(result.response?.status).toBe(200);
        const served = dataOf(result);
        expect(JSON.stringify(result.response?.body)).not.toContain(SECRET);
        // Not an empty answer: the definition is there, minus the credential.
        expect(served.name).toBe('inbound_hook');
        expect(startOf(served).config).toEqual({ triggerType: 'api', hookId: 'intake' });
        expect(served.edges).toEqual(inboundFlow().edges);
    });

    it('POST / — the create answer withholds it; the engine is handed the body as written', async () => {
        const { dispatcher, spies } = makeDispatcher([]);
        const body = inboundFlow('fresh_hook');
        const result = await dispatcher.handleAutomation('', 'POST', body, AUTHOR);
        expect(result.response?.status).toBe(200);
        expect(JSON.stringify(result.response?.body)).not.toContain(SECRET);
        expect(startOf(spies.registerFlow.mock.calls[0]![1]).config.secret).toBe(SECRET);
    });

    it('POST /:name/clone — the answer withholds it; the clone carries the whole definition', async () => {
        const { dispatcher, flows } = makeDispatcher();
        const result = await dispatcher.handleAutomation('/inbound_hook/clone', 'POST', { name: 'inbound_hook_copy', label: 'Copy' }, AUTHOR);
        expect(result.response?.status).toBe(200);
        expect(JSON.stringify(result.response?.body)).not.toContain(SECRET);
        // ADR-0126 §7.1's whole-definition copy is unchanged: the registered
        // clone still verifies its hook with the source's secret.
        expect(startOf(flows.get('inbound_hook_copy'))!.config.secret).toBe(SECRET);
    });
});

describe('#20552 — the round trip keeps the stored secret; only an explicit value replaces it', () => {
    it('PUT /:name with the served (projected) body keeps the secret the engine holds', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const served = dataOf(await dispatcher.handleAutomation('/inbound_hook', 'GET', undefined, MEMBER));
        // An edit that also REORDERS the nodes: the secret still lands on the start node.
        const edited = { ...served, label: 'Edited', nodes: [served.nodes[1], served.nodes[0]] };

        const result = await dispatcher.handleAutomation('/inbound_hook', 'PUT', edited, AUTHOR);
        expect(result.response?.status).toBe(200);
        const handed = spies.registerFlow.mock.calls.at(-1)![1] as any;
        expect(handed.label).toBe('Edited');
        expect(startOf(handed).config.secret).toBe(SECRET);
        expect(handed.nodes[0].type).toBe('start');
        // …and the write answer is a served definition like the read.
        expect(JSON.stringify(result.response?.body)).not.toContain(SECRET);
    });

    it('POST / onto an existing name with the served body is the same overwrite, the same rule', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const served = dataOf(await dispatcher.handleAutomation('/inbound_hook', 'GET', undefined, MEMBER));
        await dispatcher.handleAutomation('', 'POST', { ...served, label: 'Recreated' }, AUTHOR);
        expect(startOf(spies.registerFlow.mock.calls.at(-1)![1]).config.secret).toBe(SECRET);
    });

    it('an explicit rotation replaces the stored secret', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const served = dataOf(await dispatcher.handleAutomation('/inbound_hook', 'GET', undefined, MEMBER));
        const rotated = structuredClone(served);
        startOf(rotated).config.secret = ROTATED;
        await dispatcher.handleAutomation('/inbound_hook', 'PUT', rotated, AUTHOR);
        expect(startOf(spies.registerFlow.mock.calls.at(-1)![1]).config.secret).toBe(ROTATED);
    });
});

describe('#20552 — anti-vacuity: the door serves exactly what the registry entry projects', () => {
    it('with an identity `flow` redactor the secret comes back — the door has no private copy', async () => {
        registerMetadataTypeRedactor('flow', (item) => ({ item, redactedKeys: [] }));
        const { dispatcher } = makeDispatcher();
        const result = await dispatcher.handleAutomation('/inbound_hook', 'GET', undefined, MEMBER);
        expect(JSON.stringify(result.response?.body)).toContain(SECRET);
    });
});
