// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] `POST /api/v1/webhooks/redeliver` reads the caller's session
 * in-process (`resolveSession`) and hands better-auth the in-process
 * session-read rule's input (`inProcessSessionReadInput`, `@objectstack/types`).
 *
 * A request carrying a session cookie reads with `query.disableRefresh`: this
 * route answers with its own response, so a renewal here would move the
 * session's expiry while its renewed cookie is discarded — the browser's
 * cookie would then die before its session (a split session). A bearer-only
 * request reads exactly as before, renewal included. What that input DOES
 * against real better-auth is pinned end to end in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts` and
 * `packages/plugins/plugin-auth/src/in-process-session-renewal.pin.test.ts`.
 *
 * The harness is `webhook-redeliver-tenant-scope.test.ts`'s: the plugin's REAL
 * `registerAdminRoutes`, its handler captured and called with a Hono-shaped
 * context.
 */

import { describe, it, expect } from 'vitest';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';

const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';

/** Mount the real route over an `auth` service whose `getSession` records its input. */
async function redeliver(headers: Record<string, string>) {
    const calls: any[] = [];
    const redelivered: string[] = [];
    let handler: ((c: any) => Promise<any>) | undefined;
    const rawApp = {
        post(path: string, h: (c: any) => Promise<any>) {
            if (path === '/api/v1/webhooks/redeliver') handler = h;
        },
    };
    const services: Record<string, any> = {
        'http-server': { getRawApp: () => rawApp },
        messaging: {
            enqueueHttp: async () => 'unused',
            isHttpDeliveryReady: () => true,
            registerRedeliverGuard: () => {},
            redeliverHttp: async (id: string) => {
                redelivered.push(id);
                return { id, status: 'pending' };
            },
        },
        auth: {
            api: {
                getSession: async (input: any) => {
                    calls.push(input);
                    return { user: { id: 'usr_22258' }, session: { userId: 'usr_22258', activeOrganizationId: 'org_22258' } };
                },
            },
        },
    };
    const ctx: any = {
        getService: (n: string) => services[n],
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };
    (new WebhookOutboxPlugin() as any).registerAdminRoutes(ctx);
    if (!handler) throw new Error('route was not mounted');

    let status = 200;
    const c = {
        req: { raw: { headers: new Headers(headers) }, json: async () => ({ deliveryId: 'del_22258' }) },
        json(_payload: any, s?: number) {
            if (s !== undefined) status = s;
            return { status };
        },
    };
    await handler(c);
    return { calls, status, redelivered };
}

describe('[#22258] the redeliver route reads the session by the in-process rule', () => {
    it('a request carrying a session cookie reads without renewal', async () => {
        const { calls, status, redelivered } = await redeliver({ cookie: SESSION_COOKIE });
        // The fixture resolves the caller and the route really ran past its gate.
        expect(status).toBe(200);
        expect(redelivered).toEqual(['del_22258']);
        expect(calls).toHaveLength(1);
        expect(calls[0].query, 'a cookie request renewed in-process').toEqual({ disableRefresh: true });
        expect(calls[0].headers.get('cookie')).toBe(SESSION_COOKIE);
    });

    it('the console sends cookie AND bearer — still no renewal in-process', async () => {
        const { calls } = await redeliver({ cookie: SESSION_COOKIE, authorization: BEARER });
        expect(calls).toHaveLength(1);
        expect(calls[0].query).toEqual({ disableRefresh: true });
    });

    it('a bearer-only request reads exactly as before — renewal stays on, no query at all', async () => {
        const { calls, status } = await redeliver({ authorization: BEARER });
        expect(status).toBe(200);
        expect(calls).toHaveLength(1);
        expect('query' in calls[0], 'a bearer-only read lost its renewal').toBe(false);
        expect(calls[0].headers.get('authorization')).toBe(BEARER);
    });
});
