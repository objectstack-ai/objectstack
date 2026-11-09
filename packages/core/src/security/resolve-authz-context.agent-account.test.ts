// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] The grants resolver reads an AI service account for what it
 * is: `principalKind: 'agent'`, explicit grants only — no `everyone` anchor,
 * no system permission, and no administrator standing from any anchor — while
 * a person holding the very same rows resolves exactly as before (CONTROL).
 *
 * The account's rows are ones no registration door would write (an
 * organization `owner` role, the Default Organization's `admin_full_access`
 * grant, a configured administrator address) and a store can still hold: the
 * resolver is the guarantee, not the doors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ORGANIZATION_ADMIN_GRANTS } from '@objectstack/spec/identity';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { hasPlatformAdminStanding, isAgentAccountRow, resolveAuthzContext, resolveUserAuthzGrants } from './resolve-authz-context.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';
const NOW = Date.parse('2026-11-09T00:00:00.000Z');

/** The rows of `u_bot` (an account) and `u_mia` (a person) are the same, the kind aside. */
function tables(): Record<string, Array<Record<string, unknown>>> {
  return {
    sys_user: [
      { id: 'u_bot', email: 'owner@corp.example', email_verified: true, principal_kind: 'agent', accountable_user_id: 'u_mia' },
      { id: 'u_mia', email: 'mia@corp.example', email_verified: true, principal_kind: 'human' },
    ],
    sys_member: [
      { user_id: 'u_bot', organization_id: 'org_a', role: 'owner' },
      { user_id: 'u_mia', organization_id: 'org_a', role: 'owner' },
    ],
    sys_user_permission_set: [
      { user_id: 'u_bot', permission_set: 'ops_tools', organization_id: 'org_a' },
      { user_id: 'u_bot', permission_set: 'admin_full_access', organization_id: 'org_default' },
      { user_id: 'u_mia', permission_set: 'ops_tools', organization_id: 'org_a' },
      { user_id: 'u_mia', permission_set: 'admin_full_access', organization_id: 'org_default' },
    ],
    sys_organization: [{ id: 'org_default', slug: 'default' }],
    sys_permission_set: [
      { id: 'ps_ops', name: 'ops_tools', system_permissions: JSON.stringify(['manage_users']) },
      { id: 'ps_admin', name: 'admin_full_access' },
      { id: 'ps_everyone', name: 'everyone_reader' },
    ],
    sys_position: [{ id: 'pos_everyone', name: 'everyone' }],
    sys_position_permission_set: [{ position_id: 'pos_everyone', permission_set_id: 'ps_everyone' }],
  };
}

function makeQl(t = tables()) {
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      if (v === null) return (row[k] ?? null) === null;
      return row[k] === v;
    });
  return bindCatalogFromTables({
    async find(object: string, opts: any) {
      const rows = (t[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  }, t);
}

let ambient: string | undefined;
beforeEach(() => {
  ambient = process.env[ENV];
  delete process.env[ENV];
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  if (ambient === undefined) delete process.env[ENV];
  else process.env[ENV] = ambient;
  resetPlatformAdminEmailMemo();
});

describe('[ADR-0151 D3] resolveUserAuthzGrants — an AI service account', () => {
  it('is the agent kind, holds no everyone anchor, no system permission and no administrator standing', async () => {
    const grants = await resolveUserAuthzGrants(makeQl(), 'u_bot', { tenantId: 'org_a', nowMs: NOW });
    expect(grants.principalKind).toBe('agent');
    expect(grants.positions).not.toContain('everyone');
    expect(grants.positions).not.toContain('platform_admin');
    expect(grants.permissions).not.toContain('everyone_reader');
    // Its ordinary grants stay named (they are clamped where they are
    // evaluated); an administrative set never does, since standing is also
    // read by name.
    expect(grants.permissions).toContain('ops_tools');
    expect(grants.permissions).not.toContain('admin_full_access');
    expect(grants.systemPermissions).toEqual([]);
    expect(grants.posture).toBe('MEMBER');
  });

  it('a configured administrator address on the account confers nothing either', async () => {
    process.env[ENV] = 'owner@corp.example';
    resetPlatformAdminEmailMemo();
    const grants = await resolveUserAuthzGrants(makeQl(), 'u_bot', { tenantId: 'org_a', nowMs: NOW });
    expect(grants.posture).not.toBe('PLATFORM_ADMIN');
    expect(await hasPlatformAdminStanding(makeQl(), 'u_bot', { nowMs: NOW })).toBe(false);
  });

  it('an organization administrator set confers no organization standing on it, while a person holding it rises', async () => {
    const t = tables();
    t.sys_user_permission_set = [
      { user_id: 'u_bot', permission_set: 'organization_admin', organization_id: 'org_a' },
      { user_id: 'u_mia', permission_set: 'organization_admin', organization_id: 'org_a' },
    ];
    t.sys_permission_set.push({ id: 'ps_org_admin', name: 'organization_admin' });
    const account = await resolveUserAuthzGrants(makeQl(t), 'u_bot', { tenantId: 'org_a', nowMs: NOW });
    const person = await resolveUserAuthzGrants(makeQl(t), 'u_mia', { tenantId: 'org_a', nowMs: NOW });
    expect(account.permissions).not.toContain('organization_admin');
    expect(person.permissions).toContain('organization_admin');
    expect(account.posture).toBe('MEMBER');
    expect(person.posture).not.toBe('MEMBER');
    expect(person.posture).not.toBe('PLATFORM_ADMIN');
  });

  it('never carries an administrative set by name, on any spelling of the organization-administrator rung, while a person keeps it', async () => {
    for (const name of ORGANIZATION_ADMIN_GRANTS) {
      const t = tables();
      t.sys_user_permission_set = [
        { user_id: 'u_bot', permission_set: name, organization_id: 'org_a' },
        { user_id: 'u_mia', permission_set: name, organization_id: 'org_a' },
      ];
      t.sys_permission_set.push({ id: `ps_${name}`, name });
      const account = await resolveUserAuthzGrants(makeQl(t), 'u_bot', { tenantId: 'org_a', nowMs: NOW });
      const person = await resolveUserAuthzGrants(makeQl(t), 'u_mia', { tenantId: 'org_a', nowMs: NOW });
      expect(account.permissions, name).not.toContain(name);
      expect(person.permissions, name).toContain(name);
    }
  });

  it('a seeded caller cannot skip the kind: the row is read whatever is seeded', async () => {
    const grants = await resolveUserAuthzGrants(makeQl(), 'u_bot', {
      tenantId: 'org_a', nowMs: NOW, seedEmail: 'seeded@corp.example', seedPermissions: ['ai_seat'],
    });
    expect(grants.principalKind).toBe('agent');
    expect(grants.positions).not.toContain('everyone');
  });

  it('the request envelope carries the kind', async () => {
    const ctx = await resolveAuthzContext({
      userAuthGates: undefined,
      apiKeyLifecycle: undefined,
      ql: makeQl(),
      headers: new Headers(),
      getSession: async () => ({ user: { id: 'u_bot' }, session: { activeOrganizationId: 'org_a' } }),
      nowMs: NOW,
    } as any);
    expect(ctx.userId).toBe('u_bot');
    expect(ctx.principalKind).toBe('agent');
    expect(ctx.systemPermissions).toEqual([]);
  });

  it('reads the kind off either spelling of the column, and nothing else as an account', () => {
    expect(isAgentAccountRow({ principal_kind: 'agent' })).toBe(true);
    expect(isAgentAccountRow({ principalKind: 'agent' })).toBe(true);
    for (const row of [{ principal_kind: 'human' }, { principal_kind: null }, {}, null, undefined, 'agent', { principal_kind: 'AGENT' }]) {
      expect(isAgentAccountRow(row)).toBe(false);
    }
  });
});

describe('CONTROL — a person holding the same rows is unchanged', () => {
  it('human kind (absent), the everyone anchor, the system permission, and the anchored platform standing', async () => {
    const grants = await resolveUserAuthzGrants(makeQl(), 'u_mia', { tenantId: 'org_a', nowMs: NOW });
    expect(grants.principalKind).toBeUndefined();
    expect(grants.positions).toContain('everyone');
    expect(grants.permissions).toContain('everyone_reader');
    expect(grants.systemPermissions).toContain('manage_users');
    expect(grants.posture).toBe('PLATFORM_ADMIN');
    expect(await hasPlatformAdminStanding(makeQl(), 'u_mia', { nowMs: NOW })).toBe(true);
  });

  it('a row written before the column existed reads as a person', async () => {
    const t = tables();
    t.sys_user = t.sys_user.map((r) => (r.id === 'u_mia' ? { id: r.id, email: r.email, email_verified: true } : r));
    const grants = await resolveUserAuthzGrants(makeQl(t), 'u_mia', { tenantId: 'org_a', nowMs: NOW });
    expect(grants.principalKind).toBeUndefined();
    expect(grants.positions).toContain('everyone');
  });
});
