// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0138 D5] A public form bound to organizations at publish time
// (`sharing.organizations`, by slug) is served on links that name one of them
// (`?organization=SLUG`), and a submission on such a link lands in that
// organization: the door threads its id as the write's `tenantId`. Pinned on
// both doors: each listed organization's link acts in that organization and
// only in it; every other link — naming none, naming an unlisted organization,
// naming a listed slug no organization carries, a repeated parameter — answers
// the unpublished form's answer byte for byte, writes nothing, and (but for the
// listed-slug probe) reads no organization; a bound form is offered on a walled
// posture, and the administrator's read raises no intake warning for it. The
// unbound form keeps ADR-0138 D4 exactly: no organization on the write, and a
// link naming one is refused.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD rather than inside a clocked `it()` body.
import '@objectstack/spec/ui';

const SLUG = 'supplier-registration';
/** The deployment's organizations, by slug, as `sys_organization` holds them. */
const ORGANIZATIONS: Record<string, string> = { acme: 'org_acme', globex: 'org_globex', initech: 'org_initech' };

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

/** A flattened `viewKind: 'form'` item; `organizations` absent is the unbound form. */
const formView = (sharing: Record<string, unknown>) => ({
  name: 'supplier_registration', object: 'supplier', viewKind: 'form', _diagnostics: { valid: true },
  config: {
    data: { object: 'supplier' },
    sections: [{ fields: ['name', 'email'] }],
    sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}`, ...sharing },
  },
});

/** The object as the doors read it: walled by the injected `organization_id`. */
const supplierObject = {
  name: 'supplier', label: 'Supplier',
  fields: {
    organization_id: { type: 'lookup', reference: 'sys_organization' },
    name: { type: 'text', label: 'Name' },
    email: { type: 'text', label: 'Email' },
  },
};

interface Setup {
  posture: 'isolated' | 'single';
  sharing: Record<string, unknown>;
}

function build(setup: Setup) {
  const createData = vi.fn().mockResolvedValue({ object: 'supplier', id: 'rec_1', record: {} });
  const findData = vi.fn(async (req: any) => {
    const slug = req?.query?.where?.slug;
    const id = req?.object === 'sys_organization' && typeof slug === 'string' ? ORGANIZATIONS[slug] : undefined;
    return { object: req?.object, records: id ? [{ id }] : [], hasMore: false };
  });
  const getMetaItems = vi.fn(async (req: { type: string }) => {
    if (req.type === 'view') return [formView(setup.sharing)];
    if (req.type === 'object') return [supplierObject];
    return [];
  });
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems,
    getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: formView(setup.sharing) })),
    createData,
    findData,
  };
  const tenancyServiceProvider = async () => ({
    posture: setup.posture, requestedPosture: setup.posture, defaultOrgId: async () => null,
  });
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
  const drive = async (method: 'GET' | 'POST', query: Record<string, unknown>) => {
    const route = method === 'GET' ? find('GET', '/api/v1/forms/:slug') : find('POST', '/api/v1/forms/:slug/submit');
    const res = mockRes();
    const body = method === 'POST' ? { body: { name: 'Acme Supplies', email: 'sales@example.com' } } : {};
    await route.handler({ params: { slug: SLUG }, query, headers: {}, ...body } as any, res);
    return res;
  };
  return {
    createData, findData, drive,
    async adminRead() {
      const res = mockRes();
      await find('GET', '/api/v1/meta/:type/:name').handler({ params: { type: 'view', name: 'supplier_registration' }, query: {}, headers: {} } as any, res);
      return res;
    },
  };
}

const answer = (res: any): [number, string] => [res.statusCode, JSON.stringify(res.body)];

/** The unpublished form's answer on a door — what every refused link must match byte for byte. */
async function unpublishedAnswer(method: 'GET' | 'POST'): Promise<[number, string]> {
  const s = build({ posture: 'isolated', sharing: { allowAnonymous: false, organizations: ['acme'] } });
  return answer(await s.drive(method, { organization: 'acme' }));
}

const BOUND = { organizations: ['acme', 'globex'] };

describe('[ADR-0138 D5] a bound form acts in the organization its link names', () => {
  it('REFERENCE: the unpublished form answers 404 FORM_NOT_FOUND on both doors', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const [status, body] = await unpublishedAnswer(method);
      expect([status, JSON.parse(body).code]).toEqual([404, 'FORM_NOT_FOUND']);
    }
  });

  for (const posture of ['isolated', 'single'] as const) {
    it.each(['acme', 'globex'])(`'${posture}': the link naming listed '%s' resolves, and the submission lands in that organization only`, async (slug) => {
      const s = build({ posture, sharing: BOUND });
      const get = await s.drive('GET', { organization: slug });
      expect(get.statusCode).toBe(200);
      expect(get.body.object).toBe('supplier');

      const post = await s.drive('POST', { organization: slug });
      expect([post.statusCode, post.body]).toEqual([201, { id: 'rec_1' }]);
      expect(s.createData).toHaveBeenCalledTimes(1);
      const request = s.createData.mock.calls[0][0];
      expect(request.object).toBe('supplier');
      expect(request.context).toEqual({
        publicFormGrant: { object: 'supplier' },
        permissions: ['guest_portal'],
        anonymous: true,
        tenantId: ORGANIZATIONS[slug],
      });
      // The organization is the server's read of the listed slug, as the system.
      expect(s.findData.mock.calls.map(([r]) => [r.object, r.query.where, r.context])).toEqual([
        ['sys_organization', { slug }, { isSystem: true }],
        ['sys_organization', { slug }, { isSystem: true }],
      ]);
    });
  }

  it.each<[string, Record<string, unknown>, boolean]>([
    // ⛔ never the default organization, never the first listed one.
    ['naming no organization', {}, false],
    ['naming an existing organization the form does not list', { organization: 'initech' }, false],
    ['naming a case variant of a listed slug', { organization: 'ACME' }, false],
    ['repeating the parameter', { organization: ['acme', 'globex'] }, false],
    ['naming an empty organization', { organization: '' }, false],
  ])('a bound form\'s link %s: the unpublished answer on both doors, nothing written, no organization read', async (_label, query) => {
    for (const method of ['GET', 'POST'] as const) {
      const s = build({ posture: 'isolated', sharing: BOUND });
      expect(answer(await s.drive(method, query))).toEqual(await unpublishedAnswer(method));
      expect(s.createData).not.toHaveBeenCalled();
      expect(s.findData).not.toHaveBeenCalled();
    }
  });

  it('a listed slug no organization carries: the unpublished answer on both doors, nothing written', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const s = build({ posture: 'isolated', sharing: { organizations: ['acme', 'ghost'] } });
      expect(answer(await s.drive(method, { organization: 'ghost' }))).toEqual(await unpublishedAnswer(method));
      expect(s.createData).not.toHaveBeenCalled();
      expect(s.findData).toHaveBeenCalledTimes(1);
    }
  });

  it('the administrator\'s read raises no intake warning for a bound form on a walled posture', async () => {
    const res = await build({ posture: 'isolated', sharing: BOUND }).adminRead();
    expect(res.statusCode).toBe(200);
    expect(res.body.item._diagnostics).toEqual({ valid: true });
  });

  it('CONTROL: the same form unbound on a walled posture is still not offered, and the admin read says why', async () => {
    const s = build({ posture: 'isolated', sharing: {} });
    for (const method of ['GET', 'POST'] as const) {
      expect(answer(await s.drive(method, {}))).toEqual(await unpublishedAnswer(method));
    }
    expect((await s.adminRead()).body.item._diagnostics.warnings).toHaveLength(1);
  });
});

describe('[ADR-0138 D4, unchanged] the unbound form', () => {
  it('a link naming no organization: served, and the write carries no organization (the engine derives it)', async () => {
    const s = build({ posture: 'single', sharing: {} });
    expect((await s.drive('GET', {})).statusCode).toBe(200);
    expect((await s.drive('POST', {})).statusCode).toBe(201);
    expect(s.createData.mock.calls[0][0].context).toEqual({
      publicFormGrant: { object: 'supplier' },
      permissions: ['guest_portal'],
      anonymous: true,
    });
    expect(s.findData).not.toHaveBeenCalled();
  });

  it('a link naming an organization: the unpublished answer on both doors — never ignored into the default organization', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const s = build({ posture: 'single', sharing: {} });
      expect(answer(await s.drive(method, { organization: 'acme' }))).toEqual(await unpublishedAnswer(method));
      expect(s.createData).not.toHaveBeenCalled();
      expect(s.findData).not.toHaveBeenCalled();
    }
  });
});
