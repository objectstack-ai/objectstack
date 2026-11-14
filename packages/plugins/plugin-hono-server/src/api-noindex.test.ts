// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `/api/` answer carries `X-Robots-Tag: noindex, nofollow`
 * (`./api-noindex.ts`), on the real `HonoHttpServer` with its not-found seam
 * installed, through `app.fetch()`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HonoHttpServer } from './adapter';
import { API_ROBOTS_TAG, isApiPath } from './api-noindex';

const ORIGIN = 'http://runtime.example.test';

describe('X-Robots-Tag on the API surface', () => {
    let server: HonoHttpServer;
    const fetchPath = (p: string, init?: RequestInit) =>
        server.getRawApp().fetch(new Request(`${ORIGIN}${p}`, init));

    beforeEach(() => {
        server = new HonoHttpServer(0);
        server.installNotFoundSeam();
        // A route registered through the IHttpServer contract (the dispatcher's way).
        server.get('/api/v1/runtime/config', (_req: any, res: any) => {
            res.json({ branding: { productName: 'Acme' } });
        });
        server.get('/api/v1/boom', () => {
            throw new Error('handler exploded');
        });
        const raw = server.getRawApp();
        // A raw-app mount (plugin-auth's way).
        raw.get('/api/v1/auth/get-session', (c: any) => c.json(null));
        // A route that decided for itself.
        raw.get('/api/v1/storage/upload-links/:token', (c: any) =>
            c.html('<p>upload</p>', 200, { 'X-Robots-Tag': 'noindex' }));
        // Outside the API namespace.
        raw.get('/forms/:slug', (c: any) => c.text('public form'));
        raw.get('/apis-overview', (c: any) => c.text('not the api'));
    });

    it('marks a contract-registered API route', async () => {
        const res = await fetchPath('/api/v1/runtime/config');
        expect(res.status).toBe(200);
        expect(res.headers.get('x-robots-tag')).toBe(API_ROBOTS_TAG);
        expect(API_ROBOTS_TAG).toBe('noindex, nofollow');
    });

    it('marks a raw-app auth route', async () => {
        const res = await fetchPath('/api/v1/auth/get-session');
        expect(res.status).toBe(200);
        expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('marks the unmatched-request 404 and a thrown error under /api', async () => {
        const missing = await fetchPath('/api/v1/auth');
        expect(missing.status).toBe(404);
        expect(missing.headers.get('x-robots-tag')).toBe('noindex, nofollow');

        const thrown = await fetchPath('/api/v1/boom');
        expect(thrown.status).toBe(500);
        expect(thrown.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('marks HEAD and POST answers too', async () => {
        const head = await fetchPath('/api/v1/runtime/config', { method: 'HEAD' });
        expect(head.headers.get('x-robots-tag')).toBe('noindex, nofollow');
        const post = await fetchPath('/api/v1/runtime/config', { method: 'POST' });
        expect(post.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('keeps the directive a route set for itself', async () => {
        const res = await fetchPath('/api/v1/storage/upload-links/t0k3n');
        expect(res.headers.get('x-robots-tag')).toBe('noindex');
    });

    it('leaves paths outside /api alone, including look-alike prefixes', async () => {
        const form = await fetchPath('/forms/contact-us');
        expect(form.status).toBe(200);
        expect(form.headers.has('x-robots-tag')).toBe(false);

        const lookAlike = await fetchPath('/apis-overview');
        expect(lookAlike.headers.has('x-robots-tag')).toBe(false);

        const unrouted = await fetchPath('/get-session');
        expect(unrouted.status).toBe(404);
        expect(unrouted.headers.has('x-robots-tag')).toBe(false);
    });

    it('isApiPath matches the namespace and nothing that merely starts with its letters', () => {
        expect(isApiPath('/api')).toBe(true);
        expect(isApiPath('/api/')).toBe(true);
        expect(isApiPath('/api/v1/data/account')).toBe(true);
        expect(isApiPath('/apis')).toBe(false);
        expect(isApiPath('/_console/api/x')).toBe(false);
        expect(isApiPath('/')).toBe(false);
    });
});
