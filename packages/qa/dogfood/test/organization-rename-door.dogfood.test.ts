// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_organization.rename_organization` through the door it targets, on a
 * booted showcase.
 *
 * The record page's rename door is a name/logo-only action on better-auth's
 * `organization/update`, the endpoint `update_organization` uses, declared
 * without a `slug` param. Its whole claim is that a rename through it keeps the
 * stored slug: better-auth writes only the keys it is sent, its slug-taken
 * check runs only on a sent slug, and plugin-auth's `beforeUpdateOrganization`
 * slug guard returns at once when no slug is sent. This file proves that claim
 * against the real stack instead of a source reading.
 *
 * The request is built from the REGISTERED action, the way the console's api
 * action runner builds it (objectui `useConsoleActionRuntime`): the params go
 * under `bodyShape.wrap`, the record id under `recordIdParam`, and the target is
 * the declared one. So a slug param added to the declaration would reach the
 * body here, and the slug assertion below would see what a user would get.
 *
 * The organization is minted the way `organization-update-door.dogfood.test.ts`
 * mints it: `multiTenant: 'posture-only'` opens `organization/create` on the
 * plain showcase (it activates the posture, never the wall), and the creator is
 * the owner, a grade better-auth grants `organization: ['update']`.
 *
 * The declaration half (params, locations, gate, header order, and the two
 * slug doors unchanged) is `sys-organization-rename-action.test.ts` in
 * `@objectstack/platform-objects`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

interface RegisteredAction {
  name?: string;
  type?: string;
  target?: string;
  recordIdParam?: string;
  bodyShape?: { wrap?: string };
  params?: Array<{ field?: string; name?: string }>;
}

const SLUG = 'rename-door-org';

describe('sys_organization.rename_organization: a rename through better-auth keeps the slug', () => {
  let stack: VerifyStack;
  let token: string;
  let orgId: string;
  let rename: RegisteredAction;

  /** The organization row as the data door serves it back. */
  const readOrg = async (id: string): Promise<Record<string, unknown>> => {
    const res = await stack.apiAs(token, 'GET', `/data/sys_organization/${id}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    return (body.record ?? body.data ?? {}) as Record<string, unknown>;
  };

  /** Run the registered action the way the console's api runner does. */
  const runRename = async (values: Record<string, unknown>) => {
    const keys = (rename.params ?? []).map((p) => (p.field ?? p.name) as string);
    const collected = Object.fromEntries(keys.filter((k) => k in values).map((k) => [k, values[k]]));
    const wrap = rename.bodyShape?.wrap;
    const body: Record<string, unknown> = wrap ? { [wrap]: collected } : { ...collected };
    body[rename.recordIdParam as string] = orgId;
    // `apiAs` paths are relative to the REST prefix the target names.
    const path = String(rename.target).replace(/^\/api\/v1/, '');
    return stack.apiAs(token, 'POST', path, body);
  };

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    token = await stack.signIn();

    const created = await stack.apiAs(token, 'POST', '/auth/organization/create', {
      name: 'Rename Door Org',
      slug: SLUG,
    });
    expect(created.status, `organization/create returned ${created.status}: ${await created.clone().text()}`).toBe(200);
    orgId = String(((await created.json()) as { id?: string }).id);
    expect(orgId).toBeTruthy();

    const engine = await stack.kernel.getServiceAsync<any>('objectql');
    const schema = engine?.getSchema?.('sys_organization');
    rename = ((schema?.actions ?? []) as RegisteredAction[]).find((a) => a?.name === 'rename_organization') as RegisteredAction;
    expect(rename, 'rename_organization is registered').toBeTruthy();
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('the registered action is the declared one: organization/update, name and logo under data, the row id as organizationId', () => {
    expect(rename.type).toBe('api');
    expect(rename.target).toBe('/api/v1/auth/organization/update');
    expect(rename.bodyShape).toEqual({ wrap: 'data' });
    expect(rename.recordIdParam).toBe('organizationId');
    expect((rename.params ?? []).map((p) => p.field ?? p.name)).toEqual(['name', 'logo']);
  });

  it('renames the organization and sets its logo, and the slug reads back unchanged', async () => {
    const before = await readOrg(orgId);
    expect(before.slug).toBe(SLUG);

    // A new slug is among the values on purpose. The param dialog collects
    // declared params alone, so with no `slug` param it never reaches the
    // body, and the stored slug must survive the rename.
    const res = await runRename({ name: 'Renamed Door Org', logo: 'https://example.com/rename-door.png', slug: 'smuggled-slug' });
    expect(res.status, `organization/update returned ${res.status}: ${await res.clone().text()}`).toBe(200);
    const answered: any = await res.json();
    expect(answered.name).toBe('Renamed Door Org');
    expect(answered.slug).toBe(SLUG);

    const after = await readOrg(orgId);
    expect(after.name).toBe('Renamed Door Org');
    expect(after.logo).toBe('https://example.com/rename-door.png');
    expect(after.slug).toBe(SLUG);
  });
});
