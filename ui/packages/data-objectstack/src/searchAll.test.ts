/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

/** A fetch mock that answers discovery + records the global-search GET. */
function makeFetch(searchResponse: { ok: boolean; status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: any }> = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/search')) {
      return {
        ok: searchResponse.ok,
        status: searchResponse.status ?? (searchResponse.ok ? 200 : 400),
        statusText: searchResponse.ok ? 'OK' : 'Error',
        json: async () => searchResponse.body,
      } as any;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as any;
  });
  return { fetchImpl, calls };
}

const WAYNE_HITS = {
  query: 'Wayne',
  hits: [
    { object: 'crm_account', id: 'a1', title: 'Wayne Enterprises', snippet: 'Wayne Enterprises', record: { id: 'a1', account_number: 'ACC-000005' } },
    { object: 'crm_opportunity', id: 'o1', title: 'Wayne Q1 Expansion', record: { id: 'o1' } },
  ],
};

describe('ObjectStackAdapter.searchAll', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('GETs /api/v1/search?q= and returns normalized ranked hits', async () => {
    const { fetchImpl, calls } = makeFetch({ ok: true, body: WAYNE_HITS });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', token: 'tok_123', autoReconnect: false, fetch: fetchImpl as any });

    const result = await adapter.searchAll('Wayne');

    expect(result.query).toBe('Wayne');
    expect(result.hits.map((h) => `${h.object}:${h.id}`)).toEqual(['crm_account:a1', 'crm_opportunity:o1']);
    expect(result.hits[0].title).toBe('Wayne Enterprises');
    expect(result.hits[0].record).toEqual({ id: 'a1', account_number: 'ACC-000005' });

    const get = calls.find((c) => c.url.includes('/api/v1/search'))!;
    const url = new URL(get.url);
    expect(url.pathname).toBe('/api/v1/search');
    expect(url.searchParams.get('q')).toBe('Wayne');
    expect(get.init.method).toBe('GET');
    expect(get.init.headers.Authorization).toBe('Bearer tok_123');
  });

  it('trims the query and forwards limit + objects scoping', async () => {
    const { fetchImpl, calls } = makeFetch({ ok: true, body: { query: 'Wayne', hits: [] } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

    await adapter.searchAll('  Wayne  ', { limit: 12, objects: ['crm_account', 'crm_opportunity'] });

    const url = new URL(calls.find((c) => c.url.includes('/api/v1/search'))!.url);
    expect(url.searchParams.get('q')).toBe('Wayne');
    expect(url.searchParams.get('limit')).toBe('12');
    expect(url.searchParams.get('objects')).toBe('crm_account,crm_opportunity');
  });

  it('short-circuits an empty query without hitting the network', async () => {
    const { fetchImpl, calls } = makeFetch({ ok: true, body: { query: '', hits: [] } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });

    const result = await adapter.searchAll('   ');

    expect(result).toEqual({ query: '', hits: [] });
    expect(calls.some((c) => c.url.includes('/api/v1/search'))).toBe(false);
  });

  it('unwraps a { success, data } envelope', async () => {
    const { fetchImpl } = makeFetch({ ok: true, body: { success: true, data: WAYNE_HITS } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    const result = await adapter.searchAll('Wayne');
    expect(result.hits).toHaveLength(2);
  });

  it('treats a 404 (search plugin absent) as an empty result, not an error', async () => {
    const { fetchImpl } = makeFetch({ ok: false, status: 404, body: { message: 'not found' } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    await expect(adapter.searchAll('Wayne')).resolves.toEqual({ query: 'Wayne', hits: [] });
  });

  it('throws with the server message on a non-404 error', async () => {
    const { fetchImpl } = makeFetch({ ok: false, status: 500, body: { error: { message: 'index unavailable' } } });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    await expect(adapter.searchAll('Wayne')).rejects.toThrow(/index unavailable/);
  });

  // objectui#9594 -- this ladder shares `readErrorEnvelope` with
  // `exportDownload`, so the flat `{ code, error: <string> }` dialect that used
  // to collapse into `res.statusText` reaches the caller here too. Wiring pin
  // for the second of the four hoisted sites; the dialect logic itself is
  // exhausted in `error-envelope.test.ts`.
  it('reads the flat `{ code, error: <string> }` dialect instead of the status word', async () => {
    const { fetchImpl } = makeFetch({
      ok: false,
      status: 403,
      body: { code: 'PERMISSION_DENIED', error: 'Search is not permitted for this user' },
    });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    await expect(adapter.searchAll('Wayne')).rejects.toMatchObject({
      message: 'Search is not permitted for this user',
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  });

  it('drops malformed hits (missing object or id)', async () => {
    const { fetchImpl } = makeFetch({
      ok: true,
      body: { query: 'x', hits: [
        { object: 'crm_account', id: 'a1', title: 'Keep' },
        { id: 'no_object' },
        { object: 'crm_lead' },
        null,
        { object: 'crm_contact', record: { id: 'c9' } },
      ] },
    });
    const adapter = new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
    const result = await adapter.searchAll('x');
    expect(result.hits.map((h) => `${h.object}:${h.id}`)).toEqual(['crm_account:a1', 'crm_contact:c9']);
  });
});
