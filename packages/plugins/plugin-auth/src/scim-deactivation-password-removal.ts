// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A directory deactivation removes the user's local password; a re-activation
 * restores access through SSO only.
 *
 * ## The rule
 *
 * Deactivating or deleting a user through SCIM removes that user's local
 * password (the maintainer's ruling of record, comment 6787890900 on
 * objectstack-ai/objectstack#32004, item "Directory deactivation": removing a
 * directory user's local password is the step after the API keys). The ban
 * the deactivation writes (`user-ban-write.ts`) is the directory's to lift,
 * and an `active: true` from the same directory lifts it
 * (`AuthManager#reconcileScimUserLifecycle`). A local password is a
 * credential of its own, like an API key (`scim-deactivation-key-revocation.ts`),
 * so it does not ride the ban: the deactivation removes it, and the
 * re-activation that lifts the directory's ban removes the local password the
 * user holds at that moment before it lifts the ban. So a re-activation after a
 * directory deactivation restores no credential from before it, one set while
 * the directory held the user deactivated included: re-activation by the
 * directory restores access through SSO only. A new local password, where the
 * deployment allows one, is set again on purpose after the re-activation
 * (`set-initial-password`, an administrator's `admin/set-user-password`).
 *
 * A SCIM `DELETE /Users/{id}` takes the same road: the installed
 * `@better-auth/scim` keeps the user row (it tombstones the SCIM source) and
 * hands the host the user's aggregate state with no active source left, so the
 * same inactive branch of the reconcile callback runs. A create with
 * `active: false`, a tombstone re-link that arrives inactive, a connection
 * decommission pass that removes the user's last active source, and any later
 * SCIM write while the directory holds the user inactive are inactive calls
 * too, and each one runs this removal. The trigger is the directory's state,
 * never the ban column: a user an administrator banned is reached only when
 * the directory holds that user inactive as well, and a write the directory
 * makes for an active user removes nothing, banned or not. The
 * `active: true` call that lifts the directory's own ban (a PATCH, a PUT, or a
 * re-link of the same user through its tombstone) runs it as well.
 *
 * ## What this module writes
 *
 * Every `sys_account` row of the user whose `provider_id` is `credential` is
 * deleted. The `sys_user` row, the user's other account links (SSO / OAuth)
 * and the history that names the user are untouched: the directory disables
 * the person, it does not erase them (ADR-0134 D3). Nothing to remove means no
 * write, so a second deactivation, or any later SCIM write that leaves the
 * user inactive, is a no-op once the password is gone. A password set again
 * while the directory still holds the user inactive (an administrator's
 * deliberate act) is removed by the next SCIM write for that user that leaves
 * the user inactive, or by the re-activation.
 *
 * ## Why the engine, and not `context.database`
 *
 * Both reach the `account` rows, and both commit or roll back with the SCIM
 * mutation they belong to. The vendor's transaction adapter
 * (`SCIMTransactionContext.database`) is the very adapter
 * `createObjectQLAdapterFactory` builds for every flow; it reaches the
 * transaction the way the engine does, through the AMBIENT transaction
 * `engine.transaction()` publishes for the length of a SCIM protocol request
 * (`objectql-adapter.ts`, the #3653 note; `AuthManager.handleRequest` opens
 * the request scope). So the choice is made on what each one reads and how its
 * write is attributed:
 *
 *  - the engine reads the row ids alone (`fields: ['id']`), while the
 *    adapter's `account` reads re-attach the password column on the way out
 *    (`reattachInternalFieldsOnRead`), and a removal has no use for it;
 *  - the engine write carries the same system context and the same
 *    attribution (`authSystemWriteContext`: the SCIM connection as a service
 *    principal) as the deprovision's other two writers (the key revocation and
 *    the AI service account suspension) and the directory-managed mark, which
 *    all run through it on this path.
 *
 * `scim-deactivation-reconcile-user.test.ts` pins the rollback: a deactivation
 * that fails after this removal leaves the password in place.
 *
 * ## Order, sessions and the directory-managed mark
 *
 * On a deactivation the caller runs this after the ban write, the key
 * revocation and the AI service account suspension. A ban the break-glass
 * last-administrator guard refuses throws before this runs, so a refused
 * deactivation removes nothing (and the vendor rolls its own write back).
 * Sessions are not this module's: the vendor deletes the user's sessions after
 * the reconcile callback returns for an inactive state. The directory-managed
 * mark runs after this, so a user whose password is gone reads
 * `idp_provisioned` (ADR-0135 D4: only a user who holds a local password keeps
 * `env_native`).
 *
 * On a re-activation the caller runs this first: before the directory-managed
 * mark (so the mark reads what is left) and before the unban. There it fails
 * closed: the ban is lifted only once this reports `complete`, so an incomplete
 * removal fails the SCIM request and the vendor rolls it back with the user
 * still deactivated.
 *
 * Only the directory removes, on a deactivation and on the re-activation that
 * lifts its own ban. An administrator's ban and unban
 * (`admin-ban-endpoints.ts`), an `active: true` over an administrator's ban,
 * and any active write for a user who is not banned leave the password as it
 * is. The last-LOCAL-credential guard the admin ban mount runs
 * (`last-local-credential.ts`) is deliberately not applied on this path, for
 * the reason `AuthManager#reconcileScimUserLifecycle` gives: the identity
 * provider is the authority for the user it deprovisions.
 *
 * Each delete carries `authSystemWriteContext()`: on a SCIM request that is
 * the connection as a service principal (`svc:scim:CONNECTION_ID`), the same
 * attribution as the other writers on this path. No audit row follows it:
 * `sys_account` is on the audit mirror's skip list (`plugin-audit`,
 * `audit-writers.ts`), with the session tables, so no credential row reaches
 * the audit log.
 *
 * ## The outcome is counted, and never silent
 *
 * This never throws. `complete` is a measured zero, not the absence of an
 * error: once it has deleted anything, the removal reads the user's
 * local-password rows again and reports `complete` only when none is left, so
 * a delete that answers without removing its row is caught. A row the read
 * returns without an id counts as one that could not be removed. A read or a
 * delete that did not land is counted (`complete: false`, `failed`), and the
 * caller reports it once at `error`. On
 * a deactivation the account is disabled and the SCIM request succeeds, so
 * nothing looks wrong while the user still holds a local password; the next
 * inactive write runs the removal again, and the re-activation lifts the ban
 * only once it completes. On a re-activation the caller fails the request
 * instead. The removal considers at most 100 rows of one user per call: a
 * deactivation keeps what it deleted, so later inactive writes converge, but a
 * failed re-activation rolls its deletes back, so above that number a
 * re-activation stays refused until the rows the message names are removed
 * by hand (a user holds one local password in practice).
 * A failure the driver turns into an aborted transaction fails the
 * SCIM write with it, as for the other writers on this path: that is the
 * database, not this removal.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { authSystemWriteContext } from './auth-actor-attribution.js';

/** The `sys_account.provider_id` of a local password (better-auth's credential provider). */
const LOCAL_PASSWORD_PROVIDER_ID = 'credential';

/** How many local-password rows this removal will consider for one user. */
const DEFAULT_MAX_ROW_SCAN = 100;

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The slice of the data engine this module uses. */
export interface ScimDeactivationPasswordRemovalEngine {
  find?(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  delete?(object: string, query?: unknown): Promise<unknown>;
}

/** What the removal did. `complete` is the measured result; the counts say how it got there. */
export interface ScimDeactivationPasswordRemovalOutcome {
  /** Local-password rows whose delete answered without an error. */
  removed: number;
  /** Rows the removal meant to delete and could not. */
  failed: number;
  /**
   * `true` only when the user is left with no local-password row, measured by
   * a read. `false` whenever a read or a delete did not land, a row could not
   * be addressed by id, a re-read still finds a row, more rows exist than were
   * scanned, or the engine offers no read or delete surface at all: a removal
   * that cannot be measured is never reported as complete.
   */
  complete: boolean;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const value = (result as { value?: unknown } | null)?.value;
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const records = (result as { records?: unknown } | null)?.records;
  return Array.isArray(records) ? (records as Array<Record<string, unknown>>) : [];
}

/**
 * Delete every local-password (`credential`) account row of `userId`.
 * Never throws; the outcome says what landed.
 */
export async function removeDirectoryDeactivatedLocalPassword(
  engine: ScimDeactivationPasswordRemovalEngine | undefined,
  userId: string,
  opts: { maxRowScan?: number } = {},
): Promise<ScimDeactivationPasswordRemovalOutcome> {
  const outcome: ScimDeactivationPasswordRemovalOutcome = { removed: 0, failed: 0, complete: false };
  if (!engine || typeof engine.find !== 'function' || typeof engine.delete !== 'function' || !userId) {
    return outcome;
  }
  const maxScan = opts.maxRowScan ?? DEFAULT_MAX_ROW_SCAN;
  let incomplete = false;

  try {
    const rows = rowsOf(
      await engine.find(
        SystemObjectName.ACCOUNT,
        { where: { user_id: userId, provider_id: LOCAL_PASSWORD_PROVIDER_ID }, fields: ['id'], limit: maxScan + 1 },
        { context: SYSTEM_CTX },
      ),
    );
    if (rows.length > maxScan) incomplete = true;
    for (const row of rows.slice(0, maxScan)) {
      if (!row.id) {
        outcome.failed += 1;
        continue;
      }
      try {
        await engine.delete(SystemObjectName.ACCOUNT, {
          where: { id: String(row.id) },
          context: await authSystemWriteContext(),
        });
        outcome.removed += 1;
      } catch {
        outcome.failed += 1;
      }
    }
    // A measured zero: what the deletes left behind, read back.
    if (!incomplete && outcome.failed === 0 && outcome.removed > 0) {
      const left = rowsOf(
        await engine.find(
          SystemObjectName.ACCOUNT,
          { where: { user_id: userId, provider_id: LOCAL_PASSWORD_PROVIDER_ID }, fields: ['id'], limit: 1 },
          { context: SYSTEM_CTX },
        ),
      );
      if (left.length > 0) incomplete = true;
    }
  } catch {
    incomplete = true;
  }

  outcome.complete = !incomplete && outcome.failed === 0;
  return outcome;
}

/**
 * The one notice for a deactivation whose local-password removal did not
 * finish, logged by the caller at `error` (the ban already landed). Names the
 * consequence and the remedy.
 */
export function scimDeactivationPasswordRemovalIncompleteMessage(
  userId: string,
  outcome: ScimDeactivationPasswordRemovalOutcome,
): string {
  return (
    `[auth] SCIM deactivation of user '${userId}': local password removal INCOMPLETE — ${outcome.removed} `
    + `credential row(s) removed, ${outcome.failed} row(s) not removed, or a read did not finish, `
    + 'a re-read still found a row, or more rows exist than were scanned. The account is disabled and the SCIM '
    + 'request succeeds, so nothing looks wrong, but the user still holds a local password. '
    + `Remedy: delete the user's remaining sys_account rows with provider_id 'credential' (user_id '${userId}') `
    + 'in the system context, and check delete access on sys_account; the next SCIM write that leaves the user '
    + "inactive runs this removal again, and a re-activation lifts the directory's ban only once it has completed."
  );
}

/**
 * The one notice for a re-activation whose local-password removal did not
 * finish, logged by the caller at `error` and thrown as the reason the SCIM
 * request fails (the ban stays). Names the consequence and the remedy.
 */
export function scimReactivationPasswordRemovalIncompleteMessage(
  userId: string,
  outcome: ScimDeactivationPasswordRemovalOutcome,
): string {
  return (
    `[auth] SCIM re-activation of user '${userId}' REFUSED: local password removal INCOMPLETE — ${outcome.removed} `
    + `credential row(s) removed, ${outcome.failed} row(s) not removed, or a read did not finish, `
    + 'a re-read still found a row, or more rows exist than were scanned. A re-activation by the directory '
    + "restores access through SSO only, so the directory's ban is lifted only once the user holds no local "
    + 'password: the SCIM request fails, nothing it wrote is kept, and the user stays deactivated. '
    + `Remedy: delete the user's remaining sys_account rows with provider_id 'credential' (user_id '${userId}') `
    + "in the system context, and check delete access on sys_account; the directory's retry of the re-activation "
    + 'runs this removal again.'
  );
}
