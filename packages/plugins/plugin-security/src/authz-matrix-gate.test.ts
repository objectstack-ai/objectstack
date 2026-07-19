// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── Unit-layer authorization matrix gate (ADR-0095 D1) ──────────────────────
//
// ADR-0095 makes tenant isolation a refactor validated by a `role × object ×
// expected-visible-rows` snapshot: every cell must match across the Layer 0
// extraction EXCEPT the four deltas the architect accepted (all W1-class,
// all toward stronger/correcter isolation — see below). The existing
// conformance matrix (`packages/qa/dogfood/test/authz-conformance.matrix.ts`)
// proves this end-to-end through a real app boot (minutes). This file is the
// UNIT-LAYER equivalent so the loop is seconds: it drives the real
// SecurityPlugin CRUD middleware with the real seeded permission sets and
// snapshots the *effective RLS filter* each (role × object × operation) cell
// produces — the compiled filter the engine ANDs onto a read, or verifies the
// by-id write target against. Two filters selecting the same rows are the same
// visibility; the snapshot is that filter, verbatim.
//
// This file adds NO production code; it is the gate the extraction landed behind.
// The four accepted, ADR-authorized deltas (post-extraction values below):
//   (a) [W1 read]  a permissive business policy no longer OR-widens tenant scope
//       — a cross-org `public` row becomes INVISIBLE (Layer0 AND Layer1).
//   (b) [W1 write] `owner_only_writes` is no longer OR-diluted by the tenant
//       policy — a member's by-id write narrows to OWNER-only (was org-wide).
//   (c) [tenancy-disabled] a member reading a `tenancy.enabled:false` global
//       object is no longer scoped by a phantom org filter — the global catalog
//       is VISIBLE (Layer 0 correctly treats it as a non-tenant object; this
//       also retires the `extractTargetField` `==` blind spot for tenant scope).
//   (e) [no active org] a write by a principal with no active organization on a
//       tenant object is FAIL-CLOSED by Layer 0 (was owner-scoped only).
// Every OTHER change vs the pre-extraction snapshot is a same-visibility filter
// simplification (duplicate-OR dedup; dead org-clause removal on non-tenant
// objects) and is annotated inline.

import { describe, it, expect, vi } from 'vitest';
import { derivePosture, POSTURE_RANK } from '@objectstack/core';
import { SecurityPlugin, hasPlatformAdminCapability } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import type { PermissionSet } from '@objectstack/spec/security';

// A permissive, admin-authored business RLS policy (ADR-0095 W1's worked
// example): "everyone may read rows whose status is public". At the RLS layer
// this is OR-merged with the wildcard tenant policy today — so it is, by itself,
// sufficient to admit a row from ANOTHER organization. Modeled here as a custom
// set because W1 is about ANY permissive business policy, not a seeded one.
const publicReader: PermissionSet = {
  name: 'public_reader',
  label: 'Public Reader (permissive business RLS)',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true } },
  rowLevelSecurity: [
    { name: 'public_read', object: '*', operation: 'select', using: "status == 'public'" },
  ],
} as any;

// [ADR-0099 two-axis Amendment] A per-object super-bit DELEGATED to a non-admin
// position — the auditor pattern (Salesforce object-level View All / Modify All):
// "read (and write) every row of THIS ONE private object", granted without any
// admin stature. This is the scope-axis primitive posture cannot represent (it is
// per-principal × per-object); the P2′ cells below pin that it short-circuits
// Layer 1 for the holder AND stays walled by Layer 0 (invariant I7).
const invoiceAuditor: PermissionSet = {
  name: 'invoice_auditor',
  label: 'Invoice Auditor (delegated per-object view/modify all)',
  objects: { crm_secret: { allowRead: true, allowCreate: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true } },
} as any;

const ALL_SETS: PermissionSet[] = [...defaultPermissionSets, publicReader, invoiceAuditor];
const DENY = RLS_DENY_FILTER.id; // the fail-closed sentinel's marker value

// ── Minimal middleware harness ──────────────────────────────────────────────
// Drives the REAL security CRUD middleware against a single-object schema whose
// posture (public / private / tenancy-disabled / better-auth-managed) and field
// set are configurable, so one helper covers the whole object axis.
function makeHarness(opts: {
  objectName: string;
  objectFields: string[];
  schemaExtra?: Record<string, any>;
  orgScoping?: boolean;
  findOneImpl?: (q: any) => any;
}) {
  const fields: Record<string, any> = {};
  for (const f of opts.objectFields) fields[f] = { name: f };
  const baseSchema: any = { name: opts.objectName, fields, ...(opts.schemaExtra ?? {}) };
  let middleware: any;
  const findOne = vi.fn(async (_o: string, q: any) => (opts.findOneImpl ? opts.findOneImpl(q) : null));
  const ql = {
    registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
    getSchema: () => baseSchema,
    findOne,
  };
  const metadata = { get: async () => baseSchema, list: () => ALL_SETS };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  // Multi-org isolation active iff org-scoping is wired (ADR-0093 D4 — the exact
  // signal SecurityPlugin probes). `tenancy` service is absent here, so the
  // plugin falls back to the `org-scoping` probe (same as production baseline).
  if (opts.orgScoping) services['org-scoping'] = { name: 'org-scoping' };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`no service: ${name}`);
      return services[name];
    },
  };
  return { ctx, findOne, run: async (opCtx: any) => { await middleware(opCtx, async () => {}); return opCtx; } };
}

/** Effective READ filter the engine would AND onto a `find` (the visible-row set). */
async function readFilter(cell: any, roleCtx: any): Promise<unknown> {
  const plugin = new SecurityPlugin();
  const h = makeHarness({ ...cell, orgScoping: cell.orgScoping ?? true });
  await plugin.init(h.ctx); await plugin.start(h.ctx);
  const opCtx: any = { object: cell.objectName, operation: 'find', ast: { where: undefined }, context: roleCtx };
  try { await h.run(opCtx); } catch (e: any) { return `CRUD_DENY:${e?.name ?? 'err'}`; }
  return opCtx.ast.where ?? null;
}

/**
 * Effective WRITE filter used by the by-id update pre-image check — the row the
 * caller is allowed to mutate must satisfy it. Returned as the array of RLS
 * parts ANDed with the `{id}` guard (that guard is stripped). `BYPASS` = no
 * write filter (superuser). `CRUD_DENY` = blocked before the pre-image check.
 */
async function writeFilter(cell: any, roleCtx: any): Promise<unknown> {
  const plugin = new SecurityPlugin();
  const h = makeHarness({ ...cell, orgScoping: cell.orgScoping ?? true, findOneImpl: () => null });
  await plugin.init(h.ctx); await plugin.start(h.ctx);
  const opCtx: any = {
    object: cell.objectName, operation: 'update',
    data: { id: 'r1', name: 'x' }, options: { where: { id: 'r1' } }, context: roleCtx,
  };
  let threw: any = null;
  try { await h.run(opCtx); } catch (e: any) { threw = e; }
  if (h.findOne.mock.calls.length === 0) {
    return threw ? `CRUD_DENY:${threw?.name ?? 'err'}` : 'BYPASS(no-write-filter)';
  }
  return h.findOne.mock.calls[0][1].where.$and.slice(1);
}

/**
 * [#2937] Effective INSERT outcome for a supplied `organization_id`. Drives the
 * REAL insert path through the security CRUD middleware and reports either the
 * denial marker or the post-image `organization_id` the row would land with.
 * `CRUD_DENY:*` = blocked (CRUD gate or the Layer 0 tenant post-image check).
 */
async function insertOrg(cell: any, roleCtx: any, orgId: unknown): Promise<unknown> {
  const plugin = new SecurityPlugin();
  const h = makeHarness({ ...cell, orgScoping: cell.orgScoping ?? true });
  await plugin.init(h.ctx); await plugin.start(h.ctx);
  const opCtx: any = {
    object: cell.objectName, operation: 'insert',
    data: { name: 'x', ...(orgId === undefined ? {} : { organization_id: orgId }) },
    context: roleCtx,
  };
  try { await h.run(opCtx); } catch (e: any) { return `CRUD_DENY:${e?.name ?? 'err'}`; }
  return 'organization_id' in opCtx.data ? opCtx.data.organization_id : '<<absent>>';
}

/**
 * [Finding 1 / #2937] Effective by-id UPDATE outcome for a supplied
 * `organization_id`. Drives the REAL update path; the pre-image re-read (step 2.7)
 * is stubbed to return a matching row so the test isolates the Layer 0 post-image
 * tenant guard (step 3.7). `CRUD_DENY:*` = blocked (pre-image RLS, or the Layer 0
 * post-image re-point guard); otherwise the `organization_id` the row would keep.
 */
async function updateOrg(cell: any, roleCtx: any, orgId: unknown): Promise<unknown> {
  const plugin = new SecurityPlugin();
  const preImage = { id: 'r1', organization_id: roleCtx.tenantId ?? 'org-1', created_by: roleCtx.userId, name: 'old' };
  const h = makeHarness({ ...cell, orgScoping: cell.orgScoping ?? true, findOneImpl: () => preImage });
  await plugin.init(h.ctx); await plugin.start(h.ctx);
  const opCtx: any = {
    object: cell.objectName, operation: 'update',
    data: { id: 'r1', name: 'x', ...(orgId === undefined ? {} : { organization_id: orgId }) },
    options: { where: { id: 'r1' } }, context: roleCtx,
  };
  try { await h.run(opCtx); } catch (e: any) { return `CRUD_DENY:${e?.name ?? 'err'}`; }
  return 'organization_id' in opCtx.data ? opCtx.data.organization_id : '<<absent>>';
}

// ── Axes ─────────────────────────────────────────────────────────────────────
const OBJECTS = {
  // Ordinary tenant business object: has organization_id, public posture.
  task: { objectName: 'task', objectFields: ['id', 'organization_id', 'created_by', 'status', 'name'] },
  // Private object (access.default: private) — plain wildcard grant does NOT cover it (ADR-0066 ④).
  private_obj: { objectName: 'crm_secret', objectFields: ['id', 'organization_id', 'created_by', 'name'], schemaExtra: { access: { default: 'private' } } },
  // Platform-global object (tenancy.enabled: false), no organization_id column.
  platform_global: { objectName: 'sys_package', objectFields: ['id', 'name', 'visibility'], schemaExtra: { tenancy: { enabled: false } } },
  // Better-auth-managed identity table (managedBy: 'better-auth'); writes flow through better-auth.
  better_auth: { objectName: 'sys_user', objectFields: ['id', 'email', 'name'], schemaExtra: { managedBy: 'better-auth' } },
};

const ROLES = {
  // Platform admin: holds admin_full_access (viewAllRecords/modifyAllRecords) — the superuser bypass evidence.
  platform_admin: { userId: 'padmin', tenantId: 'org-1', positions: ['platform_admin'], permissions: ['admin_full_access'] },
  // Org admin: holds organization_admin (also viewAll/modifyAll, but tenant-scoped by its RLS).
  org_admin: { userId: 'oadmin', tenantId: 'org-1', positions: ['org_admin'], permissions: ['organization_admin'] },
  // Rank-and-file member: only the additive member_default baseline; org_member gates owner_only_*.
  member: { userId: 'u1', tenantId: 'org-1', positions: ['org_member'], permissions: [] },
  // Authenticated user with NO active organization → tenant scoping cannot resolve → fail-closed.
  no_org_member: { userId: 'u2', positions: ['org_member'], permissions: [] },
};

// The locked snapshot of POST-EXTRACTION behavior (Layer0 AND Layer1). Read the
// annotations against ADR-0095. Cells tagged [D1 accepted delta] are the four
// authorized changes; all others are unchanged or same-visibility simplifications.
const EXPECTED_MATRIX: Record<string, Record<string, { read: unknown; write: unknown }>> = {
  task: {
    // [posture-gate] Public business object → superuser bypass withheld, admin stays org-scoped (Layer 0).
    platform_admin: { read: { organization_id: 'org-1' }, write: [{ organization_id: 'org-1' }] },
    // Simplification: the pre-extraction duplicate-OR (`{$or:[{org},{org}]}` from
    // organization_admin + baseline) collapses to `{org}` — Layer 0 is the single owner.
    org_admin: {
      read: { organization_id: 'org-1' },
      write: [{ organization_id: 'org-1' }],
    },
    // [D1 accepted delta (b)] WRITE narrows from `org OR created_by` (org-wide) to
    // `org AND created_by` (owner-only) — owner_only_writes finally enforces.
    member: {
      read: { organization_id: 'org-1' },
      write: [{ $and: [{ organization_id: 'org-1' }, { created_by: 'u1' }] }],
    },
    // [D1 accepted delta (e)] no active org: Layer 0 fail-closes the WRITE
    // (was owner-scoped only). Read stays deny-sentinel (unchanged).
    no_org_member: { read: { id: DENY }, write: [{ $and: [{ id: DENY }, { created_by: 'u2' }] }] },
  },
  private_obj: {
    // [W2] TRUE platform admin: Layer 0 exemption (platform posture) + Layer 1
    // short-circuit (superuser bit) both fire on a private object → null.
    platform_admin: { read: null, write: 'BYPASS(no-write-filter)' },
    // [Finding 2 / #2937 — SECURITY NARROWING] An `organization_admin` holds the
    // superuser bit via its `'*'` wildcard, so it used to ALSO get the Layer 0
    // exemption and read/write EVERY tenant's rows on this private TENANT object
    // (a cross-tenant wall breach). It is NOT a platform admin (no platform-
    // exclusive capability), so the exemption is now WITHHELD: Layer 1 is still
    // short-circuited by the superuser bit (TENANT_ADMIN sees all rows in-org, no
    // ownership narrowing), but Layer 0 walls it to its own org.
    org_admin: {
      read: { organization_id: 'org-1' },
      write: [{ organization_id: 'org-1' }],
    },
    // A member's plain wildcard grant does not cover a private object → denied at the CRUD gate, before RLS.
    member: { read: 'CRUD_DENY:PermissionDeniedError', write: 'CRUD_DENY:PermissionDeniedError' },
    no_org_member: { read: 'CRUD_DENY:PermissionDeniedError', write: 'CRUD_DENY:PermissionDeniedError' },
  },
  platform_global: {
    // [W2] superuser bypass fires on tenancy-disabled posture → null.
    platform_admin: { read: null, write: 'BYPASS(no-write-filter)' },
    org_admin: { read: null, write: 'BYPASS(no-write-filter)' },
    // [D1 accepted delta (c)] A member reading a `tenancy.enabled:false` global
    // object: Layer 0 treats it as a NON-tenant object (no phantom org filter) →
    // the global catalog is VISIBLE (read: null).
    // [#2936] WRITE now fail-closes to the DENY sentinel. `sys_package` has no
    // `created_by` column, and the wildcard `owner_only_writes` policy authors
    // its predicate as `created_by == current_user.id` (canonical `==`).
    // Pre-#2936 `extractTargetField` did not recognize `==`, so the
    // field-existence net let the policy through and it compiled to a phantom
    // `{ created_by: … }` filter against a column the object lacks — a
    // driver-dependent, effectively-deny result. Now the net recognizes `==`,
    // sees `created_by` is absent, and drops the only applicable write policy →
    // deny sentinel (fail-closed). SAME effective visibility (a member cannot
    // by-id write a column-less global object either way); the mechanism is now
    // an explicit fail-closed deny instead of a phantom-column filter.
    member: { read: null, write: [{ id: DENY }] },
    // [#2936] no-org member: same fail-closed deny on the write (see above); the
    // global catalog stays VISIBLE on read (Layer 0 non-tenant, delta (c)).
    no_org_member: { read: null, write: [{ id: DENY }] },
  },
  better_auth: {
    // [W2] better-auth-managed posture → superuser read bypass → null.
    platform_admin: { read: null, write: 'BYPASS(no-write-filter)' },
    // Simplification: `sys_user` has no organization_id, so the pre-extraction
    // dead org-disjuncts drop; the duplicated `_self` policies remain (self only).
    org_admin: {
      read: { $or: [{ id: 'oadmin' }, { id: 'oadmin' }] },
      write: 'CRUD_DENY:PermissionDeniedError',
    },
    // Member: self only (dead org-clause removed); writes denied (better-auth door).
    member: { read: { id: 'u1' }, write: 'CRUD_DENY:PermissionDeniedError' },
    // No-org member: self only; writes denied.
    no_org_member: { read: { id: 'u2' }, write: 'CRUD_DENY:PermissionDeniedError' },
  },
};

describe('authz Layer-0 matrix gate — ADR-0095 D1 (post-extraction)', () => {
  it('locks the role × object × {read,write} effective-filter matrix', async () => {
    const actual: Record<string, Record<string, { read: unknown; write: unknown }>> = {};
    for (const [oName, cell] of Object.entries(OBJECTS)) {
      actual[oName] = {};
      for (const [rName, role] of Object.entries(ROLES)) {
        actual[oName][rName] = { read: await readFilter(cell, role), write: await writeFilter(cell, role) };
      }
    }
    expect(actual).toEqual(EXPECTED_MATRIX);
  });

  // ── W1: cross-tenant read leak, CLOSED by Layer 0 ─────────────────────────
  // [ADR-0095 D1 accepted delta (a)] A user holding a permissive business RLS
  // policy (`status == 'public'`) reads a tenant object. Pre-extraction the
  // wildcard tenant policy was OR-merged with it (`tenant OR status==public`), so
  // a foreign-org public row matched the second disjunct and was VISIBLE. Layer 0
  // now AND-composes the tenant wall ahead of business RLS, so the effective read
  // is `Layer0(org) AND Layer1(status==public)` — the foreign-org public row is
  // INVISIBLE. This is the W1 fix.
  it('[W1] permissive business RLS is AND-composed under Layer 0 (cross-org public row INVISIBLE)', async () => {
    const filter = await readFilter(OBJECTS.task, {
      userId: 'u3', tenantId: 'org-1', positions: ['org_member'], permissions: ['public_reader'],
    });
    // Post-D1: tenant wall AND business policy — no OR-widening.
    expect(filter).toEqual({ $and: [{ organization_id: 'org-1' }, { status: 'public' }] });
    // A foreign-org public row now FAILS the tenant conjunct → invisible.
    const foreignPublicRow: Record<string, unknown> = { organization_id: 'org-2', status: 'public' };
    const andClauses = (filter as any).$and as Array<Record<string, unknown>>;
    const visible = andClauses.every((c) =>
      Object.entries(c).every(([k, v]) => foreignPublicRow[k] === v));
    expect(visible).toBe(false); // ← [ADR-0095 W1 fix] the leak is closed.
  });

  // ── W1's write-side twin: owner_only now enforces (delta b) ───────────────
  // [ADR-0095 D1 accepted delta (b)] The same OR-merge that leaked reads also
  // WIDENED a restrictive write policy: a member's `owner_only_writes`
  // (created_by == me) was OR'd with the tenant policy, so the by-id write
  // pre-image resolved to `org OR created_by` = any row in the member's org.
  // Layer 0 now AND-composes the tenant scope, so the pre-image is
  // `Layer0(org) AND Layer1(created_by == me)` = owner-only, as authored.
  it('[W1-write] member by-id write narrows to owner-only under Layer 0', async () => {
    const wf = await writeFilter(OBJECTS.task, ROLES.member);
    expect(wf).toEqual([{ $and: [{ organization_id: 'org-1' }, { created_by: 'u1' }] }]);
  });

  // ── W2: the superuser bypass short-circuits BOTH layers via one bit ────────
  // On private / platform-global / better-auth objects a superuser-bit holder
  // skips ALL wildcard RLS — tenant wall included — through a single check. On a
  // PUBLIC business object the posture gate withholds the bypass, so the admin
  // stays org-scoped. Both facets locked.
  it('[W2] superuser bypass fires on private/platform-global/better-auth, withheld on public business objects', async () => {
    expect(await readFilter(OBJECTS.private_obj, ROLES.platform_admin)).toBeNull();
    expect(await readFilter(OBJECTS.platform_global, ROLES.platform_admin)).toBeNull();
    expect(await readFilter(OBJECTS.better_auth, ROLES.platform_admin)).toBeNull();
    // Withheld on a public tenant object → admin remains org-scoped (the posture gate).
    expect(await readFilter(OBJECTS.task, ROLES.platform_admin)).toEqual({ organization_id: 'org-1' });
  });

  // ── Fail-closed: an authenticated user with no active org sees no tenant rows ─
  it('[fail-closed] no active organization → tenant read denies via the sentinel', async () => {
    expect(await readFilter(OBJECTS.task, ROLES.no_org_member)).toEqual({ id: DENY });
  });

  // ── #2937: Layer 0 INSERT post-image tenant check ─────────────────────────
  // insert has no pre-image, so the tenant wall never reached it: a member could
  // `insert` a row with a FORGED organization_id and land it in another tenant.
  // The Layer 0 insert post-image check closes this — a SUPPLIED organization_id
  // must equal the caller's active org; an absent value is left to the
  // enterprise auto-stamp (organizations plugin), and system/platform-admin/
  // single-mode paths are exempt exactly as on the read side.
  describe('[#2937] Layer 0 insert post-image tenant guard', () => {
    it('member inserting a FORGED cross-tenant organization_id is DENIED', async () => {
      expect(await insertOrg(OBJECTS.task, ROLES.member, 'org-2')).toBe('CRUD_DENY:PermissionDeniedError');
    });
    it('member inserting the SAME-tenant organization_id is allowed (row keeps it)', async () => {
      expect(await insertOrg(OBJECTS.task, ROLES.member, 'org-1')).toBe('org-1');
    });
    it('member inserting with NO organization_id passes the wall (auto-stamp territory)', async () => {
      // plugin-security does not stamp; an absent value is the organizations
      // plugin's job. The Layer 0 check must NOT deny it (ordering-independent).
      expect(await insertOrg(OBJECTS.task, ROLES.member, undefined)).toBe('<<absent>>');
    });
    it('member with NO active org supplying ANY organization_id is fail-closed DENIED', async () => {
      expect(await insertOrg(OBJECTS.task, ROLES.no_org_member, 'org-1')).toBe('CRUD_DENY:PermissionDeniedError');
    });
    it('platform admin may insert a cross-org row on a PRIVATE object (posture exemption)', async () => {
      // private posture permits the platform-admin superuser bypass → Layer 0 null.
      expect(await insertOrg(OBJECTS.private_obj, ROLES.platform_admin, 'org-2')).toBe('org-2');
    });
    it('platform admin stays org-scoped on a PUBLIC business object (no exemption)', async () => {
      // public tenant business object → posture gate withholds the bypass → the
      // forged cross-org insert is DENIED even for a platform admin.
      expect(await insertOrg(OBJECTS.task, ROLES.platform_admin, 'org-2')).toBe('CRUD_DENY:PermissionDeniedError');
    });
    it('platform-global (tenancy-disabled) object: supplied org value is untouched', async () => {
      // non-tenant object → Layer 0 contributes nothing → no insert check.
      expect(await insertOrg(OBJECTS.platform_global, ROLES.member, 'org-2')).toBe('org-2');
    });
    it('single-org mode: Layer 0 inert, a supplied organization_id is NOT checked', async () => {
      const single = { ...OBJECTS.task, orgScoping: false };
      expect(await insertOrg(single, ROLES.member, 'org-2')).toBe('org-2');
    });
  });

  // ── [Finding 1 / #2937 BLOCKER] Layer 0 UPDATE post-image tenant guard ──────
  // The insert post-image guard has a symmetric UPDATE twin: a member owning a
  // row in org A could `update` it with `{organization_id: victim org B}` and
  // MOVE the row into another tenant (auto-stamp is insert-only, FLS/readonly
  // don't protect it, the pre-image check validates only the OLD org). The Layer
  // 0 post-image check makes `organization_id` immutable in non-platform user
  // contexts — the only value that passes is the caller's active org.
  describe('[Finding 1 / #2937] Layer 0 update post-image tenant guard (cross-tenant re-point)', () => {
    it('member RE-POINTING organization_id to another tenant is DENIED', async () => {
      expect(await updateOrg(OBJECTS.task, ROLES.member, 'org-2')).toBe('CRUD_DENY:PermissionDeniedError');
    });
    it('member updating with the SAME (active-org) organization_id is allowed', async () => {
      expect(await updateOrg(OBJECTS.task, ROLES.member, 'org-1')).toBe('org-1');
    });
    it('member update that does NOT touch organization_id is unaffected', async () => {
      expect(await updateOrg(OBJECTS.task, ROLES.member, undefined)).toBe('<<absent>>');
    });
    it('member with NO active org supplying ANY organization_id is fail-closed DENIED', async () => {
      expect(await updateOrg(OBJECTS.task, ROLES.no_org_member, 'org-1')).toBe('CRUD_DENY:PermissionDeniedError');
    });
    it('org_admin RE-POINTING organization_id to another tenant is DENIED (not a platform admin)', async () => {
      // org_admin holds the superuser bit but not the platform posture, so it is
      // Layer-0-walled to its own org on the public business object too.
      expect(await updateOrg(OBJECTS.task, ROLES.org_admin, 'org-2')).toBe('CRUD_DENY:PermissionDeniedError');
    });
    it('platform admin may re-point organization_id on a PRIVATE object (posture exemption)', async () => {
      expect(await updateOrg(OBJECTS.private_obj, ROLES.platform_admin, 'org-2')).toBe('org-2');
    });
    it('platform admin stays org-scoped on a PUBLIC business object (re-point DENIED)', async () => {
      expect(await updateOrg(OBJECTS.task, ROLES.platform_admin, 'org-2')).toBe('CRUD_DENY:PermissionDeniedError');
    });
    it('single-org mode: Layer 0 inert, a supplied organization_id is NOT checked on update', async () => {
      const single = { ...OBJECTS.task, orgScoping: false };
      expect(await updateOrg(single, ROLES.member, 'org-2')).toBe('org-2');
    });
  });

  // ── [Finding 2 / #2937] org_admin does NOT cross the Layer 0 wall ───────────
  // The Layer 0 cross-tenant exemption is gated on the TRUE PLATFORM_ADMIN posture
  // (a platform-exclusive capability), not the raw superuser bit an
  // `organization_admin` also holds. So an org admin is walled to its own tenant
  // on PRIVATE tenant objects, while a real platform admin still crosses it, and
  // the better-auth carve-out is untouched.
  describe('[Finding 2 / #2937] Layer 0 cross-tenant exemption requires the platform posture', () => {
    it('org_admin on a PRIVATE tenant object is Layer-0-walled to its own org (read)', async () => {
      expect(await readFilter(OBJECTS.private_obj, ROLES.org_admin)).toEqual({ organization_id: 'org-1' });
    });
    it('org_admin on a PRIVATE tenant object is Layer-0-walled to its own org (write pre-image)', async () => {
      expect(await writeFilter(OBJECTS.private_obj, ROLES.org_admin)).toEqual([{ organization_id: 'org-1' }]);
    });
    it('TRUE platform admin still crosses the wall on a PRIVATE object (read null)', async () => {
      expect(await readFilter(OBJECTS.private_obj, ROLES.platform_admin)).toBeNull();
    });
    it('org_admin stays walled on a PUBLIC tenant object too (regression)', async () => {
      expect(await readFilter(OBJECTS.task, ROLES.org_admin)).toEqual({ organization_id: 'org-1' });
    });
    it('better-auth-managed identity table carve-out is unaffected for org_admin (self-only, no org filter)', async () => {
      expect(await readFilter(OBJECTS.better_auth, ROLES.org_admin)).toEqual({ $or: [{ id: 'oadmin' }, { id: 'oadmin' }] });
    });
  });

  // ── Single-org mode: Layer 0 is inert; tenant policy stripped (parity today) ─
  // With org-scoping absent, collectRLSPolicies strips the wildcard tenant policy
  // entirely, so a member's read carries NO tenant where and the write keeps only
  // the owner scope. ADR-0095: in single mode Layer 0 contributes nothing — this
  // cell must NOT move after the extraction.
  it('[single-mode] tenant policy stripped when org-scoping is absent', async () => {
    const single = { ...OBJECTS.task, orgScoping: false };
    expect(await readFilter(single, ROLES.member)).toBeNull();
    expect(await writeFilter(single, ROLES.member)).toEqual([{ created_by: 'u1' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADR-0099 P0 — probe vs carried-rung equivalence gate (#3211 M1)
// ═══════════════════════════════════════════════════════════════════════════
//
// ADR-0099 D1 makes the CARRIED `ctx.posture` rung the single tier-adjudication
// input; the capability probe (`hasPlatformAdminCapability`, today's Layer 0
// exemption evidence) demotes to a resolver-less fallback that MAY ONLY NARROW.
// The P1 flip lands behind THIS gate: for every seeded principal shape the two
// derivations must agree; where they disagree the cell is pinned as a
// KNOWN DIVERGENCE and the flip is a per-delta-adjudicated NARROWING (#3211 G1).
//
// The two evidence sources are NOT the same question:
//   probe — does the RESOLVED SET CONTENT carry a platform-exclusive capability?
//   rung  — does the principal hold an UNSCOPED `admin_full_access` GRANT
//           (`sys_user_permission_set` row with organization_id == null —
//           the #2949 rule, `resolve-authz-context.ts` step 6d)?
// Seeded shapes agree (the unscoped grant is the only seeded path to those
// capabilities). Adversarial shapes below document the divergence class.
describe('ADR-0099 P0 — probe vs carried-rung equivalence (#3211 M1)', () => {
  const evaluator = new PermissionEvaluator();
  const byName = (...names: string[]): PermissionSet[] =>
    ALL_SETS.filter((ps) => names.includes(ps.name));
  const probe = (sets: PermissionSet[]): boolean =>
    hasPlatformAdminCapability(evaluator.getSystemPermissions(sets));

  // Every seeded principal shape: the resolved sets the middleware would see,
  // and the grant evidence the resolver would see (per resolve-authz-context 6d).
  const SEEDED_SHAPES = [
    {
      shape: 'platform_admin — UNSCOPED admin_full_access grant',
      sets: byName('admin_full_access', 'member_default'),
      evidence: { isPlatformAdmin: true, isTenantAdmin: false },
    },
    {
      shape: 'org_admin — organization_admin capability, no platform grant',
      sets: byName('organization_admin', 'member_default'),
      evidence: { isPlatformAdmin: false, isTenantAdmin: true },
    },
    {
      shape: 'member — additive baseline only',
      sets: byName('member_default'),
      evidence: { isPlatformAdmin: false, isTenantAdmin: false },
    },
    {
      shape: 'permissive-business-RLS holder (W1 fixture set)',
      sets: byName('public_reader', 'member_default'),
      evidence: { isPlatformAdmin: false, isTenantAdmin: false },
    },
  ] as const;

  it.each(SEEDED_SHAPES)('[D1 equivalence] $shape: probe agrees with the carried rung', ({ sets, evidence }) => {
    expect(probe(sets as PermissionSet[])).toBe(derivePosture(evidence) === 'PLATFORM_ADMIN');
  });

  // ── KNOWN DIVERGENCE (a) — scoped admin_full_access grant ─────────────────
  // A grant of `admin_full_access` SCOPED to one org (organization_id != null)
  // merges the set's CONTENTS into the principal's resolved sets (the probe's
  // input is identical to a true platform admin's), but the resolver does NOT
  // count a scoped grant as platform-admin evidence (#2949) → rung = MEMBER.
  // TODAY: probe true → such a principal crosses the Layer 0 wall wherever the
  // object posture permits. AFTER P1: rung authoritative → walled to its org.
  // This is the P1 NARROWING delta — adjudicated at #3211 G1, release-noted,
  // and recoverable by granting the UNSCOPED admin_full_access instead.
  it('[KNOWN DIVERGENCE (a)] scoped admin_full_access grant: probe=true, rung=MEMBER', () => {
    const sets = byName('admin_full_access', 'member_default'); // contents identical to the unscoped holder
    const evidence = { isPlatformAdmin: false, isTenantAdmin: false }; // scoped grant → not counted (#2949)
    expect(probe(sets)).toBe(true);
    expect(derivePosture(evidence)).toBe('MEMBER');
  });

  // ── KNOWN DIVERGENCE (b) — piecemeal platform-exclusive capability ────────
  // An admin-authored custom set granting a platform-exclusive capability
  // (`studio.access` here) WITHOUT the unscoped admin_full_access grant:
  // probe true / rung MEMBER. Same P1 narrowing class as (a). Note the probe
  // needs the superuser bit TOO before any exemption fires — this shape only
  // reaches the wall if it ALSO composes viewAll/modifyAll from some set.
  it('[KNOWN DIVERGENCE (b)] piecemeal studio.access without the unscoped grant: probe=true, rung=MEMBER', () => {
    const studioOps: PermissionSet = {
      name: 'studio_ops',
      label: 'Studio Ops (piecemeal platform capability)',
      objects: {},
      systemPermissions: ['studio.access'],
    } as any;
    expect(probe([studioOps])).toBe(true);
    expect(derivePosture({ isPlatformAdmin: false, isTenantAdmin: false })).toBe('MEMBER');
  });

  // ── [I3 — fallback may only narrow] rung ⊆ probe, never the reverse ───────
  // The unscoped admin_full_access grant carries the platform-exclusive caps by
  // seed definition, so rung=PLATFORM_ADMIN ⇒ probe=true over every shape above
  // (seeded AND adversarial). The demoted probe can therefore only WIDEN relative
  // to the rung — meaning the P1 flip (probe → rung) can only NARROW. The
  // reverse implication is exactly what diverges (cells (a)/(b)).
  it('[I3] rung=PLATFORM_ADMIN implies probe=true for every shape (flip can only narrow)', () => {
    for (const { sets, evidence } of SEEDED_SHAPES) {
      if (derivePosture(evidence) === 'PLATFORM_ADMIN') {
        expect(probe(sets as PermissionSet[])).toBe(true);
      }
    }
  });

  // ── [I2 — nesting at the adjudication site] ───────────────────────────────
  // ADR-0095 D2's nesting invariant, asserted over the LOCKED effective-filter
  // matrix (not only at derivation): within each object column, visibility never
  // widens as the ladder descends. Rank: all-rows (null/BYPASS) > org-scoped >
  // owner/self-scoped > denied. Ties are allowed (equal visibility), widening is not.
  it('[I2] visibility is monotonically non-widening down the ladder, per object column', () => {
    const rank = (cell: unknown): number => {
      const s = JSON.stringify(cell);
      if (cell === null || s.includes('BYPASS')) return 3;               // all rows
      if (s.includes('CRUD_DENY') || s.includes(DENY)) return 0;         // denied
      if (s.includes('created_by') || s.includes('"id"')) return 1;      // owner/self-scoped
      return 2;                                                          // org-scoped
    };
    const LADDER_ORDER = ['platform_admin', 'org_admin', 'member'] as const;
    for (const [oName, col] of Object.entries(EXPECTED_MATRIX)) {
      for (const side of ['read', 'write'] as const) {
        for (let i = 1; i < LADDER_ORDER.length; i++) {
          const higher = rank(col[LADDER_ORDER[i - 1]][side]);
          const lower = rank(col[LADDER_ORDER[i]][side]);
          expect(higher, `${oName}.${side}: ${LADDER_ORDER[i - 1]} ⊇ ${LADDER_ORDER[i]}`).toBeGreaterThanOrEqual(lower);
        }
      }
    }
  });

  // ── [D3 dead branch] capability evidence can never derive EXTERNAL ────────
  // The EXTERNAL rung activates only from `audience:'external'` (ADR-0090 D10)
  // when the portal principal type ships; no combination of capability-grant
  // evidence may reach it. (Full EXTERNAL × layer share-fixture cells live in
  // posture-ladder.test.ts — the semantics lock — and extend at P3.)
  it('[D3 dead branch] no capability-grant evidence derives EXTERNAL', () => {
    for (const isPlatformAdmin of [true, false]) {
      for (const isTenantAdmin of [true, false]) {
        expect(derivePosture({ isPlatformAdmin, isTenantAdmin })).not.toBe('EXTERNAL');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADR-0099 P1 — Layer 0 exemption reads the carried rung (#3211 M2)
// ═══════════════════════════════════════════════════════════════════════════
//
// The flip: `computeLayeredRlsFilter`'s Layer 0 cross-tenant exemption now reads
// the CARRIED `ctx.posture` rung as authoritative (#2956 plumbs it), with the
// capability probe demoted to a fallback for contexts that carry no rung. These
// cells assert the flipped behavior for the divergence class the P0 gate pinned:
//   - carried MEMBER rung (a scoped `admin_full_access` holder — G1 delta (a)) is
//     now WALLED to its org, where the posture-blind probe used to exempt it;
//   - a carried PLATFORM_ADMIN rung stays exempt (rung authority, unchanged);
//   - a carried TENANT_ADMIN rung stays walled (invariant I1);
//   - a resolver-less context (no rung) still uses the probe — the internal
//     paths (delegated-admin, sharing service, getReadFilter) are byte-for-byte
//     unchanged until ADR-0096 D3 eliminates hand-built contexts;
//   - a probe/rung disagreement logs a defect breadcrumb (I4) and enforces the
//     narrower rung verdict.
describe('ADR-0099 P1 — Layer 0 exemption reads the carried rung (#3211 M2)', () => {
  // G1 delta (a): a SCOPED admin_full_access grant. Its set contents make the
  // probe say platform-admin, but the resolver derives MEMBER (#2949), and that
  // carried rung now governs — the holder is walled to its own org (the narrowing).
  const scopedGrantHolder = {
    userId: 'scoped-admin', tenantId: 'org-1',
    positions: ['org_member'], permissions: ['admin_full_access'],
    posture: 'MEMBER',
  };

  it('[P1 narrowing / delta (a)] carried MEMBER rung WALLS a scoped-grant holder (read)', async () => {
    expect(await readFilter(OBJECTS.private_obj, scopedGrantHolder)).toEqual({ organization_id: 'org-1' });
  });
  it('[P1 narrowing / delta (a)] carried MEMBER rung WALLS a scoped-grant holder (write pre-image)', async () => {
    expect(await writeFilter(OBJECTS.private_obj, scopedGrantHolder)).toEqual([{ organization_id: 'org-1' }]);
  });

  it('[P1 invariant] a true platform admin carrying PLATFORM_ADMIN stays exempt (read null)', async () => {
    const carriedAdmin = { ...ROLES.platform_admin, posture: 'PLATFORM_ADMIN' };
    expect(await readFilter(OBJECTS.private_obj, carriedAdmin)).toBeNull();
  });

  it('[P1 / I1] org_admin carrying TENANT_ADMIN stays walled (TENANT_ADMIN never crosses Layer 0)', async () => {
    const tenantAdmin = { ...ROLES.org_admin, posture: 'TENANT_ADMIN' };
    expect(await readFilter(OBJECTS.private_obj, tenantAdmin)).toEqual({ organization_id: 'org-1' });
  });

  // Fallback: NO carried rung (a delegated-admin / sharing-service / getReadFilter
  // context built without the resolver) → the probe governs, exactly as pre-P1.
  // The same scoped holder, sans `posture`, is exempt via the probe — behavior
  // preserved on the internal paths.
  it('[P1 fallback] a resolver-less context (no rung) uses the probe — behavior preserved', async () => {
    const { posture: _drop, ...scopedNoRung } = scopedGrantHolder;
    expect(await readFilter(OBJECTS.private_obj, scopedNoRung)).toBeNull();
  });

  // I4: enforcement and the probe disagree only on the divergence class; the gate
  // logs a defect breadcrumb and enforces the (narrower) carried rung.
  it('[P1 / I4] a probe↔rung disagreement logs a defect breadcrumb; carried rung wins', async () => {
    const plugin = new SecurityPlugin();
    const h = makeHarness({ ...OBJECTS.private_obj, orgScoping: true });
    await plugin.init(h.ctx); await plugin.start(h.ctx);
    const opCtx: any = {
      object: OBJECTS.private_obj.objectName, operation: 'find',
      ast: { where: undefined }, context: scopedGrantHolder,
    };
    await h.run(opCtx);
    expect(opCtx.ast.where).toEqual({ organization_id: 'org-1' }); // narrower rung enforced
    expect(h.ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[authz/ADR-0099]'),
      expect.objectContaining({ carriedPosture: 'MEMBER', probePlatformAdmin: true }),
    );
  });

  // Agreement path: a true platform admin carrying PLATFORM_ADMIN — probe and rung
  // agree, so NO defect breadcrumb is logged.
  it('[P1 / I4] no breadcrumb when probe and rung agree (true platform admin)', async () => {
    const plugin = new SecurityPlugin();
    const h = makeHarness({ ...OBJECTS.private_obj, orgScoping: true });
    await plugin.init(h.ctx); await plugin.start(h.ctx);
    const opCtx: any = {
      object: OBJECTS.private_obj.objectName, operation: 'find',
      ast: { where: undefined }, context: { ...ROLES.platform_admin, posture: 'PLATFORM_ADMIN' },
    };
    await h.run(opCtx);
    const authzWarn = (h.ctx.logger.warn as any).mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('[authz/ADR-0099]'),
    );
    expect(authzWarn).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADR-0099 P2′ — two-axis: per-object super-bit is the Layer 1 scope,
//                posture is only the boundary (#3211 M3′)
// ═══════════════════════════════════════════════════════════════════════════
//
// The two-axis Amendment (2026-07-18): the original P2 (collapse the Layer 1
// tier onto posture) was REJECTED — Layer 1's tier input is the per-object
// super-bit, a per-principal × per-object DELEGATION primitive that posture (one
// rung per principal) structurally cannot carry. Collapsing it would have made a
// declared, grantable bit conditionally inert (the ADR-0049 class) and deleted
// the mainstream "delegate view-all of one object to a non-admin" capability.
//
// These are documentation cells, zero behavior change. They pin:
//   1. the two axes AGREE on the seeded surface (every seeded super-bit holder
//      is already >= TENANT_ADMIN — so the seeded face never needed collapsing);
//   2. the DELEGATION cell — a MEMBER holding a delegated per-object super-bit
//      short-circuits Layer 1 (all rows in-org) AND stays walled by Layer 0
//      (I7). LOAD-BEARING: a future "posture convergence" cleanup MUST keep this
//      green or it silently deletes the auditor pattern;
//   3. I7 — the scope axis never crosses a boundary the posture axis has not
//      opened (the holder cannot read/write/insert cross-tenant).
describe("ADR-0099 P2′ — per-object super-bit is the Layer 1 scope axis (#3211 M3′)", () => {
  const evaluator = new PermissionEvaluator();
  const byName = (...names: string[]): PermissionSet[] =>
    ALL_SETS.filter((ps) => names.includes(ps.name));
  const tenantPlus = (evidence: { isPlatformAdmin: boolean; isTenantAdmin: boolean }): boolean =>
    POSTURE_RANK[derivePosture(evidence)] >= POSTURE_RANK.TENANT_ADMIN;

  // ── Seeded-face agreement ─────────────────────────────────────────────────
  // On the seeded surface the two axes coincide: the ONLY seeded sets granting a
  // super-bit are admin_full_access + organization_admin, both of which resolve
  // to posture >= TENANT_ADMIN. So "holds the super-bit" and "posture >=
  // TENANT_ADMIN" agree for every seeded principal — which is exactly why the
  // seeded matrix never moved under P1, and why the collapse *looked* safe until
  // the delegation case (below) showed the axes are not the same fact.
  const SEEDED = [
    { shape: 'admin_full_access holder', sets: byName('admin_full_access', 'member_default'), evidence: { isPlatformAdmin: true, isTenantAdmin: false } },
    { shape: 'organization_admin holder', sets: byName('organization_admin', 'member_default'), evidence: { isPlatformAdmin: false, isTenantAdmin: true } },
    { shape: 'baseline member', sets: byName('member_default'), evidence: { isPlatformAdmin: false, isTenantAdmin: false } },
  ] as const;

  it.each(SEEDED)('[seeded agreement] $shape: holds Layer 1 super-bit ⟺ posture ≥ TENANT_ADMIN', ({ sets, evidence }) => {
    const holdsReadBit = evaluator.hasSuperuserReadBypass('crm_secret', sets as PermissionSet[], { isPrivate: true });
    expect(holdsReadBit).toBe(tenantPlus(evidence));
  });

  // ── The delegation cell — LOAD-BEARING (the auditor pattern) ───────────────
  // A MEMBER holding a per-object view/modify-all on ONE private object. Posture
  // is MEMBER, so the two axes DIVERGE here (super-bit true, posture < TENANT_ADMIN)
  // — the case the original P2 would have broken. It must: short-circuit Layer 1
  // (see every row IN-ORG) yet stay walled by Layer 0 (org-1 only).
  const auditor = {
    userId: 'auditor', tenantId: 'org-1',
    positions: ['org_member'], permissions: ['invoice_auditor'],
    posture: 'MEMBER',
  };

  it('[delegation] MEMBER with a delegated per-object view-all sees ALL rows in-org (Layer 1 short-circuit)', async () => {
    // Layer 1 short-circuits to null (the super-bit); Layer 0 AND-composes the
    // org wall (posture is not PLATFORM_ADMIN) → effective read = the org wall.
    expect(await readFilter(OBJECTS.private_obj, auditor)).toEqual({ organization_id: 'org-1' });
  });

  it('[delegation / I7] the holder stays tenant-walled on write (Layer 0 pre-image, not a full BYPASS)', async () => {
    // modifyAllRecords short-circuits Layer 1, but isPlatformAdmin=false so Layer 0
    // is the write pre-image: the holder is boxed to org-1 (contrast: a true
    // platform admin returns BYPASS here). The scope bit did not cross the boundary.
    expect(await writeFilter(OBJECTS.private_obj, auditor)).toEqual([{ organization_id: 'org-1' }]);
  });

  it('[delegation / I7] a supplied cross-tenant organization_id on insert is DENIED for the holder', async () => {
    expect(await insertOrg(OBJECTS.private_obj, auditor, 'org-2')).toBe('CRUD_DENY:PermissionDeniedError');
  });

  // ── Contrast — the bit is a REAL, grantable capability, not conditionally inert ─
  // Without the delegation a plain member cannot even read the private object (the
  // wildcard grant does not cover a private posture — ADR-0066 ④). So the per-object
  // bit is precisely what unlocks view-all; collapsing the tier onto posture would
  // have made writing that bit a silent no-op for a member (the ADR-0049 class).
  it('[contrast] a plain member WITHOUT the delegated bit is denied on the private object', async () => {
    expect(await readFilter(OBJECTS.private_obj, ROLES.member)).toBe('CRUD_DENY:PermissionDeniedError');
  });
});
