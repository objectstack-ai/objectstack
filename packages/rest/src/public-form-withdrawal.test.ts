// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21331, ADR-0131 C7] Withdrawing a public form from anonymous intake takes
// effect on every intake door. Both doors (`GET /forms/:slug` and
// `POST /forms/:slug/submit`) read the form in the environment, like every
// other metadata read: environment → code. Until v18 they also read the
// Default Organization's legacy layer; the v18 ceremony carries every
// organization-layer withdrawal onto the environment, fail-closed (rulings A
// on #22008 and #22011; pinned end to end in the cli's
// `organization-ownership-apply.test.ts`), and that read is deleted.
//
// Pinned both sides:
//   - no view read names an organization, whatever the tenancy answers;
//   - withdrawn in the environment: both doors answer 404 FORM_NOT_FOUND and
//     `createData` is never called; published (the control): both accept;
//   - tenancy never registered: the same read;
//   - tenancy registered but unreachable: both doors refuse (fail closed).
//
// A withdrawal is a kill switch: the list holds one item per package of a
// view name, and an explicit withdrawal of the same form (matched by slot or
// by slug, the link kept with a switch cleared) in any of them closes it:
//   - another package's withdrawal of the same view name closes the form;
//   - every package's body open (control): served;
//   - not a withdrawal (the link cleared, a switch merely absent, or another
//     view sharing the slug withdrawn): served;
//   - the form moved to a new slug in one package's body while another's
//     withdraws the old one: still closed.

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
  /** What the environment's read answers. */
  envWide: boolean;
  /** The tenancy provider's behaviour. */
  tenancy: 'org' | 'no-org' | 'not-registered' | 'unreachable';
  /** Replaces the form's whole `sharing` (the `envWide` switch is then ignored). */
  sharing?: Record<string, unknown>;
  /** Replaces the environment's whole view list. */
  envWideViews?: unknown[];
  /** Extra views the read answers alongside the form view. */
  extraViews?: unknown[];
}

function build(setup: Setup) {
  const createData = vi.fn().mockResolvedValue({ object: 'inquiry', id: 'rec_1', record: {} });
  const getMetaItems = vi.fn(async (req: Record<string, unknown> & { type: string }) => {
    if (req.type === 'view') {
      if (setup.envWideViews) return setup.envWideViews;
      return [formView(setup.envWide, setup.sharing), ...(setup.extraViews ?? [])];
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
  it('[ADR-0131 C7] no view read names an organization, whatever the tenancy answers: one environment read per door', async () => {
    const s = build({ envWide: true, tenancy: 'org' });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
    const views = s.getMetaItems.mock.calls.map(([r]) => r).filter((r) => r.type === 'view');
    expect(views).toHaveLength(2);
    for (const r of s.getMetaItems.mock.calls.map(([req]) => req)) {
      expect(Object.keys(r).filter((k) => /organization/i.test(k))).toEqual([]);
    }
  });

  it('withdrawn in the environment: both doors answer FORM_NOT_FOUND and nothing is written', async () => {
    const s = build({ envWide: false, tenancy: 'org' });
    const get = await s.get();
    expect(get.statusCode).toBe(404);
    expect(get.body.code).toBe('FORM_NOT_FOUND');
    const post = await s.post();
    expect(post.statusCode).toBe(404);
    expect(post.body.code).toBe('FORM_NOT_FOUND');
    expect(s.createData).not.toHaveBeenCalled();
  });

  it('published in the environment (control): both doors accept', async () => {
    const s = build({ envWide: true, tenancy: 'org' });
    const get = await s.get();
    expect(get.statusCode).toBe(200);
    expect(get.body.object).toBe('inquiry');
    expect(Object.keys(get.body.objectSchema.fields).sort()).toEqual(['email', 'name']);
    const post = await s.post();
    expect(post.statusCode).toBe(201);
    expect(s.createData).toHaveBeenCalledTimes(1);
  });

  it('withdrawn with no organization to resolve: both doors refuse', async () => {
    const s = build({ envWide: false, tenancy: 'no-org' });
    expect((await s.get()).body.code).toBe('FORM_NOT_FOUND');
    expect((await s.post()).body.code).toBe('FORM_NOT_FOUND');
    expect(s.createData).not.toHaveBeenCalled();
  });

  it('tenancy never registered: the same environment read', async () => {
    const s = build({ envWide: true, tenancy: 'not-registered' });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
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

describe('a public form withdrawal is a kill switch: one package\'s withdrawal of a view name closes its form', () => {
  const expectClosed = async (s: ReturnType<typeof build>) => {
    const get = await s.get();
    expect([get.statusCode, get.body.code]).toEqual([404, 'FORM_NOT_FOUND']);
    const post = await s.post();
    expect([post.statusCode, post.body.code]).toEqual([404, 'FORM_NOT_FOUND']);
    expect(s.createData).not.toHaveBeenCalled();
  };

  // The list read serves one item per package for a name, each carrying its
  // `_packageId`. Known limit (fails closed): the package is not compared, so
  // a withdrawal of a view name closes that name in every package.
  for (const tenancy of ['org', 'no-org'] as const) {
    it(`another package's withdrawal of the same view name closes this package's form (tenancy ${tenancy})`, async () => {
      await expectClosed(build({
        envWide: true, tenancy,
        envWideViews: [{ ...formView(true), _packageId: 'pkg_a' }, { ...formView(false), _packageId: 'pkg_b' }],
      }));
    });
  }

  it('withdrawn through `enabled: false` in another package: closed', async () => {
    const withdrawn = { ...formView(true, { enabled: false, allowAnonymous: true, publicLink: '/forms/contact-us' }), _packageId: 'pkg_b' };
    await expectClosed(build({ envWide: true, tenancy: 'org', envWideViews: [{ ...formView(true), _packageId: 'pkg_a' }, withdrawn] }));
  });

  it('control: every package\'s body of the view name open serves the form', async () => {
    const s = build({
      envWide: true, tenancy: 'org',
      envWideViews: [{ ...formView(true), _packageId: 'pkg_a' }, { ...formView(true), _packageId: 'pkg_b' }],
    });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('not a withdrawal: another package\'s body with the public link cleared leaves the form served', async () => {
    const cleared = { ...formView(true, { enabled: true, allowAnonymous: false }), _packageId: 'pkg_b' };
    const s = build({ envWide: true, tenancy: 'org', envWideViews: [{ ...formView(true), _packageId: 'pkg_a' }, cleared] });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('only an explicit false withdraws: a body with the link, enabled true and allowAnonymous absent closes nothing', async () => {
    const absent = { ...formView(true, { enabled: true, publicLink: '/forms/contact-us' }), _packageId: 'pkg_b' };
    const s = build({ envWide: true, tenancy: 'org', envWideViews: [{ ...formView(true), _packageId: 'pkg_a' }, absent] });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  it('another view withdrawing the same slug does not close this view\'s form', async () => {
    const other = { ...formView(false), name: 'legacy_contact' };
    const s = build({ envWide: true, tenancy: 'org', envWideViews: [formView(true), other] });
    expect((await s.get()).statusCode).toBe(200);
    expect((await s.post()).statusCode).toBe(201);
  });

  for (const link of ['/forms/contact-us-2', '/forms/Contact-Us']) {
    it(`the form moved to a new slug (${link}) in one package, withdrawn at the old one in another: still closed (same slot)`, async () => {
      const slug = link.replace('/forms/', '');
      const moved = { ...formView(true, { enabled: true, allowAnonymous: true, publicLink: link }), _packageId: 'pkg_a' };
      const s = build({ envWide: true, tenancy: 'org', envWideViews: [moved, { ...formView(false), _packageId: 'pkg_b' }] });
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
      // it: this view's open form is still served.
      const other = { ...formView(false), name: 'legacy_contact' };
      const s = build({ envWide: true, tenancy, extraViews: [other] });
      expect((await s.get()).statusCode).toBe(200);
      expect((await s.post()).statusCode).toBe(201);
      expect(s.createData).toHaveBeenCalledTimes(1);
    });
  }
});
