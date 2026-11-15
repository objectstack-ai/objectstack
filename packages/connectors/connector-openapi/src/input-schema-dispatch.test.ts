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

type Sent = { url: string; headers: Record<string, string>; body?: string };

/** Boot a kernel with one hand-wired OpenAPI connector `pets` over `doc` ({@link document} by default), recording every request. */
async function boot(auth: RestAuth, doc: object = document): Promise<{ engine: AutomationEngine; sent: Sent[]; kernel: LiteKernel }> {
    const sent: Sent[] = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
        sent.push({ url, headers: { ...init?.headers }, body: init?.body });
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
    kernel.use(new ConnectorOpenApiPlugin({ document: doc, name: 'pets', auth, fetchImpl } as never));
    await kernel.bootstrap();
    return { engine: kernel.getService<AutomationEngine>('automation'), sent, kernel };
}

async function callGetPet(engine: AutomationEngine, name: string, input: Record<string, unknown>, actionId = 'getPet') {
    engine.registerFlow(name, {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'connector_action', label: 'Call', connectorConfig: { connectorId: 'pets', actionId, input } },
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

/**
 * #33553 — the executor refuses a key an object schema does not declare, so
 * what the generator skips on a document nobody de-referenced must read as
 * open: an unresolved `$ref` parameter opens every location the handler
 * sends, and an unresolved `$ref` or schemaless request body is `body: {}`.
 * On `main` before the refusal these calls dispatched and worked; they still do.
 */
describe('connector-openapi skipped $ref inputs still dispatch under the undeclared-key refusal (#33553)', () => {
    const refDocument = {
        openapi: '3.0.3',
        info: { title: 'Petstore', version: '1.0.0' },
        servers: [{ url: 'https://petstore.example.com' }],
        components: {
            parameters: {
                PetId: { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
                Tag: { name: 'tag', in: 'query', schema: { type: 'string' } },
            },
            requestBodies: { Pet: { content: { 'application/json': { schema: { type: 'object' } } } } },
        },
        paths: {
            '/pets/{petId}': {
                put: {
                    operationId: 'putPet',
                    parameters: [
                        { $ref: '#/components/parameters/PetId' },
                        { $ref: '#/components/parameters/Tag' },
                        { name: 'limit', in: 'query', schema: { type: 'integer' } },
                    ],
                    requestBody: { $ref: '#/components/requestBodies/Pet' },
                    responses: { '200': { description: 'ok' } },
                },
                post: {
                    operationId: 'postPetRaw',
                    parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
                    requestBody: { required: true, content: { 'application/octet-stream': {} } },
                    responses: { '200': { description: 'ok' } },
                },
            },
        },
    };
    const none: RestAuth = { type: 'none' };

    it('1. an unresolved $ref parameter opens path, query and header; the declared query parameter stays typed', async () => {
        const { engine, sent, kernel } = await boot(none, refDocument);
        try {
            const schema = engine.getConnectorDescriptors().find((d) => d.name === 'pets')?.actions
                .find((a) => a.key === 'putPet')?.inputSchema as any;
            expect(schema.properties.path).toEqual({ type: 'object', additionalProperties: true });
            expect(schema.properties.header).toEqual({ type: 'object', additionalProperties: true });
            expect(schema.properties.query).toEqual({
                type: 'object', properties: { limit: { type: 'integer' } }, additionalProperties: true,
            });
            expect(schema.properties.body).toEqual({});
            expect(schema.required).toBeUndefined();

            const result = await callGetPet(engine, 'ref_params', {
                path: { petId: 7 }, query: { tag: 'dog', limit: 2 }, body: { name: 'Rex' },
            }, 'putPet');
            expect(result.success, result.error).toBe(true);
            expect(sent).toHaveLength(1);
            const url = new URL(sent[0].url);
            expect(url.pathname).toBe('/pets/7');
            expect(url.searchParams.get('tag')).toBe('dog');
            expect(sent[0].body).toBe(JSON.stringify({ name: 'Rex' }));

            const wrongType = await callGetPet(engine, 'ref_params_typed', {
                path: { petId: 7 }, query: { limit: 'two' },
            }, 'putPet');
            expect(wrongType.success).toBe(false);
            expect(sent).toHaveLength(1);
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });

    it('2. a request body whose content carries no schema is declared as body: {} and dispatches', async () => {
        const { engine, sent, kernel } = await boot(none, refDocument);
        try {
            const schema = engine.getConnectorDescriptors().find((d) => d.name === 'pets')?.actions
                .find((a) => a.key === 'postPetRaw')?.inputSchema as any;
            expect(schema.properties.body).toEqual({});
            expect(schema.required).toEqual(['path', 'body']);
            expect(schema.properties.path.additionalProperties).toBeUndefined();

            const result = await callGetPet(engine, 'raw_body', { path: { petId: 3 }, body: 'raw' }, 'postPetRaw');
            expect(result.success, result.error).toBe(true);
            expect(sent).toHaveLength(1);
            expect(new URL(sent[0].url).pathname).toBe('/pets/3');
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });
});
