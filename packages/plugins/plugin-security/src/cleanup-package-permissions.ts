// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cleanupPackagePermissions — uninstall-time revocation of a package's
 * data-plane permission rows (ADR-0086 D3, #2747).
 *
 * ADR-0090 D5 promises: "uninstalling the package (removing its sets by
 * `packageId`) revokes it everywhere at once. No ghost grants." The
 * `package_id`/`managed_by` provenance columns (and the `package_id` index on
 * `sys_permission_set`) exist precisely for this query; this module is the
 * wiring that consumes them. Registered with the protocol's uninstall-cleanup
 * seam (the mirror of the publish materializer) so `deletePackage` triggers it
 * without the protocol layer learning `sys_permission_set`'s shape.
 *
 * Scope — provenance rules identical to the seeder's (ADR-0086 D4):
 *  - ONLY rows `managed_by: 'package'` with `package_id` = the uninstalled
 *    package are touched. Env-authored sets (`platform`/`user`/absent) and
 *    other packages' sets are never removed, even on a name collision.
 *  - Bindings referencing a removed set (`sys_position_permission_set`,
 *    `sys_user_permission_set`) are deleted first, so no dangling grant rows
 *    survive and re-resolution never sees a half-removed state.
 *  - `sys_audience_binding_suggestion` rows for the package are removed in
 *    every status: with the sets gone, confirmed/dismissed history points at
 *    nothing, and a fresh reinstall should re-prompt (D5 — admin confirms).
 *
 * System-context writes: uninstall is a package-door operation, exactly like
 * the boot seeder — the admin already authorized it by uninstalling.
 */

import {
  createSeedWriteRefusals,
  type SeedWriteRefusals,
} from './per-organization-catalog.js';

const SYSTEM_CTX = { isSystem: true };

// Engine signatures: `find(object, query)` and `delete(object, options)` both
// read `context` from their SECOND argument — a trailing `{ context }` arg is
// silently ignored, which turns a system write into a principal-less one that
// the D12 gate correctly fails CLOSED on the governed RBAC tables.
async function tryFind(ql: any, object: string, where: any, limit = 1000): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit, context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/**
 * Delete rows by id one at a time; returns how many were removed.
 *
 * [#12981] The per-row `catch` still absorbs the refusal and still never
 * throws — one row the store will not delete must not abort the sweep over the
 * rest, which is the whole reason this loop is per-row. What changes is that
 * the refusal is now RECORDED first.
 *
 * ⛔ The comment this replaces read "count reflects reality". That was true of
 * the count and false of what a reader does with it: `removed` counts the
 * deletes that LANDED, and nothing anywhere counted the ones that were
 * refused, so "the package owned no rows" and "every revocation was refused"
 * produced the same zero. See {@link cleanupPackagePermissions} for what that
 * zero cost.
 */
async function deleteRows(
  ql: any,
  object: string,
  rows: any[],
  refusals?: SeedWriteRefusals,
): Promise<number> {
  let removed = 0;
  for (const row of rows) {
    if (!row?.id) continue;
    try {
      await ql.delete(object, { where: { id: row.id }, context: SYSTEM_CTX });
      removed += 1;
    } catch (e) {
      // Per-row best-effort, and now counted: `removed` reflects what landed,
      // `refusals` reflects what did not.
      refusals?.record(object, e);
    }
  }
  return removed;
}

export interface PackagePermissionCleanupOutcome {
  /** Package-owned sys_permission_set rows removed. */
  sets: number;
  /** sys_position_permission_set rows referencing those sets. */
  positionBindings: number;
  /** sys_user_permission_set rows referencing those sets. */
  userGrants: number;
  /** sys_audience_binding_suggestion rows for the package (any status). */
  suggestions: number;
  /**
   * [#12981] Row deletions the store REFUSED across every object above.
   *
   * ⚠️ Not the complement of the four counters — those count rows that were
   * REMOVED, and this counts rows the sweep tried to remove and could not. It
   * exists because ADR-0090 D5's promise is an ABSENCE ("revokes it everywhere
   * at once. No ghost grants"), and an absence cannot be verified from a count
   * of successes: `{ sets: 0, positionBindings: 0, userGrants: 0,
   * suggestions: 0 }` was returned both by an uninstall of a package that
   * granted nothing and by one whose every revocation was refused. The caller
   * reports `removed` to the package door either way, and the door answers
   * `success: true`.
   */
  refused: number;
}

export async function cleanupPackagePermissions(
  ql: any,
  packageId: string,
  logger?: { info?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void },
): Promise<PackagePermissionCleanupOutcome> {
  const out: PackagePermissionCleanupOutcome = {
    sets: 0, positionBindings: 0, userGrants: 0, suggestions: 0, refused: 0,
  };
  if (!ql || typeof ql.find !== 'function' || typeof ql.delete !== 'function' || !packageId) return out;

  // [#12981] ONE refusal log for the whole uninstall sweep, reported once
  // below — never per row: a store that is refusing deletes refuses ALL of
  // them, and a line per row would bury the one sentence naming the
  // consequence.
  const refusals = createSeedWriteRefusals();

  // Provenance-scoped: only the package door's own rows (ADR-0086 D4).
  // `managed_by` is filtered in JS — a multi-column where on the readonly
  // provenance columns doesn't match through the engine's query layer
  // (verified empirically), while the single-column package_id filter does.
  const sets = (await tryFind(ql, 'sys_permission_set', { package_id: packageId }))
    .filter((r) => r?.managed_by === 'package');

  // Bindings first — a set row must never outlive its grants in reverse.
  for (const set of sets) {
    if (!set?.id) continue;
    out.positionBindings += await deleteRows(
      ql, 'sys_position_permission_set',
      await tryFind(ql, 'sys_position_permission_set', { permission_set_id: set.id }),
      refusals,
    );
    out.userGrants += await deleteRows(
      ql, 'sys_user_permission_set',
      await tryFind(ql, 'sys_user_permission_set', { permission_set_id: set.id }),
      refusals,
    );
  }
  out.sets = await deleteRows(ql, 'sys_permission_set', sets, refusals);

  // Suggestion rows in every status — reinstall re-prompts fresh (D5).
  out.suggestions = await deleteRows(
    ql, 'sys_audience_binding_suggestion',
    await tryFind(ql, 'sys_audience_binding_suggestion', { package_id: packageId }),
    refusals,
  );

  out.refused = refusals.total;
  if (out.refused > 0) {
    // [#12981] The report the silence cost. ⛔ NOT folded into the `info` line
    // below and ⛔ not gated with it: that line's headline asserts rows WERE
    // revoked, and printing it over a sweep that revoked none would be the
    // reassuring half-truth this repair exists to remove. This is its own
    // line, and it fires on refusals alone.
    //
    // ⚠️ LEVEL: `warn`, and that is a decision rather than an oversight.
    // AGENTS.md "Degradation log levels" puts this report at `error` — the
    // consequence below is exactly the shape it names — but the `logger`
    // parameter of this function is part of `cleanupPackagePermissions`'
    // exported signature and declares `warn` OPTIONAL. Adding `error?` to it
    // would enrol the type into
    // `scripts/check-optional-error-sink-contract.mjs`' population, which
    // requires a NON-optional `warn` on any sink declaring `error` — and
    // making `warn` required here is a break of a published shape, which is a
    // contract call above this repair rather than part of it. The SILENCE is
    // what this change fixes, and it needed no contract at all; the LEVEL is
    // recorded on #12981 for a `CONTRACT_REVIEW_TIER` seat. The same split,
    // and for the same reason, as the `plugin-sharing` repair that landed in
    // this card's batch 1.
    logger?.warn?.(
      `[security] ${out.refused} permission row deletion(s) were REFUSED while uninstalling this ` +
        `package — those rows SURVIVE the uninstall, and nothing else reports it: the package door ` +
        `has already answered "success" and the count it reported is a count of the rows that were ` +
        `actually removed. ADR-0090 D5 promises that removing a package's sets "revokes it ` +
        `everywhere at once. No ghost grants." Where a sys_position_permission_set or ` +
        `sys_user_permission_set row survived, that promise is BROKEN and the grant is still live: ` +
        `every principal holding it keeps the uninstalled package's permissions until the row goes. ` +
        `Where a sys_permission_set row survived, the set remains resolvable by name and a reinstall ` +
        `collides with it. What the store actually said is in the query engine's "Delete operation ` +
        `failed" entries logged just before this one. Remedy: re-run the uninstall once the store ` +
        `accepts writes again — this sweep is idempotent and re-selects by package_id, so a second ` +
        `pass removes whatever the first could not. Until then, treat the package as still ` +
        `installed for authorization purposes.`,
      { packageId, refused: out.refused, refusals: refusals.report() },
    );
  }
  if (out.sets + out.positionBindings + out.userGrants + out.suggestions > 0) {
    logger?.info?.('[security] package permission rows revoked on uninstall (#2747)', {
      packageId, ...out,
    });
  }
  return out;
}
