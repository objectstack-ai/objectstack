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

    it('materializes a declarative `provider: rest` instance from stack metadata (ADR-0097)', async () => {
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

// [#27237] The ruling on #27237 (comment 6470087293), on the REAL rest
// provider: its handler answers an upstream 401 as `{ status, ok, body }`, so
// the automation service reads the refusal off the first credentialed call —
// the call still answers as it was, and the instance is degraded after it,
// naming the reference, with the echoed credential withheld.
describe('ConnectorRestPlugin — a credential the upstream refuses (#27237)', () => {
    it('degrades the declarative instance on the first call answering 401', async () => {
        const DUMMY = 'dummy-vault-token-0005';
        const calls: string[] = [];
        const impl = (async (url: string) => {
            calls.push(url);
            return {
                status: 401,
                ok: false,
                headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
                json: async () => ({ message: `bad credentials: ${DUMMY}` }),
                text: async () => JSON.stringify({ message: `bad credentials: ${DUMMY}` }),
            };
        }) as unknown as typeof fetch;
        const declared = [{
            name: 'billing',
            label: 'Billing API',
            type: 'api',
            provider: 'rest',
            providerConfig: { baseUrl: 'https://billing.example.com' },
            auth: { type: 'bearer', credentialRef: 'DUMMY_BILLING_TOKEN_27237' },
        }];
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin({ credentialResolver: (r) => (r === 'DUMMY_BILLING_TOKEN_27237' ? DUMMY : undefined) }));
        kernel.use(new ConnectorRestPlugin({ fetchImpl: impl }));
        kernel.use({
            name: 'test.metadata',
            type: 'standard',
            version: '1.0.0',
            dependencies: [],
            async init(ctx: any) {
                ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            },
            async start() {},
        } as never);
        await kernel.bootstrap();
        const engine = kernel.getService<AutomationEngine>('automation');
        expect(engine.getConnectorDegradedReason('billing')).toBeUndefined();

        const answered = await engine.resolveConnectorAction('billing', 'request')!({ path: '/invoices' }, {} as never);
        expect(answered).toMatchObject({ status: 401, ok: false });
        expect(calls).toEqual(['https://billing.example.com/invoices']);

        const reason = engine.getConnectorDegradedReason('billing') ?? '';
        expect(reason).toContain('(HTTP 401) on a call');
        expect(reason).toContain("credential 'DUMMY_BILLING_TOKEN_27237'");
        expect(reason).toContain('[credential withheld]');
        expect(reason.includes(DUMMY)).toBe(false);
        expect(engine.resolveConnectorAction('billing', 'request')).toBeUndefined();

        await kernel.shutdown();
    });
});

// ADR-0143 D2.3 end to end, on the REAL host and the REAL rest provider: a
// declarative `signed` instance is materialized with the host's signer, every
// call carries an ACS3-HMAC-SHA256 signature, and the signing key appears in
// nothing the instance sends or publishes. (The signature's bytes are pinned
// against the vendor's worked example in service-automation's signer test.)
describe('ConnectorRestPlugin — a declarative `signed` instance (ADR-0143 D2.3)', () => {
    it('signs every call with the key its credentialRef names, and never sends or lists the key', async () => {
        const KEY = 'dummy-aliyun-access-key-secret-26710';
        const calls: Array<{ url: string; headers: Record<string, string> }> = [];
        const impl = (async (url: string, init: RequestInit) => {
            calls.push({ url, headers: init.headers as Record<string, string> });
            return new Response('{"RequestId":"r-1"}', { status: 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch;
        const declared = [{
            name: 'aliyun_ecs',
            label: 'Aliyun ECS',
            type: 'api',
            provider: 'rest',
            providerConfig: { baseUrl: 'https://ecs.cn-shanghai.aliyuncs.com', defaultHeaders: { 'x-acs-version': '2014-05-26' } },
            auth: { type: 'signed', scheme: 'aliyun-acs3-hmac-sha256', keyId: 'YourAccessKeyId', credentialRef: 'ALIYUN_SECRET_26710' },
        }];
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin({ credentialResolver: (r) => (r === 'ALIYUN_SECRET_26710' ? KEY : undefined) }));
        kernel.use(new ConnectorRestPlugin({ fetchImpl: impl }));
        kernel.use({
            name: 'test.metadata',
            type: 'standard',
            version: '1.0.0',
            dependencies: [],
            async init(ctx: any) {
                ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            },
            async start() {},
        } as never);
        await kernel.bootstrap();
        const engine = kernel.getService<AutomationEngine>('automation');
        expect(engine.getConnectorDegradedReason('aliyun_ecs')).toBeUndefined();

        const request = engine.resolveConnectorAction('aliyun_ecs', 'request')!;
        const answered = await request({ method: 'POST', path: '/', query: { RegionId: 'cn-shanghai' }, headers: { 'x-acs-action': 'DescribeRegions' } }, {} as never);
        await request({ method: 'POST', path: '/', query: { RegionId: 'cn-shanghai' }, headers: { 'x-acs-action': 'DescribeRegions' } }, {} as never);
        expect(answered).toEqual({ status: 200, ok: true, body: { RequestId: 'r-1' } });

        expect(calls).toHaveLength(2);
        expect(calls[0]!.url).toBe('https://ecs.cn-shanghai.aliyuncs.com/?RegionId=cn-shanghai');
        expect(calls[0]!.headers.authorization).toMatch(
            /^ACS3-HMAC-SHA256 Credential=YourAccessKeyId,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=[0-9a-f]{64}$/,
        );
        expect(calls[0]!.headers['x-acs-action']).toBe('DescribeRegions');
        // Two calls, two nonces, two signatures: nothing is replayed.
        expect(calls[0]!.headers['x-acs-signature-nonce']).not.toBe(calls[1]!.headers['x-acs-signature-nonce']);
        expect(calls[0]!.headers.authorization).not.toBe(calls[1]!.headers.authorization);

        expect(JSON.stringify(calls)).not.toContain(KEY);
        expect(JSON.stringify(engine.getConnectorDescriptors())).not.toContain(KEY);

        await kernel.shutdown();
    });

    it('signs a tencentcloud-tc3-hmac-sha256 instance the same way, with the service named by its host', async () => {
        const KEY = 'dummy-tencent-secret-key-26710';
        const calls: Array<{ url: string; headers: Record<string, string> }> = [];
        const impl = (async (url: string, init: RequestInit) => {
            calls.push({ url, headers: init.headers as Record<string, string> });
            return new Response('{"Response":{"RequestId":"r-1"}}', { status: 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch;
        const declared = [{
            name: 'tencent_cvm',
            label: 'Tencent CVM',
            type: 'api',
            provider: 'rest',
            providerConfig: { baseUrl: 'https://cvm.tencentcloudapi.com', defaultHeaders: { 'X-TC-Version': '2017-03-12', 'X-TC-Region': 'ap-guangzhou' } },
            auth: { type: 'signed', scheme: 'tencentcloud-tc3-hmac-sha256', keyId: 'test-secret-id', credentialRef: 'TENCENT_SECRET_26710' },
        }];
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin({ credentialResolver: (r) => (r === 'TENCENT_SECRET_26710' ? KEY : undefined) }));
        kernel.use(new ConnectorRestPlugin({ fetchImpl: impl }));
        kernel.use({
            name: 'test.metadata',
            type: 'standard',
            version: '1.0.0',
            dependencies: [],
            async init(ctx: any) {
                ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            },
            async start() {},
        } as never);
        await kernel.bootstrap();
        const engine = kernel.getService<AutomationEngine>('automation');
        expect(engine.getConnectorDegradedReason('tencent_cvm')).toBeUndefined();

        const request = engine.resolveConnectorAction('tencent_cvm', 'request')!;
        const answered = await request({ method: 'POST', path: '/', body: { Limit: 1 }, headers: { 'X-TC-Action': 'DescribeInstances' } }, {} as never);
        expect(answered).toEqual({ status: 200, ok: true, body: { Response: { RequestId: 'r-1' } } });

        expect(calls).toHaveLength(1);
        const headers = calls[0]!.headers;
        expect(headers.authorization).toMatch(
            /^TC3-HMAC-SHA256 Credential=test-secret-id\/\d{4}-\d{2}-\d{2}\/cvm\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/,
        );
        expect(headers['x-tc-timestamp']).toMatch(/^\d{10}$/);
        expect(headers['content-type']).toBe('application/json');
        expect(headers['x-tc-action']).toBe('DescribeInstances');

        expect(JSON.stringify(calls)).not.toContain(KEY);
        expect(JSON.stringify(engine.getConnectorDescriptors())).not.toContain(KEY);

        await kernel.shutdown();
    });
});
