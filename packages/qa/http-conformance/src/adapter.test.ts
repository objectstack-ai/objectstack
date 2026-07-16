// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NodeHttpServer, compileRoute } from './adapter.js';

describe('compileRoute', () => {
    it('matches literal paths exactly', () => {
        const { regex } = compileRoute('/api/v1/health');
        expect(regex.test('/api/v1/health')).toBe(true);
        expect(regex.test('/api/v1/health/x')).toBe(false);
        expect(regex.test('/api/v1')).toBe(false);
    });

    it('captures :param segments', () => {
        const { regex, keys } = compileRoute('/api/v1/i18n/labels/:object/:locale');
        expect(keys).toEqual(['object', 'locale']);
        const m = regex.exec('/api/v1/i18n/labels/task/zh-CN');
        expect(m?.[1]).toBe('task');
        expect(m?.[2]).toBe('zh-CN');
        expect(regex.test('/api/v1/i18n/labels/task')).toBe(false);
    });

    it('supports the trailing * wildcard across slashes', () => {
        const { regex } = compileRoute('/api/v1/ai/*');
        expect(regex.test('/api/v1/ai/chat')).toBe(true);
        expect(regex.test('/api/v1/ai/agents/a1/run')).toBe(true);
    });

    it('escapes regex metacharacters in literals', () => {
        const { regex } = compileRoute('/.well-known/objectstack');
        expect(regex.test('/.well-known/objectstack')).toBe(true);
        expect(regex.test('/xwell-known/objectstack')).toBe(false);
    });
});

describe('NodeHttpServer (live socket)', () => {
    let server: NodeHttpServer;
    let base: string;

    beforeAll(async () => {
        server = new NodeHttpServer(0);

        server.get('/echo/:id', (req, res) => {
            res.json({ id: req.params.id, q: req.query, path: req.path });
        });
        server.post('/json', (req, res) => { res.status(201); res.json({ got: req.body }); });
        server.post('/raw', async (req, res) => {
            const buf = await req.rawBody!();
            res.json({ bytes: buf.length, firstByte: buf[0] ?? null });
        });
        server.get('/no-content', (req, res) => { res.status(204); (res as any).end(); });
        server.get('/boom', () => { throw Object.assign(new Error('kaboom'), { statusCode: 418 }); });
        server.get('/silent', () => { /* resolves without responding */ });
        server.get('/sse', (req, res) => {
            const r = res as any;
            res.status(200);
            res.header('Content-Type', 'text/event-stream');
            r.write('data: one\n\n');
            r.write('data: two\n\n');
            r.end();
        });

        await server.listen(0);
        base = `http://127.0.0.1:${server.getPort()}`;
    });

    afterAll(async () => { await server.close(); });

    it('routes :param and multi-value query', async () => {
        const res = await fetch(`${base}/echo/42?a=1&b=x&b=y`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe('42');
        expect(body.q).toEqual({ a: '1', b: ['x', 'y'] });
        expect(body.path).toBe('/echo/42');
    });

    it('parses JSON bodies and honors res.status()', async () => {
        const res = await fetch(`${base}/json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        });
        expect(res.status).toBe(201);
        expect((await res.json()).got).toEqual({ hello: 'world' });
    });

    it('leaves binary bodies unparsed but readable via rawBody()', async () => {
        const res = await fetch(`${base}/raw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: new Uint8Array([7, 8, 9]),
        });
        expect(await res.json()).toEqual({ bytes: 3, firstByte: 7 });
    });

    it('supports body-less 204 via res.end()', async () => {
        const res = await fetch(`${base}/no-content`);
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
    });

    it('maps thrown errors with statusCode', async () => {
        const res = await fetch(`${base}/boom`);
        expect(res.status).toBe(418);
        expect((await res.json()).error).toBe('kaboom');
    });

    it('500s when a handler resolves without responding', async () => {
        const res = await fetch(`${base}/silent`);
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('No response from handler');
    });

    it('streams SSE via the res.write/res.end extension', async () => {
        const res = await fetch(`${base}/sse`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        expect(await res.text()).toBe('data: one\n\ndata: two\n\n');
    });

    it('404s unknown paths with the shared not-found body', async () => {
        const res = await fetch(`${base}/nope`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not found' });
    });

    it('405s a method mismatch with an accurate Allow header', async () => {
        const res = await fetch(`${base}/json`, { method: 'GET' });
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe('POST');
        const body = await res.json();
        expect(body.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.allowed).toEqual(['POST']);
    });

    it('answers HEAD from GET routes without a body', async () => {
        const res = await fetch(`${base}/echo/1`, { method: 'HEAD' });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('');
    });

    it('drops prototype-polluting query keys (CodeQL: remote property injection)', async () => {
        const res = await fetch(`${base}/echo/1?__proto__=polluted&constructor=x&a=ok`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.q).toEqual({ a: 'ok' });
        // The global Object prototype must be untouched.
        expect(({} as any).polluted).toBeUndefined();
    });

    it('exposes the Host header natively (no backfill needed)', async () => {
        server.get('/host', (req, res) => { res.json({ host: req.headers.host }); });
        const res = await fetch(`${base}/host`);
        expect((await res.json()).host).toBe(`127.0.0.1:${server.getPort()}`);
    });
});
