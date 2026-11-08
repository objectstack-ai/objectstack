// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D6/D12] `describeEffectiveAccess` — one user's effective
 * permission sets, each with every origin it arrives through, gated by
 * explain's caller gate. The spec member's docblock
 * (`ISecurityService.describeEffectiveAccess`) is the contract pinned here:
 *
 *  - a default-binding set, a position set and a direct set are each listed
 *    with the right origin, and a user holding only a direct set lists one;
 *  - a set reached two ways is listed once, with both origins;
 *  - a name the resolver derives from standing carries a `derived` origin;
 *  - an id no user has is refused exactly as one the caller may not manage,
 *    for every caller — `manage_users` included, which is where this read
 *    departs from explain's `404`.
 *
 * The body runs against a fake engine through the resolver itself
 * (`resolveUserAuthzGrants`), so the origins are the resolution's own.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator';
import { describeEffectiveAccess, type EffectiveAccessHost } from './security-plugin-effective-access';
import { PermissionDeniedError } from './errors';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const ORG = 'org_a';
const set = (name: string, systemPermissions: string[] = []) =>
  PermissionSetSchema.parse({ name, systemPermissions, objects: { leave_request: { allowRead: true } } });

const MEMBER_DEFAULT = set('member_default');
const APP_DEFAULT = set('app_default');
const CRM = set('crm_sales_user');
const FORECASTING = set('forecasting');
const AUDITOR = set('auditor');
const USER_ADMIN = set('user_admin', ['manage_users']);

type Tables = Record<string, Array<Record<string, unknown>>>;

function engine(tables: Tables, catalog: { positions: Array<{ name: string; permissionSets: string[] }>; permissions: PermissionSet[] }) {
  const match = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return v === null ? (row[k] ?? null) === null : row[k] === v;
    });
  return bindTestSecurityCatalog({
    getSchema: () => ({ name: 'leave_request' }),
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((row) => match(row, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async findOne(object: string, opts: any) {
      return (tables[object] ?? []).find((row) => match(row, opts?.where)) ?? null;
    },
  }, catalog);
}

/** A deployment whose `everyone` anchor binds `member_default` and `app_default`, and whose baseline is `member_default`. */
function defaultsDeployment(extraTables: Tables = {}) {
  const tables: Tables = {
    sys_user: [
      { id: 'u_three', email: 'three@example.test' },
      { id: 'u_two_ways', email: 'two@example.test' },
      { id: 'u_ai', email: 'ai@example.test', ai_access: true },
      { id: 'u_owner', email: 'owner@example.test', email_verified: true },
      { id: 'u_admin', email: 'admin@example.test' },
      { id: 'u_member', email: 'member@example.test' },
    ],
    sys_member: ['u_three', 'u_two_ways', 'u_ai', 'u_owner', 'u_admin', 'u_member']
      .map((user_id) => ({ user_id, organization_id: ORG, role: 'member' })),
    sys_user_position: [
      { user_id: 'u_three', position: 'sales_rep', organization_id: ORG },
      { user_id: 'u_two_ways', position: 'sales_rep', organization_id: ORG },
      { user_id: 'u_two_ways', position: 'sales_lead', organization_id: ORG },
    ],
    sys_user_permission_set: [
      { user_id: 'u_three', permission_set: 'forecasting', organization_id: ORG },
      { user_id: 'u_two_ways', permission_set: 'crm_sales_user', organization_id: ORG },
    ],
    ...extraTables,
  };
  const ql = engine(tables, {
    positions: [
      { name: 'everyone', permissionSets: ['member_default', 'app_default'] },
      { name: 'sales_rep', permissionSets: ['crm_sales_user'] },
      { name: 'sales_lead', permissionSets: ['crm_sales_user', 'auditor'] },
    ],
    permissions: [MEMBER_DEFAULT, APP_DEFAULT, CRM, FORECASTING, AUDITOR, USER_ADMIN],
  });
  return { ql, baseline: ['member_default'] };
}

/** The caller's sets, as the request path resolves them: `user_admin` for an administrator, nothing beyond the baseline otherwise. */
function host(ql: unknown, baseline: string[], opts: { covers?: (userId: string) => boolean } = {}): EffectiveAccessHost {
  return {
    baselinePermissionSets: baseline,
    delegatedAdminGate: {
      organizationAdminCoversUser: async () => false,
      scopesCoverUser: async (_sets: unknown, userId: string) => opts.covers?.(userId) ?? false,
    } as any,
    permissionEvaluator: new PermissionEvaluator(),
    ql: ql as any,
    tenancyPosture: 'single' as any,
    resolvePermissionSetsForContext: async (context: any) =>
      (context?.permissions ?? []).includes('user_admin') ? [USER_ADMIN] : [MEMBER_DEFAULT],
  };
}

const ADMIN = { userId: 'u_admin', tenantId: ORG, permissions: ['user_admin'] };
const MEMBER = { userId: 'u_member', tenantId: ORG, permissions: [] };

const describeAs = (h: EffectiveAccessHost, userId: string, caller: unknown) =>
  describeEffectiveAccess.call(h, userId, caller);

const originsOf = (answer: Awaited<ReturnType<typeof describeEffectiveAccess>>) =>
  Object.fromEntries(answer.permissionSets.map((s) => [s.name, s.origins]));

afterEach(() => {
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
  resetPlatformAdminEmailMemo();
});

describe('[ADR-0090 D6] describeEffectiveAccess lists each set once, with every origin', () => {
  it('a default-binding set, a position set and a direct set each carry their origin', async () => {
    const { ql, baseline } = defaultsDeployment();
    const answer = await describeAs(host(ql, baseline), 'u_three', ADMIN);
    expect(answer.userId).toBe('u_three');
    expect(answer.organizationId).toBe(ORG);
    expect(answer.positions).toEqual(['org_member', 'sales_rep', 'everyone']);
    // Resolver order: grant rows, then position-bound sets in the order the
    // held positions name them (`everyone` last), then the baseline.
    expect(answer.permissionSets).toEqual([
      { name: 'forecasting', origins: [{ kind: 'direct' }] },
      { name: 'crm_sales_user', origins: [{ kind: 'position', position: 'sales_rep' }] },
      { name: 'member_default', origins: [{ kind: 'default' }] },
      { name: 'app_default', origins: [{ kind: 'default' }] },
    ]);
  });

  it('CONTROL: a user holding only a direct set, on a deployment with no default binding, lists exactly that one', async () => {
    const ql = engine({
      sys_user: [{ id: 'u_direct', email: 'direct@example.test' }],
      sys_member: [{ user_id: 'u_direct', organization_id: ORG, role: 'member' }],
      sys_user_permission_set: [{ user_id: 'u_direct', permission_set: 'forecasting', organization_id: ORG }],
    }, { positions: [{ name: 'everyone', permissionSets: [] }], permissions: [FORECASTING, USER_ADMIN] });
    const answer = await describeAs(host(ql, []), 'u_direct', ADMIN);
    expect(answer.permissionSets).toEqual([{ name: 'forecasting', origins: [{ kind: 'direct' }] }]);
  });

  it('a set reached two ways — a direct grant and two positions — is listed once, with every origin', async () => {
    const { ql, baseline } = defaultsDeployment();
    const sets = (await describeAs(host(ql, baseline), 'u_two_ways', ADMIN)).permissionSets;
    expect(sets.filter((s) => s.name === 'crm_sales_user')).toEqual([{
      name: 'crm_sales_user',
      origins: [
        { kind: 'direct' },
        { kind: 'position', position: 'sales_rep' },
        { kind: 'position', position: 'sales_lead' },
      ],
    }]);
    expect(sets.find((s) => s.name === 'auditor')?.origins).toEqual([{ kind: 'position', position: 'sales_lead' }]);
  });

  it('a baseline set the `everyone` anchor also binds is listed once, as `default`', async () => {
    const { ql, baseline } = defaultsDeployment();
    const origins = originsOf(await describeAs(host(ql, baseline), 'u_three', ADMIN));
    expect(origins.member_default).toEqual([{ kind: 'default' }]);
  });

  it('names derived from standing carry `derived`: ai_access confers ai_seat, the configured owner admin_full_access', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = 'owner@example.test';
    resetPlatformAdminEmailMemo();
    const { ql, baseline } = defaultsDeployment();
    expect(originsOf(await describeAs(host(ql, baseline), 'u_ai', ADMIN)).ai_seat)
      .toEqual([{ kind: 'derived', source: 'ai_access' }]);
    const owner = await describeAs(host(ql, baseline), 'u_owner', ADMIN);
    expect(originsOf(owner).admin_full_access).toEqual([{ kind: 'derived', source: 'platform_admin_config' }]);
    // The derived `platform_admin` leads the positions, and names no set.
    expect(owner.positions[0]).toBe('platform_admin');
  });

  it('an external member: external_default carries its position and its default origin, and `everyone` is not held', async () => {
    const ql = engine({
      sys_user: [{ id: 'u_ext', email: 'ext@example.test' }],
      sys_member: [{ user_id: 'u_ext', organization_id: ORG, role: 'external' }],
    }, {
      positions: [
        { name: 'everyone', permissionSets: ['member_default'] },
        { name: 'org_external', permissionSets: ['external_default'] },
      ],
      permissions: [MEMBER_DEFAULT, set('external_default'), USER_ADMIN],
    });
    const answer = await describeAs(host(ql, ['member_default']), 'u_ext', ADMIN);
    expect(answer.positions).toEqual(['org_external']);
    expect(answer.permissionSets).toEqual([
      { name: 'external_default', origins: [{ kind: 'position', position: 'org_external' }, { kind: 'default' }] },
    ]);
  });

  it('a caller reads their own effective access without any administrative capability', async () => {
    const { ql, baseline } = defaultsDeployment();
    const answer = await describeAs(host(ql, baseline), 'u_member', MEMBER);
    expect(answer.userId).toBe('u_member');
    expect(originsOf(answer).member_default).toEqual([{ kind: 'default' }]);
  });

  it('a delegated administrator whose scope covers the user is admitted, as explain admits them', async () => {
    const { ql, baseline } = defaultsDeployment();
    const answer = await describeAs(host(ql, baseline, { covers: (id) => id === 'u_three' }), 'u_three', MEMBER);
    expect(answer.userId).toBe('u_three');
  });
});

describe('[ADR-0090 D6/D12] refusals: an unknown user is indistinguishable from a forbidden one', () => {
  const refusalOf = async (p: Promise<unknown>) => {
    const error = await p.then(() => undefined, (e) => e);
    expect(error, 'expected a refusal').toBeInstanceOf(PermissionDeniedError);
    const e = error as PermissionDeniedError;
    return { code: e.code, status: e.status, message: e.message, details: e.details };
  };

  it('a caller without the gate is refused 403 PERMISSION_DENIED for an existing user it may not manage', async () => {
    const { ql, baseline } = defaultsDeployment();
    const refusal = await refusalOf(describeAs(host(ql, baseline), 'u_three', MEMBER));
    expect(refusal.code).toBe('PERMISSION_DENIED');
    expect(refusal.status).toBe(403);
  });

  it('…and for an id no user has, the refusal is identical — the caller learns nothing about which ids exist', async () => {
    const { ql, baseline } = defaultsDeployment();
    const forbidden = await refusalOf(describeAs(host(ql, baseline), 'u_three', MEMBER));
    const unknown = await refusalOf(describeAs(host(ql, baseline), 'u_nobody', MEMBER));
    expect(unknown).toEqual(forbidden);
  });

  it('a manage_users caller asking about an id no user has is refused that same way — not explain\'s 404', async () => {
    const { ql, baseline } = defaultsDeployment();
    const forbidden = await refusalOf(describeAs(host(ql, baseline), 'u_three', MEMBER));
    const unknownToAdmin = await refusalOf(describeAs(host(ql, baseline), 'u_nobody', ADMIN));
    expect(unknownToAdmin).toEqual(forbidden);
  });

  it('an empty id names nobody: refused the same way, never read as the caller', async () => {
    const { ql, baseline } = defaultsDeployment();
    const forbidden = await refusalOf(describeAs(host(ql, baseline), 'u_three', MEMBER));
    expect(await refusalOf(describeAs(host(ql, baseline), '', ADMIN))).toEqual(forbidden);
  });
});
