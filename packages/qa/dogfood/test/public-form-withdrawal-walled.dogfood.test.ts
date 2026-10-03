// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Withdrawing a public form from anonymous intake on a WALLED tenancy posture,
// on a real boot. The single-posture half lives in
// `showcase-public-form-withdrawal.dogfood.test.ts`.
//
// The form here is a fixture bound to an object declared `tenancy: { enabled:
// false }`. The showcase's own contact form targets a tenant-scoped object,
// and on a walled posture the engine refuses an org-less insert into one, so
// it could not show the published side accepting intake.
//
// On a walled posture the anonymous form doors read the env-wide form
// definition, so an organization-scoped change to a form's anonymous intake is
// refused at the save door, naming the env-wide save as the remedy. Pinned:
//
//   - the organization-scoped withdrawal answers `403 NOT_OVERRIDABLE` and
//     nothing is saved (the organization still reads the published form, and
//     both doors still serve it);
//   - an organization-scoped edit that leaves the sharing alone still saves;
//   - the env-wide withdrawal is accepted and both anonymous doors answer
//     `404 FORM_NOT_FOUND`, with no row landing; republishing env-wide restores
//     both doors.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack, defineView } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const LEAD = 'walled_lead';
const SLUG = 'walled-lead-intake';
const VIEW = `/meta/view/${LEAD}.intake`;

const WalledLead = ObjectSchema.create({
  name: LEAD,
  label: 'Walled Lead',
  pluralLabel: 'Walled Leads',
  sharingModel: 'private',
  tenancy: { enabled: false },
  fields: {
    name: Field.text({ label: 'Name', required: true, maxLength: 120 }),
  },
});

const data = { provider: 'object' as const, object: LEAD };
const WalledLeadViews = defineView({
  list: { label: 'Leads', type: 'grid', data, columns: [{ field: 'name' }] },
  formViews: {
    intake: {
      type: 'simple',
      data,
      sections: [{ name: 'intake', label: 'Intake', columns: 1, fields: [{ field: 'name', required: true }] }],
      sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
    },
  },
});

const walledFormStack = defineStack({
  manifest: {
    id: 'com.dogfood.walled-public-form',
    namespace: 'walled',
    version: '0.0.0',
    type: 'app',
    name: 'Walled Public Form Fixture',
    description: 'One tenancy-disabled object behind an anonymous form, booted on a walled posture.',
  },
  objects: [WalledLead],
  views: [WalledLeadViews],
});
const SYS = { isSystem: true } as const;

interface Probe {
  get: number;
  getCode: unknown;
  submit: number;
  submitCode: unknown;
  landed: unknown[];
}

describe('walled posture: withdrawing a public form from anonymous intake', () => {
  let stack: VerifyStack;
  let admin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let published: Record<string, any>;
  let orgId: string;
  let probeSeq = 0;

  /** Both anonymous doors, plus the rows a submit with a unique marker left. */
  const probe = async (): Promise<Probe> => {
    const marker = `walled_withdrawal_probe_${++probeSeq}`;
    const get = await stack.api(`/forms/${SLUG}`);
    const getBody = (await get.json()) as { code?: unknown };
    const submit = await stack.api(`/forms/${SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: marker }),
    });
    const submitBody = (await submit.json()) as { code?: unknown };
    const landed = await ql.find(LEAD, { where: { name: marker }, context: SYS });
    return { get: get.status, getCode: getBody.code, submit: submit.status, submitCode: submitBody.code, landed };
  };

  const setActive = async (organizationId: string | null): Promise<void> => {
    const res = await stack.apiAs(admin, 'POST', '/auth/organization/set-active', { organizationId });
    expect(res.status, await res.clone().text()).toBe(200);
  };

  /** PUT the form at the admin's current session scope. */
  const put = async (body: Record<string, any>) => {
    const res = await stack.apiAs(admin, 'PUT', VIEW, body);
    const json = (await res.json()) as Record<string, any>;
    return { status: res.status, json };
  };

  const withAnonymous = (allowAnonymous: boolean): Record<string, any> => {
    const body = structuredClone(published);
    body.config.sharing.allowAnonymous = allowAnonymous;
    return body;
  };

  /** The effective form as the admin's current scope reads it. */
  const read = async (): Promise<Record<string, any>> => {
    const res = await stack.apiAs(admin, 'GET', VIEW);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item?: Record<string, any> };
    return (json.item ?? json) as Record<string, any>;
  };

  beforeAll(async () => {
    stack = await bootStack(walledFormStack as Parameters<typeof bootStack>[0], {
      multiTenant: 'posture-only',
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets] }),
    });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const item = await read();
    // The editor's PUT body: the effective item without its read decorations.
    published = Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_')));
    expect(published.config?.sharing?.allowAnonymous).toBe(true);

    const created = await stack.apiAs(admin, 'POST', '/auth/organization/create', {
      name: 'Walled Tenant', slug: 'walled-tenant-form',
    });
    expect(created.status, await created.clone().text()).toBe(200);
    orgId = ((await created.json()) as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('PRECONDITION: a walled posture that resolves no organization for an anonymous request', async () => {
    const tenancy = stack.tenancy();
    expect(tenancy.requestedPosture).toBe('isolated');
    expect(tenancy.requested).toBe(true);
    expect(await tenancy.defaultOrgId()).toBeNull();
    expect(orgId).toBeTruthy();
  });

  it('PRECONDITION: the published form accepts anonymous intake', async () => {
    const p = await probe();
    expect([p.get, p.submit]).toEqual([200, 201]);
    expect(p.landed).toHaveLength(1);
    // [#21476] The control of `showcase-public-form-walled-intake.dogfood.test.ts`:
    // a tenancy-disabled object takes intake on a walled posture, so the
    // administrator's read states no intake reason.
    expect((await read())._diagnostics?.warnings).toBeUndefined();
  });

  it('withdrawn in an organization: refused 403 NOT_OVERRIDABLE naming the env-wide save, and nothing is saved', async () => {
    await setActive(orgId);
    const res = await put(withAnonymous(false));
    expect(res.status, JSON.stringify(res.json)).toBe(403);
    const error = (res.json.error ?? res.json) as Record<string, any>;
    expect(error.code ?? res.json.code).toBe('NOT_OVERRIDABLE');
    expect(JSON.stringify(res.json)).toMatch(/Save it env-wide instead/);

    expect((await read()).config?.sharing?.allowAnonymous, 'the organization still reads the published form').toBe(true);
    const p = await probe();
    expect([p.get, p.submit]).toEqual([200, 201]);
    expect(p.landed).toHaveLength(1);
  });

  it('an organization-scoped edit that leaves the sharing alone still saves (control)', async () => {
    await setActive(orgId);
    const body = structuredClone(published);
    body.label = `${String(published.label ?? 'Intake')} (tenant)`;
    const res = await put(body);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(String(res.json.message ?? '')).toContain(`org=${orgId}`);
  });

  it('withdrawn env-wide: both doors answer 404 FORM_NOT_FOUND and nothing lands; republishing restores them', async () => {
    await setActive(null);
    const off = await put(withAnonymous(false));
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect(String(off.json.message ?? '')).toMatch(/env-wide/);
    const closed = await probe();
    expect([closed.get, closed.getCode, closed.submit, closed.submitCode])
      .toEqual([404, 'FORM_NOT_FOUND', 404, 'FORM_NOT_FOUND']);
    expect(closed.landed).toHaveLength(0);

    const on = await put(withAnonymous(true));
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    const open = await probe();
    expect([open.get, open.submit]).toEqual([200, 201]);
    expect(open.landed).toHaveLength(1);
  });

  it('withdrawn through `sharing.enabled: false` alone: refused org-scoped; env-wide both doors 404 and nothing lands', async () => {
    const withEnabled = (enabled: boolean): Record<string, any> => {
      const body = withAnonymous(true);
      body.config.sharing.enabled = enabled;
      return body;
    };
    await setActive(orgId);
    const refused = await put(withEnabled(false));
    expect(refused.status, JSON.stringify(refused.json)).toBe(403);
    expect(JSON.stringify(refused.json)).toMatch(/NOT_OVERRIDABLE/);

    await setActive(null);
    const off = await put(withEnabled(false));
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    const closed = await probe();
    expect([closed.get, closed.getCode, closed.submit, closed.submitCode])
      .toEqual([404, 'FORM_NOT_FOUND', 404, 'FORM_NOT_FOUND']);
    expect(closed.landed).toHaveLength(0);

    const on = await put(withEnabled(true));
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    const open = await probe();
    expect([open.get, open.submit]).toEqual([200, 201]);
    expect(open.landed).toHaveLength(1);
  });
});
