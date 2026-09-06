// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15981] A `sys_user_position` row SPELLING `platform_admin` confers no
 * platform authority on the sharing-rule surface.
 *
 * ## The defect this pins
 *
 * `hasPlatformAuthority` derived PLATFORM standing from a NAME:
 *
 *     const positions = Array.isArray(context?.positions) ? context.positions : [];
 *     return positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
 *
 * `sys_user_position` is `apiEnabled` and its `position` values are
 * unconstrained, so a tenant can mint an ADR-0057 D4 row spelling that exact
 * built-in name. `resolveUserAuthzGrants` §4 pushes the row's `position`
 * straight into `grants.positions`, and `resolveAuthzContext` copies that array
 * onto `ExecutionContext.positions` verbatim. The capability rung
 * (`grants.posture`, §6d) is derived from the unscoped `admin_full_access`
 * grant and nothing else, so it stays `MEMBER` — the two answers genuinely
 * disagree, and the name-read took the wrong one.
 *
 * ⭐ WHAT THE ESCALATION BUYS, driven rather than argued (see the arms below):
 * `manage_sharing` is an ORG-scoped capability (ADR-0111 D6) that an ordinary
 * tenant admin may grant. Holding it with no organization resolved is refused
 * by `assertResolvableAdminScope` precisely because an unscoped answer "would
 * expose every tenant's rules". The D4 name-read was the bypass: it satisfied
 * that gate, `adminOrgScope` then returned the UNFILTERED `where`, and
 * `listRules` answered with every organization's rows. The same read also
 * carried `deleteRule` past `assertCanDeletePlatformGlobalRule`.
 *
 * ## POPULATION OF THIS PIN — stated because a pin proves only what it covers
 *
 * Covers: an ORG-LESS caller holding `manage_sharing`, in two shapes — a D4
 * row spelling the built-in name with no capability grant behind it
 * (`name-only`), and a genuine unscoped `admin_full_access` grant
 * (`genuine`, the control that proves the fix did not simply deny everyone).
 * Both shapes are built by inserting rows and resolving them through the REAL
 * `resolveUserAuthzGrants`, so the `positions` / `posture` disagreement under
 * test is produced by the shipping resolver rather than hand-asserted.
 *
 * Does NOT cover: the `manage_platform_settings` spelling of platform
 * authority (untouched by this change and asserted only as still-admitting
 * below), tenant-SCOPED callers (a caller with an organization never reaches
 * `assertResolvableAdminScope`'s refusal at all), the ADR-0091 validity window,
 * or the ADR-0049 `active` flags. Those are other suites' populations, and
 * their passing is NOT evidence about this one.
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_IDENTITY_PLATFORM_ADMIN } from '@objectstack/spec/identity';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { hasPlatformAdminStanding, resolveUserAuthzGrants } from '@objectstack/core';
import { SharingRuleService } from './sharing-rule-service.js';

const USER = 'usr_subject';
const OTHER_ORG = 'org_victim';
const HOME_ORG = 'org_home';
const PS_SHARING = 'ps_sharing_admin';
const PS_ADMIN = 'ps_admin_full_access';

/**
 * A minimal ObjectQL double for the AUTHZ resolver, copied in shape from
 * `resolve-authz-context.platform-admin-config.test.ts`'s `makeQl` — including
 * its refusal of top-level `$` combinators. The resolver issues none on this
 * path, so a matcher that silently read `$or` as a field name would leave the
 * suite asserting on an empty result with nothing erroring.
 */
function makeAuthzQl(tables: Record<string, Array<Record<string, unknown>>>) {
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  return {
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
}

/** The permission set that carries the ORG-scoped `manage_sharing` capability. */
const sharingAdminSet = {
  id: PS_SHARING,
  name: 'sharing_admin',
  system_permissions: ['manage_sharing'],
  active: true,
};

function authzTables(shape: 'name-only' | 'genuine') {
  const userPositions =
    shape === 'name-only'
      ? [
          // Exactly what a tenant admin can write through the `apiEnabled`
          // `sys_user_position` surface: a row whose NAME is the built-in.
          { user_id: USER, position: BUILTIN_IDENTITY_PLATFORM_ADMIN, organization_id: null },
        ]
      : [];
  const userSets: Array<Record<string, unknown>> = [
    // The ORG-scoped capability both shapes hold — the precondition, not the
    // axis under test. Scoped to `HOME_ORG`, so it can never be mistaken for
    // the unscoped grant that confers standing.
    { user_id: USER, permission_set_id: PS_SHARING, organization_id: HOME_ORG },
  ];
  if (shape === 'genuine') {
    userSets.push({ user_id: USER, permission_set_id: PS_ADMIN, organization_id: null });
  }
  return {
    sys_user: [{ id: USER, email: 'subject@example.com', email_verified: true }],
    sys_member: [{ organization_id: HOME_ORG, user_id: USER, role: 'member' }],
    sys_user_position: userPositions,
    // An ACTIVE catalogue row for the minted position, so ADR-0049's
    // deactivated-position filter cannot be what carries the arm.
    sys_position:
      shape === 'name-only'
        ? [{ id: 'pos_pa', name: BUILTIN_IDENTITY_PLATFORM_ADMIN, label: 'Platform Admin', active: true }]
        : [],
    sys_position_permission_set: [],
    sys_user_permission_set: userSets,
    sys_permission_set: [
      sharingAdminSet,
      { id: PS_ADMIN, name: ADMIN_FULL_ACCESS, active: true },
    ],
  };
}

/**
 * Resolve one principal through the REAL resolver and hand back both the
 * context the transports would build and the rung, so every assertion below is
 * about resolver output rather than a hand-written array.
 *
 * The caller is deliberately ORG-LESS (`tenantId` omitted): that is the shape
 * `assertResolvableAdminScope` exists to refuse.
 */
async function resolve(shape: 'name-only' | 'genuine') {
  const ql = makeAuthzQl(authzTables(shape));
  const grants = await resolveUserAuthzGrants(ql as any, USER);
  const context = {
    userId: USER,
    positions: grants.positions,
    permissions: grants.permissions,
    systemPermissions: grants.systemPermissions,
    ...(grants.posture ? { posture: grants.posture } : {}),
  } as ExecutionContext;
  return { context, grants, rung: await hasPlatformAdminStanding(ql as any, USER) };
}

/** Two tenants' rules plus one platform-global row, so a cross-tenant read is VISIBLE. */
const RULE_ROWS = [
  { id: 'srule_home', name: 'home_rule', object_name: 'account', organization_id: HOME_ORG, active: true },
  { id: 'srule_victim', name: 'victim_rule', object_name: 'account', organization_id: OTHER_ORG, active: true },
  { id: 'srule_global', name: 'global_rule', object_name: 'account', organization_id: null, active: true },
];

/**
 * A sharing-engine double that RECORDS its reads. It refuses top-level `$`
 * combinators for the same reason the authz double does; on this pin's
 * org-less arms `adminOrgScope` never produces one, so a `$or` reaching it is
 * itself a finding rather than something to teach the double.
 */
function makeSharingEngine() {
  const finds: Array<{ object: string; where: any }> = [];
  const deletes: Array<{ object: string; id: unknown }> = [];
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
      return row[k] === v;
    });
  return {
    finds,
    deletes,
    async find(object: string, opts: any) {
      finds.push({ object, where: opts?.where });
      if (object !== 'sys_sharing_rule') return [];
      const rows = RULE_ROWS.filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async delete(object: string, id: unknown) {
      deletes.push({ object, id });
    },
  };
}

function makeService(engine: ReturnType<typeof makeSharingEngine>) {
  return new SharingRuleService({
    engine: engine as any,
    sharing: { revoke: async () => {} } as any,
    logger: { warn: () => {} },
  });
}

describe('[#15981] a D4 `sys_user_position` row spelling `platform_admin` confers NO platform authority', () => {
  it('the name IS in positions[] while the rung says MEMBER — the premise, without which the rest is vacuous', async () => {
    const { context, grants, rung } = await resolve('name-only');

    expect(context.positions, JSON.stringify(context.positions)).toContain(
      BUILTIN_IDENTITY_PLATFORM_ADMIN,
    );
    expect(grants.posture).not.toBe('PLATFORM_ADMIN');
    expect(rung).toBe(false);
    // The org-scoped capability really is held — so a refusal below is about
    // platform authority, not about a caller who could never manage rules.
    expect(context.systemPermissions).toContain('manage_sharing');
  });

  it('THREE-WAY AGREEMENT — the name says yes; the site gate and the rung both say no, and agree', async () => {
    const { context, rung } = await resolve('name-only');
    const engine = makeSharingEngine();
    const service = makeService(engine);

    const nameRead = (context.positions ?? []).includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    // The site's own gate, read through the public verb it guards.
    const gate = await service
      .listRules({}, context)
      .then(() => true)
      .catch(() => false);

    expect({ nameRead, gate, rung }).toEqual({ nameRead: true, gate: false, rung: false });
  });

  it('`listRules` refuses instead of answering with every organization’s rules', async () => {
    const { context } = await resolve('name-only');
    const engine = makeSharingEngine();
    const service = makeService(engine);

    await expect(service.listRules({}, context)).rejects.toThrow(/PERMISSION_DENIED/);
    // Refused BEFORE the read, so no other tenant's rows were ever fetched —
    // the half a throw alone would not establish.
    expect(engine.finds).toEqual([]);
  });

  it('`deleteRule` refuses to destroy a platform-global rule', async () => {
    const { context } = await resolve('name-only');
    const engine = makeSharingEngine();
    const service = makeService(engine);

    await expect(service.deleteRule('global_rule', context)).rejects.toThrow(/PERMISSION_DENIED/);
    expect(engine.deletes).toEqual([]);
  });
});

describe('[#15981] CONTROL — a genuine unscoped admin_full_access grant still admits', () => {
  it('all three answers are TRUE and agree, and the cross-tenant read is served', async () => {
    const { context, rung } = await resolve('genuine');
    const engine = makeSharingEngine();
    const service = makeService(engine);

    const nameRead = (context.positions ?? []).includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    const rows = await service.listRules({}, context);
    expect({ nameRead, gate: true, rung }).toEqual({ nameRead: true, gate: true, rung: true });
    // A real platform operator still reads across tenants — the functional
    // half, which a fix that simply denied everyone would break.
    expect(rows.map((r) => r.id).sort()).toEqual(['srule_global', 'srule_home', 'srule_victim']);
  });

  it('the two shapes are INDISTINGUISHABLE by name and separable only by the rung', async () => {
    const escalation = await resolve('name-only');
    const genuine = await resolve('genuine');

    // Identical on the axis a name-reading predicate would consult …
    expect(escalation.context.positions).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    expect(genuine.context.positions).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    // … and opposite on the axis that actually decides.
    expect(escalation.rung).toBe(false);
    expect(genuine.rung).toBe(true);
  });
});

describe('[#15981] the OTHER spelling of platform authority is untouched', () => {
  it('`manage_platform_settings` still admits an org-less caller', async () => {
    const engine = makeSharingEngine();
    const service = makeService(engine);
    // A hand-built context on purpose: this arm pins the capability spelling
    // this change does NOT touch, and it reaches contexts no resolver builds
    // (ADR-0068 D2's second channel, per `hasPlatformAuthority`'s doc block).
    const context = {
      userId: 'usr_ops',
      positions: [],
      permissions: [],
      systemPermissions: ['manage_sharing', 'manage_platform_settings'],
    } as ExecutionContext;

    await expect(service.listRules({}, context)).resolves.toHaveLength(3);
  });
});
