// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A request target whose PATH holds a backslash is refused `400` by the Node
 * listener (`@hono/node-server` >= 2.1.6) before any route runs. Up to 2.1.5
 * the WHATWG URL parser rewrote the backslash to `/`, so `/api/v1/things\t_1`
 * reached the `/api/v1/things/:id` route. The same route without the
 * backslash still answers, and a backslash after `?` is query data, not path.
 *
 * The request line is written on a raw socket: `fetch` would normalise the
 * backslash on the client side and never send it.
 */

import { connect } from 'node:net';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { HonoHttpServer } from './adapter';

let server: HonoHttpServer;
let port: number;

beforeAll(async () => {
    server = new HonoHttpServer(0);
    server.get('/api/v1/things/:id', (req, res) => { res.json({ success: true, data: { id: req.params.id, q: req.query.q } }); });
    await server.listen(0);
    port = server.getPort();
});

afterAll(async () => {
    await server.close();
});

function requestLine(target: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1');
        let text = '';
        socket.on('data', (chunk) => { text += chunk.toString('utf8'); });
        socket.on('end', () => resolve(text));
        socket.on('close', () => resolve(text));
        socket.on('error', reject);
        socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
}

describe('a backslash in the request path is refused 400 before any route runs', () => {
    it('the route answers without the backslash', async () => {
        const answer = await requestLine('/api/v1/things/t_1');
        expect(answer).toMatch(/^HTTP\/1\.1 200 /);
        expect(answer).toContain('"id":"t_1"');
    });

    it('the same route with a backslash in its path is answered 400', async () => {
        const answer = await requestLine('/api/v1/things\\t_1');
        expect(answer).toMatch(/^HTTP\/1\.1 400 /);
        expect(answer).not.toContain('"id":"t_1"');
    });

    it('a backslash after `?` is query data and the route still answers', async () => {
        const answer = await requestLine('/api/v1/things/t_1?q=a\\b');
        expect(answer).toMatch(/^HTTP\/1\.1 200 /);
        expect(answer).toContain('"id":"t_1"');
    });
});
