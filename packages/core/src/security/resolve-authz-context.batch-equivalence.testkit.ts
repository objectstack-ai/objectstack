// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reusable harness half of `resolve-authz-context.batch-equivalence.test.ts`
 * — the recording ObjectQL double and the 11-fixture matrix, extracted under
 * the repo's `.testkit.ts` convention (#11633 §7 notes the harness is meant to
 * be reused) so a second suite can drive the SAME fixtures without importing a
 * test file and re-registering its suites.
 *
 * ⛔ The GOLDENS stay in the test file, next to the assertions they control.
 * This module carries only inputs: fixtures and the double that records what a
 * resolution did with them. Moving a golden here would put the record of what
 * the sequential code DID one import away from the code being tested — the
 * drift the differential control exists to prevent.
 */

import type { ResolveUserAuthzGrantsOptions } from './resolve-authz-context.js';

// ── Recording ObjectQL double ───────────────────────────────────────────────

export interface RecordedCall { object: string; where: unknown; limit: unknown; isSystem: boolean }

/**
 * An in-memory ObjectQL double that (a) records every read, (b) ENFORCES the
 * `limit` the caller passed — a real driver does, and a batch that quietly
 * changed a limit would otherwise be invisible — and (c) counts LEGS.
 *
 * Leg counting: every read yields on a real macrotask boundary before it
 * answers, so reads issued together are genuinely in flight together. A read
 * that starts while nothing else is in flight OPENS a leg; one that starts
 * while another is in flight JOINS the open leg. Sequential awaits therefore
 * count one leg each, and a `Promise.all` of any width counts one — which is
 * exactly the definition cloud#1539 measured latency against.
 */
export function makeRecordingQl(tables: Record<string, unknown[]>) {
  const calls: RecordedCall[] = [];
  const legOf: number[] = [];
  let inFlight = 0;
  let legs = 0;
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  return {
    calls,
    legOf,
    get legs() { return legs; },
    async find(object: string, opts: any) {
      if (inFlight === 0) legs += 1;
      inFlight += 1;
      legOf.push(legs);
      calls.push({
        object,
        where: opts?.where,
        limit: opts?.limit,
        isSystem: opts?.context?.isSystem === true,
      });
      try {
        await new Promise((r) => setTimeout(r, 0));
        const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      } finally {
        inFlight -= 1;
      }
    },
  };
}

// ── Fixture matrix — one entry per shape the eight reads discriminate on ────

/** Fixed clock; every validity window in the fixtures is relative to it. */
export const T0 = Date.UTC(2026, 0, 1);
const past = new Date(T0 - 86_400_000).toISOString();
const future = new Date(T0 + 86_400_000).toISOString();

export interface Fixture {
  name: string;
  userId: string;
  opts: ResolveUserAuthzGrantsOptions;
  tables: Record<string, unknown[]>;
}

/** 205 memberships for one user — the `sys_member {user_id}` limit is 200. */
const manyOwnMemberships = Array.from({ length: 205 }, (_, i) => ({
  user_id: 'u_lim',
  organization_id: `org_${String(i).padStart(4, '0')}`,
  role: 'member',
}));
/** 1005 peers in the active org — the fellow-org `sys_member` limit is 1000. */
const manyPeers = Array.from({ length: 1005 }, (_, i) => ({
  user_id: `peer_${String(i).padStart(4, '0')}`,
  organization_id: 'org_0000',
  role: 'member',
}));

export const FIXTURES: Fixture[] = [
  {
    // An authenticated principal that holds nothing at all. Fails closed to the
    // `everyone` anchor and an empty everything-else — never null.
    name: 'empty-principal',
    userId: 'u_empty',
    opts: { seedEmail: 'empty@x.com', nowMs: T0 },
    tables: { sys_user: [{ id: 'u_empty' }], sys_member: [], sys_user_position: [], sys_user_permission_set: [] },
  },
  {
    // Multi-org membership: positions come from the ACTIVE org only, while
    // `accessible_org_ids` spans every org — the two facts the ONE sys_member
    // read must keep in agreement.
    name: 'multi-org-membership',
    userId: 'u_multi',
    opts: { tenantId: 'org_a', seedEmail: 'multi@x.com', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_multi' }],
      sys_member: [
        { user_id: 'u_multi', organization_id: 'org_a', role: 'owner' },
        { user_id: 'u_multi', organization_id: 'org_b', role: 'admin' },
        { user_id: 'u_multi', organization_id: 'org_c', role: 'member', valid_until: past },
        { user_id: 'peer_1', organization_id: 'org_a', role: 'owner' },
        { user_id: 'peer_2', organization_id: 'org_b', role: 'owner' },
      ],
      sys_user_position: [],
      sys_user_permission_set: [],
    },
  },
  {
    // ⚠️ THE DIVERGENCE CASE the batch could plausibly introduce — and the
    // reason the two `sys_member` reads are NOT merged into one `$or`.
    //
    // `sys_member {user_id}` (memberships + org-admin roles) and
    // `sys_member {organization_id}` (fellow-org peers, limit 1000) read the
    // SAME table and are now issued in the same wave — the obvious "improvement"
    // is to merge them into one `$or`/unfiltered read and partition in memory.
    // Here that merge is a privilege escalation with no error anywhere:
    // `u_lapsed`'s OWN membership in org_a has lapsed (ADR-0091), while peers
    // hold ACTIVE `owner` rows in org_a. A merged read would put those peer rows
    // through the `accessible_org_ids` loop (granting org_a — the `group`
    // posture's whole read reach) and through the `activeMembers` role loop
    // (granting `org_owner`, and with it TENANT_ADMIN).
    //
    // Golden provenance (#10982 handoff, 2026-08-22 maintainer ruling item 2):
    // an earlier branch of this suite deliberately pinned the then-current
    // WRONG answer (`positions` ignored the validity window) so fixing it
    // would be an act, not drift. That fix has since landed on `main` (#11088
    // family): a lapsed membership is NO membership. The golden here is
    // captured from post-#10982 `main` and records the CORRECTED answer —
    // `accessible_org_ids: []`, no `org_owner`, posture MEMBER — which is the
    // right baseline, stated here so the value and its explanation cannot
    // drift apart again. The durable pins for the semantic itself live in
    // resolve-authz-context.test.ts (`#10982 — a lapsed sys_member row
    // confers no role either`); THIS fixture's job is the no-\$or-merge
    // scheduling control above. Peer rows still appear in `org_user_ids`,
    // because THAT is what the fellow-org read is for.
    name: 'lapsed-own-membership-among-active-peers',
    userId: 'u_lapsed',
    opts: { tenantId: 'org_a', seedEmail: 'lapsed@x.com', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_lapsed' }],
      sys_member: [
        { user_id: 'u_lapsed', organization_id: 'org_a', role: 'member', valid_until: past },
        { user_id: 'peer_1', organization_id: 'org_a', role: 'owner' },
        { user_id: 'peer_2', organization_id: 'org_a', role: 'admin' },
      ],
      sys_user_position: [],
      sys_user_permission_set: [],
    },
  },
  {
    // Position-derived grants: a global row, an org-scoped row for ANOTHER org
    // (must not resolve), a lapsed row, a not-yet-valid row, plus the ADR-0049
    // deactivated position whose NAME must leave `positions` too.
    name: 'position-derived-grants',
    userId: 'u_pos',
    opts: { tenantId: 'org_a', seedEmail: 'pos@x.com', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_pos' }],
      sys_member: [{ user_id: 'u_pos', organization_id: 'org_a', role: 'member' }],
      sys_user_position: [
        { user_id: 'u_pos', position: 'contributor', organization_id: null },
        { user_id: 'u_pos', position: 'auditor', organization_id: 'org_a' },
        { user_id: 'u_pos', position: 'foreigner', organization_id: 'org_z' },
        { user_id: 'u_pos', position: 'expired_role', organization_id: null, valid_until: past },
        { user_id: 'u_pos', position: 'future_role', organization_id: null, valid_from: future },
        { user_id: 'u_pos', position: 'retired', organization_id: null },
      ],
      sys_position: [
        { id: 'p_contrib', name: 'contributor' },
        { id: 'p_auditor', name: 'auditor', active: true },
        { id: 'p_retired', name: 'retired', active: false },
        { id: 'p_everyone', name: 'everyone' },
      ],
      sys_position_permission_set: [
        { position_id: 'p_contrib', permission_set_id: 'ps_write' },
        { position_id: 'p_auditor', permission_set_id: 'ps_read' },
        { position_id: 'p_retired', permission_set_id: 'ps_admin' },
        { position_id: 'p_everyone', permission_set_id: 'ps_base' },
      ],
      sys_permission_set: [
        { id: 'ps_write', name: 'write_all', system_permissions: '["record_write"]' },
        { id: 'ps_read', name: 'read_all', tab_permissions: '{"crm":"visible"}' },
        { id: 'ps_admin', name: 'admin_full_access' },
        { id: 'ps_base', name: 'base_access', tab_permissions: { crm: 'default_on' } },
      ],
      sys_user_permission_set: [],
    },
  },
  {
    // Permission-set-derived grants: the UNSCOPED `admin_full_access` user grant
    // is the ONLY thing that derives platform_admin, an org-scoped copy is not,
    // a lapsed one is not, and a DEACTIVATED set grants nothing at all.
    name: 'permission-set-derived-grants',
    userId: 'u_ps',
    opts: { tenantId: 'org_a', seedEmail: 'ps@x.com', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_ps' }],
      sys_member: [{ user_id: 'u_ps', organization_id: 'org_a', role: 'member' }],
      sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'u_ps', permission_set_id: 'ps_admin', organization_id: null },
        { user_id: 'u_ps', permission_set_id: 'ps_org', organization_id: 'org_a' },
        { user_id: 'u_ps', permission_set_id: 'ps_other', organization_id: 'org_z' },
        { user_id: 'u_ps', permission_set_id: 'ps_lapsed', organization_id: null, valid_until: past },
        { user_id: 'u_ps', permission_set_id: 'ps_dead', organization_id: null },
      ],
      sys_permission_set: [
        { id: 'ps_admin', name: 'admin_full_access', system_permissions: ['manage_users'] },
        { id: 'ps_org', name: 'org_tools', tab_permissions: { crm: 'hidden' } },
        { id: 'ps_other', name: 'other_org_tools' },
        { id: 'ps_lapsed', name: 'lapsed_set' },
        { id: 'ps_dead', name: 'dead_set', active: false },
      ],
      sys_position: [],
    },
  },
  {
    // TENANT_ADMIN rung: the org-admin capability, held through a position,
    // with a tab merge across two sets (highest visibility wins).
    name: 'tenant-admin-via-position',
    userId: 'u_ta',
    opts: { tenantId: 'org_a', seedEmail: 'ta@x.com', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_ta' }],
      sys_member: [{ user_id: 'u_ta', organization_id: 'org_a', role: 'admin' }],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u_ta', permission_set_id: 'ps_low', organization_id: null }],
      sys_position: [{ id: 'p_orgadmin', name: 'org_admin' }, { id: 'p_everyone', name: 'everyone' }],
      sys_position_permission_set: [{ position_id: 'p_orgadmin', permission_set_id: 'ps_oa' }],
      sys_permission_set: [
        { id: 'ps_low', name: 'low', tab_permissions: { crm: 'default_off' } },
        { id: 'ps_oa', name: 'organization_admin', tab_permissions: { crm: 'default_on' } },
      ],
    },
  },
  {
    // The `ai_seat` read: no seedEmail, so BOTH the `current_user.email`
    // fallback and the ADR-0024 seat synthesis need `sys_user` — and it must
    // still be read exactly ONCE (the #2409 memo).
    name: 'ai-seat-and-email-from-sys-user',
    userId: 'u_ai',
    opts: { tenantId: 'org_a', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_ai', email: 'ai@x.com', ai_access: 1 }],
      sys_member: [{ user_id: 'u_ai', organization_id: 'org_a', role: 'member' }],
      sys_user_position: [],
      sys_user_permission_set: [],
    },
  },
  {
    // `ai_access` falsy → NO seat, and the email fallback still lands. The
    // negative half of the read above: a batch that read the row but stopped
    // consulting the flag would pass the fixture above and fail this one.
    name: 'ai-seat-denied',
    userId: 'u_noai',
    opts: { nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_noai', email: 'noai@x.com', ai_access: 0 }],
      sys_member: [], sys_user_position: [], sys_user_permission_set: [],
    },
  },
  {
    // Caller-seeded principal (the API-key shape): seeded scopes come FIRST and
    // in order, the seeded email wins over `sys_user`, and because `ai_seat` is
    // already held the seat read must NOT be issued at all.
    name: 'seeded-permissions-and-email',
    userId: 'u_seed',
    opts: {
      tenantId: 'org_a',
      seedEmail: 'seed@x.com',
      seedPermissions: ['key_scope_b', 'key_scope_a', 'ai_seat'],
      nowMs: T0,
    },
    tables: {
      sys_user: [{ id: 'u_seed', email: 'ignored@x.com', ai_access: 1 }],
      sys_member: [{ user_id: 'u_seed', organization_id: 'org_a', role: 'member' }],
      sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u_seed', permission_set_id: 'ps_x', organization_id: null }],
      sys_permission_set: [{ id: 'ps_x', name: 'extra' }],
      sys_position: [],
    },
  },
  {
    // Limits interacting with the batch: 205 own memberships against the 200
    // limit, 1005 peers against the 1000 limit. Truncation is OBSERVABLE here
    // (the double slices like a driver), so a batch that changed either limit —
    // or merged the two reads under one of them — moves these arrays.
    name: 'read-limits-truncate',
    userId: 'u_lim',
    opts: { tenantId: 'org_0000', seedEmail: 'lim@x.com', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_lim' }],
      sys_member: [...manyOwnMemberships, ...manyPeers],
      sys_user_position: [],
      sys_user_permission_set: [],
    },
  },
  {
    // No active organization: every membership contributes its role (the
    // pre-ADR-0105-D2 org-less behaviour) and the fellow-org read is skipped
    // entirely — one fewer query, and the batch must skip it too.
    name: 'no-active-org',
    userId: 'u_noorg',
    opts: { seedEmail: 'noorg@x.com', nowMs: T0 },
    tables: {
      sys_user: [{ id: 'u_noorg' }],
      sys_member: [
        { user_id: 'u_noorg', organization_id: 'org_a', role: 'owner' },
        { user_id: 'u_noorg', organization_id: 'org_b', role: 'member,admin' },
      ],
      sys_user_position: [],
      sys_user_permission_set: [],
    },
  },
];
