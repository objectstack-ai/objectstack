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
import {
  createSeedWriteRefusals,
  logSeedDurabilityFailure,
} from './per-organization-catalog.js';
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
 * Report, ONCE per pass, the drift-diagnostic writes the store refused.
 *
 * ## Why this is not {@link reportSeedWriteRefusals}
 *
 * The shared ACCUMULATOR (`createSeedWriteRefusals`) is reused as-is — it
 * carries the shipped `isUniqueViolationError` classification and the
 * value-free `code`/`errno` channel, and re-deriving either here is exactly
 * the local-regex defect that module was written to retire. The shared
 * REPORTER is not, and deliberately: every sentence it prints is about
 * seeding the RBAC catalog — "the catalog is INCOMPLETE", "this pass's
 * 'seeded' count", and a remedy naming the legacy PLATFORM-WIDE unique index
 * on the catalog name column. None of that is true here. This pass seeds
 * nothing; it writes two diagnostic columns onto rows that already exist, by
 * id. Printing that text over this failure would send an operator to
 * `os migrate` for a defect that is not there — the same "a confident wrong
 * answer is worse than no answer" reasoning that makes `other` its own class
 * in `reportSeedWriteRefusals` rather than a relabelled unique violation.
 *
 * ## Why ONE line and not one per class
 *
 * `reportSeedWriteRefusals` splits its classes because their REMEDIES differ.
 * Here they do not: an update-by-id of two nullable diagnostic columns has no
 * unique constraint to violate, so the class is a fact for `meta` (it travels
 * there, per (object, class), with the driver codes) and not a reason to print
 * a second sentence.
 *
 * ## Why the durability channel
 *
 * AGENTS.md "Degradation log levels", one question — after the degradation,
 * does the system still look normal while something it claims is persisted
 * has not landed? Yes, precisely: `drift_status` / `drift_detail` are what
 * Setup's "Needs Attention" surface reads, so a refused write leaves that
 * screen showing a CLEAN environment over sets that are still drifted.
 * ⚠️ `check:durability-log-level` does not vouch for this choice — `ql.update`
 * is not in its `DURABILITY_CRITICAL_CALLEES` vocabulary, so its green here
 * means the site is outside the gate's reach (NOT MEASURED), never approval.
 */
function reportDriftWriteRefusals(
  logger: ProjectionLogger | undefined,
  refusals: ReturnType<typeof createSeedWriteRefusals>,
  organizationId?: string,
): void {
  const entries = refusals.report();
  if (entries.length === 0) return;
  logSeedDurabilityFailure(
    logger,
    `[security] ${refusals.total} package-declared permission set drift diagnostic(s) were REFUSED by the ` +
      `store — the "declared ≠ enforced" verdict this pass computed did NOT persist, so those rows keep ` +
      `their PREVIOUS drift_status/drift_detail (usually none at all), Setup's "Needs Attention" surface goes ` +
      `on showing them as CLEAN, and THE DEPLOYMENT WILL GO ON LOOKING HEALTHY while those sets keep ` +
      `enforcing grants that differ from the shipped artifact. The drifted set NAMES are not lost with the ` +
      `write: the "[security] package-declared permission set(s) enforcing grants that differ from the ` +
      `shipped artifact" line is logged alongside this one and names every one of them — it is no longer ` +
      `gated behind the count of writes that landed. What the store actually said is in the query engine's ` +
      `"Update operation failed" entries logged just before this one, which keep the driver's own identifier ` +
      `with the bound statement and its values cut. Remedy: read those entries — a sys_permission_set ` +
      `missing its drift_status/drift_detail columns is a deployment SCHEMA defect, reported by ` +
      `"os migrate plan" and fixed by "os migrate apply"; anything else is a store outage, which this pass ` +
      `re-computes and re-attempts on the next boot. Either way nothing is lost, and nothing is recorded ` +
      `either until a write lands.`,
    {
      refused: refusals.total,
      refusals: entries,
      ...(organizationId ? { organization: organizationId } : {}),
    },
  );
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
 *
 * Answers `refused` alongside `updated`. ⚠️ They are not two spellings of the
 * same pass: `updated` counts the verdicts that LANDED and `refused` counts
 * the ones the store rejected, and a caller asking "was there drift?" while
 * reading only `updated` reads a wholly refused pass as a clean one — the
 * defect {@link reportDriftWriteRefusals} and the gate in
 * {@link runPermissionSetDriftDiagnostics} exist to close.
 */
export async function persistPermissionSetDriftDiagnostics(
  ql: any,
  diagnostics: readonly PermissionSetDriftDiagnostic[],
  opts: DriftDiagnosticsOptions = {},
): Promise<{ updated: number; refused: number }> {
  // ⛔ The refusal LOG is what makes a refused write distinguishable from
  // "nothing to write". `tryUpdate` answers `false` for both, and this
  // function's only output used to be a count of the writes that LANDED — so
  // a pass whose every write was refused returned `{ updated: 0 }`, which is
  // byte-identical to the steady-state boot the equality gate above is built
  // to produce. See the report below for what that silence cost.
  const refusals = createSeedWriteRefusals();
  let updated = 0;
  for (const d of diagnostics) {
    const status: string | null = d.status === 'in_sync' ? null : d.status;
    const detail: string | null = d.status === 'in_sync' ? null : d.detail;
    if (d.priorStatus === status && d.priorDetail === detail) continue;
    if (await tryUpdate(ql, 'sys_permission_set', { id: d.id, drift_status: status, drift_detail: detail }, opts.organizationId, refusals)) {
      updated += 1;
    }
  }
  reportDriftWriteRefusals(opts.logger, refusals, opts.organizationId);
  return { updated, refused: refusals.total };
}

/** Compute + persist in one call — what boot wiring uses. */
export async function runPermissionSetDriftDiagnostics(
  ql: any,
  opts: DriftDiagnosticsOptions = {},
): Promise<{ diagnostics: PermissionSetDriftDiagnostic[]; updated: number; refused: number }> {
  const diagnostics = await computePermissionSetDriftDiagnostics(ql, opts);
  const { updated, refused } = await persistPermissionSetDriftDiagnostics(ql, diagnostics, opts);
  // ⛔ `updated > 0` ALONE was the suppressor. A boot on which every drift
  // write is refused computes the drift correctly, persists none of it, and —
  // under the old gate — printed nothing at all, which is byte-identical to a
  // deployment with no drift. `refused > 0` re-opens exactly that case and
  // nothing else: a steady-state boot (equality-gated, nothing to write,
  // nothing refused) stays as quiet as it was.
  if (updated > 0 || refused > 0) {
    opts.logger?.warn?.(
      '[security] package-declared permission set(s) enforcing grants that differ from the shipped artifact',
      {
        updated,
        // Present ONLY when non-zero, so the steady-state line is unchanged
        // byte-for-byte for anything reading it. Read it together with
        // `updated`: `updated` counts the verdicts that LANDED, never the
        // verdicts that were reached.
        ...(refused > 0 ? { refused } : {}),
        drifted: diagnostics.filter((d) => d.status !== 'in_sync').map((d) => ({ name: d.name, status: d.status })),
        ...(opts.organizationId ? { organization: opts.organizationId } : {}),
      },
    );
  }
  return { diagnostics, updated, refused };
}
