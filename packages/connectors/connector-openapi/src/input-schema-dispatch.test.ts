// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The `inputSchema` this package builds is the one the `connector_action`
 * executor judges before dispatch** (#27995) — pinned on `buildInputSchema`'s
 * real output, through a real boot (LiteKernel + AutomationServicePlugin +
 * ConnectorOpenApiPlugin), with a recording `fetchImpl` standing in for the
 * remote:
 *
 *  1. `getPet` with `input: {}` fails the step and nothing is sent. Before the
 *     check it reached the remote as the literal `/pets/%7BpetId%7D`.
 *  2. `null` on an optional query parameter is read as absent: the call is
 *     sent, without that parameter, as omitting it would have been.
 *  3. A header or query parameter the connector's `auth` supplies, and the
 *     `Authorization` header OAS 3.0.3 §4.7.12.1 says is ignored, are not
 *     demanded of the input although the document declares them required:
 *     the credential reaches the wire from `auth`, never from the flow.
 */

import { describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorOpenApiPlugin } from './connector-openapi-plugin.js';
import type { RestAuth } from './openapi-connector.js';

const document = {
    openapi: '3.0.3',
    info: { title: 'Petstore', version: '1.0.0' },
    servers: [{ url: 'https://petstore.example.com' }],
    paths: {
        '/pets/{petId}': {
            get: {
                operationId: 'getPet',
                parameters: [
                    { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
                    { name: 'tag', in: 'query', schema: { type: 'string' } },
                    { name: 'api_key', in: 'query', required: true, schema: { type: 'string' } },
                    { name: 'X-Api-Key', in: 'header', required: true, schema: { type: 'string' } },
                    { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' } },
                ],
                responses: { '200': { description: 'ok' } },
            },
        },
    },
};

type Sent = { url: string; headers: Record<string, string> };

/** Boot a kernel with one hand-wired OpenAPI connector `pets` over {@link document}, recording every request. */
async function boot(auth: RestAuth): Promise<{ engine: AutomationEngine; sent: Sent[]; kernel: LiteKernel }> {
    const sent: Sent[] = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string> }) => {
        sent.push({ url, headers: { ...init?.headers } });
        return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' };
    }) as unknown as typeof fetch;
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.connector-metadata',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(c: { registerService(name: string, service: unknown): void }) {
            c.registerService('objectql', { registry: { listItems: () => [] } });
        },
        async start() {},
    } as never);
    kernel.use(new ConnectorOpenApiPlugin({ document, name: 'pets', auth, fetchImpl } as never));
    await kernel.bootstrap();
    return { engine: kernel.getService<AutomationEngine>('automation'), sent, kernel };
}

async function callGetPet(engine: AutomationEngine, name: string, input: Record<string, unknown>) {
    engine.registerFlow(name, {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'connector_action', label: 'Call', connectorConfig: { connectorId: 'pets', actionId: 'getPet', input } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'end' }],
    } as never);
    return engine.execute(name, {} as never);
}

describe('connector-openapi inputSchema at the connector_action door (#27995)', () => {
    it('1. getPet with input {} is refused naming the path parameter, and nothing is sent', async () => {
        const { engine, sent, kernel } = await boot({ type: 'api-key', key: 'k-123', headerName: 'X-Api-Key' });
        try {
            const result = await callGetPet(engine, 'empty', {});
            expect(result.success).toBe(false);
            expect(result.error).toContain("missing required 'path' (with 'path.petId')");
            expect(sent).toEqual([]);
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });

    it('2. null on an optional query parameter is sent as an omission', async () => {
        const { engine, sent, kernel } = await boot({ type: 'api-key', key: 'k-123', headerName: 'X-Api-Key' });
        try {
            const result = await callGetPet(engine, 'null_tag', { path: { petId: 7 }, query: { tag: null, api_key: 'q' } });
            expect(result.success, result.error).toBe(true);
            expect(sent).toHaveLength(1);
            expect(new URL(sent[0].url).pathname).toBe('/pets/7');
            expect(new URL(sent[0].url).searchParams.has('tag')).toBe(false);
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });

    it('3a. an api-key HEADER from auth, and Authorization, are not demanded of the input', async () => {
        const { engine, sent, kernel } = await boot({ type: 'api-key', key: 'k-123', headerName: 'X-Api-Key' });
        try {
            const schema = engine.getConnectorDescriptors().find((d) => d.name === 'pets')?.actions[0]?.inputSchema as any;
            expect(Object.keys(schema.properties)).not.toContain('header');
            const result = await callGetPet(engine, 'auth_header', { path: { petId: 7 }, query: { api_key: 'q' } });
            expect(result.success, result.error).toBe(true);
            expect(sent[0].headers['X-Api-Key']).toBe('k-123');
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });

    it('3b. an api-key QUERY parameter from auth is not demanded of the input', async () => {
        const { engine, sent, kernel } = await boot({ type: 'api-key', key: 'k-456', paramName: 'api_key' });
        try {
            const schema = engine.getConnectorDescriptors().find((d) => d.name === 'pets')?.actions[0]?.inputSchema as any;
            expect(schema.properties.query.properties).not.toHaveProperty('api_key');
            expect(schema.properties.header.required).toEqual(['X-Api-Key']);
            const result = await callGetPet(engine, 'auth_query', { path: { petId: 7 }, header: { 'X-Api-Key': 'h' } });
            expect(result.success, result.error).toBe(true);
            expect(new URL(sent[0].url).searchParams.get('api_key')).toBe('k-456');
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });
});
