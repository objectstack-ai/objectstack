// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23214 slice 1] ONE list per `/meta` arity door, read by both transports.
 *
 * `META_QUERY_ARITY_DOORS` holds the single-valued names of the four `/meta`
 * doors whose only query rule is arity: the list, the book tree, `_drafts` and
 * the state machine read. `RestServer` hands each list to
 * `refuseRepeatedQueryParams`, and the runtime dispatcher's twin asks
 * `metaQueryArityRefusal` over it (`packages/runtime/src/domains/
 * dispatcher-query-arity.test.ts` pins that side). Before this, each list was
 * spelled inline in `rest-server.ts` and nowhere else, so the dispatcher had
 * none: a repeat reached its read points as an array.
 *
 * This file pins the decision itself, and that `RestServer` refuses exactly the
 * names the shared list declares, door by door. `RestServer`'s answers did not
 * move when the lists did: a BASE/HEAD differential of every name on all four
 * doors (two and three repeats, a one-element array, an empty array, one value,
 * two repeated names, an undeclared repeat) was byte-identical.
 */

import { describe, it, expect, vi } from 'vitest';
import { META_QUERY_ARITY_DOORS, metaQueryArityRefusal, type MetaQueryArityDoor } from './meta-item-read-gate.js';
import { repeatedQueryParamMessage } from './query-multiplicity.js';
import { RestServer } from './rest-server.js';

const DOORS = Object.keys(META_QUERY_ARITY_DOORS) as MetaQueryArityDoor[];

describe('metaQueryArityRefusal — the arity rule as data', () => {
    it.each(DOORS.flatMap((door) => META_QUERY_ARITY_DOORS[door].map((name) => [door, name] as const)))(
        '%s door: a repeated `%s` is refused with the multiplicity sentence',
        (door, name) => {
            expect(metaQueryArityRefusal(door, { [name]: ['a', 'b', 'c'] })).toEqual({
                status: 400,
                code: 'VALIDATION_ERROR',
                message: repeatedQueryParamMessage(name, 3),
                rule: 'repeated-parameter',
            });
        },
    );

    it('unwraps one occurrence IN PLACE, reads an empty array as none, and leaves strings alone', () => {
        const query: Record<string, unknown> = { package: ['com.acme'], preview: [], object: 'task' };
        expect(metaQueryArityRefusal('list', query)).toBeUndefined();
        expect(query).toEqual({ package: 'com.acme', preview: undefined, object: 'task' });
    });

    it('never touches a name its door does not declare', () => {
        const query: Record<string, unknown> = { locale: ['en', 'fr'], select: ['a', 'b'] };
        expect(metaQueryArityRefusal('list', query)).toBeUndefined();
        expect(query).toEqual({ locale: ['en', 'fr'], select: ['a', 'b'] });
    });

    it('answers two repeated names for the first one the door declares', () => {
        expect(metaQueryArityRefusal('list', { id: ['a', 'b'], package: ['c', 'd'] })?.message)
            .toBe(repeatedQueryParamMessage('package', 2));
    });

    it('carries no name in a query that is not an object', () => {
        expect(metaQueryArityRefusal('state', undefined)).toBeUndefined();
        expect(metaQueryArityRefusal('state', 'from=a')).toBeUndefined();
    });
});

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

/** Each door's route on a `RestServer` whose protocol records every read. */
function bootRest() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: ['view', 'book', 'doc'] }),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'book', name: 'handbook', item: { name: 'handbook' }, lock: 'none' }),
        listDrafts: vi.fn().mockResolvedValue({ items: [] }),
    };
    const server = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn() };
    const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    // `isSystem` clears the capability gates that run before the query is read.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    const route = (path: string) => (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    return { protocol, route };
}

const DOOR_ROUTES: Record<MetaQueryArityDoor, { path: string; params: Record<string, string> }> = {
    list: { path: '/api/v1/meta/:type', params: { type: 'view' } },
    'book-tree': { path: '/api/v1/meta/book/:name/tree', params: { name: 'handbook' } },
    drafts: { path: '/api/v1/meta/_drafts', params: {} },
    state: { path: '/api/v1/meta/object/:name/state/:field', params: { name: 'task', field: 'status' } },
};

async function drive(door: MetaQueryArityDoor, query: Record<string, unknown>) {
    const { protocol, route } = bootRest();
    const { path, params } = DOOR_ROUTES[door];
    const res = mockRes();
    await route(path).handler({ method: 'GET', path, params, query, headers: {}, body: {} }, res);
    return { protocol, status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('RestServer refuses exactly the names the shared list declares, door by door', () => {
    it.each(DOORS.flatMap((door) => META_QUERY_ARITY_DOORS[door].map((name) => [door, name] as const)))(
        '%s door: a repeated `%s` answers the nested 400 before any protocol read',
        async (door, name) => {
            const { protocol, status, body } = await drive(door, { [name]: ['a', 'b'] });
            expect(status).toBe(400);
            expect(body).toEqual({ error: { code: 'VALIDATION_ERROR', message: repeatedQueryParamMessage(name, 2) } });
            expect(protocol.getMetaItems).not.toHaveBeenCalled();
            expect(protocol.listDrafts).not.toHaveBeenCalled();
        },
    );

    it('preserves one value on each door: it reaches the protocol as the string', async () => {
        expect((await drive('list', { package: ['com.acme'] })).protocol.getMetaItems.mock.calls[0][0])
            .toMatchObject({ packageId: 'com.acme' });
        expect((await drive('book-tree', { package: 'com.acme' })).protocol.getMetaItems.mock.calls[0][0])
            .toMatchObject({ packageId: 'com.acme' });
        expect((await drive('drafts', { packageId: 'com.acme', type: ['view'] })).protocol.listDrafts)
            .toHaveBeenCalledWith({ packageId: 'com.acme', type: 'view' });
        // The state read reaches its engine seam with one `from`; this RestServer
        // wires no engine, so the honest answer is the not-found it always gave.
        expect((await drive('state', { from: 'todo' })).status).not.toBe(400);
    });
});
