// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16383] `toResponse` returns a `HttpDispatcherResult.result` that IS a
 * `Response` unchanged — its real status, its real body, its real headers.
 *
 * ## The defect
 *
 * `HttpDispatcherResult.result` is DECLARED for direct response objects
 * (`packages/runtime/src/http-dispatcher.ts`: "For flexible return types or
 * direct response objects (Response/NextResponse)"), and the runtime really
 * puts one there — `runtime/src/domains/auth.ts` hands back whatever the auth
 * service answered as `{ handled: true, result: response }`.
 *
 * `toResponse` had no arm for that. It tested `result.type === 'redirect'` and
 * `result.type === 'stream'`, and everything else fell into `c.json(res, 200)`.
 * A Fetch `Response` has no own enumerable properties, so `JSON.stringify` of
 * one is `{}`, and the `200` was a literal:
 *
 *     door answers 404 {"message":"Not found","code":"NOT_FOUND"}
 *     caller reads   200 {}
 *
 * ⭐ The failure direction is what makes this a p1 rather than a cosmetic loss.
 * A discarded status is not a missing answer, it is a WRONG answer that reads
 * as success — `res.ok`, `status === 200` and "nothing threw" all report a
 * refusal as a completed operation — and it DEFEATS fail-closed guards instead
 * of merely missing them: objectui's `MePermissionsProvider.tsx` refuses on
 * `if (!data) return false`, and `{}` is truthy.
 *
 * ⇒ Every case below asserts the real status AND the real body. A pin that
 * asserted only "not 200" would stay green on a repair that answered some other
 * wrong status with the body still destroyed.
 *
 * ## What this file is, and what its sibling is
 *
 * This package's vitest config aliases `@objectstack/runtime` to a stub, so the
 * dispatcher here is a fixture — which is exactly what lets these cases drive
 * `toResponse`'s `result` arm over statuses and body shapes the real
 * composition cannot reach on demand. The other half is a REAL boot, in
 * `packages/qa/http-conformance/src/hono-dispatcher-result-response.conformance.test.ts`:
 * a real `LiteKernel`, the real `HttpDispatcher`, the real `/auth` domain, one
 * wire reading. `@objectstack/hono` has no in-repo consumer (#4117), so that
 * boot is the only thing there is to observe this through; neither file
 * replaces the other.
 *
 * ⛔ Not this card, deliberately untouched: which paths the dispatcher CLAIMS
 * (#16026), WHERE auth is mounted (#16025), and the escaped ADR-0112 envelope
 * on the same function's error exit (#16545).
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
/** A path no explicit mount claims, so it lands on the `${prefix}/*` catch-all. */
const PATH = `${PREFIX}/data/thing`;

const kernel = { name: 'test-kernel' } as any;
const bootApp = (): Hono => createHonoApp({ kernel, prefix: PREFIX });

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('#16383: toResponse passes a `result` that is already a Response through', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatcher.handleAuth.mockResolvedValue({ handled: false });
  });

  // The statuses a door really produces. 200 is carried too: a repair that
  // special-cased "non-200" would leave the success path rebuilt and its body
  // re-serialized, which is the same defect wearing the other sign.
  it.each([200, 201, 302, 400, 401, 403, 404, 409, 422, 500, 503])(
    'a %i Response reaches the caller with that status and its own body',
    async (status) => {
      const body = { message: `answer-${status}`, code: 'DOOR_SAID_SO' };
      mockDispatcher.dispatch.mockResolvedValue({
        handled: true,
        result: jsonResponse(status, body, { 'X-Door': 'dispatcher' }),
      });

      const res = await bootApp().request(`http://localhost${PATH}`, { redirect: 'manual' });

      expect(res.status).toBe(status);
      // ⭐ The body half. `{}` is what the defect produced, and it is TRUTHY —
      // asserting the status alone would pass on a door that still destroys it.
      await expect(res.clone().json()).resolves.toEqual(body);
      await expect(res.clone().text()).resolves.not.toBe('{}');
      expect(res.headers.get('x-door')).toBe('dispatcher');
    },
  );

  it('does not re-serialize — a non-JSON body arrives byte-identical', async () => {
    // `c.json(res, 200)` could not have produced this at all: the body is not
    // JSON and its content-type is not `application/json`. A repair that
    // rebuilt the Response from a parsed body would corrupt both.
    const payload = 'id,name\n1,ada\n';
    mockDispatcher.dispatch.mockResolvedValue({
      handled: true,
      result: new Response(payload, {
        status: 418,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      }),
    });

    const res = await bootApp().request(`http://localhost${PATH}`);

    expect(res.status).toBe(418);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    await expect(res.text()).resolves.toBe(payload);
  });

  it('a bodyless refusal stays bodyless — no `{}` is invented for it', async () => {
    // better-call answers an unrouted path exactly this way, and it is the
    // shape `hono-auth-owned-404.test.ts` calls `unrouted404`.
    mockDispatcher.dispatch.mockResolvedValue({
      handled: true,
      result: new Response(null, { status: 404, statusText: 'Not Found' }),
    });

    const res = await bootApp().request(`http://localhost${PATH}`);

    expect(res.status).toBe(404);
    await expect(res.text()).resolves.toBe('');
  });

  it('the auth mount\'s dispatcher fallback passes one through too', async () => {
    // The second door into `toResponse`: `${prefix}/auth/*` with no auth
    // service on the kernel falls back to `dispatcher.handleAuth`, and
    // `runtime/src/domains/auth.ts` is the very producer that puts a `Response`
    // in `result`. Both callers must render it the same way.
    mockDispatcher.handleAuth.mockResolvedValue({
      handled: true,
      result: jsonResponse(401, { message: 'Unauthorized', code: 'UNAUTHENTICATED' }),
    });

    const res = await bootApp().request(`http://localhost${PREFIX}/auth/get-session`);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ message: 'Unauthorized', code: 'UNAUTHENTICATED' });
  });

  describe('⛔ the arms either side of it are untouched', () => {
    it('a plain object result is still rendered as JSON with 200', async () => {
      // The narrowness control. This is `hono.test.ts`'s "generic result
      // objects with 200 status" case, restated here so a future widening of
      // the passthrough (`typeof res === 'object'`, say) fails in THIS file,
      // next to the reason it must not.
      mockDispatcher.dispatch.mockResolvedValue({ handled: true, result: { foo: 'bar' } });

      const res = await bootApp().request(`http://localhost${PATH}`);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ foo: 'bar' });
    });

    it('a redirect descriptor still redirects', async () => {
      mockDispatcher.dispatch.mockResolvedValue({
        handled: true,
        result: { type: 'redirect', url: 'https://example.com' },
      });

      const res = await bootApp().request(`http://localhost${PATH}`, { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://example.com');
    });

    it('a stream descriptor still streams', async () => {
      mockDispatcher.dispatch.mockResolvedValue({
        handled: true,
        result: {
          type: 'stream',
          events: (async function* () { yield { tick: 1 }; })(),
          contentType: 'text/event-stream',
        },
      });

      const res = await bootApp().request(`http://localhost${PATH}`);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      await expect(res.text()).resolves.toContain('data: {"tick":1}');
    });

    it('the `response` arm — status + body + headers — is unchanged', async () => {
      mockDispatcher.dispatch.mockResolvedValue({
        handled: true,
        response: { status: 201, body: { id: 1 }, headers: { 'X-Custom': 'yes' } },
      });

      const res = await bootApp().request(`http://localhost${PATH}`);

      expect(res.status).toBe(201);
      expect(res.headers.get('x-custom')).toBe('yes');
      await expect(res.json()).resolves.toEqual({ id: 1 });
    });
  });
});
