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

import type { PermissionSet } from '@objectstack/spec/security';
import type {
  ExplainDecision,
  ExplainLayer,
  ExplainOperation,
} from '@objectstack/spec/security';
import type { PermissionEvaluator } from './permission-evaluator.js';

const SYSTEM_CTX = { isSystem: true } as const;

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
}

export interface ExplainInput {
  object: string;
  operation: ExplainOperation;
  /** Execution context of the principal being EXPLAINED (not the caller). */
  context: any;
}

/**
 * Reconstruct an evaluation context for an arbitrary user, mirroring the
 * runtime resolver's semantics (`@objectstack/core` resolveAuthzContext):
 * positions from `sys_user_position` (+ the implicit `everyone` anchor,
 * ADR-0090 D5/D9), direct grants from `sys_user_permission_set`. Used by the
 * explain API's `userId` parameter — the caller-facing authorization for
 * explaining OTHERS lives in the route/service wrapper, not here.
 */
export async function buildContextForUser(ql: any, userId: string): Promise<any> {
  const positions: string[] = [];
  const permissions: string[] = [];
  try {
    const rows = await ql.find('sys_user_position', { where: { user_id: userId }, limit: 500, context: SYSTEM_CTX });
    for (const r of Array.isArray(rows) ? rows : []) {
      const p = String((r as any)?.position ?? '');
      if (p && !positions.includes(p)) positions.push(p);
    }
  } catch { /* table unavailable → positions stay empty */ }
  try {
    const grants = await ql.find('sys_user_permission_set', { where: { user_id: userId }, limit: 500, context: SYSTEM_CTX });
    const ids = (Array.isArray(grants) ? grants : []).map((g: any) => g?.permission_set_id).filter(Boolean);
    if (ids.length > 0) {
      const sets = await ql.find('sys_permission_set', { where: { id: { $in: ids } }, limit: ids.length, context: SYSTEM_CTX });
      for (const s of Array.isArray(sets) ? sets : []) {
        const n = String((s as any)?.name ?? '');
        if (n && !permissions.includes(n)) permissions.push(n);
      }
    }
  } catch { /* ignore */ }
  // [ADR-0090 D5] Authenticated principals implicitly hold the everyone anchor.
  if (!positions.includes('everyone')) positions.push('everyone');
  return { userId, positions, permissions };
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

export async function explainAccess(deps: ExplainEngineDeps, input: ExplainInput): Promise<ExplainDecision> {
  const { object, operation, context } = input;
  const engineOp = EXPLAIN_TO_ENGINE_OP[operation];
  const layers: ExplainLayer[] = [];

  // ── 1. principal ──────────────────────────────────────────────────────
  const sets = await deps.resolveSets(context).catch(() => [] as PermissionSet[]);
  const setNames = sets.map((s: any) => String(s.name ?? '?'));
  const positions: string[] = context?.positions ?? [];
  const viaOf = (name: string): string => {
    if (name === deps.fallbackPermissionSet) return 'additive baseline (ADR-0090 D5)';
    if (positions.includes(name)) return `position:${name}`;
    if ((context?.permissions ?? []).includes(name)) return 'direct grant';
    return 'resolved';
  };
  layers.push({
    layer: 'principal',
    verdict: 'neutral',
    detail:
      `Principal ${context?.userId ?? '(anonymous)'} holds position(s) [${positions.join(', ') || 'none'}] ` +
      `resolving to permission set(s) [${setNames.join(', ') || 'none'}] (union-merged, most-permissive).` +
      (context?.onBehalfOf?.userId
        ? ` Acting on behalf of ${context.onBehalfOf.userId} — D10 intersection semantics apply at enforcement.`
        : ''),
    contributors: [
      ...positions.map((p) => ({ kind: 'position' as const, name: p })),
      ...setNames.map((n) => ({ kind: 'permission_set' as const, name: n, via: viaOf(n) })),
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
    capsDeny = missing.length > 0;
    layers.push({
      layer: 'required_permissions',
      verdict: capsDeny ? 'denies' : 'neutral',
      detail: capsDeny
        ? `'${object}' requires capability [${required.join(', ')}] for ${operation} — missing [${missing.join(', ')}] (checked BEFORE the CRUD grant, ADR-0066 ⑤).`
        : `Capability prerequisite [${required.join(', ')}] satisfied.`,
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
  const crudAllowed = deps.evaluator.checkObjectPermission(engineOp, object, sets, { isPrivate: secMeta.isPrivate });
  const granting = sets
    .filter((s) => deps.evaluator.checkObjectPermission(engineOp, object, [s], { isPrivate: secMeta.isPrivate }))
    .map((s: any) => String(s.name ?? '?'));
  layers.push({
    layer: 'object_crud',
    verdict: crudAllowed ? 'grants' : 'denies',
    detail: crudAllowed
      ? `${operation} on '${object}' is granted by [${granting.join(', ')}].`
      : `No resolved permission set grants ${operation} on '${object}'` +
        (secMeta.isPrivate ? " (object is 'private' posture — non-superuser '*' wildcards are excluded, ADR-0066 D2)." : '.'),
    contributors: granting.map((n) => ({ kind: 'permission_set' as const, name: n, via: viaOf(n) })),
  });

  // ── 4. fls ─────────────────────────────────────────────────────────────
  const mask = deps.getFieldMask(sets, object, secMeta.fieldRequiredPermissions);
  const hidden = Object.entries(mask).filter(([, p]) => p?.readable === false).map(([f]) => f);
  layers.push({
    layer: 'fls',
    verdict: hidden.length > 0 ? 'narrows' : 'not_applicable',
    detail: hidden.length > 0
      ? `${hidden.length} field(s) masked from responses: [${hidden.slice(0, 25).join(', ')}${hidden.length > 25 ? ', …' : ''}].`
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
  const scope = deps.evaluator.getEffectiveScope(opClass as 'read' | 'write', object, sets, { isPrivate: secMeta.isPrivate });
  const depthApplies = owd.effect !== 'public';
  layers.push({
    layer: 'depth',
    verdict: !depthApplies ? 'not_applicable' : scope === 'own' ? 'neutral' : 'widens',
    detail: !depthApplies
      ? 'Depth axis does not apply (baseline already org-wide).'
      : `Effective ${opClass} depth: '${scope}' (ADR-0057 D1 — widest across granting sets; ` +
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
  const vamaSets = sets
    .filter((s: any) => {
      const objects = s?.objects ?? {};
      const entry = objects[object] ?? objects['*'];
      return entry && (entry.viewAllRecords === true || entry.modifyAllRecords === true);
    })
    .map((s: any) => String(s.name ?? '?'));
  layers.push({
    layer: 'vama_bypass',
    verdict: vamaSets.length > 0 ? 'widens' : 'not_applicable',
    detail: vamaSets.length > 0
      ? `View/Modify All Data bypass held via [${vamaSets.join(', ')}] — ownership and sharing checks are skipped.`
      : 'No View/Modify All Data bypass.',
    contributors: vamaSets.map((n) => ({ kind: 'permission_set' as const, name: n, via: viaOf(n) })),
  });

  // ── 9. rls — the composed machine artifact ─────────────────────────────
  let readFilter: Record<string, unknown> | null | undefined;
  try {
    readFilter = await deps.computeRlsFilter(sets, object, engineOp, context);
  } catch {
    readFilter = { id: '__deny_all__' };
  }
  const denyAll = !!readFilter && (readFilter as any).id === '__deny_all__';
  layers.push({
    layer: 'rls',
    verdict: denyAll ? 'denies' : readFilter ? 'narrows' : 'not_applicable',
    detail: denyAll
      ? 'Row-level security composes to DENY ALL for this principal.'
      : readFilter
        ? 'Row-level security narrows the row set (see readFilter for the composed predicate).'
        : 'No RLS policy applies.',
    contributors: [],
  });

  const allowed = !capsDeny && crudAllowed && !denyAll;

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
    },
    layers,
    ...(operation === 'read' ? { readFilter: readFilter ?? null } : {}),
  };
  return decision;
}
