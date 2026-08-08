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
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    // The real implementation normalizes singular↔plural, so BOTH spellings
    // resolve to the same items.
    getMetaItems: vi.fn(async ({ type }: any) => {
      const t = String(type ?? '');
      if (t === 'book' || t === 'books') return [PUBLIC_BOOK, GATED_BOOK];
      return [];
    }),
    // `getMetaItem` answers the `{ type, name, item }` envelope on every read
    // path (#5563); the audience gate reads `audience` off the document under
    // `item`, so a double that flattened it would test nothing.
    getMetaItem: vi.fn(async ({ type, name }: any) => {
      if (name === PUBLIC_BOOK.name) return { type, name, item: PUBLIC_BOOK };
      if (name === GATED_BOOK.name) return { type, name, item: GATED_BOOK };
      return { type, name };
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
  // `headers` is not optional dressing: the cached branch reads
  // `req.headers['if-none-match']`, so a request object without it would throw
  // its way into a 400 and read as "the gate denied" for the wrong reason.
  await route.handler({ method: 'GET', params: { type, name }, query: {}, body: {}, headers: {} }, res);
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

// ---------------------------------------------------------------------------
// [#6241] The same gate, one branch further in: the CACHED read path.
//
// Everything above tests a protocol double with no `getMetaItemCached`, so the
// single-item read always fell through to the uncached branch — the branch that
// holds the §6.7 gate. A real deployment does not look like that: `enableCache`
// defaults to `true` and the metadata protocol ships `getMetaItemCached`, so the
// DEFAULT single-item read took the cached branch, whose entry condition
// excluded `doc` / `book` by LITERAL comparison against the raw `:type` segment:
//
//     … && req.params.type !== 'doc' && req.params.type !== 'book'
//
// `/meta/books/:name` is the canonical spelling (Prime Directive #3) and the
// route serves it, so the plural read walked past the exclusion, took the cached
// branch, and the audience gate never ran. Measured on the real `RestServer`
// before the fix — one `{ permissionSet }`-gated book, one signed-in caller who
// holds no set:
//
//     singular "book"  :: cachedCalls=0 status=[403] PERMISSION_DENIED
//     plural   "books" :: cachedCalls=1 status=[]    full gated body served
//
// That is #3984's defect recurring in the same file, and it is why the fix
// normalizes once at the top of the handler instead of adding a third correctly
// normalized comparison beside two wrong ones.
//
// The trade this pins: `docs` / `books` plural reads now leave the cached
// branch, so they carry no ETag. Same trade #5881 made for `dashboard`, on a
// harder reason — the comment above the exclusion has always said a shared ETag
// over a per-caller-gated document leaks it across viewers, and
// `getMetaItemCached` delegates to `getMetaItem`, so only the 304's saved bytes
// are given up.
// ---------------------------------------------------------------------------
describe('#6241 — the cached branch cannot be spelled around either', () => {
  /** A doc the gated book claims by rule, plus one no book claims. */
  const ADMIN_DOC = { name: 'admin_runbook', label: 'Runbook' };
  const OPEN_DOC = { name: 'intro', label: 'Intro' };
  const CLAIMING_GATED_BOOK = {
    name: 'admin_guide',
    label: 'Admin Guide',
    audience: { permissionSet: 'crm_admin' },
    groups: [{ key: 'admin', label: 'Admin', include: 'admin_*' }],
  };
  /** A type with no per-caller gate at all — the positive control's subject. */
  const VIEW_ITEM = { name: 'account_list', label: 'Accounts' };

  /**
   * The DEFAULT deployment shape: no `metadata` block at all (so `enableCache`
   * is its default `true`) and a protocol offering BOTH reads, so which branch
   * the handler picks is the thing under test rather than an artefact of a
   * double that only implements one.
   */
  function setupCached() {
    const protocol: any = {
      getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
      getMetaTypes: vi.fn().mockResolvedValue([]),
      getMetaItems: vi.fn(async ({ type }: any) => {
        const t = String(type ?? '');
        if (t === 'book' || t === 'books') return [PUBLIC_BOOK, CLAIMING_GATED_BOOK];
        if (t === 'doc' || t === 'docs') return [ADMIN_DOC, OPEN_DOC];
        return [];
      }),
      getMetaItem: vi.fn(async ({ type, name }: any) => {
        const all: any[] = [PUBLIC_BOOK, CLAIMING_GATED_BOOK, ADMIN_DOC, OPEN_DOC, VIEW_ITEM];
        const item = all.find((i) => i.name === name);
        return item ? { type, name, item } : { type, name };
      }),
      // Present and eligible — exactly what a default deployment has, and what
      // every test above this line was missing. It answers the UNFILTERED
      // document with an ETag over it, which is the leak the exclusion exists
      // to prevent.
      getMetaItemCached: vi.fn(async ({ name }: any) => ({
        data: [PUBLIC_BOOK, CLAIMING_GATED_BOOK, ADMIN_DOC, OPEN_DOC, VIEW_ITEM]
          .find((i) => i.name === name),
        etag: { value: 'etag-unfiltered', weak: false },
        cacheControl: { directives: ['private', 'no-cache'] },
        notModified: false,
      })),
      findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    // A signed-in caller who holds no permission set — the 403 case, not the
    // anonymous 401 one, so the pin cannot pass by accident on the auth gate.
    rest.resolveExecCtx = async () => ({ userId: 'u1' });
    rest.securityServiceProvider = async () => ({ resolvePermissionSetNames: async () => [] });
    rest.registerRoutes();
    return { rest, protocol };
  }

  it('a {permissionSet}-gated book is 403 on the PLURAL spelling, not 200', async () => {
    const { rest, protocol } = setupCached();
    const res = await getItem(rest, 'books', 'admin_guide');

    // Before the fix: 200 with `{ item: { audience: { permissionSet: … } } }`.
    expect(res.statusCode).toBe(403);
    expect(res.body?.code ?? res.body?.error?.code).toBe('PERMISSION_DENIED');
    // …and it got there by NOT taking the cached branch, which is the actual
    // mechanism — asserting only the status would leave a fix that gated the
    // cached body under an unfiltered ETag looking correct.
    expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
  });

  it('the singular spelling keeps denying it — no regression on the path that worked', async () => {
    const { rest, protocol } = setupCached();
    const res = await getItem(rest, 'book', 'admin_guide');

    expect(res.statusCode).toBe(403);
    expect(protocol.getMetaItemCached).not.toHaveBeenCalled();
  });

  it('a doc claimed only by the gated book is 403 on /meta/docs/:name too', async () => {
    // §6.7 effective audience: the union over the books claiming the doc. The
    // gated book's `include: admin_*` rule claims `admin_runbook`, so a
    // non-holder is denied — on either spelling.
    const { rest, protocol } = setupCached();
    const plural = await getItem(rest, 'docs', 'admin_runbook');
    expect(plural.statusCode).toBe(403);
    expect(protocol.getMetaItemCached).not.toHaveBeenCalled();

    const singular = await getItem(rest, 'doc', 'admin_runbook');
    expect(singular.statusCode).toBe(403);
  });

  it('an unclaimed doc still reads (org default) — the gate narrows, it does not close the surface', async () => {
    const { rest } = setupCached();
    // `intro` is claimed by no book → effective audience `org` → a signed-in
    // caller may read it. Without this the three assertions above would be
    // satisfied by a fix that denied every doc/book read.
    expect((await getItem(rest, 'docs', 'intro')).statusCode).toBe(200);
    expect((await getItem(rest, 'books', 'manual')).statusCode).toBe(200);
  });

  it('positive control: a non-gated type still takes the cached branch, ETag and all', async () => {
    // The bypass is only correct if it bypasses exactly the gated types. A fix
    // that disabled the cache wholesale would satisfy every assertion above and
    // silently cost every other metadata read its validator.
    const { rest, protocol } = setupCached();
    const res = await getItem(rest, 'views', 'account_list');

    expect(protocol.getMetaItemCached).toHaveBeenCalledTimes(1);
    expect(protocol.getMetaItem).not.toHaveBeenCalled();
    expect(res.header.mock.calls.map((c: any[]) => c[0])).toContain('ETag');

    // …and the singular spelling of that same non-gated type, so the fix is
    // "normalize", not "move the doc/book hole onto some other type".
    const { rest: rest2, protocol: protocol2 } = setupCached();
    await getItem(rest2, 'view', 'account_list');
    expect(protocol2.getMetaItemCached).toHaveBeenCalledTimes(1);
  });

  it('the price of the bypass, pinned rather than hidden: gated reads carry no ETag', async () => {
    const { rest } = setupCached();
    const res = await getItem(rest, 'books', 'manual');

    expect(res.statusCode).toBe(200);
    expect(res.header.mock.calls.map((c: any[]) => c[0])).not.toContain('ETag');
  });
});
