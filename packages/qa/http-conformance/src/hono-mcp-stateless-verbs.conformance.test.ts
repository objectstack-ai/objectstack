// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25759] `/api/v1/mcp` answers `GET` and `DELETE` with `405` and
 * `Allow: POST` on both doors that mount it, and `POST` is unchanged.
 *
 * The verb decision lives in `MCPServerRuntime.handleHttpRequest`
 * (`@objectstack/mcp`): the transport is stateless and closes its per-request
 * server in `finally`, so it can hold no GET stream and has no session to end.
 * Before the change a GET answered `200 text/event-stream` with a stream that
 * ended at once, and claude-code re-opened it 2–3 times a second (cloud#3103).
 * A `createHonoApp` host's catch-all hands every verb on `/mcp` to
 * `dispatch()`. The standalone server mounts GET, POST and DELETE, and declares
 * `/mcp` with `domainDecidesEveryVerb` (#24228) so the verbs it does not mount
 * (`PUT`, `PATCH`, `OPTIONS` with CORS off) reach `dispatch()` too. Without that
 * declaration the adapter answered them itself: `405` with the mounted verbs
 * in `Allow`, to an anonymous caller as well. What this file pins is that the
 * transport's answer reaches the wire on both doors, `Allow` header included.
 *
 *  1. Signed in, `GET`, `DELETE`, `PUT`, `PATCH` and `OPTIONS` answer `405`,
 *     `Allow: POST`, on each door.
 *  2. Signed in, `POST initialize` and `POST tools/list` answer `200`.
 *  3. Anonymous, `GET`, `PUT`, `PATCH` and `OPTIONS` are still `401`: the
 *     anonymous decision comes first (ADR-0138 D2), ahead of the transport's
 *     verb answer, on a verb the standalone router mounts and on ones it does
 *     not.
 *  4. The two doors answer each row with the same status and `Allow`.
 *
 * `LiteKernel` with a fake `auth` slot (a session only for a request carrying
 * `x-test-session`) and the REAL `MCPServerRuntime` as the `mcp` service. No
 * data service: nothing here calls a tool.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createDispatcherPlugin } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';
import { MCPServerRuntime } from '@objectstack/mcp';
import type { IHttpServer } from '@objectstack/spec/contracts';

const PREFIX = '/api/v1';
const SESSION_HEADER = 'x-test-session';

function servicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.mcp-stateless-verbs',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: { headers?: Headers }) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_mcp_stateless_verbs' } } : undefined),
                },
            });
            ctx.registerService('mcp', new MCPServerRuntime({ name: 'objectstack-conformance', version: '9.9.9' }));
        },
    };
}

type Door = (init: RequestInit) => Promise<Response>;

function request(method: string, signedIn: boolean, body?: unknown): RequestInit {
    return {
        method,
        headers: {
            ...(method === 'GET'
                ? { accept: 'text/event-stream', 'mcp-protocol-version': '2025-06-18' }
                : { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }),
            ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
}

const INIT = {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'conformance', version: '1' } },
};

describe('[#25759] the stateless /api/v1/mcp answers GET and DELETE with 405 Allow: POST on both doors (conformance)', () => {
    const kernels: LiteKernel[] = [];
    const doors = new Map<string, Door>();
    const prevSwitch = process.env.OS_MCP_SERVER_ENABLED;

    beforeAll(async () => {
        process.env.OS_MCP_SERVER_ENABLED = 'true';

        const hostedKernel = new LiteKernel();
        hostedKernel.use(servicesPlugin());
        await hostedKernel.bootstrap();
        kernels.push(hostedKernel);
        const app = createHonoApp({ kernel: hostedKernel as any, prefix: PREFIX, cors: false });
        doors.set('hosted (createHonoApp)', async (init) => app.request(`http://hosted.test${PREFIX}/mcp`, init));

        const standaloneKernel = new LiteKernel();
        standaloneKernel.use(servicesPlugin());
        standaloneKernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        standaloneKernel.use(createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false }));
        await standaloneKernel.bootstrap();
        kernels.push(standaloneKernel);
        const base = `http://127.0.0.1:${standaloneKernel.getService<IHttpServer>('http.server').getPort!()}`;
        doors.set('standalone (HonoServerPlugin + dispatcher)', (init) => fetch(`${base}${PREFIX}/mcp`, init));
    }, 30_000);

    afterAll(async () => {
        if (prevSwitch === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
        else process.env.OS_MCP_SERVER_ENABLED = prevSwitch;
        for (const kernel of kernels) {
            await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
        }
    }, 30_000);

    const DOORS = ['hosted (createHonoApp)', 'standalone (HonoServerPlugin + dispatcher)'];
    /** Every verb but POST. GET and DELETE are mounted on the standalone router; the rest are not. */
    const REFUSED = ['GET', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'];
    /** An anonymous caller is refused 401 on a mounted verb and on unmounted ones. */
    const ANONYMOUS = ['GET', 'PUT', 'PATCH', 'OPTIONS'];

    for (const door of DOORS) {
        for (const method of REFUSED) {
            it(`${door}: signed-in ${method} /mcp → 405, Allow: POST, never an event stream`, async () => {
                const res = await doors.get(door)!(request(method, true));
                const body = await res.text();

                expect(res.status, `${method} answered ${res.status}: ${body}`).toBe(405);
                expect(res.headers.get('allow')).toBe('POST');
                expect(res.headers.get('content-type') ?? '').not.toContain('text/event-stream');
                expect(JSON.parse(body)).toEqual({
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Method not allowed.' },
                    id: null,
                });
            });
        }

        it(`${door}: signed-in POST initialize and tools/list → 200, unchanged`, async () => {
            const init = await doors.get(door)!(request('POST', true, INIT));
            expect(init.status).toBe(200);
            const initJson: any = await init.json();
            expect(initJson.result.serverInfo.name).toBe('objectstack-conformance');

            const list = await doors.get(door)!(request('POST', true, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
            expect(list.status).toBe(200);
            const listJson: any = await list.json();
            expect(listJson.result.tools.map((t: any) => t.name)).toContain('query_records');
        });

        for (const method of ANONYMOUS) {
            it(`${door}: anonymous ${method} /mcp is still 401 — the anonymous decision comes before the verb`, async () => {
                const res = await doors.get(door)!(request(method, false));
                await res.arrayBuffer();
                expect(res.status).toBe(401);
                expect(res.headers.get('allow'), 'an anonymous caller is not told the route shape').toBeNull();
            });
        }
    }

    const PARITY: Array<[string, boolean]> = [
        ...REFUSED.map((m): [string, boolean] => [m, true]),
        ...ANONYMOUS.map((m): [string, boolean] => [m, false]),
    ];
    for (const [method, signedIn] of PARITY) {
        it(`both doors answer ${signedIn ? 'signed-in' : 'anonymous'} ${method} /mcp the same`, async () => {
            const readings = await Promise.all(
                DOORS.map(async (door) => {
                    const res = await doors.get(door)!(request(method, signedIn));
                    await res.arrayBuffer();
                    return { status: res.status, allow: res.headers.get('allow') };
                }),
            );
            expect(readings[0]).toEqual(readings[1]);
        });
    }
});
