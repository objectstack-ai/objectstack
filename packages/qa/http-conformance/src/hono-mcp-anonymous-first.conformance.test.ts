// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24251] On a `createHonoApp` host, an anonymous caller of `/api/v1/mcp` is
 * answered `401 UNAUTHENTICATED` whatever the MCP switch or the `mcp` service
 * says — through the host's own pipeline, and the same as the standalone
 * server answers it.
 *
 * ## The defect
 *
 * ADR-0138 D2 takes the anonymous decision "once per domain, as the domain's
 * first statement". `handleMcpRequest` (`@objectstack/runtime`,
 * `domains/mcp.ts`) checked `OS_MCP_SERVER_ENABLED` (`404`) and the `mcp`
 * service (`501`) ahead of it, so an anonymous caller learned whether the
 * deployment runs MCP before it was refused. Measured on `9822b053e` through
 * this file's hosted door: anonymous `POST /api/v1/mcp` answered `404
 * RESOURCE_NOT_FOUND` with the switch off and `501 NOT_IMPLEMENTED` with no
 * service. The host adds no gate of its own on `/mcp`: its catch-all hands the
 * request to `dispatch()`, so the domain's order was the host's answer.
 *
 * ## What is pinned, per composition
 *
 *  1. Hosted (`app.request` into the Hono app `createHonoApp` returns): an
 *     anonymous `POST` is `401 UNAUTHENTICATED` and never reaches the
 *     transport; the `401` advertises RFC 9728 resource metadata only where
 *     the resource is served (switch on, `mcp` installed). The fake `auth`
 *     slot answers a metadata URL in every composition, as plugin-auth does
 *     with the switch off when `OS_OIDC_PROVIDER_ENABLED=true`.
 *  2. Hosted, signed in: the domain's own answer is unchanged — `200` from the
 *     transport, `501 NOT_IMPLEMENTED`, `404 RESOURCE_NOT_FOUND`.
 *  3. The hosted door answers the standalone server's status, `code` and
 *     `WWW-Authenticate`, anonymous and signed in.
 *
 * `LiteKernel`, fake services only (no storage): the `auth` slot answers a
 * session only for a request carrying `x-test-session`. The switch is read per
 * request, so each row sets it for its own requests.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createDispatcherPlugin } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';
import type { IHttpServer } from '@objectstack/spec/contracts';

const PREFIX = '/api/v1';
const SESSION_HEADER = 'x-test-session';
const METADATA_URL = 'https://mcp-anonymous-first.test/.well-known/oauth-protected-resource';
const JSON_RPC = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

/** How many requests reached a fake `/mcp` transport, on either door. */
let transportCalls = 0;

function fakeServicesPlugin(withMcp: boolean): Plugin {
    return {
        name: `com.objectstack.test.fake-services-hono-mcp-anonymous-first-${withMcp ? 'mcp' : 'no-mcp'}`,
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: { headers?: Headers }) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_hono_mcp_anonymous_first' } } : undefined),
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
    /** The anonymous 401 carries `resource_metadata`. */
    advertises: boolean;
    /** What a signed-in `POST` is answered: the domain's own answer. */
    signedIn: { status: number; code?: string };
}

const COMPOSITIONS: Composition[] = [
    { name: 'MCP on and installed', withMcp: true, switchOff: false, advertises: true, signedIn: { status: 200 } },
    { name: 'no mcp service installed', withMcp: false, switchOff: false, advertises: false, signedIn: { status: 501, code: 'NOT_IMPLEMENTED' } },
    { name: 'OS_MCP_SERVER_ENABLED=false', withMcp: true, switchOff: true, advertises: false, signedIn: { status: 404, code: 'RESOURCE_NOT_FOUND' } },
];

interface Reading { status: number; code: string | undefined; httpStatus: number | undefined; www: string | null }
async function read(res: Response): Promise<Reading> {
    const json = (await res.json()) as { error?: { code?: string; httpStatus?: number } };
    return { status: res.status, code: json.error?.code, httpStatus: json.error?.httpStatus, www: res.headers.get('www-authenticate') };
}

describe('[#24251] an anonymous /mcp caller is answered 401 first on a createHonoApp host (conformance)', () => {
    const kernels: LiteKernel[] = [];
    const hosted = new Map<boolean, (init: RequestInit) => Promise<Response>>();
    const standalone = new Map<boolean, (init: RequestInit) => Promise<Response>>();
    const prevSwitch = process.env.OS_MCP_SERVER_ENABLED;

    beforeAll(async () => {
        for (const withMcp of [true, false]) {
            const hostedKernel = new LiteKernel();
            hostedKernel.use(fakeServicesPlugin(withMcp));
            await hostedKernel.bootstrap();
            kernels.push(hostedKernel);
            const app = createHonoApp({ kernel: hostedKernel as any, prefix: PREFIX, cors: false });
            hosted.set(withMcp, async (init) => app.request(`http://hosted.test${PREFIX}/mcp`, init));

            const standaloneKernel = new LiteKernel();
            standaloneKernel.use(fakeServicesPlugin(withMcp));
            standaloneKernel.use(new HonoServerPlugin({ port: 0, cors: false }));
            standaloneKernel.use(createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false }));
            await standaloneKernel.bootstrap();
            kernels.push(standaloneKernel);
            const base = `http://127.0.0.1:${standaloneKernel.getService<IHttpServer>('http.server').getPort!()}`;
            standalone.set(withMcp, (init) => fetch(`${base}${PREFIX}/mcp`, init));
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

    function post(c: Composition, signedIn: boolean): RequestInit {
        process.env.OS_MCP_SERVER_ENABLED = c.switchOff ? 'false' : 'true';
        return {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
            },
            body: JSON_RPC,
        };
    }

    for (const c of COMPOSITIONS) {
        it(`${c.name}: hosted anonymous POST /mcp → 401 UNAUTHENTICATED, the transport never reached`, async () => {
            const before = transportCalls;
            const r = await read(await hosted.get(c.withMcp)!(post(c, false)));

            expect(r.status).toBe(401);
            expect(r.code).toBe('UNAUTHENTICATED');
            expect(r.httpStatus).toBe(401);
            expect(transportCalls, 'an anonymous caller must never reach the MCP transport').toBe(before);
            if (c.advertises) {
                expect(r.www).toContain(`resource_metadata="${METADATA_URL}"`);
            } else {
                expect(r.www).toBeNull();
            }
        });

        it(`${c.name}: hosted signed-in POST /mcp keeps the domain's own ${c.signedIn.status}${c.signedIn.code ? ` ${c.signedIn.code}` : ''}`, async () => {
            const res = await hosted.get(c.withMcp)!(post(c, true));
            expect(res.status).toBe(c.signedIn.status);
            if (c.signedIn.code) {
                const r = await read(res);
                expect(r.code).toBe(c.signedIn.code);
                expect(r.httpStatus).toBe(c.signedIn.status);
            }
        });

        for (const signedIn of [false, true]) {
            it(`${c.name}: the hosted door answers the standalone server's ${signedIn ? 'signed-in' : 'anonymous'} POST /mcp`, async () => {
                const viaHost = await hosted.get(c.withMcp)!(post(c, signedIn));
                const viaStandalone = await standalone.get(c.withMcp)!(post(c, signedIn));
                const a = signedIn && !c.signedIn.code ? { status: viaHost.status } : await read(viaHost);
                const b = signedIn && !c.signedIn.code ? { status: viaStandalone.status } : await read(viaStandalone);

                expect(a).toEqual(b);
            });
        }
    }
});
