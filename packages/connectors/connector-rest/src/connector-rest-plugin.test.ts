// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorRestPlugin } from './connector-rest-plugin.js';

/** A fetch stub recording calls, returning a fixed JSON response. */
function stubFetch() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
            status: 201,
            ok: true,
            headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
            json: async () => ({ id: 'created-1' }),
            text: async () => '{"id":"created-1"}',
        };
    }) as unknown as typeof fetch;
    return { impl, calls };
}

describe('ConnectorRestPlugin — end to end with the automation engine', () => {
    it('registers the REST connector so a connector_action flow dispatches to it', async () => {
        const { impl, calls } = stubFetch();

        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        kernel.use(
            new ConnectorRestPlugin({
                baseUrl: 'https://api.example.com',
                auth: { type: 'bearer', token: 'secret-token' },
                fetchImpl: impl,
            }),
        );
        await kernel.bootstrap();

        const engine = kernel.getService<AutomationEngine>('automation');

        // The baseline node and the plugin-contributed connector are both present.
        expect(engine.getRegisteredNodeTypes()).toContain('connector_action');
        expect(engine.getRegisteredConnectors()).toContain('rest');

        engine.registerFlow('create_via_rest', {
            name: 'create_via_rest',
            label: 'Create via REST',
            type: 'autolaunched',
            variables: [{ name: 'call.body', type: 'json', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'POST /items',
                    connectorConfig: {
                        connectorId: 'rest',
                        actionId: 'request',
                        input: { method: 'POST', path: '/items', body: { name: 'Widget' } },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('create_via_rest');

        expect(result.success).toBe(true);
        // The REST connector handled the dispatch: one fetch with auth + body.
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://api.example.com/items');
        expect(calls[0].init.method).toBe('POST');
        expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-token');
        // The action output propagated back into the flow.
        expect(result.output).toEqual({ 'call.body': { id: 'created-1' } });

        await kernel.shutdown();
    });

    it('materializes a declarative `provider: rest` instance from stack metadata (ADR-0096)', async () => {
        const { impl, calls } = stubFetch();

        // A provider-bound `connectors:` entry as it sits in the ObjectQL registry.
        const declared = [
            {
                name: 'billing',
                label: 'Billing API',
                type: 'api',
                provider: 'rest',
                providerConfig: { baseUrl: 'https://billing.example.com' },
                auth: { type: 'bearer', credentialRef: 'BILLING_TOKEN' },
            },
        ];

        const kernel = new LiteKernel();
        // The plugin, with no baseUrl, contributes ONLY the `rest` provider factory.
        kernel.use(new AutomationServicePlugin({ credentialResolver: (r) => (r === 'BILLING_TOKEN' ? 'sk-live' : undefined) }));
        kernel.use(new ConnectorRestPlugin({ fetchImpl: impl }));
        // A tiny harness that serves the declared connector metadata to the automation service.
        kernel.use({
            name: 'test.metadata',
            type: 'standard',
            version: '1.0.0',
            dependencies: [],
            async init(ctx: any) {
                ctx.registerService('objectql', {
                    registry: { listItems: (t: string) => (t === 'connector' ? declared : []) },
                });
            },
            async start() {},
        } as never);

        await kernel.bootstrap();
        const engine = kernel.getService<AutomationEngine>('automation');

        // Materialized under the declared name, tagged declarative, and listed.
        expect(engine.getRegisteredConnectors()).toContain('billing');
        expect(engine.getConnectorOrigin('billing')).toBe('declarative');
        expect(engine.getConnectorDescriptors().find((d) => d.name === 'billing')?.actions.map((a) => a.key)).toEqual(['request']);

        engine.registerFlow('call_billing', {
            name: 'call_billing',
            label: 'Call Billing',
            type: 'autolaunched',
            variables: [{ name: 'call.status', type: 'number', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'GET /invoices',
                    connectorConfig: { connectorId: 'billing', actionId: 'request', input: { path: '/invoices' } },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('call_billing');
        expect(result.success).toBe(true);
        // Dispatched to the resolved base URL, with the credentialRef-resolved bearer token.
        expect(calls[0].url).toBe('https://billing.example.com/invoices');
        expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-live');

        await kernel.shutdown();
    });
});
