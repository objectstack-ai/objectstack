// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "declared ≠ enforced" surfacing for package-declared `sys_permission_set`
 * rows (field report: rc→GA upgraded envs freeze a package's permission set
 * at a first-boot/overlay snapshot while the shipped artifact keeps moving —
 * grants stay frozen for weeks, silently, and the only signal was a boot log
 * counter).
 *
 * TWO INDEPENDENT MECHANISMS can make a package-declared set's ENFORCED
 * grants (what `sys_permission_set` actually stores, and what the evaluator
 * resolves) diverge from its shipped ARTIFACT (what `readDeclared` reads from
 * the engine's SchemaRegistry, the same source `bootstrapDeclaredPermissions`
 * seeds from) — and neither may be assumed to be the only one live on a given
 * environment:
 *
 *  - **`overlay_shadow`** — an active `sys_metadata` overlay row exists for
 *    the set's name (a Studio permission-matrix save materialized one, back
 *    when `permission` still allowed org overrides, or through the
 *    `OS_METADATA_WRITABLE` hatch since). `reconcilePermissionSetProjection`
 *    re-projects that overlay's content onto the record on EVERY boot
 *    (ADR-0094 D4 step 1, unconditionally, keyed only on overlay presence),
 *    so the overlay wins forever regardless of what the package ships next.
 *  - **`provenance_skip`** — the row's `managed_by` is not `'package'` (a
 *    legacy/pre-provenance insert — see `bootstrap-declared-permissions.ts`),
 *    so `upsertPackagePermissionSet`'s package door refuses to touch it
 *    (`skippedEnvAuthored`) on every boot, forever.
 *
 * ⚠️ THE TWO MECHANISMS CONFOUND EACH OTHER. When BOTH are present on one row
 * — the exact field-report shape — `upsertEnvPermissionSet`'s `customized`
 * flag (`existing.managed_by === 'package' ? !!customized : false`) is
 * FORCED FALSE, because the row's `managed_by` is wrong (provenance_skip),
 * even though an overlay genuinely IS shadowing it. That is measurably why
 * `customized` stayed `0` on the field-reported environment — the ADR-0094
 * surface an admin would check said "not customized" while an overlay had
 * frozen the set for two weeks. So detection here does NOT trust
 * `managed_by` to decide whether an overlay is shadowing a row — overlay
 * presence is checked directly against `sys_metadata`, independent of the
 * row's (possibly wrong) provenance column, exactly so this confounded case
 * is still attributed correctly (`overlay_shadow`, not silently missed).
 *
 * WHAT THIS MODULE DOES NOT DO: it never guesses which mechanism explains a
 * mismatch — it re-derives the fact each boot from the current `sys_metadata`
 * / `sys_permission_set` state, the same sources the two write-doors read.
 * It also never adopts/migrates a row (out of scope by 2026-08-20 maintainer
 * ruling — "新项目还没上线，不需要清理旧数据，也没有老客户升级"; the
 * `sanctioned discard` counterpart lives in `permission-set-overlay-discard.ts`
 * and only ever touches the `sys_metadata` overlay row, never `managed_by` /
 * `package_id`).
 *
 * ⚠️ Scope note shared with `reconcilePermissionSetProjection`: only
 * ENV-WIDE overlays (`sys_metadata.organization_id IS NULL`) are considered
 * — the per-organization overlay residue the projection file's header already
 * documents as deliberately out of scope (#10103) stays out of scope here
 * too, for the same reason (this module answers the identical "is there an
 * overlay" question the reconciler already answers, from the same rows).
 */

import {
  recordDiffersFromBody,
  tryFind,
  tryUpdate,
  type ProjectionLogger,
} from './permission-set-projection.js';
import { readDeclared } from './bootstrap-declared-permissions.js';
import { buildExistingByName } from './seed-name-lookup.js';

/**
 * Cause a package-declared set's enforced grants can diverge from its shipped
 * artifact. `in_sync` and `other` are internal/testing values only —
 * {@link persistPermissionSetDriftDiagnostics} writes `null` for `in_sync`
 * (pin: an in-sync set must not be surfaced at all, not even as a quiet
 * "ok" badge) and keeps `other` as a truthful catch-all for the one case
 * neither named mechanism explains (a package-owned row whose own boot-seed
 * write failed — `unreadable` — so its content is stale for a reason that is
 * neither an overlay nor a provenance skip).
 */
export type PermissionSetDriftStatus = 'in_sync' | 'overlay_shadow' | 'provenance_skip' | 'other';

export interface PermissionSetDriftDiagnostic {
  id: string;
  name: string;
  packageId: string;
  status: PermissionSetDriftStatus;
  /** Human-readable detail naming the grant-count mismatch and the cause. `null` when in sync. */
  detail: string | null;
  /** The row's stored `drift_status` before this pass (already normalized: `'in_sync'` read back as `null`). */
  priorStatus: string | null;
  priorDetail: string | null;
}

export interface DriftDiagnosticsOptions {
  logger?: ProjectionLogger;
  organizationId?: string;
}

function countGrantedObjects(objects: any): number {
  return objects && typeof objects === 'object' ? Object.keys(objects).length : 0;
}

/** True when `row` carries an ACTIVE env-wide `sys_metadata` overlay for `name` (independent of `managed_by`). */
function buildOverlayNameSet(rows: any[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if ((r?.organization_id ?? null) !== null || !r?.name) continue; // env-wide overlays only — see module header
    out.add(String(r.name));
  }
  return out;
}

/**
 * Compute (never write) the drift diagnostic for every currently package-
 * declared permission set. Pure function over the passed `ql` — a boot pass
 * and a test both call this the same way; {@link persistPermissionSetDriftDiagnostics}
 * is the only thing that writes.
 */
export async function computePermissionSetDriftDiagnostics(
  ql: any,
  opts: DriftDiagnosticsOptions = {},
): Promise<PermissionSetDriftDiagnostic[]> {
  const out: PermissionSetDriftDiagnostic[] = [];
  if (!ql || typeof ql.find !== 'function') return out;

  const declared = readDeclared(ql, 'permission').filter((ps) => ps?.name && (ps._packageId ?? ps.packageId));
  if (declared.length === 0) return out;

  const organizationId = opts.organizationId;
  const existingByName = await buildExistingByName(
    ql,
    'sys_permission_set',
    declared.map((ps) => ps.name),
    opts.logger,
    organizationId,
  );

  // Same bulk overlay read `reconcilePermissionSetProjection` performs (ADR-0094
  // D4 step 1) — both `permission` and its legacy plural spelling.
  const overlayRows: any[] = [];
  for (const type of ['permission', 'permissions']) {
    overlayRows.push(...(await tryFind(ql, 'sys_metadata', { type, state: 'active' }, 1000)));
  }
  const overlayNames = buildOverlayNameSet(overlayRows);

  for (const ps of declared) {
    const name = String(ps.name);
    const packageId = String(ps._packageId ?? ps.packageId);
    const lookup = await existingByName.get(name);
    if (lookup.status !== 'present') continue; // not yet materialized — nothing to diagnose (boot seeding creates it)
    const row = lookup.row;
    const priorStatus: string | null = row?.drift_status ?? null;
    const priorDetail: string | null = row?.drift_detail ?? null;

    const differs = recordDiffersFromBody(row, ps);
    if (!differs) {
      out.push({ id: row.id, name, packageId, status: 'in_sync', detail: null, priorStatus, priorDetail });
      continue;
    }

    const declaredCount = countGrantedObjects(ps.objects);
    const enforcedCount = countGrantedObjects(
      (() => { try { return JSON.parse(row.object_permissions ?? '{}'); } catch { return {}; } })(),
    );
    const hasOverlay = overlayNames.has(name);

    let status: PermissionSetDriftStatus;
    let detail: string;
    if (hasOverlay) {
      status = 'overlay_shadow';
      detail =
        `An environment customization overlay (sys_metadata, type:'permission', name:'${name}') is shadowing ` +
        `this package-declared set — enforced grants (${enforcedCount} object(s)) come from the overlay, not ` +
        `the shipped artifact (${declaredCount} object(s)). Discard the overlay (Discard Overlay action) to resync.`;
    } else if (row.managed_by !== 'package') {
      status = 'provenance_skip';
      detail =
        `This row's managed_by ('${row.managed_by ?? 'none'}') predates package provenance tracking, so boot ` +
        `sync treats it as environment-authored and never reconciles it with the package — enforced grants ` +
        `(${enforcedCount} object(s)) are frozen at an old snapshot vs. the shipped artifact's ` +
        `${declaredCount} object(s).`;
    } else {
      status = 'other';
      detail =
        `Enforced grants (${enforcedCount} object(s)) differ from the shipped artifact (${declaredCount} ` +
        `object(s)) for a reason that is neither an overlay nor a provenance skip — check boot logs for ` +
        `'[security] declared permission sets left untouched'.`;
    }
    out.push({ id: row.id, name, packageId, status, detail, priorStatus, priorDetail });
  }
  return out;
}

/**
 * Write the computed diagnostics onto their `sys_permission_set` rows.
 * EQUALITY-GATED (#10946 discipline): a row whose stored `drift_status` /
 * `drift_detail` already match is left untouched — a steady-state boot pays
 * zero writes, matching the round-trip contract every other pass in this file
 * keeps.
 *
 * `in_sync` is written as `null` — the "not surfaced" pin is a data-level
 * fact, not merely a filtered view: a quiet set carries no `drift_status`
 * value at all, so a client reading the raw record (not only the Setup
 * "Needs Attention" view) sees nothing to worry about either.
 */
export async function persistPermissionSetDriftDiagnostics(
  ql: any,
  diagnostics: readonly PermissionSetDriftDiagnostic[],
  opts: DriftDiagnosticsOptions = {},
): Promise<{ updated: number }> {
  let updated = 0;
  for (const d of diagnostics) {
    const status: string | null = d.status === 'in_sync' ? null : d.status;
    const detail: string | null = d.status === 'in_sync' ? null : d.detail;
    if (d.priorStatus === status && d.priorDetail === detail) continue;
    if (await tryUpdate(ql, 'sys_permission_set', { id: d.id, drift_status: status, drift_detail: detail }, opts.organizationId)) {
      updated += 1;
    }
  }
  return { updated };
}

/** Compute + persist in one call — what boot wiring uses. */
export async function runPermissionSetDriftDiagnostics(
  ql: any,
  opts: DriftDiagnosticsOptions = {},
): Promise<{ diagnostics: PermissionSetDriftDiagnostic[]; updated: number }> {
  const diagnostics = await computePermissionSetDriftDiagnostics(ql, opts);
  const { updated } = await persistPermissionSetDriftDiagnostics(ql, diagnostics, opts);
  if (updated > 0) {
    opts.logger?.warn?.(
      '[security] package-declared permission set(s) enforcing grants that differ from the shipped artifact',
      {
        updated,
        drifted: diagnostics.filter((d) => d.status !== 'in_sync').map((d) => ({ name: d.name, status: d.status })),
        ...(opts.organizationId ? { organization: opts.organizationId } : {}),
      },
    );
  }
  return { diagnostics, updated };
}
