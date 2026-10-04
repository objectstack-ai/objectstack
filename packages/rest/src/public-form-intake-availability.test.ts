// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21476] One predicate decides whether an open public form can take an
// anonymous submission on this deployment, and every door that serves the form
// reads it. On a walled posture a form bound to an object walled by an
// organization column used to be served and then answer `500
// ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` on every submit. Pinned: both doors
// answer the withdrawn form's answer byte for byte and nothing is written; every
// `/forms/` route is one of those doors; the controls are accepted; and the
// administrator's read (both arms) names the reason, inside the validator.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD rather than inside a clocked `it()` body.
import '@objectstack/spec/ui';

const ORG = 'org_alpha';
const SLUG = 'contact-us';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
  res.send = vi.fn(() => res);
  res.end = vi.fn(() => res);
  return res;
}

/** A flattened `viewKind: 'form'` item, as the protocol serves it. */
const formView = (allowAnonymous = true) => ({
  name: 'contact', object: 'inquiry', viewKind: 'form', _diagnostics: { valid: true },
  config: {
    data: { object: 'inquiry' },
    sections: [{ fields: ['name', 'email'] }],
    sharing: { enabled: true, allowAnonymous, publicLink: `/forms/${SLUG}` },
  },
});

/** The bound object as the doors read it: the registry injects `organization_id`. */
const inquiryObject = (tenancyDisabled: boolean) => ({
  name: 'inquiry', label: 'Inquiry', ...(tenancyDisabled ? { tenancy: { enabled: false } } : {}),
  fields: {
    organization_id: { type: 'lookup', reference: 'sys_organization' },
    name: { type: 'text', label: 'Name' },
    email: { type: 'text', label: 'Email' },
  },
});

/** Reproduces the registry's own "never registered" rejection. */
const notRegistered = (): Error => Object.assign(new Error("Service 'tenancy' not found"), {
  __objectstackServiceNotRegistered: true, code: 'SERVICE_NOT_REGISTERED', serviceName: 'tenancy',
});

type Tenancy = 'isolated' | 'group' | 'degraded' | 'single' | 'not-registered';

/** `tenancyDisabled`: the control object (ADR-0066); `allowAnonymous: false`: the withdrawn reference; `cached`: the default admin-read arm. */
interface Setup { tenancy: Tenancy; tenancyDisabled?: boolean; allowAnonymous?: boolean; cached?: boolean }

function build(setup: Setup) {
  const createData = vi.fn().mockResolvedValue({ object: 'inquiry', id: 'rec_1', record: {} });
  const getMetaItems = vi.fn(async (req: { type: string }) => {
    if (req.type === 'view') return [formView(setup.allowAnonymous ?? true)];
    if (req.type === 'object') return [inquiryObject(setup.tenancyDisabled ?? false)];
    return [];
  });
  const getMetaItemCached = vi.fn(async (_req: { cacheRequest: { ifNoneMatch?: string } }) => ({
    data: formView(setup.allowAnonymous ?? true), etag: { value: 'v1', weak: false }, notModified: false,
  }));
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems,
    getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: formView(setup.allowAnonymous ?? true) })),
    getMetaItemCached: setup.cached ? getMetaItemCached : undefined,
    createData,
  };
  const tenancyServiceProvider = async () => {
    switch (setup.tenancy) {
      case 'isolated': return { posture: 'isolated', requestedPosture: 'isolated', defaultOrgId: async () => null };
      case 'group': return { posture: 'group', requestedPosture: 'group', defaultOrgId: async () => null };
      // A walled request the deployment cannot enforce: in force it is `single`.
      case 'degraded': return { posture: 'single', requestedPosture: 'isolated', defaultOrgId: async () => null };
      case 'single': return { posture: 'single', requestedPosture: 'single', defaultOrgId: async () => ORG };
      case 'not-registered': throw notRegistered();
    }
  };
  const rest = new RestServer(
    mockServer() as any, protocol, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    tenancyServiceProvider,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'admin', systemPermissions: ['manage_metadata'] });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)!;
  const formDoors = routes.filter((r) => r.path.includes('/forms/'));
  const drive = async (route: { handler: (req: any, res: any) => any }, method: string) => {
    const res = mockRes();
    const body = method === 'POST' ? { body: { name: 'x', email: 'x@example.com' } } : {};
    await route.handler({ params: { slug: SLUG }, query: {}, headers: {}, ...body } as any, res);
    return res;
  };
  return {
    createData, getMetaItems, getMetaItemCached, formDoors, drive,
    get: () => drive(find('GET', '/api/v1/forms/:slug'), 'GET'),
    post: () => drive(find('POST', '/api/v1/forms/:slug/submit'), 'POST'),
    async adminRead(headers: Record<string, string> = {}) {
      const res = mockRes();
      await find('GET', '/api/v1/meta/:type/:name').handler({ params: { type: 'view', name: 'contact' }, query: {}, headers } as any, res);
      return res;
    },
  };
}

/** What the withdrawn form answers on a door — the shape an unavailable form must match byte for byte. */
async function withdrawnAnswer(door: 'get' | 'post'): Promise<[number, string]> {
  const s = build({ tenancy: 'isolated', allowAnonymous: false });
  const res = await s[door]();
  return [res.statusCode, JSON.stringify(res.body)];
}

const answer = (res: any): [number, string] => [res.statusCode, JSON.stringify(res.body)];

describe('[#21476] a public form that cannot take intake on this posture is not offered', () => {
  it('REFERENCE: the withdrawn form answers 404 FORM_NOT_FOUND on both doors', async () => {
    const [getStatus, getBody] = await withdrawnAnswer('get');
    const [postStatus, postBody] = await withdrawnAnswer('post');
    expect([getStatus, JSON.parse(getBody).code]).toEqual([404, 'FORM_NOT_FOUND']);
    expect([postStatus, JSON.parse(postBody).code]).toEqual([404, 'FORM_NOT_FOUND']);
  });

  // ENUMERATION: the doors are read off the registered routes, not listed by
  // hand, and each door × walled posture is its own row.
  const doors = build({ tenancy: 'isolated' }).formDoors;
  it('ENUMERATION: the routes under /forms/ are exactly the two anonymous form doors', () => {
    expect(doors.map((r) => `${r.method} ${r.path}`).sort())
      .toEqual(['GET /api/v1/forms/:slug', 'POST /api/v1/forms/:slug/submit']);
  });
  for (const door of doors) {
    for (const posture of ['isolated', 'group'] as const) {
      it(`${door.method} ${door.path} · '${posture}', walled object: the withdrawn form's answer byte for byte, nothing written`, async () => {
        const s = build({ tenancy: posture });
        const route = s.formDoors.find((r) => r.method === door.method && r.path === door.path)!;
        const expected = await withdrawnAnswer(door.method === 'POST' ? 'post' : 'get');
        expect(answer(await s.drive(route, door.method))).toEqual(expected);
        expect(s.createData).not.toHaveBeenCalled();
      });
    }
  }

  it('CONTROL: walled posture, object declared tenancy: { enabled: false } — accepted on both doors', async () => {
    const s = build({ tenancy: 'isolated', tenancyDisabled: true });
    const get = await s.get();
    expect(get.statusCode).toBe(200);
    expect(get.body.object).toBe('inquiry');
    expect((await s.post()).statusCode).toBe(201);
    expect(s.createData).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: single posture, walled object — accepted, and the object is not even read for the predicate', async () => {
    const s = build({ tenancy: 'single' });
    expect((await s.post()).statusCode).toBe(201);
    expect(s.getMetaItems.mock.calls.map(([r]) => r.type)).toEqual(['view']);
  });

  it('CONTROL: a degraded walled request reads the posture IN FORCE (single) — accepted', async () => {
    const s = build({ tenancy: 'degraded' });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('CONTROL: no tenancy service registered — no wall the doors can read, accepted', async () => {
    const s = build({ tenancy: 'not-registered' });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });
});

describe('[#21476] the administrator\'s read names why intake is unavailable', () => {
  for (const cached of [false, true]) {
    const arm = cached ? 'cached arm' : 'uncached arm';

    it(`${arm}: walled posture, walled object — a warning located at the form's sharing, naming the reason`, async () => {
      const s = build({ tenancy: 'isolated', cached });
      const res = await s.adminRead();
      expect(res.statusCode).toBe(200);
      const diagnostics = res.body.item._diagnostics;
      expect(diagnostics.valid).toBe(true);
      expect(diagnostics.warnings).toHaveLength(1);
      expect(diagnostics.warnings[0].path).toBe('config.sharing');
      const message: string = diagnostics.warnings[0].message;
      for (const named of [`/forms/${SLUG}`, "'inquiry'", "'organization_id'", "'isolated'", 'tenancy: { enabled: false }']) {
        expect(message).toContain(named);
      }
    });

    it(`${arm}: CONTROL — tenancy-disabled object or single posture, no warning and _diagnostics untouched`, async () => {
      for (const setup of [{ tenancy: 'isolated', tenancyDisabled: true }, { tenancy: 'single' }] as const) {
        const res = await build({ ...setup, cached }).adminRead();
        expect(res.statusCode).toBe(200);
        expect(res.body.item._diagnostics).toEqual({ valid: true });
      }
    });
  }

  it('cached arm: the reason enters the validator — the bare protocol ETag revalidates into the reason, the folded one is 304', async () => {
    const s = build({ tenancy: 'isolated', cached: true });
    const first = await s.adminRead();
    const etag = first.headers.ETag;
    expect(etag).toMatch(/^"v1~[0-9a-f]{8}"$/);
    expect(s.getMetaItemCached).toHaveBeenCalledTimes(1);
    expect(s.getMetaItemCached.mock.calls[0]?.[0].cacheRequest).toEqual({ ifNoneMatch: undefined, ifModifiedSince: undefined });

    const stale = await s.adminRead({ 'if-none-match': '"v1"' });
    expect(stale.statusCode).toBe(200);
    expect(stale.body.item._diagnostics.warnings).toHaveLength(1);

    const fresh = await s.adminRead({ 'if-none-match': etag });
    expect(fresh.statusCode).toBe(304);
  });

  it('cached arm: CONTROL — with no reason the validator is the protocol\'s own, and it still answers 304', async () => {
    const s = build({ tenancy: 'isolated', tenancyDisabled: true, cached: true });
    const first = await s.adminRead();
    expect(first.headers.ETag).toBe('"v1"');
    expect((await s.adminRead({ 'if-none-match': '"v1"' })).statusCode).toBe(304);
  });
});
