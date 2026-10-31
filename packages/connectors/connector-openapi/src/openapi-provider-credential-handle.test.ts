// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D4 — the `openapi` provider serves a grant-bearing instance
// (`oauth2`, `app-credential`) through the per-dispatch credential handle, and
// reads the document's `security` for where the token is not sent and which
// inputs it fills.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type {
    BorrowedConnectorAuth,
    ConnectorCredentialHandle,
    ConnectorCredentialRequest,
    ConnectorProviderContext,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { createOpenApiProviderFactory } from './openapi-provider.js';
import { ConnectorOpenApiPlugin } from './connector-openapi-plugin.js';
import type { OpenApiDocument } from './openapi-connector.js';

interface Sent { url: string; headers: Record<string, string> }

function scriptedFetch(statuses: number[]) {
    const sent: Sent[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        sent.push({ url, headers: { ...(init.headers as Record<string, string>) } });
        const status = statuses[Math.min(sent.length - 1, statuses.length - 1)];
        return new Response(JSON.stringify({ n: sent.length }), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { impl, sent };
}

function fakeHandle(present: (token: string) => BorrowedConnectorAuth = (token) => ({ type: 'bearer', token })) {
    const asked: Array<{ verb: 'get' | 'refresh'; request?: ConnectorCredentialRequest }> = [];
    let n = 1;
    const handle: ConnectorCredentialHandle = {
        connector: 'vendor',
        async get(request) { asked.push({ verb: 'get', request }); return { auth: present(`tok-${n}`) }; },
        async refresh(request) { asked.push({ verb: 'refresh', request }); n += 1; return { auth: present(`tok-${n}`) }; },
    };
    return { handle, asked };
}

/** A document whose `listItems` requires the oauth2 scheme, `health` is anonymous, and `wecomUser` takes the token in a query apiKey. */
const DOC: OpenApiDocument = {
    openapi: '3.0.3',
    info: { title: 'Vendor' },
    servers: [{ url: 'https://api.example.com' }],
    components: {
        securitySchemes: {
            oauth: {
                type: 'oauth2',
                flows: { clientCredentials: { tokenUrl: 'https://idp.example.com/token', scopes: { 'items:read': 'read' } } },
            },
            accessToken: { type: 'apiKey', in: 'query', name: 'access_token' },
        },
    },
    security: [{ oauth: ['items:read'] }],
    paths: {
        '/items': { get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } } },
        '/health': { get: { operationId: 'health', security: [], responses: { '200': { description: 'ok' } } } },
        '/cgi-bin/user/get': {
            get: {
                operationId: 'wecomUser',
                security: [{ accessToken: [] }],
                parameters: [
                    { name: 'access_token', in: 'query', required: true, schema: { type: 'string' } },
                    { name: 'userid', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: { '200': { description: 'ok' } },
            },
        },
    },
};

function ctx(partial: Partial<ConnectorProviderContext>): ConnectorProviderContext {
    return { name: 'vendor', label: 'Vendor', type: 'api', providerConfig: { spec: DOC }, ...partial };
}

const dispatch = (organizationId?: string) => ({ automation: organizationId === undefined ? {} : { tenantId: organizationId } });

describe('openapi provider — a grant-bearing instance through its credential handle (ADR-0143 D4)', () => {
    it('asks the handle on every request in the name of the run\'s organization, and sends the bearer token', async () => {
        const { impl, sent } = scriptedFetch([200]);
        const { handle, asked } = fakeHandle();
        const { handlers } = await createOpenApiProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));

        await handlers.listItems({}, dispatch('org_a'));

        expect(asked).toEqual([{ verb: 'get', request: { organizationId: 'org_a' } }]);
        expect(sent[0].headers.Authorization).toBe('Bearer tok-1');
    });

    it('⛔ an upstream 401 refreshes once and retries once; a second 401 ends in the seam\'s 503', async () => {
        const once = scriptedFetch([401, 200]);
        const first = fakeHandle();
        const a = await createOpenApiProviderFactory({ fetchImpl: once.impl })(ctx({ credentialHandle: first.handle }));
        await expect(a.handlers.listItems({}, dispatch('org_a'))).resolves.toMatchObject({ status: 200 });
        expect(once.sent.map((s) => s.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);

        const twice = scriptedFetch([401]);
        const b = await createOpenApiProviderFactory({ fetchImpl: twice.impl })(ctx({ credentialHandle: fakeHandle().handle }));
        await expect(b.handlers.listItems({}, dispatch('org_a'))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect(twice.sent).toHaveLength(2);
    });

    it('⛔ an operation whose `security` is empty is anonymous: no token is sent and the handle is not asked', async () => {
        const { impl, sent } = scriptedFetch([200]);
        const { handle, asked } = fakeHandle();
        const { handlers } = await createOpenApiProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));

        await handlers.health({}, dispatch('org_a'));

        expect(asked).toEqual([]);
        expect(sent[0].headers.Authorization).toBeUndefined();
    });

    it('⛔ a parameter an `apiKey` scheme the operation requires names is the platform\'s to fill, not the flow\'s input', async () => {
        const { impl, sent } = scriptedFetch([200]);
        const { handle } = fakeHandle((token) => ({ type: 'api-key', key: token, headerName: 'access_token', paramName: 'access_token' }));
        const { def, handlers } = await createOpenApiProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));

        const schema = def.actions?.find((a) => a.key === 'wecomUser')?.inputSchema as { properties: { query: { properties: Record<string, unknown>; required: string[] } } };
        expect(Object.keys(schema.properties.query.properties)).toEqual(['userid']);
        expect(schema.properties.query.required).toEqual(['userid']);

        await handlers.wecomUser({ query: { userid: 'zhangsan' } }, dispatch());
        const url = new URL(sent[0].url);
        expect(url.searchParams.get('access_token')).toBe('tok-1');
        expect(url.searchParams.get('userid')).toBe('zhangsan');
    });

    it('CONTROL: without a credential handle the document\'s security changes nothing — the parameter stays an input', async () => {
        const { def } = await createOpenApiProviderFactory({ fetchImpl: scriptedFetch([200]).impl })(ctx({}));
        const schema = def.actions?.find((a) => a.key === 'wecomUser')?.inputSchema as { properties: { query: { properties: Record<string, unknown> } } };
        expect(Object.keys(schema.properties.query.properties)).toEqual(['access_token', 'userid']);
    });

    it('⛔ refuses a credential handle beside a request signer: a request is authenticated one way', async () => {
        const signer = { connector: 'vendor', scheme: 'aliyun-acs3-hmac-sha256' as const, sign: async () => ({ headers: {} }) };
        await expect(createOpenApiProviderFactory()(ctx({ credentialHandle: fakeHandle().handle, requestSigner: signer })))
            .rejects.toThrow(/a request signer and a credential handle/);
    });

    it('the plugin registers the provider as a credential-handle consumer', async () => {
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorOpenApiPlugin());
        await kernel.bootstrap();
        expect(kernel.getService<AutomationEngine>('automation').providerAppliesCredentialHandle('openapi')).toBe(true);
        await kernel.shutdown();
    });
});
