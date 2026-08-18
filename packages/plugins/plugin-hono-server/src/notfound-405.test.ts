import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';
import { HonoHttpServer } from './adapter';
import type { PluginContext } from '@objectstack/core';

// NB: this file deliberately does NOT mock './adapter' — it exercises the real
// HonoHttpServer + the plugin's notFound wiring end-to-end through app.fetch().

function makeCtx() {
    const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return {
        logger,
        getKernel: vi.fn().mockReturnValue({ plugins: new Map() }),
        registerService: vi.fn(),
        hook: vi.fn(),
        getService: vi.fn(),
    } as unknown as PluginContext;
}

describe('HonoHttpServer.allowedMethodsForPath', () => {
    let server: HonoHttpServer;
    const noop = () => {};

    beforeEach(() => {
        server = new HonoHttpServer(0);
        server.get('/api/v1/meta/:type/:name', noop);
        server.put('/api/v1/meta/:type/:name', noop);
        server.delete('/api/v1/meta/:type/:name', noop);
        server.post('/api/v1/meta/:type/:name/publish', noop);
    });

    it('collects every method registered for a concrete path (HEAD implied by GET)', () => {
        expect(server.allowedMethodsForPath('/api/v1/meta/view/my_view'))
            .toEqual(['DELETE', 'GET', 'HEAD', 'PUT']);
    });

    it('does not leak sub-route methods onto the parent path', () => {
        // /publish is POST-only and one segment deeper — must not appear here
        expect(server.allowedMethodsForPath('/api/v1/meta/view/my_view'))
            .not.toContain('POST');
        expect(server.allowedMethodsForPath('/api/v1/meta/view/my_view/publish'))
            .toEqual(['POST']);
    });

    it('returns an empty list for a path that matches no route', () => {
        expect(server.allowedMethodsForPath('/api/v1/nope')).toEqual([]);
    });
});

describe('notFound → 405 Method Not Allowed (#2684)', () => {
    let plugin: HonoServerPlugin;
    let server: HonoHttpServer;

    beforeEach(async () => {
        const ctx = makeCtx();
        plugin = new HonoServerPlugin({ cors: false });
        await plugin.init(ctx);
        await plugin.start(ctx);
        server = (plugin as any).server as HonoHttpServer;
        // Register the metadata save surface the same way rest-server does.
        server.get('/api/v1/meta/:type/:name', (_req: any, res: any) => res.json({ ok: 'get' }));
        server.put('/api/v1/meta/:type/:name', (_req: any, res: any) => res.json({ ok: 'put' }));
        server.delete('/api/v1/meta/:type/:name', (_req: any, res: any) => res.json({ ok: 'delete' }));
    });

    const fetch = (method: string, path: string) =>
        server.getRawApp().fetch(new Request(`http://localhost${path}`, { method }));

    it('answers a POST to a PUT-only path with 405 + Allow header', async () => {
        const res = await fetch('POST', '/api/v1/meta/view/my_view');
        expect(res.status).toBe(405);
        const allow = (res.headers.get('Allow') || '').split(',').map((s) => s.trim());
        expect(allow).toEqual(expect.arrayContaining(['GET', 'PUT', 'DELETE']));
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.error.details.allowed).toEqual(expect.arrayContaining(['PUT']));
        expect(body.error.details.method).toBe('POST');
        expect(body.error.details.path).toBe('/api/v1/meta/view/my_view');
    });

    it('still routes the correct method to its handler (no false 405)', async () => {
        const res = await fetch('PUT', '/api/v1/meta/view/my_view');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: 'put' });
    });

    it('keeps a genuine 404 for a path that matches no registered route', async () => {
        const res = await fetch('POST', '/api/v1/does/not/exist');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
            success: false,
            error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
        });
    });
});
