// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveAuthzContext, resolveUserAuthzGrants, resolveLocalizationContext } from './resolve-authz-context.js';
import { POSTURE_RANK } from './posture-ladder.js';
import { hashApiKey } from './api-key.js';
import type { AuthzPosture } from '@objectstack/spec/security';

/**
 * Contract test for the SINGLE authorization resolver. Every authorization
 * source MUST be honored here — this is the regression net that would have
 * caught the REST-vs-dispatcher drift (the REST copy had silently dropped
 * sys_user_position / sys_position_permission_set / platform_admin / ai_seat).
 */

// Minimal in-memory ObjectQL: find(object, { where }) with `===` + `$in` match.
function makeQl(tables: Record<string, any[]>) {
  return {
    async find(object: string, opts: any) {
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); 
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          return r[k] === v;
        }),
      );
    },
  };
}
const session = (userId: string, opts: { email?: string; org?: string } = {}) =>
  async () => ({ user: { id: userId, email: opts.email }, session: { activeOrganizationId: opts.org ?? null } });
const H = () => new Headers();

describe('resolveAuthzContext — single source of truth', () => {
  it('resolves a custom role granted via sys_user_position (the REST-drift bug)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1', email: 'ada@x.com' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.positions).toContain('contributor');
  });

  it('normalizes sys_member org roles (owner -> org_owner)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', role: 'owner', organization_id: 'o1' }],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    expect(ctx.positions).toContain('org_owner');
  });

  it('resolves role-bound permission sets (sys_position_permission_set)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [],
      sys_position: [{ id: 'r1', name: 'contributor' }],
      sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
      sys_permission_set: [{ id: 'ps1', name: 'contributor_ps', system_permissions: ['cap_x'] }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).toContain('contributor_ps');
    expect(ctx.systemPermissions).toContain('cap_x');
  });

  it('derives platform_admin from an UNSCOPED admin_full_access user grant', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null }],
      sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.positions).toContain('platform_admin');
  });

  it('does NOT derive platform_admin from an ORG-scoped admin_full_access grant', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: 'o1' }],
      sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    expect(ctx.positions).not.toContain('platform_admin');
  });

  it('synthesizes ai_seat from sys_user.ai_access (sqlite integer 1)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1', ai_access: 1 }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).toContain('ai_seat');
  });

  it('anonymous (no session, no api key) → empty context', async () => {
    const ctx = await resolveAuthzContext({ ql: makeQl({}), headers: H(), getSession: async () => undefined });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.positions).toEqual([]);
    expect(ctx.permissions).toEqual([]);
  });
});

// A counting ObjectQL: records how many find() calls hit each object so we can
// assert the de-duplication of redundant authz/localization reads (#2409).
function makeCountingQl(tables: Record<string, any[]>) {
  const counts: Record<string, number> = {};
  return {
    counts,
    async find(object: string, opts: any) {
      counts[object] = (counts[object] ?? 0) + 1;
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); 
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          return r[k] === v;
        }),
      );
    },
  };
}

describe('resolveAuthzContext — request-scoped read de-duplication (#2409)', () => {
  it('reads sys_user at most once even when both email fallback and ai_seat need it', async () => {
    // No email in the session → email fallback reads sys_user; ai_seat synthesis
    // also needs sys_user. Previously these were two separate queries.
    const ql = makeCountingQl({
      sys_user: [{ id: 'u1', email: 'ada@x.com', ai_access: 1 }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.email).toBe('ada@x.com');
    expect(ctx.permissions).toContain('ai_seat');
    expect(ql.counts.sys_user).toBe(1);
  });
});

describe('resolveLocalizationContext — batched fallback read (#2409)', () => {
  it('reads sys_setting once (all three keys) when no settings service is wired', async () => {
    const ql = makeCountingQl({
      sys_setting: [
        { namespace: 'localization', key: 'timezone', scope: 'tenant', value: 'Asia/Tokyo' },
        { namespace: 'localization', key: 'locale', scope: 'tenant', value: 'ja-JP' },
        { namespace: 'localization', key: 'currency', scope: 'tenant', value: 'JPY' },
      ],
    });
    const loc = await resolveLocalizationContext({ ql, tenantId: 'o1' });
    expect(loc).toEqual({ timezone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' });
    expect(ql.counts.sys_setting).toBe(1);
  });

  it('falls back to UTC / en-US when no rows exist', async () => {
    const ql = makeCountingQl({ sys_setting: [] });
    const loc = await resolveLocalizationContext({ ql });
    expect(loc.timezone).toBe('UTC');
    expect(loc.locale).toBe('en-US');
    expect(loc.currency).toBeUndefined();
  });
});

describe('grant validity windows (ADR-0091 D1/D2)', () => {
  const NOW = Date.parse('2026-07-10T12:00:00Z');
  const PAST = '2026-07-01T00:00:00Z';
  const FUTURE = '2026-08-01T00:00:00Z';

  it('an expired sys_user_position row does not resolve', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [
        { user_id: 'u1', position: 'approver', organization_id: null, valid_until: PAST },
        { user_id: 'u1', position: 'contributor', organization_id: null },
      ],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).not.toContain('approver');
    expect(ctx.positions).toContain('contributor'); // null bounds = unbounded, unchanged
  });

  it('a not-yet-active sys_user_position row (future valid_from) does not resolve', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'approver', organization_id: null, valid_from: FUTURE }],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).not.toContain('approver');
  });

  it('a row inside its [from, until) window resolves; until is exclusive', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [
        { user_id: 'u1', position: 'stand_in', organization_id: null, valid_from: PAST, valid_until: FUTURE },
        // Boundary: valid_until exactly NOW → inactive AT the bound (half-open).
        { user_id: 'u1', position: 'boundary', organization_id: null, valid_until: '2026-07-10T12:00:00Z' },
      ],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).toContain('stand_in');
    expect(ctx.positions).not.toContain('boundary');
  });

  it('an expired direct permission-set grant resolves to nothing — including platform_admin derivation', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'u1', permission_set_id: 'psA', organization_id: null, valid_until: PAST },
      ],
      sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.permissions).not.toContain('admin_full_access');
    expect(ctx.positions).not.toContain('platform_admin');
  });

  it('fails closed on an unparseable valid_until', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'approver', organization_id: null, valid_until: 'not-a-date' }],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1'), nowMs: NOW });
    expect(ctx.positions).not.toContain('approver');
  });
});

describe('audience anchors in the resolver (ADR-0090 D5)', () => {
  it('every authenticated principal implicitly holds `everyone` (additive, no cliff)', async () => {
    const ql = makeQl({
      sys_member: [{ user_id: 'u1', role: 'member', organization_id: 'o1' }],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    // holding an explicit position must NOT cost the baseline anchor
    expect(ctx.positions).toContain('contributor');
    expect(ctx.positions).toContain('everyone');
  });

  it('anonymous resolution never gains `everyone`', async () => {
    const ql = makeQl({});
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: async () => undefined });
    expect(ctx.positions).not.toContain('everyone');
    expect(ctx.userId).toBeUndefined();
  });
});

/**
 * [ADR-0095 D2/D3] Posture-ladder resolution. A `principal × grants → posture`
 * matrix asserting the rung is DERIVED from held capability grants
 * (`admin_full_access` → PLATFORM_ADMIN; `organization_admin` → TENANT_ADMIN;
 * otherwise MEMBER), never from a better-auth role, plus the strict-nesting
 * ordering (PLATFORM_ADMIN > TENANT_ADMIN > MEMBER). `EXTERNAL` is never
 * resolved — no external principal type exists yet.
 */
describe('resolveAuthzContext — posture ladder (ADR-0095 D2/D3)', () => {
  // Each fixture returns the ql tables + the session getter for one principal.
  const FIXTURES: Record<string, { ql: any; getSession: any }> = {
    // Unscoped admin_full_access grant → the platform-admin capability.
    platform_admin: {
      ql: makeQl({
        sys_user: [{ id: 'pa' }],
        sys_member: [],
        sys_user_position: [],
        sys_user_permission_set: [{ user_id: 'pa', permission_set_id: 'psA', organization_id: null }],
        sys_permission_set: [{ id: 'psA', name: 'admin_full_access' }],
      }),
      getSession: session('pa'),
    },
    // Org-scoped organization_admin grant (auto-provisioned from role=admin).
    tenant_admin: {
      ql: makeQl({
        sys_user: [{ id: 'ta' }],
        sys_member: [{ user_id: 'ta', role: 'admin', organization_id: 'o1' }],
        sys_user_position: [],
        sys_user_permission_set: [{ user_id: 'ta', permission_set_id: 'psO', organization_id: 'o1' }],
        sys_permission_set: [{ id: 'psO', name: 'organization_admin' }],
      }),
      getSession: session('ta', { org: 'o1' }),
    },
    // Ordinary member — no admin capability grant.
    member: {
      ql: makeQl({
        sys_user: [{ id: 'm' }],
        sys_member: [{ user_id: 'm', role: 'member', organization_id: 'o1' }],
        sys_user_position: [],
        sys_user_permission_set: [],
        sys_permission_set: [],
      }),
      getSession: session('m', { org: 'o1' }),
    },
    // Authenticated but no active org — still the MEMBER floor, not EXTERNAL.
    no_org_member: {
      ql: makeQl({
        sys_user: [{ id: 'n' }],
        sys_member: [],
        sys_user_position: [],
        sys_user_permission_set: [],
      }),
      getSession: session('n'),
    },
  };

  const EXPECTED_POSTURE: Record<string, AuthzPosture> = {
    platform_admin: 'PLATFORM_ADMIN',
    tenant_admin: 'TENANT_ADMIN',
    member: 'MEMBER',
    no_org_member: 'MEMBER',
  };

  it('resolves the principal × grants → posture matrix', async () => {
    const actual: Record<string, AuthzPosture | undefined> = {};
    for (const [name, fx] of Object.entries(FIXTURES)) {
      const ctx = await resolveAuthzContext({ ql: fx.ql, headers: H(), getSession: fx.getSession });
      actual[name] = ctx.posture;
    }
    expect(actual).toEqual(EXPECTED_POSTURE);
  });

  it('posture is strictly nested: PLATFORM_ADMIN > TENANT_ADMIN > MEMBER', async () => {
    const rank = async (name: string) => {
      const fx = FIXTURES[name];
      const ctx = await resolveAuthzContext({ ql: fx.ql, headers: H(), getSession: fx.getSession });
      return POSTURE_RANK[ctx.posture!];
    };
    expect(await rank('platform_admin')).toBeGreaterThan(await rank('tenant_admin'));
    expect(await rank('tenant_admin')).toBeGreaterThan(await rank('member'));
  });

  it('platform-admin grant wins over a co-held org-admin grant (capability, not role)', async () => {
    // A principal who is BOTH an org admin (role) AND holds the unscoped
    // platform grant resolves PLATFORM_ADMIN — derivation reads the capability,
    // so the higher rung wins regardless of the better-auth role.
    const ql = makeQl({
      sys_user: [{ id: 'both' }],
      sys_member: [{ user_id: 'both', role: 'admin', organization_id: 'o1' }],
      sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'both', permission_set_id: 'psA', organization_id: null },
        { user_id: 'both', permission_set_id: 'psO', organization_id: 'o1' },
      ],
      sys_permission_set: [
        { id: 'psA', name: 'admin_full_access' },
        { id: 'psO', name: 'organization_admin' },
      ],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('both', { org: 'o1' }) });
    expect(ctx.posture).toBe('PLATFORM_ADMIN');
  });

  it('anonymous principal carries no posture rung', async () => {
    const ctx = await resolveAuthzContext({ ql: makeQl({}), headers: H(), getSession: async () => undefined });
    expect(ctx.posture).toBeUndefined();
  });
});

/**
 * #3356 — the userId-driven core, callable WITHOUT an HTTP request. A
 * `runAs:'user'` automation run knows the triggering user's id (the record-change
 * hook session carries only that) and must build the SAME positions/permissions
 * envelope a direct REST request from that user would resolve, so its data ops
 * enforce RLS as that user — not the bare member/everyone fallback.
 */
describe('resolveUserAuthzGrants — userId-driven authz for non-HTTP surfaces (#3356)', () => {
  it("resolves a known user's positions + permission-set names from the DB", async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1', email: 'ada@x.com' }],
      sys_member: [{ user_id: 'u1', role: 'admin', organization_id: 'o1' }],
      sys_user_position: [{ user_id: 'u1', position: 'approver', organization_id: null }],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null }],
      sys_permission_set: [{ id: 'psA', name: 'ehr_all', system_permissions: ['cap_ehr'] }],
    });
    const grants = await resolveUserAuthzGrants(ql, 'u1', { tenantId: 'o1' });
    expect(grants.positions).toContain('org_admin'); // sys_member owner/admin normalized
    expect(grants.positions).toContain('approver'); // sys_user_position
    expect(grants.positions).toContain('everyone'); // implicit audience anchor
    expect(grants.permissions).toContain('ehr_all'); // user-scoped permission set
    expect(grants.systemPermissions).toContain('cap_ehr');
    expect(grants.email).toBe('ada@x.com');
  });

  it('matches resolveAuthzContext for the same user — one resolver, one envelope', async () => {
    const tables = {
      sys_user: [{ id: 'u1', email: 'ada@x.com' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_position: [{ id: 'r1', name: 'contributor' }],
      sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
      sys_permission_set: [{ id: 'ps1', name: 'contributor_ps', system_permissions: ['cap_x'] }],
    };
    const viaHttp = await resolveAuthzContext({ ql: makeQl(tables), headers: H(), getSession: session('u1') });
    const viaUser = await resolveUserAuthzGrants(makeQl(tables), 'u1');
    expect([...viaUser.positions].sort()).toEqual([...viaHttp.positions].sort());
    expect([...viaUser.permissions].sort()).toEqual([...viaHttp.permissions].sort());
    expect([...viaUser.systemPermissions].sort()).toEqual([...viaHttp.systemPermissions].sort());
    expect(viaUser.posture).toBe(viaHttp.posture);
  });

  it('seeds caller-supplied permissions FIRST, then appends resolved set names', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_permission_set: [{ id: 'ps1', name: 'sales_ps' }],
    });
    const grants = await resolveUserAuthzGrants(ql, 'u1', { seedPermissions: ['api:scope'] });
    expect(grants.permissions[0]).toBe('api:scope');
    expect(grants.permissions).toContain('sales_ps');
  });

  it('a caller-supplied email wins over the sys_user read', async () => {
    const ql = makeQl({ sys_user: [{ id: 'u1', email: 'db@x.com' }], sys_member: [], sys_user_position: [], sys_user_permission_set: [] });
    const grants = await resolveUserAuthzGrants(ql, 'u1', { seedEmail: 'session@x.com' });
    expect(grants.email).toBe('session@x.com');
  });

  it('a user with no grants gets the implicit everyone anchor, empty permissions (never null)', async () => {
    const ql = makeQl({ sys_user: [{ id: 'u1' }], sys_member: [], sys_user_position: [], sys_user_permission_set: [] });
    const grants = await resolveUserAuthzGrants(ql, 'u1');
    expect(grants.positions).toEqual(['everyone']);
    expect(grants.permissions).toEqual([]);
    expect(grants.org_user_ids).toEqual(['u1']);
  });

  it('fail-closed: no data engine yields an empty-but-valid envelope and never throws', async () => {
    const grants = await resolveUserAuthzGrants(undefined, 'u1', { seedPermissions: ['api:scope'] });
    expect(grants.positions).toEqual([]);
    expect(grants.permissions).toEqual(['api:scope']);
    expect(grants.org_user_ids).toEqual(['u1']);
  });

  it('drops permission-set grants outside their validity window (ADR-0091)', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null, valid_until: past }],
      sys_permission_set: [{ id: 'psA', name: 'expired_ps' }],
    });
    const grants = await resolveUserAuthzGrants(ql, 'u1');
    expect(grants.permissions).not.toContain('expired_ps');
  });
});


// ── [#8287] API-key organization admission ─────────────────────────────────

/**
 * The two refusals that need the resolver rather than the verifier: one
 * because it needs the caller's membership set (resolved here, once), one
 * because the refusal must not silently fall through to the session path.
 */
describe('resolveAuthzContext — API-key organization (#8287)', () => {
  const raw = 'osk_ctx_probe';
  const keyHeaders = () => ({ 'x-api-key': raw });
  const tables = (member: any[]) => ({
    sys_api_key: [{ key: hashApiKey(raw), revoked: false, user_id: 'u1', active_organization_id: 'org_a' }],
    sys_user: [{ id: 'u1', email: 'ada@x.com' }],
    sys_member: member,
    sys_user_position: [],
    sys_user_permission_set: [],
  });

  it('adopts the key organization as the request tenant when membership holds', async () => {
    const ql = makeQl(tables([{ user_id: 'u1', organization_id: 'org_a', role: 'member' }]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    expect(ctx.userId).toBe('u1');
    expect(ctx.tenantId).toBe('org_a');
    expect(ctx.authRefusal).toBeUndefined();
  });

  /**
   * Fail-closed at VERIFY time, not revoke-on-event. Membership ends through
   * better-auth org endpoints, SCIM deprovisioning, a direct `sys_member`
   * delete, or an ADR-0091 window simply lapsing — a revoke-on-removal hook
   * must catch every one of those or it silently misses.
   *
   * The result is NO PRINCIPAL, deliberately: degrading to a user-only
   * principal would answer 200 with zero rows, which is the silent-empty class
   * this card exists to remove.
   */
  it('refuses a key whose owner is no longer a member of its organization', async () => {
    const ql = makeQl(tables([{ user_id: 'u1', organization_id: 'org_other', role: 'member' }]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.tenantId).toBeUndefined();
    expect(ctx.permissions).toEqual([]);
    expect(ctx.authRefusal?.reason).toBe('organization_membership_ended');
  });

  it('refuses when the membership row exists but its ADR-0091 window has lapsed', async () => {
    const ql = makeQl(tables([
      { user_id: 'u1', organization_id: 'org_a', role: 'member', valid_until: '2000-01-01T00:00:00Z' },
    ]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.authRefusal?.reason).toBe('organization_membership_ended');
  });

  it('the same key under `group` is refused too — the wall is membership-derived there as well', async () => {
    const ql = makeQl(tables([{ user_id: 'u1', organization_id: 'org_other', role: 'member' }]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'group' });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.authRefusal?.reason).toBe('organization_membership_ended');
  });

  /**
   * Under `single` there is no organization boundary to cross, and a
   * deployment with no membership rows at all would otherwise have every
   * stamped key refused.
   */
  it('does NOT apply the membership check under `single`', async () => {
    const ql = makeQl(tables([]));
    const ctx = await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'single' });
    expect(ctx.userId).toBe('u1');
    expect(ctx.authRefusal).toBeUndefined();
  });

  /**
   * A refused key must NOT fall through to the session path. Falling through
   * would be MORE permissive than the behaviour this replaced — an API key
   * already outranks a session — and a refusal that quietly becomes a session
   * login is not a refusal.
   */
  it('a refused org-less key does not fall through to the session', async () => {
    const ql = makeQl({
      sys_api_key: [{ key: hashApiKey(raw), revoked: false, user_id: 'u1' }],
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }],
      sys_user_position: [],
      sys_user_permission_set: [],
    });
    const ctx = await resolveAuthzContext({
      ql,
      headers: keyHeaders(),
      getSession: session('u1', { org: 'org_a' }),
      tenancyPosture: 'isolated',
    });
    expect(ctx.userId).toBeUndefined();
    expect(ctx.authRefusal?.reason).toBe('organization_required');
  });

  /**
   * The membership check is a set test on data the resolver has ALREADY read
   * to build `accessible_org_ids` — it must not add a query. Counting reads is
   * how that stays true: a later refactor that re-reads `sys_member` for this
   * check turns a free assertion into a per-request cost, silently.
   */
  it('costs zero additional queries (sys_member is read once)', async () => {
    let memberReads = 0;
    const inner = makeQl(tables([{ user_id: 'u1', organization_id: 'org_a', role: 'member' }]));
    const ql = {
      async find(object: string, opts: any) {
        if (object === 'sys_member') memberReads += 1;
        return inner.find(object, opts);
      },
    };
    await resolveAuthzContext({ ql, headers: keyHeaders(), tenancyPosture: 'isolated' });
    // One read for `accessible_org_ids`, one for the fellow-org peer list that
    // an ACTIVE tenant already triggered before this change. The membership
    // assertion adds neither.
    expect(memberReads).toBe(2);
  });
});

/**
 * [#8613 / ADR-0049] `sys_permission_set.active` and `sys_position.active` —
 * enforce-or-remove, enforced.
 *
 * Both objects ship a Deactivate action whose dialog promises, in four locales,
 * that access stops. Nothing read the column, so the promise was false: the
 * assignments kept granting and the admin who trusted the dialog did not take
 * the action that would actually have worked.
 *
 * This is the ONLY seam where either flag is enforceable. Downstream in
 * plugin-security the position → permission-set linkage is already collapsed
 * into a flat `permissions` list, so a set held via a deactivated position is
 * indistinguishable there from one granted directly — filtering there would
 * over-revoke a set the user also holds in their own right.
 *
 * The predicate is "explicitly deactivated", not "explicitly active": absent
 * means ACTIVE, so a row that predates the column keeps working. Every fixture
 * above this block carries no `active` key at all and is the pin for that
 * direction — requiring `true` would have turned this file red wholesale, which
 * is what it would do to deployed data.
 */
describe('[#8613] the `active` flag on the grant catalogues (ADR-0049)', () => {
  const withActive = (v: unknown) => ({
    sys_user: [{ id: 'u1' }],
    sys_member: [],
    sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
    sys_user_permission_set: [],
    sys_position: [{ id: 'r1', name: 'contributor', active: v }],
    sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
    sys_permission_set: [{ id: 'ps1', name: 'contributor_ps', system_permissions: ['cap_x'] }],
  });

  // ── sys_position ──────────────────────────────────────────────────────────

  it('a DEACTIVATED position stops granting its permission sets', async () => {
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(false)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.permissions).not.toContain('contributor_ps');
    expect(ctx.systemPermissions).not.toContain('cap_x');
  });

  it('…and its NAME leaves `positions` too, or the name alone would resolve the set', async () => {
    // `resolvePermissionSetsForContext` requests `context.positions` as
    // permission-set names (position names are commonly reused as set names),
    // so a name left standing would resolve the same grant one layer down.
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(false)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.positions).not.toContain('contributor');
    // The audience anchor is untouched — it is not the deactivated row.
    expect(ctx.positions).toContain('everyone');
  });

  it('an ACTIVE position still grants (the flag is not a blanket revocation)', async () => {
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(true)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.positions).toContain('contributor');
    expect(ctx.permissions).toContain('contributor_ps');
    expect(ctx.systemPermissions).toContain('cap_x');
  });

  it('an ABSENT `active` column grants — deployed rows are not mass-revoked', async () => {
    const ctx = await resolveAuthzContext({
      ql: makeQl(withActive(undefined)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(ctx.positions).toContain('contributor');
    expect(ctx.permissions).toContain('contributor_ps');
  });

  it('the 0/1 storage shape deactivates too — what the primary driver returns', async () => {
    const off = await resolveAuthzContext({
      ql: makeQl(withActive(0)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(off.permissions).not.toContain('contributor_ps');
    const on = await resolveAuthzContext({
      ql: makeQl(withActive(1)),
      headers: H(),
      getSession: session('u1'),
    });
    expect(on.permissions).toContain('contributor_ps');
  });

  it('a position name with NO `sys_position` row is untouched (org roles, memberships)', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', role: 'owner', organization_id: 'o1' }],
      sys_user_position: [],
      sys_user_permission_set: [],
      // `org_owner` is projected from the membership and has no catalogue row —
      // there is no flag to read, so nothing may be inferred from its absence.
      sys_position: [{ id: 'r9', name: 'something_else', active: false }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1', { org: 'o1' }) });
    expect(ctx.positions).toContain('org_owner');
  });

  it('deactivating ONE position leaves the others granting', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [
        { user_id: 'u1', position: 'contributor', organization_id: null },
        { user_id: 'u1', position: 'reviewer', organization_id: null },
      ],
      sys_user_permission_set: [],
      sys_position: [
        { id: 'r1', name: 'contributor', active: false },
        { id: 'r2', name: 'reviewer', active: true },
      ],
      sys_position_permission_set: [
        { position_id: 'r1', permission_set_id: 'ps1' },
        { position_id: 'r2', permission_set_id: 'ps2' },
      ],
      sys_permission_set: [
        { id: 'ps1', name: 'contributor_ps' },
        { id: 'ps2', name: 'reviewer_ps' },
      ],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).not.toContain('contributor_ps');
    expect(ctx.permissions).toContain('reviewer_ps');
    expect(ctx.positions).not.toContain('contributor');
    expect(ctx.positions).toContain('reviewer');
  });

  // ── sys_permission_set ────────────────────────────────────────────────────

  it('a DEACTIVATED permission set grants nothing — name, capabilities and tabs', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_permission_set: [{
        id: 'ps1',
        name: 'crm_full',
        active: false,
        system_permissions: ['cap_x'],
        tab_permissions: { crm: 'visible' },
      }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).not.toContain('crm_full');
    expect(ctx.systemPermissions).not.toContain('cap_x');
    expect(ctx.tabPermissions?.crm).toBeUndefined();
  });

  it('THE HIGH-BLAST-RADIUS CASE: a deactivated admin_full_access confers no PLATFORM_ADMIN', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'psA', organization_id: null }],
      sys_permission_set: [{
        id: 'psA',
        name: 'admin_full_access',
        active: false,
        system_permissions: ['manage_users'],
      }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    // Dropped BEFORE the derivation, so the posture cannot be read off a set
    // that no longer grants — the whole point of filtering at §6b rather than
    // after it.
    expect(ctx.permissions).not.toContain('admin_full_access');
    expect(ctx.posture).not.toBe('PLATFORM_ADMIN');
    expect(ctx.positions).not.toContain('platform_admin');
    expect(ctx.systemPermissions).not.toContain('manage_users');
  });

  it('deactivating ONE set leaves the others granting', async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'u1', permission_set_id: 'ps1', organization_id: null },
        { user_id: 'u1', permission_set_id: 'ps2', organization_id: null },
      ],
      sys_permission_set: [
        { id: 'ps1', name: 'crm_full', active: false },
        { id: 'ps2', name: 'crm_read', active: true },
      ],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).not.toContain('crm_full');
    expect(ctx.permissions).toContain('crm_read');
  });

  it('a set held via BOTH a deactivated position and a direct grant still resolves', async () => {
    // The over-revocation this seam is chosen to avoid: the direct grant is a
    // separate authority and the position's deactivation may not touch it.
    const ql = makeQl({
      sys_user: [{ id: 'u1' }],
      sys_member: [],
      sys_user_position: [{ user_id: 'u1', position: 'contributor', organization_id: null }],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_position: [{ id: 'r1', name: 'contributor', active: false }],
      sys_position_permission_set: [{ position_id: 'r1', permission_set_id: 'ps1' }],
      sys_permission_set: [{ id: 'ps1', name: 'crm_full' }],
    });
    const ctx = await resolveAuthzContext({ ql, headers: H(), getSession: session('u1') });
    expect(ctx.permissions).toContain('crm_full');
    expect(ctx.positions).not.toContain('contributor');
  });

  it('resolveUserAuthzGrants enforces it too — the non-HTTP surfaces share the seam', async () => {
    const grants = await resolveUserAuthzGrants(makeQl(withActive(false)), 'u1');
    expect(grants.permissions).not.toContain('contributor_ps');
    expect(grants.positions).not.toContain('contributor');
  });
});
