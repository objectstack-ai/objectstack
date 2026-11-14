// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The organization's pending-invitation limit, set by the host through
// `OS_ORG_INVITATION_LIMIT`. better-auth refuses a new invitation with
// 403 `INVITATION_LIMIT_REACHED` once the organization's pending invitations
// reach its `invitationLimit`, and uses 100 when none is passed.
//
// Every case issues the deciding invitation through the vendor's own
// `/organization/invite-member` route on a real `AuthManager` over the installed
// better-auth. The pending rows before it are the first real invitation's row,
// cloned with new ids and addresses, so the count is the one the vendor reads.
// The harness is `invitation-resend-expired.test.ts`'s `stage()`, cut to one owner.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetCloudManagedForTesting } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { INVITATION_LIMIT_UNBOUNDED, resolveInvitationLimitOption } from './invitation-limit';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-33196';
const ORIGIN = 'https://crm.acme.test';
const BASE = '/api/v1/auth';
const DEFAULT_ORG = 'org_default';
const ACME_ORG = 'org_acme';
const KEY = 'OS_ORG_INVITATION_LIMIT';

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
  const email = 'alice.owner@example.com';
  const invitationId = await inviteForAudienceGate(engine, email);
  const res = await direct('POST', '/sign-up/email', { email, password: PASSWORD, name: 'Alice Owner', invitationId });
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
  await engine.insert('sys_member', {
    id: `mem_owner_acme`, organization_id: ACME_ORG, user_id: String(user!.id), role: 'owner', created_at: new Date(),
  });
  const invite = async (to: string) => {
    const r = await direct('POST', '/organization/invite-member', { email: to, role: 'member', organizationId: ACME_ORG }, cookie);
    const text = await r.clone().text();
    return { status: r.status, text };
  };
  const pendingInAcme = () =>
    (engine.tables.get('sys_invitation') ?? []).filter((r: any) => r.organization_id === ACME_ORG && r.status === 'pending').length;
  /** Bring Acme to `count` pending invitations: one through the route, the rest its clones. */
  const fillPending = async (count: number) => {
    const first = await invite('pending.1@example.com');
    expect(first.status, first.text).toBe(200);
    const rows = engine.tables.get('sys_invitation')!;
    const model = rows.find((r: any) => r.organization_id === ACME_ORG && r.email === 'pending.1@example.com');
    for (let i = 2; i <= count; i++) {
      rows.push({ ...model, id: `inv_fill_${i}`, email: `pending.${i}@example.com` });
    }
    expect(pendingInAcme()).toBe(count);
  };
  return { engine, invite, pendingInAcme, fillPending };
}

let savedLimit: string | undefined;

beforeEach(() => {
  savedLimit = process.env[KEY];
  delete process.env[KEY];
  delete process.env.OS_CLOUD_MANAGED;
  resetCloudManagedForTesting();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  if (savedLimit === undefined) delete process.env[KEY];
  else process.env[KEY] = savedLimit;
  resetCloudManagedForTesting();
  vi.restoreAllMocks();
});

describe('resolveInvitationLimitOption — what the organization plugin is handed', () => {
  it('passes nothing when the host says nothing, so the vendor default stays', () => {
    expect(resolveInvitationLimitOption()).toBeUndefined();
  });

  it('passes the host\'s number as the limit', () => {
    process.env[KEY] = '3';
    expect(resolveInvitationLimitOption()).toBe(3);
  });

  it('passes a finite number far past any real count for "off"', () => {
    process.env[KEY] = 'off';
    expect(resolveInvitationLimitOption()).toBe(INVITATION_LIMIT_UNBOUNDED);
    expect(Number.isFinite(INVITATION_LIMIT_UNBOUNDED)).toBe(true);
    expect(INVITATION_LIMIT_UNBOUNDED).toBeGreaterThan(1_000_000);
  });

  it('passes nothing for 0 or a typo, never a limit that refuses every invitation', () => {
    for (const bad of ['0', 'abc', '-1', '1e3', '2.5']) {
      process.env[KEY] = bad;
      expect(resolveInvitationLimitOption(), `value=${JSON.stringify(bad)}`).toBeUndefined();
    }
  });
});

describe('the pending-invitation limit at the invitation door', () => {
  it('CONTROL — unset: the 101st pending invitation is refused exactly as before (403 INVITATION_LIMIT_REACHED)', async () => {
    const { invite, pendingInAcme, fillPending } = await stage();
    await fillPending(100);
    const r = await invite('one.too.many@example.com');
    expect(r.status, r.text).toBe(403);
    expect(JSON.parse(r.text)).toMatchObject({ code: 'INVITATION_LIMIT_REACHED', message: 'Invitation limit reached' });
    expect(pendingInAcme()).toBe(100);
  }, 60_000);

  it('CONTROL — unset: the 100th is still accepted, so the refusal above is the limit and not the harness', async () => {
    const { invite, pendingInAcme, fillPending } = await stage();
    await fillPending(99);
    const r = await invite('the.hundredth@example.com');
    expect(r.status, r.text).toBe(200);
    expect(pendingInAcme()).toBe(100);
  }, 60_000);

  it('off: the 101st pending invitation is accepted', async () => {
    process.env[KEY] = 'off';
    const { invite, pendingInAcme, fillPending } = await stage();
    await fillPending(100);
    const r = await invite('one.more@example.com');
    expect(r.status, r.text).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ email: 'one.more@example.com', status: 'pending' });
    expect(pendingInAcme()).toBe(101);
  }, 60_000);

  it('a number N: the (N+1)th pending invitation is refused with the same code, the Nth accepted', async () => {
    process.env[KEY] = '3';
    const { invite, pendingInAcme, fillPending } = await stage();
    await fillPending(2);
    const third = await invite('third@example.com');
    expect(third.status, third.text).toBe(200);
    const fourth = await invite('fourth@example.com');
    expect(fourth.status, fourth.text).toBe(403);
    expect(JSON.parse(fourth.text)).toMatchObject({ code: 'INVITATION_LIMIT_REACHED' });
    expect(pendingInAcme()).toBe(3);
  }, 60_000);
});
