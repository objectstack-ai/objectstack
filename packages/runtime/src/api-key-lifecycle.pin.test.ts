// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23367, ruling A] The API-key lifecycle policy on the runtime face.
 *
 * ## The signing door (`POST /keys`)
 *
 *  - a signing that names no `expires_at` gets the policy's default life
 *    (90 days unless configured) — never a permanent key;
 *  - an `expires_at` further away than the ceiling (one year unless
 *    configured) is refused `400 API_KEY_EXPIRY_TOO_LONG`, and nothing is
 *    stored; exactly the ceiling is accepted;
 *  - both numbers are the auth service's (`resolveApiKeyLifecyclePolicy`), so
 *    a changed setting changes the answer;
 *  - a kernel with no `auth` service keeps the pre-policy signing.
 *
 * ## The dispatcher face relays the refusal (ruling A item 3)
 *
 * `HttpDispatcher`'s identity step re-raises the branded lifecycle refusal
 * beside the store outage, so `dispatch()` leaves with it and the transport's
 * error render answers its declared `403` and ledger code — on `POST /keys`,
 * and on the MCP HTTP endpoint (`/api/v1/mcp`), driven through the mounted
 * route. Nothing is minted, and a cookie beside the dead key never answers for
 * it. The relay is by BRAND: an unbranded throw at the same step, even one
 * spelling the same code and status, is still answered as an anonymous
 * request (the generic 401), and so is an unknown key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashApiKey, isApiKeyLifecycleRefusalError, isAuthzStoreUnavailableError } from '@objectstack/core';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ApiErrorSchema } from '@objectstack/spec/api';
import type { ApiKeyLifecyclePolicy } from '@objectstack/spec/contracts';

import { HttpDispatcher, type HttpDispatcherResult, type HttpProtocolContext } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const DAY = 86_400_000;
const NOW = Date.parse('2027-01-01T00:00:00.000Z');

function policyService(over: Partial<ApiKeyLifecyclePolicy> = {}) {
  return {
    resolveApiKeyLifecyclePolicy: (): ApiKeyLifecyclePolicy => ({
      defaultExpiryDays: 90,
      maxExpiryDays: 365,
      inactivityDays: 90,
      ...over,
    }),
  };
}

function signingKernel(auth: unknown) {
  const rows: any[] = [];
  const ql = {
    insert: async (_obj: string, data: any) => {
      rows.push({ id: `key_${rows.length + 1}`, ...data });
      return { id: `key_${rows.length}` };
    },
    find: async () => [],
  };
  const services: Record<string, unknown> = { objectql: ql, auth };
  const kernel: any = {
    getService: (n: string) => services[n],
    getServiceAsync: async (n: string) => {
      const svc = services[n];
      if (svc instanceof Error) throw svc;
      return svc;
    },
  };
  return { kernel, rows };
}

const caller = () => ({
  request: { headers: {} },
  response: {},
  environmentId: undefined,
  executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [] },
});

function responseOf(res: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
  if (!res.response) throw new Error('handleKeys answered no response at all');
  return res.response;
}

describe('[#23367] POST /keys — the default life and the ceiling', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('a signing with no expires_at gets now + 90 days', async () => {
    const { kernel, rows } = signingKernel(policyService());
    const res = responseOf(await new HttpDispatcher(kernel).handleKeys('POST', { name: 'ci' }, caller()));
    const expected = new Date(NOW + 90 * DAY).toISOString();
    expect(res.status).toBe(201);
    expect(rows[0].expires_at).toBe(expected);
    expect(res.body.data.expires_at).toBe(expected);
  });

  it('exactly one year is accepted', async () => {
    const { kernel, rows } = signingKernel(policyService());
    const oneYear = new Date(NOW + 365 * DAY).toISOString();
    const res = responseOf(await new HttpDispatcher(kernel).handleKeys('POST', { expires_at: oneYear }, caller()));
    expect(res.status).toBe(201);
    expect(rows[0].expires_at).toBe(oneYear);
  });

  it('a day past the ceiling is refused 400 API_KEY_EXPIRY_TOO_LONG, and nothing is stored', async () => {
    const { kernel, rows } = signingKernel(policyService());
    const tooFar = new Date(NOW + 366 * DAY).toISOString();
    const res = responseOf(await new HttpDispatcher(kernel).handleKeys('POST', { expires_at: tooFar }, caller()));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('API_KEY_EXPIRY_TOO_LONG');
    // Located: the refusal names the latest date this signing may ask for.
    expect(res.body.error.message).toContain(new Date(NOW + 365 * DAY).toISOString());
    // And the policy that refused it, by the setting's own label, so the
    // admin knows which knob decided (the Create Key dialog's expiry field
    // points at the same setting).
    expect(res.body.error.message).toContain('Maximum key lifetime is 365 days');
    expect(rows).toHaveLength(0);
  });

  it('both numbers are the auth service\'s: a changed setting changes the answer', async () => {
    const short = signingKernel(policyService({ defaultExpiryDays: 7, maxExpiryDays: 30 }));
    const dflt = responseOf(await new HttpDispatcher(short.kernel).handleKeys('POST', {}, caller()));
    expect(dflt.body.data.expires_at).toBe(new Date(NOW + 7 * DAY).toISOString());
    const refused = responseOf(await new HttpDispatcher(short.kernel).handleKeys(
      'POST', { expires_at: new Date(NOW + 31 * DAY).toISOString() }, caller()));
    expect(refused.body.error.code).toBe('API_KEY_EXPIRY_TOO_LONG');
  });

  it('a kernel with no auth service keeps the pre-policy signing', async () => {
    const { kernel, rows } = signingKernel(undefined);
    const res = responseOf(await new HttpDispatcher(kernel).handleKeys('POST', { name: 'x' }, caller()));
    expect(res.status).toBe(201);
    expect(rows[0].expires_at).toBeUndefined();
  });

  it('an auth service that is registered and broken is the outage, never a policy-less mint', async () => {
    const { kernel, rows } = signingKernel(new Error('auth failed to build'));
    const err = await new HttpDispatcher(kernel).handleKeys('POST', { name: 'x' }, caller()).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect(rows).toHaveLength(0);
  });
});

// ── The dispatcher face: the refusal is relayed, by brand ───────────────────

const KEY = 'osk_dispatcher_lifecycle_pin';
/** `/keys` takes its anonymous decision as its first statement (ADR-0138 D2), so it shows what the face resolved. */
const ROUTE = '/keys';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function dispatcherWithKey(row: Record<string, unknown>) {
  const keyHash = hashApiKey(KEY);
  const getSession = vi.fn(async ({ headers }: { headers: Headers }) => (
    headers.get('cookie') ? { user: { id: 'u_cookie' }, session: { userId: 'u_cookie' } } : null
  ));
  const inserted: any[] = [];
  const objectql = {
    find: vi.fn(async (object: string, q: any) => (
      object === 'sys_api_key' && q?.where?.key === keyHash
        ? [{ id: 'key_1', key: keyHash, prefix: 'osk_dispatch', user_id: 'u_owner', revoked: false, scopes: '[]', ...row }]
        : []
    )),
    insert: vi.fn(async (_object: string, data: any) => { inserted.push(data); return { id: 'key_new' }; }),
    update: vi.fn(async (_object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return {};
    }),
    getObjects: vi.fn().mockReturnValue({}),
    registry: { getObject: vi.fn().mockReturnValue(null), getRegisteredTypes: vi.fn().mockReturnValue([]) },
  };
  const services: Record<string, unknown> = {
    objectql,
    auth: { isAuthGateActive: () => false, getApi: async () => ({ getSession }), ...policyService() },
  };
  const kernel: any = {
    getState: () => 'running',
    getService: (n: string) => services[n] ?? null,
    getServiceAsync: async (n: string) => services[n] ?? null,
    context: { getService: (n: string) => services[n] ?? null },
  };
  const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
  (dispatcher as any).domainDeps.logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return { dispatcher, inserted, getSession, kernel };
}

const post = (headers: Record<string, string>) => new Request(`http://tenant.example/api/v1${ROUTE}`, {
  method: 'POST',
  headers: { ...JSON_HEADERS, ...headers },
  body: JSON.stringify({ name: 'minted by a key' }),
});
const pctx = (r: Request): HttpProtocolContext => ({ request: r });

async function rejectionOf(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('[#23367] the dispatcher face relays a key its lifecycle refuses, by brand', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it('a revoked key leaves `dispatch()` as the branded 403 API_KEY_REVOKED, and nothing is minted', async () => {
    const { dispatcher, inserted } = dispatcherWithKey({ revoked: true });
    const err = await rejectionOf(dispatcher.dispatch('POST', ROUTE, { name: 'x' }, {}, pctx(post({ 'x-api-key': KEY }))));
    expect(err, '`dispatch()` RESOLVED — the refusal was absorbed inside the pipeline').toBeDefined();
    expect(isApiKeyLifecycleRefusalError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'API_KEY_REVOKED', status: 403 });
    expect(inserted).toEqual([]);
  });

  it('a cookie beside the dead key never answers for it: 403 API_KEY_EXPIRED, nothing minted', async () => {
    const { dispatcher, inserted } = dispatcherWithKey({ expires_at: '2000-01-01T00:00:00.000Z' });
    const err = await rejectionOf(dispatcher.dispatch(
      'POST', ROUTE, { name: 'x' }, {}, pctx(post({ 'x-api-key': KEY, cookie: 'session=ok' }))));
    expect(err).toMatchObject({ code: 'API_KEY_EXPIRED', status: 403 });
    expect(inserted).toEqual([]);
  });

  it('an UNBRANDED throw at the identity step, even one spelling the same code and status, is still the generic 401', async () => {
    const { dispatcher, inserted } = dispatcherWithKey({ revoked: true });
    const lookalike = Object.assign(new Error('not the brand'), { code: 'API_KEY_REVOKED', status: 403 });
    vi.spyOn(dispatcher as any, 'timedResolveExecutionContext').mockRejectedValue(lookalike);
    const result: any = await dispatcher.dispatch('POST', ROUTE, { name: 'x' }, {}, pctx(post({ 'x-api-key': KEY })));
    expect(result.response?.status).toBe(401);
    expect(result.response?.body?.error?.code).toBe('UNAUTHENTICATED');
    expect(inserted).toEqual([]);
  });

  it('an unknown key is still the generic 401', async () => {
    const { dispatcher, inserted } = dispatcherWithKey({});
    const result: any = await dispatcher.dispatch(
      'POST', ROUTE, { name: 'x' }, {}, pctx(post({ 'x-api-key': 'osk_never_issued' })));
    expect(result.response?.status).toBe(401);
    expect(result.response?.body?.error?.code).toBe('UNAUTHENTICATED');
    expect(inserted).toEqual([]);
  });

  it('control: the same key, live, is served', async () => {
    const { dispatcher, inserted } = dispatcherWithKey({ expires_at: '2999-01-01T00:00:00.000Z' });
    const result: any = await dispatcher.dispatch('POST', ROUTE, { name: 'x' }, {}, pctx(post({ 'x-api-key': KEY })));
    expect(result.response?.status).toBe(201);
    expect(inserted).toHaveLength(1);
  });
});

// ── MCP HTTP, on the wire: the mounted `/api/v1/mcp` route and its render ───

/** A fake `IHttpServer` recording the handlers the plugin mounts. */
function makeFakeServer() {
  const handlers: Record<string, (req: any, res: any) => any> = {};
  const rec = (verb: string) => (path: string, handler: any) => { handlers[`${verb} ${path}`] = handler; };
  return {
    handlers,
    server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
  };
}

async function mountOn(kernel: unknown) {
  const { server, handlers } = makeFakeServer();
  const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
  await plugin.start?.({
    getKernel: () => kernel,
    getService: (n: string) => (n === 'http.server' ? server : undefined),
    environmentId: undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    hook: () => {}, on: () => {},
  } as any);
  return handlers;
}

async function drive(handler: ((req: any, res: any) => any) | undefined, headers: Record<string, string>) {
  expect(handler, 'route must be mounted').toBeTypeOf('function');
  const res: any = {
    statusCode: undefined, body: undefined,
    status(c: number) { res.statusCode = c; return res; },
    header() { return res; },
    json(b: any) { res.body = b; return res; },
    end() { return res; },
  };
  await handler!({ headers, query: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, res);
  return { status: res.statusCode as number, body: res.body };
}

const MCP = 'POST /api/v1/mcp';

describe('[#23367] MCP HTTP answers a dead key with its own 403 and code, on the wire', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it('a revoked key: 403 API_KEY_REVOKED in the declared envelope', async () => {
    const { kernel } = dispatcherWithKey({ revoked: true });
    const handlers = await mountOn(kernel);
    const { status, body } = await drive(handlers[MCP], { 'x-api-key': KEY });
    expect(status).toBe(403);
    expect(body?.success).toBe(false);
    const parsed = ApiErrorSchema.safeParse(body?.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(body?.error?.code).toBe('API_KEY_REVOKED');
  });

  it('an inactive key: 403 API_KEY_INACTIVE', async () => {
    const { kernel } = dispatcherWithKey({
      created_at: '2000-01-01T00:00:00.000Z',
      last_used_at: '2000-01-01T00:00:00.000Z',
      expires_at: '2999-01-01T00:00:00.000Z',
    });
    const handlers = await mountOn(kernel);
    const { status, body } = await drive(handlers[MCP], { 'x-api-key': KEY });
    expect(status).toBe(403);
    expect(body?.error?.code).toBe('API_KEY_INACTIVE');
  });

  it('an unknown key is no lifecycle refusal: it passes the identity step as anonymous, and `POST /keys` answers it the generic 401', async () => {
    const { kernel } = dispatcherWithKey({});
    const handlers = await mountOn(kernel);
    // The fixture registers no MCP service, so the anonymous request reaches
    // the MCP door and is answered there (501), never at the identity step.
    const mcp = await drive(handlers[MCP], { 'x-api-key': 'osk_never_issued' });
    expect(mcp.status).not.toBe(403);
    expect(mcp.body?.error?.code).not.toMatch(/^API_KEY_/);
    const keys = await drive(handlers['POST /api/v1/keys'], { 'x-api-key': 'osk_never_issued' });
    expect(keys.status).toBe(401);
    expect(keys.body?.error?.code).toBe('UNAUTHENTICATED');
  });
});
