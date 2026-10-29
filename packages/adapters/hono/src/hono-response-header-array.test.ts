// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27506] `toResponse` emits a `string[]` header value as one header line
 * per element, on the `response` arm and on the `stream` arms.
 *
 * `HttpDispatcherResult.response.headers` accepts `string | string[]` since
 * #27506: the `/actions` door relays a forwarded target's credential rotation,
 * and `/admin/impersonate-user` answers several `Set-Cookie` lines. This
 * adapter used to cast every value `as string` — an array reaches `c.header`
 * as its `toString()`, one comma-joined line, which a browser parses as ONE
 * cookie whose value contains the others. These cases pin the repeated line.
 *
 * Same harness as `hono-result-response-passthrough.test.ts`: the dispatcher
 * is a fixture, so the arms can be driven with exactly the header shapes the
 * real door produces.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Hono } from 'hono';

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(),
  dispatch: vi.fn(),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
const PATH = `${PREFIX}/actions/sys_user/impersonate_user`;

const kernel = { name: 'test-kernel' } as any;
const bootApp = (): Hono => createHonoApp({ kernel, prefix: PREFIX });

const COOKIES = [
  'better-auth.session_token=new; Path=/; HttpOnly',
  'better-auth.admin_session=adm; Path=/; HttpOnly',
];

const setCookieLines = (res: Response): string[] =>
  typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : [];

describe('#27506: a string[] header value is one header line per element', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatcher.handleAuth.mockResolvedValue({ handled: false });
  });

  it('`response.headers` — every Set-Cookie line reaches the caller separately, a string value as before', async () => {
    mockDispatcher.dispatch.mockResolvedValue({
      handled: true,
      response: {
        status: 200,
        body: { success: true, data: { ok: true } },
        headers: { 'set-cookie': COOKIES, 'set-auth-token': 'tok_impersonated' },
      },
    });

    const res = await bootApp().request(`http://localhost${PATH}`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(setCookieLines(res)).toEqual(COOKIES);
    expect(res.headers.get('set-auth-token')).toBe('tok_impersonated');
    await expect(res.json()).resolves.toEqual({ success: true, data: { ok: true } });
  });

  it('`result.type: stream` with a raw stream — array headers append, strings set', async () => {
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: x\n\n')); controller.close(); },
    });
    mockDispatcher.dispatch.mockResolvedValue({
      handled: true,
      result: { type: 'stream', stream, headers: { 'set-cookie': COOKIES, 'x-one': 'line' } },
    });

    const res = await bootApp().request(`http://localhost${PATH}`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(setCookieLines(res)).toEqual(COOKIES);
    expect(res.headers.get('x-one')).toBe('line');
  });

  it('`result.type: stream` with event frames — array headers append on the built Headers', async () => {
    mockDispatcher.dispatch.mockResolvedValue({
      handled: true,
      result: {
        type: 'stream',
        events: (async function* () { yield { type: 'text', value: 'hi' }; })(),
        headers: { 'set-cookie': COOKIES, 'x-one': 'line' },
      },
    });

    const res = await bootApp().request(`http://localhost${PATH}`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(setCookieLines(res)).toEqual(COOKIES);
    expect(res.headers.get('x-one')).toBe('line');
  });
});
