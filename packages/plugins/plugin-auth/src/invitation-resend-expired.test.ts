// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #28540 — Resend on an invitation that has already expired. better-auth's
// `findPendingInvitation` skips a row past its `expiresAt`, so a resend (or a
// plain invite) for that person issues a NEW invitation. The platform's after
// hook then moves the person's expired pending rows in that organization to
// `expired` (`invitation-expired-supersede.ts`), so the Pending list holds one
// row per person. Controls: a resend on an unexpired row renews it (one row,
// the same id); an invite for another address, or in another organization,
// touches no other row; a refused call retires nothing.
//
// Every invitation is issued and resent through the vendor's own route on a
// real `AuthManager` over the installed better-auth, so the rows read here are
// the rows the product writes. The harness is `invitation-delivery-outcome.test.ts`'s
// `stage()`, cut to the two people these cases need.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetCloudManagedForTesting } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-28540';
const ORIGIN = 'https://crm.acme.test';
const BASE = '/api/v1/auth';
const DEFAULT_ORG = 'org_default';
const ACME_ORG = 'org_acme';
const MANAGED_ENV = 'OS_CLOUD_MANAGED';

const singleOrgTenancy = () =>
  ({
    posture: 'single',
    requestedPosture: 'single',
    isolationActive: false,
    requested: false,
    degraded: false,
    defaultOrgId: async () => DEFAULT_ORG,
  }) as any;

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** One deployment: `Alice Owner` owns `Acme Corp` and the default organization; Mo is a plain Acme member. */
async function stage() {
  const engine = createMemoryEngine();
  engine.tables.set('sys_organization', [
    { id: DEFAULT_ORG, name: 'Default', slug: 'default' },
    { id: ACME_ORG, name: 'Acme Corp', slug: 'acme' },
  ]);
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as any,
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
  } as any);

  const direct = (method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );

  const signUp = async (email: string, name: string) => {
    await inviteForAudienceGate(engine, email);
    const res = await direct('POST', '/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
    const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
    expect(user, `sign-up did not create ${email}`).toBeDefined();
    return { cookie: cookieFrom(res), userId: String(user!.id) };
  };
  const bind = (userId: string, organizationId: string, role: string) =>
    engine.insert('sys_member', {
      id: `mem_${userId}_${organizationId}`,
      organization_id: organizationId,
      user_id: userId,
      role,
      created_at: new Date(),
    });

  const owner = await signUp('alice.owner@example.com', 'Alice Owner');
  const ownerDefault = (engine.tables.get('sys_member') ?? []).find(
    (m: any) => m.organization_id === DEFAULT_ORG && m.user_id === owner.userId,
  );
  expect(ownerDefault, 'the reconciler did not bind the owner to the default organization').toBeDefined();
  ownerDefault!.role = 'owner';
  await bind(owner.userId, ACME_ORG, 'owner');
  const member = await signUp('mo.member@example.com', 'Mo Member');
  await bind(member.userId, ACME_ORG, 'member');

  /** Invite (or resend) through the vendor's own route, as the owner. */
  const invite = async (email: string, extra: Record<string, unknown> = {}) => {
    const res = await direct(
      'POST',
      '/organization/invite-member',
      { email, role: 'member', organizationId: ACME_ORG, ...extra },
      owner.cookie,
    );
    const text = await res.clone().text();
    return { status: res.status, body: JSON.parse(text), text };
  };

  const invitationRow = (id: string) =>
    (engine.tables.get('sys_invitation') ?? []).find((r: any) => r.id === id) as Record<string, any>;

  return { engine, direct, invite, owner, member, invitationRow };
}

let savedManaged: string | undefined;
beforeEach(() => {
  savedManaged = process.env[MANAGED_ENV];
  delete process.env[MANAGED_ENV];
  resetCloudManagedForTesting();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  if (savedManaged === undefined) delete process.env[MANAGED_ENV];
  else process.env[MANAGED_ENV] = savedManaged;
  resetCloudManagedForTesting();
  vi.restoreAllMocks();
});

describe('#28540 — a new invitation replaces the same person\'s expired pending one', () => {
  /** Move a pending row's `expires_at` into the past, leaving its status as it is. */
  const expire = (row: Record<string, any>) => {
    row.expires_at = new Date(Date.now() - 60_000);
  };
  const rowsFor = (engine: any, email: string, organizationId = ACME_ORG) =>
    (engine.tables.get('sys_invitation') ?? []).filter(
      (r: any) => r.email === email && r.organization_id === organizationId,
    ) as Record<string, any>[];
  const pendingIds = (engine: any, email: string, organizationId = ACME_ORG) =>
    rowsFor(engine, email, organizationId).filter((r) => r.status === 'pending').map((r) => String(r.id));

  it('a resend on an expired pending row leaves one pending row, and the expired one reads expired', async () => {
    const { engine, invite, invitationRow } = await stage();
    const stale = String((await invite('bob.builder@acme.test')).body.id);
    expire(invitationRow(stale));

    const resent = await invite('bob.builder@acme.test', { resend: true });
    expect(resent.status, resent.text).toBe(200);
    const fresh = String(resent.body.id);
    expect(fresh).not.toBe(stale);
    expect(pendingIds(engine, 'bob.builder@acme.test')).toEqual([fresh]);
    expect(invitationRow(stale).status).toBe('expired');
  });

  it('a resend on an unexpired pending row renews that row: one row, the same id, a later expiry', async () => {
    const { engine, invite, invitationRow } = await stage();
    const id = String((await invite('bob.builder@acme.test')).body.id);
    const soon = new Date(Date.now() + 60_000);
    invitationRow(id).expires_at = soon;

    const resent = await invite('bob.builder@acme.test', { resend: true });
    expect(resent.status, resent.text).toBe(200);
    expect(String(resent.body.id)).toBe(id);
    expect(rowsFor(engine, 'bob.builder@acme.test').map((r) => [String(r.id), r.status])).toEqual([[id, 'pending']]);
    expect(new Date(invitationRow(id).expires_at).getTime()).toBeGreaterThan(soon.getTime());
  });

  it('a plain invite after the earlier invitation expired leaves one pending row too', async () => {
    const { engine, invite, invitationRow } = await stage();
    const stale = String((await invite('bob.builder@acme.test')).body.id);
    expire(invitationRow(stale));

    const again = await invite('bob.builder@acme.test');
    expect(again.status, again.text).toBe(200);
    expect(pendingIds(engine, 'bob.builder@acme.test')).toEqual([String(again.body.id)]);
    expect(invitationRow(stale).status).toBe('expired');
  });

  it('a plain invite for a new address changes no other row: another person and another organization keep theirs', async () => {
    const { engine, invite, invitationRow, direct, owner } = await stage();
    const other = String((await invite('carol.other@acme.test')).body.id);
    expire(invitationRow(other));
    const elsewhere = await direct(
      'POST',
      '/organization/invite-member',
      { email: 'bob.builder@acme.test', role: 'member', organizationId: DEFAULT_ORG },
      owner.cookie,
    );
    expect(elsewhere.status, await elsewhere.clone().text()).toBe(200);
    const elsewhereId = String((await elsewhere.json()).id);
    expire(invitationRow(elsewhereId));

    const fresh = await invite('bob.builder@acme.test');
    expect(fresh.status, fresh.text).toBe(200);
    expect(pendingIds(engine, 'bob.builder@acme.test')).toEqual([String(fresh.body.id)]);
    expect(invitationRow(other).status).toBe('pending');
    expect(invitationRow(elsewhereId).status).toBe('pending');
  });

  it('a refused resend retires nothing: the expired row still reads pending', async () => {
    const { engine, direct, invite, member, invitationRow } = await stage();
    const stale = String((await invite('bob.builder@acme.test')).body.id);
    expire(invitationRow(stale));

    const refused = await direct(
      'POST',
      '/organization/invite-member',
      { email: 'bob.builder@acme.test', role: 'member', organizationId: ACME_ORG, resend: true },
      member.cookie,
    );
    expect(refused.status).toBe(403);
    expect(rowsFor(engine, 'bob.builder@acme.test').map((r) => [String(r.id), r.status])).toEqual([[stale, 'pending']]);
  });
});
