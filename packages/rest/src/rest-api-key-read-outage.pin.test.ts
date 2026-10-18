// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24299] The REST data door answers a `sys_api_key` read that REJECTS as the
 * store outage — `503 SERVICE_UNAVAILABLE`, the answer a session caller
 * already got for the same fault — on the real `GET /api/v1/data/:object`.
 *
 * Measured on the unrepaired tree through this harness, `sys_api_key` reads
 * rejecting and every other table healthy:
 *
 *   caller                          | before                      | after
 *   --------------------------------|-----------------------------|------------------------
 *   key only                        | 401 UNAUTHENTICATED         | 503 SERVICE_UNAVAILABLE
 *   key + another user's cookie     | 200, served AS the cookie's | 503, the service is
 *                                   | user                        | never called
 *   session only                    | 200 as the cookie's user    | unchanged
 *
 * The middle row is the defect's worse half: `resolveApiKeyAdmission` answered
 * the failed read "no key", so the request fell on to the session arm and a
 * credential the caller did not lead with answered for it.
 *
 * Controls: a healthy key is served as its owner, and a NEVER-PROVISIONED
 * `sys_api_key` stays "no key" (the anonymous floor's 401), the boundary the
 * 2026-08-30 ruling (option A) draws.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import { RestServer } from './rest-server.js';

const KEY = 'osk_rest_read_outage_pin';
const KEY_OWNER = 'u_key_owner';
const COOKIE_USER = 'u_cookie';
const DATA_COLLECTION = '/api/v1/data/:object';

type KeyRead = 'healthy' | 'rejects' | 'unprovisioned';

/** Equality and `$in` — the two shapes the resolver's reads use here; any other operator is refused, never matched. */
function matchesWhere(row: any, where: any): boolean {
  for (const [field, cond] of Object.entries(where ?? {})) {
    if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!(cond as any).$in.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

function makeQl(keyRead: KeyRead) {
  const tables: Record<string, any[]> = {
    sys_api_key: [{ id: 'key_1', key: hashApiKey(KEY), user_id: KEY_OWNER, revoked: false, scopes: '[]' }],
    sys_member: [],
    sys_user: [{ id: KEY_OWNER }, { id: COOKIE_USER }],
    sys_user_permission_set: [],
    sys_permission_set: [],
  };
  return {
    find: async (object: string, q: any = {}) => {
      if (object === 'sys_api_key' && keyRead === 'rejects') throw new Error('connection terminated unexpectedly');
      if (object === 'sys_api_key' && keyRead === 'unprovisioned') throw new Error('no such table: sys_api_key');
      const rows = (tables[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    update: async () => ({}),
  };
}

/** The single-kernel wiring: an auth provider whose session read answers the cookie's user, and the objectql provider. */
function setup(keyRead: KeyRead) {
  const servedAs: Array<string | undefined> = [];
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn(async (r: any) => { servedAs.push(r?.context?.userId); return { value: [], total: 0 }; }),
  };
  const server: any = {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
  const authServiceProvider = async () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => (
        headers.get('cookie') ? { user: { id: COOKIE_USER }, session: { userId: COOKIE_USER } } : null
      ),
    },
  });
  const ql = makeQl(keyRead);
  const rest = new RestServer(server, protocol, {} as any, undefined, undefined, undefined, authServiceProvider, async () => ql);
  rest.registerRoutes();
  return { rest, servedAs };
}

async function get(rest: any, headers: Record<string, string>) {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.header = () => res; res.setHeader = () => {}; res.write = () => {}; res.end = () => {}; res.send = () => {};
  const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === DATA_COLLECTION);
  if (!route) throw new Error(`GET ${DATA_COLLECTION} route not registered`);
  await route.handler({ method: 'GET', path: '/api/v1/data/account', params: { object: 'account' }, query: {}, headers }, res);
  return { status: res.statusCode as number, body: res.body };
}

// This file silences the REST fault log it does not assert on, so it declares the level it runs at.
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); warnSpy.mockRestore(); });

describe('[#24299] REST data door — a rejecting sys_api_key read is the store outage', () => {
  it('key only: 503 SERVICE_UNAVAILABLE, not the anonymous floor\'s 401', async () => {
    const { rest, servedAs } = setup('rejects');
    const { status, body } = await get(rest, { 'x-api-key': KEY });
    expect(status).toBe(503);
    expect(body?.code).toBe('SERVICE_UNAVAILABLE');
    expect(servedAs).toEqual([]);
  });

  it('key + another user\'s cookie: 503, and the request is never served as the cookie\'s user', async () => {
    const { rest, servedAs } = setup('rejects');
    const { status, body } = await get(rest, { 'x-api-key': KEY, cookie: 'session=other-user' });
    expect(status).toBe(503);
    expect(body?.code).toBe('SERVICE_UNAVAILABLE');
    expect(servedAs, 'the data service was called — a credential the caller did not lead with answered').toEqual([]);
  });

  it('session only: unchanged — the same fault does not touch a caller who sends no key', async () => {
    const { rest, servedAs } = setup('rejects');
    const { status } = await get(rest, { cookie: 'session=other-user' });
    expect(status).toBe(200);
    expect(servedAs).toEqual([COOKIE_USER]);
  });

  it('control: a healthy key read is served as the key\'s owner, cookie or not', async () => {
    const { rest, servedAs } = setup('healthy');
    expect((await get(rest, { 'x-api-key': KEY })).status).toBe(200);
    expect((await get(rest, { 'x-api-key': KEY, cookie: 'session=other-user' })).status).toBe(200);
    expect(servedAs).toEqual([KEY_OWNER, KEY_OWNER]);
  });

  it('control: a never-provisioned sys_api_key is still "no key" — the anonymous floor\'s 401', async () => {
    const { rest, servedAs } = setup('unprovisioned');
    const { status, body } = await get(rest, { 'x-api-key': KEY });
    expect(status).toBe(401);
    expect(body?.code).toBe('UNAUTHENTICATED');
    expect(servedAs).toEqual([]);
  });
});
