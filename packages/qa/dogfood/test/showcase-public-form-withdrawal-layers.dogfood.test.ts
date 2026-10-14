// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A public form withdrawal is a kill switch, on a real showcase boot: any
// metadata layer whose body of the same view explicitly withdraws the form's
// intake (the link kept, a switch cleared) closes it, and layering may only
// narrow intake, never re-open it.
//
// The showcase ships `showcase_inquiry.contact`, a FormView open to anonymous
// intake at `/forms/contact-us`. The administrator saves it the way the editor
// does (`PUT /meta/view/...` at their own session) — and since ADR-0131 D6
// retired the per-organization overlay axis, that save lands ENVIRONMENT-WIDE
// even when the admin has an active organization.
//
// The anonymous form doors read the environment alone (ADR-0131 C7): their
// read of the Default Organization's legacy layer is deleted, because the v18
// ceremony (`os migrate organization-ownership --apply`) carries every
// organization-layer withdrawal onto the environment, fail-closed (rulings A
// on #22008 and #22011; the carry is pinned in the cli's
// `organization-ownership-apply.test.ts`). Since ADR-0131 D7 `sys_metadata`
// declares no organization column, so no organization row can exist to be
// read, and this file pins:
//
//   - the shipped form is served to both anonymous doors;
//   - the admin's save with an active organization is environment-wide, and its
//     withdrawal closes both doors (`404 FORM_NOT_FOUND`) with nothing landing;
//   - open environment-wide (control): both doors accept, and the row lands in
//     the organization the doors resolve.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
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
    stack = await bootShowcase({
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

  it('PRECONDITION: the shipped form is served', async () => {
    expect(await probe()).toEqual(OPEN);
  });

  it('withdrawn by an admin WITH an active organization: the save is environment-wide, and it closes the form', async () => {
    await scope(organizationId);
    expect(await saved(false), 'an org-active admin\'s save is environment-wide (ADR-0131 D6)').toMatch(/env-wide/);
    expect(await probe()).toEqual(CLOSED);
  });

  it('open environment-wide (control): both doors accept and the row lands in the organization', async () => {
    await scope(organizationId);
    expect(await saved(true)).toMatch(/env-wide/);
    const marker = `layer_probe_${probeSeq + 1}`;
    expect(await probe()).toEqual(OPEN);
    const [row] = await ql.find('showcase_inquiry', { where: { name: marker }, context: SYS });
    expect(row.organization_id).toBe(organizationId);
  });
});
