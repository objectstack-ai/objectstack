// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3/D9] On a walled boot the self-registration grant settles on the
// registrant's FIRST MEMBERSHIP, end to end on the real stack. A stranger who
// self-registers through `POST /auth/sign-up/email` belongs to no organization
// yet, so the sign-up writes NO `sys_user_permission_set` row (the grant is an
// organization row and there is no organization to own it); creating their
// first organization through better-auth's `POST /auth/organization/create`
// writes exactly one, owned by that organization; a second organization writes
// no second self-registration grant.
//
// The `single` half — the sign-up's own grant, owned by the Default
// Organization — is pinned by `signup-organization-census.dogfood.test.ts`.
//
// [#32787] The grant's later fate: it is the first organization's own auth
// structure, so deleting that organization is not refused over it and removes
// it, and the registrant's access in their second organization is what it was
// (the grant only ever applied in the organization it names). A grant of any
// other set in that organization is still a record the delete refuses over.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { context: { isSystem: true } };
const SET = 'member_default';
/** A set of the CRM app's, held in the first organization as an ordinary (business) grant. */
const BUSINESS_SET = 'crm_sales_user';
const REGISTRANT = 'walled-registrant@dogfood.test';
const PASSWORD = 'Walled-Passw0rd!';

describe('[ADR-0131 D3] a walled self-registration is granted with its first membership', () => {
  let stack: VerifyStack;
  let ql: any;
  let registrantId: string;
  let registrantToken: string;
  let firstOrganization = '';
  let secondOrganization = '';

  const grantsOfRegistrant = async (): Promise<Array<Record<string, unknown>>> =>
    ql.find('sys_user_permission_set', { where: { user_id: registrantId, permission_set: SET }, ...SYS });

  /** The registrant's authorization with `tenantId` active, with where each set comes from. */
  const accessIn = async (tenantId?: string) => {
    const grants = await resolveUserAuthzGrants(ql as never, registrantId, {
      ...(tenantId ? { tenantId } : {}),
      withPermissionOrigins: true,
    });
    return { positions: grants.positions, permissions: grants.permissions, origins: grants.permissionOrigins };
  };
  const directlyHeld = (access: { origins?: Record<string, Array<{ kind: string }>> }, set: string): boolean =>
    (access.origins?.[set] ?? []).some((origin) => origin.kind === 'direct');

  const deleteOrganization = (organizationId: string) =>
    stack.apiAs(registrantToken, 'POST', '/auth/organization/delete', { organizationId });

  const createOrganization = async (name: string, slug: string): Promise<string> => {
    const res = await stack.apiAs(registrantToken, 'POST', '/auth/organization/create', { name, slug });
    expect(res.status, `organization/create: ${await res.clone().text()}`).toBe(200);
    const org = (await res.json()) as { id?: string };
    expect(org.id).toBeTruthy();
    return org.id!;
  };

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, { multiTenant: 'posture-only' });
    const adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // An open audience: a stranger may self-register and is owed the declared set.
    const opened = await stack.raw('/api/settings/auth', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        values: { audience_posture: 'open', audience_self_registration_permission_set: SET },
      }),
    });
    expect(opened.status, `open the audience: ${await opened.clone().text()}`).toBe(200);

    const signedUp = await stack.api('/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: REGISTRANT, password: PASSWORD, name: 'Walled Registrant' }),
    });
    expect(signedUp.status, `sign-up: ${await signedUp.clone().text()}`).toBe(200);
    const registrant = await ql.findOne('sys_user', { where: { email: REGISTRANT }, ...SYS });
    expect(registrant?.id, 'the registrant exists').toBeTruthy();
    registrantId = registrant.id;

    // The open posture sends a verification mail; the link is not what this
    // file is about, so the address is marked verified in place before the
    // registrant signs in.
    await ql.update('sys_user', { id: registrantId, email_verified: true }, SYS);
    registrantToken = await stack.signIn(REGISTRANT, PASSWORD);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard: the boot is walled, and the registrant belongs to no organization after sign-up', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean }>('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(await ql.find('sys_member', { where: { user_id: registrantId }, ...SYS })).toEqual([]);
  });

  it('the sign-up wrote no self-registration grant — and no grant without an organization', async () => {
    expect(await grantsOfRegistrant()).toEqual([]);
    const anyGrant = await ql.find('sys_user_permission_set', { where: { user_id: registrantId }, ...SYS });
    expect(anyGrant.filter((g: any) => g.organization_id == null || g.organization_id === '')).toEqual([]);
  });

  it('creating the first organization lands exactly one grant, owned by it; a second organization lands none', async () => {
    const first = await createOrganization('Walled Registrant Co', 'walled-registrant-co');
    const afterFirst = await grantsOfRegistrant();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].organization_id).toBe(first);

    const second = await createOrganization('Walled Registrant Two', 'walled-registrant-two');
    expect(second).not.toBe(first);
    const afterSecond = await grantsOfRegistrant();
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].organization_id).toBe(first);
    firstOrganization = first;
    secondOrganization = second;
  });

  it('[#32787] the grant applies only in the organization it names: the second organization never held it', async () => {
    expect(firstOrganization && secondOrganization, 'both organizations were created above').toBeTruthy();
    expect(directlyHeld(await accessIn(firstOrganization), SET), 'held, as a grant, in the first organization').toBe(true);
    expect(directlyHeld(await accessIn(secondOrganization), SET), 'never a grant in the second organization').toBe(false);
    expect(directlyHeld(await accessIn(undefined), SET), 'and no grant with no organization active').toBe(false);
  });

  it('[#32787] a grant of another set in the first organization is still a record: the delete refuses, naming only it', async () => {
    const business = await ql.insert(
      'sys_user_permission_set',
      { user_id: registrantId, permission_set: BUSINESS_SET, organization_id: firstOrganization },
      SYS,
    );
    try {
      const refused = await deleteOrganization(firstOrganization);
      expect(refused.status, await refused.clone().text()).toBe(409);
      const body = (await refused.json()) as { code?: string; dependents?: unknown };
      expect(body.code).toBe('DELETE_RESTRICTED');
      // Only the business grant: the self-registration grant beside it is not counted.
      expect(body.dependents).toEqual([{ object: 'sys_user_permission_set', count: 1 }]);
      expect(await ql.find('sys_organization', { where: { id: firstOrganization }, ...SYS })).toHaveLength(1);
      expect(await grantsOfRegistrant()).toHaveLength(1);
    } finally {
      await ql.delete('sys_user_permission_set', { where: { id: business.id }, ...SYS });
    }
  });

  it('[#32787] deleting the first organization answers 200, removes the grant, and leaves the second organization as it was', async () => {
    const secondBefore = await accessIn(secondOrganization);
    const noneBefore = await accessIn(undefined);

    const deleted = await deleteOrganization(firstOrganization);
    expect(deleted.status, await deleted.clone().text()).toBe(200);

    expect(await ql.find('sys_organization', { where: { id: firstOrganization }, ...SYS })).toEqual([]);
    expect(await grantsOfRegistrant(), 'the self-registration grant went with its organization').toEqual([]);
    expect(
      await ql.find('sys_user_permission_set', { where: { organization_id: firstOrganization }, ...SYS }),
      'no grant names the deleted organization',
    ).toEqual([]);

    // Nothing the registrant holds in the second organization, or with no
    // organization active, depended on the removed row.
    expect(await accessIn(secondOrganization)).toEqual(secondBefore);
    expect(await accessIn(undefined)).toEqual(noneBefore);
    expect(await ql.find('sys_member', { where: { user_id: registrantId }, ...SYS })).toEqual([
      expect.objectContaining({ organization_id: secondOrganization }),
    ]);
  });

  it('[#32787] CONTROL: the second organization, which never held the grant, deletes too', async () => {
    const deleted = await deleteOrganization(secondOrganization);
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(await ql.find('sys_organization', { where: { id: secondOrganization }, ...SYS })).toEqual([]);
  });
});
