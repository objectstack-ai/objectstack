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
