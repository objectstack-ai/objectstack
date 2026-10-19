// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D9 / D11, C8 stage 8b] Under the `single` posture no platform
// object is exempt from the system-insert organization rule.
//
// Until this stage, `Engine.resolveSystemInsertOrganization` returned before it
// read the posture for every platform object (`sys_` / `cloud_` / `ai_`) with a
// tenant column that the #13491 inventory had not admitted, so a system insert
// that named no organization landed with `organization_id` NULL — under every
// posture. `sys_business_unit_member` was the measured instance (#14570): a
// bare `isSystem` membership insert stored NULL, and a strict organization
// screen then resolved that member to nobody.
//
// This file pins the lift on the real showcase composition, the one the
// operator boots:
//   1. a fresh `single` boot, the seeded admin's sign-in and an invitation
//      leave NO organization-less row in any platform object with a tenant
//      column — so no boot-time producer writes before the Default
//      Organization exists, or writes around it;
//   2. a bare `isSystem` insert into un-admitted platform objects takes the
//      Default Organization;
//   3. with a second organization present the same insert is REFUSED, loudly,
//      and nothing is written — the refusal half of D9, never a guess.
//
// The walled half stays as it was in 18.0 (epic ruling record 6259899486 on
// #15194, item 4): the unit pins in `@objectstack/objectql` hold that control.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { resolveTenantFieldName } from '@objectstack/objectql';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const PLATFORM_PREFIX = /^(sys_|cloud_|ai_)/;

describe('showcase (single): a platform object system insert takes the Default Organization or is refused (C8 stage 8b)', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    stack = await bootShowcase();
    const adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const tenancy = await stack.kernel.getServiceAsync<{ defaultOrgId(): Promise<string | null> }>('tenancy');
    const resolved = await tenancy.defaultOrgId();
    if (!resolved) throw new Error('fixture: the showcase boot has no Default Organization');
    orgId = resolved;
    // An identity-mail producer and the invitation row, through the public door.
    const invite = await stack.apiAs(adminToken, 'POST', '/auth/organization/invite-member', {
      email: 'c8-8b-invitee@verify.test',
      role: 'member',
    });
    expect(invite.status, 'the admin invites a member').toBeLessThan(300);
    userId = (await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }))?.id;
    if (!userId) throw new Error('fixture: the seeded admin has no sys_user row');
  });

  afterAll(async () => { await stack?.stop(); });

  it('boot, sign-in and an invitation leave no organization-less row in any platform object with a tenant column', async () => {
    const offenders: string[] = [];
    let inScope = 0;
    for (const def of ql.registry.getAllObjects() as Array<{ name: string }>) {
      if (!PLATFORM_PREFIX.test(def.name)) continue;
      const tenantField = resolveTenantFieldName(ql.registry.getObject(def.name));
      if (!tenantField) continue;
      inScope++;
      const rows = await ql.find(def.name, {
        where: { [tenantField]: null },
        fields: ['id'],
        limit: 3,
        context: SYS,
      });
      if (rows.length > 0) offenders.push(`${def.name} (${rows.length}+)`);
    }
    // The non-vacuity half: the walk really visited the in-reach population.
    expect(inScope).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it('a bare isSystem insert into an un-admitted platform object takes the Default Organization (#14570)', async () => {
    await ql.insert('sys_business_unit', { id: 'bu_c8_8b', name: 'C8 8b', kind: 'department', active: true }, { context: SYS });
    await ql.insert('sys_business_unit_member', { id: 'bm_c8_8b', business_unit_id: 'bu_c8_8b', user_id: userId }, { context: SYS });
    const unit = await ql.findOne('sys_business_unit', { where: { id: 'bu_c8_8b' }, context: SYS });
    const member = await ql.findOne('sys_business_unit_member', { where: { id: 'bm_c8_8b' }, context: SYS });
    expect(unit?.organization_id).toBe(orgId);
    expect(member?.organization_id).toBe(orgId);
  });

  it('with a second organization the same insert is REFUSED, loudly, and nothing is written', async () => {
    // A unit the user is not yet a member of, so the one-membership-per-unit
    // constraint cannot answer before the organization rule does.
    await ql.insert('sys_business_unit', { id: 'bu_c8_8b_carried', name: 'C8 8b carried', kind: 'department', active: true, organization_id: orgId }, { context: SYS });
    await ql.insert('sys_organization', { id: 'org_c8_8b_second', name: 'Second', slug: 'c8-8b-second' }, { context: SYS });
    await expect(
      ql.insert('sys_business_unit_member', { id: 'bm_c8_8b_refused', business_unit_id: 'bu_c8_8b_carried', user_id: userId }, { context: SYS }),
    ).rejects.toMatchObject({
      code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED',
      status: 500,
      reason: 'ambiguous-organization',
    });
    expect(await ql.findOne('sys_business_unit_member', { where: { id: 'bm_c8_8b_refused' }, context: SYS })).toBeFalsy();
    // Carrying the organization is the remedy the refusal names, and it lands.
    await ql.insert('sys_business_unit_member', { id: 'bm_c8_8b_carried', business_unit_id: 'bu_c8_8b_carried', user_id: userId, organization_id: orgId }, { context: SYS });
    expect((await ql.findOne('sys_business_unit_member', { where: { id: 'bm_c8_8b_carried' }, context: SYS }))?.organization_id).toBe(orgId);
  });
});
