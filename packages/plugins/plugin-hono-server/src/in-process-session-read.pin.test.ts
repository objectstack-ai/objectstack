// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] The current-user endpoints' in-process `auth.api.getSession` read
 * (`makeExecutionContextResolver`, behind `GET /api/v1/auth/me/permissions` and
 * its siblings) hands better-auth the in-process session-read rule's input
 * (`inProcessSessionReadInput`, `@objectstack/types`).
 *
 * A request carrying a session cookie reads with `query.disableRefresh`: these
 * routes answer with their own response, so a renewal here would move the
 * session's expiry while its renewed cookie is discarded. A bearer-only request
 * reads exactly as before, renewal included. What `disableRefresh` then DOES
 * against real better-auth is pinned end to end through this door in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const USER = 'usr_22258';
const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';

function mount() {
    const calls: any[] = [];
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async (input: any) => {
                    calls.push(input);
                    return { user: { id: USER }, session: {} };
                },
            },
        },
        objectql: { find: async () => [], registry: { getAllApps: () => [], getAllObjects: () => [] } },
        metadata: { list: async () => [] as unknown[] },
        security: { resolvePermissionSetsForContext: async () => [] },
    };
    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn() {} },
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    return { app, calls };
}

async function readMePermissions(headers: Record<string, string>) {
    const { app, calls } = mount();
    const res = await app.request(`http://localhost${ME_PERMISSIONS}`, { headers });
    return { calls, status: res.status, body: (await res.json()) as any };
}

describe('[#22258] the current-user endpoints read the session by the in-process rule', () => {
    it('a request carrying a session cookie reads without renewal', async () => {
        const { calls, status } = await readMePermissions({ cookie: SESSION_COOKIE });
        expect(status, 'the fixture resolves the caller — the door really ran').toBe(200);
        expect(calls.length).toBeGreaterThan(0);
        for (const input of calls) {
            expect(input.query, 'a cookie request renewed in-process').toEqual({ disableRefresh: true });
            expect(input.headers.get('cookie')).toBe(SESSION_COOKIE);
        }
    });

    it('the console sends cookie AND bearer — still no renewal in-process', async () => {
        const { calls } = await readMePermissions({ cookie: SESSION_COOKIE, authorization: BEARER });
        expect(calls.length).toBeGreaterThan(0);
        for (const input of calls) expect(input.query).toEqual({ disableRefresh: true });
    });

    it('a bearer-only request reads exactly as before — renewal stays on, no query at all', async () => {
        const { calls, status } = await readMePermissions({ authorization: BEARER });
        expect(status).toBe(200);
        expect(calls.length).toBeGreaterThan(0);
        for (const input of calls) {
            expect('query' in input, 'a bearer-only read lost its renewal').toBe(false);
            expect(input.headers.get('authorization')).toBe(BEARER);
        }
    });
});
