// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24083] `IHttpRequest.body` — cross-adapter conformance.
 *
 * The contract (`packages/spec/src/contracts/http-server.ts`): the body is the
 * parsed JSON document for `application/json`, the parsed fields of a form
 * (`multipart/form-data`, `application/x-www-form-urlencoded`), `{}` when the
 * request carries no body, and reading it may REFUSE — an implementation that
 * cannot parse the body, or does not read its media type, throws from the read
 * rather than hand over an invented value. The standard transport
 * (`@objectstack/plugin-hono-server`) refuses with `400 INVALID_REQUEST` and
 * answers the request itself, replacing whatever the handler wrote.
 *
 * Until this file nothing drove the reference adapter with a body it could
 * not read, and it read malformed declared JSON as `{}`, a multipart body as
 * `{}` and a `text/plain` body as a string, so the suite that exists to lock
 * cross-adapter behaviour could not see the difference. The reference now
 * MIRRORS the standard transport's decision without importing it (see the
 * body block in `adapter.ts`); this file is what holds the two equal.
 *
 * ## What this pins, on BOTH adapters over a real socket
 *
 *  1. A malformed declared-JSON body is refused `400 INVALID_REQUEST` at the
 *     read, never read as `{}`, and the answer does not echo the body.
 *  2. A non-empty body in a media type neither adapter reads (`text/plain`)
 *     is refused the same way, never handed over as a string.
 *  3. A multipart body is parsed into its fields: one value per key with the
 *     last one winning, a `[]` key collecting every value, a file part as a
 *     file.
 *  4. The refusal is the answer even when the handler catches it and writes
 *     its own.
 *  5. `rawBody()` still reads the bytes of a refused body.
 *  6. CONTROLS: an empty body is `{}`, and a valid JSON body is the document.
 *
 * Then PARITY: every row above, sent to both adapters, answers the same status
 * and the same bytes (the refusal messages included, so the reference's
 * mirrored wording cannot drift from the standard transport's unseen).
 *
 * `@objectstack/plugin-hono-server` resolves through its `dist/` (a ledgered
 * pair in `scripts/check-test-source-alias.mjs`), as in the sibling
 * `fallback-seam.conformance.test.ts`; the reference is this package's source.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { RouteHandler } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { NodeHttpServer } from './adapter.js';

/** The `IHttpServer` members this suite drives. */
interface BodyReadingServer {
    post(path: string, handler: RouteHandler): void;
    listen(port: number): Promise<void>;
    close?(): Promise<void>;
    getPort(): number;
}

type AdapterCase = { label: 'node' | 'hono'; make: () => BodyReadingServer };

const ADAPTERS: AdapterCase[] = [
    { label: 'node', make: () => new NodeHttpServer(0) },
    { label: 'hono', make: () => new HonoHttpServer(0) },
];

/** A body value as JSON can carry it: a file part by its name, type and size. */
function describeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(describeValue);
    if (value instanceof Blob) {
        return { file: (value as Blob & { name?: string }).name, type: value.type, size: value.size };
    }
    return value;
}

function describeBody(body: unknown): unknown {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, describeValue(value)]));
}

/** The request shapes, built fresh per send (a body is consumed by its send). */
const BODIES = {
    malformedJson: (): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: '{ not json' }),
    textPlain: (): RequestInit => ({ headers: { 'content-type': 'text/plain' }, body: 'plain words' }),
    multipart: (): RequestInit => {
        const form = new FormData();
        form.append('name', 'Ada');
        form.append('tag', 'first');
        form.append('tag', 'last');
        form.append('ids[]', '1');
        form.append('ids[]', '2');
        form.append('upload', new Blob(['three'], { type: 'text/plain' }), 'notes.txt');
        return { body: form };
    },
    noBody: (): RequestInit => ({}),
    emptyJson: (): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: '' }),
    emptyText: (): RequestInit => ({ headers: { 'content-type': 'text/plain' }, body: '' }),
    validJson: (): RequestInit => ({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'adapter parity', tags: ['a', 'b'], n: 3 }),
    }),
} as const;
type BodyName = keyof typeof BODIES;

/** The fields the multipart body parses into, on both adapters. */
const MULTIPART_FIELDS = {
    name: 'Ada',
    tag: 'last',
    'ids[]': ['1', '2'],
    upload: { file: 'notes.txt', type: 'text/plain', size: 5 },
};

type Answer = { status: number; text: string };

/** Boot one adapter with the three routes this suite reads through. */
async function boot(make: () => BodyReadingServer, opened: BodyReadingServer[]) {
    const server = make();
    // Reads `req.body` and answers what it read.
    server.post('/echo', (req, res) => {
        const body = describeBody(req.body);
        res.status(200);
        res.json({ body });
    });
    // Catches the refusal and answers its own — what the contract says a
    // handler must not do, and what the transport's answer overrides.
    server.post('/caught', (req, res) => {
        try {
            void req.body;
        } catch {
            res.status(500);
            res.json({ caught: true });
            return;
        }
        res.status(200);
        res.json({ caught: false });
    });
    // Reads the raw bytes only, and never `req.body`.
    server.post('/raw', async (req, res) => {
        const bytes = await req.rawBody!();
        res.status(200);
        res.json({ raw: bytes.toString('utf8') });
    });
    await server.listen(0);
    opened.push(server);
    const base = `http://127.0.0.1:${server.getPort()}`;
    return async (path: string, body: BodyName): Promise<Answer> => {
        const res = await fetch(`${base}${path}`, { method: 'POST', ...BODIES[body]() });
        return { status: res.status, text: await res.text() };
    };
}

function expectRefused(answer: Answer, sent: string) {
    expect(answer.status, answer.text).toBe(400);
    expect(JSON.parse(answer.text)).toEqual({
        success: false,
        error: { code: 'INVALID_REQUEST', message: expect.any(String) },
    });
    expect(answer.text).not.toContain(sent);
}

describe.each(ADAPTERS)('IHttpRequest.body conformance on the $label adapter', ({ make }) => {
    const opened: BodyReadingServer[] = [];
    afterEach(async () => {
        await Promise.all(opened.splice(0).map((server) => server.close?.()));
    });

    it('a malformed declared-JSON body is refused 400 INVALID_REQUEST at the read, never read as {}', async () => {
        const send = await boot(make, opened);
        expectRefused(await send('/echo', 'malformedJson'), '{ not json');
    });

    it('a non-empty text/plain body is refused the same way, never handed over as a string', async () => {
        const send = await boot(make, opened);
        expectRefused(await send('/echo', 'textPlain'), 'plain words');
    });

    it('a multipart body is parsed into its fields', async () => {
        const send = await boot(make, opened);
        const answer = await send('/echo', 'multipart');
        expect(answer.status, answer.text).toBe(200);
        expect(JSON.parse(answer.text)).toEqual({ body: MULTIPART_FIELDS });
    });

    it('the refusal is the answer even when the handler catches it and writes its own', async () => {
        const send = await boot(make, opened);
        expectRefused(await send('/caught', 'textPlain'), 'plain words');
    });

    it('rawBody() still reads the bytes of a body that req.body refuses', async () => {
        const send = await boot(make, opened);
        expect(await send('/raw', 'malformedJson')).toEqual({ status: 200, text: JSON.stringify({ raw: '{ not json' }) });
        expect(await send('/raw', 'textPlain')).toEqual({ status: 200, text: JSON.stringify({ raw: 'plain words' }) });
    });

    it('CONTROL — an empty body is {}: none at all, an empty JSON body, an empty text/plain body', async () => {
        const send = await boot(make, opened);
        for (const body of ['noBody', 'emptyJson', 'emptyText'] as const) {
            const answer = await send('/echo', body);
            expect({ body, status: answer.status, read: JSON.parse(answer.text) }).toEqual({ body, status: 200, read: { body: {} } });
        }
    });

    it('CONTROL — a valid JSON body is the parsed document', async () => {
        const send = await boot(make, opened);
        const answer = await send('/echo', 'validJson');
        expect(answer.status, answer.text).toBe(200);
        expect(JSON.parse(answer.text)).toEqual({ body: { title: 'adapter parity', tags: ['a', 'b'], n: 3 } });
    });
});

describe('IHttpRequest.body parity: both adapters answer each body with the same status and the same bytes', () => {
    const opened: BodyReadingServer[] = [];
    afterEach(async () => {
        await Promise.all(opened.splice(0).map((server) => server.close?.()));
    });

    const ROWS: Array<[path: string, body: BodyName]> = [
        ['/echo', 'malformedJson'],
        ['/echo', 'textPlain'],
        ['/echo', 'multipart'],
        ['/echo', 'noBody'],
        ['/echo', 'emptyJson'],
        ['/echo', 'emptyText'],
        ['/echo', 'validJson'],
        ['/caught', 'textPlain'],
        ['/raw', 'malformedJson'],
        ['/raw', 'textPlain'],
    ];

    it.each(ROWS)('%s · %s', async (path, body) => {
        const [node, hono] = ADAPTERS;
        const reference = await (await boot(node!.make, opened))(path, body);
        const standard = await (await boot(hono!.make, opened))(path, body);
        expect(reference, `the reference answered ${reference.text}; the standard transport ${standard.text}`).toEqual(standard);
    });
});
