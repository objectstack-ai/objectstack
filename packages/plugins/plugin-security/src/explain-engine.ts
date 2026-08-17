// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D6] Access-explanation engine — `explain(principal, object,
 * operation)` as a first-class API.
 *
 * "Explained by construction": every layer below calls the SAME functions the
 * enforcement middleware calls — the shared permission-set resolution, the
 * shared `PermissionEvaluator`, the shared RLS compiler — injected from
 * `SecurityPlugin` so the report can never drift from enforcement. The engine
 * adds no evaluation logic of its own; it only records what each pipeline
 * layer contributed:
 *
 *   principal → required_permissions → object_crud → fls → owd_baseline →
 *   depth → sharing → vama_bypass → rls
 *
 * The dual use (D6): admins ask "why can 张三 PATCH 李四's leave_request?",
 * and the AI-safety story gets its audit substrate — a publish gate can show
 * the SEMANTIC impact of a grant change instead of a JSON diff.
 */

import {
  isGrantActive,
  isGrantExpired,
  derivePosture as deriveAdminPosture,
  resolveUserAuthzGrants,
} from '@objectstack/core';
import { matchesFilterCondition } from '@objectstack/formula';
import { BUILTIN_IDENTITY_PLATFORM_ADMIN, ORGANIZATION_ADMIN_GRANTS } from '@objectstack/spec';
import type { FieldMaskingRule } from '@objectstack/spec/data';
import type { PermissionSet } from '@objectstack/spec/security';
import type {
  AuthzPosture,
  ExplainDecision,
  ExplainLayer,
  ExplainMatchedRule,
  ExplainOperation,
  ExplainRecordAttribution,
} from '@objectstack/spec/security';
import type { PermissionEvaluator } from './permission-evaluator.js';
import { superuserBypassBitForOperation } from './permission-evaluator.js';

const SYSTEM_CTX = { isSystem: true } as const;

/** Owner field convention — mirrors plugin-sharing's `OWNER_FIELD` (single-owner MVP). */
const OWNER_FIELD = 'owner_id';

/**
 * [C2 / ADR-0095 D1] Which kernel tier a pipeline layer belongs to: the
 * always-first tenant wall (`layer_0_tenant`) vs. everything downstream of it
 * (business RLS / sharing / ownership / the capability gates), all
 * `layer_1_business`. The binary mirrors the enforcement split — Layer 0 has its
 * own code path and is AND-composed BEFORE any business rule.
 */
function kernelTierOf(layer: ExplainLayer['layer']): 'layer_0_tenant' | 'layer_1_business' {
  return layer === 'tenant_isolation' ? 'layer_0_tenant' : 'layer_1_business';
}

const AUTHZ_POSTURES: ReadonlySet<string> = new Set<AuthzPosture>([
  'PLATFORM_ADMIN',
  'TENANT_ADMIN',
  'MEMBER',
  'EXTERNAL',
]);
function isAuthzPosture(v: unknown): v is AuthzPosture {
  return typeof v === 'string' && AUTHZ_POSTURES.has(v);
}

/**
 * [C2 / ADR-0095 D2/D3] Resolve the principal's posture rung, using the SAME
 * evidence enforcement uses so the explain panel's tier can never sit HIGHER
 * than the runtime's (label-drift elimination — security review low-severity).
 *
 * Order of preference:
 *
 *  1. **guest / anonymous → EXTERNAL.** Explain layers one thing on top the
 *     enforcement resolver deliberately does NOT: a guest principal is EXTERNAL
 *     for the debugger. The enforcement floor is MEMBER (no external principal
 *     type exists yet — ADR-0095 D2), so this mapping lives here, and it wins
 *     first.
 *  2. **Reuse `ctx.posture` verbatim when present.** A principal resolved through
 *     the full `resolveAuthzContext` already carries the enforcement-derived
 *     rung; consuming it directly makes drift structurally impossible.
 *  3. **Fallback — re-derive from capability-grant evidence.** Reached only by a
 *     HAND-BUILT context (tests, an internal caller assembling `{ userId,
 *     positions, permissions }` itself). Since #6352 the explain API's
 *     `buildContextForUser` resolves through `resolveUserAuthzGrants` and
 *     therefore carries the enforcement-derived `posture`, so it lands on (2) —
 *     structurally, not by agreement. This branch derives from the SAME evidence
 *     `resolveAuthzContext` uses — NOT the previous loose permission-set-NAME
 *     match:
 *       - `PLATFORM_ADMIN` ← the **unscoped `admin_full_access` USER grant**
 *         (`hasPlatformAdminGrant`, which `buildContextForUser` now READS OFF the
 *         resolver's own verdict rather than recomputing), OR the
 *         `platform_admin` built-in position (which is itself only ever
 *         PROJECTED from that same grant — ADR-0068 D2). A merely-SCOPED
 *         `admin_full_access` grant (name present in `permissions`, not held
 *         unscoped) no longer over-labels.
 *       - `TENANT_ADMIN` ← the `organization_admin` **capability** grant, exactly
 *         like enforcement (ADR-0095 D3). The better-auth `org_owner`/`org_admin`
 *         role positions are a provisioning source only and are no longer read
 *         as posture evidence — closing the same #2836 dual-track explain-side.
 */
function derivePosture(context: any): AuthzPosture {
  if (!context?.userId || context?.principalKind === 'guest') return 'EXTERNAL';
  if (isAuthzPosture(context?.posture)) return context.posture;
  const positions: string[] = Array.isArray(context?.positions) ? context.positions : [];
  const permissions: string[] = Array.isArray(context?.permissions) ? context.permissions : [];
  return deriveAdminPosture({
    isPlatformAdmin:
      context?.hasPlatformAdminGrant === true || positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN),
    isTenantAdmin: ORGANIZATION_ADMIN_GRANTS.some((n) => permissions.includes(n)),
  });
}

/** True iff a composed filter is the zero-rows deny sentinel. */
function isDenyAll(filter: unknown): boolean {
  return !!filter && typeof filter === 'object' && (filter as any).id === '__deny_all__';
}

/** Explain-operation → engine-operation (the middleware's vocabulary). */
const EXPLAIN_TO_ENGINE_OP: Record<ExplainOperation, string> = {
  read: 'find',
  create: 'insert',
  update: 'update',
  delete: 'delete',
  transfer: 'transfer',
  restore: 'restore',
  purge: 'purge',
  // [#3544] Not a copy-paste slip: `export` IS its own evaluator operation
  // (`read ∧ the export grant`). It is also the only entry whose data path
  // differs from its gate — see {@link dataOpOf}.
  export: 'export',
};

/**
 * [#3544] The operation every DATA-shaped layer must be computed as.
 *
 * `export` is gated as its own operation but performs an ordinary `find` to
 * fetch its rows, so requiredPermissions, OWD/depth/sharing, RLS and record
 * attribution all have to resolve as a READ. Asking the RLS compiler about an
 * `export` operation would match no policy and report "no RLS applies" for a
 * principal whose rows are in fact filtered — an explanation that contradicts
 * the export it is explaining. Only `object_crud` uses the gate operation,
 * because that is the only layer the axis changes.
 */
function dataOpOf(operation: ExplainOperation, engineOp: string): string {
  return operation === 'export' ? 'find' : engineOp;
}

export interface ExplainEngineDeps {
  ql: any;
  /** The middleware's own set resolution (baseline + everyone semantics included). */
  resolveSets: (context: any) => Promise<PermissionSet[]>;
  evaluator: PermissionEvaluator;
  getObjectSecurityMeta: (object: string) => Promise<{
    isPrivate: boolean;
    requiredPermissions: any;
    fieldRequiredPermissions: Record<string, string[]>;
    /** [#3545] Posture could not be read — the middleware denies (fail-closed). */
    unresolved?: boolean;
  }>;
  /** The middleware's requiredPermissions AND-gate resolution for an operation. */
  requiredCaps: (meta: any, engineOperation: string) => string[];
  /** The middleware's RLS filter composition (same inputs, same output). */
  computeRlsFilter: (
    sets: PermissionSet[],
    object: string,
    engineOperation: string,
    context: any,
  ) => Promise<Record<string, unknown> | null | undefined>;
  /** The middleware's merged FLS mask (field requiredPermissions folded in). */
  getFieldMask: (
    sets: PermissionSet[],
    object: string,
    fieldRequiredPermissions: Record<string, string[]>,
  ) => Record<string, { readable?: boolean; editable?: boolean }>;
  /**
   * [#9127] The middleware's EFFECTIVE partial-mask set for this caller — the
   * `partialRules` argument enforcement hands `FieldMasker.maskResults`, after
   * the explicit-deny exclusion. Keyed by field, valued by the rule that will
   * be applied.
   *
   * REQUIRED, deliberately. The field-mask decision has three outcomes
   * (deleted / partially masked / served whole) and the binary
   * {@link getFieldMask} can express only two, so an engine wired without this
   * would report a partially-masked field as fully hidden and a gate-less
   * rule field as fully readable — the exact misreport this dep exists to
   * close. An optional dep would have let a new embedder re-open it silently;
   * a required one makes the omission a compile error.
   *
   * Supply the enforcement composition, never a re-derivation of it: explain's
   * module contract is that it "matches enforcement by construction".
   */
  getPartialMaskRules: (
    sets: PermissionSet[],
    object: string,
    delegatorSets: PermissionSet[] | null,
  ) => Promise<Record<string, FieldMaskingRule>>;
  /**
   * Configured additive baseline set NAMES (default `['member_default']`), for
   * attribution.
   *
   * [#7555] A list, not a name: the baseline is the app-declared set COMPOSED
   * with the platform's `member_default`, so a report that attributed only one
   * of them would label the other "resolved" — the vaguest bucket `viaOf` has,
   * on the grant most likely to be the answer to "why can this member read
   * anything at all".
   */
  baselinePermissionSets: string[];

  // ── [C2 / ADR-0095] Record-grained deps. All OPTIONAL: absent → the engine
  // stays object-level and byte-compatible. Present → the sharing / rls / owd /
  // tenant_isolation layers gain per-record attribution. Every one reuses an
  // enforcement code path so the row story cannot drift from execution. ──

  /**
   * The middleware's RLS composition, SPLIT into its two independent kernel
   * layers (the same `Layer0(tenant) AND Layer1(business)` the effective filter
   * is built from). Lets the tenant wall (Layer 0) and business RLS (Layer 1) be
   * attributed to a record separately. `undefined` return = engine cannot split.
   */
  computeLayeredRlsFilter?: (
    sets: PermissionSet[],
    object: string,
    engineOperation: string,
    context: any,
  ) => Promise<{ layer0: Record<string, unknown> | null; layer1: Record<string, unknown> | null }>;
  /** Fetch the one record under a system context (organization_id / owner_id + fields for filter matching). */
  fetchRecord?: (object: string, recordId: string, engineOperation: string) => Promise<Record<string, unknown> | null>;
  /** The sharing service's own read-filter contribution for the object (owner-match OR granted-ids), same as enforcement AND-s in. */
  sharingReadFilter?: (object: string, context: any) => Promise<unknown | null>;
  /**
   * The concrete `sys_record_share` rows attached to the record (for `rules[]`
   * attribution).
   *
   * `access_level` stays wider than the authorable `read`/`edit`: explain
   * REPORTS stored rows, and a `full` row written before #3865 retired that
   * level (normalised to `edit` by the sharing plugin's boot backfill) must
   * still be explainable rather than crash the panel.
   */
  listRecordShares?: (
    object: string,
    recordId: string,
    context: any,
  ) => Promise<Array<{ id?: string; recipient_type?: string; recipient_id?: string; access_level?: 'read' | 'edit' | 'full'; source?: string; source_id?: string }>>;
  /** The sharing service's per-record UPDATE gate (`canEdit`) — the by-construction verdict for update operations. */
  canEditRecord?: (object: string, recordId: string, context: any) => Promise<boolean>;
  /**
   * [ADR-0111 D3] The sharing service's per-record DELETE gate (`canDelete`) —
   * the by-construction verdict for a delete operation. Narrower than
   * `canEditRecord`: an edit-level share opens update but not delete, so the
   * explanation for a `delete` must consult this rather than the update gate.
   */
  canDeleteRecord?: (object: string, recordId: string, context: any) => Promise<boolean>;
}

export interface ExplainInput {
  object: string;
  operation: ExplainOperation;
  /** Execution context of the principal being EXPLAINED (not the caller). */
  context: any;
  /**
   * [C2 / ADR-0095] Optional id of ONE concrete record to explain at row
   * granularity. Omitted → object-level (the report is byte-identical to the
   * pre-C2 engine). Present → the row-scoped layers gain a `record` attribution,
   * the tenant wall surfaces as the `tenant_isolation` Layer 0, every layer is
   * tagged with its `kernelTier`, the principal's `posture` is resolved, and the
   * decision carries a top-level `record` verdict.
   */
  recordId?: string;
}

/** The ADR-0091 `valid_until` of a grant row, as the panel prints it. */
function untilOfGrantRow(r: any): string | undefined {
  const v = r?.valid_until ?? r?.validUntil;
  return v == null || v === '' ? undefined : String(v);
}

/**
 * [#6352 / ADR-0091 D2/D3] The explain-ONLY provenance pass: the two annotations
 * the panel prints that the authorization resolver, correctly, throws away.
 *
 * This is presentation, not aggregation. It decides nothing about who is
 * authorized — `resolveUserAuthzGrants` has already decided that, and this pass
 * never feeds `positions` / `permissions` / the `platform_admin` derivation. It
 * only re-reads the same rows to answer two questions the resolver's output
 * cannot express, because the resolver's output is by construction the set of
 * grants that DID resolve:
 *
 *  - **expired** — a row whose `valid_until` has passed, so the panel can say
 *    "held until … — expired" instead of silently omitting a grant the admin
 *    knows they granted. This is "why did access DISAPPEAR", and only a dropped
 *    row can answer it.
 *  - **delegated** — the `delegated_from` provenance of a row that DID resolve,
 *    so a position can be attributed "via delegation from X, until Y".
 *
 * Both verdicts come from the SAME shared ADR-0091 predicate module the resolver
 * uses (`isGrantActive` / `isGrantExpired`, `@objectstack/core`) — one
 * implementation of the window rule, consulted twice, never re-derived here.
 */
async function collectGrantProvenance(
  ql: any,
  userId: string,
  nowMs: number,
): Promise<{
  expiredGrants: Array<{ kind: 'position' | 'permission_set'; name: string; until?: string }>;
  delegatedPositions: Array<{ name: string; from: string; until?: string }>;
}> {
  const expiredGrants: Array<{ kind: 'position' | 'permission_set'; name: string; until?: string }> = [];
  const delegatedPositions: Array<{ name: string; from: string; until?: string }> = [];

  try {
    const rows = await ql.find('sys_user_position', { where: { user_id: userId }, limit: 500, context: SYSTEM_CTX });
    for (const r of Array.isArray(rows) ? rows : []) {
      const p = String((r as any)?.position ?? '');
      if (!p) continue;
      if (isGrantActive(r, nowMs)) {
        const from = (r as any)?.delegated_from;
        if (from != null && from !== '') {
          delegatedPositions.push({ name: p, from: String(from), until: untilOfGrantRow(r) });
        }
      } else if (isGrantExpired(r, nowMs)) {
        // Pending (future `valid_from`) rows are inactive but NOT expired — they
        // are not reported, because nothing was lost yet.
        expiredGrants.push({ kind: 'position', name: p, until: untilOfGrantRow(r) });
      }
    }
  } catch { /* table unavailable → no provenance to report */ }

  try {
    const rows = await ql.find('sys_user_permission_set', { where: { user_id: userId }, limit: 500, context: SYSTEM_CTX });
    const expiredRows = (Array.isArray(rows) ? rows : []).filter(
      (g: any) => !isGrantActive(g, nowMs) && isGrantExpired(g, nowMs),
    );
    const ids = expiredRows
      .map((g: any) => g?.permission_set_id ?? g?.permissionSetId)
      .filter(Boolean);
    if (ids.length > 0) {
      const sets = await ql.find('sys_permission_set', { where: { id: { $in: ids } }, limit: ids.length, context: SYSTEM_CTX });
      const nameById = new Map<string, string>();
      for (const s of Array.isArray(sets) ? sets : []) {
        if ((s as any)?.id && (s as any)?.name) nameById.set(String((s as any).id), String((s as any).name));
      }
      for (const g of expiredRows) {
        const n = nameById.get(String((g as any)?.permission_set_id ?? (g as any)?.permissionSetId ?? ''));
        if (n) expiredGrants.push({ kind: 'permission_set', name: n, until: untilOfGrantRow(g) });
      }
    }
  } catch { /* table unavailable → no provenance to report */ }

  return { expiredGrants, delegatedPositions };
}

/**
 * Reconstruct an evaluation context for an arbitrary user, for the explain API's
 * `userId` parameter. The caller-facing authorization for explaining OTHERS
 * lives in the route/service wrapper (`explainAccessForCaller`), not here.
 *
 * [#6352] **The authorization aggregation is not implemented here.** It is
 * `@objectstack/core`'s `resolveUserAuthzGrants` — the userId-driven core of
 * `resolveAuthzContext`, i.e. the exact function every inbound request resolves
 * through, called with the exact arguments (`ql`, `userId`, the ADR-0091 clock).
 * So the positions (`sys_member` role projection + `sys_user_position` + the
 * ADR-0090 D5 `everyone` anchor), the permission-set names (user-bound AND
 * position-bound), the ADR-0091 validity windows, the ADR-0068 D2 `platform_admin`
 * derivation, the ADR-0095 posture rung and the ADR-0105 D2 `accessible_org_ids`
 * are all ONE implementation, not two kept in step by comment.
 *
 * This used to be a hand-written mirror whose only guarantee was two comments
 * saying it matched. It did not: measured over identical rows it dropped the
 * `sys_member` role positions, every position-bound permission set
 * (`sys_position_permission_set`), the `ai_seat` synthesis, `systemPermissions`
 * and the posture rung — so a user whose grants arrive through a POSITION was
 * explained as holding nothing, and the panel reported a deny that enforcement
 * did not make. That is the failure mode the panel exists to prevent, so the
 * mirror is gone rather than pinned.
 *
 * What stays explain-side is presentation only, and additive: the expired /
 * delegated row annotations ({@link collectGrantProvenance}), and
 * `hasPlatformAdminGrant`, which is now READ OFF the resolver's own posture
 * verdict instead of being recomputed from the grant rows.
 */
export async function buildContextForUser(ql: any, userId: string, nowMs: number = Date.now()): Promise<any> {
  const grants = await resolveUserAuthzGrants(ql, userId, { nowMs });
  const { expiredGrants, delegatedPositions } = await collectGrantProvenance(ql, userId, nowMs);
  return {
    userId,
    positions: grants.positions,
    permissions: grants.permissions,
    systemPermissions: grants.systemPermissions,
    org_user_ids: grants.org_user_ids,
    accessible_org_ids: grants.accessible_org_ids,
    ...(grants.tabPermissions ? { tabPermissions: grants.tabPermissions } : {}),
    ...(grants.email != null ? { email: grants.email } : {}),
    ...(grants.posture ? { posture: grants.posture } : {}),
    expiredGrants,
    delegatedPositions,
    // [ADR-0068 D2] Not a second derivation: `derivePosture` returns
    // PLATFORM_ADMIN if and only if the resolver saw the unscoped
    // `admin_full_access` USER grant, so this reads that one verdict back.
    hasPlatformAdminGrant: grants.posture === 'PLATFORM_ADMIN',
  };
}

/**
 * [ADR-0090 D10] Result of resolving the delegator behind an on-behalf-of
 * principal. `none` = no delegation link; `missing` = the link names a user that
 * does not exist (the caller must fail CLOSED — see {@link resolveDelegatorContext});
 * `resolved` = the delegator's reconstructed evaluation context.
 */
export type DelegatorResolution =
  | { kind: 'none' }
  | { kind: 'missing'; userId: string }
  | { kind: 'resolved'; context: any };

/**
 * [ADR-0090 D10 — agent intersection] Resolve the evaluation context of the USER
 * behind an agent/service principal that acts `onBehalfOf` them. The effective
 * permission of the delegated principal is the INTERSECTION of its own grants
 * and this delegator's grants (confused-deputy prevention) — never the union —
 * so every enforcement layer combines the two set-lists with AND.
 *
 * Semantics this helper pins down (single-sourced for the middleware AND the
 * explain engine so enforcement and its explanation can never drift):
 *
 *  - **Fail-closed on a dangling link (edge b).** A `missing` delegator must be
 *    reported as such by the caller and denied — NOT resolved to empty sets:
 *    `resolvePermissionSetsForContext` synthesises the additive `member_default`
 *    baseline for ANY `userId`, so a deleted delegator would otherwise still
 *    intersect against baseline-level access. The `sys_user` existence check is
 *    the only correct fail-closed point.
 *  - **Tenant-scoped bags are inherited from the live principal, and the
 *    inheritance still WINS.** The agent and its delegator are, by construction,
 *    in the same org, so `tenantId` / `org_user_ids` carry over — delegator-side
 *    RLS that substitutes them then compiles faithfully instead of collapsing to
 *    the deny sentinel. Since #6352, `buildContextForUser` returns the resolver's
 *    own `org_user_ids`, which without a known `tenantId` is the degenerate
 *    `[delegatorId]` seed — the live principal's real org peer set is the better
 *    answer, so the assignment below overwrites it exactly as before.
 *    `accessible_org_ids` (ADR-0105 D2) is the exception: it is resolved from
 *    the DELEGATOR's own memberships by `buildContextForUser`, never inherited,
 *    because inheriting it would widen a delegated read past the organizations
 *    the delegator actually belongs to.
 *  - **Person-specific membership bags (`rlsMembership`) are left unresolved.**
 *    Absent → the RLS compiler's fail-closed substitution NARROWS the
 *    delegator's row set, never widens it — safe by construction. #6352 routed
 *    the delegator through the shared resolver (`resolveUserAuthzGrants`), which
 *    closed the positions / permission-set / posture half of this gap; the
 *    team/territory bags are not part of that envelope on either side, so they
 *    remain a follow-up for the `RlsMembershipResolver` contract rather than for
 *    this function.
 *  - **One hop only (edge a).** The `onBehalfOf` shape carries a single delegator
 *    id with no nested link, so a transitive agent→service→user chain is not
 *    representable in one context. Intersecting against the immediate delegator
 *    is a safe lower bound on the true multi-hop intersection (each hop only
 *    narrows), so this never escalates; true chain-walk is a producer-side
 *    follow-up that collapses the chain to the ultimate human delegator.
 *  - **Trigger is the LINK, not the label (edge d).** A `service` acting for a
 *    user is the identical confused-deputy risk as an `agent`; both intersect.
 *    `principalKind` stays advisory. `human`/`system`/`guest` never carry
 *    `onBehalfOf` in practice, so they are unaffected.
 */
export async function resolveDelegatorContext(
  ql: any,
  context: any,
  nowMs: number = Date.now(),
): Promise<DelegatorResolution> {
  const oboId = context?.onBehalfOf?.userId;
  if (!oboId) return { kind: 'none' };
  let user: any = null;
  try {
    user = await ql.findOne('sys_user', { where: { id: oboId }, context: SYSTEM_CTX });
  } catch {
    user = null;
  }
  if (!user) return { kind: 'missing', userId: String(oboId) };
  const dctx = await buildContextForUser(ql, oboId, nowMs);
  // Inherit tenant-scoped substitution bags from the live principal (same org).
  if (context?.tenantId != null) dctx.tenantId = context.tenantId;
  if (context?.org_user_ids != null) dctx.org_user_ids = context.org_user_ids;
  // [ADR-0105 D2] The delegator's own org access set is NOT inherited — it is
  // the delegator's membership that bounds a delegated read, and
  // `buildContextForUser` resolves it for them. Inheriting the live principal's
  // set would widen the delegator past their own memberships.
  if (user.email != null && user.email !== '') dctx.email = user.email;
  return { kind: 'resolved', context: dctx };
}

const SCOPE_ORDER = ['own', 'own_and_reports', 'unit', 'unit_and_below', 'org'] as const;

/**
 * [ADR-0090 D10] The NARROWER of two access-depth scopes (min rank). Unknown
 * values clamp to the narrowest (`own`, fail-closed). Used to intersect the
 * agent's and the delegator's effective read/write depth so the stash that
 * flows to plugin-sharing carries the tighter of the two.
 */
export function narrowerScope(a: string, b: string): string {
  const rank = (s: string): number => {
    const i = SCOPE_ORDER.indexOf(s as (typeof SCOPE_ORDER)[number]);
    return i < 0 ? 0 : i;
  };
  return rank(a) <= rank(b) ? a : b;
}

/**
 * [ADR-0090 D10] Intersect two FLS masks. A field is readable/editable in the
 * result only if it is readable/editable on BOTH sides. A field ABSENT from a
 * side is unconstrained on that side (the FieldMasker leaves unlisted fields
 * fully visible/editable), so an absent side contributes `true` — the AND then
 * lets the OTHER side's constraint win. Net effect: the intersection hides or
 * write-locks every field that EITHER principal hides or write-locks.
 */
export function intersectFieldMasks(
  a: Record<string, { readable?: boolean; editable?: boolean }>,
  b: Record<string, { readable?: boolean; editable?: boolean }>,
): Record<string, { readable: boolean; editable: boolean }> {
  const out: Record<string, { readable: boolean; editable: boolean }> = {};
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const ar = k in a ? a[k]?.readable !== false : true;
    const ae = k in a ? a[k]?.editable !== false : true;
    const br = k in b ? b[k]?.readable !== false : true;
    const be = k in b ? b[k]?.editable !== false : true;
    out[k] = { readable: ar && br, editable: ae && be };
  }
  return out;
}

/**
 * [#9127] Render a `maskingRule` for the report. PRESENTATION ONLY — it never
 * decides whether the rule applies (that is enforcement's call, arriving via
 * `deps.getPartialMaskRules`); it only names the rule the caller's masked
 * value was produced by, so an admin reading "why is this `138****5678`" gets
 * the preset or the explicit span instead of a bare field name.
 */
function describeMaskingRule(rule: FieldMaskingRule): string {
  return typeof rule === 'string' ? rule : `keepHead ${rule.keepHead}, keepTail ${rule.keepTail}`;
}

/** D1-equivalent OWD reading (mirrors plugin-sharing's effectiveSharingModel). */
function describeOwd(schema: any): { model: string; declared: boolean; effect: 'private' | 'read' | 'public' } {
  const m = schema?.sharingModel ?? schema?.security?.sharingModel;
  if (m === 'private') return { model: 'private', declared: true, effect: 'private' };
  if (m === 'public_read') return { model: 'public_read', declared: true, effect: 'read' };
  if (m === 'public_read_write' || m === 'controlled_by_parent') {
    return { model: String(m), declared: true, effect: 'public' };
  }
  if (m == null) {
    const isSystem = schema?.isSystem === true || String(schema?.name ?? '').startsWith('sys_');
    return isSystem
      ? { model: '(unset, system default: public)', declared: false, effect: 'public' }
      : { model: "(unset → 'private', ADR-0090 D1 fail-closed default)", declared: false, effect: 'private' };
  }
  return { model: `${String(m)} (unknown → private, fail-closed)`, declared: true, effect: 'private' };
}

/**
 * [C2 / ADR-0095] Inputs the record-grained augmentation needs from the already
 * computed object-level pass — the row story is decomposed FROM the same facts,
 * never re-judged.
 */
interface RecordAttributionContext {
  deps: ExplainEngineDeps;
  object: string;
  recordId: string;
  engineOp: string;
  context: any;
  sets: PermissionSet[];
  layers: ExplainLayer[];
  owd: { model: string; effect: 'private' | 'read' | 'public' };
  capsDeny: boolean;
  crudAllowed: boolean;
  /**
   * [#4647] Whether the object-level pass found the View/Modify All Data bypass
   * EFFECTIVE for this operation (already D10-intersected, already
   * operation-scoped to the right bit). The row story consumes the verdict the
   * `vama_bypass` layer published — it never re-derives it — so the layer, the
   * record attribution and the write gate stay one answer.
   */
  vamaEffective: boolean;
  /** [#4647] The sets that carry the bypass, for the row-level detail text. */
  vamaSets: string[];
}

/**
 * [C2 / ADR-0095] Fill the per-record row story onto the pipeline. Prepends the
 * `tenant_isolation` Layer 0, tags every layer with its `kernelTier`, attaches a
 * `record` attribution to the four row-scoped layers (tenant / owd / sharing /
 * rls), and returns the top-level `record` verdict. Every row-level judgement is
 * evaluated with the SAME artifacts enforcement produces:
 *   - Layer 0 / Layer 1 filters come from `computeLayeredRlsFilter` (the middleware's
 *     own `Layer0(tenant) AND Layer1(business)` split);
 *   - "does THIS record satisfy the filter?" is `matchesFilterCondition` — the
 *     third canonical backend for the same FilterCondition shape the query runs;
 *   - the write verdict is the sharing service's own `canEdit`.
 * So the record story is explained by construction, exactly like the object-level pass.
 */
async function applyRecordAttribution(
  ra: RecordAttributionContext,
): Promise<{ record: NonNullable<ExplainDecision['record']>; posture: AuthzPosture }> {
  const { deps, object, recordId, engineOp, context, sets, layers, owd, capsDeny, crudAllowed, vamaEffective, vamaSets } = ra;
  const isRead = engineOp === 'find';
  const posture = derivePosture(context);

  const record = deps.fetchRecord
    ? await deps.fetchRecord(object, recordId, engineOp).catch(() => null)
    : null;
  const recordExists = record != null;
  const matches = (filter: unknown): boolean | undefined => {
    if (!recordExists) return undefined;
    if (filter == null) return true;
    return matchesFilterCondition(record as Record<string, unknown>, filter as any);
  };

  const layered = deps.computeLayeredRlsFilter
    ? await deps.computeLayeredRlsFilter(sets, object, engineOp, context).catch(() => ({ layer0: null, layer1: null }))
    : undefined;
  const layer0 = layered?.layer0;
  const layer1 = layered?.layer1;

  // ── Layer 0: tenant_isolation (prepended as the always-first layer) ──────
  let tenantRecord: ExplainRecordAttribution;
  if (!recordExists) {
    tenantRecord = { outcome: 'not_evaluated', rules: [], detail: 'Record not found under a system read — filtered, deleted, or never existed.' };
  } else if (layered === undefined) {
    tenantRecord = { outcome: 'not_evaluated', rules: [], detail: 'Tenant layer split is unavailable on this engine build.' };
  } else if (layer0 == null) {
    tenantRecord = {
      outcome: 'not_evaluated', rowFilter: null, rules: [],
      detail: 'Layer 0 contributes nothing here — single-tenant mode, a non-tenant object, or a platform-admin crossing the wall (ADR-0095 D1).',
    };
  } else {
    const deny = isDenyAll(layer0);
    const m = matches(layer0);
    const excluded = deny || m === false;
    tenantRecord = {
      outcome: excluded ? 'excluded' : 'admitted',
      rowFilter: layer0,
      matchesRecord: deny ? false : m,
      rules: [{
        kind: 'tenant_filter',
        name: 'organization_isolation',
        predicate: layer0,
        via: context?.tenantId ? `organization ${context.tenantId}` : 'organization wall',
        effect: excluded ? 'excludes' : 'admits',
      }],
      detail: deny
        ? 'No active organization on the context — the tenant wall denies all rows (fail closed).'
        : excluded
          ? `Record's organization does not match the caller's active organization (${context?.tenantId ?? 'none'}).`
          : `Record is inside the caller's active organization (${context?.tenantId ?? 'none'}).`,
    };
  }
  layers.unshift({
    layer: 'tenant_isolation',
    kernelTier: 'layer_0_tenant',
    verdict: tenantRecord.outcome === 'excluded' ? 'denies' : layer0 ? 'narrows' : 'not_applicable',
    detail: 'Layer 0 tenant isolation — the always-first org wall, AND-composed before any business RLS (ADR-0095 D1).',
    contributors: [],
    record: tenantRecord,
  });

  // ── owd_baseline: ownership + the record baseline's own contribution ─────
  const ownerRaw = recordExists ? (record as Record<string, unknown>)[OWNER_FIELD] : undefined;
  const hasOwnerField = recordExists && OWNER_FIELD in (record as Record<string, unknown>);
  const ownerIsMe = ownerRaw != null && context?.userId != null && String(ownerRaw) === String(context.userId);
  const owdLayer = layers.find((l) => l.layer === 'owd_baseline');
  if (owdLayer) {
    const owdRules: ExplainMatchedRule[] = [{
      kind: 'owd_baseline',
      name: owd.model,
      effect: owd.effect === 'private' ? (ownerIsMe ? 'admits' : 'excludes') : 'admits',
      via: `OWD ${owd.model}`,
    }];
    if (hasOwnerField) {
      owdRules.push({
        kind: 'ownership',
        name: OWNER_FIELD,
        via: ownerIsMe ? 'owner' : `owned by ${ownerRaw ?? 'nobody'}`,
        effect: ownerIsMe ? 'admits' : 'neutral',
      });
    }
    owdLayer.record = !recordExists
      ? { outcome: 'not_evaluated', rules: [], detail: 'Record not found; baseline not evaluated.' }
      : {
          outcome: owd.effect === 'private' ? (ownerIsMe ? 'admitted' : 'excluded') : 'admitted',
          matchesRecord: owd.effect === 'private' ? ownerIsMe : true,
          rules: owdRules,
          detail: owd.effect === 'private'
            ? (ownerIsMe
                ? 'Caller owns the record — the private baseline admits it.'
                : 'Private baseline admits only the owner; a share or sharing rule may still widen access (see the sharing layer).')
            : `Baseline ${owd.model} admits the record at the row level; capability and field layers still apply.`,
        };
  }

  // ── sharing: the concrete shares + the sharing service's filter/gate ─────
  const shares = deps.listRecordShares && recordExists
    ? await deps.listRecordShares(object, recordId, context).catch(() => [])
    : [];
  const shareRules: ExplainMatchedRule[] = (shares ?? []).map((s) => {
    const recipMatchesUser = s.recipient_type === 'user' && s.recipient_id != null && String(s.recipient_id) === String(context?.userId);
    const kind: ExplainMatchedRule['kind'] =
      s.source === 'rule' ? 'sharing_rule' : s.source === 'team' ? 'team' : 'record_share';
    return {
      kind,
      name: String(s.source_id || s.id || 'share'),
      grants: s.access_level,
      via: `${s.recipient_type ?? 'user'}:${s.recipient_id ?? '?'}`,
      // A group/role/unit recipient can't be confirmed against the principal
      // without expansion → reported `neutral` (evaluated, effect unknown here).
      effect: recipMatchesUser ? 'admits' : 'neutral',
    };
  });
  const sharingFilter = deps.sharingReadFilter && recordExists
    ? await deps.sharingReadFilter(object, context).catch(() => null)
    : undefined;
  const sharingMatches = sharingFilter === undefined ? undefined : matches(sharingFilter);
  // Write ops: the by-construction verdict is the sharing service's own gate.
  // [ADR-0111 D3] delete has its own narrower gate (an edit share does not
  // confer delete), so a `delete` explanation consults canDelete, not canEdit.
  const writeGate = engineOp === 'delete' ? deps.canDeleteRecord : deps.canEditRecord;
  const canEdit = !isRead && writeGate && recordExists
    ? await writeGate(object, recordId, context).catch(() => undefined)
    : undefined;
  const anyShareAdmits = shareRules.some((r) => r.effect === 'admits');
  let sharingOutcome: ExplainRecordAttribution['outcome'];
  if (!recordExists) {
    sharingOutcome = 'not_evaluated';
  } else if (owd.effect !== 'private') {
    sharingOutcome = 'not_evaluated'; // baseline already grants the rows sharing would add
  } else if (canEdit !== undefined) {
    sharingOutcome = canEdit ? 'admitted' : 'excluded';
  } else if (ownerIsMe || anyShareAdmits || sharingMatches === true) {
    sharingOutcome = 'admitted';
  } else if (sharingFilter === undefined && shares.length === 0) {
    sharingOutcome = 'not_evaluated';
  } else {
    sharingOutcome = 'excluded';
  }
  const sharingLayer = layers.find((l) => l.layer === 'sharing');
  if (sharingLayer) {
    sharingLayer.record = {
      outcome: sharingOutcome,
      rowFilter: sharingFilter === undefined ? undefined : sharingFilter,
      matchesRecord: sharingMatches,
      rules: shareRules,
      detail: !recordExists
        ? 'Record not found; sharing not evaluated.'
        : owd.effect !== 'private'
          ? 'Baseline is not private — sharing adds nothing beyond it for this record.'
          : canEdit !== undefined
            ? (canEdit
                // [#4647] Name the REAL reason the gate admitted the row. The
                // write gate consults the Modify All Data bypass after
                // ownership and shares, so "the sharing service grants write"
                // would be a false attribution for a bypass holder — precisely
                // the mis-reporting this issue was filed on, inverted.
                ? (!ownerIsMe && !anyShareAdmits && vamaEffective
                    ? `The write gate admits this record via the Modify All Data bypass [${vamaSets.join(', ')}], ` +
                      'not ownership or a share (see the vama_bypass layer).'
                    : 'The sharing service grants write on this record (ownership or an edit/full share).')
                : 'No ownership and no edit/full share grants write on this record.')
            : sharingOutcome === 'admitted'
              ? (ownerIsMe ? 'Caller owns the record — visible without a share.' : `${shareRules.length} share(s) attached; access is granted for this record.`)
              : `${shareRules.length} share(s) attached; none grants the caller access to this record.` +
                (vamaEffective
                  ? ` Superseded by the View/Modify All Data bypass [${vamaSets.join(', ')}] — see the vama_bypass layer.`
                  : ''),
    };
  }

  // ── vama_bypass: what the bypass did to THIS row ─────────────────────────
  // [#4647] The layer that claims "ownership and sharing checks are skipped"
  // now says so at row granularity too, and says it from the same verdict the
  // write gate consults.
  const vamaLayer = layers.find((l) => l.layer === 'vama_bypass');
  if (vamaLayer) {
    vamaLayer.record = !recordExists
      ? { outcome: 'not_evaluated', rules: [], detail: 'Record not found; the bypass was not evaluated.' }
      : vamaEffective
        ? {
            outcome: 'admitted',
            rowFilter: null,
            rules: [],
            detail: `View/Modify All Data via [${vamaSets.join(', ')}] admits this record regardless of ownership — ` +
              'the same bypass the write path consults (#4647).',
          }
        : { outcome: 'not_evaluated', rules: [], detail: 'No View/Modify All Data bypass applies to this record.' };
  }

  // ── rls: the business (Layer 1) predicate for this record ────────────────
  const rlsLayer = layers.find((l) => l.layer === 'rls');
  if (rlsLayer) {
    if (!recordExists) {
      rlsLayer.record = { outcome: 'not_evaluated', rules: [], detail: 'Record not found; business RLS not evaluated.' };
    } else if (layered === undefined) {
      rlsLayer.record = { outcome: 'not_evaluated', rules: [], detail: 'Business RLS split is unavailable on this engine build.' };
    } else if (layer1 == null) {
      rlsLayer.record = { outcome: 'not_evaluated', rowFilter: null, rules: [], detail: 'No business RLS policy applies to this record.' };
    } else {
      const deny = isDenyAll(layer1);
      const m = matches(layer1);
      const excluded = deny || m === false;
      rlsLayer.record = {
        outcome: excluded ? 'excluded' : 'admitted',
        rowFilter: layer1,
        matchesRecord: deny ? false : m,
        rules: [{ kind: 'rls_policy', name: 'business_rls', predicate: layer1, effect: excluded ? 'excludes' : 'admits' }],
        detail: deny
          ? 'Business RLS composes to DENY ALL for this principal.'
          : excluded
            ? 'The record does not satisfy the business row-level predicate.'
            : 'The record satisfies the business row-level predicate.',
      };
    }
  }

  // ── kernelTier on every layer + posture resolution ───────────────────────
  for (const l of layers) {
    if (!l.kernelTier) l.kernelTier = kernelTierOf(l.layer);
  }

  // ── decision.record: bottom line + decisive layer ────────────────────────
  const tenantExcluded = tenantRecord.outcome === 'excluded';
  const rlsExcluded = rlsLayer?.record?.outcome === 'excluded';
  // [#4647] The bypass admits any row of this object for this principal — the
  // row-level meaning of the `vama_bypass` layer's own claim. On the WRITE
  // branch the gate (`canEdit`/`canDelete`) is still the authority when it is
  // available, because the gate is what the request will actually hit and it
  // now consults this same bypass; the disjunction below only carries the
  // bypass where no gate answered (a deployment without plugin-sharing) and on
  // the read branch, whose row filter the bypass short-circuits identically.
  const vamaAdmitsRow = vamaEffective && recordExists;
  const businessRowAdmits = isRead
    ? owd.effect !== 'private' || ownerIsMe || sharingOutcome === 'admitted' || vamaAdmitsRow
    : canEdit !== undefined
      ? canEdit
      : owd.effect === 'public' || ownerIsMe || sharingOutcome === 'admitted' || vamaAdmitsRow;

  // [#4647] Was the bypass DECISIVE? Only where the baseline and the concrete
  // shares would otherwise have excluded the row — an owner or a shared-to
  // principal is admitted with or without it, and reporting `vama_bypass` there
  // would over-credit the grant.
  const baselineAdmitsRow = isRead ? owd.effect !== 'private' : owd.effect === 'public';
  const bypassWasDecisive = vamaAdmitsRow && !baselineAdmitsRow && !ownerIsMe && !anyShareAdmits;

  let visible: boolean;
  let decidedBy: NonNullable<ExplainDecision['record']>['decidedBy'];
  if (capsDeny) { visible = false; decidedBy = 'required_permissions'; }
  else if (!crudAllowed) { visible = false; decidedBy = 'object_crud'; }
  else if (!recordExists) { visible = false; decidedBy = undefined; }
  else if (tenantExcluded) { visible = false; decidedBy = 'tenant_isolation'; }
  else if (rlsExcluded) { visible = false; decidedBy = 'rls'; }
  else if (!businessRowAdmits) { visible = false; decidedBy = owd.effect === 'private' ? 'sharing' : 'owd_baseline'; }
  else {
    visible = true;
    decidedBy = bypassWasDecisive
      ? 'vama_bypass'
      : (owd.effect === 'private' && !ownerIsMe && sharingOutcome === 'admitted')
        ? 'sharing'
        : layer1 != null
          ? 'rls'
          : owd.effect === 'private' && ownerIsMe
            ? 'owd_baseline'
            : layer0 != null
              ? 'tenant_isolation'
              : 'object_crud';
  }

  return {
    record: { recordId, visible, ...(decidedBy ? { decidedBy } : {}) },
    posture,
  };
}

export async function explainAccess(deps: ExplainEngineDeps, input: ExplainInput): Promise<ExplainDecision> {
  const { object, operation, context } = input;
  const engineOp = EXPLAIN_TO_ENGINE_OP[operation];
  // [#3544] The gate operation (`engineOp`) and the data operation may differ —
  // today only for `export`, which is gated as itself but reads as a `find`.
  const dataOp = dataOpOf(operation, engineOp);
  const layers: ExplainLayer[] = [];

  // ── 1. principal ──────────────────────────────────────────────────────
  const sets = await deps.resolveSets(context).catch(() => [] as PermissionSet[]);
  const setNames = sets.map((s: any) => String(s.name ?? '?'));
  // [ADR-0090 D10] Agent/service intersection. When the principal acts on
  // behalf of a user, every layer below reports the INTERSECTION verdict —
  // the narrower of the agent's own grants and the delegator's. `delegatorSets`
  // stays null on the ordinary path, so each fold is a no-op and the report is
  // byte-identical to a non-delegated principal.
  let delegatorSets: PermissionSet[] | null = null;
  let delegatorContextForRls: any = null;
  let delegatorMissing = false;
  let delegatorNames: string[] = [];
  if (context?.onBehalfOf?.userId) {
    const del = await resolveDelegatorContext(deps.ql, context).catch(
      () => ({ kind: 'none' }) as DelegatorResolution,
    );
    if (del.kind === 'missing') {
      delegatorMissing = true;
    } else if (del.kind === 'resolved') {
      delegatorContextForRls = del.context;
      delegatorSets = await deps.resolveSets(del.context).catch(() => [] as PermissionSet[]);
      delegatorNames = delegatorSets.map((s: any) => String(s.name ?? '?'));
    }
  }
  const positions: string[] = context?.positions ?? [];
  const viaOf = (name: string): string => {
    if (deps.baselinePermissionSets.includes(name)) return 'additive baseline (ADR-0090 D5)';
    if (positions.includes(name)) return `position:${name}`;
    if ((context?.permissions ?? []).includes(name)) return 'direct grant';
    return 'resolved';
  };
  // [ADR-0091 D2] Expired-but-present grant rows (populated by
  // buildContextForUser when explaining by userId). They contributed nothing —
  // reported so "why did access disappear" is self-answering.
  const expiredGrants: Array<{ kind: 'position' | 'permission_set'; name: string; until?: string }> =
    Array.isArray(context?.expiredGrants) ? context.expiredGrants : [];
  // [ADR-0091 D3] Positions held via delegation — attributed "via delegation
  // from X, until Y" so a delegated hat is visible in the report.
  const delegatedPositions: Array<{ name: string; from: string; until?: string }> =
    Array.isArray(context?.delegatedPositions) ? context.delegatedPositions : [];
  const delegationOf = (name: string): { from: string; until?: string } | undefined =>
    delegatedPositions.find((d) => d.name === name);
  layers.push({
    layer: 'principal',
    verdict: delegatorMissing ? 'denies' : 'neutral',
    detail:
      `Principal ${context?.userId ?? '(anonymous)'} holds position(s) [${positions.join(', ') || 'none'}] ` +
      `resolving to permission set(s) [${setNames.join(', ') || 'none'}] (union-merged, most-permissive).` +
      (context?.onBehalfOf?.userId
        ? delegatorMissing
          ? ` Acting on behalf of ${context.onBehalfOf.userId}, who no longer exists — D10 fails CLOSED (access denied).`
          : ` Acting on behalf of ${context.onBehalfOf.userId} — effective access is the D10 INTERSECTION with the delegator's set(s) [${delegatorNames.join(', ') || 'none'}].`
        : '') +
      (delegatedPositions.length > 0
        ? ` ${delegatedPositions.length} position(s) held via delegation (ADR-0091 D3): [${delegatedPositions
            .map((d) => `${d.name} from ${d.from}${d.until ? ` until ${d.until}` : ''}`)
            .join(', ')}].`
        : '') +
      (expiredGrants.length > 0
        ? ` ${expiredGrants.length} grant(s) present but EXPIRED (ADR-0091): [${expiredGrants
            .map((g) => `${g.name}${g.until ? ` until ${g.until}` : ''}`)
            .join(', ')}] — contributing nothing.`
        : ''),
    contributors: [
      ...positions.map((p) => {
        const d = delegationOf(p);
        return d
          ? { kind: 'position' as const, name: p, via: `delegation from ${d.from}${d.until ? ` until ${d.until}` : ''}` }
          : { kind: 'position' as const, name: p };
      }),
      ...setNames.map((n) => ({ kind: 'permission_set' as const, name: n, via: viaOf(n) })),
      ...expiredGrants.map((g) => ({
        kind: g.kind,
        name: g.name,
        via: g.until ? `held until ${g.until} — expired` : 'expired',
        state: 'expired' as const,
      })),
    ],
  });

  // ── posture shared by later layers ────────────────────────────────────
  const secMeta = await deps.getObjectSecurityMeta(object);
  let schema: any = null;
  try { schema = deps.ql?.getSchema?.(object) ?? null; } catch { schema = null; }

  // ── 2. required_permissions AND-gate ──────────────────────────────────
  const required = deps.requiredCaps(secMeta.requiredPermissions, dataOp);
  let capsDeny = false;
  if (required.length > 0) {
    const held = deps.evaluator.getSystemPermissions(sets);
    const missing = required.filter((c) => !held.has(c));
    // [ADR-0090 D10] Both principals must hold every required capability.
    const heldDel = delegatorSets ? deps.evaluator.getSystemPermissions(delegatorSets) : null;
    const missingDel = heldDel ? required.filter((c) => !heldDel.has(c)) : [];
    capsDeny = missing.length > 0 || missingDel.length > 0;
    layers.push({
      layer: 'required_permissions',
      verdict: capsDeny ? 'denies' : 'neutral',
      detail: capsDeny
        ? `'${object}' requires capability [${required.join(', ')}] for ${operation} — missing ` +
          `[${[...new Set([...missing, ...missingDel])].join(', ')}]` +
          (missingDel.length > 0 && missing.length === 0
            ? ' (the DELEGATOR lacks it — D10 intersection)'
            : '') +
          ` (checked BEFORE the CRUD grant, ADR-0066 ⑤).`
        : `Capability prerequisite [${required.join(', ')}] satisfied` +
          (delegatorSets ? ' by BOTH the agent and the delegator (D10)' : '') + '.',
      contributors: [],
    });
  } else {
    layers.push({
      layer: 'required_permissions',
      verdict: 'not_applicable',
      detail: `'${object}' declares no requiredPermissions for ${operation}.`,
      contributors: [],
    });
  }

  // ── 3. object_crud — the core grant, with per-set attribution ─────────
  const agentCrud = deps.evaluator.checkObjectPermission(engineOp, object, sets, { isPrivate: secMeta.isPrivate });
  // [ADR-0090 D10] Both principals must grant the CRUD op; the agent may not
  // act beyond the delegator's own reach (and vice-versa).
  const delegatorCrud = delegatorSets
    ? deps.evaluator.checkObjectPermission(engineOp, object, delegatorSets, { isPrivate: secMeta.isPrivate })
    : true;
  // [#3545] An UNRESOLVED posture is a denial in the middleware, so it must read
  // as one here too — explain and enforcement disagreeing on a security surface
  // is the same `declared ≠ enforced` gap this engine exists to expose. Reported
  // on the existing `object_crud` layer (no new layer kind): the posture is what
  // that layer's grant is computed FROM, and reporting the real cause beats a
  // misleading "no set grants it" when the sets were never the problem.
  const postureUnresolved = secMeta.unresolved === true;
  const crudAllowed = agentCrud && delegatorCrud && !delegatorMissing && !postureUnresolved;
  const granting = postureUnresolved
    ? []
    : sets
        .filter((s) => deps.evaluator.checkObjectPermission(engineOp, object, [s], { isPrivate: secMeta.isPrivate }))
        .map((s: any) => String(s.name ?? '?'));
  layers.push({
    layer: 'object_crud',
    verdict: crudAllowed ? 'grants' : 'denies',
    detail: crudAllowed
      ? `${operation} on '${object}' is granted by [${granting.join(', ')}]` +
        (delegatorSets ? ' AND by the delegator (D10 intersection).' : '.')
      : postureUnresolved
        ? `The security posture of '${object}' could not be resolved (neither the live schema nor the ` +
          `metadata service returned it) — its 'private' flag and required-capability contract are ` +
          `unknown, so access fails CLOSED rather than defaulting to public/uncontracted (#3545).`
        : delegatorMissing
          ? `Delegator no longer exists — D10 fails closed (access denied).`
          : agentCrud && !delegatorCrud
            ? `The agent grants ${operation} on '${object}' but the DELEGATOR does not — D10 intersection denies (an agent may not exceed the user it acts for).`
            : `No resolved permission set grants ${operation} on '${object}'` +
              (secMeta.isPrivate ? " (object is 'private' posture — non-superuser '*' wildcards are excluded, ADR-0066 D2)." : '.'),
    contributors: granting.map((n) => ({ kind: 'permission_set' as const, name: n, via: viaOf(n) })),
  });

  // ── 4. fls ─────────────────────────────────────────────────────────────
  const agentMask = deps.getFieldMask(sets, object, secMeta.fieldRequiredPermissions);
  // [ADR-0090 D10] Intersect the two masks — a field is readable only if BOTH
  // principals can read it.
  const mask = delegatorSets
    ? intersectFieldMasks(agentMask, deps.getFieldMask(delegatorSets, object, secMeta.fieldRequiredPermissions))
    : agentMask;
  // [#9127] The field-mask decision has THREE outcomes, not two — hidden
  // (key deleted), PARTIALLY masked (key served, value replaced by the
  // field's `maskingRule`), and readable. `deps.getPartialMaskRules` is the
  // enforcement composition verbatim, never a second derivation of it: the
  // binary mask below cannot express the middle state, and reading it alone
  // is what made this layer call a partially-masked field fully hidden and a
  // gate-less rule field fully readable.
  //
  // The hidden/partial split is `FieldMasker.maskResults`' own: it deletes a
  // field when the binary mask denies it AND no rule applies, so a rule that
  // survived the explicit-deny exclusion always demotes `hidden` to `partial`
  // — including the capability-gated case, where the mask says `readable:
  // false` precisely because the unmask gate is what the rule softens.
  const partialRules = await deps.getPartialMaskRules(sets, object, delegatorSets);
  const partial = Object.keys(partialRules);
  const hidden = Object.entries(mask)
    .filter(([f, p]) => p?.readable === false && !(f in partialRules))
    .map(([f]) => f);
  const listFields = (fields: string[], label: (f: string) => string): string =>
    `[${fields.slice(0, 25).map(label).join(', ')}${fields.length > 25 ? ', …' : ''}]`;
  const maskNarrows = hidden.length > 0 || partial.length > 0;
  layers.push({
    layer: 'fls',
    verdict: maskNarrows ? 'narrows' : 'not_applicable',
    detail: maskNarrows
      ? [
          hidden.length > 0
            ? `${hidden.length} field(s) masked from responses: ${listFields(hidden, (f) => f)}`
            : null,
          partial.length > 0
            ? `${partial.length} field(s) PARTIALLY masked — the key is still served, its value ` +
              `replaced: ${listFields(partial, (f) => `${f} (${describeMaskingRule(partialRules[f])})`)}`
            : null,
        ]
          .filter((s): s is string => s !== null)
          .join('; ') +
        (delegatorSets ? ' (intersection of agent + delegator masks, D10).' : '.')
      : 'No field-level masking applies.',
    contributors: [],
  });

  // ── 5. owd_baseline ────────────────────────────────────────────────────
  const owd = describeOwd(schema);
  layers.push({
    layer: 'owd_baseline',
    verdict: owd.effect === 'public' ? 'neutral' : 'narrows',
    detail:
      `Record baseline (OWD) is ${owd.model}: ` +
      (owd.effect === 'private'
        ? 'rows are owner-visible only; sharing can only WIDEN from here.'
        : owd.effect === 'read'
          ? 'all rows readable org-wide, writes owner-scoped.'
          : 'rows are org-shared at this baseline.'),
    contributors: [],
  });

  // ── 6. depth ───────────────────────────────────────────────────────────
  const opClass = dataOp === 'find' ? 'read' : 'write';
  const agentScope = deps.evaluator.getEffectiveScope(opClass as 'read' | 'write', object, sets, { isPrivate: secMeta.isPrivate });
  // [ADR-0090 D10] The delegated principal sees the NARROWER of the two depths.
  const scope = delegatorSets
    ? narrowerScope(agentScope, deps.evaluator.getEffectiveScope(opClass as 'read' | 'write', object, delegatorSets, { isPrivate: secMeta.isPrivate }))
    : agentScope;
  const depthApplies = owd.effect !== 'public';
  layers.push({
    layer: 'depth',
    verdict: !depthApplies ? 'not_applicable' : scope === 'own' ? 'neutral' : 'widens',
    detail: !depthApplies
      ? 'Depth axis does not apply (baseline already org-wide).'
      : `Effective ${opClass} depth: '${scope}' (ADR-0057 D1 — widest across granting sets; ` +
        (delegatorSets ? `narrowed to the delegator's depth by D10 intersection; ` : '') +
        `assignment BU anchors narrow which unit 'unit*' means, ADR-0090 Addendum).`,
    contributors: [],
  });

  // ── 7. sharing ─────────────────────────────────────────────────────────
  layers.push({
    layer: 'sharing',
    verdict: owd.effect === 'private' ? 'widens' : 'not_applicable',
    detail: owd.effect === 'private'
      ? 'Record shares, sharing rules and team grants OR-in additional rows at query time (record-level; evaluate per record via the sharing service).'
      : 'Baseline already grants the rows sharing would add.',
    contributors: [],
  });

  // ── 8. vama_bypass ─────────────────────────────────────────────────────
  // [#4647] Resolved through `PermissionEvaluator.superuserBypassSets` — the
  // ONE bypass predicate. `ISecurityService.hasWriteBypass` folds through the
  // same function, and that is what plugin-sharing's `canEdit`/`canDelete`
  // (hence the `sys_attachment` `canEdit(parent)` gate) consult on the write
  // path. explain and enforcement ask the same question of the same code, so
  // they can no longer answer it differently for one (principal, record,
  // operation) triple.
  //
  // The bit is OPERATION-scoped: a write asks for `modifyAllRecords` exactly as
  // the write gate does, because "View All Data" is a read power and must not
  // widen a write. Reading either bit here (the pre-#4647 behaviour) would have
  // re-created the same contradiction one bit down.
  const vamaBit = superuserBypassBitForOperation(dataOp);
  const vamaOf = (list: PermissionSet[]): string[] =>
    deps.evaluator.superuserBypassSets(object, list, { isPrivate: secMeta.isPrivate, bit: vamaBit });
  const agentVama = vamaOf(sets);
  const delegatorVama = delegatorSets ? vamaOf(delegatorSets) : null;
  // [ADR-0090 D10] The bypass only survives the intersection when BOTH sides
  // hold it — an agent's own View-All must never let it see rows its delegator
  // cannot (the grant-ceiling makes agent VAMA impossible anyway; this is the
  // belt-and-braces at evaluation time).
  const vamaEffective = agentVama.length > 0 && (delegatorVama === null || delegatorVama.length > 0);
  const vamaSets = agentVama;
  // [#4647] A write question whose answer is "no bypass" still owes the admin
  // WHICH bit is missing: holding View All Data and being refused an update is
  // exactly the case this layer is read for.
  const viewOnlySets = vamaBit === 'modify' && agentVama.length === 0
    ? deps.evaluator.superuserBypassSets(object, sets, { isPrivate: secMeta.isPrivate, bit: 'view' })
    : [];
  layers.push({
    layer: 'vama_bypass',
    verdict: vamaEffective ? 'widens' : 'not_applicable',
    detail: vamaEffective
      ? `View/Modify All Data bypass held via [${vamaSets.join(', ')}]` +
        (delegatorVama ? ` AND by the delegator [${delegatorVama.join(', ')}]` : '') +
        ` — ownership and sharing checks are skipped` +
        (vamaBit === 'modify'
          ? ` (Modify All Data: the write path consults this SAME bypass, #4647).`
          : `.`)
      : agentVama.length > 0 && delegatorVama !== null && delegatorVama.length === 0
        ? `Agent holds View/Modify All Data via [${agentVama.join(', ')}] but the DELEGATOR does not — D10 intersection strips the bypass.`
        : viewOnlySets.length > 0
          ? `View All Data held via [${viewOnlySets.join(', ')}] does NOT bypass ownership for ${operation} — ` +
            `a write bypass requires Modify All Data (modifyAllRecords), so ownership and sharing still decide (#4647).`
          : 'No View/Modify All Data bypass.',
    contributors: vamaEffective ? vamaSets.map((n) => ({ kind: 'permission_set' as const, name: n, via: viaOf(n) })) : [],
  });

  // ── 9. rls — the composed machine artifact ─────────────────────────────
  let agentFilter: Record<string, unknown> | null | undefined;
  try {
    agentFilter = await deps.computeRlsFilter(sets, object, dataOp, context);
  } catch {
    agentFilter = { id: '__deny_all__' };
  }
  // [ADR-0090 D10] AND the delegator's read filter into the composite — the
  // delegated principal sees only rows BOTH principals may see.
  let delegatorFilter: Record<string, unknown> | null | undefined;
  if (delegatorSets && delegatorContextForRls) {
    try {
      delegatorFilter = await deps.computeRlsFilter(delegatorSets, object, dataOp, delegatorContextForRls);
    } catch {
      delegatorFilter = { id: '__deny_all__' };
    }
  }
  const filterParts = [agentFilter, delegatorFilter].filter(Boolean) as Record<string, unknown>[];
  let readFilter: Record<string, unknown> | null | undefined =
    filterParts.length === 0 ? undefined : filterParts.length === 1 ? filterParts[0] : { $and: filterParts };
  const denyAll = filterParts.some((f) => (f as any).id === '__deny_all__');
  if (denyAll) readFilter = { id: '__deny_all__' };
  layers.push({
    layer: 'rls',
    verdict: denyAll ? 'denies' : readFilter ? 'narrows' : 'not_applicable',
    detail: denyAll
      ? 'Row-level security composes to DENY ALL for this principal.'
      : readFilter
        ? 'Row-level security narrows the row set (see readFilter for the composed predicate)' +
          (delegatorFilter ? ' — intersection of agent + delegator filters (D10).' : '.')
        : 'No RLS policy applies.',
    contributors: [],
  });

  const allowed = !capsDeny && crudAllowed && !denyAll && !delegatorMissing;

  // ── [C2 / ADR-0095] Record-grained augmentation ─────────────────────────
  // Object-level (no recordId) is left BYTE-IDENTICAL: no tenant_isolation
  // layer, no kernelTier, no posture, no per-layer/decision `record`.
  let recordVerdict: ExplainDecision['record'] | undefined;
  let posture: AuthzPosture | undefined;
  if (input.recordId) {
    const out = await applyRecordAttribution({
      deps, object, recordId: input.recordId, engineOp: dataOp, context, sets, layers, owd, capsDeny, crudAllowed,
      vamaEffective, vamaSets,
    });
    recordVerdict = out.record;
    posture = out.posture;
  }

  const decision: ExplainDecision = {
    allowed,
    object,
    operation,
    principal: {
      userId: context?.userId ?? null,
      positions,
      permissionSets: setNames,
      ...(context?.principalKind ? { principalKind: context.principalKind } : {}),
      ...(context?.onBehalfOf?.userId ? { onBehalfOf: { userId: context.onBehalfOf.userId } } : {}),
      ...(posture ? { posture } : {}),
    },
    layers,
    // [#3544] `export` surfaces the read filter too — it streams the same
    // rows through the same filter, so omitting it would hide the very
    // narrowing that explains a short export.
    ...(operation === 'read' || operation === 'export' ? { readFilter: readFilter ?? null } : {}),
    // [#4647] `allowed` answers the OBJECT question and `record` the ROW one;
    // what they may never do is contradict each other about the same row. The
    // pre-#4647 payload could carry `allowed: true` beside
    // `record: { visible: false, decidedBy: 'sharing' }` for a Modify All Data
    // holder — the row verdict denying what the bypass layer above it said was
    // skipped. They agree now because the row verdict comes from the write gate
    // that consults the same bypass `allowed`'s RLS composition short-circuits.
    ...(recordVerdict ? { record: recordVerdict } : {}),
  };
  return decision;
}
