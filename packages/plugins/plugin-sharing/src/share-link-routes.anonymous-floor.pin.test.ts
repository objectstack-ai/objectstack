// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 D2 — the share-link family answers an anonymous caller with the
 * platform's shared `401 UNAUTHENTICATED`, in the dispatcher's standard
 * envelope, on every route but the two token routes, before any of the family's
 * own logic runs (#24024).
 *
 * ## What was open
 *
 * The published v18 text (changeset `23225-domain-floor-anonymous-deny`) says
 * "`/share-links`: `401 UNAUTHENTICATED` on the create, list and revoke faces
 * and on every path the domain does not serve", and that the refusal is "the
 * dispatcher's standard envelope … with the shared message every other
 * dispatcher domain answers with". On a standalone server this family is the
 * `/share-links` surface, and it kept neither half: create, list and revoke
 * each answered 401 with a sentence of their own and no `error.httpStatus`,
 * and no route answered a verb or path the five did not serve, so the adapter
 * did (405 or 404). The decision now sits in the family's door, once, and a
 * per-verb catch-all registered last puts every other request in front of it.
 *
 * ## The census comes from the registration, not from a list typed here
 *
 * Every route is captured off a mock `IHttpServer` as `registerShareLinkRoutes`
 * registers it, and every captured route is driven. A route added to the family
 * later is driven anonymously the day it lands: through the door it answers 401
 * and this file stays green; mounted on `http` directly, past the door, it
 * reaches the service and this file goes red.
 *
 * ## What each refusal asserts
 *
 * The ADR-0112 envelope — `status`, `error.code` and `error.httpStatus` — the
 * shared message (the published text names it, so its identity is the
 * contract: the exported constant, never a copy), no `data`, and a service and
 * engine that were never called. A bare `toThrow()` would be no pin: the
 * family never threw, it ANSWERED.
 *
 * ## Controls
 *
 * A floor that refused everybody would pass every refusal here. So the two
 * token routes are driven anonymously and reach the token, and every route is
 * driven signed in: the serving routes are served as before, and the catch-all
 * answers the family's own 404 without reaching anything.
 *
 * Which router registration serves which concrete request is the router's
 * question, not this file's: the wire half is
 * `runtime/src/share-links-every-path.hono.integration.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { registerShareLinkRoutes } from './share-link-routes.js';
import type { ShareLinkService } from './share-link-service.js';
import type { SharingEngine } from './sharing-service.js';

const BASE = '/api/v1/share-links';
const TOKEN_ROUTES = new Set([`GET ${BASE}/:token/resolve`, `GET ${BASE}/:token/messages`]);

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

const LINK_ROW = {
  id: 'sl_1',
  token: 'tok_abcdefgh',
  object_name: 'ai_conversations',
  record_id: 'conv_1',
  permission: 'view',
  audience: 'anyone',
  expires_at: null,
  label: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

/** A service and engine that would SUCCEED on every route, recording every call. */
function mount(ctx: ExecutionContext) {
  const service = {
    createLink: vi.fn(async () => ({ ...LINK_ROW })),
    listLinks: vi.fn(async () => [{ ...LINK_ROW }]),
    revokeLink: vi.fn(async () => undefined),
    resolveToken: vi.fn(async () => ({ link: { ...LINK_ROW }, redactFields: [] })),
  };
  const engine = {
    find: vi.fn(async () => [{ id: 'conv_1' }]),
    getSchema: vi.fn(() => undefined),
    insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
  const http = new MockHttp();
  registerShareLinkRoutes(http, service as unknown as ShareLinkService, engine as unknown as SharingEngine, {
    contextFromRequest: () => ctx,
  });
  const calls = () => [
    ...Object.entries(service).filter(([, fn]) => fn.mock.calls.length > 0).map(([n]) => `service.${n}`),
    ...(engine.find.mock.calls.length > 0 ? ['engine.find'] : []),
  ];
  return { http, calls };
}

/** A concrete request for each registered pattern. */
function requestFor(key: string): IHttpRequest {
  const method = key.slice(0, key.indexOf(' '));
  const pattern = key.slice(key.indexOf(' ') + 1);
  const params: Record<string, string> = {};
  let path = pattern;
  if (path.includes(':idOrToken')) {
    params.idOrToken = 'sl_1';
    path = path.replace(':idOrToken', 'sl_1');
  }
  if (path.includes(':token')) {
    params.token = 'tok_abcdefgh';
    path = path.replace(':token', 'tok_abcdefgh');
  }
  path = path.replace('*', 'abc/def');
  return {
    params,
    query: {},
    body: method === 'POST' ? { object: 'ai_conversations', recordId: 'conv_1' } : undefined,
    headers: {},
    method,
    path,
  } as unknown as IHttpRequest;
}

async function drive(http: MockHttp, key: string) {
  const handler = http.routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res: IHttpResponse = {
    json: vi.fn((data: any) => { captured.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  await handler(requestFor(key), res);
  return captured;
}

const census = [...mount({}).http.routes.keys()];
const floored = census.filter((key) => !TOKEN_ROUTES.has(key));

describe('the share-link census — read off the registration', () => {
  it('registers the five serving routes and one catch-all per verb, registered last', () => {
    expect(census).toEqual([
      `POST ${BASE}`,
      `GET ${BASE}`,
      `DELETE ${BASE}/:idOrToken`,
      `GET ${BASE}/:token/resolve`,
      `GET ${BASE}/:token/messages`,
      `GET ${BASE}/*`,
      `POST ${BASE}/*`,
      `PUT ${BASE}/*`,
      `PATCH ${BASE}/*`,
      `DELETE ${BASE}/*`,
    ]);
  });
});

describe('ADR-0138 D2 floor — an anonymous caller is refused 401 on every route but the token routes', () => {
  // Both anonymous shapes the plugin's resolver can hand the door: nothing at
  // all (an unresolvable request), and an envelope with no user in it.
  const ANONYMOUS: Array<[string, ExecutionContext]> = [
    ['an empty context', {}],
    ['a context with no user', { isSystem: false, tenantId: 't_1' }],
  ];
  for (const [name, ctx] of ANONYMOUS) {
    it.each(floored)(`%s · ${name} → 401 in the dispatcher's envelope, nothing reached`, async (key) => {
      const { http, calls } = mount(ctx);
      const answer = await drive(http, key);
      expect(answer.status).toBe(ANONYMOUS_DENY_STATUS);
      expect(answer.body?.success).toBe(false);
      expect(answer.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
      expect(answer.body?.error?.httpStatus).toBe(ANONYMOUS_DENY_STATUS);
      expect(answer.body?.error?.message).toBe(ANONYMOUS_DENY_MESSAGE);
      expect(answer.body?.data).toBeUndefined();
      expect(calls()).toEqual([]);
    });
  }

  it.each([...TOKEN_ROUTES])('%s · anonymous → admitted by the floor and judged by the token', async (key) => {
    const { http, calls } = mount({});
    const answer = await drive(http, key);
    expect(answer.status).toBe(200);
    expect(answer.body?.success).toBe(true);
    expect(calls()).toContain('service.resolveToken');
  });
});

describe('CONTROL — a signed-in caller is not refused by the floor', () => {
  it.each(census)('%s · signed in → served, or the catch-all\'s own 404', async (key) => {
    const { http, calls } = mount({ userId: 'u_1', tenantId: 't_1' });
    const answer = await drive(http, key);
    if (key.endsWith('/*')) {
      expect(answer.status).toBe(404);
      expect(answer.body?.success).toBe(false);
      expect(answer.body?.error?.code).toBe('ENDPOINT_NOT_FOUND');
      expect(calls()).toEqual([]);
      return;
    }
    expect(answer.status).toBe(key === `POST ${BASE}` ? 201 : 200);
    expect(answer.body?.success).toBe(true);
    expect(calls().length).toBeGreaterThan(0);
  });
});
