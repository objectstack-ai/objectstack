// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A directory deactivation revokes the user's API keys, and no one restores
 * them from a user context.
 *
 * ## The rule
 *
 * Deactivating or deleting a user through SCIM revokes that user's API keys,
 * and an administrator cannot restore them (the maintainer's ruling of record,
 * comment 6787890900 on objectstack-ai/objectstack#32004, item "Directory
 * deactivation"). The ban the deactivation writes (`user-ban-write.ts`) is the
 * directory's to lift: an `active: true` from the same directory lifts it
 * (`AuthManager#reconcileScimUserLifecycle`). A key is a credential of its
 * own, so it does not ride the ban: the deactivation revokes it, and a later
 * re-activation re-arms nothing. The road back is a new key, minted by the
 * re-activated user.
 *
 * A SCIM `DELETE /Users/{id}` takes the same road. The installed
 * `@better-auth/scim` keeps the user row (it tombstones the SCIM source) and
 * hands the host the user's aggregate state with no active source left, so the
 * same inactive branch of the reconcile callback runs, and the user's key rows,
 * which survive with the user row, are revoked by the same write.
 *
 * ## What this module writes
 *
 * Every `sys_api_key` row the user owns ends `revoked: true` with
 * `revoked_reason: scim_deactivated` ({@link SCIM_DEACTIVATION_REVOKE_REASON}),
 * except a row that already carries a reason no one restores from a user
 * context (`organization_membership_ended`, or this one), which keeps it. So a
 * key revoked earlier with no reason (restorable by its owner), or with
 * `admin_password_reset` / `administrator_suspended` (restorable by a platform
 * administrator), is restamped: after the deactivation, no key the user owns
 * can be restored by anyone from a user context. The restore guard
 * (`api-key-restore-guard.ts`) holds that, the key door
 * (`resolveApiKeyAdmission`) refuses the key on `revoked`, and its
 * `API_KEY_REVOKED` text names the new-key road and no restorer.
 *
 * The rows are read and written in the system context, the writes attributed
 * the way every identity write of a SCIM request is (`authSystemWriteContext`:
 * the SCIM connection as a service principal). The engine joins the vendor's
 * transaction (`AuthManager.handleRequest` opens the SCIM request scope), so
 * the revocation commits with the deactivation it belongs to.
 *
 * Only the directory's deactivation revokes: an administrator's ban and unban
 * (`admin-ban-endpoints.ts`) leave the keys as they are.
 *
 * ## The outcome is counted, and never silent
 *
 * The caller runs this after the ban write, so a revocation that cannot land
 * never leaves a deprovisioned account enabled. A write or read that did not
 * land is counted (`complete: false`, `failed`), and the caller reports it once
 * at `error`: the account is disabled and the SCIM request succeeds, so nothing
 * looks wrong, while a key that was not revoked works again if the directory
 * re-activates the user.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { authSystemWriteContext } from './auth-actor-attribution.js';
import { MEMBERSHIP_ENDED_REVOKE_REASON } from './membership-ended-session.js';

/**
 * The `sys_api_key.revoked_reason` a directory deactivation (SCIM
 * `active: false`, or SCIM `DELETE /Users/{id}`) stamps on every key the user
 * owns. No one restores a key that carries it from a user context, a platform
 * administrator included. The same token the sign-in refusal of such an account
 * carries as `details.cause` (`banned-user-refusal-cause.ts`).
 */
export const SCIM_DEACTIVATION_REVOKE_REASON = 'scim_deactivated';

/**
 * The reasons no one restores from a user context. A row already carrying one
 * keeps it: rewriting it would change why the key was revoked, and restore
 * nothing.
 */
const NO_RESTORER_REASONS: ReadonlySet<string> = new Set([
  MEMBERSHIP_ENDED_REVOKE_REASON,
  SCIM_DEACTIVATION_REVOKE_REASON,
]);

/** How many key rows this revocation will consider for one user. */
const DEFAULT_MAX_ROW_SCAN = 500;

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The slice of the data engine this module uses. */
export interface ScimDeactivationKeyRevocationEngine {
  find?(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
  update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
}

/** What the revocation did. Counts are rows really written. */
export interface ScimDeactivationKeyRevocationOutcome {
  /** Key rows written: revoked, or restamped, with {@link SCIM_DEACTIVATION_REVOKE_REASON}. */
  apiKeys: number;
  /** Rows the revocation meant to write and could not. */
  failed: number;
  /**
   * `true` only when every key the user owns ended revoked with a reason no
   * one restores. `false` whenever a read or a write did not land, more rows
   * exist than were scanned, or the engine offers no read surface at all: a
   * revocation that cannot be measured is never reported as complete.
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

/** True when the stored value revokes the key, in any spelling a driver hands back. */
function isRevoked(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

/**
 * Revoke every API key `userId` owns with {@link SCIM_DEACTIVATION_REVOKE_REASON}.
 * Never throws; the outcome says what landed.
 */
export async function revokeDirectoryDeactivatedApiKeys(
  engine: ScimDeactivationKeyRevocationEngine | undefined,
  userId: string,
  opts: { maxRowScan?: number } = {},
): Promise<ScimDeactivationKeyRevocationOutcome> {
  const outcome: ScimDeactivationKeyRevocationOutcome = { apiKeys: 0, failed: 0, complete: false };
  if (!engine || typeof engine.find !== 'function' || !userId) return outcome;
  const maxScan = opts.maxRowScan ?? DEFAULT_MAX_ROW_SCAN;
  let incomplete = false;

  try {
    const keys = rowsOf(
      await engine.find(
        SystemObjectName.API_KEY,
        { where: { user_id: userId }, fields: ['id', 'revoked', 'revoked_reason'], limit: maxScan + 1 },
        { context: SYSTEM_CTX },
      ),
    );
    if (keys.length > maxScan) incomplete = true;
    for (const row of keys.slice(0, maxScan)) {
      if (!row.id) continue;
      const reason = typeof row.revoked_reason === 'string' ? row.revoked_reason : '';
      if (isRevoked(row.revoked) && NO_RESTORER_REASONS.has(reason)) continue;
      try {
        await engine.update(
          SystemObjectName.API_KEY,
          { id: String(row.id), revoked: true, revoked_reason: SCIM_DEACTIVATION_REVOKE_REASON },
          { context: await authSystemWriteContext() },
        );
        outcome.apiKeys += 1;
      } catch {
        outcome.failed += 1;
      }
    }
  } catch {
    incomplete = true;
  }

  outcome.complete = !incomplete && outcome.failed === 0;
  return outcome;
}

/**
 * The one notice for a deactivation whose key revocation did not finish,
 * logged by the caller at `error` (the ban already landed). Names the
 * consequence and the remedy in its first line.
 */
export function scimDeactivationKeyRevocationIncompleteMessage(
  userId: string,
  outcome: ScimDeactivationKeyRevocationOutcome,
): string {
  return (
    `[auth] SCIM deactivation of user '${userId}': API key revocation INCOMPLETE — ${outcome.apiKeys} key(s) `
    + `revoked, ${outcome.failed} write(s) refused, or a read did not finish or more keys exist than were scanned. `
    + 'The account is disabled and the SCIM request succeeds, so nothing looks wrong, but a key that was not '
    + 'revoked works again if the directory re-activates the user. Remedy: revoke the user\'s remaining keys '
    + `(sys_api_key rows of user_id '${userId}') in the system context with revoked: true and revoked_reason: `
    + `${SCIM_DEACTIVATION_REVOKE_REASON}, and check write access on sys_api_key; the next SCIM write that `
    + 'leaves the user inactive runs this revocation again.'
  );
}
