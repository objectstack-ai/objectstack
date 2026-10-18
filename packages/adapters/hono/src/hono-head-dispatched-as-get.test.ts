// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24245] A `HEAD` reaches `dispatch()` as the `GET` it is answered from.
 *
 * Hono answers a `HEAD` from the `GET` route — it routes the request as `GET`
 * and keeps that answer's status and headers with no body — but `c.req.method`
 * still reads `HEAD`, and the catch-all handed that straight to `dispatch()`.
 * Every dispatcher domain decides its verb by comparing it with `'GET'`, so a
 * `HEAD` was not answered as its `GET` on this host (`HEAD /api/v1/mcp/skill`:
 * `405` with `Allow: GET` while `GET` served the skill). The standalone server
 * hands `dispatch()` a literal `'GET'` for the same request.
 *
 * What is pinned here, with the dispatcher a fixture (this package's config
 * aliases `@objectstack/runtime` to a stub):
 *  1. the verb `dispatch()` receives for `HEAD` is `GET`, and the request
 *     beside it is still the client's `HEAD` — only the verb moves;
 *  2. the `HEAD` answer is the `GET` answer's status and headers with no body,
 *     a stream result and a `405` with `Allow` alike;
 *  3. every other verb reaches `dispatch()` as it was sent;
 *  4. the auth arm's `/auth/config` branch answers a `HEAD` as its `GET`.
 *
 * The same rows through the REAL dispatcher and both doors are
 * `packages/qa/http-conformance/src/hono-head-as-get.conformance.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Seen { method: string; path: string; requestMethod: string }
const seen: Seen[] = [];

/** What the fixture dispatcher answers, per sub-path. */
function answer(path: string): any {
  if (path === '/mcp/skill') {
    // The `/mcp/skill` domain's result shape (`runtime/src/domains/mcp.ts`).
    return {
      handled: true,
      result: {
        type: 'stream',
        status: 200,
        contentType: 'text/markdown; charset=utf-8',
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': 'inline; filename="SKILL.md"',
          'cache-control': 'no-store',
        },
        events: (async function* () { yield '# skill'; })(),
      },
    };
  }
  if (path === '/keys') {
    return {
      handled: true,
      response: {
        status: 405,
        headers: { Allow: 'POST' },
        body: { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed — use POST', httpStatus: 405 } },
      },
    };
  }
  return { handled: true, response: { status: 200, body: { success: true, data: { path } } } };
}

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(async () => ({ handled: true, response: { status: 200, body: { ok: true } } })),
  dispatch: vi.fn(async (method: string, path: string, _body: unknown, _query: unknown, ctx: { request: Request }) => {
    seen.push({ method, path, requestMethod: ctx.request.method });
    return answer(path);
  }),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
const kernel = { name: 'test-kernel' } as any;

/** Headers a transport adds on its own, independent of the route. */
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding']);
async function snapshot(res: Response) {
  return {
    status: res.status,
    headers: [...res.headers.entries()].filter(([k]) => !TRANSPORT_HEADERS.has(k)),
    body: await res.text(),
  };
}

beforeEach(() => {
  seen.length = 0;
  mockDispatcher.dispatch.mockClear();
  mockDispatcher.handleAuth.mockClear();
});

describe('[#24245] the catch-all dispatches a HEAD as GET', () => {
  it('HEAD /mcp/skill: dispatch() receives GET beside the client\'s HEAD request, and the answer is the GET\'s with no body', async () => {
    const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });

    const head = await snapshot(await app.request(`http://hosted.test${PREFIX}/mcp/skill`, { method: 'HEAD' }));
    const get = await snapshot(await app.request(`http://hosted.test${PREFIX}/mcp/skill`));

    expect(seen).toEqual([
      { method: 'GET', path: '/mcp/skill', requestMethod: 'HEAD' },
      { method: 'GET', path: '/mcp/skill', requestMethod: 'GET' },
    ]);
    expect(get.status).toBe(200);
    expect(get.body).not.toBe('');
    expect(head.status).toBe(200);
    expect(head.headers).toEqual(get.headers);
    expect(head.headers.find(([k]) => k === 'content-type')?.[1]).toContain('text/markdown');
    expect(head.body).toBe('');
  });

  it('HEAD on a path whose GET is refused: the GET\'s 405 and its Allow, no body', async () => {
    const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });

    const getRes = await app.request(`http://hosted.test${PREFIX}/keys`);
    const getBody = (await getRes.clone().json()) as { error: { code: string; httpStatus: number } };
    const get = await snapshot(getRes);
    const head = await snapshot(await app.request(`http://hosted.test${PREFIX}/keys`, { method: 'HEAD' }));

    expect(get.status).toBe(405);
    expect(getBody.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(getBody.error.httpStatus).toBe(405);
    expect(head.status).toBe(405);
    expect(head.headers).toContainEqual(['allow', 'POST']);
    expect(head.headers).toEqual(get.headers);
    expect(head.body).toBe('');
    expect(seen.map((s) => s.method)).toEqual(['GET', 'GET']);
  });

  it('every other verb reaches dispatch() as it was sent', async () => {
    const app = createHonoApp({ kernel, prefix: PREFIX, cors: false });

    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      await app.request(`http://hosted.test${PREFIX}/data/task`, { method });
    }
    expect(seen.map((s) => [s.method, s.requestMethod])).toEqual([
      ['GET', 'GET'],
      ['POST', 'POST'],
      ['PUT', 'PUT'],
      ['PATCH', 'PATCH'],
      ['DELETE', 'DELETE'],
      ['OPTIONS', 'OPTIONS'],
    ]);
  });
});

describe('[#24245] the auth arm answers HEAD /auth/config as its GET', () => {
  it('the public config\'s status and headers with no body, and better-auth is not asked', async () => {
    const handleRequest = vi.fn(async () => new Response('{"message":"Not found"}', { status: 404 }));
    const authKernel = {
      getServiceAsync: vi.fn().mockResolvedValue({
        getPublicConfig: () => ({ features: { sso: false } }),
        handleRequest,
        ownsRoute: async () => false,
      }),
    } as any;
    const app = createHonoApp({ kernel: authKernel, prefix: PREFIX, cors: false });

    const get = await snapshot(await app.request(`http://hosted.test${PREFIX}/auth/config`));
    const head = await snapshot(await app.request(`http://hosted.test${PREFIX}/auth/config`, { method: 'HEAD' }));

    expect(get.status).toBe(200);
    expect(JSON.parse(get.body)).toEqual({ success: true, data: { features: { sso: false } } });
    expect(head.status).toBe(200);
    expect(head.headers).toEqual(get.headers);
    expect(head.body).toBe('');
    expect(handleRequest).not.toHaveBeenCalled();
  });
});
