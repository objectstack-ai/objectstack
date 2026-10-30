// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #27842 — the DEFAULT `GET /meta/object/:name` carries, beside the object, the
// packaged actions this deployment's activation ledger switches off.
//
// `metadata.enableCache` defaults to `true`, so a default deployment answers
// this read from the CACHED branch, which rebuilds the envelope as
// `{ type, name, item }` — the door every console, SDK and MCP consumer builds
// its action buttons from. The uncached read serves `disabledActions` beside
// `lock`; this branch has to carry it too, or a switched-off action reads as
// live on exactly the door that matters.
//
// An object's validator is folded and judged HERE (`audienceFolds`), not in the
// protocol, so this file also pins the 304 half (#28044): the served
// `disabledActions` is folded into that validator, so an unchanged object under
// an unchanged switch set is answered 304, a switch flipped off or on answers
// 200 under a new ETag, and an object no ledger answered for keeps the ETag it
// had before.
//
// The protocol double answers `getMetaItemCached` the way `metadata-protocol`'s
// producer does: the document under `data`, its ETag, and — where a ledger
// answered — the live `disabledActions` its delegate read resolved (pinned on
// the real producer in `protocol.object-disabled-actions.test.ts`).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

const TASK = {
    name: 'showcase_task',
    label: 'Task',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
    actions: [
        { name: 'showcase_mark_done', label: 'Mark Done', type: 'script' },
        { name: 'showcase_snooze', label: 'Snooze', type: 'script' },
    ],
};

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/** `disabledActions` as the producer resolved it: the names, `[]`, or `undefined` (no ledger answered). */
function setup(disabledActions: string[] | undefined) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(),
        findData: vi.fn().mockResolvedValue([]),
        getMetaItemCached: vi.fn(async () => ({
            data: JSON.parse(JSON.stringify(TASK)),
            ...(disabledActions !== undefined ? { disabledActions } : {}),
            etag: { value: 'etag_task', weak: false },
            cacheControl: { directives: ['private', 'no-cache'] },
            notModified: false,
        })),
    };
    const rest = new RestServer(mockServer() as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return { rest, protocol };
}

async function getItem(rest: any, type: string, name: string, headers: Record<string, string> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('GET /api/v1/meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type, name }, query: {}, body: {}, headers }, res);
    return res;
}

describe('the default cached `GET /meta/object/:name` carries `disabledActions` beside the object (#27842)', () => {
    it('a switched-off action is named beside the item, and `item.actions` is served as declared', async () => {
        const { rest, protocol } = setup(['showcase_mark_done']);

        const res = await getItem(rest, 'object', 'showcase_task');

        // The default branch, measured — not the uncached read.
        expect(protocol.getMetaItemCached).toHaveBeenCalledTimes(1);
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(res.body.disabledActions).toEqual(['showcase_mark_done']);
        expect(res.body.item.actions.map((a: any) => a.name)).toEqual(['showcase_mark_done', 'showcase_snooze']);
        expect(res.body.item).not.toHaveProperty('disabledActions');
    });

    it('`[]` from a ledger that switches none of them off is served as `[]`', async () => {
        const res = await getItem(setup([]).rest, 'object', 'showcase_task');
        expect(res.statusCode).toBe(200);
        expect(res.body.disabledActions).toEqual([]);
    });

    it('control: where no ledger answered, the envelope carries no key at all', async () => {
        const res = await getItem(setup(undefined).rest, 'object', 'showcase_task');
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toHaveProperty('disabledActions');
        expect(res.body.item.actions).toHaveLength(2);
    });

});

// #28044 — the switched-off names are folded into the validator this door
// issues, so a cached object read that carries `disabledActions` revalidates
// like any other: `304` while neither the document nor the switch set moved,
// `200` under a new ETag once an administrator switches an action off or on.
describe('the cached `GET /meta/object/:name` folds `disabledActions` into its ETag (#28044)', () => {
    /** Read once, then revalidate with the ETag that answer issued — against `next` as the ledger then answers. */
    async function revalidate(first: string[] | undefined, next: string[] | undefined) {
        const served = await getItem(setup(first).rest, 'object', 'showcase_task');
        expect(served.statusCode).toBe(200);
        const etag = served.headers.ETag;
        expect(typeof etag).toBe('string');
        const again = await getItem(setup(next).rest, 'object', 'showcase_task', { 'if-none-match': etag });
        return { etag, again };
    }

    it('an unchanged object under an unchanged switch set is answered 304', async () => {
        const { again } = await revalidate(['showcase_mark_done'], ['showcase_mark_done']);
        expect(again.statusCode).toBe(304);
        expect(again.body).toBeUndefined();
    });

    it('an action switched OFF moves the ETag: 200 with the new list under a new validator', async () => {
        const { etag, again } = await revalidate(['showcase_mark_done'], ['showcase_mark_done', 'showcase_snooze']);
        expect(again.statusCode).toBe(200);
        expect(again.body.disabledActions).toEqual(['showcase_mark_done', 'showcase_snooze']);
        expect(again.headers.ETag).not.toBe(etag);
    });

    it('an action switched back ON moves the ETag: 200 with `[]` under a new validator', async () => {
        const { etag, again } = await revalidate(['showcase_mark_done'], []);
        expect(again.statusCode).toBe(200);
        expect(again.body.disabledActions).toEqual([]);
        expect(again.headers.ETag).not.toBe(etag);
    });

    it('absent and `[]` fold differently: a ledger attaching (or detaching) moves the ETag', async () => {
        const attached = await revalidate(undefined, []);
        expect(attached.again.statusCode).toBe(200);
        expect(attached.again.body.disabledActions).toEqual([]);
        expect(attached.again.headers.ETag).not.toBe(attached.etag);

        const detached = await revalidate([], undefined);
        expect(detached.again.statusCode).toBe(200);
        expect(detached.again.body).not.toHaveProperty('disabledActions');
        expect(detached.again.headers.ETag).not.toBe(detached.etag);
    });

    it('control: an object with no switched-off action keeps its 304, under the validator it had before', async () => {
        const none = await revalidate(undefined, undefined);
        expect(none.again.statusCode).toBe(304);
        // No ledger answered → nothing folds: the ETag is the document's own.
        expect(none.etag).toBe('"etag_task"');

        const empty = await revalidate([], []);
        expect(empty.again.statusCode).toBe(304);
    });
});
