// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression coverage for the `requireAuth` gate on the dispatcher's service
// route families (AI + metadata catch-all). These routes declare `auth: true`
// but nothing enforced it before — an anonymous caller reached e.g.
// `GET /api/v1/ai/status` (and the metadata reader) on a tenant-less host and
// got adapter/model/schema data back. The gate mirrors the REST `enforceAuth`
// seam: on a `requireAuth` deployment, anonymous callers get 401 while an
// authenticated (or internal system) context passes.

import { describe, it, expect } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

const aiRoute = {
    method: 'GET',
    path: '/api/v1/ai/status',
    auth: true,
    handler: async () => ({ status: 200, body: { adapter: 'test' } }),
};

const makeKernel = (extra: Record<string, unknown> = {}) =>
    ({
        context: {
            getService: (name: string) => (name === 'ai' ? { adapterName: 'test' } : null),
        },
        __aiRoutes: [aiRoute],
        ...extra,
    }) as any;

const anon = { request: {}, executionContext: undefined } as any;
const authed = { request: {}, executionContext: { userId: 'u1' } } as any;
const system = { request: {}, executionContext: { isSystem: true } } as any;

describe('HttpDispatcher requireAuth gate — AI routes (handleAI)', () => {
    it('401s an anonymous caller when requireAuth is on', async () => {
        const d = new HttpDispatcher(makeKernel(), undefined, { requireAuth: true });
        const r = await d.handleAI('/ai/status', 'GET', undefined, undefined, anon);
        expect(r.response?.status).toBe(401);
        expect(r.response?.body?.error?.details?.code ?? r.response?.body?.error?.code).toBeDefined();
    });

    it('lets an authenticated caller through', async () => {
        const d = new HttpDispatcher(makeKernel(), undefined, { requireAuth: true });
        const r = await d.handleAI('/ai/status', 'GET', undefined, undefined, authed);
        expect(r.response?.status).toBe(200);
        expect(r.response?.body?.adapter).toBe('test');
    });

    it('lets an internal system context through', async () => {
        const d = new HttpDispatcher(makeKernel(), undefined, { requireAuth: true });
        const r = await d.handleAI('/ai/status', 'GET', undefined, undefined, system);
        expect(r.response?.status).toBe(200);
    });

    it('serves anonymously when requireAuth is off (unchanged legacy behaviour)', async () => {
        const d = new HttpDispatcher(makeKernel(), undefined, { requireAuth: false });
        const r = await d.handleAI('/ai/status', 'GET', undefined, undefined, anon);
        expect(r.response?.status).toBe(200);
    });

    it('does not gate a route that opts out with auth:false', async () => {
        const openRoute = { ...aiRoute, path: '/api/v1/ai/public', auth: false };
        const d = new HttpDispatcher(makeKernel({ __aiRoutes: [openRoute] }), undefined, { requireAuth: true });
        const r = await d.handleAI('/ai/public', 'GET', undefined, undefined, anon);
        expect(r.response?.status).toBe(200);
    });
});



describe('HttpDispatcher requireAuth gate — metadata catch-all (handleMetadata)', () => {
    it('401s an anonymous caller when requireAuth is on', async () => {
        const d = new HttpDispatcher(makeKernel(), undefined, { requireAuth: true });
        const r = await d.handleMetadata('/object', anon, 'GET');
        expect(r.response?.status).toBe(401);
    });

    it('does not 401 an authenticated caller (proceeds past the gate)', async () => {
        const d = new HttpDispatcher(makeKernel(), undefined, { requireAuth: true });
        const r = await d.handleMetadata('/object', authed, 'GET');
        expect(r.response?.status).not.toBe(401);
    });

    it('does not 401 when requireAuth is off', async () => {
        const d = new HttpDispatcher(makeKernel(), undefined, { requireAuth: false });
        const r = await d.handleMetadata('/object', anon, 'GET');
        expect(r.response?.status).not.toBe(401);
    });
});
