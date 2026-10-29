// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /approvals/requests/:id/actions` answers a request the caller cannot
 * read the way its parent door `GET /approvals/requests/:id` does: `404
 * REQUEST_NOT_FOUND`, the same envelope, from the same lookup.
 *
 * Before, the sub-resource listed rows without resolving its parent, so an
 * unknown id answered `200 { data: [] }`, and so did an existing request the
 * caller may not see. "No actions yet" could not be told from "no such
 * request". An unknown id and an invisible id still answer alike, so the
 * sub-resource leaks no more about existence than the parent does.
 *
 * The stub models the service's own rule: `getRequest` answers `null` for an
 * id it does not hold AND for a request outside the caller's visibility, and
 * `listActions` is gated by `getRequest` exactly as `ApprovalService` gates it
 * (an empty list where the parent is null). That is what made the old answer
 * an empty 200 rather than a leak.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';

const REQ = '/api/v1/approvals/requests/:id';

const REQUEST = { id: 'req_1', status: 'pending', object_name: 'deal', record_id: 'd1', participants: ['u1'] };
const ACTIONS = [
    { id: 'act_1', request_id: 'req_1', action: 'submit', actor_id: 'u1', actor_name: 'Ada' },
    { id: 'act_2', request_id: 'req_1', action: 'comment', actor_id: 'u1', comment: 'ping' },
];

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    };
    return res;
}

function approvalsStub() {
    const getRequest = vi.fn(async (id: string, ctx: any) =>
        id === REQUEST.id && REQUEST.participants.includes(ctx?.userId) ? { ...REQUEST } : null);
    const listActions = vi.fn(async (id: string, ctx: any) =>
        (await getRequest(id, ctx)) ? ACTIONS.map((a) => ({ ...a })) : []);
    return { getRequest, listActions };
}

function boot(approvals: Record<string, any>, userId: string) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        findData: vi.fn().mockResolvedValue({ records: [] }),
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, // kernelManager
        undefined, // envRegistry
        undefined, // defaultEnvironmentIdProvider
        undefined, // authServiceProvider
        undefined, // objectQLProvider
        undefined, // emailServiceProvider
        undefined, // sharingServiceProvider
        undefined, // reportsServiceProvider
        async () => approvals, // approvalsServiceProvider
    );
    (rest as any).resolveExecCtx = async () => ({ userId });
    rest.registerRoutes();
    return rest;
}

async function get(rest: any, path: string, id: string) {
    const found = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    if (!found) throw new Error(`route not registered: GET ${path}`);
    const res = mockRes();
    await found.handler({ method: 'GET', path, params: { id }, query: {}, headers: {}, body: {} } as any, res);
    return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('GET /approvals/requests/:id/actions answers an unreadable parent as the parent door does', () => {
    it('an unknown request id is 404 REQUEST_NOT_FOUND with the parent door\'s envelope, and no rows are listed', async () => {
        const svc = approvalsStub();
        const rest = boot(svc, 'u1');
        const parent = await get(rest, REQ, 'areq_does-not-exist');
        const actions = await get(rest, `${REQ}/actions`, 'areq_does-not-exist');

        expect(parent.status).toBe(404);
        expect(parent.body?.code).toBe('REQUEST_NOT_FOUND');
        expect(actions.status).toBe(404);
        expect(actions.body?.code).toBe('REQUEST_NOT_FOUND');
        expect(actions.body).toEqual(parent.body);
        expect(svc.listActions).not.toHaveBeenCalled();
    });

    it('an existing request the caller cannot see answers the same 404 as the parent, indistinguishable from an unknown id', async () => {
        const svc = approvalsStub();
        const rest = boot(svc, 'outsider');
        const parent = await get(rest, REQ, REQUEST.id);
        const actions = await get(rest, `${REQ}/actions`, REQUEST.id);
        const unknown = await get(rest, `${REQ}/actions`, 'areq_does-not-exist');

        expect(parent.status).toBe(404);
        expect(actions.status).toBe(404);
        expect(actions.body?.code).toBe('REQUEST_NOT_FOUND');
        expect(actions.body).toEqual(parent.body);
        // No existence leak: the invisible id and the unknown id differ only in the id they name.
        expect({ status: unknown.status, code: unknown.body?.code }).toEqual({ status: actions.status, code: actions.body?.code });
        expect(unknown.body?.error).toBe(String(actions.body?.error).replace(REQUEST.id, 'areq_does-not-exist'));
        expect(svc.listActions).not.toHaveBeenCalled();
    });

    it('a visible request with actions is still 200 with its rows unchanged', async () => {
        const svc = approvalsStub();
        const rest = boot(svc, 'u1');
        const actions = await get(rest, `${REQ}/actions`, REQUEST.id);

        expect(actions.status).toBe(200);
        expect(actions.body).toEqual({ data: ACTIONS });
        expect(svc.listActions).toHaveBeenCalledTimes(1);
        expect(svc.listActions).toHaveBeenCalledWith(REQUEST.id, { userId: 'u1' });
    });
});
