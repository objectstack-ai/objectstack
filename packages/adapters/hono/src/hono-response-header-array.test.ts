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

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { Hono } from 'hono';
import { LOCALIZED_ANSWER_VARY } from '@objectstack/types';

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

/**
 * [#38123] `toResponse`'s `response` arm asks #37828's rule of the body it
 * sends: an answer a dispatcher domain caught and composed itself never reaches
 * `thrownJson`, and a `userMessage` in its body is in the caller's language.
 *
 * Each row is the nested ADR-0112 body one of the dispatcher's returning
 * producers composes, written out because this package's `@objectstack/runtime`
 * is a stub (the real producers are driven through their mounted routes in
 * `@objectstack/runtime`'s `dispatcher-plugin.declared-user-message.test.ts`):
 * `errorFromThrown` over the real `recordNotFoundError` for a zh-CN caller, the
 * resume door's `deps.error` and the `/actions` door's `FLOW_FAILED` with an
 * app hook's mark, and the dispatch foot's marked `PERMISSION_DENIED`.
 */
describe('[#38123] the returned answer: a userMessage varies by Accept-Language', () => {
  const ORIG_CORS_ORIGIN = process.env.OS_CORS_ORIGIN;
  afterAll(() => {
    if (ORIG_CORS_ORIGIN === undefined) delete process.env.OS_CORS_ORIGIN;
    else process.env.OS_CORS_ORIGIN = ORIG_CORS_ORIGIN;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatcher.handleAuth.mockResolvedValue({ handled: false });
  });

  const MARK = '该客户名称已被另一位销售代表占用，请联系主管。';
  const refusal = (status: number, code: string, message: string, userMessage?: string) => ({
    handled: true,
    response: {
      status,
      body: { success: false, error: { code, message, httpStatus: status, ...(userMessage !== undefined ? { userMessage } : {}) } },
    },
  });
  const PRODUCERS: Array<[string, number, string, string, string]> = [
    ['errorFromThrown', 404, 'RECORD_NOT_FOUND', 'Record l_nowhere not found in crm_lead', '该记录不存在，或您无权访问它。'],
    ['deps.error, the resume door', 400, 'FLOW_FAILED', "Node 'create_account' failed", MARK],
    ['the /actions door', 400, 'FLOW_FAILED', "Flow 'crm_convert_lead_wizard' failed", MARK],
    ['the dispatch foot', 403, 'PERMISSION_DENIED', 'principal lacks cube_read on pipeline', 'Ask an admin for the Reporting role.'],
  ];
  const varyTokens = (res: Response): string[] =>
    (res.headers.get('vary') ?? '').split(',').map((token) => token.trim()).filter(Boolean);
  const noCors = (): Hono => createHonoApp({ kernel, prefix: PREFIX, cors: false });

  for (const [producer, status, code, message, mark] of PRODUCERS) {
    it(`${producer}: ${status} ${code} with its userMessage on the wire, and Vary: Accept-Language`, async () => {
      mockDispatcher.dispatch.mockResolvedValueOnce(refusal(status, code, message, mark));
      const res = await noCors().request(`http://localhost${PATH}`, { method: 'POST', headers: { 'Accept-Language': 'zh-CN' } });
      const body = await res.json() as any;
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect(body.error.code).toBe(code);
      expect(body.error.userMessage).toBe(mark);
      expect(varyTokens(res)).toEqual([LOCALIZED_ANSWER_VARY]);
    });

    it(`CONTROL ${producer}: the unmarked ${status} gets no Vary`, async () => {
      mockDispatcher.dispatch.mockResolvedValueOnce(refusal(status, code, message));
      const res = await noCors().request(`http://localhost${PATH}`, { method: 'POST' });
      expect(res.status).toBe(status);
      expect(res.headers.get('vary')).toBeNull();
    });
  }

  it('appended, not set: a Vary the route wrote keeps its token beside Accept-Language', async () => {
    const answer = refusal(404, 'RECORD_NOT_FOUND', 'Record l_nowhere not found in crm_lead', '该记录不存在，或您无权访问它。');
    mockDispatcher.dispatch.mockResolvedValueOnce({ ...answer, response: { ...answer.response, headers: { Vary: 'Accept-Encoding' } } });
    const res = await noCors().request(`http://localhost${PATH}`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(varyTokens(res)).toEqual(['Accept-Encoding', LOCALIZED_ANSWER_VARY]);
  });

  it('appended, not set: with CORS on, Origin keeps its place beside Accept-Language', async () => {
    process.env.OS_CORS_ORIGIN = 'https://app.example.com';
    mockDispatcher.dispatch.mockResolvedValueOnce(refusal(404, 'RECORD_NOT_FOUND', 'Record l_nowhere not found in crm_lead', '该记录不存在，或您无权访问它。'));
    const res = await createHonoApp({ kernel, prefix: PREFIX }).request(`http://localhost${PATH}`, {
      method: 'POST',
      headers: { Origin: 'https://app.example.com' },
    });
    expect(res.status).toBe(404);
    expect(varyTokens(res)).toContain(LOCALIZED_ANSWER_VARY);
    expect(varyTokens(res)).toContain('Origin');
  });
});
