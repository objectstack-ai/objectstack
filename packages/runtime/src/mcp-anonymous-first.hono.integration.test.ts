// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * [#24251] On the standalone server (`HonoServerPlugin` + the dispatcher
 * plugin), an anonymous caller of `/api/v1/mcp` is answered `401
 * UNAUTHENTICATED` whatever the MCP switch or the `mcp` service says, over a
 * real Hono socket.
 *
 * ADR-0138 D2 takes the anonymous decision "once per domain, as the domain's
 * first statement". `handleMcpRequest` (`domains/mcp.ts`) checked
 * `OS_MCP_SERVER_ENABLED` and the `mcp` service ahead of it, so an anonymous
 * caller was told whether this deployment runs MCP before it was refused.
 * Measured on `9822b053e`, this file's anonymous rows: `404
 * RESOURCE_NOT_FOUND` with the switch off, `501 NOT_IMPLEMENTED` with no
 * service, `401 UNAUTHENTICATED` only with MCP on and installed.
 *
 * What is pinned, per composition:
 *
 *  1. anonymous, every verb the standalone server mounts on `/mcp` → `401
 *     UNAUTHENTICATED`, and the transport is never reached;
 *  2. the `401` advertises RFC 9728 resource metadata only where the resource
 *     is served: the switch on, an `mcp` service installed, and the auth
 *     service answering a metadata URL. The fake `auth` slot below answers one
 *     in every composition, as plugin-auth does with the switch off when
 *     `OS_OIDC_PROVIDER_ENABLED=true`, so the switch-off and no-service rows
 *     are the ones that would advertise a resource nobody serves;
 *  3. signed in, the domain's own answer is unchanged: `200` from the
 *     transport, `501 NOT_IMPLEMENTED`, `404 RESOURCE_NOT_FOUND`.
 *
 * `LiteKernel`, fake services only (no storage). The `auth` slot answers a
 * session only for a request carrying `x-test-session`. The switch is read
 * per request, so each row sets it for its own requests.
 */

const PREFIX = '/api/v1';
const SESSION_HEADER = 'x-test-session';
const METADATA_URL = 'https://mcp-anonymous-first.test/.well-known/oauth-protected-resource';
const JSON_RPC = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

/** How many requests reached the fake `/mcp` transport. */
let transportCalls = 0;

function fakeServicesPlugin(withMcp: boolean): Plugin {
    return {
        name: `com.objectstack.test.fake-services-mcp-anonymous-first-${withMcp ? 'mcp' : 'no-mcp'}`,
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: { headers?: Headers }) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_mcp_anonymous_first' } } : undefined),
                },
                getMcpResourceMetadataUrl: () => METADATA_URL,
            });
            if (withMcp) {
                ctx.registerService('mcp', {
                    handleHttpRequest: async () => {
                        transportCalls += 1;
                        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
                    },
                    renderSkill: () => '# skill',
                });
            }
        },
    };
}

interface Composition {
    name: string;
    withMcp: boolean;
    switchOff: boolean;
    /** The 401 carries `resource_metadata`. */
    advertises: boolean;
    /** What a signed-in `POST` is answered: the domain's own answer. */
    signedIn: { status: number; code?: string };
}

const COMPOSITIONS: Composition[] = [
    { name: 'MCP on and installed', withMcp: true, switchOff: false, advertises: true, signedIn: { status: 200 } },
    { name: 'no mcp service installed', withMcp: false, switchOff: false, advertises: false, signedIn: { status: 501, code: 'NOT_IMPLEMENTED' } },
    { name: 'OS_MCP_SERVER_ENABLED=false', withMcp: true, switchOff: true, advertises: false, signedIn: { status: 404, code: 'RESOURCE_NOT_FOUND' } },
];

const VERBS = ['POST', 'GET', 'DELETE'] as const;

describe('[#24251] an anonymous /mcp caller is answered 401 first on the standalone server (integration)', () => {
    const kernels: LiteKernel[] = [];
    const bases = new Map<boolean, string>();
    const prevSwitch = process.env.OS_MCP_SERVER_ENABLED;

    beforeAll(async () => {
        for (const withMcp of [true, false]) {
            const kernel = new LiteKernel();
            kernel.use(fakeServicesPlugin(withMcp));
            // port 0 → an OS-assigned free port, read back through getPort().
            kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
            kernel.use(createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false }));
            await kernel.bootstrap();
            kernels.push(kernel);
            bases.set(withMcp, `http://127.0.0.1:${kernel.getService<IHttpServer>('http.server').getPort!()}`);
        }
    }, 30_000);

    afterAll(async () => {
        for (const kernel of kernels) {
            await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
        }
    }, 30_000);

    afterEach(() => {
        if (prevSwitch === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
        else process.env.OS_MCP_SERVER_ENABLED = prevSwitch;
    });

    async function call(c: Composition, method: string, signedIn: boolean): Promise<Response> {
        process.env.OS_MCP_SERVER_ENABLED = c.switchOff ? 'false' : 'true';
        return fetch(`${bases.get(c.withMcp)}${PREFIX}/mcp`, {
            method,
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
            },
            ...(method === 'GET' ? {} : { body: JSON_RPC }),
        });
    }

    for (const c of COMPOSITIONS) {
        for (const method of VERBS) {
            it(`${c.name}: anonymous ${method} /mcp → 401 UNAUTHENTICATED, the transport never reached`, async () => {
                const before = transportCalls;
                const res = await call(c, method, false);
                const json = (await res.json()) as { success?: boolean; error?: { code?: string; httpStatus?: number } };

                expect(res.status).toBe(401);
                expect(json.success).toBe(false);
                expect(json.error?.code).toBe('UNAUTHENTICATED');
                expect(json.error?.httpStatus).toBe(401);
                expect(transportCalls, 'an anonymous caller must never reach the MCP transport').toBe(before);
            });
        }

        it(`${c.name}: the 401 ${c.advertises ? 'advertises' : 'does not advertise'} RFC 9728 resource metadata`, async () => {
            const res = await call(c, 'POST', false);
            expect(res.status).toBe(401);
            const www = res.headers.get('www-authenticate');
            if (c.advertises) {
                expect(www).toContain('Bearer');
                expect(www).toContain(`resource_metadata="${METADATA_URL}"`);
            } else {
                expect(www).toBeNull();
            }
        });

        it(`${c.name}: signed-in POST /mcp keeps the domain's own ${c.signedIn.status}${c.signedIn.code ? ` ${c.signedIn.code}` : ''}`, async () => {
            const before = transportCalls;
            const res = await call(c, 'POST', true);
            const json = (await res.json()) as { success?: boolean; error?: { code?: string; httpStatus?: number } };

            expect(res.status).toBe(c.signedIn.status);
            if (c.signedIn.code) {
                expect(json.success).toBe(false);
                expect(json.error?.code).toBe(c.signedIn.code);
                expect(json.error?.httpStatus).toBe(c.signedIn.status);
                expect(transportCalls).toBe(before);
            } else {
                expect(transportCalls).toBe(before + 1);
            }
        });
    }
});
