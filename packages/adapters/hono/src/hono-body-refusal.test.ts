// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23914] `createHonoApp` refuses a declared JSON body that does not parse
 * with `400 INVALID_REQUEST`, before `dispatch()` runs — and answers it with
 * the same status and body as `@objectstack/plugin-hono-server`.
 *
 * The catch-all used to hand `dispatch()` `{}` for such a body, which the data
 * domain read as an empty query (every row) or an empty update (a `200` for a
 * write that changed nothing).
 *
 * The dispatcher is a fixture (this package's config aliases
 * `@objectstack/runtime` to a stub); what is pinned is what this adapter hands
 * it, or that it hands it nothing. `@objectstack/plugin-hono-server` resolves
 * to its source here (`vitest.config.ts`), so the parity case drives that
 * package's real request path, not a copy of it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

const dispatched: unknown[] = [];

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(async (_path: string, _method: string, body: unknown) => {
    dispatched.push(body);
    return { handled: true, response: { status: 200, body: { ok: true } } };
  }),
  dispatch: vi.fn(async (_method: string, _path: string, body: unknown) => {
    dispatched.push(body);
    return { handled: true, response: { status: 200, body: { ok: true } } };
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
  dispatched.length = 0;
  mockDispatcher.dispatch.mockClear();
  mockDispatcher.handleAuth.mockClear();
});

describe('[#23914] the catch-all refuses the card\'s bodies, and dispatch() never runs', () => {
  it.each([
    ['step 2 — a truncated query', 'POST', '/data/showcase_account/query', '{"where": {"status": "churned"}'],
    ['step 3 — `{ not json`', 'POST', '/data/showcase_account/query', '{ not json'],
    ['step 5 — a truncated PATCH', 'PATCH', '/data/showcase_account/rec_1', '{"name": "HACKED"'],
    ['step 6 — a truncated create', 'POST', '/data/showcase_account', '{"name": "Door Truncated Create"'],
    ['a truncated PUT', 'PUT', '/meta/object/account', '{"name": "account"'],
  ])('%s', async (_label, method, path, body) => {
    await expectRefused(await send(path, method, 'application/json', body), body);
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('a declared JSON media type is matched case-insensitively', async () => {
    await expectRefused(await send('/data/task/query', 'POST', 'Application/JSON; charset=utf-8', '{ not json'), '{ not json');
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('the /auth/* legacy fallback refuses the same body the same way', async () => {
    await expectRefused(await send('/auth/sign-in/email', 'POST', 'application/json', '{"email": "a@b.c"'), '{"email": "a@b.c"');
    expect(mockDispatcher.handleAuth).not.toHaveBeenCalled();
  });
});

describe('[#23914] CONTROL — what was readable is handed on as before', () => {
  it.each([
    ['a valid JSON body', 'application/json', '{"where": {"status": "churned"}}', { where: { status: 'churned' } }],
    ['an empty JSON body (an empty query)', 'application/json', '', {}],
    ['a whitespace-only JSON body', 'application/json', '  \n', {}],
    ['a form body (the /approvals/act POST reads its own bytes)', 'application/x-www-form-urlencoded', 'token=abc', {}],
    ['a JSON body sent as text/plain (the content-type-blind read, unchanged)', 'text/plain', '{"a":1}', { a: 1 }],
    ['text that does not declare JSON (unchanged)', 'text/plain', 'hello', {}],
  ])('%s', async (_label, contentType, body, expected) => {
    const res = await send('/data/task/query', 'POST', contentType, body);
    expect(res.status).toBe(200);
    expect(dispatched).toEqual([expected]);
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
