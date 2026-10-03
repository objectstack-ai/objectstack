// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21331] Withdrawing a public form from anonymous intake takes effect on
// every intake door. Both doors (`GET /forms/:slug` and
// `POST /forms/:slug/submit`) read the form in the organization the request
// belongs to: the tenancy service's `defaultOrgId()`. That is the same
// organization whose overlay the administrator's editor shows. A withdrawal
// saved in that organization therefore closes both doors, and nothing is
// written.
//
// Pinned both sides:
//   - withdrawn in the organization: both doors answer 404 FORM_NOT_FOUND and
//     `createData` is never called;
//   - published in the organization (the control): both doors accept, and
//     every metadata read the doors make names that organization;
//   - withdrawn env-wide with no organization to resolve: both doors refuse;
//   - tenancy never registered: the env-wide read, unchanged;
//   - tenancy registered but unreachable: both doors refuse (fail closed).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD rather than inside a clocked `it()` body.
import '@objectstack/spec/ui';

const ORG = 'org_alpha';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.header = vi.fn(() => res);
  res.end = vi.fn(() => res);
  return res;
}

function formView(allowAnonymous: boolean) {
  return {
    name: 'contact',
    object: 'inquiry',
    viewKind: 'form',
    config: {
      data: { object: 'inquiry' },
      sections: [{ fields: ['name', 'email'] }],
      sharing: { allowAnonymous, publicLink: '/forms/contact-us' },
    },
  };
}

const inquiryObject = {
  name: 'inquiry',
  label: 'Inquiry',
  fields: {
    name: { type: 'text', label: 'Name' },
    email: { type: 'text', label: 'Email' },
  },
};

/** Reproduces the registry's own "never registered" rejection. */
function notRegistered(): Error {
  return Object.assign(new Error("Service 'tenancy' not found"), {
    __objectstackServiceNotRegistered: true,
    code: 'SERVICE_NOT_REGISTERED',
    serviceName: 'tenancy',
  });
}

interface Setup {
  /** What the env-wide (organization-less) read answers. */
  envWide: boolean;
  /** What the organization read answers; `undefined` = no overlay there. */
  inOrg?: boolean;
  /** The tenancy provider's behaviour. */
  tenancy: 'org' | 'no-org' | 'not-registered' | 'unreachable';
}

function build(setup: Setup) {
  const createData = vi.fn().mockResolvedValue({ object: 'inquiry', id: 'rec_1', record: {} });
  const getMetaItems = vi.fn(async (req: { type: string; organizationId?: string }) => {
    if (req.type === 'view') {
      const effective = req.organizationId === ORG && setup.inOrg !== undefined ? setup.inOrg : setup.envWide;
      return [formView(effective)];
    }
    if (req.type === 'object') return [inquiryObject];
    return [];
  });
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems,
    createData,
  };
  const tenancyServiceProvider = async () => {
    switch (setup.tenancy) {
      case 'org': return { posture: 'single', defaultOrgId: async () => ORG };
      case 'no-org': return { posture: 'single', defaultOrgId: async () => null };
      case 'not-registered': throw notRegistered();
      case 'unreachable': throw new Error('tenancy service failed to construct');
    }
  };
  const rest = new RestServer(
    mockServer() as any, protocol, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    tenancyServiceProvider,
  );
  rest.registerRoutes();
  const find = (method: string, suffix: string) =>
    rest.getRoutes().find((r) => r.method === method && r.path.endsWith(suffix))!;
  const resolve = find('GET', '/forms/:slug');
  const submit = find('POST', '/forms/:slug/submit');
  return {
    createData,
    getMetaItems,
    async get() {
      const res = mockRes();
      await resolve.handler({ params: { slug: 'contact-us' }, query: {}, headers: {} } as any, res);
      return res;
    },
    async post() {
      const res = mockRes();
      await submit.handler(
        { params: { slug: 'contact-us' }, query: {}, headers: {}, body: { name: 'x', email: 'x@example.com' } } as any,
        res,
      );
      return res;
    },
  };
}

describe('[#21331] public form withdrawal reaches every intake door', () => {
  it('withdrawn in the organization: both doors answer FORM_NOT_FOUND and nothing is written', async () => {
    const s = build({ envWide: true, inOrg: false, tenancy: 'org' });
    const get = await s.get();
    expect(get.statusCode).toBe(404);
    expect(get.body.code).toBe('FORM_NOT_FOUND');
    const post = await s.post();
    expect(post.statusCode).toBe(404);
    expect(post.body.code).toBe('FORM_NOT_FOUND');
    expect(s.createData).not.toHaveBeenCalled();
  });

  it('published in the organization (control): both doors accept, every read names the organization', async () => {
    const s = build({ envWide: true, inOrg: true, tenancy: 'org' });
    const get = await s.get();
    expect(get.statusCode).toBe(200);
    expect(get.body.object).toBe('inquiry');
    expect(Object.keys(get.body.objectSchema.fields).sort()).toEqual(['email', 'name']);
    const post = await s.post();
    expect(post.statusCode).toBe(201);
    expect(s.createData).toHaveBeenCalledTimes(1);
    const reads = s.getMetaItems.mock.calls.map(([r]) => [r.type, r.organizationId]);
    expect(reads.length).toBeGreaterThan(0);
    for (const [, organizationId] of reads) expect(organizationId).toBe(ORG);
  });

  it('an organization overlay that publishes a form the package withdrew is honoured too', async () => {
    const s = build({ envWide: false, inOrg: true, tenancy: 'org' });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('withdrawn env-wide with no organization to resolve: both doors refuse', async () => {
    const s = build({ envWide: false, tenancy: 'no-org' });
    expect((await s.get()).body.code).toBe('FORM_NOT_FOUND');
    expect((await s.post()).body.code).toBe('FORM_NOT_FOUND');
    expect(s.createData).not.toHaveBeenCalled();
    for (const [r] of s.getMetaItems.mock.calls) expect(r.organizationId).toBeUndefined();
  });

  it('tenancy never registered: the env-wide read, unchanged', async () => {
    const s = build({ envWide: true, inOrg: false, tenancy: 'not-registered' });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
    for (const [r] of s.getMetaItems.mock.calls) expect(r.organizationId).toBeUndefined();
  });

  it('tenancy registered but unreachable: both doors refuse instead of reading env-wide (fail closed)', async () => {
    const s = build({ envWide: true, tenancy: 'unreachable' });
    const get = await s.get();
    expect(get.statusCode).toBe(500);
    expect(get.body.code).toBe('FORM_RESOLVE_FAILED');
    const post = await s.post();
    expect(post.statusCode).toBe(503);
    expect(post.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(s.createData).not.toHaveBeenCalled();
    expect(s.getMetaItems).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'view' }));
  });
});
