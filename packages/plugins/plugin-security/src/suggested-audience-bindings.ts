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
 */

import type { PermissionSet } from '@objectstack/spec/security';
import { describeAnchorForbiddenBits } from '@objectstack/spec/security';
import { EVERYONE_POSITION, AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec';
import { PermissionDeniedError } from './errors.js';
import { readDeclared, upsertPackagePermissionSet } from './bootstrap-declared-permissions.js';
import { isTenantAdmin } from './delegated-admin-gate.js';

const SYSTEM_CTX = { isSystem: true };
const SUGGESTION_OBJECT = 'sys_audience_binding_suggestion';

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
async function tryFind(ql: any, object: string, where: any, limit = 500): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit, context: SYSTEM_CTX });
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

/** Resolve the anchor position rows by name → `{ everyone: row?, guest: row? }`. */
async function findAnchorPositions(ql: any): Promise<Record<string, any>> {
  const anchors: Record<string, any> = {};
  for (const name of AUDIENCE_ANCHOR_POSITIONS) {
    anchors[name] = (await tryFind(ql, 'sys_position', { name }, 1))[0] ?? null;
  }
  return anchors;
}

/** True when the set is already bound to the anchor (rows resolved by name). */
async function bindingExists(ql: any, anchorRow: any, setRow: any): Promise<boolean> {
  if (!anchorRow?.id || !setRow?.id) return false;
  const rows = await tryFind(ql, 'sys_position_permission_set', {
    position_id: anchorRow.id,
    permission_set_id: setRow.id,
  }, 1);
  return rows.length > 0;
}

/**
 * Reconcile `sys_audience_binding_suggestion` against the current
 * declarations. Idempotent; system-context; never touches confirmed or
 * dismissed rows except to prune nothing (they are audit history).
 */
export async function syncAudienceBindingSuggestions(
  ql: any,
  metadata?: any,
  logger?: SuggestionDeps['logger'],
): Promise<SuggestionSyncOutcome> {
  const out: SuggestionSyncOutcome = { created: 0, confirmedObserved: 0, pruned: 0 };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;

  const declared = collectDeclaredSuggestions(ql, metadata);
  const declaredKeys = new Set(declared.map((d) => suggestionKey(d.packageId, d.set.name, d.anchor)));

  const anchors = await findAnchorPositions(ql);
  const existing = await tryFind(ql, SUGGESTION_OBJECT, {}, 1000);
  const byKey = new Map<string, any>(
    existing.map((row) => [suggestionKey(row.package_id, row.permission_set_name, row.anchor), row]),
  );

  for (const d of declared) {
    const key = suggestionKey(d.packageId, d.set.name, d.anchor);
    const row = byKey.get(key);
    const setRow = (await tryFind(ql, 'sys_permission_set', { name: d.set.name }, 1))[0] ?? null;
    const bound = await bindingExists(ql, anchors[d.anchor], setRow);

    if (row) {
      if (row.status === 'pending' && bound) {
        // Bound outside the prompt (boot baseline, admin by hand) — record the
        // observation so the surface never nags about a satisfied suggestion.
        try {
          await ql.update(SUGGESTION_OBJECT, {
            id: row.id, status: 'confirmed', resolved_at: new Date().toISOString(),
          }, { context: SYSTEM_CTX });
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
      }, { context: SYSTEM_CTX });
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
      await ql.delete(SUGGESTION_OBJECT, { where: { id: row.id }, context: SYSTEM_CTX });
      out.pruned += 1;
    } catch { /* non-fatal */ }
  }

  if (out.created + out.confirmedObserved + out.pruned > 0) {
    logger?.info?.('[security] audience-binding suggestions reconciled (ADR-0090 D5/D9)', { ...out });
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

/** List suggestions (tenant-admin only), reconciling first so a package
 *  installed a moment ago is already visible. */
export async function listAudienceBindingSuggestions(
  deps: SuggestionDeps,
  callerCtx: any,
  filter: SuggestionListFilter = {},
): Promise<{ suggestions: any[]; synced: SuggestionSyncOutcome }> {
  await assertTenantAdmin(deps, callerCtx, 'listing audience-binding suggestions');
  const synced = await syncAudienceBindingSuggestions(deps.ql, deps.metadata, deps.logger);
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.packageId) where.package_id = filter.packageId;
  const suggestions = await tryFind(deps.ql, SUGGESTION_OBJECT, where, 1000);
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

  const row = (await tryFind(ql, SUGGESTION_OBJECT, { id }, 1))[0];
  if (!row) throw new SuggestionNotFoundError(id);
  if (row.status !== 'pending') {
    throw new SuggestionStateError(
      `Audience-binding suggestion '${id}' is already ${row.status} — only pending suggestions can be confirmed.`,
    );
  }

  const anchorRow = (await tryFind(ql, 'sys_position', { name: row.anchor }, 1))[0];
  if (!anchorRow?.id) {
    throw new SuggestionStateError(
      `The '${row.anchor}' audience anchor position is not seeded yet — cannot bind.`,
    );
  }

  // Resolve — or, for a package installed this session, materialize — the set
  // row. Materialization goes through the SAME provenance-checked upsert as
  // the boot seeder and the publish materializer (ADR-0086 D4), so a foreign-
  // or env-owned name is refused, never clobbered.
  let setRow = (await tryFind(ql, 'sys_permission_set', { name: row.permission_set_name }, 1))[0] ?? null;
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
      setRow = (await tryFind(ql, 'sys_permission_set', { name: row.permission_set_name }, 1))[0] ?? null;
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
  if (!(await bindingExists(ql, anchorRow, setRow))) {
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
  }, { context: SYSTEM_CTX });

  deps.logger?.info?.('[security] audience-binding suggestion confirmed (ADR-0090 D5)', {
    id: row.id, package: row.package_id, set: row.permission_set_name, anchor: row.anchor,
    by: callerCtx?.userId, bindingCreated,
  });
  const updated = (await tryFind(ql, SUGGESTION_OBJECT, { id: row.id }, 1))[0] ?? row;
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

  const row = (await tryFind(ql, SUGGESTION_OBJECT, { id }, 1))[0];
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
  }, { context: SYSTEM_CTX });

  deps.logger?.info?.('[security] audience-binding suggestion dismissed (ADR-0090 D5)', {
    id: row.id, package: row.package_id, set: row.permission_set_name, by: callerCtx?.userId,
  });
  const updated = (await tryFind(ql, SUGGESTION_OBJECT, { id: row.id }, 1))[0] ?? row;
  return { suggestion: updated };
}
