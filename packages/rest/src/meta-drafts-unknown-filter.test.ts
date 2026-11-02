// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29180] `GET /meta/_drafts` refuses a `type` that names no metadata type.
 *
 * `?type=dashbord` (or `dashboardes`, `viewes`, `nosuchtype`) answered
 * `200 {"drafts":[]}`, a confident "nothing pending", where `GET /meta/dashbord`
 * refuses the same name `400`. The route now asks the list door's own verdict
 * (`refuseUnknownMetaListType`), so this file pins the drafts answer EQUAL to
 * the list door's answer for the same name on the same server — one code, one
 * sentence — and that `listDrafts` was never called. The controls: a known type
 * in either spelling still reaches `listDrafts` and answers `200` empty.
 *
 * The package half lives in `listDrafts` itself
 * (`@objectstack/metadata-protocol`'s `protocol-drafts-unknown-package.test.ts`);
 * the last case here pins that its classified refusal leaves this route as a
 * 400 with its code.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        send: vi.fn(function (this: any) { return this; }),
        end: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

function boot(listDrafts = vi.fn(async (_r: unknown) => ({ drafts: [] as unknown[] }))) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: ['view', 'dashboard', 'object'] }),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        listDrafts,
    };
    const server = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn() };
    const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    // `isSystem` clears the authoring gate that runs before the query is read.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    const route = (path: string) => (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    const drive = async (path: string, params: Record<string, string>, query: Record<string, unknown>) => {
        const res = mockRes();
        await route(path).handler({ method: 'GET', path, params, query, headers: {}, body: {} }, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
    return { protocol, drive };
}

describe('[#29180] GET /meta/_drafts — a type filter that names no type', () => {
    it.each(['dashbord', 'dashboardes', 'viewes', 'nosuchtype'])(
        '`?type=%s` answers the list door\'s own 400, and listDrafts is never called',
        async (type) => {
            const { protocol, drive } = boot();
            const drafts = await drive('/api/v1/meta/_drafts', {}, { type });
            const list = await drive('/api/v1/meta/:type', { type }, {});
            expect(drafts.status).toBe(400);
            expect(drafts.body).toEqual(list.body);
            expect(JSON.stringify(drafts.body)).toContain('INVALID_REQUEST');
            expect(JSON.stringify(drafts.body)).toContain(`'${type}' is not a metadata type.`);
            expect(protocol.listDrafts).not.toHaveBeenCalled();
        },
    );

    it.each(['dashboard', 'dashboards', 'view'])(
        'a known type (`?type=%s`) still reaches listDrafts as sent and answers 200 empty',
        async (type) => {
            const { protocol, drive } = boot();
            const answer = await drive('/api/v1/meta/_drafts', {}, { type });
            expect(answer).toEqual({ status: 200, body: { drafts: [] } });
            expect(protocol.listDrafts).toHaveBeenCalledWith({ packageId: undefined, type });
        },
    );

    it('a known package with no drafts and no type answers 200 empty', async () => {
        const { protocol, drive } = boot();
        expect(await drive('/api/v1/meta/_drafts', {}, { packageId: 'com.acme' })).toEqual({ status: 200, body: { drafts: [] } });
        expect(protocol.listDrafts).toHaveBeenCalledWith({ packageId: 'com.acme', type: undefined });
    });

    it('the package refusal listDrafts throws leaves the route a 400 INVALID_REQUEST', async () => {
        const refusal = Object.assign(new Error("'com.qa.nosuch' is not an installed package, and no pending draft is bound to it."), {
            code: 'INVALID_REQUEST', status: 400,
        });
        const { drive } = boot(vi.fn(async () => { throw refusal; }));
        const answer = await drive('/api/v1/meta/_drafts', {}, { packageId: 'com.qa.nosuch' });
        expect(answer.status).toBe(400);
        expect(JSON.stringify(answer.body)).toContain('INVALID_REQUEST');
        expect(JSON.stringify(answer.body)).toContain('is not an installed package');
    });
});
