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
 * ## The dispatcher face fails CLOSED on a refused key
 *
 * `HttpDispatcher`'s identity step re-raises only the store outage by brand,
 * so the branded lifecycle refusal is answered there as an anonymous request:
 * the generic 401, the route never runs, and a cookie beside the dead key
 * never answers for it. Pinned so a later change cannot turn that into an
 * admission or a 500.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashApiKey, isAuthzStoreUnavailableError } from '@objectstack/core';
import type { ApiKeyLifecyclePolicy } from '@objectstack/spec/contracts';

import { HttpDispatcher, type HttpDispatcherResult, type HttpProtocolContext } from './http-dispatcher.js';

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

// ── The dispatcher face: a refused key fails CLOSED ──────────────────────────

const KEY = 'osk_dispatcher_lifecycle_pin';
const ROUTE = '/webhooks/redeliver';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function dispatcherWithKey(row: Record<string, unknown>) {
  const keyHash = hashApiKey(KEY);
  const getSession = vi.fn(async ({ headers }: { headers: Headers }) => (
    headers.get('cookie') ? { user: { id: 'u_cookie' }, session: { userId: 'u_cookie' } } : null
  ));
  const objectql = {
    find: vi.fn(async (object: string, q: any) => (
      object === 'sys_api_key' && q?.where?.key === keyHash
        ? [{ id: 'key_1', key: keyHash, prefix: 'osk_dispatch', user_id: 'u_owner', revoked: false, scopes: '[]', ...row }]
        : []
    )),
    update: vi.fn(async () => ({})),
    getObjects: vi.fn().mockReturnValue({}),
    registry: { getObject: vi.fn().mockReturnValue(null), getRegisteredTypes: vi.fn().mockReturnValue([]) },
  };
  const handleRedeliver = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200, headers: JSON_HEADERS }));
  const services: Record<string, unknown> = {
    objectql,
    auth: { isAuthGateActive: () => false, getApi: async () => ({ getSession }), ...policyService() },
    webhooks: { handleRedeliver },
  };
  const kernel: any = {
    getState: () => 'running',
    getService: (n: string) => services[n] ?? null,
    getServiceAsync: async (n: string) => services[n] ?? null,
    context: { getService: (n: string) => services[n] ?? null },
  };
  const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
  (dispatcher as any).domainDeps.logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return { dispatcher, handleRedeliver, getSession };
}

const post = (headers: Record<string, string>) => new Request(`http://tenant.example/api/v1${ROUTE}`, {
  method: 'POST',
  headers: { ...JSON_HEADERS, ...headers },
  body: JSON.stringify({ deliveryId: 'del_1' }),
});
const pctx = (r: Request): HttpProtocolContext => ({ request: r });

describe('[#23367] the dispatcher face fails CLOSED on a key its lifecycle refuses', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it('a revoked key is answered the generic 401, and the route never runs', async () => {
    const { dispatcher, handleRedeliver } = dispatcherWithKey({ revoked: true });
    const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, pctx(post({ 'x-api-key': KEY })));
    expect(result.response?.status).toBe(401);
    expect(handleRedeliver).not.toHaveBeenCalled();
  });

  it('a cookie beside the dead key never answers for it', async () => {
    const { dispatcher, handleRedeliver } = dispatcherWithKey({ expires_at: '2000-01-01T00:00:00.000Z' });
    const result: any = await dispatcher.dispatch(
      'POST', ROUTE, {}, {}, pctx(post({ 'x-api-key': KEY, cookie: 'session=ok' })));
    expect(result.response?.status).toBe(401);
    expect(handleRedeliver).not.toHaveBeenCalled();
  });

  it('control: the same key, live, is served', async () => {
    const { dispatcher, handleRedeliver } = dispatcherWithKey({ expires_at: '2999-01-01T00:00:00.000Z' });
    const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, pctx(post({ 'x-api-key': KEY })));
    expect(result.response?.status).not.toBe(401);
    expect(handleRedeliver).toHaveBeenCalledTimes(1);
  });
});
