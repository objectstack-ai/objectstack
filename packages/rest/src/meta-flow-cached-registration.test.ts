// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #23316 — the DEFAULT `GET /meta/flow/:name` carries the automation engine's
// verdict beside the flow.
//
// `metadata.enableCache` defaults to `true`, so a default deployment answers
// this read from the CACHED branch, which rebuilds the envelope as
// `{ type, name, item }`. The uncached read serves `registration` beside
// `lock`; this branch served the stored row alone, so a flow the engine refused
// at boot read as its stored `status: 'active'` with nothing beside it — the
// defect, at the door every default deployment uses.
//
// The protocol double below answers `getMetaItemCached` the way
// `metadata-protocol`'s producer does: the document under `data`, its ETag, and
// — for a judged flow — the live `registration` its delegate read resolved
// (pinned on the real producer in `protocol.flow-by-name-shipped-name.test.ts`,
// and over the real engine in service-automation's
// `flow-refused-registration-read.integration.test.ts`).

import { describe, it, expect, vi } from 'vitest';
import type { FlowRegistration } from '@objectstack/spec/api';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

const REFUSED: FlowRegistration = {
    state: 'refused',
    reason: { message: "Flow 'typo' rejected: 1 undeclared config key(s)." },
};

/** The stored flow rows the double serves, with the verdict the engine holds for each. */
const STORED: Record<string, { item: Record<string, unknown>; registration?: FlowRegistration }> = {
    'flow/typo': { item: { name: 'typo', label: 'Typo', status: 'active' }, registration: REFUSED },
    'flow/valid': { item: { name: 'valid', label: 'Valid', status: 'active' }, registration: { state: 'registered' } },
    'page/home': { item: { name: 'home', label: 'Home', type: 'app' } },
};

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

function setup() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(),
        findData: vi.fn().mockResolvedValue([]),
        getMetaItemCached: vi.fn(async ({ type, name }: { type: string; name: string }) => {
            const hit = STORED[`${type}/${name}`];
            return {
                data: JSON.parse(JSON.stringify(hit.item)),
                ...(hit.registration ? { registration: hit.registration } : {}),
                etag: { value: `etag_${name}`, weak: false },
                cacheControl: { directives: ['private', 'no-cache'] },
                notModified: false,
            };
        }),
    };
    const rest = new RestServer(mockServer() as any, protocol as any, ANON_API as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    return { rest, protocol };
}

async function getItem(rest: any, type: string, name: string) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('GET /api/v1/meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler({ method: 'GET', params: { type, name }, query: {}, body: {}, headers: {} }, res);
    return res;
}

describe('the default cached `GET /meta/flow/:name` carries the engine\'s verdict (#23316)', () => {
    it('a refused flow: the stored status unchanged, `registration: refused` with its reason beside it', async () => {
        const { rest, protocol } = setup();

        const res = await getItem(rest, 'flow', 'typo');

        // The default branch, measured — not the uncached read.
        expect(protocol.getMetaItemCached).toHaveBeenCalledTimes(1);
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(res.body.item).toEqual({ name: 'typo', label: 'Typo', status: 'active' });
        expect(res.body.registration).toEqual(REFUSED);
        expect(res.body.item).not.toHaveProperty('registration');
    });

    it('control: a registered flow\'s cached read is unchanged, beside `registration: registered`', async () => {
        const res = await getItem(setup().rest, 'flow', 'valid');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            type: 'flow',
            name: 'valid',
            item: { name: 'valid', label: 'Valid', status: 'active' },
            registration: { state: 'registered' },
        });
    });

    it('control: another type\'s cached envelope is exactly what it was', async () => {
        const res = await getItem(setup().rest, 'page', 'home');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ type: 'page', name: 'home', item: { name: 'home', label: 'Home', type: 'app' } });
    });
});
