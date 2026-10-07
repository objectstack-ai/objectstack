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
//
// A withdrawal is a kill switch: an explicit withdrawal of the same form (the
// same view and slot, the link kept with a switch cleared) at any layer the
// doors read closes it, and layering may only narrow intake, never re-open it.
// The doors therefore read the env-wide layer beneath the organization's too:
//   - withdrawn env-wide, re-opened in the organization: both doors refuse;
//   - withdrawn in the organization, open env-wide: both doors refuse;
//   - open in both: both doors accept;
//   - a form only the organization has (no env-wide body): it is served;
//   - not a withdrawal (the link cleared env-wide, a switch merely absent, or
//     another view sharing the slug withdrawn): it is served;
//   - the same view re-pointed at a new slug in the organization: still closed.

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

function formView(allowAnonymous: boolean, sharing?: Record<string, unknown>) {
  return {
    name: 'contact',
    object: 'inquiry',
    viewKind: 'form',
    config: {
      data: { object: 'inquiry' },
      sections: [{ fields: ['name', 'email'] }],
      sharing: sharing ?? { enabled: true, allowAnonymous, publicLink: '/forms/contact-us' },
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
  /** Replaces the form's whole `sharing` on every read (the `envWide`/`inOrg` switch is then ignored). */
  sharing?: Record<string, unknown>;
  /** Replaces the env-wide read's whole view list (the organization read is unchanged). */
  envWideViews?: unknown[];
  /** Extra views every read answers alongside the form view. */
  extraViews?: unknown[];
  /** Replaces the organization read's whole view list (the env-wide read is unchanged). */
  orgViews?: unknown[];
}

function build(setup: Setup) {
  const createData = vi.fn().mockResolvedValue({ object: 'inquiry', id: 'rec_1', record: {} });
  const getMetaItems = vi.fn(async (req: { type: string; organizationId?: string }) => {
    if (req.type === 'view') {
      if (req.organizationId !== ORG && setup.envWideViews) return setup.envWideViews;
      if (req.organizationId === ORG && setup.orgViews) return setup.orgViews;
      const effective = req.organizationId === ORG && setup.inOrg !== undefined ? setup.inOrg : setup.envWide;
      return [formView(effective, setup.sharing), ...(setup.extraViews ?? [])];
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
    async get(slug = 'contact-us') {
      const res = mockRes();
      await resolve.handler({ params: { slug }, query: {}, headers: {} } as any, res);
      return res;
    },
    async post(slug = 'contact-us') {
      const res = mockRes();
      await submit.handler(
        { params: { slug }, query: {}, headers: {}, body: { name: 'x', email: 'x@example.com' } } as any,
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
    // Every read names the organization, except the env-wide view read the
    // kill switch adds beneath the organization's view read.
    const reads = s.getMetaItems.mock.calls.map(([r]) => [r.type, r.organizationId]);
    expect(reads.length).toBeGreaterThan(0);
    for (const [type, organizationId] of reads) {
      if (type !== 'view') expect(organizationId).toBe(ORG);
    }
    // One resolution per door: the organization's view read, then the env-wide one.
    expect(reads.filter(([type]) => type === 'view').map(([, o]) => o)).toEqual([ORG, undefined, ORG, undefined]);
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

describe('either declared switch withdraws a public form from every anonymous door', () => {
  const LINK = '/forms/contact-us';
  const withdrawn: Array<[string, Record<string, unknown>]> = [
    ['enabled: false', { enabled: false, allowAnonymous: true, publicLink: LINK }],
    ['enabled absent (the schema default is false)', { allowAnonymous: true, publicLink: LINK }],
    ['allowAnonymous: false', { enabled: true, allowAnonymous: false, publicLink: LINK }],
    ['both cleared', { enabled: false, allowAnonymous: false, publicLink: LINK }],
  ];
  for (const tenancy of ['org', 'not-registered'] as const) {
    for (const [label, sharing] of withdrawn) {
      it(`${label} (tenancy ${tenancy}): both doors answer 404 FORM_NOT_FOUND and nothing is written`, async () => {
        const s = build({ envWide: true, tenancy, sharing });
        const get = await s.get();
        expect(get.statusCode).toBe(404);
        expect(get.body.code).toBe('FORM_NOT_FOUND');
        const post = await s.post();
        expect(post.statusCode).toBe(404);
        expect(post.body.code).toBe('FORM_NOT_FOUND');
        expect(s.createData).not.toHaveBeenCalled();
      });
    }
    it(`published, enabled and allowAnonymous both true (tenancy ${tenancy}, control): both doors accept`, async () => {
      const s = build({ envWide: false, tenancy, sharing: { enabled: true, allowAnonymous: true, publicLink: LINK } });
      expect((await s.get()).statusCode).toBe(200);
      expect((await s.post()).statusCode).toBe(201);
      expect(s.createData).toHaveBeenCalledTimes(1);
    });
  }
});

describe('a public form withdrawal is a kill switch: layering only narrows intake', () => {
  const expectClosed = async (s: ReturnType<typeof build>) => {
    const get = await s.get();
    expect([get.statusCode, get.body.code]).toEqual([404, 'FORM_NOT_FOUND']);
    const post = await s.post();
    expect([post.statusCode, post.body.code]).toEqual([404, 'FORM_NOT_FOUND']);
    expect(s.createData).not.toHaveBeenCalled();
  };

  it('withdrawn env-wide (allowAnonymous false), re-opened in the organization: both doors refuse', async () => {
    await expectClosed(build({ envWide: false, inOrg: true, tenancy: 'org' }));
  });

  it('withdrawn env-wide through `enabled: false`, re-opened in the organization: both doors refuse', async () => {
    const withdrawn = formView(true, { enabled: false, allowAnonymous: true, publicLink: '/forms/contact-us' });
    await expectClosed(build({ envWide: true, inOrg: true, tenancy: 'org', envWideViews: [withdrawn] }));
  });

  it('not a withdrawal: the public link cleared env-wide leaves the organization\'s open form served', async () => {
    const cleared = formView(true, { enabled: true, allowAnonymous: false });
    const s = build({ envWide: true, inOrg: true, tenancy: 'org', envWideViews: [cleared] });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  // The list reads serve one item per package for a name, each carrying its
  // `_packageId`. Known limit (fails closed): the package is not compared, so
  // a withdrawal of a view name closes that name in every package.
  it('another package\'s withdrawal of the same view name closes this package\'s form too', async () => {
    const openA = { ...formView(true), _packageId: 'pkg_a' };
    await expectClosed(build({
      envWide: true, inOrg: true, tenancy: 'org',
      orgViews: [openA],
      envWideViews: [{ ...formView(true), _packageId: 'pkg_a' }, { ...formView(false), _packageId: 'pkg_b' }],
    }));
  });

  it('control: every package\'s body of the view name open serves the form', async () => {
    const openA = { ...formView(true), _packageId: 'pkg_a' };
    const s = build({
      envWide: true, inOrg: true, tenancy: 'org',
      orgViews: [openA],
      envWideViews: [{ ...formView(true), _packageId: 'pkg_a' }, { ...formView(true), _packageId: 'pkg_b' }],
    });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('the same package\'s withdrawal of the view name closes its form, beside another package\'s open one', async () => {
    const openA = { ...formView(true), _packageId: 'pkg_a' };
    await expectClosed(build({
      envWide: true, inOrg: true, tenancy: 'org',
      orgViews: [openA],
      envWideViews: [{ ...formView(false), _packageId: 'pkg_a' }, { ...formView(true), _packageId: 'pkg_b' }],
    }));
  });

  it('another view withdrawing the same slug env-wide does not close this view\'s form', async () => {
    const other = { ...formView(false), name: 'legacy_contact' };
    const s = build({ envWide: true, inOrg: true, tenancy: 'org', envWideViews: [formView(true), other] });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('withdrawn in the organization, open env-wide: both doors refuse', async () => {
    await expectClosed(build({ envWide: true, inOrg: false, tenancy: 'org' }));
  });

  it('open in both layers (control): both doors accept', async () => {
    const s = build({ envWide: true, inOrg: true, tenancy: 'org' });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
    expect(s.createData).toHaveBeenCalledTimes(1);
  });

  it('a form only the organization carries (no env-wide body, control): both doors accept', async () => {
    const s = build({ envWide: true, inOrg: true, tenancy: 'org', envWideViews: [] });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('only an explicit false withdraws: env-wide link + enabled true with allowAnonymous absent does not close the org\'s open form', async () => {
    const absent = formView(true, { enabled: true, publicLink: '/forms/contact-us' });
    const s = build({ envWide: true, inOrg: true, tenancy: 'org', envWideViews: [absent] });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  for (const link of ['/forms/contact-us-2', '/forms/Contact-Us']) {
    it(`the same view re-pointed at a new slug (${link}) in the organization stays closed`, async () => {
      const slug = link.replace('/forms/', '');
      const s = build({
        envWide: true, inOrg: true, tenancy: 'org', envWideViews: [formView(false)],
        sharing: { enabled: true, allowAnonymous: true, publicLink: link },
      });
      const get = await s.get(slug);
      expect([get.statusCode, get.body.code]).toEqual([404, 'FORM_NOT_FOUND']);
      const post = await s.post(slug);
      expect([post.statusCode, post.body.code]).toEqual([404, 'FORM_NOT_FOUND']);
      expect(s.createData).not.toHaveBeenCalled();
    });
  }

  for (const tenancy of ['org', 'no-org'] as const) {
    it(`two different views sharing a slug in one read do not close each other (tenancy ${tenancy})`, async () => {
      // Another view (another app's form) names the same slug and withdraws
      // it, in every read: this view's open form is still served.
      const other = { ...formView(false), name: 'legacy_contact' };
      const s = build({ envWide: true, tenancy, extraViews: [other], ...(tenancy === 'org' ? { inOrg: true } : {}) });
      expect((await s.get()).statusCode).toBe(200);
      expect((await s.post()).statusCode).toBe(201);
      expect(s.createData).toHaveBeenCalledTimes(1);
    });
  }
});
