// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cleanupPackagePermissions — uninstall-time revocation of a package's
 * data-plane permission rows (ADR-0086 D3, #2747).
 *
 * ADR-0090 D5 promises: "uninstalling the package (removing its sets by
 * `packageId`) revokes it everywhere at once. No ghost grants." Registered
 * with the protocol's uninstall-cleanup seam so `deletePackage` (and
 * install-local's uninstall door) trigger it without the protocol layer
 * learning the grant table's shape.
 *
 * Scope:
 *  - [ADR-0131 D3/D4, C3 stage 8] The package's permission sets are the names
 *    it declared in the security catalog. The uninstalling door captures them
 *    before it withdraws the package (`declared` on the cleanup's arguments,
 *    `captureUninstallDeclared` in `@objectstack/metadata-protocol`). No
 *    catalog row is read: the row objects are retired, and the package
 *    withdrawal already took the definitions themselves out of the catalog. A
 *    grant written before the name column existed names nothing, so it cannot
 *    be reached here; the organization-ownership migration's id-to-name
 *    rewrite (ADR-0131 D10) owns it.
 *  - [ADR-0150 D8] A name no longer belongs to one holder: two packages of
 *    two namespaces may each hold it (D3/D4), and a grant says which one in
 *    its `permission_set_package` column. So a grant naming a declared set is
 *    revoked only when that column is THIS package, or when it is empty:
 *      - bound to this package: revoked. It was this package's set.
 *      - bound to ANOTHER package: never touched. That package still holds
 *        its set, and the grant is its user's access to it.
 *      - empty (written before the column, or bound to no holder because the
 *        name was ambiguous, D4): revoked in every case. When this package
 *        was the name's one holder that is today's revocation (it was this
 *        package's switch). When another holder still serves the name AFTER
 *        this package's withdrawal (`options.catalog`), the grant was already
 *        ambiguous: it is revoked and REPORTED (one `warn` per uninstall and
 *        `reportedGrants` on the outcome, naming user, organization and set),
 *        so the operator re-grants it with the package named. ⛔ It is never
 *        bound to the remaining holder: that would hand the user another
 *        package's set, which nobody granted (red line 1). Revoking is
 *        fail-closed: it takes away no access that was ever bound.
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
} from './write-refusals.js';

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
  return (await deleteRowsLanded(ql, object, rows, refusals)).length;
}

/** {@link deleteRows}, answering the rows whose delete LANDED rather than their count. */
async function deleteRowsLanded(
  ql: any,
  object: string,
  rows: any[],
  refusals?: SeedWriteRefusals,
): Promise<any[]> {
  const landed: any[] = [];
  for (const row of rows) {
    if (!row?.id) continue;
    try {
      await ql.delete(object, { where: { id: row.id }, context: SYSTEM_CTX });
      landed.push(row);
    } catch (e) {
      // Per-row best-effort, and now counted: `removed` reflects what landed,
      // `refusals` reflects what did not.
      refusals?.record(object, e);
    }
  }
  return landed;
}

/** A stored package column, trimmed; blank reads as none (`storedPermissionSetScope`). */
function packageColumnOf(row: any): string | undefined {
  const column = row?.permission_set_package;
  return typeof column === 'string' && column.trim() !== '' ? column.trim() : undefined;
}

/**
 * [ADR-0150 D8] A grant revoked although another holder still serves its set's
 * name: its package column was empty, so it never said which holder it meant.
 * Named on the uninstall's receipt so the operator can grant it again, this
 * time with the package named.
 */
export interface ReportedPermissionGrant {
  /** The grant's `user_id`. */
  user: string;
  /** The grant's `organization_id`; `null` for a grant of no organization. */
  organization: string | null;
  /** The permission set's name. */
  permission_set: string;
}

/**
 * [ADR-0150 D8] The reader that says who still holds a permission-set name
 * once the uninstalled package is withdrawn: the security catalog's `list`,
 * one entry per `(package, name)` holder plus the environment's own item
 * (`createSecurityCatalogReader` in `@objectstack/core`).
 */
export interface PackagePermissionHolderReader {
  list(type: 'permission'): Promise<ReadonlyArray<{ readonly name: string; readonly packageId?: string }>>;
}

/** Who still holds each name, the uninstalled package left out; `undefined` when the reader could not say. */
async function remainingHolders(
  catalog: PackagePermissionHolderReader,
  packageId: string,
): Promise<Map<string, string[]> | undefined> {
  let entries: ReadonlyArray<{ readonly name: string; readonly packageId?: string }>;
  try {
    entries = await catalog.list('permission');
  } catch {
    return undefined;
  }
  const holders = new Map<string, string[]>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.name !== 'string') continue;
    // A body still naming the withdrawn package as its owner is a leftover of
    // the withdrawal, not another holder.
    if (entry.packageId === packageId) continue;
    const holder = typeof entry.packageId === 'string' && entry.packageId !== '' ? entry.packageId : '(environment)';
    const list = holders.get(entry.name) ?? [];
    if (!list.includes(holder)) list.push(holder);
    holders.set(entry.name, list);
  }
  return holders;
}

export interface PackagePermissionCleanupOutcome {
  /** Always 0 since C3 stage 8: a permission set is a catalog definition, and no row is removed. */
  sets: number;
  /** Always 0 since C3 stage 8: a position's sets are part of its definition, and no binding row exists. */
  positionBindings: number;
  /**
   * sys_user_permission_set rows naming those sets and bound to this package,
   * or bound to none (ADR-0150 D8), that were revoked.
   */
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
  /**
   * [ADR-0150 D8] Grants revoked with an empty package column although another
   * holder still serves the name — counted in {@link userGrants} too, and
   * reported so the operator re-grants them with the package named. Absent
   * when there are none, so a one-holder uninstall answers as before.
   */
  reportedGrants?: ReportedPermissionGrant[];
}

export async function cleanupPackagePermissions(
  ql: any,
  packageId: string,
  logger?: { info?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void },
  declared?: { permission?: readonly string[] },
  options?: {
    /**
     * [ADR-0150 D8] Who still holds a name AFTER this package's withdrawal,
     * read once per uninstall. Decides only whether an empty-column grant is
     * reported: it is revoked either way. Absent: nothing is reported (the
     * one-holder reading). A reader that throws: every empty-column grant is
     * reported, since nobody could say it had one holder.
     */
    catalog?: PackagePermissionHolderReader;
  },
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

  // [ADR-0131 D3/D4, ADR-0090 D5] The package's sets are served from the
  // registry, so no row stands for them: the grants naming them are reached by
  // the names the uninstall door captured before it withdrew the package.
  // [ADR-0150 D8] A name may have more than one holder, so a grant naming it is
  // this package's only when its package column says so, or says nothing: a
  // grant bound to another package is that package's user's access and stays.
  const names = [...new Set(declared?.permission ?? [])].filter(
    (name): name is string => typeof name === 'string' && name !== '',
  );
  const reported: ReportedPermissionGrant[] = [];
  const ambiguous: Array<{ grant: ReportedPermissionGrant; holders: string[] }> = [];
  let holders: Map<string, string[]> | undefined | 'unread' = 'unread';
  for (const name of names) {
    const grants = await tryFind(ql, 'sys_user_permission_set', { permission_set: name });
    const ours = grants.filter((row) => {
      const column = packageColumnOf(row);
      return column === undefined || column === packageId;
    });
    const landed = await deleteRowsLanded(ql, 'sys_user_permission_set', ours, refusals);
    out.userGrants += landed.length;
    const unbound = landed.filter((row) => packageColumnOf(row) === undefined);
    if (unbound.length === 0 || !options?.catalog) continue;
    // Read once, and only when an empty-column grant was revoked.
    if (holders === 'unread') holders = await remainingHolders(options.catalog, packageId);
    const others = holders === undefined ? ['(unknown: the security catalog could not be read)'] : holders.get(name) ?? [];
    if (others.length === 0) continue;
    for (const row of unbound) {
      const grant: ReportedPermissionGrant = {
        user: String(row.user_id ?? ''),
        organization: typeof row.organization_id === 'string' && row.organization_id !== '' ? row.organization_id : null,
        permission_set: name,
      };
      reported.push(grant);
      ambiguous.push({ grant, holders: others });
    }
  }
  if (reported.length > 0) {
    out.reportedGrants = reported;
    // [ADR-0150 D8] ONE line per uninstall, naming every such grant: these
    // users lost a grant that may have meant the set another package still
    // serves, and only the operator can say which.
    logger?.warn?.(
      `[security] uninstalling package "${packageId}" revoked ${reported.length} permission-set grant(s) ` +
        `that named no package while another holder still serves the set's name: ` +
        ambiguous.map(({ grant, holders: h }) =>
          `user "${grant.user}" in ${grant.organization === null ? 'no organization' : `organization "${grant.organization}"`}` +
            ` — set "${grant.permission_set}" (still held by ${h.join(', ')})`).join('; ') +
        `. Such a grant never said which holder it meant (ADR-0150 D4), so it is revoked rather than handed to ` +
        `the remaining holder, which nobody granted. Remedy: if the user should keep the set, grant it again ` +
        `with the package named (the grant's permission_set_package).`,
      { packageId, reportedGrants: reported },
    );
  }

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
        `everywhere at once. No ghost grants." Where a sys_user_permission_set row survived, that ` +
        `promise is BROKEN and the grant is still live should the name ever resolve again: a reinstall, ` +
        `or another holder of the same name, hands its permissions straight back to every principal ` +
        `holding it. What the store actually said is in the query engine's "Delete operation ` +
        `failed" entries logged just before this one. Remedy: re-run the uninstall once the store ` +
        `accepts writes again — this sweep is idempotent and re-selects by name, so a second ` +
        `pass removes whatever the first could not. Until then, treat the package as still ` +
        `installed for authorization purposes.`,
      { packageId, refused: out.refused, refusals: refusals.report() },
    );
  }
  if (out.userGrants + out.suggestions > 0) {
    logger?.info?.('[security] package permission rows revoked on uninstall — every grant naming a set the package declared and bound to it or to no package, so no grant outlives the package (ADR-0090 D5, ADR-0150 D8)', {
      packageId, ...out,
    });
  }
  return out;
}
