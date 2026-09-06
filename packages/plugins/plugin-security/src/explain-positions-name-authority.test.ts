// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15981] A `sys_user_position` row SPELLING `platform_admin` does not make the
 * explain panel REPORT `PLATFORM_ADMIN`.
 *
 * ## The defect this pins, and how it differs from its three siblings
 *
 * `derivePosture` read a NAME as platform evidence:
 *
 *     isPlatformAdmin:
 *       context?.hasPlatformAdminGrant === true || positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN),
 *
 * ⚠️ MEASURED, and the reason this site's arms are shaped differently from the
 * other three in #15981: this read sits BEHIND an early return —
 * `if (isAuthzPosture(context?.posture)) return context.posture;` — and
 * `buildContextForUser`, the explain API's own principal builder, always
 * attaches `posture` for an authenticated principal. So on the SHIPPING path
 * the name-read was already unreachable, and the D4 row changed nothing. That
 * half is asserted below (`the shipping path was already gated`) and it was
 * GREEN before this change as well as after: it is a regression guard, not
 * evidence that anything was repaired here.
 *
 * What WAS reachable is the fallback branch itself, on a context carrying
 * `positions` with no `posture` — the shape the doc block names ("a HAND-BUILT
 * context: tests, an internal caller assembling `{ userId, positions,
 * permissions }` itself"). There the name alone produced `PLATFORM_ADMIN`.
 * That is a MISREPORT rather than an enforcement bypass — this engine explains,
 * it does not admit — but it is a misreport in the one tool an administrator
 * uses to check whether someone is a platform operator, so it answers
 * "reassuringly wrong" exactly when someone is looking.
 *
 * The fallback's remaining evidence is `hasPlatformAdminGrant`, which
 * `buildContextForUser` sets from `grants.posture === 'PLATFORM_ADMIN'` — the
 * rung, byte-for-byte what `hasPlatformAdminStanding` returns.
 *
 * ## POPULATION OF THIS PIN — stated because a pin proves only what it covers
 *
 * Covers: `explainAccess`'s reported `principal.posture` for (a) contexts built
 * by the REAL `buildContextForUser` over inserted rows, in the `name-only` and
 * `genuine` shapes, and (b) hand-built contexts exercising the fallback branch
 * directly — the name alone, the rung alone, and both together.
 *
 * Does NOT cover: the TENANT_ADMIN arm, the guest/EXTERNAL floor, or the
 * record-grained layer attribution — those are `explain-engine.test.ts`'s
 * population, and its passing is NOT evidence about this one. In particular it
 * does not cover any ENFORCEMENT decision: no arm here admits or refuses
 * anything, because this engine reports.
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_IDENTITY_PLATFORM_ADMIN, ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { hasPlatformAdminStanding } from '@objectstack/core';
import { PermissionEvaluator } from './permission-evaluator';
import { explainAccess, buildContextForUser, type ExplainEngineDeps } from './explain-engine';

const ADMIN = PermissionSetSchema.parse({
  name: 'admin_full_access',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } },
  systemPermissions: ['manage_users'],
});
const PRIVATE_SCHEMA = { name: 'leave_request', sharingModel: 'private' };

/** The base object-level deps — the posture value is independent of the record-grained ones. */
function makeDeps(): ExplainEngineDeps {
  return {
    ql: { getSchema: () => PRIVATE_SCHEMA },
    resolveSets: async () => [ADMIN],
    evaluator: new PermissionEvaluator(),
    getObjectSecurityMeta: async () => ({
      isPrivate: false,
      requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
      fieldRequiredPermissions: {},
    }),
    requiredCaps: (meta: any, op: string) => {
      const bucket = op === 'find' ? 'read' : op === 'insert' ? 'create' : op;
      return [...(meta.all ?? []), ...((meta as any)[bucket] ?? [])];
    },
    computeRlsFilter: async () => null,
    getFieldMask: () => ({}),
    getPartialMaskRules: async () => ({}),
    baselinePermissionSets: ['member_default'],
  };
}

/** `posture` is surfaced whenever a `recordId` is supplied. */
const postureOf = async (context: any): Promise<string | undefined> => {
  const d = await explainAccess(makeDeps(), {
    object: 'leave_request', operation: 'read', context, recordId: 'r1',
  });
  return d.principal.posture;
};

const USER = 'usr_subject';
const HOME_ORG = 'org_home';
const PS_ADMIN = 'ps_admin_full_access';

/**
 * A `where`-HONOURING ObjectQL double — load-bearing, not tidiness, for the
 * reason `explain-engine.test.ts` states at its own `buildContextForUser`
 * fixtures: the resolver delegates filtering to the engine, so a fake that
 * ignored `where` would report grants nobody holds. Top-level `$` combinators
 * are refused rather than approximated.
 */
function makeAuthzQl(tables: Record<string, Array<Record<string, unknown>>>) {
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  return {
    getSchema: () => PRIVATE_SCHEMA,
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
}

function authzTables(shape: 'name-only' | 'genuine') {
  return {
    sys_user: [{ id: USER, email: 'subject@example.com', email_verified: true }],
    sys_member: [{ organization_id: HOME_ORG, user_id: USER, role: 'member' }],
    sys_user_position:
      shape === 'name-only'
        ? [{ user_id: USER, position: BUILTIN_IDENTITY_PLATFORM_ADMIN, organization_id: null }]
        : [],
    sys_position:
      shape === 'name-only'
        ? [{ id: 'pos_pa', name: BUILTIN_IDENTITY_PLATFORM_ADMIN, label: 'Platform Admin', active: true }]
        : [],
    sys_position_permission_set: [],
    sys_user_permission_set:
      shape === 'genuine'
        ? [{ user_id: USER, permission_set_id: PS_ADMIN, organization_id: null }]
        : [],
    sys_permission_set: [{ id: PS_ADMIN, name: ADMIN_FULL_ACCESS, active: true }],
  };
}

describe('[#15981] the SHIPPING explain path was already gated — a regression guard, not a repair', () => {
  it('a D4 row spelling the built-in name is REPORTED as MEMBER, and the rung agrees', async () => {
    const ql = makeAuthzQl(authzTables('name-only'));
    const context = await buildContextForUser(ql as any, USER);

    // The premise: the name really is on the array the panel prints.
    expect(context.positions, JSON.stringify(context.positions)).toContain(
      BUILTIN_IDENTITY_PLATFORM_ADMIN,
    );
    // …and the reported rung is the capability answer, not the name.
    expect(context.posture).toBe('MEMBER');
    expect(context.hasPlatformAdminGrant).toBe(false);
    expect(await hasPlatformAdminStanding(ql as any, USER)).toBe(false);
    expect(await postureOf(context)).toBe('MEMBER');
  });

  it('CONTROL — a genuine unscoped admin_full_access grant is still reported as PLATFORM_ADMIN', async () => {
    const ql = makeAuthzQl(authzTables('genuine'));
    const context = await buildContextForUser(ql as any, USER);

    expect(context.positions).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    expect(context.hasPlatformAdminGrant).toBe(true);
    expect(await hasPlatformAdminStanding(ql as any, USER)).toBe(true);
    expect(await postureOf(context)).toBe('PLATFORM_ADMIN');
  });

  it('the two shapes are INDISTINGUISHABLE by name and separable only by the rung', async () => {
    const nameOnly = makeAuthzQl(authzTables('name-only'));
    const genuine = makeAuthzQl(authzTables('genuine'));
    const a = await buildContextForUser(nameOnly as any, USER);
    const b = await buildContextForUser(genuine as any, USER);

    expect(a.positions).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    expect(b.positions).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    expect([a.posture, b.posture]).toEqual(['MEMBER', 'PLATFORM_ADMIN']);
  });
});

describe('[#15981] the FALLBACK branch — reachable on a posture-less context, and it no longer reads the name', () => {
  const base = { userId: 'a1', tenantId: 'org1', permissions: [] };

  it('THREE-WAY AGREEMENT — the name says yes; the report and the rung both say no, and agree', async () => {
    // No `posture` key: the early return is skipped and the fallback runs. This
    // is the branch the shipping builder cannot produce, and the only one this
    // change actually moves.
    const context = { ...base, positions: [BUILTIN_IDENTITY_PLATFORM_ADMIN, 'everyone'] };
    const ql = makeAuthzQl(authzTables('name-only'));

    const nameRead = context.positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    const reported = await postureOf(context);
    const rung = await hasPlatformAdminStanding(ql as any, USER);

    expect({ nameRead, reported, rung }).toEqual({
      nameRead: true, reported: 'MEMBER', rung: false,
    });
  });

  it('the unscoped-grant flag alone STILL yields PLATFORM_ADMIN — the evidence that survives', async () => {
    // `buildContextForUser` sets this from `grants.posture === 'PLATFORM_ADMIN'`,
    // so the fallback's remaining input is the rung itself.
    expect(
      await postureOf({ ...base, positions: ['everyone'], hasPlatformAdminGrant: true }),
    ).toBe('PLATFORM_ADMIN');
  });

  it('the grant flag wins even when the name is absent, and the name loses even when the flag is false', async () => {
    expect(
      await postureOf({ ...base, positions: ['everyone'], hasPlatformAdminGrant: true }),
    ).toBe('PLATFORM_ADMIN');
    expect(
      await postureOf({
        ...base,
        positions: [BUILTIN_IDENTITY_PLATFORM_ADMIN, 'everyone'],
        hasPlatformAdminGrant: false,
      }),
    ).toBe('MEMBER');
  });

  it('an explicit ctx.posture still wins over both — the early return is untouched', async () => {
    expect(
      await postureOf({ ...base, positions: ['everyone'], posture: 'PLATFORM_ADMIN' }),
    ).toBe('PLATFORM_ADMIN');
    expect(
      await postureOf({
        ...base,
        positions: [BUILTIN_IDENTITY_PLATFORM_ADMIN, 'everyone'],
        posture: 'MEMBER',
      }),
    ).toBe('MEMBER');
  });
});
