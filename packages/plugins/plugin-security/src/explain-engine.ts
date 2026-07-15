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

import { isGrantActive, isGrantExpired } from '@objectstack/core';
import { matchesFilterCondition } from '@objectstack/formula';
import { BUILTIN_IDENTITY_PLATFORM_ADMIN, ADMIN_FULL_ACCESS } from '@objectstack/spec';
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

/**
 * [C2 / ADR-0095 D2] Resolve the principal's posture rung. This is the B2
 * stand-in derivation the task calls for — until the full posture resolver lands
 * it is derived from the SAME evidence enforcement already trusts: the derived
 * `platform_admin` built-in / an unscoped `admin_full_access` grant (PLATFORM_ADMIN),
 * the org-admin/owner roles projected by `resolveAuthzContext` (TENANT_ADMIN), an
 * authenticated user (MEMBER), or an anonymous / guest principal (EXTERNAL).
 *
 * TODO(B2): replace with the monotonic posture resolved once in
 * `resolveAuthzContext` when it merges; the rung values are already stable.
 */
function derivePosture(context: any): AuthzPosture {
  const positions: string[] = Array.isArray(context?.positions) ? context.positions : [];
  const permissions: string[] = Array.isArray(context?.permissions) ? context.permissions : [];
  if (!context?.userId || context?.principalKind === 'guest') return 'EXTERNAL';
  if (positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN) || permissions.includes(ADMIN_FULL_ACCESS)) {
    return 'PLATFORM_ADMIN';
  }
  if (positions.includes('org_owner') || positions.includes('org_admin')) return 'TENANT_ADMIN';
  return 'MEMBER';
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
};

export interface ExplainEngineDeps {
  ql: any;
  /** The middleware's own set resolution (baseline + everyone semantics included). */
  resolveSets: (context: any) => Promise<PermissionSet[]>;
  evaluator: PermissionEvaluator;
  getObjectSecurityMeta: (object: string) => Promise<{
    isPrivate: boolean;
    requiredPermissions: any;
    fieldRequiredPermissions: Record<string, string[]>;
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
  /** Configured additive baseline set name (default member_default), for attribution. */
  fallbackPermissionSet: string | null;

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
  /** The concrete `sys_record_share` rows attached to the record (for `rules[]` attribution). */
  listRecordShares?: (
    object: string,
    recordId: string,
    context: any,
  ) => Promise<Array<{ id?: string; recipient_type?: string; recipient_id?: string; access_level?: 'read' | 'edit' | 'full'; source?: string; source_id?: string }>>;
  /** The sharing service's per-record write gate (`canEdit`) — the by-construction verdict for write operations. */
  canEditRecord?: (object: string, recordId: string, context: any) => Promise<boolean>;
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

/**
 * Reconstruct an evaluation context for an arbitrary user, mirroring the
 * runtime resolver's semantics (`@objectstack/core` resolveAuthzContext):
 * positions from `sys_user_position` (+ the implicit `everyone` anchor,
 * ADR-0090 D5/D9), direct grants from `sys_user_permission_set`. Used by the
 * explain API's `userId` parameter — the caller-facing authorization for
 * explaining OTHERS lives in the route/service wrapper, not here.
 */
export async function buildContextForUser(ql: any, userId: string, nowMs: number = Date.now()): Promise<any> {
  const positions: string[] = [];
  const permissions: string[] = [];
  // [ADR-0091 D2] Rows outside their validity window resolve to NOTHING (same
  // predicate as resolveAuthzContext, fail-closed). Expired-but-present rows
  // are collected separately so the principal layer can report the dedicated
  // "held until … — expired" contributor state.
  const expiredGrants: Array<{ kind: 'position' | 'permission_set'; name: string; until?: string }> = [];
  // [ADR-0091 D3] Delegation provenance: a position held via a `delegated_from`
  // row is reported "via delegation from X, until Y" in the principal layer.
  const delegatedPositions: Array<{ name: string; from: string; until?: string }> = [];
  const untilOf = (r: any): string | undefined => {
    const v = r?.valid_until ?? r?.validUntil;
    return v == null || v === '' ? undefined : String(v);
  };
  try {
    const rows = await ql.find('sys_user_position', { where: { user_id: userId }, limit: 500, context: SYSTEM_CTX });
    for (const r of Array.isArray(rows) ? rows : []) {
      const p = String((r as any)?.position ?? '');
      if (!p) continue;
      if (!isGrantActive(r, nowMs)) {
        if (isGrantExpired(r, nowMs)) expiredGrants.push({ kind: 'position', name: p, until: untilOf(r) });
        continue;
      }
      if (!positions.includes(p)) positions.push(p);
      const from = (r as any)?.delegated_from;
      if (from != null && from !== '') {
        delegatedPositions.push({ name: p, from: String(from), until: untilOf(r) });
      }
    }
  } catch { /* table unavailable → positions stay empty */ }
  try {
    const grants = await ql.find('sys_user_permission_set', { where: { user_id: userId }, limit: 500, context: SYSTEM_CTX });
    const grantRows = (Array.isArray(grants) ? grants : []) as any[];
    const activeRows = grantRows.filter((g) => isGrantActive(g, nowMs));
    const expiredRows = grantRows.filter((g) => !isGrantActive(g, nowMs) && isGrantExpired(g, nowMs));
    const ids = [...activeRows, ...expiredRows].map((g: any) => g?.permission_set_id).filter(Boolean);
    if (ids.length > 0) {
      const sets = await ql.find('sys_permission_set', { where: { id: { $in: ids } }, limit: ids.length, context: SYSTEM_CTX });
      const nameById = new Map<string, string>();
      for (const s of Array.isArray(sets) ? sets : []) {
        if ((s as any)?.id && (s as any)?.name) nameById.set(String((s as any).id), String((s as any).name));
      }
      for (const g of activeRows) {
        const n = nameById.get(String(g?.permission_set_id ?? ''));
        if (n && !permissions.includes(n)) permissions.push(n);
      }
      for (const g of expiredRows) {
        const n = nameById.get(String(g?.permission_set_id ?? ''));
        if (n) expiredGrants.push({ kind: 'permission_set', name: n, until: untilOf(g) });
      }
    }
  } catch { /* ignore */ }
  // [ADR-0090 D5] Authenticated principals implicitly hold the everyone anchor.
  if (!positions.includes('everyone')) positions.push('everyone');
  return { userId, positions, permissions, expiredGrants, delegatedPositions };
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
 *  - **Tenant-scoped bags are inherited from the live principal.** The agent and
 *    its delegator are, by construction, in the same org, so `tenantId` /
 *    `org_user_ids` carry over — delegator-side RLS that substitutes them then
 *    compiles faithfully instead of collapsing to the deny sentinel.
 *  - **Person-specific membership bags (`rlsMembership`) are left unresolved**
 *    for the first cut. Absent → the RLS compiler's fail-closed substitution
 *    NARROWS the delegator's row set, never widens it — safe by construction.
 *    Full parity (team/territory bags) is a follow-up routing the delegator
 *    through the shared `resolveAuthzContext`.
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
  const { deps, object, recordId, engineOp, context, sets, layers, owd, capsDeny, crudAllowed } = ra;
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
  // Write ops: the by-construction verdict is the sharing service's own canEdit.
  const canEdit = !isRead && deps.canEditRecord && recordExists
    ? await deps.canEditRecord(object, recordId, context).catch(() => undefined)
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
                ? 'The sharing service grants write on this record (ownership or an edit/full share).'
                : 'No ownership and no edit/full share grants write on this record.')
            : sharingOutcome === 'admitted'
              ? (ownerIsMe ? 'Caller owns the record — visible without a share.' : `${shareRules.length} share(s) attached; access is granted for this record.`)
              : `${shareRules.length} share(s) attached; none grants the caller access to this record.`,
    };
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
  const businessRowAdmits = isRead
    ? owd.effect !== 'private' || ownerIsMe || sharingOutcome === 'admitted'
    : canEdit !== undefined
      ? canEdit
      : owd.effect === 'public' || ownerIsMe || sharingOutcome === 'admitted';

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
    decidedBy = (owd.effect === 'private' && !ownerIsMe && sharingOutcome === 'admitted')
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
    if (name === deps.fallbackPermissionSet) return 'additive baseline (ADR-0090 D5)';
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
  const required = deps.requiredCaps(secMeta.requiredPermissions, engineOp);
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
  const crudAllowed = agentCrud && delegatorCrud && !delegatorMissing;
  const granting = sets
    .filter((s) => deps.evaluator.checkObjectPermission(engineOp, object, [s], { isPrivate: secMeta.isPrivate }))
    .map((s: any) => String(s.name ?? '?'));
  layers.push({
    layer: 'object_crud',
    verdict: crudAllowed ? 'grants' : 'denies',
    detail: crudAllowed
      ? `${operation} on '${object}' is granted by [${granting.join(', ')}]` +
        (delegatorSets ? ' AND by the delegator (D10 intersection).' : '.')
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
  const hidden = Object.entries(mask).filter(([, p]) => p?.readable === false).map(([f]) => f);
  layers.push({
    layer: 'fls',
    verdict: hidden.length > 0 ? 'narrows' : 'not_applicable',
    detail: hidden.length > 0
      ? `${hidden.length} field(s) masked from responses: [${hidden.slice(0, 25).join(', ')}${hidden.length > 25 ? ', …' : ''}]` +
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
  const opClass = engineOp === 'find' ? 'read' : 'write';
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
  const vamaOf = (list: PermissionSet[]): string[] =>
    list
      .filter((s: any) => {
        const objects = s?.objects ?? {};
        const entry = objects[object] ?? objects['*'];
        return entry && (entry.viewAllRecords === true || entry.modifyAllRecords === true);
      })
      .map((s: any) => String(s.name ?? '?'));
  const agentVama = vamaOf(sets);
  const delegatorVama = delegatorSets ? vamaOf(delegatorSets) : null;
  // [ADR-0090 D10] The bypass only survives the intersection when BOTH sides
  // hold it — an agent's own View-All must never let it see rows its delegator
  // cannot (the grant-ceiling makes agent VAMA impossible anyway; this is the
  // belt-and-braces at evaluation time).
  const vamaEffective = agentVama.length > 0 && (delegatorVama === null || delegatorVama.length > 0);
  const vamaSets = agentVama;
  layers.push({
    layer: 'vama_bypass',
    verdict: vamaEffective ? 'widens' : 'not_applicable',
    detail: vamaEffective
      ? `View/Modify All Data bypass held via [${vamaSets.join(', ')}]` +
        (delegatorVama ? ` AND by the delegator [${delegatorVama.join(', ')}]` : '') +
        ` — ownership and sharing checks are skipped.`
      : agentVama.length > 0 && delegatorVama !== null && delegatorVama.length === 0
        ? `Agent holds View/Modify All Data via [${agentVama.join(', ')}] but the DELEGATOR does not — D10 intersection strips the bypass.`
        : 'No View/Modify All Data bypass.',
    contributors: vamaEffective ? vamaSets.map((n) => ({ kind: 'permission_set' as const, name: n, via: viaOf(n) })) : [],
  });

  // ── 9. rls — the composed machine artifact ─────────────────────────────
  let agentFilter: Record<string, unknown> | null | undefined;
  try {
    agentFilter = await deps.computeRlsFilter(sets, object, engineOp, context);
  } catch {
    agentFilter = { id: '__deny_all__' };
  }
  // [ADR-0090 D10] AND the delegator's read filter into the composite — the
  // delegated principal sees only rows BOTH principals may see.
  let delegatorFilter: Record<string, unknown> | null | undefined;
  if (delegatorSets && delegatorContextForRls) {
    try {
      delegatorFilter = await deps.computeRlsFilter(delegatorSets, object, engineOp, delegatorContextForRls);
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
      deps, object, recordId: input.recordId, engineOp, context, sets, layers, owd, capsDeny, crudAllowed,
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
    ...(operation === 'read' ? { readFilter: readFilter ?? null } : {}),
    ...(recordVerdict ? { record: recordVerdict } : {}),
  };
  return decision;
}
