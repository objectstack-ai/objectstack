// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #28001 — the DEFAULT `GET /meta/object/:name` carries, beside the object, the
// objects a delete of one of its records can cascade into, so the console's
// delete confirmation can name them without a second request.
//
// `metadata.enableCache` defaults to `true`, so a default deployment answers
// this read from the CACHED branch, which rebuilds the envelope as
// `{ type, name, item }`. The uncached read serves `cascadeDeleteObjects`
// beside `lock`; this branch has to carry it too.
//
// An object's validator is folded and judged HERE (`audienceFolds`), so this
// file also pins the 304 half, on `disabledActions`' (#28044) terms: the served
// list is folded into the validator, so an unchanged object with an unchanged
// cascade is answered 304, an object registered later that cascades into it
// answers 200 under a new ETag, and an object no engine answered for keeps the
// ETag it had before.
//
// The protocol double answers `getMetaItemCached` the way `metadata-protocol`'s
// producer does (pinned on the real producer in
// `protocol.object-cascade-delete-objects.test.ts`).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

const LEAD = {
    name: 'crm_lead',
    label: 'Lead',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
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

/** `cascadeDeleteObjects` as the producer resolved it: the names, `[]`, or `undefined` (no engine answered). */
function setup(cascadeDeleteObjects: string[] | undefined) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(),
        findData: vi.fn().mockResolvedValue([]),
        getMetaItemCached: vi.fn(async () => ({
            data: JSON.parse(JSON.stringify(LEAD)),
            ...(cascadeDeleteObjects !== undefined ? { cascadeDeleteObjects } : {}),
            etag: { value: 'etag_lead', weak: false },
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

describe('the default cached `GET /meta/object/:name` carries `cascadeDeleteObjects` beside the object (#28001)', () => {
    it('the objects a delete cascades into are named beside the item, never inside it', async () => {
        const { rest, protocol } = setup(['crm_campaign_member']);

        const res = await getItem(rest, 'object', 'crm_lead');

        // The default branch, measured — not the uncached read.
        expect(protocol.getMetaItemCached).toHaveBeenCalledTimes(1);
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(res.body.cascadeDeleteObjects).toEqual(['crm_campaign_member']);
        expect(res.body.item).not.toHaveProperty('cascadeDeleteObjects');
    });

    it('`[]` from an engine that answered nothing cascades is served as `[]`', async () => {
        const res = await getItem(setup([]).rest, 'object', 'crm_lead');
        expect(res.statusCode).toBe(200);
        expect(res.body.cascadeDeleteObjects).toEqual([]);
    });

    it('control: where no engine answered, the envelope carries no key at all', async () => {
        const res = await getItem(setup(undefined).rest, 'object', 'crm_lead');
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toHaveProperty('cascadeDeleteObjects');
    });
});

describe('the cached `GET /meta/object/:name` folds `cascadeDeleteObjects` into its ETag (#28001)', () => {
    /** Read once, then revalidate with the ETag that answer issued — against `next` as the engine then answers. */
    async function revalidate(first: string[] | undefined, next: string[] | undefined) {
        const served = await getItem(setup(first).rest, 'object', 'crm_lead');
        expect(served.statusCode).toBe(200);
        const etag = served.headers.ETag;
        expect(typeof etag).toBe('string');
        const again = await getItem(setup(next).rest, 'object', 'crm_lead', { 'if-none-match': etag });
        return { etag, again };
    }

    it('an unchanged object with an unchanged cascade is answered 304', async () => {
        const { again } = await revalidate(['crm_campaign_member'], ['crm_campaign_member']);
        expect(again.statusCode).toBe(304);
        expect(again.body).toBeUndefined();
    });

    it('an object registered later that cascades into this one moves the ETag: 200 with the new list', async () => {
        const { etag, again } = await revalidate(['crm_campaign_member'], ['crm_campaign_member', 'crm_lead_note']);
        expect(again.statusCode).toBe(200);
        expect(again.body.cascadeDeleteObjects).toEqual(['crm_campaign_member', 'crm_lead_note']);
        expect(again.headers.ETag).not.toBe(etag);
    });

    it('control: an object no engine answered for keeps the validator it had before, and its 304', async () => {
        const none = await revalidate(undefined, undefined);
        expect(none.again.statusCode).toBe(304);
        expect(none.etag).toBe('"etag_lead"');
    });
});
