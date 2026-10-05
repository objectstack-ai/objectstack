// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A public form withdrawal is a kill switch, on a real showcase boot: any
// metadata layer whose body of the same view explicitly withdraws the form's
// intake (the link kept, a switch cleared) closes it, and layering may only
// narrow intake, never re-open it.
//
// The showcase ships `showcase_inquiry.contact`, a FormView open to anonymous
// intake at `/forms/contact-us`. The administrator saves it the way the editor
// does (`PUT /meta/view/...` at their own session), env-wide (no active
// organization) or in their organization (`orgContext: true` gives the admin
// one, and it is the organization the anonymous doors read). Pinned:
//
//   - an organization overlay that keeps the form open does not survive an
//     env-wide withdrawal: both anonymous doors answer `404 FORM_NOT_FOUND`
//     and nothing lands;
//   - an organization-scoped save that would leave it open (a re-save of
//     the overlay open from before, or a re-open) is refused
//     (`403 NOT_OVERRIDABLE`) and the doors stay closed;
//   - withdrawn in the organization while open env-wide: closed;
//   - open at both layers (control): both doors accept.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const VIEW = '/meta/view/showcase_inquiry.contact';
const SYS = { isSystem: true } as const;

describe('showcase: a public form withdrawal at any metadata layer holds', () => {
  let stack: VerifyStack;
  let admin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let published: Record<string, any>;
  let organizationId: string;
  let probeSeq = 0;

  /** Both anonymous doors, plus how many rows a submit with a unique marker left. */
  const probe = async () => {
    const marker = `layer_probe_${++probeSeq}`;
    const get = await stack.api('/forms/contact-us');
    const getBody = (await get.json()) as { code?: unknown };
    const submit = await stack.api('/forms/contact-us/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: marker, email: 'probe@example.com', message: 'probe' }),
    });
    const submitBody = (await submit.json()) as { code?: unknown };
    const landed = await ql.find('showcase_inquiry', { where: { name: marker }, context: SYS });
    return { doors: [get.status, getBody.code ?? null, submit.status, submitBody.code ?? null], landed: landed.length };
  };

  const CLOSED = { doors: [404, 'FORM_NOT_FOUND', 404, 'FORM_NOT_FOUND'], landed: 0 };
  const OPEN = { doors: [200, null, 201, null], landed: 1 };

  /** Switch the admin's session scope: env-wide (`null`) or the organization. */
  const scope = async (org: string | null) => {
    const res = await stack.apiAs(admin, 'POST', '/auth/organization/set-active', { organizationId: org });
    expect(res.status).toBe(200);
  };

  /** Save the form at the current scope with `allowAnonymous` set; answers status and body. */
  const save = async (allowAnonymous: boolean) => {
    const body = structuredClone(published);
    body.config.sharing.allowAnonymous = allowAnonymous;
    const res = await stack.apiAs(admin, 'PUT', VIEW, body);
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };

  const saved = async (allowAnonymous: boolean) => {
    const r = await save(allowAnonymous);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return String(r.json.message ?? '');
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
    published = Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_')));
    expect(published.config?.sharing).toMatchObject({ enabled: true, allowAnonymous: true });
    const orgs = await ql.find('sys_organization', { fields: ['id'], limit: 2, context: SYS });
    expect(orgs, 'the showcase boot holds exactly one organization').toHaveLength(1);
    organizationId = orgs[0].id;
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('PRECONDITION: an organization overlay that keeps the form open is served', async () => {
    await scope(organizationId);
    expect(await saved(true), 'the save is an organization overlay').toContain(`org=${organizationId}`);
    expect(await probe()).toEqual(OPEN);
  });

  it('withdrawn env-wide beneath an open organization overlay: both doors refuse and nothing lands', async () => {
    await scope(null);
    expect(await saved(false)).toMatch(/env-wide/);
    expect(await probe()).toEqual(CLOSED);
  });

  it('an organization-scoped save that would leave it open is refused, and the doors stay closed', async () => {
    await scope(organizationId);
    // The organization overlay is still open from before the withdrawal:
    // re-saving it as it is would leave open a withdrawn form.
    const resave = await save(true);
    expect(resave.status, JSON.stringify(resave.json)).toBe(403);
    expect(resave.json.code ?? resave.json.error?.code).toBe('NOT_OVERRIDABLE');
    // Withdrawing it there is accepted; re-opening it is refused again.
    expect((await save(false)).status).toBe(200);
    const reopen = await save(true);
    expect(reopen.status, JSON.stringify(reopen.json)).toBe(403);
    expect(reopen.json.code ?? reopen.json.error?.code).toBe('NOT_OVERRIDABLE');
    expect(await probe()).toEqual(CLOSED);
  });

  it('withdrawn in the organization while open env-wide: both doors refuse', async () => {
    await scope(null);
    expect(await saved(true)).toMatch(/env-wide/);
    expect(await probe()).toEqual(CLOSED);
  });

  it('open at both layers (control): both doors accept and the row lands in the organization', async () => {
    await scope(organizationId);
    expect(await saved(true)).toContain(`org=${organizationId}`);
    const marker = `layer_probe_${probeSeq + 1}`;
    expect(await probe()).toEqual(OPEN);
    const [row] = await ql.find('showcase_inquiry', { where: { name: marker }, context: SYS });
    expect(row.organization_id).toBe(organizationId);
  });
});
