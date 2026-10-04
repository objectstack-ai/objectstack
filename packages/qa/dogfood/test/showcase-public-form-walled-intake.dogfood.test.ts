// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21476] On a WALLED tenancy posture the showcase's public contact form is
// not offered, on a real boot.
//
// `showcase_inquiry.contact` publishes `/forms/contact-us`, and
// `showcase_inquiry` is walled by the injected `organization_id`. An anonymous
// submission carries no organization, and on a walled posture the engine
// refuses an insert without one into a walled object. Before this pin the form
// was served (`GET` 200) and every submit answered `500
// ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`. Pinned:
//
//   - both anonymous doors answer the not-found answer a withdrawn form gets,
//     byte for byte (measured against the same form withdrawn env-wide on the
//     same boot), and no `showcase_inquiry` row lands;
//   - the administrator's read of the form names why, at `config.sharing`.
//
// The control (a form bound to a `tenancy: { enabled: false }` object on the
// same walled posture is accepted, and its admin read carries no warning) is
// `public-form-withdrawal-walled.dogfood.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const VIEW = '/meta/view/showcase_inquiry.contact';
const SYS = { isSystem: true } as const;

describe('showcase, walled posture: the public contact form is not offered, and the admin read says why', () => {
  let stack: VerifyStack;
  let admin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let probeSeq = 0;

  /** Both anonymous doors' raw answers, plus the rows a submit with a unique marker left. */
  const probe = async () => {
    const marker = `walled_intake_probe_${++probeSeq}`;
    const get = await stack.api('/forms/contact-us');
    const submit = await stack.api('/forms/contact-us/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: marker, email: 'probe@example.com', message: 'probe' }),
    });
    const answers = [get.status, await get.text(), submit.status, await submit.text()];
    const landed = await ql.find('showcase_inquiry', { where: { name: marker }, context: SYS });
    return { answers, landed: landed as unknown[] };
  };

  /** The form as the administrator reads it. */
  const read = async (): Promise<Record<string, any>> => {
    const res = await stack.apiAs(admin, 'GET', VIEW);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item?: Record<string, any> };
    return (json.item ?? json) as Record<string, any>;
  };

  /** Save the form env-wide (the admin has no active organization) with `allowAnonymous` set. */
  const saveAllowAnonymous = async (published: Record<string, any>, allowAnonymous: boolean) => {
    const body = structuredClone(published);
    body.config.sharing.allowAnonymous = allowAnonymous;
    const res = await stack.apiAs(admin, 'PUT', VIEW, body);
    expect(res.status, await res.clone().text()).toBe(200);
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      multiTenant: 'posture-only',
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets] }),
    });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('PRECONDITION: a walled posture in force, no organization for an anonymous request, the form published', async () => {
    const tenancy = stack.tenancy();
    expect(tenancy.posture).toBe('isolated');
    expect(await tenancy.defaultOrgId()).toBeNull();
    expect((await read()).config?.sharing).toMatchObject({ enabled: true, allowAnonymous: true });
  });

  it('both doors answer the withdrawn form\'s not-found answer byte for byte, and nothing lands', async () => {
    const unavailable = await probe();
    expect(unavailable.answers[0]).toBe(404);
    expect(JSON.parse(unavailable.answers[1] as string).code).toBe('FORM_NOT_FOUND');
    expect(unavailable.landed).toHaveLength(0);

    const published = Object.fromEntries(Object.entries(await read()).filter(([k]) => !k.startsWith('_')));
    await saveAllowAnonymous(published, false);
    try {
      const withdrawn = await probe();
      expect(withdrawn.landed).toHaveLength(0);
      expect(unavailable.answers).toEqual(withdrawn.answers);
    } finally {
      await saveAllowAnonymous(published, true);
    }
    // Republished, it is still not offered on this posture.
    const again = await probe();
    expect(again.answers).toEqual(unavailable.answers);
    expect(again.landed).toHaveLength(0);
  });

  it('the administrator\'s read names why, located at the form\'s sharing', async () => {
    const warnings = ((await read())._diagnostics?.warnings ?? []) as Array<{ path: string; message: string }>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe('config.sharing');
    for (const named of ['/forms/contact-us', "'showcase_inquiry'", "'organization_id'", "'isolated'"]) {
      expect(warnings[0].message).toContain(named);
    }
  });
});
