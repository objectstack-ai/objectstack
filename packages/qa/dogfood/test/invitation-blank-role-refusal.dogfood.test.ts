// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29158] `POST /auth/organization/invite-member` refuses a BLANK role the way
// it refuses an unknown one — 400 `ROLE_NOT_FOUND`, and no `sys_invitation`
// row — in both postures the defect was measured in.
//
// better-auth's own role check splits the role list and drops empty entries, so
// a blank role yields no unknown role: on `main` before this the door answered
// 200 and stored `role: ''`, and on a walled `group` boot the invitee's
// acceptance wrote a `sys_member` row with no organization role. The
// framework's `beforeCreateInvitation` now refuses it before any row exists;
// it never defaults the role to `member`.
//
// Why a dogfood beside the unit pins: only the composed stack runs the vendor
// route, the framework hook and the ObjectQL write together, on both postures.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { context: { isSystem: true } };
const PASSWORD = 'Blank-Role-Passw0rd!';

for (const posture of ['single', 'group'] as const) {
  describe(`[#29158] ${posture}: invite-member refuses a blank role 400 ROLE_NOT_FOUND`, () => {
    let stack: VerifyStack;
    let ql: any;
    let token: string;
    let orgId: string;
    const previous = process.env.OS_TENANCY_POSTURE;

    const invitationsFor = async (email: string): Promise<Record<string, unknown>[]> =>
      ql.find('sys_invitation', { where: { email }, ...SYS });

    beforeAll(async () => {
      process.env.OS_TENANCY_POSTURE = posture;
      stack = await bootStack(crmStack as never, posture === 'single' ? {} : { multiTenant: 'posture-only' });
      const adminToken = await stack.signIn();
      ql = await stack.kernel.getServiceAsync<any>('objectql');

      if (posture === 'single') {
        // The seeded admin owns the Default Organization the boot created.
        token = adminToken;
        const [org] = await ql.find('sys_organization', { where: { slug: 'default' }, limit: 1, ...SYS });
        expect(org?.id, 'the boot created the Default Organization').toBeTruthy();
        orgId = String(org.id);
        return;
      }

      // Walled: a self-registrant creates a second organization and owns it —
      // the issuer the card measured.
      const opened = await stack.raw('/api/settings/auth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ values: { audience_posture: 'open' } }),
      });
      expect(opened.status, `open the audience: ${await opened.clone().text()}`).toBe(200);
      const email = 'blank-role-owner@dogfood.test';
      const signedUp = await stack.api('/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD, name: 'Blank Role Owner' }),
      });
      expect(signedUp.status, `sign-up: ${await signedUp.clone().text()}`).toBe(200);
      const user = await ql.findOne('sys_user', { where: { email }, ...SYS });
      await ql.update('sys_user', { id: user.id, email_verified: true }, SYS);
      token = await stack.signIn(email, PASSWORD);
      const created = await stack.apiAs(token, 'POST', '/auth/organization/create', {
        name: 'Blank Role Org',
        slug: 'blank-role-org',
      });
      expect(created.status, `organization/create: ${await created.clone().text()}`).toBe(200);
      orgId = String(((await created.json()) as { id?: string }).id ?? '');
      expect(orgId).not.toBe('');
    }, 180_000);

    afterAll(async () => {
      await stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard: the boot runs the posture under test', async () => {
      const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
    });

    for (const [label, role] of [['an empty role', ''], ['an empty entry in a role list', 'member,']] as const) {
      it(`${label} is refused 400 ROLE_NOT_FOUND and leaves no invitation row`, async () => {
        const email = `blank-${posture}-${role.length}@dogfood.test`;
        const res = await stack.apiAs(token, 'POST', '/auth/organization/invite-member', {
          email,
          role,
          organizationId: orgId,
        });
        const text = await res.clone().text();
        expect(res.status, text).toBe(400);
        const body = JSON.parse(text) as { code?: string; error?: { code?: string } };
        expect(body.code ?? body.error?.code, text).toBe('ROLE_NOT_FOUND');
        expect(await invitationsFor(email)).toEqual([]);
      }, 60_000);
    }

    it('CONTROL: a named role is unchanged — 200 and one pending row carrying it', async () => {
      const email = `named-${posture}@dogfood.test`;
      const res = await stack.apiAs(token, 'POST', '/auth/organization/invite-member', {
        email,
        role: 'member',
        organizationId: orgId,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const rows = await invitationsFor(email);
      expect(rows.map((r) => [r.role, r.status])).toEqual([['member', 'pending']]);
    }, 60_000);
  });
}
