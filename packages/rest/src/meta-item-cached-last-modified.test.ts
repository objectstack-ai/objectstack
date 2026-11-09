// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #31196 — the cached `GET /meta/:type/:name` sends `Last-Modified` only as the
// protocol's `lastModified`: the item's own change time (the stored row's
// `updated_at`), or nothing when the protocol knows none. The producer half —
// a save and a publish move it, a read never does, a code-shipped item has
// none — is pinned on the real producer in `metadata-protocol`'s
// `protocol.cached-item-last-modified.test.ts`.
//
// This door renders the key and judges nothing from it: a conditional read is
// judged by the ETag alone, so `If-Modified-Since` never answers a `304`, with
// or without a time to compare against.

// Pays `@objectstack/objectql`'s first load at collection, never inside a clocked case
// (the route modules import it lazily).
import '@objectstack/objectql';
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

const PAGE = { name: 'home_page', label: 'Home', type: 'app', regions: [] };

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

/** The producer's answer: `lastModified` when a stored row serves the item, no key otherwise. */
function setup(lastModified: string | undefined) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(),
        findData: vi.fn().mockResolvedValue([]),
        getMetaItemCached: vi.fn(async () => ({
            data: JSON.parse(JSON.stringify(PAGE)),
            etag: { value: 'etag_page', weak: false },
            ...(lastModified !== undefined ? { lastModified } : {}),
            cacheControl: { directives: ['private', 'no-cache'] },
            notModified: false,
        })),
    };
    const rest = new RestServer(mockServer() as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return { rest, protocol };
}

async function getItem(rest: any, headers: Record<string, string> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('GET /api/v1/meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type: 'page', name: 'home_page' }, query: {}, body: {}, headers }, res);
    return res;
}

const SAVED_AT = '2026-11-07T08:00:00.000Z';

describe('[#31196] the cached `GET /meta/:type/:name` sends the item\'s own `Last-Modified`, or none', () => {
    it('renders the protocol\'s change time, the same on every read of the unchanged item', async () => {
        const { rest, protocol } = setup(SAVED_AT);
        const first = await getItem(rest);
        const second = await getItem(rest);

        expect(protocol.getMetaItemCached).toHaveBeenCalledTimes(2);
        expect(first.statusCode).toBe(200);
        expect(first.headers['Last-Modified']).toBe('Sat, 07 Nov 2026 08:00:00 GMT');
        expect(second.headers['Last-Modified']).toBe(first.headers['Last-Modified']);
        // CONTROL: the validator and the freshness rule.
        expect(first.headers.ETag).toBe('"etag_page"');
        expect(first.headers['Cache-Control']).toBe('private, no-cache');
    });

    it('an item with no known change time answers no `Last-Modified` header — and keeps its ETag', async () => {
        const res = await getItem(setup(undefined).rest);

        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.headers)).not.toContain('Last-Modified');
        expect(res.headers.ETag).toBe('"etag_page"');
        expect(res.headers['Cache-Control']).toBe('private, no-cache');
    });

    it('`If-Modified-Since` never answers a 304, with or without a time to compare', async () => {
        for (const lastModified of [SAVED_AT, undefined]) {
            const res = await getItem(setup(lastModified).rest, { 'if-modified-since': 'Sun, 08 Nov 2026 00:00:00 GMT' });
            expect(res.statusCode).toBe(200);
            expect(res.body.item.name).toBe('home_page');
        }
    });
});
