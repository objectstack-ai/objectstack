// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response compression on `HonoHttpServer` (`./response-compression.ts`).
 *
 * Every case speaks raw HTTP through `node:http`, never `fetch`: `fetch` decodes
 * a compressed body without saying so, so a test reading through it cannot tell
 * an encoded answer from a plain one.
 */

import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { serveStatic } from '@hono/node-server/serve-static';
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { HonoHttpServer } from './adapter';
import { RESPONSE_COMPRESSION_THRESHOLD_BYTES, selectResponseEncoding } from './response-compression';

interface RawAnswer {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
}

/** One request; the body exactly as the socket delivered it. */
function get(
    port: number,
    path: string,
    headers: Record<string, string> = {},
    method = 'GET',
): Promise<RawAnswer> {
    return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A JSON payload comfortably above the threshold. */
const LARGE = { rows: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `record-${i}`, note: 'compressible text' })) };
const LARGE_TEXT = JSON.stringify(LARGE);
const ASSET_JS = `export const bundle = ${JSON.stringify('x'.repeat(8000))};\n`.repeat(4);

describe('HonoHttpServer response compression', () => {
    const opened: HonoHttpServer[] = [];
    let assetRoot: string;

    beforeAll(() => {
        assetRoot = mkdtempSync(join(tmpdir(), 'os-compress-'));
        writeFileSync(join(assetRoot, 'vendor.js'), ASSET_JS);
    });
    afterAll(() => rmSync(assetRoot, { recursive: true, force: true }));

    const boot = async (setup: (server: HonoHttpServer) => void) => {
        const server = new HonoHttpServer(0);
        setup(server);
        server.installNotFoundSeam();
        await server.listen(0);
        opened.push(server);
        return server.getPort();
    };

    afterEach(async () => {
        while (opened.length > 0) await opened.pop()!.close();
    });

    it('gzips a large JSON answer for a client that accepts gzip, and sends the same answer plain to one that does not', async () => {
        const port = await boot((s) => s.get('/api/v1/big', (_req, res) => res.json(LARGE)));

        const encoded = await get(port, '/api/v1/big', { 'accept-encoding': 'gzip' });
        expect(encoded.status).toBe(200);
        expect(encoded.headers['content-encoding']).toBe('gzip');
        expect(encoded.headers['vary']).toMatch(/accept-encoding/i);
        expect(encoded.body.byteLength).toBeLessThan(LARGE_TEXT.length / 4);
        expect(JSON.parse(gunzipSync(encoded.body).toString('utf8'))).toEqual(LARGE);

        const plain = await get(port, '/api/v1/big');
        expect(plain.headers['content-encoding']).toBeUndefined();
        expect(plain.headers['vary']).toMatch(/accept-encoding/i);
        expect(JSON.parse(plain.body.toString('utf8'))).toEqual(LARGE);
    });

    it('prefers brotli when both are accepted, and honours q=0', async () => {
        const port = await boot((s) => s.get('/api/v1/big', (_req, res) => res.json(LARGE)));

        const br = await get(port, '/api/v1/big', { 'accept-encoding': 'gzip, deflate, br' });
        expect(br.headers['content-encoding']).toBe('br');
        expect(JSON.parse(brotliDecompressSync(br.body).toString('utf8'))).toEqual(LARGE);

        const noBr = await get(port, '/api/v1/big', { 'accept-encoding': 'br;q=0, gzip' });
        expect(noBr.headers['content-encoding']).toBe('gzip');

        const none = await get(port, '/api/v1/big', { 'accept-encoding': 'deflate' });
        expect(none.headers['content-encoding']).toBeUndefined();
        expect(JSON.parse(none.body.toString('utf8'))).toEqual(LARGE);
    });

    it('sends a JSON answer below the threshold as it is', async () => {
        const small = { ok: true, note: 'small' };
        expect(JSON.stringify(small).length).toBeLessThan(RESPONSE_COMPRESSION_THRESHOLD_BYTES);
        const port = await boot((s) => s.get('/api/v1/small', (_req, res) => res.json(small)));

        const answer = await get(port, '/api/v1/small', { 'accept-encoding': 'gzip, br' });
        expect(answer.headers['content-encoding']).toBeUndefined();
        expect(JSON.parse(answer.body.toString('utf8'))).toEqual(small);
    });

    it('encodes a static JS asset served by serveStatic, and leaves a Range request on it to the identity bytes', async () => {
        const port = await boot((s) => s.getRawApp().get('/assets/*', serveStatic({
            root: assetRoot,
            rewriteRequestPath: (p) => p.replace(/^\/assets/, ''),
        })));

        const encoded = await get(port, '/assets/vendor.js', { 'accept-encoding': 'gzip, br' });
        expect(encoded.status).toBe(200);
        expect(encoded.headers['content-encoding']).toBe('br');
        expect(encoded.headers['content-length']).toBeUndefined();
        expect(brotliDecompressSync(encoded.body).toString('utf8')).toBe(ASSET_JS);

        const ranged = await get(port, '/assets/vendor.js', { 'accept-encoding': 'gzip, br', range: 'bytes=0-9' });
        expect(ranged.status).toBe(206);
        expect(ranged.headers['content-encoding']).toBeUndefined();
        expect(ranged.headers['content-range']).toBe(`bytes 0-9/${Buffer.byteLength(ASSET_JS)}`);
        expect(ranged.body.toString('utf8')).toBe(ASSET_JS.slice(0, 10));
    });

    it('encodes a raw-route Buffer answer with no Content-Length (the Console asset shape) and keeps its ETag byte-identical', async () => {
        // Strong ETag on purpose: the metadata and record doors compare an
        // `If-Match` token against it strongly, so it must not turn into `W/`.
        const etag = '"abc123"';
        const port = await boot((s) => s.getRawApp().get('/_console/assets/index.js', () => new Response(Buffer.from(ASSET_JS), {
            headers: { 'content-type': 'text/javascript; charset=utf-8', etag, 'cache-control': 'public, max-age=31536000, immutable' },
        })));

        const answer = await get(port, '/_console/assets/index.js', { 'accept-encoding': 'gzip' });
        expect(answer.headers['content-encoding']).toBe('gzip');
        expect(answer.headers['etag']).toBe(etag);
        expect(answer.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(gunzipSync(answer.body).toString('utf8')).toBe(ASSET_JS);
    });

    it('leaves an SSE answer written through res.write() unencoded and unbuffered', async () => {
        let finish: (() => void) | undefined;
        const port = await boot((s) => s.get('/api/v1/events', (_req, res) => {
            res.header('Content-Type', 'text/event-stream');
            res.write(`data: ${'first-event '.repeat(200)}\n\n`);
            finish = () => { res.write('data: last\n\n'); res.end(); };
        }));

        const firstChunk = await new Promise<{ headers: Record<string, unknown>; chunk: string; rest: Promise<string> }>((resolve, reject) => {
            const req = request({ host: '127.0.0.1', port, path: '/api/v1/events', headers: { 'accept-encoding': 'gzip, br' } }, (res) => {
                let all = '';
                const rest = new Promise<string>((done) => res.on('end', () => done(all)));
                res.once('data', (c: Buffer) => resolve({ headers: res.headers, chunk: c.toString('utf8'), rest }));
                res.on('data', (c: Buffer) => { all += c.toString('utf8'); });
            });
            req.on('error', reject);
            req.end();
        });
        // The first event arrived while the stream is still open: nothing held it back.
        expect(firstChunk.chunk.startsWith('data: first-event')).toBe(true);
        expect(firstChunk.headers['content-encoding']).toBeUndefined();
        finish!();
        expect(await firstChunk.rest).toContain('data: last');
    });

    it('leaves a text/plain stream written through res.write() (the AI data stream shape) unencoded', async () => {
        const port = await boot((s) => s.get('/api/v1/ai/chat', async (_req, res) => {
            res.header('Content-Type', 'text/plain; charset=utf-8');
            res.write('0:"'.concat('token '.repeat(400), '"\n'));
            await sleep(20);
            res.write('0:"done"\n');
            res.end();
        }));

        const answer = await get(port, '/api/v1/ai/chat', { 'accept-encoding': 'gzip, br' });
        expect(answer.headers['content-encoding']).toBeUndefined();
        expect(answer.body.toString('utf8')).toContain('0:"done"');
    });

    it('never encodes an answer that already carries a Content-Encoding', async () => {
        const pre = gzipSync(Buffer.from(LARGE_TEXT));
        const port = await boot((s) => s.getRawApp().get('/pre', () => new Response(pre, {
            headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        })));

        const answer = await get(port, '/pre', { 'accept-encoding': 'gzip, br' });
        expect(answer.headers['content-encoding']).toBe('gzip');
        expect(JSON.parse(gunzipSync(answer.body).toString('utf8'))).toEqual(LARGE);
    });

    it('respects Cache-Control: no-transform and leaves non-compressible types alone', async () => {
        const port = await boot((s) => {
            const raw = s.getRawApp();
            raw.get('/no-transform', (c) => c.body(LARGE_TEXT, 200, { 'content-type': 'application/json', 'cache-control': 'no-transform' }));
            raw.get('/image', (c) => c.body(Buffer.alloc(4096, 1), 200, { 'content-type': 'image/png' }));
        });

        const noTransform = await get(port, '/no-transform', { 'accept-encoding': 'gzip' });
        expect(noTransform.headers['content-encoding']).toBeUndefined();
        expect(noTransform.body.toString('utf8')).toBe(LARGE_TEXT);

        const image = await get(port, '/image', { 'accept-encoding': 'gzip' });
        expect(image.headers['content-encoding']).toBeUndefined();
        expect(image.headers['vary']).toBeUndefined();
        expect(image.body.byteLength).toBe(4096);
    });

    it('does not encode a HEAD answer', async () => {
        const port = await boot((s) => s.getRawApp().get('/assets/*', serveStatic({
            root: assetRoot,
            rewriteRequestPath: (p) => p.replace(/^\/assets/, ''),
        })));

        const head = await get(port, '/assets/vendor.js', { 'accept-encoding': 'gzip' }, 'HEAD');
        expect(head.status).toBe(200);
        expect(head.headers['content-encoding']).toBeUndefined();
        expect(head.headers['content-length']).toBe(String(Buffer.byteLength(ASSET_JS)));
    });

    it('keeps every Set-Cookie line of an encoded answer', async () => {
        const port = await boot((s) => s.get('/api/v1/cookies', (_req, res) => {
            res.header('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
            res.json(LARGE);
        }));

        const answer = await get(port, '/api/v1/cookies', { 'accept-encoding': 'gzip' });
        expect(answer.headers['content-encoding']).toBe('gzip');
        expect(answer.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    });

    it('lets an encoded answer still flushing when close() begins finish', async () => {
        const port = await boot((s) => s.getRawApp().get('/slow-big', (c) => c.body(new ReadableStream<Uint8Array>({
            async start(controller) {
                controller.enqueue(new TextEncoder().encode(LARGE_TEXT.slice(0, 2000)));
                await sleep(200); // still streaming when close() is called
                controller.enqueue(new TextEncoder().encode(LARGE_TEXT.slice(2000)));
                controller.close();
            },
        }), 200, { 'content-type': 'application/json' })));
        const server = opened[opened.length - 1];

        const answerP = get(port, '/slow-big', { 'accept-encoding': 'gzip' });
        await sleep(50);
        const closeP = server.close();
        opened.pop();

        const answer = await answerP;
        expect(answer.headers['content-encoding']).toBe('gzip');
        expect(gunzipSync(answer.body).toString('utf8')).toBe(LARGE_TEXT);
        await closeP;
    });
});

describe('selectResponseEncoding', () => {
    it.each([
        [undefined, undefined],
        ['', undefined],
        ['gzip', 'gzip'],
        ['br', 'br'],
        ['gzip, br', 'br'],
        ['gzip;q=1, br;q=0.5', 'gzip'],
        ['br;q=0, gzip;q=0', undefined],
        ['identity', undefined],
        ['*', 'br'],
        ['*;q=0.1, br;q=0', 'gzip'],
        ['GZIP', 'gzip'],
    ] as const)('%j answers %j', (header, expected) => {
        expect(selectResponseEncoding(header)).toBe(expected);
    });
});
