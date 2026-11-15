// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The request-body limit (`./body-limit.ts`): where an operator sets it, how a
 * bad value is refused, and the rule over a REAL listener, where the body is a
 * socket stream and `Content-Length` frames it. The two-door table (the
 * hosted `createHonoApp` door beside this one) lives in
 * `packages/adapters/hono/src/hono-body-refusal.test.ts`.
 */

import { connect } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { HonoHttpServer } from './adapter';
import { HonoServerPlugin } from './hono-plugin';
import {
    DEFAULT_MAX_REQUEST_BODY_BYTES,
    MAX_REQUEST_BODY_BYTES_ENV,
    resolveMaxRequestBodyBytes,
} from './body-limit';

describe('the request-body limit is 10 MiB unless an operator sets another', () => {
    it('the default is 10 MiB', () => {
        expect(DEFAULT_MAX_REQUEST_BODY_BYTES).toBe(10 * 1024 * 1024);
        expect(resolveMaxRequestBodyBytes(undefined, {})).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
        expect(resolveMaxRequestBodyBytes(undefined, { [MAX_REQUEST_BODY_BYTES_ENV]: '  ' })).toBe(DEFAULT_MAX_REQUEST_BODY_BYTES);
    });

    it('the environment variable sets it, and the transport option wins over it', () => {
        expect(MAX_REQUEST_BODY_BYTES_ENV).toBe('OS_HTTP_MAX_BODY_BYTES');
        expect(resolveMaxRequestBodyBytes(undefined, { OS_HTTP_MAX_BODY_BYTES: '2048' })).toBe(2048);
        expect(resolveMaxRequestBodyBytes(4096, { OS_HTTP_MAX_BODY_BYTES: '2048' })).toBe(4096);
    });

    it.each([
        ['zero', 0],
        ['a negative number', -1],
        ['a fraction', 1.5],
        ['not a number', Number.NaN],
        ['infinity', Number.POSITIVE_INFINITY],
    ])('a transport option that is %s is refused where it is set', (_label, value) => {
        expect(() => resolveMaxRequestBodyBytes(value, {})).toThrow(TypeError);
        expect(() => new HonoHttpServer(0).setMaxRequestBodyBytes(value)).toThrow(/maxRequestBodyBytes must be a positive whole number of bytes/);
        expect(() => new HonoServerPlugin({ maxRequestBodyBytes: value })).toThrow(TypeError);
    });

    it.each([['10MB'], ['0'], ['-5'], ['1.5'], ['1e6']])('an environment value of %j is refused, naming the variable', (raw) => {
        expect(() => resolveMaxRequestBodyBytes(undefined, { OS_HTTP_MAX_BODY_BYTES: raw })).toThrow(/OS_HTTP_MAX_BODY_BYTES must be a positive whole number of bytes/);
    });

    it('the plugin option reaches the server it builds, and the setter replaces the limit', () => {
        const plugin = new HonoServerPlugin({ maxRequestBodyBytes: 1234 });
        const server = (plugin as unknown as { server: HonoHttpServer }).server;
        expect(server.getMaxRequestBodyBytes()).toBe(1234);
        server.setMaxRequestBodyBytes(99);
        expect(server.getMaxRequestBodyBytes()).toBe(99);
    });
});

describe('over a real listener, a body over the limit is refused unread and a byte door still receives its bytes', () => {
    const LIMIT = 1024;
    let server: HonoHttpServer | undefined;

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    async function start() {
        server = new HonoHttpServer(0);
        server.setMaxRequestBodyBytes(LIMIT);
        server.post('/api/v1/data/:object/query', (req, res) => { res.json({ success: true, data: req.body }); });
        server.put('/api/v1/bytes/:id', async (req, res) => {
            const bytes = await req.rawBody!();
            res.json({ success: true, data: { size: bytes.byteLength } });
        });
        // A door with its own bound beyond the request-body limit: it is refused
        // `req.body` for size, and takes the read over through `rawBody()`.
        server.put('/api/v1/forms/:id', async (req, res) => {
            try {
                res.json({ success: true, data: { parsed: Object.keys(req.body ?? {}).length } });
            } catch (err) {
                if ((err as { code?: unknown }).code !== 'PAYLOAD_TOO_LARGE') throw err;
                const bytes = await req.rawBody!();
                res.json({ success: true, data: { size: bytes.byteLength } });
            }
        });
        await server.listen(0);
        return server.getPort();
    }

    it('a declared length over the limit is answered 413 before the client has sent the body', async () => {
        const port = await start();
        // Only the head is written: the answer arriving at all proves the
        // server did not wait for (or read) the declared bytes.
        const answer = await new Promise<string>((resolve, reject) => {
            const socket = connect(port, '127.0.0.1');
            let text = '';
            socket.on('data', (chunk) => {
                text += chunk.toString('utf8');
                if (text.includes('PAYLOAD_TOO_LARGE')) {
                    socket.destroy();
                    resolve(text);
                }
            });
            socket.on('error', reject);
            socket.write(
                'POST /api/v1/data/task/query HTTP/1.1\r\nHost: 127.0.0.1\r\n'
                + `Content-Type: application/json\r\nContent-Length: ${LIMIT * 1024}\r\n\r\n`,
            );
        });
        expect(answer).toMatch(/^HTTP\/1\.1 413 /);
        expect(answer).toContain('"code":"PAYLOAD_TOO_LARGE"');
    });

    it('a body with no declared length is answered 413 past the limit', async () => {
        const port = await start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/data/task/query`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(`{"a":"${'x'.repeat(LIMIT * 4)}"}`));
                    controller.close();
                },
            }),
            duplex: 'half',
        } as RequestInit);
        expect(res.status).toBe(413);
        expect(((await res.json()) as any).error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it.each([['application/octet-stream'], ['application/json']])('a byte door receives a %s body over the transport limit whole', async (contentType) => {
        const port = await start();
        const body = new Uint8Array(LIMIT * 8).fill(0x61);
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/bytes/f_1`, { method: 'PUT', headers: { 'content-type': contentType }, body });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(((await res.json()) as any).data.size).toBe(LIMIT * 8);
    });

    it.each([['declared', true], ['not declared', false]])(
        'a door refused req.body for size takes the read over through rawBody() and its own answer stands, length %s',
        async (_label, declare) => {
            const port = await start();
            const form = new FormData();
            form.append('file0', new Blob([new Uint8Array(LIMIT * 8).fill(0x62)]), 'f.bin');
            const encoded = new Response(form);
            const bytes = new Uint8Array(await encoded.arrayBuffer());
            const res = await fetch(`http://127.0.0.1:${port}/api/v1/forms/f_1`, {
                method: 'PUT',
                headers: { 'content-type': encoded.headers.get('content-type')! },
                body: declare
                    ? bytes
                    : new ReadableStream({
                        start(controller) {
                            controller.enqueue(bytes);
                            controller.close();
                        },
                    }),
                duplex: 'half',
            } as RequestInit);
            expect(res.status, await res.clone().text()).toBe(200);
            expect(((await res.json()) as any).data.size).toBe(bytes.byteLength);
        },
    );

    it('CONTROL: a JSON body within the limit is read as before', async () => {
        const port = await start();
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/data/task/query`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"where":{"status":"open"}}',
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { where: { status: 'open' } } });
    });
});

describe('a body refused past the limit releases its source, and a byte door reads the same bytes twice', () => {
    const LIMIT = 1024;
    const CHUNK = 256;

    /** An endless body that records what was pulled from it and whether it was cancelled. */
    function endlessBody() {
        const state = { pulled: 0, cancelled: false };
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                state.pulled += CHUNK;
                controller.enqueue(new TextEncoder().encode('x'.repeat(CHUNK)));
            },
            cancel() {
                state.cancelled = true;
            },
        }, { highWaterMark: 0 });
        return { stream, state };
    }

    function serverWithRoutes() {
        const server = new HonoHttpServer(0);
        server.setMaxRequestBodyBytes(LIMIT);
        server.post('/api/v1/data/:object/query', (req, res) => { res.json({ success: true, data: req.body }); });
        server.put('/api/v1/bytes/:id', async (req, res) => {
            const first = await req.rawBody!();
            const second = await req.rawBody!();
            res.json({ success: true, data: { first: first.byteLength, second: second.byteLength, same: first.equals(second) } });
        });
        return server;
    }

    it.each([['application/json'], ['application/x-www-form-urlencoded']])(
        'a %s body with no declared length is answered 413 and its source is cancelled after the refusal',
        async (contentType) => {
            const { stream, state } = endlessBody();
            const res = await serverWithRoutes().getRawApp().request('http://localhost/api/v1/data/task/query', {
                method: 'POST',
                headers: { 'content-type': contentType },
                body: stream,
                duplex: 'half',
            } as RequestInit);
            expect(res.status).toBe(413);
            expect(((await res.json()) as any).error.code).toBe('PAYLOAD_TOO_LARGE');
            expect(state.cancelled).toBe(true);
            expect(state.pulled).toBeLessThanOrEqual(LIMIT + 2 * CHUNK);
        },
    );

    it.each([['declared', true], ['not declared', false]])(
        'rawBody() called twice answers the same bytes both times, length %s',
        async (_label, declare) => {
            const bytes = new Uint8Array(LIMIT * 4).fill(0x63);
            const res = await serverWithRoutes().getRawApp().request('http://localhost/api/v1/bytes/f_1', {
                method: 'PUT',
                headers: { 'content-type': 'application/json', ...(declare ? { 'content-length': String(bytes.byteLength) } : {}) },
                body: declare
                    ? bytes
                    : new ReadableStream({
                        start(controller) {
                            controller.enqueue(bytes);
                            controller.close();
                        },
                    }),
                duplex: 'half',
            } as RequestInit);
            expect(res.status, await res.clone().text()).toBe(200);
            expect(((await res.json()) as any).data).toEqual({ first: bytes.byteLength, second: bytes.byteLength, same: true });
        },
    );
});

describe('a byte door\'s own bound holds a body whether or not it declares a length', () => {
    const LIMIT = 1024;
    const BOUND = LIMIT * 4;
    const CHUNK = 256;

    /** A body of `total` bytes (endless when undefined) that records what was pulled from it and whether it was cancelled. */
    function countedBody(total?: number) {
        const state = { pulled: 0, cancelled: false };
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (total !== undefined && state.pulled >= total) {
                    controller.close();
                    return;
                }
                const size = total === undefined ? CHUNK : Math.min(CHUNK, total - state.pulled);
                state.pulled += size;
                controller.enqueue(new Uint8Array(size).fill(0x64));
            },
            cancel() {
                state.cancelled = true;
            },
        }, { highWaterMark: 0 });
        return { stream, state };
    }

    /** Routes that read through `rawBody({ maxBytes: BOUND })`: one answers its own refusal, one lets it escape. */
    function serverWithDoors() {
        const server = new HonoHttpServer(0);
        server.setMaxRequestBodyBytes(LIMIT);
        server.put('/api/v1/door/:id', async (req, res) => {
            try {
                const bytes = await req.rawBody!({ maxBytes: BOUND });
                res.json({ success: true, data: { size: bytes.byteLength } });
            } catch (err) {
                const e = err as { status?: unknown; code?: unknown };
                res.status(413).json({ success: false, error: { code: e.code, message: `door refused at ${e.status}` } });
            }
        });
        server.put('/api/v1/escape/:id', async (req, res) => {
            const bytes = await req.rawBody!({ maxBytes: BOUND });
            res.json({ success: true, data: { size: bytes.byteLength } });
        });
        // A form door: refused `req.body` for size, it takes the read over under its own bound.
        server.put('/api/v1/form/:id', async (req, res) => {
            try {
                res.json({ success: true, data: { parsed: Object.keys(req.body ?? {}).length } });
            } catch (err) {
                if ((err as { code?: unknown }).code !== 'PAYLOAD_TOO_LARGE') throw err;
                const bytes = await req.rawBody!({ maxBytes: BOUND });
                res.json({ success: true, data: { size: bytes.byteLength } });
            }
        });
        return server;
    }

    function send(path: string, body: ReadableStream<Uint8Array> | Uint8Array, headers: Record<string, string> = {}) {
        return serverWithDoors().getRawApp().request(`http://localhost${path}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream', ...headers },
            body,
            duplex: 'half',
        } as RequestInit);
    }

    it.each([['application/octet-stream'], ['application/json']])(
        'a %s body with no declared length is refused past the bound, read no further, its source cancelled',
        async (contentType) => {
            const { stream, state } = countedBody();
            const res = await send('/api/v1/door/f_1', stream, { 'content-type': contentType });
            expect(res.status).toBe(413);
            expect(((await res.json()) as any).error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'door refused at 413' });
            expect(state.cancelled).toBe(true);
            expect(state.pulled).toBeLessThanOrEqual(BOUND + 2 * CHUNK);
        },
    );

    it('a form refused req.body for size and taken over is held to the door\'s bound, its source cancelled', async () => {
        const { stream, state } = countedBody();
        const res = await send('/api/v1/form/f_1', stream, { 'content-type': 'multipart/form-data; boundary=x' });
        expect(res.status).toBe(413);
        expect(((await res.json()) as any).error.message).toContain(`(${BOUND} bytes)`);
        expect(state.cancelled).toBe(true);
        expect(state.pulled).toBeLessThanOrEqual(BOUND + 2 * CHUNK);
    });

    it('a declared length over the bound is refused without reading the body', async () => {
        const { stream, state } = countedBody(BOUND + 1);
        const res = await send('/api/v1/door/f_1', stream, { 'content-length': String(BOUND + 1) });
        expect(res.status).toBe(413);
        expect(((await res.json()) as any).error.code).toBe('PAYLOAD_TOO_LARGE');
        expect(state.pulled).toBe(0);
    });

    it('a refusal the door lets escape is answered 413 PAYLOAD_TOO_LARGE, naming the door\'s bound', async () => {
        const { stream } = countedBody();
        const res = await send('/api/v1/escape/f_1', stream);
        expect(res.status).toBe(413);
        const body = (await res.json()) as any;
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
        expect(body.error.message).toContain(`(${BOUND} bytes)`);
    });

    it.each([['declared', true], ['not declared', false]])(
        'CONTROL: exactly the bound is read whole, length %s',
        async (_label, declare) => {
            const { stream } = countedBody(BOUND);
            const res = await send('/api/v1/door/f_1', stream, declare ? { 'content-length': String(BOUND) } : {});
            expect(res.status, await res.clone().text()).toBe(200);
            expect(((await res.json()) as any).data.size).toBe(BOUND);
        },
    );

    it('CONTROL: a JSON body within the transport limit, read through req.body first, is judged against the bound once read', async () => {
        const server = new HonoHttpServer(0);
        server.setMaxRequestBodyBytes(LIMIT);
        server.put('/api/v1/both/:id', async (req, res) => {
            void req.body;
            try {
                await req.rawBody!({ maxBytes: 8 });
                res.json({ success: true });
            } catch (err) {
                res.status(413).json({ success: false, error: { code: (err as { code?: unknown }).code } });
            }
        });
        const res = await server.getRawApp().request('http://localhost/api/v1/both/f_1', {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"a":"0123456789"}',
        });
        expect(res.status).toBe(413);
        expect(((await res.json()) as any).error.code).toBe('PAYLOAD_TOO_LARGE');
    });
});
