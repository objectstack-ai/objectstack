// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * On the standalone server, an anonymous caller's answer does not depend on
 * whether its JSON body parses (#24151) — over a real Hono socket.
 *
 * The standalone mounts in `dispatcher-plugin.ts` used to hand `dispatch()`
 * `req.body`. `@objectstack/plugin-hono-server`'s `req.body` throws its
 * `400 INVALID_REQUEST` refusal when a body it could not parse is READ, and
 * answers the request with that refusal; read while building `dispatch()`'s
 * arguments, it fired before the domain ran, so ahead of the domain's
 * anonymous decision (ADR-0138 D2: the domain's first statement). Measured on
 * `cbfa5e433`: every row below answered an anonymous caller `400
 * INVALID_REQUEST` for `{"name": "probe"` and `401 UNAUTHENTICATED` for the
 * same body with its closing brace. `createHonoApp` answers `401`, because it
 * raises the refusal only when a domain reads the body.
 *
 * The mounts now hand `deferRequestBody(req)`, and each domain reads it with
 * `readDispatchedBody` once its anonymous decision has admitted the caller.
 * Three readings per row:
 *
 * 1. anonymous + unparseable → the domain's anonymous answer (`401
 *    UNAUTHENTICATED`; `/mcp/skill` is public and answers its own `405`);
 * 2. anonymous + the same body, well-formed → the SAME answer — the card's
 *    statement that the anonymous answer must not depend on the parse;
 * 3. signed-in + unparseable → still the transport's refusal, read by the
 *    domain once it admitted the caller (the control: the body is read later,
 *    not dropped). `/mcp/skill` never reads a body, so it answers its `405`.
 *
 * Which door answered a `401` is read off the body: the dispatcher's envelope
 * fills `error.httpStatus`. The refusal is told from a domain's own
 * `INVALID_REQUEST` by its message, as `request-body-refusal.test.ts` in
 * `plugin-hono-server` tells it.
 *
 * Both prefixes for the registrars `enableProjectScoping` mounts twice
 * (automation, actions, security, AI, packages). `LiteKernel`, no `objectql`:
 * every answer here comes before a domain touches storage. The `auth` slot
 * answers a session only when the request carries `x-test-session`. A stub
 * `analytics` slot makes the standalone server mount `/analytics`, and a stub
 * `mcp` slot lets `/mcp` reach its anonymous decision (which follows its
 * enabled and available checks).
 */

const SESSION_HEADER = 'x-test-session';
const SCOPED = '/api/v1/environments/env_body_floor';
const UNSCOPED = '/api/v1';
/** `{"name": "probe"` — the closing brace missing. */
const UNPARSEABLE = '{"name": "probe"';
const WELL_FORMED = '{"name": "probe"}';

interface Answer { status: number; code: string }
interface Site {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** The sub-path after the prefix. */
    path: string;
    /** Mounted under the environment-scoped prefix too. */
    scoped: boolean;
    /** What an anonymous caller is answered, whatever its body. */
    anonymous: Answer;
    /** What a signed-in caller with an unparseable body is answered. */
    signedIn: Answer | 'refusal';
}

const UNAUTHENTICATED: Answer = { status: 401, code: 'UNAUTHENTICATED' };
const SKILL_405: Answer = { status: 405, code: 'METHOD_NOT_ALLOWED' };

/** The card's twenty `dispatcher.dispatch(… req.body …)` mounts, every verb of the method-parameterised ones. */
const CARD_SITES: Site[] = [
    { method: 'POST', path: '/analytics/query', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/analytics/sql', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/mcp', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'DELETE', path: '/mcp', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/mcp/skill', scoped: false, anonymous: SKILL_405, signedIn: SKILL_405 },
    { method: 'DELETE', path: '/mcp/skill', scoped: false, anonymous: SKILL_405, signedIn: SKILL_405 },
    { method: 'POST', path: '/keys', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'PUT', path: '/keys', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'PATCH', path: '/keys', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'DELETE', path: '/keys', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/notifications/read', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/notifications/read/all', scoped: false, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'PUT', path: '/automation/flow_x', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation/trigger/flow_x', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation/flow_x/trigger', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation/flow_x/toggle', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation/flow_x/clone', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation/flow_x/runs/run_1/resume', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation/flow_x/runs/run_1/cancel', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/automation/flow_x/runs/run_1/restore-suspension', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/actions//close_all', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/actions/task/close', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/actions/task/close/rec_1', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
];

/**
 * The same read, in mounts the card's single-line grep did not reach: the `/ai/*`
 * wildcards (`method.toUpperCase()` closes the grep's `[^)]*`), and the
 * `/packages` and `/security` registrars, which spell the call over several lines.
 */
const FAMILY_SITES: Site[] = [
    { method: 'POST', path: '/ai/chat', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'PUT', path: '/ai/conversations/c1', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'PATCH', path: '/ai/conversations/c1', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'DELETE', path: '/ai/conversations/c1', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/packages', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'PATCH', path: '/packages/pkg_x', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'PATCH', path: '/packages/pkg_x/enable', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/packages/pkg_x/publish', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/packages/pkg_x/rollback', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'DELETE', path: '/packages/pkg_x', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/security/_activation/permission_set/ps_x', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
    { method: 'POST', path: '/security/permission-sets/ps_x/clone', scoped: true, anonymous: UNAUTHENTICATED, signedIn: 'refusal' },
];

function fakeServicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-services-body-after-floor',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: any) =>
                        (headers?.get?.(SESSION_HEADER) ? { user: { id: 'u_body_after_floor' } } : undefined),
                },
            });
            // Occupants only: no row reaches either past the body read.
            ctx.registerService('analytics', {
                query: async () => ({ rows: [] }),
                getMeta: async () => [],
            });
            ctx.registerService('mcp', {
                handleHttpRequest: async () =>
                    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
                renderSkill: () => '# skill',
            });
        },
    };
}

describe('the body is read after the anonymous decision on every body-reading standalone mount (integration, #24151)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(fakeServicesPlugin());
        // port 0 → an OS-assigned free port, read back through getPort().
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(createDispatcherPlugin({
            prefix: UNSCOPED,
            securityHeaders: false,
            scoping: { enableProjectScoping: true, projectResolution: 'auto' },
        }));
        await kernel.bootstrap();
        baseUrl = `http://127.0.0.1:${kernel.getService<IHttpServer>('http.server').getPort!()}`;
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    async function call(method: string, url: string, body: string, signedIn: boolean): Promise<{ status: number; json: Record<string, any> }> {
        const res = await fetch(`${baseUrl}${url}`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(signedIn ? { [SESSION_HEADER]: '1' } : {}),
            },
            body,
        });
        return { status: res.status, json: (await res.json()) as Record<string, any> };
    }

    for (const site of [...CARD_SITES, ...FAMILY_SITES]) {
        for (const prefix of site.scoped ? [UNSCOPED, SCOPED] : [UNSCOPED]) {
            const url = `${prefix}${site.path}`;

            it(`anonymous ${site.method} ${url}, unparseable body → ${site.anonymous.status} ${site.anonymous.code}, as for a well-formed one`, async () => {
                const unparseable = await call(site.method, url, UNPARSEABLE, false);
                const wellFormed = await call(site.method, url, WELL_FORMED, false);

                expect(unparseable.status).toBe(site.anonymous.status);
                expect(unparseable.json.success).toBe(false);
                expect(unparseable.json.error.code).toBe(site.anonymous.code);
                // The dispatcher's envelope, not the transport's refusal.
                expect(unparseable.json.error.httpStatus).toBe(site.anonymous.status);
                // The anonymous answer does not depend on whether the body parses.
                expect({ status: wellFormed.status, code: wellFormed.json.error?.code })
                    .toEqual({ status: unparseable.status, code: unparseable.json.error.code });
            });

            it(`signed-in ${site.method} ${url}, unparseable body → ${site.signedIn === 'refusal' ? "the transport's 400 refusal, read by the domain" : `${site.signedIn.status} ${site.signedIn.code}`}`, async () => {
                const { status, json } = await call(site.method, url, UNPARSEABLE, true);

                expect(json.success).toBe(false);
                if (site.signedIn === 'refusal') {
                    expect(status).toBe(400);
                    expect(json.error.code).toBe('INVALID_REQUEST');
                    expect(json.error.message).toMatch(/parsed as JSON/);
                } else {
                    expect(status).toBe(site.signedIn.status);
                    expect(json.error.code).toBe(site.signedIn.code);
                }
            });
        }
    }
});
