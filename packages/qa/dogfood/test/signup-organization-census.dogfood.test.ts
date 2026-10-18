// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D9] The organization census of one self-registration, end to end
// on the real stack: a sign-up through `POST /auth/sign-up/email` lands three
// framework writes on tenant-column objects — the declared self-registration
// grant (`sys_user_permission_set`), the verification mail (`sys_email`) and
// the activity about the records the sign-up creates (`sys_activity`). Each
// producer names the organization it can derive, so on a `single` boot —
// where the Default Organization is the only organization there is — the
// sign-up leaves no row without one on any of the three tables.
//
// Under a wall the same sign-up has no organization to derive (the registrant
// belongs to none yet); those rows' fate is not settled by this file.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { AuditPlugin } from '@objectstack/plugin-audit';

const SYS = { context: { isSystem: true } };
const CENSUS_TABLES = ['sys_user_permission_set', 'sys_email', 'sys_activity'] as const;
const REGISTRANT = 'census-registrant@dogfood.test';

/** A transport that accepts every message, so the verification mail persists as sent. */
const acceptingTransport = {
  async send() {
    return { messageId: `census-${Math.random().toString(36).slice(2, 10)}` };
  },
};

describe('[ADR-0131 D9] a self-registration on a single boot leaves no organization-less row', () => {
  let stack: VerifyStack;
  let ql: any;
  let defaultOrgId: string;
  /** Row ids each census table held BEFORE the sign-up — the boot's own rows. */
  const beforeSignUp = new Map<string, Set<unknown>>();
  const rowsOf = async (table: string): Promise<Array<Record<string, unknown>>> =>
    ql.find(table, { limit: 1000, ...SYS });

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, {
      extraPlugins: [new AuditPlugin(), new EmailServicePlugin({
        transport: acceptingTransport as never,
        defaultFrom: { address: 'no-reply@example.test', name: 'Census' },
      })],
    });
    const adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    const tenancy = await stack.kernel.getServiceAsync<{ defaultOrgId(): Promise<string | null> }>('tenancy');
    defaultOrgId = (await tenancy.defaultOrgId()) ?? '';

    // An open audience: a stranger self-registers, receives the declared set,
    // and is sent the verification mail the open posture requires.
    const opened = await stack.raw('/api/settings/auth', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        values: { audience_posture: 'open', audience_self_registration_permission_set: 'member_default' },
      }),
    });
    expect(opened.status, `open the audience: ${await opened.clone().text()}`).toBe(200);

    // The census is of what the SIGN-UP writes. The boot's own rows — above all
    // the platform admin's promotion grant, whose owner is settled by its own
    // stage (ADR-0131 D5) — are set aside here, by id.
    for (const table of CENSUS_TABLES) beforeSignUp.set(table, new Set((await rowsOf(table)).map((r) => r.id)));

    const signedUp = await stack.api('/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: REGISTRANT, password: 'Census-Passw0rd!', name: 'Census Registrant' }),
    });
    expect(signedUp.status, `sign-up: ${await signedUp.clone().text()}`).toBe(200);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard: the boot is single, and the sign-up reached all three writers', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string }>('tenancy');
    expect(tenancy.posture).toBe('single');
    expect(defaultOrgId).not.toBe('');

    const registrant = await ql.findOne('sys_user', { where: { email: REGISTRANT }, ...SYS });
    expect(registrant?.id, 'the registrant exists').toBeTruthy();
    const grants = await ql.find('sys_user_permission_set', { where: { user_id: registrant.id }, ...SYS });
    expect(grants.map((g: any) => g.permission_set)).toEqual(['member_default']);
    const mails = await ql.find('sys_email', { where: { related_object: 'sys_user', related_id: registrant.id }, ...SYS });
    expect(mails.length, 'the verification mail persisted').toBeGreaterThan(0);
    const activity = await ql.find('sys_activity', { where: { object_name: 'sys_user', record_id: registrant.id }, ...SYS });
    expect(activity.length, 'the registrant\'s creation is on the activity stream').toBeGreaterThan(0);
  });

  it('every row the sign-up wrote on the three tables names the Default Organization', async () => {
    const census: Record<string, { written: number; orgLess: unknown[]; foreign: unknown[] }> = {};
    for (const table of CENSUS_TABLES) {
      const written = (await rowsOf(table)).filter((r) => !beforeSignUp.get(table)!.has(r.id));
      census[table] = {
        written: written.length,
        orgLess: written.filter((r) => r.organization_id == null || r.organization_id === '').map((r) => r.id),
        foreign: written.filter((r) => r.organization_id != null && r.organization_id !== defaultOrgId).map((r) => r.id),
      };
    }
    for (const table of CENSUS_TABLES) {
      expect(census[table].written, `${table}: the sign-up wrote rows here`).toBeGreaterThan(0);
      expect(census[table].orgLess, `${table}: rows without an organization`).toEqual([]);
      expect(census[table].foreign, `${table}: rows owned by another organization`).toEqual([]);
    }
  });
});
