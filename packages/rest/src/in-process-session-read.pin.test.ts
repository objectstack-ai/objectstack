// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] Both of this package's in-process `auth.api.getSession` readers hand
 * better-auth the in-process session-read rule's input
 * (`inProcessSessionReadInput`, `@objectstack/types`):
 *
 *   ① `computeExecCtx`'s session getter, handed to `resolveAuthzContext`;
 *   ② the auth-gate re-read below it (reached only when a gate is active, so
 *      the fixture's auth service declares one).
 *
 * A request carrying a session cookie reads with `query.disableRefresh` — the
 * door's response never carries a renewed cookie, so a renewal here would leave
 * the browser's cookie to die before its session. A bearer-only request reads
 * exactly as before, renewal included. What `disableRefresh` then DOES against
 * real better-auth (an aged session's `sys_session.expires_at` read back) is
 * pinned end to end through this door in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: { id: { type: 'text', label: 'ID' }, title: { type: 'text', label: 'Title' } },
};

const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';

const makeServer = () => ({
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
});

const makeQl = () => ({
    find: async (object: string, opts: any) => {
        if (object === 'sys_user') return [{ id: opts?.where?.id, email: 'member@example.com' }];
        return [];
    },
});

function makeRes() {
    let status = 200;
    const res: any = {
        write: () => true,
        end: () => {},
        header: () => res,
        status: (code: number) => { status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return { res, getStatus: () => status };
}

/** Drive `GET /api/v1/data/task` and return every input `getSession` was handed. */
async function readThroughDataDoor(headers: Record<string, string>) {
    const calls: any[] = [];
    const auth = {
        // Declared ACTIVE so the gate re-read (②) runs too; the user carries no
        // gate, so the request is admitted.
        isAuthGateActive: () => true,
        api: {
            getSession: async (input: any) => {
                calls.push(input);
                return { user: { id: 'member1' } };
            },
        },
    };
    const protocol: any = {
        getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
        findData: vi.fn(async () => ({ object: 'task', records: [] })),
    };
    const rest = new RestServer(
        makeServer() as any,
        protocol as any,
        {} as any,
        undefined,              // kernelManager
        undefined,              // envRegistry
        undefined,              // defaultEnvironmentIdProvider
        async () => auth,       // authServiceProvider
        async () => makeQl(),   // objectQLProvider
    );
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    expect(route, 'the data door is registered').toBeDefined();
    const out = makeRes();
    await route!.handler({
        method: 'GET',
        path: '/api/v1/data/task',
        params: { object: 'task' }, query: {}, headers,
    } as any, out.res);
    return { calls, status: out.getStatus(), findData: protocol.findData };
}

describe('[#22258] the REST data door reads the session by the in-process rule', () => {
    it('a request carrying a session cookie reaches BOTH readers, and each reads without renewal', async () => {
        const { calls, status, findData } = await readThroughDataDoor({ cookie: SESSION_COOKIE });
        expect(status, 'the fixture admits the caller — the door really ran').toBe(200);
        expect(findData).toHaveBeenCalledTimes(1);
        expect(calls.length, 'the session getter AND the gate re-read both ran').toBe(2);
        for (const input of calls) {
            expect(input.query, 'a cookie request renewed in-process').toEqual({ disableRefresh: true });
            // The request's own credential is what better-auth reads — the rule
            // decides renewal only, never which session resolves.
            expect(input.headers.get('cookie')).toBe(SESSION_COOKIE);
        }
    });

    it('the console sends cookie AND bearer — still no renewal in-process', async () => {
        const { calls } = await readThroughDataDoor({ cookie: SESSION_COOKIE, authorization: BEARER });
        expect(calls.length).toBe(2);
        for (const input of calls) expect(input.query).toEqual({ disableRefresh: true });
    });

    it('a bearer-only request reads exactly as before — renewal stays on, no query at all', async () => {
        const { calls, status } = await readThroughDataDoor({ authorization: BEARER });
        expect(status).toBe(200);
        expect(calls.length).toBe(2);
        for (const input of calls) {
            expect('query' in input, 'a bearer-only read lost its renewal').toBe(false);
            expect(input.headers.get('authorization')).toBe(BEARER);
        }
    });
});
