// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3963 step 1] `book.audience: 'public'` is a declared capability, so it must
// work on a secure-by-default deployment — not only on one that set
// `requireAuth: false` and opened its entire data plane. The `/meta` umbrella
// gate now lets an ANONYMOUS GET reach the book/doc surface, and the ADR-0046
// §6.7 audience gate inside the handler is what authorizes it.
//
// Every test here runs with `requireAuth: true` (the platform default). The
// interesting assertions are the negative ones: reachability must not leak into
// authorization, and must not leak to any other metadata type.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { httpRequestForRoute } from './http-request-test-builder.js';

const PUBLIC_BOOK = { name: 'manual', label: 'Manual', audience: 'public', groups: [] };
const ORG_BOOK = { name: 'internal', label: 'Internal', audience: 'org', groups: [] };
const GATED_BOOK = { name: 'admin_guide', label: 'Admin Guide', audience: { permissionSet: 'crm_admin' }, groups: [] };
const BOOKS = [PUBLIC_BOOK, ORG_BOOK, GATED_BOOK];

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

/** Secure-by-default: `requireAuth` is ON for every case below. */
function setup() {
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn(async ({ type }: any) => {
      const t = RestServerTypes.singular(String(type ?? ''));
      if (t === 'book') return BOOKS;
      if (t === 'object') return [{ name: 'crm_account' }];
      return [];
    }),
    // The `{ type, name, item }` envelope every read path answers (#5563) —
    // the audience gate reads the book's `audience` from under `item`.
    getMetaItem: vi.fn(async ({ type, name }: any) => ({
      type, name, item: BOOKS.find((b) => b.name === name) ?? { name },
    })),
    saveMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
  };
  const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: true } } as any);
  rest.registerRoutes();
  return { rest, protocol };
}

/** Tiny local mirror of the plural↔singular normalization for the stub. */
const RestServerTypes = {
  singular: (t: string) => (t.endsWith('s') ? t.slice(0, -1) : t),
};

function route(rest: any, method: string, path: string) {
  const r = rest.getRoutes().find((x: any) => x.method === method && x.path === path);
  if (!r) throw new Error(`route not registered: ${method} ${path}`);
  return r;
}

async function call(rest: any, method: string, path: string, params: any, query: any = {}) {
  const res = makeRes();
  await route(rest, method, path).handler({ method, params, query, body: {} }, res);
  return res;
}

const LIST = '/api/v1/meta/:type';
const ITEM = '/api/v1/meta/:type/:name';
const names = (body: any) => {
  const list = Array.isArray(body) ? body : (body?.items ?? []);
  return list.map((b: any) => b?.name).sort();
};

describe('anonymous reachability of the book surface under requireAuth (#3963)', () => {
  it('an anonymous book list is served, filtered down to `public` books only', async () => {
    const { rest } = setup();
    const res = await call(rest, 'GET', LIST, { type: 'book' });

    expect(res.statusCode).toBe(200);
    // `org` and `{ permissionSet }` books are NOT reachable anonymously — the
    // §6.7 gate, not the auth gate, is what removes them.
    expect(names(res.body)).toEqual(['manual']);
  });

  it('works on the plural spelling too', async () => {
    const { rest } = setup();
    const res = await call(rest, 'GET', LIST, { type: 'books' });

    expect(res.statusCode).toBe(200);
    expect(names(res.body)).toEqual(['manual']);
  });

  it('an anonymous read of a `public` book by name is served', async () => {
    const { rest } = setup();
    expect((await call(rest, 'GET', ITEM, { type: 'book', name: 'manual' })).statusCode).toBe(200);
  });

  it('reachability is NOT authorization — org and gated books are still refused', async () => {
    const { rest } = setup();
    expect((await call(rest, 'GET', ITEM, { type: 'book', name: 'internal' })).statusCode).toBe(401);
    expect((await call(rest, 'GET', ITEM, { type: 'book', name: 'admin_guide' })).statusCode).toBe(401);
    // …and on the plural spelling (#3984).
    expect((await call(rest, 'GET', ITEM, { type: 'books', name: 'admin_guide' })).statusCode).toBe(401);
  });
});

describe('the exemption does not widen past book/doc reads (#3963)', () => {
  it('every other metadata type keeps the anonymous deny', async () => {
    const { rest, protocol } = setup();
    const res = await call(rest, 'GET', LIST, { type: 'object' });

    expect(res.statusCode).toBe(401);
    // The handler never ran, so the protocol was never asked for object schemas.
    expect(protocol.getMetaItems).not.toHaveBeenCalled();
  });

  it('the plural spelling of another type is denied too', async () => {
    const { rest } = setup();
    expect((await call(rest, 'GET', LIST, { type: 'objects' })).statusCode).toBe(401);
    expect((await call(rest, 'GET', ITEM, { type: 'objects', name: 'crm_account' })).statusCode).toBe(401);
  });

  it('a WRITE to the book surface is still denied', async () => {
    const { rest, protocol } = setup();
    const put = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === ITEM);
    if (put) {
      const res = makeRes();
      await put.handler(httpRequestForRoute(put, { params: { type: 'book', name: 'manual' }, body: {} }), res);
      expect(res.statusCode).toBe(401);
      expect(protocol.saveMetaItem).not.toHaveBeenCalled();
    }
  });

  it('the type list itself (/meta) stays denied', async () => {
    const { rest } = setup();
    const res = makeRes();
    await route(rest, 'GET', '/api/v1/meta').handler({ method: 'GET', params: {}, query: {}, body: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});
