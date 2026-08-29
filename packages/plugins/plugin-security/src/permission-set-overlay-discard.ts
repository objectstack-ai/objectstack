// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sanctioned, audited operator action: discard a stale `sys_metadata`
 * overlay shadowing a PACKAGE-DECLARED `sys_permission_set` (the
 * `overlay_shadow` mechanism {@link ../permission-set-drift.ts} detects).
 *
 * Field report: the only remediation available was raw SQL against
 * `sys_metadata` (`DELETE … WHERE type='permission' AND name='…'`), run by
 * hand against production. This module is that same operation — the SAME
 * physical row, the SAME table — as a supported, gated, audited code path
 * instead. Maintainer ruling 2026-08-20 (「新项目还没上线，不需要清理旧数据，
 * 也没有老客户升级」) scoped this DELIBERATELY NARROWLY: this is an
 * operator-invoked, one-set-at-a-time, explicit mutation — never boot-time
 * auto-adoption and never a bulk `os meta adopt-permission-sets` command
 * (both stay out of scope). It never touches `managed_by` / `package_id`:
 * once the overlay is gone, the EXISTING env-door reconciler
 * (`reconcilePermissionSetProjection` step 2/3, ADR-0094 D4) keeps the row in
 * sync with the artifact on every subsequent boot, on its own — no adoption
 * needed for grant CONTENT to stay current, only for the row's provenance
 * columns (out of scope, unaffected by this action).
 *
 * ## Why this bypasses `deleteMetaItem`, not calls it
 *
 * `permission` is `allowOrgOverride: false` since #6483/#6608 (ADR-0094
 * D5-R), so the protocol's ADR-0005 tier gate refuses `deleteMetaItem` on an
 * artifact-backed name with 403 `NOT_OVERRIDABLE` — see
 * `permission-set-projection.ts`'s header, "leaving the operator hatch
 * (`OS_METADATA_WRITABLE=permission`) as the only documented removal." That
 * hatch is a blunt, environment-wide, undocumented-to-Setup escape valve —
 * exactly what ask #2 exists to replace. This module deletes the
 * `sys_metadata` overlay row DIRECTLY (SYSTEM context), never through
 * `deleteMetaItem`, because the tier gate's refusal is correct in general
 * (a data-door write must not silently re-fork a packaged set) and the
 * discard action is a DIFFERENT, narrower operation the gate has no seat for:
 * "remove a stale overlay and let the row re-converge to its declared
 * artifact", never "write a new customization".
 *
 * ## Eligibility — pin: refuses what it must
 *
 * "Package-declared" is decided by asking the SAME source
 * `bootstrapDeclaredPermissions` reads — `readDeclared(ql, 'permission')` —
 * for an item whose `name` matches AND carries a resolvable owning package
 * (`_packageId ?? packageId`), never by trusting the row's `managed_by`
 * column. This is deliberate: `managed_by` is exactly the column the
 * `provenance_skip` mechanism gets wrong, so gating on it would refuse the
 * one case this action most needs to fix (a genuinely package-declared set
 * whose row's `managed_by` was never 'package' to begin with — the
 * field-reported shape, where BOTH mechanisms compounded on one row). A name
 * with no current package declaration is treated as genuinely
 * environment-authored and refused — the maintainer's cited hazard verbatim:
 * "a name collision with a genuinely env-authored set would be destroyed
 * without a trace".
 *
 * ## The audit entry may never be optimistic
 *
 * This action's whole point is that it is AUDITED, so the one thing its log
 * entry may not do is assert an action that did not fully land. The
 * degraded-kernel branch below discarded its `tryUpdate` result, and on a
 * refused resync every field of the success entry stayed individually true —
 * the overlay count was right, `objectGrantsBefore`/`objectGrantsAfter` were
 * both read off real rows — while the entry as a whole claimed a completed
 * sanctioned operator action over a write the store had rejected. The result
 * is now read, and a refused resync gets its own entry stating the failure
 * INSTEAD of the success line (never alongside it): the overlay deletion DID
 * land and must stay on the record, and the un-healed grant count must stop
 * being reported as a healed one. What the CALLER is told is deliberately
 * unchanged — see {@link PermissionSetOverlayDiscardResult}.
 */

import type { PermissionSet } from '@objectstack/spec/security';
import {
  SYSTEM_CTX,
  permissionSetRowFields,
  projectPermissionMutation,
  tryFind,
  tryUpdate,
  type ProjectionDeps,
  type ProjectionLogger,
} from './permission-set-projection.js';
import {
  createSeedWriteRefusals,
  logSeedDurabilityFailure,
} from './per-organization-catalog.js';
import { readDeclared } from './bootstrap-declared-permissions.js';
import { PermissionDeniedError } from './errors.js';
import { isTenantAdmin } from './delegated-admin-gate.js';

/** Thrown when the referenced `sys_permission_set` row does not exist → HTTP 404. */
export class PermissionSetNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Permission set '${id}' not found`);
    this.name = 'PermissionSetNotFoundError';
  }
}

/** Thrown when there is no active overlay to discard → HTTP 409. */
export class PermissionSetOverlayStateError extends Error {
  readonly code = 'INVALID_STATE';
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'PermissionSetOverlayStateError';
  }
}

export interface PermissionSetOverlayDiscardDeps {
  ql: any;
  metadata?: any;
  /** Same tenant-admin resolution the confirm/dismiss suggestion flow uses. */
  resolveSets: (context: any) => Promise<PermissionSet[]>;
  /** Lazy protocol handle — mirrors `WriteThroughDeps.getProtocol` (the protocol service may register after start()). */
  getProtocol: () => any;
  logger?: ProjectionLogger;
}

export interface PermissionSetOverlayDiscardResult {
  permissionSet: any;
  /**
   * Object grants the row now carries (post-reconcile) — the "healed" number,
   * for callers to assert on.
   *
   * ⚠️ Literally "what the row carries NOW", which is not always a healed
   * count: on the degraded-kernel branch a REFUSED resync write leaves this
   * equal to the pre-discard count. That case is reported on the audit
   * channel (an entry naming the refusal replaces the success line) and
   * deliberately NOT on this contract — propagating it to the caller would
   * widen a declared surface and is out of scope here.
   */
  healedObjectGrantCount: number;
  overlaysDiscarded: number;
}

function callerOrganizationId(callerCtx: any): string | undefined {
  const id = callerCtx?.tenantId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

async function assertTenantAdmin(deps: PermissionSetOverlayDiscardDeps, callerCtx: any): Promise<void> {
  if (callerCtx?.isSystem) return;
  if (!callerCtx?.userId) {
    throw new PermissionDeniedError(
      "[Security] Access denied: discarding a permission set's overlay requires an authenticated tenant administrator.",
    );
  }
  let sets: PermissionSet[] = [];
  try { sets = await deps.resolveSets(callerCtx); } catch { sets = []; }
  if (!isTenantAdmin(sets)) {
    throw new PermissionDeniedError(
      "[Security] Access denied: discarding a permission set's overlay requires a tenant-level administrator.",
      { userId: callerCtx.userId },
    );
  }
}

/** Every ACTIVE env-wide `sys_metadata` overlay row for `name` (both `permission`/`permissions` type spellings). */
async function findActiveOverlayRows(ql: any, name: string): Promise<any[]> {
  const rows: any[] = [];
  for (const type of ['permission', 'permissions']) {
    const page = await tryFind(ql, 'sys_metadata', { type, name, state: 'active' }, 10);
    for (const r of page) {
      if ((r?.organization_id ?? null) !== null) continue; // env-wide overlays only (see permission-set-drift.ts)
      rows.push(r);
    }
  }
  return rows;
}

function countGrantedObjects(row: any): number {
  try {
    const parsed = JSON.parse(row?.object_permissions ?? '{}');
    return parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0;
  } catch { return 0; }
}

/**
 * Discard the stale overlay shadowing a package-declared permission set,
 * then RESTORE SYNC synchronously — the row is re-projected to the current
 * declared artifact before this returns (never "wait for the next boot").
 */
export async function discardPermissionSetOverlay(
  deps: PermissionSetOverlayDiscardDeps,
  callerCtx: any,
  id: string,
): Promise<PermissionSetOverlayDiscardResult> {
  const { ql, logger } = deps;
  await assertTenantAdmin(deps, callerCtx);
  const organizationId = callerOrganizationId(callerCtx);

  const row = (await tryFind(ql, 'sys_permission_set', { id }, 1, organizationId))[0];
  if (!row) throw new PermissionSetNotFoundError(id);

  // Eligibility: package-declared, decided from the ARTIFACT registry — never
  // from `row.managed_by`, which is exactly the column the confounded
  // provenance-skip + overlay-shadow case gets wrong. See module header.
  const declaredItem = readDeclared(ql, 'permission').find(
    (item: any) => item?.name === row.name && (item?._packageId ?? item?.packageId),
  );
  if (!declaredItem) {
    throw new PermissionDeniedError(
      `[Security] Access denied: '${String(row.name)}' is not currently declared by any installed package — ` +
        `discarding its overlay would destroy environment-authored work with no trace and no recovery path. ` +
        `This action targets package-declared sets only.`,
      { id, name: row.name },
    );
  }

  const overlays = await findActiveOverlayRows(ql, String(row.name));
  if (overlays.length === 0) {
    throw new PermissionSetOverlayStateError(
      `Permission set '${row.name}' has no active environment overlay to discard — its enforced grants are not ` +
        `currently shadowed (if they still differ from the shipped artifact, this is the 'provenance_skip' ` +
        `mechanism, which this action does not target).`,
    );
  }

  const beforeCount = countGrantedObjects(row);
  for (const overlay of overlays) {
    try {
      await ql.delete('sys_metadata', { where: { id: overlay.id }, context: SYSTEM_CTX });
    } catch (e) {
      logger?.error?.(
        '[security] failed to delete stale permission-set overlay row during sanctioned discard',
        e as Error,
        { name: row.name, overlayId: overlay.id },
      );
      throw e;
    }
  }

  // Restore sync NOW, not on next boot: re-run the SAME projector the env
  // door awaits on every save (ADR-0094) — with the overlay gone,
  // `getMetaItemLayered` now yields the declared artifact body, so this both
  // re-projects the record's facets and heals the evaluator's in-memory
  // registry echo (`syncEvaluatorRegistry`'s "overlay gone" branch).
  const protocol = deps.getProtocol?.();
  const projectionDeps: ProjectionDeps = { ql, metadata: deps.metadata, logger };
  const refusals = createSeedWriteRefusals();
  let healedRow: any;
  let resyncRefused = false;
  if (protocol && typeof protocol.getMetaItemLayered === 'function') {
    await projectPermissionMutation(protocol, projectionDeps, {
      type: 'permission', name: String(row.name), state: 'active', organizationId: organizationId ?? null,
    });
    healedRow = (await tryFind(ql, 'sys_permission_set', { id }, 1, organizationId))[0] ?? row;
  } else {
    // Degraded kernel with no metadata protocol: project the declared
    // artifact's facets directly, same shape `upsertEnvPermissionSet` writes,
    // clearing `customized` (there is no overlay left to badge).
    //
    // ⛔ The result is READ. Discarding it is what let the audit line below
    // assert a completed operator action over a write the store refused: on
    // refusal `healedRow` is re-read as the UNCHANGED row, `objectGrantsAfter`
    // equals `objectGrantsBefore`, and every field of the entry stays
    // individually true while the entry as a whole is false. An audit record
    // of a sanctioned action is the one record that may not be optimistic.
    resyncRefused = !(await tryUpdate(
      ql,
      'sys_permission_set',
      { id, ...permissionSetRowFields(declaredItem), customized: false },
      organizationId,
      refusals,
    ));
    healedRow = (await tryFind(ql, 'sys_permission_set', { id }, 1, organizationId))[0] ?? row;
  }

  const afterCount = countGrantedObjects(healedRow);
  // Audited: who, what, before/after — the "supported, audited action" ask.
  const audit = {
    id, name: row.name, packageId: declaredItem._packageId ?? declaredItem.packageId,
    by: callerCtx?.userId, organization: organizationId,
    overlaysDiscarded: overlays.length,
    objectGrantsBefore: beforeCount, objectGrantsAfter: afterCount,
  };
  if (resyncRefused) {
    // ⛔ EXACTLY ONE audit entry per action, and when the resync was refused
    // it is THIS one — the success line above is withheld, never emitted
    // alongside. Two entries for one action would leave a reader to decide
    // which is authoritative, and the optimistic one is the one that reads
    // like the rest of the ledger.
    //
    // Emitted-with-the-failure-stated rather than withheld outright, because
    // the destructive HALF of this operator action DID land: the sys_metadata
    // overlay row is deleted and gone (that leg rethrows, so reaching here
    // means it succeeded). Withholding the entry would erase the record of a
    // deletion that actually happened — a worse audit defect than the
    // optimistic one this repairs.
    //
    // Durability channel (AGENTS.md "Degradation log levels"): the caller is
    // answered normally by ruling, the API returns 200, and the row silently
    // goes on enforcing its pre-discard grants — the "still looks normal from
    // the outside" shape, which is `error` with the mandatory `warn` fallback
    // for hosts that inject a sink without one.
    logSeedDurabilityFailure(
      logger,
      `[security] package-declared permission set overlay discarded BUT THE RESYNC WRITE WAS REFUSED ` +
        `(sanctioned operator action, PARTIALLY applied) — the stale sys_metadata overlay row(s) WERE ` +
        `deleted and are gone, and the follow-up write that re-projects the declared artifact onto ` +
        `sys_permission_set was refused by the store, so the row STILL ENFORCES ITS PRE-DISCARD GRANTS. ` +
        `"objectGrantsAfter" below is therefore the UN-HEALED count, and the caller was answered with that ` +
        `same number as "healedObjectGrantCount" and a 200 — NOTHING LOOKS BROKEN from the API. This entry ` +
        `replaces the "overlay discarded" success line, which is NOT also emitted for this action. ` +
        `Recovery: the overlay is gone, so the ADR-0094 env-door reconciler ` +
        `("reconcilePermissionSetProjection") re-projects this row on its own on the NEXT BOOT — restart, ` +
        `or re-run this action once the store accepts writes again, to converge sooner. What the store ` +
        `actually said is in the query engine's "Update operation failed" entry logged just before this ` +
        `one, which keeps the driver's own identifier with the bound statement and its values cut.`,
      { ...audit, resyncWriteRefused: true, refusals: refusals.report() },
    );
  } else {
    logger?.info?.('[security] package-declared permission set overlay discarded (sanctioned operator action)', audit);
  }

  return { permissionSet: healedRow, healedObjectGrantCount: afterCount, overlaysDiscarded: overlays.length };
}
