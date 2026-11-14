// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23914, #24042] `createHonoApp` reads a dispatched body by
 * `@objectstack/plugin-hono-server`'s rule, media type by media type, and
 * refuses what it cannot read with `400 INVALID_REQUEST` when a dispatched
 * domain READS the body, and only then — the rule `plugin-hono-server` applies
 * to `req.body` — answering it with the same status and body as that package.
 *
 * The catch-all used to hand `dispatch()` `{}` for a declared JSON body that
 * did not parse (#23914), and, until #24042, it parsed every other body as
 * JSON whatever it declared: a JSON body sent as `text/plain` was honoured,
 * and any other body that did not declare JSON, a form included, was `{}`.
 * The data domain read `{}` as an empty query (every row) or an empty update
 * (a `200` for a write that changed nothing).
 *
 * The dispatcher is a fixture (this package's config aliases
 * `@objectstack/runtime` to a stub), standing in for the two kinds of domain:
 * a READER (`/data/*`, `/meta/*`), which reads `body` inside a `try` whose
 * catch answers its own `500`, so a pin that passes proves the adapter's
 * answer won; and a FORWARDER (`/webhooks/redeliver`), which reads its own
 * bytes from the forwarded request and never touches `body`, as the real
 * webhooks, inbound-hook and `/approvals/act` domains do. The real dispatcher
 * and the real domains are driven in
 * `packages/qa/http-conformance/src/hono-body-refusal.conformance.test.ts`.
 * `@objectstack/plugin-hono-server` resolves to its source here
 * (`vitest.config.ts`), so the parity case drives that package's real request
 * path, not a copy of it.
 *
 * In-process `Request`s carry no `Content-Length` of their own, and both doors
 * judge whether a body is present by its framing headers (RFC 9112 §6.3), so
 * a case that stands for a client's body sends `Content-Length` the way a
 * client does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

/** What each domain did: the body it read, or that it read the forwarded request. */
const seen: Array<{ path: string; read?: unknown; forwarded?: string }> = [];

/** A domain that reads the parsed body, and answers a throw out of that read with its own 500. */
function readerDomain(path: string, body: unknown) {
  try {
    const read = JSON.parse(JSON.stringify(body ?? {}));
    seen.push({ path, read });
    return { handled: true, response: { status: 200, body: { success: true, data: read } } };
  } catch {
    return { handled: true, response: { status: 500, body: { success: false, error: { code: 'INTERNAL_ERROR', message: 'domain fault' } } } };
  }
}

/** A domain that forwards the request and reads its own bytes, as `/webhooks/redeliver` does. */
async function forwarderDomain(path: string, request: Request) {
  const text = await request.text();
  seen.push({ path, forwarded: text });
  try {
    JSON.parse(text);
    return { handled: true, response: { status: 200, body: { success: true, data: { ok: true } } } };
  } catch {
    return { handled: true, response: { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Request body must be JSON.' } } } };
  }
}

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(async (path: string, _method: string, body: unknown) => readerDomain(`/auth/${path}`, body)),
  dispatch: vi.fn(async (_method: string, path: string, body: unknown, _query: unknown, ctx: { request: Request }) => {
    if (path === '/webhooks/redeliver') return forwarderDomain(path, ctx.request);
    if (path === '/throws') {
      // A reader that lets the throw escape `dispatch()`.
      void (body as Record<string, unknown>).deliveryId;
      return { handled: true, response: { status: 200, body: { success: true } } };
    }
    return readerDomain(path, body);
  }),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
const QUERY = '/data/showcase_account/query';
const kernel = { name: 'test-kernel' } as any;

/**
 * How a case frames its body. `length` sends `Content-Length` as a client
 * does; `chunked` sends `Transfer-Encoding` instead. `bytes` sends the body as
 * a `Uint8Array`: undici stamps `text/plain;charset=UTF-8` on any STRING body
 * that declares no type, so a request with no `Content-Type` at all can only
 * be built from bytes.
 */
interface Framing { length?: boolean; chunked?: boolean; bytes?: boolean }

function requestInit(method: string, contentType: string | undefined, body: string | undefined, framing: Framing = {}): RequestInit {
  const headers: Record<string, string> = {};
  if (contentType) headers['content-type'] = contentType;
  if (framing.length && body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
  if (framing.chunked) headers['transfer-encoding'] = 'chunked';
  const payload = framing.bytes && body !== undefined ? new TextEncoder().encode(body) : body;
  return { method, headers, body: payload };
}

/** The hosted door: `createHonoApp`'s catch-all, in front of the fixture dispatcher. */
const send = (path: string, method: string, contentType: string | undefined, body: string | undefined, framing?: Framing) =>
  createHonoApp({ kernel, prefix: PREFIX, cors: false })
    .request(`http://hosted.test${PREFIX}${path}`, requestInit(method, contentType, body, framing));

/** The self-hosted door: a `plugin-hono-server` route that reads `req.body` and answers what it read. */
function sendDirect(method: string, contentType: string | undefined, body: string | undefined, framing?: Framing) {
  const server = new HonoHttpServer(0);
  server.post(`${PREFIX}/data/:object/query`, (req, res) => { res.json({ success: true, data: req.body }); });
  return server.getRawApp().fetch(new Request(`http://direct.test${PREFIX}${QUERY}`, requestInit(method, contentType, body, framing)));
}

/**
 * The declared refusal, read whole. Structural rather than `ApiErrorSchema`
 * (this package does not depend on `@objectstack/spec`): the parity case below
 * holds this body equal to `@objectstack/plugin-hono-server`'s, whose own suite
 * (`request-body-refusal.test.ts`) parses it against the declared envelope.
 */
async function expectRefused(res: Response, body: string, names: RegExp = /parsed as JSON/) {
  const json = await res.json() as any;
  expect(res.status, JSON.stringify(json)).toBe(400);
  expect(json).toEqual({
    success: false,
    error: { code: 'INVALID_REQUEST', message: expect.stringMatching(names) },
  });
  if (body.trim() !== '') expect(json.error.message).not.toContain(body.trim());
  return json;
}

beforeEach(() => {
  seen.length = 0;
  mockDispatcher.dispatch.mockClear();
  mockDispatcher.handleAuth.mockClear();
});

describe('[#23914] a domain that READS the body refuses the card\'s bodies, with this adapter\'s answer', () => {
  it.each([
    ['step 2 — a truncated query', 'POST', QUERY, '{"where": {"status": "churned"}'],
    ['step 3 — `{ not json`', 'POST', QUERY, '{ not json'],
    ['step 5 — a truncated PATCH', 'PATCH', '/data/showcase_account/rec_1', '{"name": "HACKED"'],
    ['step 6 — a truncated create', 'POST', '/data/showcase_account', '{"name": "Door Truncated Create"'],
    ['a truncated PUT', 'PUT', '/meta/object/account', '{"name": "account"'],
  ])('%s: refused 400, though the domain answered its own 500', async (_label, method, path, body) => {
    await expectRefused(await send(path, method, 'application/json', body), body);
    expect(mockDispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it('a declared JSON media type is matched case-insensitively', async () => {
    await expectRefused(await send('/data/task/query', 'POST', 'Application/JSON; charset=utf-8', '{ not json'), '{ not json');
  });

  it('a reader whose read escapes dispatch() is answered the refusal by the catch arm', async () => {
    await expectRefused(await send('/throws', 'POST', 'application/json', '{"deliveryId":'), '{"deliveryId":');
  });

  it('the /auth/* legacy fallback refuses the same body the same way, DELETE included', async () => {
    await expectRefused(await send('/auth/sign-in/email', 'POST', 'application/json', '{"email": "a@b.c"'), '{"email": "a@b.c"');
    await expectRefused(await send('/auth/organization/delete', 'DELETE', 'application/json', '{"id": "org_1"'), '{"id": "org_1"');
    expect(mockDispatcher.handleAuth).toHaveBeenCalledTimes(2);
  });
});

describe('[#24042] a body that declares neither JSON nor a form is refused by the domain that reads it', () => {
  it.each([
    ['step 4 — a valid query body sent as text/plain', 'text/plain', '{"where": {"status": "churned"}}', /sent as text\/plain/],
    ['text that does not declare JSON', 'text/plain', 'hello', /sent as text\/plain/],
    ['bytes sent as application/octet-stream', 'application/octet-stream', 'raw bytes', /sent as application\/octet-stream/],
  ])('%s: refused 400, though the domain answered its own 500', async (_label, contentType, body, names) => {
    await expectRefused(await send(QUERY, 'POST', contentType, body, { length: true }), body, names);
    expect(mockDispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it('a body with no Content-Type at all is refused, not read as empty', async () => {
    const body = '{"where": {"status": "churned"}}';
    await expectRefused(await send(QUERY, 'POST', undefined, body, { length: true, bytes: true }), body, /with no Content-Type/);
  });

  it('the /auth/* legacy fallback refuses it the same way', async () => {
    await expectRefused(
      await send('/auth/sign-in/email', 'POST', 'text/plain', '{"email": "a@b.c"}', { length: true }),
      '{"email": "a@b.c"}',
      /sent as text\/plain/,
    );
    expect(mockDispatcher.handleAuth).toHaveBeenCalledTimes(1);
  });

  it('a form that does not parse is refused by its reader', async () => {
    const body = '--nope\r\nnot a part';
    await expectRefused(await send(QUERY, 'POST', 'multipart/form-data; boundary=elsewhere', body), body, /form data/);
    expect(seen).toEqual([]);
  });
});

describe('[#23914] a domain that FORWARDS the request answers it itself, exactly as before', () => {
  it('the forwarder reads every byte the client sent and answers its own refusal; this adapter adds nothing', async () => {
    const body = '{deliveryId:';
    const res = await send('/webhooks/redeliver', 'POST', 'application/json', body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: { code: 'INVALID_REQUEST', message: 'Request body must be JSON.' } });
    expect(seen).toEqual([{ path: '/webhooks/redeliver', forwarded: body }]);
  });

  it('[#24042] so does a body that does not declare JSON: the forwarder\'s own answer, every byte read', async () => {
    const body = '{deliveryId:';
    const res = await send('/webhooks/redeliver', 'POST', 'text/plain', body, { length: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: { code: 'INVALID_REQUEST', message: 'Request body must be JSON.' } });
    expect(seen).toEqual([{ path: '/webhooks/redeliver', forwarded: body }]);
  });

  it('a well-formed body reaches the forwarder untouched', async () => {
    const body = '{ "deliveryId" : "d_1" }';
    expect((await send('/webhooks/redeliver', 'POST', 'application/json', body)).status).toBe(200);
    expect(seen).toEqual([{ path: '/webhooks/redeliver', forwarded: body }]);
  });
});

describe('[#23914, #24042] CONTROL — what is readable is handed on', () => {
  it.each([
    ['a valid JSON body', 'application/json', '{"where": {"status": "churned"}}', { where: { status: 'churned' } }],
    ['an empty JSON body (an empty query)', 'application/json', '', {}],
    ['a whitespace-only JSON body', 'application/json', '  \n', {}],
    ['[#24042] a form body, parsed as plugin-hono-server parses it', 'application/x-www-form-urlencoded', 'token=abc', { token: 'abc' }],
    ['[#24042] a request that declares no body, whatever its media type', 'text/plain', undefined, {}],
  ])('%s', async (_label, contentType, body, expected) => {
    const res = await send('/data/task/query', 'POST', contentType, body);
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ path: '/data/task/query', read: expected }]);
  });
});

/**
 * [#24042] One table, both doors. Each row is sent to the hosted door (the
 * catch-all, in front of the reading domain) and to the self-hosted door (a
 * `plugin-hono-server` route that reads `req.body`), and the two answers must
 * be equal: the same status, and the same body — for a refusal, the same
 * `code` and the same `message`; for a body that is read, the same value.
 *
 * [label, Content-Type, body, framing, the expected status]
 */
const PARITY: Array<[string, string | undefined, string | undefined, Framing, number]> = [
  // Declared JSON.
  ['a valid JSON body', 'application/json', '{"where": {"status": "churned"}}', { length: true }, 200],
  ['a truncated query (step 2)', 'application/json', '{"where": {"status": "churned"}', { length: true }, 400],
  ['`{ not json` (step 3)', 'application/json', '{ not json', {}, 400],
  ['declared JSON in another spelling', 'Application/JSON; charset=utf-8', '{ not json', { length: true }, 400],
  ['a blank JSON body', 'application/json', '', { length: true }, 200],
  ['a whitespace-only JSON body', 'application/json', '  \n', { length: true }, 200],
  // A form.
  ['a urlencoded form', 'application/x-www-form-urlencoded', 'token=abc&token=def&x=1', { length: true }, 200],
  ['a malformed urlencoded form (read leniently by the parser on both doors)', 'application/x-www-form-urlencoded', 'a=%zz&b=%&=&&{"a":1}', { length: true }, 200],
  ['a multipart form', 'multipart/form-data; boundary=b', '--b\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--b--\r\n', { length: true }, 200],
  ['a multipart form that does not parse', 'multipart/form-data; boundary=elsewhere', '--nope\r\nnot a part', { length: true }, 400],
  // Any other media type, or none, with a body.
  ['step 4 — `{"a":1}` sent as text/plain', 'text/plain', '{"a":1}', { length: true }, 400],
  ['step 4 — the query body sent as text/plain;charset=UTF-8', 'text/plain;charset=UTF-8', '{"where": {"status": "churned"}}', { length: true }, 400],
  ['plain text', 'text/plain', 'hello', { length: true }, 400],
  ['a body with no Content-Type', undefined, '{"a":1}', { length: true, bytes: true }, 400],
  ['application/octet-stream', 'application/octet-stream', 'raw bytes', { length: true }, 400],
  ['a +json suffix type', 'application/merge-patch+json', '{"a":1}', { length: true }, 400],
  ['a media type that is not a token pair (named as unrecognised)', 'text/plain extra', 'hello', { length: true }, 400],
  ['a body framed by Transfer-Encoding', 'text/plain', '{"a":1}', { chunked: true }, 400],
  // No body declared.
  ['a text/plain request with no body', 'text/plain', undefined, {}, 200],
  ['a text/plain body framed as zero-length', 'text/plain', '', { length: true }, 200],
  ['an in-process text/plain body with no framing headers (read as no body on both doors)', 'text/plain', 'hello', {}, 200],
];

describe('[#23914, #24042] both Hono doors answer one body alike, media type by media type', () => {
  it.each(PARITY)('%s: the same status and the same body', async (_label, contentType, body, framing, status) => {
    const hosted = await send(QUERY, 'POST', contentType, body, framing);
    const direct = await sendDirect('POST', contentType, body, framing);

    const hostedJson = await hosted.json() as any;
    const directJson = await direct.json() as any;
    expect(hosted.status, JSON.stringify(hostedJson)).toBe(status);
    expect(direct.status, JSON.stringify(directJson)).toBe(status);
    expect(hostedJson).toEqual(directJson);
    if (status === 400) {
      expect(hostedJson).toEqual({ success: false, error: { code: 'INVALID_REQUEST', message: expect.any(String) } });
      if (body && body.trim() !== '') expect(hostedJson.error.message).not.toContain(body.trim());
    } else {
      expect(hostedJson.success).toBe(true);
    }
  });
});

/**
 * The request-body limit (`@objectstack/plugin-hono-server`'s
 * `src/body-limit.ts`), on both doors. The client's body is a stream that
 * counts what the server pulled from it, so "not read" and "not read past the
 * limit" are measured, not inferred from the status.
 */
describe('a request body over the transport limit is answered 413 and not read past the limit, on both doors', () => {
  const LIMIT = 64;
  const CHUNK = 16;

  /** A client body that yields `text` in `CHUNK`-byte pieces and counts the bytes the server pulled. */
  function countedBody(text: string) {
    const bytes = new TextEncoder().encode(text);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes.byteLength) {
          controller.close();
          return;
        }
        const piece = bytes.slice(sent, sent + CHUNK);
        sent += piece.byteLength;
        controller.enqueue(piece);
      },
    }, { highWaterMark: 0 });
    return { stream, sent: () => sent, total: bytes.byteLength };
  }

  /** A JSON document of exactly `size` bytes. */
  const jsonOfSize = (size: number) => `{"a":"${'x'.repeat(size - 8)}"}`;

  /** `declared` sends `Content-Length: size`; `chunked` sends `Transfer-Encoding` and no length. */
  function init(method: string, contentType: string, stream: ReadableStream<Uint8Array>, framing: { declared?: number; chunked?: boolean }): RequestInit {
    const headers: Record<string, string> = { 'content-type': contentType };
    if (framing.declared !== undefined) headers['content-length'] = String(framing.declared);
    if (framing.chunked) headers['transfer-encoding'] = 'chunked';
    return { method, headers, body: stream, duplex: 'half' } as RequestInit;
  }

  const hostedApp = (limit = LIMIT) => createHonoApp({ kernel, prefix: PREFIX, cors: false, maxRequestBodyBytes: limit });

  /** The self-hosted door: a reading route, a byte door that reads `rawBody()`, a raw-app reader, and a route that refuses before it reads. */
  function directServer(limit = LIMIT) {
    const server = new HonoHttpServer(0);
    server.setMaxRequestBodyBytes(limit);
    server.post(`${PREFIX}/data/:object/query`, (req, res) => { res.json({ success: true, data: req.body }); });
    server.put(`${PREFIX}/bytes/:id`, async (req, res) => {
      const bytes = await req.rawBody!();
      res.json({ success: true, data: { size: bytes.byteLength, text: bytes.toString('utf8') } });
    });
    server.post(`${PREFIX}/signed-in-only`, (_req, res) => {
      res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in first.' } });
    });
    // A raw-app route that reads the request itself, as the auth service's mount does.
    server.getRawApp().post(`${PREFIX}/auth/sign-in/email`, async (c) => {
      try {
        return c.json({ success: true, data: await c.req.raw.json() });
      } catch {
        return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'reader fault' } }, 500);
      }
    });
    return server;
  }

  const hosted = (path: string, method: string, contentType: string, stream: ReadableStream<Uint8Array>, framing: { declared?: number; chunked?: boolean }, limit?: number) =>
    hostedApp(limit).request(`http://hosted.test${PREFIX}${path}`, init(method, contentType, stream, framing));
  const direct = (path: string, method: string, contentType: string, stream: ReadableStream<Uint8Array>, framing: { declared?: number; chunked?: boolean }, limit?: number) =>
    directServer(limit).getRawApp().fetch(new Request(`http://direct.test${PREFIX}${path}`, init(method, contentType, stream, framing)));

  async function expectTooLarge(res: Response) {
    const json = await res.json() as any;
    expect(res.status, JSON.stringify(json)).toBe(413);
    expect(json).toEqual({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: expect.stringContaining(`(${LIMIT} bytes)`) } });
    return json;
  }

  /** [label, the door, the path, the method] — every reader of a body on each door. */
  const READERS: Array<[string, typeof hosted, string, string]> = [
    ['the hosted door, a domain that reads the parsed body', hosted, QUERY, 'POST'],
    ['the hosted door, a domain that reads the forwarded request', hosted, '/webhooks/redeliver', 'POST'],
    ['the hosted door, the auth fallback that reads the parsed body', hosted, '/auth/sign-in/email', 'POST'],
    ['the self-hosted door, a route that reads req.body', direct, QUERY, 'POST'],
    ['the self-hosted door, a raw-app route that reads the request itself', direct, '/auth/sign-in/email', 'POST'],
  ];

  it.each(READERS)('%s: a declared length over the limit is answered 413 and no byte of it is read', async (_label, door, path, method) => {
    const body = countedBody(jsonOfSize(LIMIT + 1));
    await expectTooLarge(await door(path, method, 'application/json', body.stream, { declared: body.total }));
    expect(body.sent()).toBe(0);
    expect(seen).toEqual([]);
  });

  it.each(READERS)('%s: a body with no declared length is answered 413 once it passes the limit, and is not read further', async (_label, door, path, method) => {
    const body = countedBody(jsonOfSize(LIMIT * 10));
    await expectTooLarge(await door(path, method, 'application/json', body.stream, { chunked: true }));
    expect(body.sent()).toBeLessThanOrEqual(LIMIT + 2 * CHUNK);
    expect(body.sent()).toBeLessThan(body.total);
    expect(seen).toEqual([]);
  });

  it.each([
    ['declared', { declared: LIMIT }],
    ['with no declared length', { chunked: true }],
  ] as const)('a body of exactly the limit, %s, is read as before on both doors', async (_label, framing) => {
    const text = jsonOfSize(LIMIT);
    const hostedRes = await hosted(QUERY, 'POST', 'application/json', countedBody(text).stream, framing);
    const directRes = await direct(QUERY, 'POST', 'application/json', countedBody(text).stream, framing);
    expect(hostedRes.status).toBe(200);
    expect(directRes.status).toBe(200);
    expect(await hostedRes.json()).toEqual({ success: true, data: JSON.parse(text) });
    expect(await directRes.json()).toEqual({ success: true, data: JSON.parse(text) });
  });

  it('an operator-raised limit admits the larger body, on both doors', async () => {
    const text = jsonOfSize(LIMIT * 3);
    const hostedRes = await hosted(QUERY, 'POST', 'application/json', countedBody(text).stream, { declared: LIMIT * 3 }, LIMIT * 4);
    const directRes = await direct(QUERY, 'POST', 'application/json', countedBody(text).stream, { chunked: true }, LIMIT * 4);
    expect(hostedRes.status).toBe(200);
    expect(directRes.status).toBe(200);
    expect((await directRes.json() as any).data).toEqual(JSON.parse(text));
  });

  it.each([
    ['declared, sent as bytes', 'application/octet-stream', { declared: LIMIT * 4 }],
    ['declared, sent as the JSON file it is', 'application/json', { declared: LIMIT * 4 }],
    ['with no declared length, sent as bytes', 'application/octet-stream', { chunked: true }],
    ['with no declared length, sent as the JSON file it is', 'application/json', { chunked: true }],
  ] as const)('a byte door that reads rawBody() keeps its own bound: a body over the transport limit, %s, arrives whole', async (_label, contentType, framing) => {
    const text = jsonOfSize(LIMIT * 4);
    const res = await direct('/bytes/f_1', 'PUT', contentType, countedBody(text).stream, framing);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { size: LIMIT * 4, text } });
  });

  it('a route that refuses an anonymous caller before reading keeps its answer, and reads nothing', async () => {
    const body = countedBody(jsonOfSize(LIMIT * 10));
    const res = await direct('/signed-in-only', 'POST', 'application/json', body.stream, { declared: body.total });
    expect(res.status).toBe(401);
    expect(body.sent()).toBe(0);
  });

  it('CONTROL: a JSON and a form body within the limit are read as before, on both doors', async () => {
    for (const [contentType, text, expected] of [
      ['application/json', '{"where":{"status":"churned"}}', { where: { status: 'churned' } }],
      ['application/x-www-form-urlencoded', 'token=abc&x=1', { token: 'abc', x: '1' }],
    ] as const) {
      for (const framing of [{ declared: Buffer.byteLength(text) }, { chunked: true }]) {
        seen.length = 0;
        const hostedRes = await hosted(QUERY, 'POST', contentType, countedBody(text).stream, framing);
        expect(hostedRes.status).toBe(200);
        expect(seen).toEqual([{ path: QUERY, read: expected }]);
        const directRes = await direct(QUERY, 'POST', contentType, countedBody(text).stream, framing);
        expect(directRes.status).toBe(200);
        expect(await directRes.json()).toEqual({ success: true, data: expected });
      }
    }
  });

  it('the default limit is 10 MiB on both doors, and a declared length over it is not read', async () => {
    const TEN_MIB = 10 * 1024 * 1024;
    expect(new HonoHttpServer(0).getMaxRequestBodyBytes()).toBe(TEN_MIB);
    const server = new HonoHttpServer(0);
    server.post(`${PREFIX}/data/:object/query`, (req, res) => { res.json({ success: true, data: req.body }); });
    for (const app of [createHonoApp({ kernel, prefix: PREFIX, cors: false }), server.getRawApp()]) {
      const body = countedBody(jsonOfSize(LIMIT));
      const res = await app.request(`http://default.test${PREFIX}${QUERY}`, init('POST', 'application/json', body.stream, { declared: TEN_MIB + 1 }));
      expect(res.status).toBe(413);
      expect(body.sent()).toBe(0);
    }
  });
});
