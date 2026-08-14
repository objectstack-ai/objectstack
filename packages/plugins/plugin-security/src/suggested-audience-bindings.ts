// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Suggested audience bindings (ADR-0090 D5/D9) — the queryable surface and
 * confirm/dismiss flow for a package's `isDefault: true` install-time
 * suggestion ("bind this set to the `everyone` position — accept?").
 *
 * The suggestion itself is declaration-only (spec `PermissionSetSchema
 * .isDefault`); this module materializes it as `sys_audience_binding_suggestion`
 * rows so an admin can see and act on it after install:
 *
 *  - `syncAudienceBindingSuggestions` is CONVERGENT and idempotent: it reads
 *    every currently-declared `isDefault` set — boot-declared stack metadata
 *    AND installed package manifests (which the registry updates at
 *    `installPackage` time, so a runtime install is visible immediately,
 *    no reboot needed) — and reconciles the table: missing → pending row, or
 *    a `confirmed` (observed) row when the binding is already present;
 *    binding observed under an existing pending row → confirmed (observed);
 *    declaration gone (uninstall / flag dropped) → pending row pruned. It runs
 *    at boot, after a package-door `permission` publish, and on every list
 *    call. Every declaration is represented either way — an `isDefault` set
 *    the boot baseline auto-binds before the first sync is surfaced as
 *    confirmed/observed, never omitted (#7677).
 *  - `confirmAudienceBindingSuggestion` creates the anchor binding **with the
 *    caller's execution context**, so the ADR-0090 write gates do the real
 *    enforcement: the D5/D9 audience-anchor gate (no high-privilege set on
 *    `everyone`/`guest`) and the D12 delegated-admin gate (anchors are
 *    tenant-level only). Never auto-bound, never `isSystem`.
 *  - `dismissAudienceBindingSuggestion` records the admin's "no".
 *
 * All three service methods are additionally pre-gated on tenant-level
 * admin (the ADR-0066 superuser wildcard) so the read surface and the
 * no-write dismiss/idempotent-confirm paths are as strict as the bind write.
 *
 * ## The surface is PER ORGANIZATION, and so is every call in this module
 *
 * `sys_audience_binding_suggestion` declares `organization_id` with no tenancy
 * opt-out, and ADR-0090 D5/D9 resolves a row when a TENANT admin confirms — so
 * a row belongs to exactly one organization, and an organization-less row is
 * invalid state, not a platform-wide default. Every read and write below
 * therefore carries `{ isSystem: true, tenantId }`, and
 * {@link reconcileAudienceBindingSuggestions} runs one pass PER organization.
 *
 * ⚠️ Threading the tenant is necessary but NOT sufficient, which is why
 * {@link reapOrganizationLessSuggestions} exists. Measured on a real
 * `ObjectQL` + `SqlDriver` engine under `OS_TENANCY_POSTURE=isolated`:
 *
 * | call | result |
 * |---|---|
 * | insert under `{ isSystem: true }` | stores `organization_id` NULL |
 * | insert under `{ isSystem: true, tenantId: X }` | stores `organization_id` = X |
 * | find under `{ isSystem: true }` | sees every organization's rows |
 * | find under `{ isSystem: true, tenantId: X }` | sees X's rows **and** the NULL ones |
 *
 * The last row is ADR-0120 D3's platform bucket — declared driver behaviour,
 * not a bug: a tenant predicate expands to
 * `organization_id = :tenant OR organization_id IS NULL`. So a single
 * pre-fix organization-less row is still visible to EVERY tenant, and the
 * per-organization pass finds it, treats the key as already represented and
 * creates nothing — measured `{ created: 0 }` for both organizations. The
 * reap is what makes the tenant scoping observable at all on an installation
 * that ran the old code.
 *
 * Under a `single` posture nothing is walled and the organization-less row IS
 * the correct one; `reconcileAudienceBindingSuggestions` runs exactly one
 * organization-less pass there and never reaps.
 */

import type { PermissionSet, TenancyPosture } from '@objectstack/spec/security';
import { describeAnchorForbiddenBits, postureEnforcesWall } from '@objectstack/spec/security';
import { EVERYONE_POSITION, AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec';
import { PermissionDeniedError } from './errors.js';
import { readDeclared, upsertPackagePermissionSet } from './bootstrap-declared-permissions.js';
import { isTenantAdmin } from './delegated-admin-gate.js';

/**
 * The execution context every read and write in this module carries.
 *
 * `isSystem` is the RBAC bypass (this is platform reconciliation, not a user
 * action); `tenantId` is the ORGANIZATION SCOPE, and it is the half that was
 * missing. Passing no `organizationId` is meaningful and correct in exactly
 * one place — a `single`-posture deployment, which has no organization to
 * scope to — so the parameter is optional rather than required, and the
 * caller that decides is {@link reconcileAudienceBindingSuggestions}.
 */
function scopedSystemCtx(organizationId?: string): { isSystem: true; tenantId?: string } {
  return organizationId ? { isSystem: true, tenantId: organizationId } : { isSystem: true };
}

const SUGGESTION_OBJECT = 'sys_audience_binding_suggestion';
const ORGANIZATION_OBJECT = 'sys_organization';

/**
 * How many organizations one boot-time reconciliation pass enumerates.
 *
 * Bounded because this runs on `kernel:ready` and each organization costs a
 * handful of queries. Overflow is not silent: the enumeration warns and names
 * what still converges — `listAudienceBindingSuggestions` reconciles the
 * caller's OWN organization on every call, so an organization past the bound
 * is reconciled the first time its admin opens the surface.
 */
const ORGANIZATION_SCAN_LIMIT = 500;

/** Thrown when the referenced suggestion row does not exist → HTTP 404. */
export class SuggestionNotFoundError extends Error {
  readonly code = 'SUGGESTION_NOT_FOUND';
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Audience-binding suggestion '${id}' not found`);
    this.name = 'SuggestionNotFoundError';
  }
}

/** Thrown when a confirm/dismiss hits a non-pending row or an unresolvable
 *  precondition (set not materialized, anchor missing) → HTTP 409. */
export class SuggestionStateError extends Error {
  readonly code = 'SUGGESTION_STATE';
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'SuggestionStateError';
  }
}

export interface SuggestionDeps {
  /** ObjectQL engine handle. */
  ql: any;
  /** Metadata service (fallback source for boot-declared sets). */
  metadata?: any;
  /** Shared permission-set resolution (same path as the CRUD middleware). */
  resolveSets: (context: any) => Promise<PermissionSet[]>;
  logger?: { info?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void };
}

export interface SuggestionSyncOutcome {
  created: number;
  confirmedObserved: number;
  pruned: number;
}

/** What one whole-installation reconciliation did. */
export interface SuggestionReconcileOutcome extends SuggestionSyncOutcome {
  /**
   * How many TENANT-SCOPED passes ran. `0` under a `single` posture, where
   * exactly one organization-less pass runs instead — so `organizations: 0`
   * with a non-zero `created` is the single-organization deployment, not a
   * failed enumeration (which returns zeros and warns).
   */
  organizations: number;
  /** Pre-fix organization-less rows deleted before the passes (see the reap). */
  reaped: number;
}

/** Which organizations one reconciliation covers. */
export interface SuggestionReconcileScope {
  /**
   * [ADR-0105 D1] The tenancy posture in force. `single` ⇒ one
   * organization-less pass and no reap; `group`/`isolated` ⇒ per-organization
   * passes, because the rows are walled and an organization-less one is
   * invalid state.
   */
  posture: TenancyPosture;
  /**
   * Reconcile only this organization — the publishing tenant on the
   * package-door path. Omitted under a walled posture ⇒ every organization.
   */
  organizationId?: string;
}

export interface SuggestionListFilter {
  status?: 'pending' | 'confirmed' | 'dismissed';
  packageId?: string;
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

// Engine signatures: `find(object, query)` and `delete(object, options)` read
// `context` from their SECOND argument — a trailing `{ context }` arg is
// silently ignored and the operation runs principal-less.
async function tryFind(
  ql: any,
  object: string,
  where: any,
  limit = 500,
  organizationId?: string,
): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit, context: scopedSystemCtx(organizationId) });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/** A declared `isDefault` permission set together with its owning package. */
interface DeclaredSuggestion {
  packageId: string;
  set: any;
  anchor: string;
}

function suggestionKey(packageId: string, setName: string, anchor: string): string {
  return `${packageId}\u0000${setName}\u0000${anchor}`;
}

/**
 * Collect every currently-declared audience-binding suggestion from BOTH
 * declaration sources:
 *
 *  1. boot-declared stack metadata (the app bundle's `permissions`, registered
 *     into the SchemaRegistry / metadata service at boot) — provenance via
 *     `_packageId` (ADR-0010) with spec `packageId` (ADR-0086 D3) as fallback;
 *  2. installed package manifests (`registry.getAllPackages()`), which the
 *     registry updates synchronously at `installPackage` time — this is what
 *     makes a runtime `POST /api/v1/packages` install queryable immediately.
 *
 * Today the only declarable suggestion is `isDefault: true` → `everyone`
 * (ADR-0090 D5); the shape is anchor-keyed so the D9 `guest` generalization
 * slots in without a schema change.
 */
export function collectDeclaredSuggestions(ql: any, metadata?: any): DeclaredSuggestion[] {
  const out = new Map<string, DeclaredSuggestion>();

  const consider = (ps: any, packageId: string | undefined) => {
    if (!ps || typeof ps !== 'object' || !ps.name) return;
    if (ps.isDefault !== true) return;
    if (!packageId) return; // unowned suggestion = unowned binding — refuse (ADR-0086 D3)
    const anchor: string = EVERYONE_POSITION;
    const key = suggestionKey(packageId, ps.name, anchor);
    if (!out.has(key)) out.set(key, { packageId, set: ps, anchor });
  };

  // Source 1 — boot-declared stack metadata.
  for (const ps of readDeclared(ql, 'permission')) {
    consider(ps, (ps as any)._packageId ?? (ps as any).packageId ?? undefined);
  }
  try {
    const listed = metadata?.list?.('permission');
    if (Array.isArray(listed)) {
      for (const ps of listed) consider(ps, (ps as any)._packageId ?? (ps as any).packageId ?? undefined);
    }
  } catch { /* metadata facade optional */ }

  // Source 2 — installed package manifests (live at install time).
  try {
    const packages: any[] = ql?.registry?.getAllPackages?.() ?? [];
    for (const pkg of packages) {
      if (pkg?.enabled === false) continue;
      const manifest = pkg?.manifest;
      const declared = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
      for (const ps of declared) consider(ps, manifest?.id);
    }
  } catch { /* registry shape optional (test stubs) */ }

  return [...out.values()];
}

/**
 * Resolve the anchor position rows by name → `{ everyone: row?, guest: row? }`,
 * **in one organization's scope**.
 *
 * Tenant-blind, this resolved whichever organization's `everyone` row the
 * driver happened to return first under `limit 1` — so the anchor a suggestion
 * was checked against could belong to a different tenant entirely.
 *
 * Scoping it does not cost the stock deployment its anchor: measured, the
 * `everyone` row `bootstrapBuiltinRoles` seeds with a bare system context
 * (`organization_id` NULL) IS visible under `{ isSystem: true, tenantId: X }`,
 * because ADR-0120 D3's platform bucket expands the tenant predicate to
 * `organization_id = :tenant OR organization_id IS NULL`. What the scope
 * removes is the ability to resolve ANOTHER tenant's anchor.
 */
async function findAnchorPositions(ql: any, organizationId?: string): Promise<Record<string, any>> {
  const anchors: Record<string, any> = {};
  for (const name of AUDIENCE_ANCHOR_POSITIONS) {
    anchors[name] = (await tryFind(ql, 'sys_position', { name }, 1, organizationId))[0] ?? null;
  }
  return anchors;
}

/**
 * True when the set is already bound to the anchor (rows resolved by name),
 * **as this organization sees it** — the question is "does THIS tenant already
 * have the binding?", and answered tenant-blind it was another tenant's answer.
 */
async function bindingExists(
  ql: any,
  anchorRow: any,
  setRow: any,
  organizationId?: string,
): Promise<boolean> {
  if (!anchorRow?.id || !setRow?.id) return false;
  const rows = await tryFind(ql, 'sys_position_permission_set', {
    position_id: anchorRow.id,
    permission_set_id: setRow.id,
  }, 1, organizationId);
  return rows.length > 0;
}

/**
 * Reconcile ONE organization's `sys_audience_binding_suggestion` rows against
 * the current declarations. Idempotent; system-context **scoped to
 * `organizationId`**; never touches confirmed or dismissed rows except to
 * prune nothing (they are audit history).
 *
 * `organizationId` omitted = the organization-less surface of a `single`-posture
 * deployment. Under a walled posture the caller is
 * {@link reconcileAudienceBindingSuggestions}, which always supplies one.
 */
export async function syncAudienceBindingSuggestions(
  ql: any,
  metadata?: any,
  logger?: SuggestionDeps['logger'],
  organizationId?: string,
): Promise<SuggestionSyncOutcome> {
  const out: SuggestionSyncOutcome = { created: 0, confirmedObserved: 0, pruned: 0 };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;

  const declared = collectDeclaredSuggestions(ql, metadata);
  const declaredKeys = new Set(declared.map((d) => suggestionKey(d.packageId, d.set.name, d.anchor)));

  const anchors = await findAnchorPositions(ql, organizationId);
  const existing = await tryFind(ql, SUGGESTION_OBJECT, {}, 1000, organizationId);
  const byKey = new Map<string, any>(
    existing.map((row) => [suggestionKey(row.package_id, row.permission_set_name, row.anchor), row]),
  );

  for (const d of declared) {
    const key = suggestionKey(d.packageId, d.set.name, d.anchor);
    const row = byKey.get(key);
    const setRow = (await tryFind(ql, 'sys_permission_set', { name: d.set.name }, 1, organizationId))[0] ?? null;
    const bound = await bindingExists(ql, anchors[d.anchor], setRow, organizationId);

    if (row) {
      if (row.status === 'pending' && bound) {
        // Bound outside the prompt (boot baseline, admin by hand) — record the
        // observation so the surface never nags about a satisfied suggestion.
        try {
          await ql.update(SUGGESTION_OBJECT, {
            id: row.id, status: 'confirmed', resolved_at: new Date().toISOString(),
          }, { context: scopedSystemCtx(organizationId) });
          out.confirmedObserved += 1;
        } catch { /* non-fatal */ }
      }
      continue;
    }

    // No row yet. A declaration that is ALREADY satisfied is recorded as
    // `confirmed` (observed) rather than skipped — the same end state the
    // pending→confirmed branch above reaches, just arrived at without ever
    // passing through `pending`. [#7677] Skipping it entirely left the whole
    // surface empty on stock: the security plugin binds the app's `isDefault`
    // set to `everyone` at boot BEFORE the first sync runs, so "already bound"
    // is the normal stock case, not the exception, and the declaration was
    // only ever surfaced after someone deleted the binding by hand.
    //
    // `confirmed` and not `pending` because a bound declaration is not
    // awaiting an admin decision: `pending` is the actionable-prompt state
    // (the console panel lists exactly `status=pending` and offers
    // confirm/dismiss, and both service methods 409 on anything else), so a
    // pending row here would prompt an admin to "accept" a binding that
    // already exists. `resolved_by` is left empty, which is precisely how the
    // object schema defines an observed row: "Empty on a confirmed row means
    // the binding was observed (e.g. bound at boot or by hand), not confirmed
    // through the prompt."
    const observed = bound;

    try {
      await ql.insert(SUGGESTION_OBJECT, {
        id: genId('sug'),
        package_id: d.packageId,
        permission_set_name: d.set.name,
        anchor: d.anchor,
        status: observed ? 'confirmed' : 'pending',
        ...(observed ? { resolved_at: new Date().toISOString() } : {}),
      }, { context: scopedSystemCtx(organizationId) });
      out.created += 1;
    } catch { /* unique-index race with a concurrent sync — benign */ }
  }

  // Prune PENDING rows whose declaration is gone (package uninstalled or the
  // flag dropped on upgrade). Confirmed/dismissed rows stay as audit history.
  for (const row of existing) {
    if (row.status !== 'pending') continue;
    const key = suggestionKey(row.package_id, row.permission_set_name, row.anchor);
    if (declaredKeys.has(key)) continue;
    try {
      await ql.delete(SUGGESTION_OBJECT, { where: { id: row.id }, context: scopedSystemCtx(organizationId) });
      out.pruned += 1;
    } catch { /* non-fatal */ }
  }

  if (out.created + out.confirmedObserved + out.pruned > 0) {
    logger?.info?.('[security] audience-binding suggestions reconciled (ADR-0090 D5/D9)', {
      ...out, ...(organizationId ? { organization: organizationId } : {}),
    });
  }
  return out;
}

/**
 * Enumerate the organizations whose suggestion surfaces need reconciling.
 *
 * Returns `null` — not `[]` — when the read FAILS, because the two mean
 * opposite things and the caller must not conflate them: zero organizations is
 * "nothing to reconcile", while an unreadable `sys_organization` is "we do not
 * know", and both are silent if they share a value. A failure is warned, never
 * swallowed into an empty sweep.
 */
export async function listSuggestionOrganizationIds(
  ql: any,
  logger?: SuggestionDeps['logger'],
): Promise<string[] | null> {
  let rows: any;
  try {
    rows = await ql.find(ORGANIZATION_OBJECT, {
      fields: ['id'],
      limit: ORGANIZATION_SCAN_LIMIT,
      context: scopedSystemCtx(),
    });
  } catch (e) {
    logger?.warn?.(
      '[security] could not enumerate organizations — audience-binding suggestions were NOT reconciled ' +
        'at this call; each organization still reconciles on its first list call (ADR-0090 D5/D9)',
      { object: ORGANIZATION_OBJECT, error: (e as Error)?.message },
    );
    return null;
  }
  const ids = (Array.isArray(rows) ? rows : [])
    .map((r: any) => r?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id !== '');
  if (ids.length >= ORGANIZATION_SCAN_LIMIT) {
    logger?.warn?.(
      '[security] organization scan hit its bound — organizations past it are reconciled lazily, ' +
        'on the first list call by each of their admins (ADR-0090 D5/D9)',
      { scanned: ids.length, limit: ORGANIZATION_SCAN_LIMIT },
    );
  }
  return ids;
}

/**
 * Delete every ORGANIZATION-LESS suggestion row, returning how many went.
 *
 * Under a walled posture an `organization_id`-less row on this object is
 * invalid state: the object declares the column with no tenancy opt-out and
 * ADR-0090 D5/D9 resolves a row when a TENANT admin confirms, so a row that
 * belongs to no organization carries a decision nobody can attribute — and,
 * through ADR-0120 D3's platform bucket, one that every tenant reads.
 *
 * **This is why the fix is a reap and not only a scope.** Measured: with one
 * pre-fix organization-less row present, a per-organization pass over two
 * organizations creates NOTHING for either (`{ created: 0 }` twice) — the row
 * is visible to both, so both see the key as already represented. Threading a
 * tenant without reaping leaves the defect exactly where it was.
 *
 * What the reap can and cannot restore, measured rather than assumed:
 *
 * - it never touches `sys_position_permission_set`, so NO grant changes and no
 *   principal gains or loses access;
 * - the immediately following passes regenerate each organization's row from
 *   the declaration — `confirmed` (observed) where that organization really
 *   holds the binding, `pending` where it does not;
 * - what cannot survive is a decision that was never attributable to an
 *   organization in the first place: an organization-less `dismissed` row, and
 *   `resolved_by`/`resolved_at` on an organization-less `confirmed` one. Those
 *   admins are prompted again, per organization — which is the repair, not a
 *   regression: one row cannot carry N tenants' decisions, and the shipped
 *   behaviour was that the FIRST tenant to answer answered for everyone.
 */
export async function reapOrganizationLessSuggestions(
  ql: any,
  logger?: SuggestionDeps['logger'],
): Promise<number> {
  // A bare (organization-less) system context is deliberate here and nowhere
  // else in this module: it is the only scope that can see rows belonging to
  // no organization, which is exactly the set being reaped.
  const orphans = await tryFind(ql, SUGGESTION_OBJECT, { organization_id: null }, 1000);
  let reaped = 0;
  for (const row of orphans) {
    if (!row?.id) continue;
    try {
      await ql.delete(SUGGESTION_OBJECT, { where: { id: row.id }, context: scopedSystemCtx() });
      reaped += 1;
    } catch { /* non-fatal — the next reconciliation retries */ }
  }
  if (reaped > 0) {
    logger?.warn?.(
      '[security] reaped organization-less audience-binding suggestion rows — they were readable by ' +
        'every tenant and carried one decision for all of them; each organization is reconciled its ' +
        'own row on the pass that follows (ADR-0090 D5/D9). No permission binding was touched.',
      { reaped },
    );
  }
  return reaped;
}

/**
 * Reconcile the WHOLE installation's suggestion surface — the entry point the
 * runtime calls at boot and after a package-door `permission` publish.
 *
 * `single` posture ⇒ one organization-less pass, byte for byte the pre-fix
 * behaviour. `group`/`isolated` ⇒ reap the invalid organization-less rows,
 * then one tenant-scoped pass per organization (or just the publishing
 * organization, when `scope.organizationId` names it).
 */
export async function reconcileAudienceBindingSuggestions(
  ql: any,
  metadata: any,
  logger: SuggestionDeps['logger'] | undefined,
  scope: SuggestionReconcileScope,
): Promise<SuggestionReconcileOutcome> {
  const out: SuggestionReconcileOutcome = {
    created: 0, confirmedObserved: 0, pruned: 0, organizations: 0, reaped: 0,
  };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;

  if (!postureEnforcesWall(scope.posture)) {
    const single = await syncAudienceBindingSuggestions(ql, metadata, logger);
    return { ...out, ...single };
  }

  out.reaped = await reapOrganizationLessSuggestions(ql, logger);

  const organizationIds = scope.organizationId
    ? [scope.organizationId]
    : await listSuggestionOrganizationIds(ql, logger);
  if (!organizationIds) return out; // enumeration failed — already warned

  for (const organizationId of organizationIds) {
    const one = await syncAudienceBindingSuggestions(ql, metadata, logger, organizationId);
    out.created += one.created;
    out.confirmedObserved += one.confirmedObserved;
    out.pruned += one.pruned;
    out.organizations += 1;
  }
  return out;
}

/**
 * Tenant-admin pre-gate shared by all three service methods. The anchors are
 * tenant-level only (ADR-0090 D12 — no delegated scope can touch them), so
 * the whole suggestion surface requires the ADR-0066 superuser wildcard.
 */
async function assertTenantAdmin(deps: SuggestionDeps, callerCtx: any, action: string): Promise<void> {
  if (callerCtx?.isSystem) return;
  if (!callerCtx?.userId) {
    throw new PermissionDeniedError(
      `[Security] Access denied: ${action} requires an authenticated tenant administrator (ADR-0090 D5/D12).`,
    );
  }
  let sets: PermissionSet[] = [];
  try { sets = await deps.resolveSets(callerCtx); } catch { sets = []; }
  if (!isTenantAdmin(sets)) {
    throw new PermissionDeniedError(
      `[Security] Access denied: ${action} requires a tenant-level administrator — ` +
        `audience anchors stay tenant-level only (ADR-0090 D12).`,
      { userId: callerCtx.userId },
    );
  }
}

/**
 * The organization a service call acts in — the caller's own active
 * organization (`ExecutionContext.tenantId`), never a scan over all of them.
 *
 * A `single`-posture caller carries none, which lands on the organization-less
 * surface that posture correctly has.
 */
function callerOrganizationId(callerCtx: any): string | undefined {
  const id = callerCtx?.tenantId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** List suggestions (tenant-admin only), reconciling first so a package
 *  installed a moment ago is already visible.
 *
 *  Both halves run in the CALLER's organization: the pre-gate already decided
 *  this caller is a tenant admin, and reconciling installation-wide from a
 *  tenant's list call is what let one tenant's read resolve — and mutate —
 *  another tenant's suggestion state. */
export async function listAudienceBindingSuggestions(
  deps: SuggestionDeps,
  callerCtx: any,
  filter: SuggestionListFilter = {},
): Promise<{ suggestions: any[]; synced: SuggestionSyncOutcome }> {
  await assertTenantAdmin(deps, callerCtx, 'listing audience-binding suggestions');
  const organizationId = callerOrganizationId(callerCtx);
  const synced = await syncAudienceBindingSuggestions(deps.ql, deps.metadata, deps.logger, organizationId);
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.packageId) where.package_id = filter.packageId;
  const suggestions = await tryFind(deps.ql, SUGGESTION_OBJECT, where, 1000, organizationId);
  return { suggestions, synced };
}

/**
 * Confirm a pending suggestion: create the anchor binding **as the caller**
 * (so the D5/D9 anchor gate and D12 delegated-admin gate run against the real
 * principal — this is the "admin confirms" moment of ADR-0090 D5), then mark
 * the row confirmed with the resolver's identity.
 */
export async function confirmAudienceBindingSuggestion(
  deps: SuggestionDeps,
  callerCtx: any,
  id: string,
): Promise<{ suggestion: any; bindingCreated: boolean }> {
  const { ql } = deps;
  await assertTenantAdmin(deps, callerCtx, 'confirming an audience-binding suggestion');
  const organizationId = callerOrganizationId(callerCtx);

  const row = (await tryFind(ql, SUGGESTION_OBJECT, { id }, 1, organizationId))[0];
  if (!row) throw new SuggestionNotFoundError(id);
  if (row.status !== 'pending') {
    throw new SuggestionStateError(
      `Audience-binding suggestion '${id}' is already ${row.status} — only pending suggestions can be confirmed.`,
    );
  }

  const anchorRow = (await tryFind(ql, 'sys_position', { name: row.anchor }, 1, organizationId))[0];
  if (!anchorRow?.id) {
    throw new SuggestionStateError(
      `The '${row.anchor}' audience anchor position is not seeded yet — cannot bind.`,
    );
  }

  // Resolve — or, for a package installed this session, materialize — the set
  // row. Materialization goes through the SAME provenance-checked upsert as
  // the boot seeder and the publish materializer (ADR-0086 D4), so a foreign-
  // or env-owned name is refused, never clobbered.
  let setRow = (await tryFind(ql, 'sys_permission_set', { name: row.permission_set_name }, 1, organizationId))[0] ?? null;
  if (!setRow) {
    const declared = collectDeclaredSuggestions(ql, deps.metadata).find(
      (d) => d.packageId === row.package_id && d.set.name === row.permission_set_name && d.anchor === row.anchor,
    );
    if (declared) {
      const seedLogger = {
        info: (m: string, meta?: Record<string, any>) => deps.logger?.info?.(m, meta),
        warn: (m: string, meta?: Record<string, any>) => deps.logger?.warn?.(m, meta),
      };
      await upsertPackagePermissionSet(ql, declared.set, row.package_id, seedLogger);
      setRow = (await tryFind(ql, 'sys_permission_set', { name: row.permission_set_name }, 1, organizationId))[0] ?? null;
    }
  }
  if (!setRow?.id) {
    throw new SuggestionStateError(
      `Permission set '${row.permission_set_name}' is not materialized in sys_permission_set — ` +
        `is package '${row.package_id}' still installed?`,
    );
  }
  if (setRow.package_id && setRow.package_id !== row.package_id) {
    throw new SuggestionStateError(
      `Permission set '${row.permission_set_name}' is owned by package '${setRow.package_id}', ` +
        `not the suggesting package '${row.package_id}' — refusing to bind (ADR-0086 D4).`,
    );
  }

  // Early, friendly rendition of the anchor gate so the caller gets the
  // decision without a write attempt; the engine middleware re-enforces it
  // unconditionally on the insert below.
  const offending = describeAnchorForbiddenBits(setRow, row.anchor as 'everyone' | 'guest');
  if (offending) {
    throw new PermissionDeniedError(
      `[Security] Access denied: permission set '${row.permission_set_name}' cannot be bound to the ` +
        `'${row.anchor}' audience anchor — it carries ${offending} (ADR-0090 D5/D9).`,
      { suggestion: id, anchor: row.anchor },
    );
  }

  let bindingCreated = false;
  if (!(await bindingExists(ql, anchorRow, setRow, organizationId))) {
    // The caller's context — NOT isSystem — so the audience-anchor gate and
    // the delegated-admin gate evaluate the real principal.
    await ql.insert('sys_position_permission_set', {
      id: genId('pps'),
      position_id: anchorRow.id,
      permission_set_id: setRow.id,
    }, { context: callerCtx });
    bindingCreated = true;
  }

  await ql.update(SUGGESTION_OBJECT, {
    id: row.id,
    status: 'confirmed',
    resolved_by: callerCtx?.userId ?? null,
    resolved_at: new Date().toISOString(),
  }, { context: scopedSystemCtx(organizationId) });

  deps.logger?.info?.('[security] audience-binding suggestion confirmed (ADR-0090 D5)', {
    id: row.id, package: row.package_id, set: row.permission_set_name, anchor: row.anchor,
    by: callerCtx?.userId, organization: organizationId, bindingCreated,
  });
  const updated = (await tryFind(ql, SUGGESTION_OBJECT, { id: row.id }, 1, organizationId))[0] ?? row;
  return { suggestion: updated, bindingCreated };
}

/** Dismiss a pending suggestion (tenant-admin only). The set stays available
 *  for ordinary position binding — dismissal only retires the prompt. */
export async function dismissAudienceBindingSuggestion(
  deps: SuggestionDeps,
  callerCtx: any,
  id: string,
): Promise<{ suggestion: any }> {
  const { ql } = deps;
  await assertTenantAdmin(deps, callerCtx, 'dismissing an audience-binding suggestion');
  const organizationId = callerOrganizationId(callerCtx);

  const row = (await tryFind(ql, SUGGESTION_OBJECT, { id }, 1, organizationId))[0];
  if (!row) throw new SuggestionNotFoundError(id);
  if (row.status !== 'pending') {
    throw new SuggestionStateError(
      `Audience-binding suggestion '${id}' is already ${row.status} — only pending suggestions can be dismissed.`,
    );
  }

  await ql.update(SUGGESTION_OBJECT, {
    id: row.id,
    status: 'dismissed',
    resolved_by: callerCtx?.userId ?? null,
    resolved_at: new Date().toISOString(),
  }, { context: scopedSystemCtx(organizationId) });

  deps.logger?.info?.('[security] audience-binding suggestion dismissed (ADR-0090 D5)', {
    id: row.id, package: row.package_id, set: row.permission_set_name,
    by: callerCtx?.userId, organization: organizationId,
  });
  const updated = (await tryFind(ql, SUGGESTION_OBJECT, { id: row.id }, 1, organizationId))[0] ?? row;
  return { suggestion: updated };
}
