// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D4 — the `mcp` provider serves a grant-bearing instance (`oauth2`,
// `app-credential`) over an http transport through the per-dispatch
// credential handle: every HTTP request of the MCP session asks the handle,
// a 401 refreshes once and is sent once more, and each organization a
// dispatch runs for has its own MCP session. Over a real Streamable-HTTP
// server on loopback and the real SDK client. The values are obvious dummies.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type {
    ConnectorCredentialHandle,
    ConnectorCredentialRequest,
    ConnectorProviderContext,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorMcpPlugin } from './connector-mcp-plugin.js';
import { createMcpProviderFactory, MCP_DISCOVERY_CREDENTIAL_REQUEST } from './mcp-provider.js';
import type { McpClientLike } from './mcp-connector.js';

type JsonRpc = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> };

interface Fixture {
    url: string;
    /** Each JSON-RPC message with the Authorization header it came with. */
    received: Array<{ method: string; authorization?: string }>;
    /** Tokens the server answers 401 to. */
    refuse: Set<string>;
}

const servers: Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function readBody(req: IncomingMessage): Promise<string> {
    let body = '';
    for await (const chunk of req) body += chunk;
    return body;
}

/** A JSON-answering Streamable-HTTP MCP server with one tool, `search`, echoing the token it was called with. */
async function startServer(): Promise<Fixture> {
    const fixture: Fixture = { url: '', received: [], refuse: new Set() };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
            const body = await readBody(req);
            const authorization = req.headers.authorization;
            const token = authorization?.replace(/^Bearer /, '') ?? '';
            if (req.method !== 'POST') {
                res.writeHead(req.method === 'GET' ? 405 : 200);
                res.end();
                return;
            }
            const msg = JSON.parse(body) as JsonRpc;
            fixture.received.push({ method: msg.method, ...(authorization ? { authorization } : {}) });
            if (!authorization || fixture.refuse.has(token)) {
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid_token' }));
                return;
            }
            if (msg.id === undefined) {
                res.writeHead(202);
                res.end();
                return;
            }
            let result: unknown;
            if (msg.method === 'initialize') {
                result = { protocolVersion: msg.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'oauth-fixture', version: '1.0.0' } };
            } else if (msg.method === 'tools/list') {
                result = { tools: [{ name: 'search', description: 'search', inputSchema: { type: 'object' } }] };
            } else if (msg.method === 'tools/call') {
                result = { content: [{ type: 'text', text: `called-with:${token}` }] };
            } else {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } }));
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
        })();
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    fixture.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    return fixture;
}

/** A handle answering `tok-<org>-<n>`, raising `n` on each refresh, recording what it was asked. */
function fakeHandle() {
    const asked: Array<{ verb: 'get' | 'refresh'; request?: ConnectorCredentialRequest }> = [];
    const n = new Map<string, number>();
    const token = (request?: ConnectorCredentialRequest) => `tok-${request?.organizationId ?? 'none'}-${n.get(request?.organizationId ?? '') ?? 1}`;
    const handle: ConnectorCredentialHandle = {
        connector: 'notion',
        async get(request) { asked.push({ verb: 'get', request }); return { auth: { type: 'bearer', token: token(request) } }; },
        async refresh(request) {
            asked.push({ verb: 'refresh', request });
            const key = request?.organizationId ?? '';
            n.set(key, (n.get(key) ?? 1) + 1);
            return { auth: { type: 'bearer', token: token(request) } };
        },
    };
    return { handle, asked };
}

function ctx(url: string, partial: Partial<ConnectorProviderContext> = {}): ConnectorProviderContext {
    return { name: 'notion', label: 'Notion', type: 'api', providerConfig: { transport: { kind: 'http', url } }, ...partial };
}

const dispatch = (organizationId?: string) => ({ automation: organizationId === undefined ? {} : { tenantId: organizationId } });
const textOf = (out: Record<string, unknown>) => (out.content as Array<{ text: string }>)[0].text;

describe('mcp provider — a grant-bearing instance over http through its credential handle (ADR-0143 D4)', () => {
    it('lists the tools with the discovery request and sends the token on every request of the session', async () => {
        const server = await startServer();
        const { handle, asked } = fakeHandle();
        const bundle = await createMcpProviderFactory()(ctx(server.url, { credentialHandle: handle }));
        try {
            expect(bundle.def.actions?.map((a) => a.key)).toEqual(['search']);
            expect(MCP_DISCOVERY_CREDENTIAL_REQUEST).toEqual({});
            expect(asked.every((a) => a.verb === 'get' && a.request?.organizationId === undefined)).toBe(true);
            expect(server.received.map((r) => r.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
            expect(new Set(server.received.map((r) => r.authorization))).toEqual(new Set(['Bearer tok-none-1']));
            // The handshake carried no static credential: nothing is claimed verified.
            expect('credentialVerified' in bundle).toBe(false);
        } finally {
            await bundle.close?.();
        }
    });

    it("each organization a dispatch runs for has its own session, with its own organization's token", async () => {
        const server = await startServer();
        const { handle, asked } = fakeHandle();
        const bundle = await createMcpProviderFactory()(ctx(server.url, { credentialHandle: handle }));
        try {
            expect(textOf(await bundle.handlers.search({}, dispatch('org_a')))).toBe('called-with:tok-org_a-1');
            expect(textOf(await bundle.handlers.search({}, dispatch('org_b')))).toBe('called-with:tok-org_b-1');
            expect(textOf(await bundle.handlers.search({}, dispatch('org_a')))).toBe('called-with:tok-org_a-1');
            // A run with no organization goes through the session the tools were listed with.
            expect(textOf(await bundle.handlers.search({}, dispatch()))).toBe('called-with:tok-none-1');
            const initializes = server.received.filter((r) => r.method === 'initialize').map((r) => r.authorization);
            expect(initializes).toEqual(['Bearer tok-none-1', 'Bearer tok-org_a-1', 'Bearer tok-org_b-1']);
            expect(asked.filter((a) => a.request?.organizationId === 'org_b').every((a) => a.verb === 'get')).toBe(true);
        } finally {
            await bundle.close?.();
        }
    });

    it('⛔ an upstream 401 refreshes once and the request is sent once more with the new token', async () => {
        const server = await startServer();
        const { handle, asked } = fakeHandle();
        const bundle = await createMcpProviderFactory()(ctx(server.url, { credentialHandle: handle }));
        try {
            await bundle.handlers.search({}, dispatch('org_a'));
            server.refuse.add('tok-org_a-1');
            expect(textOf(await bundle.handlers.search({}, dispatch('org_a')))).toBe('called-with:tok-org_a-2');
            expect(asked.filter((a) => a.verb === 'refresh')).toEqual([{ verb: 'refresh', request: { organizationId: 'org_a' } }]);
        } finally {
            await bundle.close?.();
        }
    });

    it("⛔ a second 401 fails the dispatch with the seam's refusal naming the instance", async () => {
        const server = await startServer();
        const { handle } = fakeHandle();
        const bundle = await createMcpProviderFactory()(ctx(server.url, { credentialHandle: handle }));
        try {
            await bundle.handlers.search({}, dispatch('org_a'));
            server.refuse.add('tok-org_a-1');
            server.refuse.add('tok-org_a-2');
            await expect(bundle.handlers.search({}, dispatch('org_a'))).rejects.toThrow(/connector instance 'notion'/);
            const calls = server.received.filter((r) => r.method === 'tools/call');
            expect(calls.map((r) => r.authorization)).toEqual(['Bearer tok-org_a-1', 'Bearer tok-org_a-1', 'Bearer tok-org_a-2']);
        } finally {
            await bundle.close?.();
        }
    });

    it('a session that failed to open is not kept: the next dispatch of that organization opens another', async () => {
        const opened: string[] = [];
        let fail = true;
        const fakeClient: McpClientLike = {
            listTools: async () => [{ name: 'search' }],
            callTool: async () => ({ content: [] }),
            close: async () => {},
        };
        const factory = createMcpProviderFactory({
            clientFactory: async () => {
                opened.push('open');
                if (opened.length > 1 && fail) { fail = false; throw new Error('handshake failed'); }
                return fakeClient;
            },
        });
        const bundle = await factory(ctx('https://mcp.example.com/mcp', { credentialHandle: fakeHandle().handle }));
        await expect(bundle.handlers.search({}, dispatch('org_a'))).rejects.toThrow('handshake failed');
        await expect(bundle.handlers.search({}, dispatch('org_a'))).resolves.toMatchObject({ ok: true });
        expect(opened).toHaveLength(3);
    });

    it("closing the instance closes every organization's session", async () => {
        const closed: number[] = [];
        let n = 0;
        const factory = createMcpProviderFactory({
            clientFactory: async () => {
                const id = n++;
                return { listTools: async () => [{ name: 'search' }], callTool: async () => ({}), close: async () => { closed.push(id); } };
            },
        });
        const bundle = await factory(ctx('https://mcp.example.com/mcp', { credentialHandle: fakeHandle().handle }));
        await bundle.handlers.search({}, dispatch('org_a'));
        await bundle.handlers.search({}, dispatch('org_b'));
        await bundle.close?.();
        expect(closed.sort()).toEqual([0, 1, 2]);
    });

    it('⛔ refuses a credential handle on a stdio transport, and beside a static credential', async () => {
        const { handle } = fakeHandle();
        await expect(createMcpProviderFactory({ declarativeStdio: true })(
            ctx('', { credentialHandle: handle, providerConfig: { transport: { kind: 'stdio', command: 'mcp-server' } } }),
        )).rejects.toThrow(/only an http transport can carry/);
        await expect(createMcpProviderFactory()(
            ctx('https://mcp.example.com/mcp', { credentialHandle: handle, auth: { type: 'bearer', token: 'static' } }),
        )).rejects.toThrow(/a static 'bearer' credential and a credential handle/);
    });

    it('the plugin registers the provider as a credential-handle consumer', async () => {
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use(new ConnectorMcpPlugin());
        await kernel.bootstrap();
        expect(kernel.getService<AutomationEngine>('automation').providerAppliesCredentialHandle('mcp')).toBe(true);
        await kernel.shutdown();
    });
});
