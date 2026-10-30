// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #27862 — a role change names the permission set it granted. The card's two
// acceptance rows:
//
//  (a) a role change that triggers the org-admin auto-grant answers the
//      granted set's name and catalog label beside the member row
//      (`outcome: 'permission_set_granted'`);
//  (b) a role change that grants nothing (admin → owner keeps the set it
//      already held, a demotion revokes it) answers the member row alone, and
//      so does a refusal.
//
// The role is changed through the vendor's own route on a real `AuthManager`
// over the installed better-auth. The grant is written by plugin-security's
// own reconciler (`reconcileOrgAdminGrant`), fired after each `sys_member`
// update exactly as the security plugin's middleware fires it, so the rows the
// hooks read are the rows the product writes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import { reconcileOrgAdminGrant } from '@objectstack/plugin-security';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit';
import {
  PERMISSION_SET_GRANTED_OUTCOME,
  UPDATE_MEMBER_ROLE_PATH,
  snapshotRoleChangeGrants,
  stampRoleChangeGrantedSet,
  type RoleChangeGrantDeps,
} from './role-change-granted-set';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-27862';
const ORIGIN = 'https://crm.acme.test';
const BASE = '/api/v1/auth';
const DEFAULT_ORG = 'org_default';
const ACME_ORG = 'org_acme';
const NO_BYPASS_LABEL = 'Organization Administrator (no record bypass)';

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

/** `Alice Owner` owns `Acme Corp`; Mo is a plain member there. */
async function stage() {
  const engine = createMemoryEngine();
  // The catalog the reconciler checks the set against and the label is read from.
  bindTestSecurityCatalog(engine, {
    permissions: [
      { name: ORGANIZATION_ADMIN, label: 'Organization Administrator' },
      { name: ORGANIZATION_ADMIN_NO_BYPASS, label: NO_BYPASS_LABEL },
    ],
  });
  // plugin-security's sys_member middleware, as it fires: after the write,
  // reconcile the pair the row names (the single posture: the no-bypass set).
  const update = engine.update.bind(engine);
  engine.update = (async (name: string, data: any, options?: any) => {
    const result = await update(name, data, options);
    if (name === 'sys_member' && result && typeof result === 'object') {
      await reconcileOrgAdminGrant(engine, result.user_id, result.organization_id, { posture: 'single' });
    }
    return result;
  }) as typeof engine.update;
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

  const post = (path: string, body: unknown, cookie?: string) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const signUp = async (email: string, name: string) => {
    await inviteForAudienceGate(engine, email);
    const res = await post('/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
    const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
    return { cookie: cookieFrom(res), userId: String(user!.id) };
  };
  const bind = (userId: string, role: string) =>
    engine.insert('sys_member', {
      id: `mem_${userId}_${ACME_ORG}`,
      organization_id: ACME_ORG,
      user_id: userId,
      role,
      created_at: new Date(),
    });

  const owner = await signUp('alice.owner@example.com', 'Alice Owner');
  await bind(owner.userId, 'owner');
  const member = await signUp('mo.member@example.com', 'Mo Member');
  await bind(member.userId, 'member');
  const memberRowId = `mem_${member.userId}_${ACME_ORG}`;

  const changeRole = async (role: string, cookie = owner.cookie) => {
    const res = await post(UPDATE_MEMBER_ROLE_PATH, { memberId: memberRowId, role, organizationId: ACME_ORG }, cookie);
    const text = await res.clone().text();
    return { status: res.status, body: JSON.parse(text), text };
  };
  const grantsOf = (userId: string) =>
    (engine.tables.get('sys_user_permission_set') ?? [])
      .filter((g: any) => g.user_id === userId && g.organization_id === ACME_ORG)
      .map((g: any) => g.permission_set)
      .sort();

  return { engine, owner, member, changeRole, grantsOf };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('#27862 (a) — a role change that auto-grants names the set', () => {
  it('member → admin: the answer names the granted set by name and label, beside the member row', async () => {
    const { member, changeRole, grantsOf } = await stage();
    expect(grantsOf(member.userId)).toEqual([]);
    const answer = await changeRole('admin');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.outcome).toBe(PERMISSION_SET_GRANTED_OUTCOME);
    expect(answer.body.grantedPermissionSet).toEqual({ name: ORGANIZATION_ADMIN_NO_BYPASS, label: NO_BYPASS_LABEL });
    // The row the answer already carried is untouched.
    expect(answer.body.role).toBe('admin');
    expect(answer.body.userId).toBe(member.userId);
    // What the line names is what the reconciler wrote, and nothing more.
    expect(grantsOf(member.userId)).toEqual([ORGANIZATION_ADMIN_NO_BYPASS]);
  });

  it('member → owner names it too (Make Owner is the same route)', async () => {
    const { changeRole } = await stage();
    const answer = await changeRole('owner');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.outcome).toBe(PERMISSION_SET_GRANTED_OUTCOME);
    expect(answer.body.grantedPermissionSet?.name).toBe(ORGANIZATION_ADMIN_NO_BYPASS);
  });
});

describe('#27862 (b) — a role change that grants nothing answers the row alone', () => {
  it('admin → owner keeps the set it already held: no line', async () => {
    const { member, changeRole, grantsOf } = await stage();
    expect((await changeRole('admin')).body.outcome).toBe(PERMISSION_SET_GRANTED_OUTCOME);
    const answer = await changeRole('owner');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body).not.toHaveProperty('outcome');
    expect(answer.body).not.toHaveProperty('grantedPermissionSet');
    expect(answer.body.role).toBe('owner');
    expect(grantsOf(member.userId)).toEqual([ORGANIZATION_ADMIN_NO_BYPASS]);
  });

  it('admin → member revokes it: no line', async () => {
    const { member, changeRole, grantsOf } = await stage();
    await changeRole('admin');
    const answer = await changeRole('member');
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body).not.toHaveProperty('outcome');
    expect(answer.body).not.toHaveProperty('grantedPermissionSet');
    expect(grantsOf(member.userId)).toEqual([]);
  });

  it('a refusal carries no line and grants nothing', async () => {
    const { member, changeRole, grantsOf } = await stage();
    const refused = await changeRole('admin', member.cookie);
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body).not.toHaveProperty('outcome');
    expect(refused.body).not.toHaveProperty('grantedPermissionSet');
    expect(grantsOf(member.userId)).toEqual([]);
  });
});

describe('#27862 — the hooks fail toward silence', () => {
  const deps = (over: Partial<RoleChangeGrantDeps> = {}): RoleChangeGrantDeps => ({
    readMemberPair: async () => ({ userId: 'u1', organizationId: 'o1' }),
    readGrantedSetNames: async () => [],
    readSetLabel: async () => 'Label',
    ...over,
  });
  const ctxFor = (returned: unknown) => ({
    path: UPDATE_MEMBER_ROLE_PATH,
    body: { memberId: 'm1' },
    context: { returned } as Record<string, unknown>,
  });

  it('a before-read that throws stashes nothing, so the answer is untouched', async () => {
    const ctx = ctxFor({ id: 'm1', role: 'admin' });
    await snapshotRoleChangeGrants(ctx, deps({ readGrantedSetNames: async () => { throw new Error('down'); } }));
    await stampRoleChangeGrantedSet(ctx, deps({ readGrantedSetNames: async () => [ORGANIZATION_ADMIN] }));
    expect(ctx.context.returned).toEqual({ id: 'm1', role: 'admin' });
  });

  it('an after-read that throws leaves the answer untouched', async () => {
    const ctx = ctxFor({ id: 'm1', role: 'admin' });
    await snapshotRoleChangeGrants(ctx, deps());
    await stampRoleChangeGrantedSet(ctx, deps({ readGrantedSetNames: async () => { throw new Error('down'); } }));
    expect(ctx.context.returned).toEqual({ id: 'm1', role: 'admin' });
  });

  it('a set the catalog gives no label is named by its name', async () => {
    const ctx = ctxFor({ id: 'm1', role: 'admin' });
    await snapshotRoleChangeGrants(ctx, deps());
    await stampRoleChangeGrantedSet(ctx, deps({
      readGrantedSetNames: async () => [ORGANIZATION_ADMIN],
      readSetLabel: async () => undefined,
    }));
    expect((ctx.context.returned as any).grantedPermissionSet).toEqual({ name: ORGANIZATION_ADMIN, label: ORGANIZATION_ADMIN });
  });

  it('another route is never touched', async () => {
    const ctx = { ...ctxFor({ id: 'm1' }), path: '/organization/update-member' };
    await snapshotRoleChangeGrants(ctx, deps());
    await stampRoleChangeGrantedSet(ctx, deps({ readGrantedSetNames: async () => [ORGANIZATION_ADMIN] }));
    expect(ctx.context.returned).toEqual({ id: 'm1' });
  });
});
