// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Does the ADR-0046 §6.7 audience gate survive the PLURAL spelling of the type
// segment? The three gates in rest-server key on the exact singular
// (`req.params.type === 'book'` / `=== 'doc'`), while the protocol's
// `getMetaItems` normalizes singular↔plural and serves either. Prime Directive
// #3 makes plural the canonical REST spelling, so `/meta/books` is the form a
// client is most likely to use.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

const PUBLIC_BOOK = { name: 'manual', label: 'Manual', audience: 'public', groups: [] };
const GATED_BOOK = { name: 'admin_guide', label: 'Admin Guide', audience: { permissionSet: 'crm_admin' }, groups: [] };

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.header = vi.fn(); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
  return res;
}

function setup() {
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', endpoints: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    // The real implementation normalizes singular↔plural, so BOTH spellings
    // resolve to the same items.
    getMetaItems: vi.fn(async ({ type }: any) => {
      const t = String(type ?? '');
      if (t === 'book' || t === 'books') return [PUBLIC_BOOK, GATED_BOOK];
      return [];
    }),
    getMetaItem: vi.fn(async ({ name }: any) => {
      if (name === PUBLIC_BOOK.name) return PUBLIC_BOOK;
      if (name === GATED_BOOK.name) return GATED_BOOK;
      return {};
    }),
    findData: vi.fn().mockResolvedValue([]),
  };
  // requireAuth:false so the anonymous caller reaches the handler at all — the
  // meta routes are otherwise wrapped in the anonymous gate. The audience gate
  // is what is under test, not the auth gate.
  const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  return { rest, protocol };
}

async function getType(rest: any, type: string) {
  const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type');
  if (!route) throw new Error('meta/:type route not registered');
  const res = makeRes();
  await route.handler({ method: 'GET', params: { type }, query: {}, body: {} }, res);
  return res;
}

async function getItem(rest: any, type: string, name: string) {
  const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
  if (!route) throw new Error('meta/:type/:name route not registered');
  const res = makeRes();
  await route.handler({ method: 'GET', params: { type, name }, query: {}, body: {} }, res);
  return res;
}

const names = (body: any) => {
  const list = Array.isArray(body) ? body : (body?.items ?? []);
  return list.map((b: any) => b?.name).sort();
};

describe('ADR-0046 §6.7 audience gate vs the plural type segment', () => {
  it('singular /meta/book hides the permissionSet-gated book from an anonymous caller', async () => {
    const { rest } = setup();
    const res = await getType(rest, 'book');

    expect(res.statusCode).toBe(200);
    expect(names(res.body)).toEqual(['manual']);
  });

  it('plural /meta/books applies the SAME gate', async () => {
    const { rest } = setup();
    const res = await getType(rest, 'books');

    expect(res.statusCode).toBe(200);
    // Before the fix this returned ['admin_guide', 'manual'] — the gated book
    // leaked because the filter only fires on the singular spelling.
    expect(names(res.body)).toEqual(['manual']);
  });

  it('the single-item read is gated on both spellings', async () => {
    const { rest } = setup();
    // A `{ permissionSet }`-gated book is 401 for an anonymous reader —
    // whichever way the type segment is spelled.
    expect((await getItem(rest, 'book', 'admin_guide')).statusCode).toBe(401);
    expect((await getItem(rest, 'books', 'admin_guide')).statusCode).toBe(401);
    // …and the public one is readable either way.
    expect((await getItem(rest, 'book', 'manual')).statusCode).toBe(200);
    expect((await getItem(rest, 'books', 'manual')).statusCode).toBe(200);
  });
});

describe('the same spelling sensitivity on the other per-type gates', () => {
  // The `/meta/:type` handler runs several per-type filters, and every one of
  // them keyed on the literal singular. The app one is an RBAC filter (it hides
  // privileged apps like Studio / Setup and gated nav entries), so the plural
  // spelling skipped an authorization filter, not just a cosmetic one.
  it('the app filter runs on /meta/apps too', async () => {
    const { rest, protocol } = setup();
    protocol.getMetaItems = vi.fn(async ({ type }: any) => {
      const t = String(type ?? '');
      return t === 'app' || t === 'apps' ? [{ name: 'crm' }] : [];
    });
    // The filter needs a resolved context to do RBAC work; with none it must
    // still take the same branch for both spellings (observable via the
    // identical response rather than a leak, since anonymous resolves nothing).
    const singular = await getType(rest, 'app');
    const plural = await getType(rest, 'apps');
    expect(plural.statusCode).toBe(singular.statusCode);
    expect(names(plural.body)).toEqual(names(singular.body));
  });
});
