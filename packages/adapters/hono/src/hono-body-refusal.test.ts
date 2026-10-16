// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23914] `createHonoApp` refuses a declared JSON body that does not parse
 * with `400 INVALID_REQUEST` when a dispatched domain READS the body, and only
 * then — the rule `@objectstack/plugin-hono-server` applies to `req.body` — and
 * answers it with the same status and body as that package.
 *
 * The catch-all used to hand `dispatch()` `{}` for such a body, which the data
 * domain read as an empty query (every row) or an empty update (a `200` for a
 * write that changed nothing).
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
const kernel = { name: 'test-kernel' } as any;

const send = (path: string, method: string, contentType: string | undefined, body: string) =>
  createHonoApp({ kernel, prefix: PREFIX, cors: false }).request(`http://hosted.test${PREFIX}${path}`, {
    method,
    headers: contentType ? { 'Content-Type': contentType } : {},
    body,
  });

/**
 * The declared refusal, read whole. Structural rather than `ApiErrorSchema`
 * (this package does not depend on `@objectstack/spec`): the parity case below
 * holds this body equal to `@objectstack/plugin-hono-server`'s, whose own suite
 * (`request-body-refusal.test.ts`) parses it against the declared envelope.
 */
async function expectRefused(res: Response, body: string) {
  const json = await res.json() as any;
  expect(res.status, JSON.stringify(json)).toBe(400);
  expect(json).toEqual({
    success: false,
    error: { code: 'INVALID_REQUEST', message: expect.stringMatching(/parsed as JSON/) },
  });
  expect(json.error.message).not.toContain(body.trim());
  return json;
}

beforeEach(() => {
  seen.length = 0;
  mockDispatcher.dispatch.mockClear();
  mockDispatcher.handleAuth.mockClear();
});

describe('[#23914] a domain that READS the body refuses the card\'s bodies, with this adapter\'s answer', () => {
  it.each([
    ['step 2 — a truncated query', 'POST', '/data/showcase_account/query', '{"where": {"status": "churned"}'],
    ['step 3 — `{ not json`', 'POST', '/data/showcase_account/query', '{ not json'],
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

describe('[#23914] a domain that FORWARDS the request answers it itself, exactly as before', () => {
  it('the forwarder reads every byte the client sent and answers its own refusal; this adapter adds nothing', async () => {
    const body = '{deliveryId:';
    const res = await send('/webhooks/redeliver', 'POST', 'application/json', body);
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

describe('[#23914] CONTROL — what was readable is handed on as before', () => {
  it.each([
    ['a valid JSON body', 'application/json', '{"where": {"status": "churned"}}', { where: { status: 'churned' } }],
    ['an empty JSON body (an empty query)', 'application/json', '', {}],
    ['a whitespace-only JSON body', 'application/json', '  \n', {}],
    ['a form body', 'application/x-www-form-urlencoded', 'token=abc', {}],
    ['a JSON body sent as text/plain (the content-type-blind read, unchanged)', 'text/plain', '{"a":1}', { a: 1 }],
    ['text that does not declare JSON (unchanged)', 'text/plain', 'hello', {}],
  ])('%s', async (_label, contentType, body, expected) => {
    const res = await send('/data/task/query', 'POST', contentType, body);
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ path: '/data/task/query', read: expected }]);
  });
});

describe('[#23914] both Hono doors answer one unparseable body alike', () => {
  it.each([
    ['a truncated query', '{"where": {"status": "churned"}'],
    ['`{ not json`', '{ not json'],
  ])('%s: the same status and the same body', async (_label, body) => {
    const hosted = await send('/data/showcase_account/query', 'POST', 'application/json', body);

    const server = new HonoHttpServer(0);
    server.post(`${PREFIX}/data/:object/query`, (req, res) => { res.json({ query: req.body }); });
    const direct = await server.getRawApp().fetch(new Request(`http://direct.test${PREFIX}/data/showcase_account/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }));

    expect(direct.status).toBe(hosted.status);
    expect(await direct.json()).toEqual(await expectRefused(hosted, body));
  });
});
