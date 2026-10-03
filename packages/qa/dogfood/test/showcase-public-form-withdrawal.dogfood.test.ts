// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21331] Withdrawing a public form from anonymous intake takes effect on
// every intake door, on a real showcase boot.
//
// The showcase ships `showcase_inquiry.contact`, a FormView with
// `sharing.allowAnonymous: true` at `/forms/contact-us`
// (`showcase-public-form.dogfood.test.ts` pins that it serves). An
// administrator withdraws it the way the editor does, with `PUT /meta/view/...`
// at their own session, once env-wide (no active organization) and once in
// their organization (`orgContext: true` gives the admin one). After either
// withdrawal both anonymous doors must refuse, and nothing may land:
//
//   - `GET /forms/contact-us` and `POST /forms/contact-us/submit` both answer
//     `404 FORM_NOT_FOUND`;
//   - no `showcase_inquiry` row is written by the refused submit.
//
// The form is withdrawn by either declared switch: `allowAnonymous: false`, or
// `enabled: false` (absent reads as the schema default, false). Both sides are
// pinned: republishing at the same scope restores both doors, and after the
// organization republish the row lands in that organization.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const VIEW = '/meta/view/showcase_inquiry.contact';
const SYS = { isSystem: true } as const;

interface Probe {
  get: number;
  getCode: unknown;
  submit: number;
  submitCode: unknown;
  landed: Array<{ organization_id?: unknown }>;
}

describe('showcase: withdrawing the public contact form closes every intake door', () => {
  let stack: VerifyStack;
  let admin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let published: Record<string, any>;
  let probeSeq = 0;

  /** Both anonymous doors, plus the rows a submit with a unique marker left. */
  const probe = async (): Promise<Probe> => {
    const marker = `withdrawal_probe_${++probeSeq}`;
    const get = await stack.api('/forms/contact-us');
    const getBody = (await get.json()) as { code?: unknown };
    const submit = await stack.api('/forms/contact-us/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: marker, email: 'probe@example.com', message: 'probe' }),
    });
    const submitBody = (await submit.json()) as { code?: unknown };
    const landed = await ql.find('showcase_inquiry', { where: { name: marker }, context: SYS });
    return { get: get.status, getCode: getBody.code, submit: submit.status, submitCode: submitBody.code, landed };
  };

  /**
   * Save the form at the admin's current session scope, with `allowAnonymous`
   * set (a boolean) or with these `sharing` keys replaced (`undefined` deletes one).
   */
  const save = async (change: boolean | Record<string, unknown>): Promise<string> => {
    const body = structuredClone(published);
    const patch = typeof change === 'boolean' ? { allowAnonymous: change } : change;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete body.config.sharing[k];
      else body.config.sharing[k] = v;
    }
    const res = await stack.apiAs(admin, 'PUT', VIEW, body);
    const json = (await res.json()) as { message?: string };
    expect(res.status, JSON.stringify(json)).toBe(200);
    return String(json.message ?? '');
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      orgContext: true,
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets] }),
    });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const res = await stack.apiAs(admin, 'GET', VIEW);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item?: Record<string, any> };
    const item = (json.item ?? json) as Record<string, any>;
    // The editor's PUT body: the effective item without its read decorations.
    published = Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_')));
    expect(published.config?.sharing?.allowAnonymous).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('PRECONDITION: the published form accepts anonymous intake', async () => {
    const p = await probe();
    expect(p.get).toBe(200);
    expect(p.submit).toBe(201);
    expect(p.landed).toHaveLength(1);
  });

  it('withdrawn env-wide: both doors answer 404 FORM_NOT_FOUND and nothing lands; republishing restores them', async () => {
    const off = await stack.apiAs(admin, 'POST', '/auth/organization/set-active', { organizationId: null });
    expect(off.status).toBe(200);
    expect(await save(false)).toMatch(/env-wide/);
    const closed = await probe();
    expect([closed.get, closed.getCode, closed.submit, closed.submitCode])
      .toEqual([404, 'FORM_NOT_FOUND', 404, 'FORM_NOT_FOUND']);
    expect(closed.landed).toHaveLength(0);

    expect(await save(true)).toMatch(/env-wide/);
    const open = await probe();
    expect([open.get, open.submit]).toEqual([200, 201]);
    expect(open.landed).toHaveLength(1);
  });

  it('withdrawn env-wide through `sharing.enabled: false` alone: both doors answer 404 FORM_NOT_FOUND and nothing lands', async () => {
    expect(published.config.sharing.enabled).toBe(true);
    expect(await save({ enabled: false, allowAnonymous: true })).toMatch(/env-wide/);
    const closed = await probe();
    expect([closed.get, closed.getCode, closed.submit, closed.submitCode])
      .toEqual([404, 'FORM_NOT_FOUND', 404, 'FORM_NOT_FOUND']);
    expect(closed.landed).toHaveLength(0);

    // `enabled` absent reads as the schema default (false): still closed.
    expect(await save({ enabled: undefined, allowAnonymous: true })).toMatch(/env-wide/);
    const absent = await probe();
    expect([absent.get, absent.getCode, absent.submit, absent.submitCode])
      .toEqual([404, 'FORM_NOT_FOUND', 404, 'FORM_NOT_FOUND']);
    expect(absent.landed).toHaveLength(0);

    expect(await save({ enabled: true, allowAnonymous: true })).toMatch(/env-wide/);
    const open = await probe();
    expect([open.get, open.submit]).toEqual([200, 201]);
    expect(open.landed).toHaveLength(1);
  });

  it('withdrawn in the admin\'s organization: both doors answer 404 FORM_NOT_FOUND and nothing lands', async () => {
    const orgs = await ql.find('sys_organization', { fields: ['id'], limit: 2, context: SYS });
    expect(orgs, 'the showcase boot holds exactly one organization').toHaveLength(1);
    const on = await stack.apiAs(admin, 'POST', '/auth/organization/set-active', { organizationId: orgs[0].id });
    expect(on.status).toBe(200);

    expect(await save(false), 'the save is an organization overlay').toContain(`org=${orgs[0].id}`);
    const p = await probe();
    expect([p.get, p.getCode, p.submit, p.submitCode]).toEqual([404, 'FORM_NOT_FOUND', 404, 'FORM_NOT_FOUND']);
    expect(p.landed).toHaveLength(0);
  });

  it('republished in the same organization (control): both doors accept and the row lands in that organization', async () => {
    const message = await save(true);
    const org = /org=(\S+?),/.exec(message)?.[1];
    expect(org, message).toBeTruthy();
    const p = await probe();
    expect([p.get, p.submit]).toEqual([200, 201]);
    expect(p.landed).toHaveLength(1);
    expect(p.landed[0].organization_id).toBe(org);
  });
});
