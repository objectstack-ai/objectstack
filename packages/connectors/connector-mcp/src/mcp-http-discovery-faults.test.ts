// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `tools/list` pagination and the credential-rejection fault, measured against
// REAL Streamable-HTTP servers through the SDK-backed default client.
//
// Nothing here injects a client: each case starts a dependency-free MCP server
// on an ephemeral localhost port (JSON-RPC over POST, answered as plain JSON),
// so what is asserted is what the MCP SDK's own transport and client do with
// the server's answers — the cursor it really sends, the 401 it really raises.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { isConnectorCredentialRejected, isConnectorUpstreamUnavailable } from '@objectstack/spec/integration';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorMcpPlugin } from './connector-mcp-plugin.js';
import { createMcpConnector, MCP_TOOLS_LIST_MAX_PAGES } from './mcp-connector.js';
import { createMcpProviderFactory } from './mcp-provider.js';

type JsonRpc = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> };

interface Fixture {
    url: string;
    /** Every JSON-RPC message the server received, in order. */
    received: JsonRpc[];
    /** Every HTTP request the server received (method), in order. */
    requests: string[];
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

/**
 * Start a fixture MCP server. `toolsList` answers one `tools/list` request
 * from its cursor; `reject` (when set) answers every request with that status.
 */
async function startServer(opts: {
    toolsList?: (cursor: string | undefined) => { tools: unknown[]; nextCursor?: string };
    reject?: number;
}): Promise<Fixture> {
    const fixture: Fixture = { url: '', received: [], requests: [] };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
            fixture.requests.push(req.method ?? '');
            const body = await readBody(req);
            if (opts.reject !== undefined) {
                res.writeHead(opts.reject, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid_token' }));
                return;
            }
            // No server-initiated SSE stream; DELETE (session end) is a no-op.
            if (req.method !== 'POST') {
                res.writeHead(req.method === 'GET' ? 405 : 200);
                res.end();
                return;
            }
            const msg = JSON.parse(body) as JsonRpc;
            fixture.received.push(msg);
            if (msg.id === undefined) {
                res.writeHead(202);
                res.end();
                return;
            }
            let result: unknown;
            if (msg.method === 'initialize') {
                result = {
                    protocolVersion: msg.params?.protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: { name: 'http-fixture', version: '1.0.0' },
                };
            } else if (msg.method === 'tools/list' && opts.toolsList) {
                result = opts.toolsList(msg.params?.cursor as string | undefined);
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

const tool = (name: string) => ({ name, description: `${name} tool`, inputSchema: { type: 'object' } });

/** Two pages: `alpha`, `beta` then (cursor `page-2`) `gamma`. */
const twoPages = (cursor: string | undefined) =>
    cursor === undefined
        ? { tools: [tool('alpha'), tool('beta')], nextCursor: 'page-2' }
        : cursor === 'page-2'
            ? { tools: [tool('gamma')] }
            : { tools: [] };

describe('tools/list pagination — real Streamable-HTTP server', () => {
    it('follows nextCursor until exhausted: every tool on every page becomes an action', async () => {
        const server = await startServer({ toolsList: twoPages });
        const bundle = await createMcpConnector({ name: 'paged', transport: { kind: 'http', url: server.url } });
        try {
            expect(bundle.def.actions?.map((a) => a.key)).toEqual(['alpha', 'beta', 'gamma']);
            expect(Object.keys(bundle.handlers)).toEqual(['alpha', 'beta', 'gamma']);
            // The second request carried the server's cursor, and there was no third.
            const listCalls = server.received.filter((m) => m.method === 'tools/list');
            expect(listCalls.map((m) => m.params?.cursor)).toEqual([undefined, 'page-2']);
        } finally {
            await bundle.close();
        }
    });

    it(`fails discovery loudly when the server still pages after ${MCP_TOOLS_LIST_MAX_PAGES} pages — never a truncated list`, async () => {
        let page = 0;
        const server = await startServer({
            toolsList: () => ({ tools: [tool(`t_${page}`)], nextCursor: `c${++page}` }),
        });
        await expect(
            createMcpConnector({ name: 'endless', transport: { kind: 'http', url: server.url } }),
        ).rejects.toThrow(
            `MCP server still returned a tools/list nextCursor after ${MCP_TOOLS_LIST_MAX_PAGES} pages ` +
                `(${MCP_TOOLS_LIST_MAX_PAGES} tools so far); refusing to build the connector from a truncated tool list.`,
        );
        expect(server.received.filter((m) => m.method === 'tools/list')).toHaveLength(MCP_TOOLS_LIST_MAX_PAGES);
    });
});

describe('credential rejection — real Streamable-HTTP server', () => {
    it.each([401, 403])(
        'an HTTP %i on the handshake is a credential rejection (not upstream-unavailable), sent once',
        async (status) => {
            const server = await startServer({ reject: status });
            const factory = createMcpProviderFactory();
            const materialized = factory({
                name: 'vendor',
                label: 'Vendor',
                type: 'api',
                providerConfig: { transport: { kind: 'http', url: server.url } },
                auth: { type: 'bearer', token: 'wrong-token' },
            });
            const err = await Promise.resolve(materialized).then(
                () => { throw new Error('expected rejection'); },
                (e: unknown) => e,
            );
            expect(err).toBeInstanceOf(Error);
            expect(isConnectorUpstreamUnavailable(err)).toBe(false);
            expect(isConnectorCredentialRejected(err)).toBe(true);
            expect((err as Error).message).toContain(
                `connector-mcp provider: connector 'vendor' was refused by its MCP server (HTTP ${status})`,
            );
            expect((err as Error).message).toContain('is not retried');
            expect(server.requests).toEqual(['POST']);
        },
    );

    // [#27237] Ruling on #27237 (comment 6470087293): a refused credential
    // degrades the instance, naming the refusal — not a failed boot — and the
    // instance is held, never retried against the same credential.
    it('a declarative instance answered 401 degrades, naming the refusal, and is not retried', async () => {
        const server = await startServer({ reject: 401 });
        const declared = [
            {
                name: 'vendor_mcp',
                label: 'Vendor MCP',
                type: 'api',
                provider: 'mcp',
                providerConfig: { transport: { kind: 'http', url: server.url } },
            },
        ];
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use({
            name: 'test.connector-metadata',
            type: 'standard',
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(ctx: { registerService(name: string, service: unknown): void }) {
                ctx.registerService('objectql', {
                    registry: { listItems: (type: string) => (type === 'connector' ? declared : []) },
                });
            },
            async start() {},
        } as never);
        kernel.use(new ConnectorMcpPlugin());
        try {
            await kernel.bootstrap();
            const engine = kernel.getService('automation') as AutomationEngine;
            expect(engine.getConnectorDegradedReason('vendor_mcp')).toMatch(/was refused by its MCP server \(HTTP 401\)/);
            // Give a (wrongly) scheduled retry the chance to fire: none does.
            await new Promise((r) => setTimeout(r, 300));
            expect(server.requests).toEqual(['POST']);
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });
});
