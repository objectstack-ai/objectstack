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
// protocol, so this file also pins the 304 half: a read that carries the key is
// answered in full whatever `If-None-Match` says, because an administrator's
// switch moves no byte the validator hashes; and the unjudged control still is
// answered 304.
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

    it('a read that carries the key is never answered 304; control: the unjudged read still is', async () => {
        // The validator this door issues for the document, read off a first
        // answer and sent back as `If-None-Match`.
        const first = await getItem(setup(undefined).rest, 'object', 'showcase_task');
        const etag = first.headers.ETag;
        expect(typeof etag).toBe('string');

        const judged = await getItem(setup(['showcase_mark_done']).rest, 'object', 'showcase_task', { 'if-none-match': etag });
        expect(judged.statusCode).toBe(200);
        expect(judged.body.disabledActions).toEqual(['showcase_mark_done']);
        // The validator itself is unchanged by the key: the same document, the same ETag.
        expect(judged.headers.ETag).toBe(etag);

        const unjudged = await getItem(setup(undefined).rest, 'object', 'showcase_task', { 'if-none-match': etag });
        expect(unjudged.statusCode).toBe(304);
    });
});
