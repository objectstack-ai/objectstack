// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22576] The `${prefix}/*` catch-all hands `dispatch()` the raw request with
 * its body UNREAD, and the parsed `body` argument it always handed.
 *
 * ## The defect
 *
 * The catch-all read the body with `await c.req.json().catch(() => ({}))` for
 * every `POST` / `PUT` / `PATCH`, whatever its `Content-Type`, and passed
 * `{ request: c.req.raw }` beside it. `c.req.json()` CONSUMES `c.req.raw`, so a
 * domain that forwards the request got one with nothing left in it: measured
 * through `createHonoApp`, `context.request.bodyUsed` was `true` at dispatch,
 * `request.clone().text()` threw, and a spaced JSON body was only available
 * re-serialised from the parsed value. The `/approvals/act` form `POST` (its
 * token rides in the body) and the HMAC-verified inbound hooks (they need the
 * sender's exact bytes) both need what was lost.
 *
 * ## What is pinned, both halves
 *
 *  1. PRESERVATION — the `body` argument is the value the old line produced, for
 *     every input: each case is checked against a reference Hono app that runs
 *     that exact line, and against the literal value written out.
 *  2. THE FIX — at dispatch the request is unread (`bodyUsed === false`) and
 *     reads back the exact bytes the client sent, JSON included.
 *
 * The dispatcher is a fixture here (this package's config aliases
 * `@objectstack/runtime` to a stub). The real boot — the real dispatcher, the
 * real `/approvals/act` domain, the real approvals plugin — is
 * `packages/qa/http-conformance/src/hono-approvals-act.conformance.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

interface Seen { body: unknown; bodyUsed: boolean; text: string }

const seen: Seen[] = [];

/**
 * Record what dispatch() was handed, reading the request as a forwarding
 * domain would. The bytes are decoded with `ignoreBOM` so a byte-order mark the
 * client sent survives into the comparison — `Request.text()` would strip it
 * and make "every byte" a claim about all bytes but one.
 */
async function record(body: unknown, request: Request): Promise<void> {
  const bodyUsed = request.bodyUsed;
  let text = '<unreadable>';
  try {
    text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await request.arrayBuffer());
  } catch { /* recorded as unreadable */ }
  seen.push({ body, bodyUsed, text });
}

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(async (_path: string, _method: string, body: unknown, ctx: { request: Request }) => {
    await record(body, ctx.request);
    return { handled: true, response: { status: 200, body: { ok: true } } };
  }),
  dispatch: vi.fn(async (_method: string, _path: string, body: unknown, _query: unknown, ctx: { request: Request }) => {
    await record(body, ctx.request);
    return { handled: true, response: { status: 200, body: { ok: true } } };
  }),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
const PATH = `${PREFIX}/approvals/act`;
const kernel = { name: 'test-kernel' } as any;

/** The catch-all's body line as it was before #22576 — the reference for "unchanged". */
async function referenceBody(method: string, contentType: string | undefined, text: string): Promise<unknown> {
  let out: unknown;
  const ref = new Hono();
  ref.all('*', async (c) => {
    out = await c.req.json().catch(() => ({}));
    return c.body(null, 204);
  });
  await ref.request('http://ref.test/x', { method, headers: contentType ? { 'Content-Type': contentType } : {}, body: text });
  return out;
}

/** [label, Content-Type, body text, the parsed value the domains are handed] */
const CASES: ReadonlyArray<readonly [string, string | undefined, string, unknown]> = [
  ['spaced JSON object', 'application/json', '{ "a" : 1 ,  "b": [ 1, 2 ] }', { a: 1, b: [1, 2] }],
  ['JSON array', 'application/json', '[1, "two", null]', [1, 'two', null]],
  ['JSON null', 'application/json', 'null', null],
  ['JSON number', 'application/json', '42', 42],
  ['JSON string', 'application/json', '"hi"', 'hi'],
  ['JSON behind a byte-order mark', 'application/json', '\uFEFF{"bom":true}', { bom: true }],
  ['JSON sent as text/plain (the Content-Type was never read)', 'text/plain', '{"a":1}', { a: 1 }],
  ['invalid JSON', 'application/json', '{ not json', {}],
  ['empty body', 'application/json', '', {}],
  ['a form body', 'application/x-www-form-urlencoded', 'token=abc&token=def&x=1', {}],
  ['plain text', 'text/plain', 'hello', {}],
  ['no Content-Type at all', undefined, 'token=abc', {}],
];

beforeEach(() => {
  seen.length = 0;
  mockDispatcher.dispatch.mockClear();
  mockDispatcher.handleAuth.mockClear();
});

describe('[#22576] the catch-all: the parsed body is unchanged, and the raw request arrives unread', () => {
  for (const [label, contentType, text, expected] of CASES) {
    it(`${label}: the same parsed body as before, and every byte still readable on the request`, async () => {
      const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });
      const res = await app.request(`http://hosted.test${PATH}`, {
        method: 'POST',
        headers: contentType ? { 'Content-Type': contentType } : {},
        body: text,
      });
      expect(res.status).toBe(200);
      expect(mockDispatcher.dispatch).toHaveBeenCalledTimes(1);

      const [{ body, bodyUsed, text: forwarded }] = seen;
      // 1. preservation — against the old line itself, and against the value written out
      expect(body).toEqual(await referenceBody('POST', contentType, text));
      expect(body).toEqual(expected);
      // 2. the fix — unread at dispatch, and byte-for-byte what the client sent
      expect(bodyUsed).toBe(false);
      expect(forwarded).toBe(text);
    });
  }

  for (const method of ['PUT', 'PATCH'] as const) {
    it(`${method} is read the same way`, async () => {
      const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });
      const text = '{ "spaced" :  true }';
      await app.request(`http://hosted.test${PREFIX}/data/task/1`, {
        method, headers: { 'Content-Type': 'application/json' }, body: text,
      });
      expect(seen).toEqual([{ body: { spaced: true }, bodyUsed: false, text }]);
    });
  }

  it('GET and DELETE are handed no body, as before, and their requests are untouched', async () => {
    const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });
    await app.request(`http://hosted.test${PATH}?token=abc`);
    await app.request(`http://hosted.test${PREFIX}/data/task/1`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}',
    });
    expect(seen).toEqual([
      { body: undefined, bodyUsed: false, text: '' },
      { body: undefined, bodyUsed: false, text: '{"a":1}' },
    ]);
  });

  it('a body something upstream already read through c.req: the parsed body still arrives, from Hono\'s cache', async () => {
    // The one input a clone cannot be taken from — the raw request is already
    // consumed, and Hono's body cache holds the only copy. The catch-all asks
    // `c.req.json()` exactly as it used to, so nothing a host composed in front
    // of it loses its body.
    const parent = new Hono();
    parent.use('*', async (c, next) => { await c.req.json().catch(() => undefined); await next(); });
    parent.route('/', createHonoApp({ kernel, prefix: PREFIX, cors: false }));

    await parent.request(`http://hosted.test${PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ "upstream": 1 }',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body).toEqual({ upstream: 1 });
    expect(seen[0]!.bodyUsed).toBe(true);
  });
});

describe('[#22576] the /auth/* legacy fallback reads its body the same way', () => {
  it('with no auth service, handleAuth gets the parsed body and an unread request', async () => {
    const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });
    const text = '{ "email" : "a@b.c" }';
    await app.request(`http://hosted.test${PREFIX}/auth/sign-in/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text,
    });
    expect(mockDispatcher.handleAuth).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ body: { email: 'a@b.c' }, bodyUsed: false, text }]);
  });
});
