// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3022] Anonymous public-form routes (ADR-0056 Option A) — server-managed
// anchor enforcement. The submit route must never accept `owner_id` /
// `organization_id` / audit columns from a visitor: not via an explicit
// section declaration, and not via the zero-declared-sections fallback that
// previously merged the raw body wholesale (the insert-forge of #3004, but
// with no credentials at all). The resolve/lookup routes must agree with the
// submit boundary so a form never collects what the submit refuses.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

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

/** A public FormView in the flattened registered shape (one item per view). */
function formView(sections: any[]) {
  return {
    name: 'ticket_form',
    object: 'ticket',
    viewKind: 'form',
    config: {
      data: { object: 'ticket' },
      sections,
      sharing: { allowAnonymous: true, publicLink: '/forms/test' },
    },
  };
}

const ticketObject = {
  name: 'ticket',
  label: 'Ticket',
  fields: {
    id: { type: 'text' },
    subject: { type: 'text', label: 'Subject' },
    email: { type: 'text', label: 'Email' },
    status: { type: 'select', label: 'Status' },
    owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
    organization_id: { type: 'lookup', reference: 'sys_organization', label: 'Organization' },
    created_at: { type: 'datetime', label: 'Created At' },
    created_by: { type: 'lookup', reference: 'sys_user', label: 'Created By' },
  },
};

function buildServer(sections: any[]) {
  const createData = vi.fn().mockResolvedValue({ object: 'ticket', id: 'rec_1', record: {} });
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', endpoints: {} }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn(async ({ type }: { type: string }) => {
      if (type === 'view') return [formView(sections)];
      if (type === 'object') return [ticketObject];
      return [];
    }),
    createData,
  };
  const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  const find = (method: string, suffix: string) =>
    rest.getRoutes().find((r) => r.method === method && r.path.endsWith(suffix))!;
  return {
    createData,
    resolve: find('GET', '/forms/:slug'),
    submit: find('POST', '/forms/:slug/submit'),
    lookup: find('GET', '/forms/:slug/lookup/:field'),
  };
}

const FORGED = {
  id: 'rec_forged',
  owner_id: 'usr_victim',
  organization_id: 'org_victim',
  created_by: 'usr_victim',
  created_at: '2020-01-01T00:00:00Z',
};

describe('POST /forms/:slug/submit — server-managed anchors (#3022)', () => {
  it('declared-field whitelist: undeclared and server-managed fields are dropped', async () => {
    // The form even (mis)declares `owner_id` — the anchor still may not pass.
    const { submit, createData } = buildServer([{ fields: ['subject', 'email', { field: 'owner_id' }] }]);
    const res = mockRes();
    await submit.handler(
      { params: { slug: 'test' }, body: { subject: 'Help', email: 'a@b.c', status: 'closed', ...FORGED } } as any,
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(createData).toHaveBeenCalledTimes(1);
    expect(createData.mock.calls[0][0].data).toEqual({ subject: 'Help', email: 'a@b.c' });
  });

  it('zero declared sections: business fields fall through, anchors do NOT', async () => {
    // The all-fields fallback previously merged the raw body wholesale —
    // the unauthenticated insert-forge of the issue. Business fields keep
    // the documented fall-through; every server-managed anchor is excluded.
    const { submit, createData } = buildServer([]);
    const res = mockRes();
    await submit.handler(
      { params: { slug: 'test' }, body: { subject: 'Help', status: 'open', ...FORGED } } as any,
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(createData.mock.calls[0][0].data).toEqual({ subject: 'Help', status: 'open' });
  });

  it('a __proto__ body key cannot smuggle inherited anchors past the filter', async () => {
    const { submit, createData } = buildServer([]);
    const res = mockRes();
    // JSON.parse produces `__proto__` as an OWN key; a naive `obj[k] = v`
    // assignment would replace the payload's prototype with this object and
    // `data.owner_id` would resolve to the forged value via inheritance.
    const body = JSON.parse('{"subject": "Help", "__proto__": {"owner_id": "usr_victim"}}');
    await submit.handler({ params: { slug: 'test' }, body } as any, res);
    expect(res.statusCode).toBe(201);
    const sent = createData.mock.calls[0][0].data;
    expect(sent).toEqual({ subject: 'Help' });
    expect((sent as any).owner_id, 'no inherited owner_id either').toBeUndefined();
  });

  it('the insert is scoped by the declaration-derived publicFormGrant', async () => {
    const { submit, createData } = buildServer([{ fields: ['subject'] }]);
    await submit.handler({ params: { slug: 'test' }, body: { subject: 'Hi' } } as any, mockRes());
    expect(createData.mock.calls[0][0].context).toMatchObject({
      publicFormGrant: { object: 'ticket' },
      anonymous: true,
    });
  });
});

describe('GET /forms/:slug — schema/sections agree with the submit boundary (#3022)', () => {
  it('zero declared sections: the all-fields schema expansion excludes managed anchors', async () => {
    const { resolve } = buildServer([]);
    const res = mockRes();
    await resolve.handler({ params: { slug: 'test' }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.objectSchema.fields).sort()).toEqual(['email', 'status', 'subject']);
  });

  it('a declared owner_id is dropped from the rendered sections and schema', async () => {
    const { resolve } = buildServer([{ fields: ['subject', { field: 'owner_id' }] }]);
    const res = mockRes();
    await resolve.handler({ params: { slug: 'test' }, headers: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.objectSchema.fields)).toEqual(['subject']);
    const rendered = res.body.form.sections.flatMap((s: any) =>
      (s.fields ?? []).map((f: any) => (typeof f === 'string' ? f : f.field)));
    expect(rendered).toEqual(['subject']);
  });
});

describe('GET /forms/:slug/lookup/:field — no picker on managed anchors (#3022)', () => {
  it('refuses a publicPicker declared on owner_id (would open anonymous sys_user search)', async () => {
    const { lookup } = buildServer([
      { fields: [{ field: 'owner_id', publicPicker: { displayFields: ['name'] } }] },
    ]);
    const res = mockRes();
    await lookup.handler({ params: { slug: 'test', field: 'owner_id' }, query: {} } as any, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('LOOKUP_NOT_PUBLIC');
  });
});
