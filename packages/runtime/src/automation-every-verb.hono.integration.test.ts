// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';
import '@objectstack/metadata';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * [ADR-0150 D5, child G1] Every verb on a two-segment `/api/v1/automation`
 * path reaches the `automation` domain on the standalone server — over a real
 * Hono socket.
 *
 * The addressed shapes are mounted with a parameter in every position
 * (`GET`/`PUT`/`DELETE /automation/:ns/:name`), so every two-segment path
 * matches a mount by its parameters alone. Left to the transport, a verb no
 * mount serves there would be answered with an `Allow` built from those
 * mounts — `PUT /automation/:name/runs` would list `DELETE, GET, HEAD, PUT`,
 * though the path is served under `GET` only. The dispatcher declares the GET
 * patterns a two-segment path resolves to as ones whose domain decides every
 * verb (#24228), and the domain answers a shape it serves under another verb
 * `405` with the verbs it serves (`automationRouteAllow`, pinned against the
 * ledger in `route-ledger.conformance.test.ts`).
 *
 * The door is read off the body, as in `actions-every-verb.hono.integration.test.ts`:
 * the dispatcher's envelope fills `error.httpStatus` and carries no
 * `error.details`; the transport's fills `error.details` and no `httpStatus`.
 * Both prefixes, since `registerAutomationRoutes` mounts each base.
 */

const SESSION_HEADER = 'x-test-session';
const PREFIXES = ['/api/v1', '/api/v1/environments/env_automation_verb'] as const;
/** Verbs that carry a JSON body on the wire; the rest are sent bodiless. */
const BODY_VERBS = new Set(['PUT', 'PATCH']);
/** A two-segment shape, a verb it is never served under, and the verbs it is. */
const ROWS = [
    ['/automation/send_digest/runs', 'PUT', 'GET'],
    ['/automation/send_digest/runs', 'POST', 'GET'],
    ['/automation/send_digest/trigger', 'GET', 'POST'],
    ['/automation/connectors/credential-refs', 'POST', 'GET'],
    ['/automation/trigger/send_digest', 'GET', 'POST'],
] as const;

/** Every flow name the automation double was asked to run. */
const executed: string[] = [];

function fakeAuthPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-auth-automation-every-verb',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_automation_verb' } } : undefined),
                },
            });
            // The domain's 405 sits behind its service probe. `execute` records
            // every run, so the legacy trigger's bound can pin that nothing ran.
            ctx.registerService('automation', {
                handlerReady: true,
                execute: async (name: string) => {
                    executed.push(name);
                    return { success: true, output: {} };
                },
            });
        },
    };
}

interface Answer {
    status: number;
    allow: string | null;
    /** Parsed JSON body; `undefined` for a bodiless answer (`HEAD`). */
    body: Record<string, any> | undefined;
}

describe('every verb on a two-segment /api/v1/automation path reaches the automation domain (integration, ADR-0150 D5)', () => {
    let kernel: LiteKernel;
    let port: number;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(fakeAuthPlugin());
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(createDispatcherPlugin({
            prefix: '/api/v1',
            securityHeaders: false,
            scoping: { enableProjectScoping: true, projectResolution: 'auto' },
        }));
        await kernel.bootstrap();
        port = kernel.getService<IHttpServer>('http.server').getPort!();
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    function call(method: string, path: string, signedIn: boolean): Promise<Answer> {
        return new Promise((resolve, reject) => {
            const payload = BODY_VERBS.has(method) ? JSON.stringify({ params: {} }) : undefined;
            const req = httpRequest({
                host: '127.0.0.1',
                port,
                method,
                path,
                headers: {
                    ...(payload ? { 'content-type': 'application/json' } : {}),
                    ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
                },
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { text += chunk; });
                res.on('end', () => {
                    const allow = res.headers.allow;
                    resolve({
                        status: res.statusCode ?? 0,
                        allow: typeof allow === 'string' ? allow : null,
                        body: text.length > 0 ? JSON.parse(text) as Record<string, any> : undefined,
                    });
                });
            });
            req.on('error', reject);
            req.end(payload);
        });
    }

    for (const prefix of PREFIXES) {
        for (const [shape, method, served] of ROWS) {
            const path = `${prefix}${shape}`;

            it(`anonymous ${method} ${path} → 401 UNAUTHENTICATED, no Allow, in the dispatcher's envelope`, async () => {
                const { status, allow, body } = await call(method, path, false);

                expect(status).toBe(401);
                expect(allow).toBeNull();
                expect(body?.error?.code).toBe('UNAUTHENTICATED');
                expect(body?.error?.httpStatus).toBe(401);
                expect(body?.error).not.toHaveProperty('details');
            });

            it(`signed-in ${method} ${path} → the domain's 405 with \`Allow: ${served}\`, not the transport's`, async () => {
                const { status, allow, body } = await call(method, path, true);

                expect([status, allow]).toEqual([405, served]);
                expect(body?.error?.code).toBe('METHOD_NOT_ALLOWED');
                expect(body?.error?.httpStatus).toBe(405);
                expect(body?.error).not.toHaveProperty('details');
            });
        }

        // ── control: a two-segment shape no route serves is declined by the domain ──
        it(`signed-in POST ${prefix}/automation/send_digest/no-such-verb → the dispatcher's no-route 404, never a 405`, async () => {
            const { status, allow, body } = await call('POST', `${prefix}/automation/send_digest/no-such-verb`, true);

            expect([status, allow]).toEqual([404, null]);
            expect(body?.error?.code).toBe('ROUTE_NOT_FOUND');
        });

        // ── the legacy trigger past its bound: a deep `POST` mount routes it here, and nothing runs ──
        // `/automation/:name/runs/:runId/cancel` (`:name` = `trigger`) and the
        // addressed `/automation/:ns/:name/runs/:runId/resume` (`:ns` = `trigger`)
        // match by their parameters. Before the bound the domain ran the flow
        // `runs` / `crm` off them and ignored the tail.
        for (const shape of ['/automation/trigger/runs/r1/cancel', '/automation/trigger/crm/runs/r1/resume']) {
            it(`signed-in POST ${prefix}${shape} → the dispatcher's no-route 404 ROUTE_NOT_FOUND, no flow run`, async () => {
                executed.length = 0;
                const { status, allow, body } = await call('POST', `${prefix}${shape}`, true);

                expect([status, allow]).toEqual([404, null]);
                expect(body?.error?.code).toBe('ROUTE_NOT_FOUND');
                expect(body?.error?.httpStatus).toBe(404);
                expect(executed).toEqual([]);
            });
        }

        it(`CONTROL — signed-in POST ${prefix}/automation/trigger/send_digest runs the flow`, async () => {
            executed.length = 0;
            const { status, body } = await call('POST', `${prefix}/automation/trigger/send_digest`, true);

            expect(status, JSON.stringify(body)).toBe(200);
            expect(executed).toEqual(['send_digest']);
        });
    }

    // ── the claim is narrow: a shape no mount matches stays the transport's 404 ──
    it('a three-segment /automation path no route serves → the transport\'s 404, not the domain', async () => {
        const { status, body } = await call('POST', '/api/v1/automation/send_digest/no-such-verb/extra', false);

        expect(status).toBe(404);
        expect(body?.error?.code).toBe('ENDPOINT_NOT_FOUND');
    });
});
