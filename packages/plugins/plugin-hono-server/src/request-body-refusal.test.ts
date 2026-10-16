// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23914] A request body this adapter cannot parse is refused `400
 * INVALID_REQUEST` when a handler reads `req.body`, and is never handed on as
 * `{}`.
 *
 * Driven through the real Hono app (`getRawApp().fetch`) and, for the framing
 * half, a real socket. The routes stand in for the REST data doors the card
 * measured: each reads `req.body` the way those handlers do, inside a `try`
 * whose catch answers its OWN dialect, so a pin that passes proves the
 * adapter's answer won over the handler's.
 *
 * In-process `Request`s carry no `Content-Length` of their own, so the cases
 * whose media type is not read here declare one, as the wire always does; the
 * socket cases at the foot send it the way a client does.
 *
 * Pinned: the card's reproduction bodies (truncated query, `{ not json`, a
 * JSON body sent as `text/plain`, a truncated `PATCH`, a truncated create),
 * each refused with the declared envelope, and the handler never acting on
 * the body. CONTROL: a valid body, an empty one, a form, and the byte doors
 * (`rawBody()` of a non-JSON file sent as `application/json`, of `text/plain`
 * and of `application/octet-stream`) answer as they did.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';

import { HonoHttpServer } from './adapter';

/** What each stand-in door saw and did. */
interface Seen { received: unknown[]; writes: number }

function dataDoors(): { server: HonoHttpServer; seen: Seen } {
    const server = new HonoHttpServer(0);
    const seen: Seen = { received: [], writes: 0 };

    // `POST /data/:object/query`: reads the body inside a try whose catch
    // answers its own 500 — the adapter's refusal must still be the answer.
    server.post('/api/v1/data/:object/query', (req, res) => {
        try {
            const query = req.body;
            seen.received.push(query);
            res.status(200);
            res.json({ object: req.params.object, query });
        } catch {
            res.status(500);
            res.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'handler fault' } });
        }
    });

    // `PATCH /data/:object/:id`: a write that happens only after the body is read.
    server.patch('/api/v1/data/:object/:id', (req, res) => {
        const data = req.body;
        seen.writes += 1;
        seen.received.push(data);
        res.status(200);
        res.json({ id: req.params.id, record: data });
    });

    // `POST /data/:object`: a create whose required-field check would answer a
    // misleading `400 VALIDATION_FAILED` for a body read as `{}` (step 6).
    server.post('/api/v1/data/:object', (req, res) => {
        const data = (req.body ?? {}) as Record<string, unknown>;
        if (!data.name) {
            res.status(400);
            res.json({ error: 'Account Name is required', code: 'VALIDATION_FAILED' });
            return;
        }
        seen.writes += 1;
        res.status(201);
        res.json({ record: data });
    });

    // A byte door, as the storage raw PUT reads it: `rawBody()` first, and
    // `req.body` never touched.
    server.put('/api/v1/storage/_local/raw/:token', async (req, res) => {
        const bytes = await req.rawBody!();
        res.status(200);
        res.json({ size: bytes.byteLength, text: bytes.toString('utf8') });
    });

    server.installNotFoundSeam();
    return { server, seen };
}

/**
 * `bytes` sends the body as a `Uint8Array`: undici stamps
 * `text/plain;charset=UTF-8` on any STRING body that declares no type, so a
 * request with no `Content-Type` at all can only be built from bytes.
 */
const send = (
    server: HonoHttpServer,
    method: string,
    path: string,
    init: { contentType?: string; body?: string; length?: boolean; bytes?: boolean } = {},
) => {
    const headers: Record<string, string> = {};
    if (init.contentType) headers['content-type'] = init.contentType;
    if (init.length && init.body !== undefined) headers['content-length'] = String(Buffer.byteLength(init.body));
    const body = init.bytes && init.body !== undefined ? new TextEncoder().encode(init.body) : init.body;
    return server.getRawApp().fetch(new Request(`http://localhost${path}`, { method, headers, body }));
};

/** The declared refusal, read whole: status, envelope, code, and a message that echoes nothing. */
async function expectRefused(res: Response, body: string, names: RegExp) {
    const json = await res.json() as any;
    const shown = JSON.stringify(json);
    expect(res.status, shown).toBe(400);
    expect(envelopeViolations(json), shown).toEqual([]);
    expect(ApiErrorSchema.safeParse(json.error).success, shown).toBe(true);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INVALID_REQUEST');
    expect(json.error.message).toMatch(names);
    // Never echoes the body — V8's own parse error quotes it (`"{ not json" is
    // not valid JSON`), which is why the message is the adapter's, not the
    // parser's. Neither the body nor any distinctive word of it is in it.
    expect(json.error.message).not.toContain(body.trim());
    for (const word of body.split(/[^A-Za-z]+/).filter((w) => w.length >= 5)) {
        expect(json.error.message, `echoes "${word}"`).not.toContain(word);
    }
}

const QUERY = '/api/v1/data/showcase_account/query';
const VALID = '{"where": {"status": "churned"}}';

describe('[#23914] the card\'s bodies are refused 400 at the door, and the handler never acts on them', () => {
    it('step 2 — a truncated query body', async () => {
        const { server, seen } = dataDoors();
        const body = '{"where": {"status": "churned"}';
        await expectRefused(await send(server, 'POST', QUERY, { contentType: 'application/json', body }), body, /parsed as JSON/);
        expect(seen.received).toEqual([]);
    });

    it('step 3 — `{ not json`', async () => {
        const { server, seen } = dataDoors();
        const body = '{ not json';
        await expectRefused(await send(server, 'POST', QUERY, { contentType: 'application/json', body }), body, /parsed as JSON/);
        expect(seen.received).toEqual([]);
    });

    it('step 4 — a valid query body sent as text/plain', async () => {
        const { server, seen } = dataDoors();
        await expectRefused(
            await send(server, 'POST', QUERY, { contentType: 'text/plain;charset=UTF-8', body: VALID, length: true }),
            VALID,
            /sent as text\/plain/,
        );
        expect(seen.received).toEqual([]);
    });

    it('step 5 — a truncated PATCH writes nothing', async () => {
        const { server, seen } = dataDoors();
        const body = '{"name": "HACKED"';
        await expectRefused(
            await send(server, 'PATCH', '/api/v1/data/showcase_account/rec_1', { contentType: 'application/json', body }),
            body,
            /parsed as JSON/,
        );
        expect(seen.writes).toBe(0);
    });

    it('step 6 — a truncated create answers the parse refusal, not the required-field one', async () => {
        const { server, seen } = dataDoors();
        const body = '{"name": "Door Truncated Create"';
        const res = await send(server, 'POST', '/api/v1/data/showcase_account', { contentType: 'application/json', body });
        await expectRefused(res, body, /parsed as JSON/);
        expect(seen.writes).toBe(0);
    });

    it('a declared JSON media type is matched case-insensitively', async () => {
        const { server } = dataDoors();
        const body = '{ not json';
        await expectRefused(await send(server, 'POST', QUERY, { contentType: 'Application/JSON', body }), body, /parsed as JSON/);
    });

    it('a body with no Content-Type at all is refused, not read as empty', async () => {
        const { server } = dataDoors();
        await expectRefused(await send(server, 'POST', QUERY, { body: VALID, length: true, bytes: true }), VALID, /no Content-Type/);
    });

    it('a form body that does not parse is refused', async () => {
        const { server } = dataDoors();
        const body = '--nope\r\nnot a part';
        await expectRefused(
            await send(server, 'POST', QUERY, { contentType: 'multipart/form-data; boundary=elsewhere', body }),
            body,
            /form data/,
        );
    });
});

describe('[#23914] CONTROL — what this adapter can read answers as before', () => {
    it('a valid JSON body reaches the handler parsed', async () => {
        const { server, seen } = dataDoors();
        const res = await send(server, 'POST', QUERY, { contentType: 'application/json', body: VALID });
        expect(res.status).toBe(200);
        expect(seen.received).toEqual([{ where: { status: 'churned' } }]);
    });

    it('an empty or whitespace-only JSON body is `{}` — the documented empty query', async () => {
        const { server, seen } = dataDoors();
        expect((await send(server, 'POST', QUERY, { contentType: 'application/json', body: '' })).status).toBe(200);
        expect((await send(server, 'POST', QUERY, { contentType: 'application/json', body: ' \n ' })).status).toBe(200);
        expect(seen.received).toEqual([{}, {}]);
    });

    it('a request with no body is `{}`, whatever it declares', async () => {
        const { server, seen } = dataDoors();
        expect((await send(server, 'POST', QUERY)).status).toBe(200);
        expect((await send(server, 'POST', QUERY, { contentType: 'text/plain', body: '', length: true })).status).toBe(200);
        expect(seen.received).toEqual([{}, {}]);
    });

    it('a urlencoded form body reaches the handler parsed', async () => {
        const { server, seen } = dataDoors();
        const res = await send(server, 'POST', QUERY, { contentType: 'application/x-www-form-urlencoded', body: 'a=1&b=two' });
        expect(res.status).toBe(200);
        expect(seen.received).toEqual([{ a: '1', b: 'two' }]);
    });

    it('a valid PATCH writes', async () => {
        const { server, seen } = dataDoors();
        const res = await send(server, 'PATCH', '/api/v1/data/showcase_account/rec_1', { contentType: 'application/json', body: '{"name":"Door"}' });
        expect(res.status).toBe(200);
        expect(seen.writes).toBe(1);
    });

    it.each([
        ['a JSON-with-comments file sent as application/json', 'application/json', '{\n  // a comment\n  "a": 1,\n}\n'],
        ['a text file sent as text/plain', 'text/plain', 'plain text bytes\n'],
        ['bytes sent as application/octet-stream', 'application/octet-stream', 'raw bytes'],
    ])('byte door — %s is stored byte for byte', async (_label, contentType, body) => {
        const { server } = dataDoors();
        const res = await send(server, 'PUT', '/api/v1/storage/_local/raw/tok', { contentType, body, length: true });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ size: Buffer.byteLength(body), text: body });
    });
});

describe('[#23914] the fallback seam', () => {
    it('a fallback that declines without reading the body leaves the 404', async () => {
        const { server } = dataDoors();
        server.setFallbackHandler(() => { /* not mine */ });
        const res = await send(server, 'POST', '/api/v1/nowhere', { contentType: 'application/json', body: '{ not json' });
        expect(res.status).toBe(404);
    });

    it('a fallback that reads the body is refused like a route', async () => {
        const { server } = dataDoors();
        let ran = false;
        server.setFallbackHandler((req, res) => { ran = true; res.status(200); res.json({ body: req.body }); });
        const body = '{ not json';
        await expectRefused(await send(server, 'POST', '/api/v1/apps/x/y', { contentType: 'application/json', body }), body, /parsed as JSON/);
        expect(ran).toBe(true);
    });
});

describe('[#23914] on a real socket, where the client frames the body', () => {
    const opened: HonoHttpServer[] = [];
    afterEach(async () => { while (opened.length > 0) await opened.pop()!.close(); });

    async function base(): Promise<{ url: string; seen: Seen }> {
        const { server, seen } = dataDoors();
        opened.push(server);
        await server.listen(0);
        return { url: `http://127.0.0.1:${server.getPort()}`, seen };
    }

    it('step 4 over the wire: a JSON body sent as text/plain is refused', async () => {
        const { url, seen } = await base();
        const res = await fetch(`${url}${QUERY}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: VALID });
        await expectRefused(res, VALID, /sent as text\/plain/);
        expect(seen.received).toEqual([]);
    });

    it('CONTROL over the wire: a POST with no body is `{}`', async () => {
        const { url, seen } = await base();
        const res = await fetch(`${url}${QUERY}`, { method: 'POST' });
        expect(res.status).toBe(200);
        expect(seen.received).toEqual([{}]);
    });
});
