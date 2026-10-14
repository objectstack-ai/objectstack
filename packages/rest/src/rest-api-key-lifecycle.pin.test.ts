// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23367, ruling A] The REST face relays the API-key lifecycle refusal.
 *
 * The shared resolver raises the branded `ApiKeyLifecycleRefusalError` for a
 * key that is revoked, expired or inactive. `computeExecCtx` resolves no
 * context for it — so every door keeps the fail-closed answer a dead key has
 * always had — and remembers the refusal beside the request; `enforceAuth`
 * then answers its `403`, its own code and its located message instead of the
 * generic 401.
 *
 * What is pinned, through the real `enforceAuth`:
 *  - revoked, expired and inactive answer three distinct codes;
 *  - the expired answer names the date;
 *  - a cookie beside the dead key never answers for it;
 *  - control: no credential at all is still the generic 401, and a live key
 *    is served.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import { RestServer } from './rest-server.js';

const HTTP_STUB = {
  get: () => {}, post: () => {}, put: () => {}, delete: () => {}, patch: () => {},
  use: () => {}, listen: async () => {}, close: async () => {},
} as any;

const KEY = 'osk_rest_lifecycle_pin';
const OWNER = 'u_key_owner';
const DAY = 86_400_000;

function serverWith(authService: any, ql: any): RestServer {
  return new RestServer(
    HTTP_STUB,
    {} as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    async () => authService,
    async () => ql,
  );
}

function qlWithKey(row: Record<string, unknown>) {
  const tables: Record<string, any[]> = {
    sys_api_key: [{ id: 'key_1', key: hashApiKey(KEY), prefix: 'osk_rest_lif', user_id: OWNER, revoked: false, scopes: '[]', ...row }],
    sys_member: [],
    sys_user: [{ id: OWNER, email: 'owner@example.com' }, { id: 'u_cookie', email: 'cookie@example.com' }],
    sys_user_permission_set: [],
    sys_permission_set: [],
  };
  return {
    find: async (object: string, q: any = {}) => {
      const rows = (tables[object] ?? []).filter((r: any) =>
        Object.entries(q?.where ?? {}).every(([k, v]) => (v !== null && typeof v === 'object' ? true : r[k] === v)));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    update: async () => ({}),
  };
}

/** No gate active; the policy is the ruling's, landed 10 days ago. */
function auth() {
  return {
    isAuthGateActive: () => false,
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        (headers.get('cookie') ? { user: { id: 'u_cookie' } } : null),
    },
    resolveApiKeyLifecyclePolicy: () => ({
      defaultExpiryDays: 90,
      maxExpiryDays: 365,
      inactivityDays: 90,
      startedAt: new Date(Date.now() - 10 * DAY).toISOString(),
    }),
  };
}

async function drive(rest: RestServer, headers: Record<string, string>) {
  const req = { params: {}, query: {}, headers, method: 'GET', path: '/api/v1/data/account' };
  const state: any = { status: 0, body: undefined };
  const res: any = {
    status: (c: number) => { state.status = c; return res; },
    json: (b: any) => { state.body = b; },
    header: () => res, send: () => {},
  };
  const ctx = await rest.resolvePackageRouteExecutionContext(req);
  const blocked = (rest as any).enforceAuth(req, res, ctx);
  return { ctx, blocked, state };
}

describe('[#23367] REST relays the API-key lifecycle refusal through enforceAuth', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it('revoked, expired and inactive answer 403 with three distinct codes', async () => {
    const codes: string[] = [];
    for (const row of [
      { revoked: true },
      { expires_at: '2000-01-01T00:00:00.000Z' },
      { expires_at: '2999-01-01T00:00:00.000Z', last_used_at: new Date(Date.now() - 120 * DAY).toISOString() },
    ]) {
      const r = await drive(serverWith(auth(), qlWithKey(row)), { 'x-api-key': KEY });
      expect(r.ctx).toBeUndefined();
      expect(r.blocked).toBe(true);
      expect(r.state.status).toBe(403);
      codes.push(r.state.body.error.code);
    }
    expect(codes).toEqual(['API_KEY_REVOKED', 'API_KEY_EXPIRED', 'API_KEY_INACTIVE']);
  });

  it('the expired answer names the date', async () => {
    const r = await drive(serverWith(auth(), qlWithKey({ expires_at: '2000-01-01T00:00:00.000Z' })), { 'x-api-key': KEY });
    expect(r.state.body.error.message).toContain('2000-01-01T00:00:00.000Z');
  });

  it('a cookie beside the dead key never answers for it', async () => {
    const r = await drive(serverWith(auth(), qlWithKey({ revoked: true })), { 'x-api-key': KEY, cookie: 'session=ok' });
    expect(r.ctx).toBeUndefined();
    expect(r.state.body.error.code).toBe('API_KEY_REVOKED');
  });

  it('control: no credential is still the generic 401, and a live key is served', async () => {
    const none = await drive(serverWith(auth(), qlWithKey({})), {});
    expect(none.state.status).toBe(401);
    expect(none.state.body.code).toBe('UNAUTHENTICATED');

    const live = await drive(serverWith(auth(), qlWithKey({ expires_at: '2999-01-01T00:00:00.000Z' })), { 'x-api-key': KEY });
    expect(live.ctx?.userId).toBe(OWNER);
    expect(live.blocked).toBe(false);
  });
});
