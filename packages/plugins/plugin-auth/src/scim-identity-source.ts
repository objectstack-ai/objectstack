// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0135 D4 — the directory-managed mark (`sys_user.source =
 * 'idp_provisioned'`) for identities a SCIM directory provisions.
 * PACKAGE-INTERNAL: like `user-ban-write.ts`, this module is not re-exported
 * from `index.ts`.
 *
 * ## The rule
 *
 * A user the directory provisions is the directory's: it reads
 * `idp_provisioned` from the moment SCIM creates or re-links it, so every
 * refusal that keys off the managed mark (the D5.2 local-credential actions,
 * `admin/set-user-manager`'s directory-owned refusal, `admin/set-user-password`
 * on a cloud-managed environment) judges it as managed.
 *
 * The one exception is D4's existing one, unchanged here: a user who holds a
 * local password (`sys_account.provider_id = 'credential'`) stays
 * `env_native`. That is the same rule the federated branch of
 * `stampIdentitySource` (`auth-manager-database-hooks.ts`) applies to an SSO
 * link, and the reason a SCIM user who later sets a password keeps the
 * `env_native` value `stampIdentitySource`'s credential branch flips them to —
 * a later SCIM sync or a later boot re-runs this rule and leaves that user
 * alone.
 *
 * ## The two callers
 *
 * - **The SCIM write path.** `@better-auth/scim` keeps its directory links in
 *   its own tables (`sys_scim_user`, `sys_scim_subject`) and writes no
 *   `sys_account` row, so neither the vendor's `account.create.after` hook nor
 *   the `sys_account` `afterInsert` hook in `auth-plugin.ts` sees a SCIM
 *   create. The seam every SCIM user write passes through is the vendor's
 *   `identity.reconcileUser` host callback (`AuthManager
 *   #reconcileScimUserLifecycle`): `POST /Users` calls it on create, on a link
 *   to an existing user, on a tombstone re-link and on the reprovision of an
 *   inactive source, and so do PUT, PATCH, DELETE and a projection-domain
 *   reconcile. It runs inside the vendor's SCIM transaction, and the engine
 *   calls here join that transaction (the adapter publishes it as the engine's
 *   ambient transaction), so the mark commits or rolls back with the create.
 * - **The boot backfill.** Users a directory provisioned before this rule
 *   existed are found from a stored fact — they own a `sys_scim_subject` row,
 *   which the vendor creates for every SCIM-provisioned user and never deletes
 *   (a DELETE tombstones the source, not the subject) — and marked once by
 *   {@link backfillScimProvisionedIdentitySource}. It writes only where the
 *   value is wrong, so a second boot writes nothing.
 */

import { isMissingTableError, keysetWalk } from '@objectstack/types';
import { authSystemWriteContext } from './auth-actor-attribution.js';

/** The engine surface the mark needs — satisfied by `IDataEngine`. */
export interface ScimIdentitySourceEngine {
  find(objectName: string, query?: Record<string, unknown>): Promise<unknown[]>;
  update(objectName: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** The directory-managed value ADR-0135 D4 names. */
export const DIRECTORY_MANAGED_SOURCE = 'idp_provisioned';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Rows per backfill page — bounds each `$in` list the page reads with. */
export const SCIM_IDENTITY_SOURCE_BACKFILL_PAGE = 200;

/**
 * Mark each of `userIds` directory-managed, per the module rule: a user who
 * already reads `idp_provisioned`, holds a local password, or has no
 * `sys_user` row is left as it is. Returns how many rows were written.
 *
 * Errors propagate. On the SCIM path that fails the request inside its
 * transaction, so no SCIM user is created without the mark; the backfill
 * catches and reports at its own call site.
 */
export async function markDirectoryProvisionedUsers(
  engine: ScimIdentitySourceEngine,
  userIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return 0;

  const credentialRows = (await engine.find('sys_account', {
    where: { user_id: { $in: ids }, provider_id: 'credential' },
    fields: ['user_id'],
    context: SYSTEM_CTX,
  })) as Array<{ user_id?: unknown }>;
  const holdsLocalPassword = new Set(credentialRows.map((row) => String(row.user_id)));

  const users = (await engine.find('sys_user', {
    where: { id: { $in: ids } },
    fields: ['id', 'source'],
    limit: ids.length,
    context: SYSTEM_CTX,
  })) as Array<{ id?: unknown; source?: unknown }>;

  let written = 0;
  for (const user of users) {
    const id = String(user.id);
    if (user.source === DIRECTORY_MANAGED_SOURCE) continue;
    if (holdsLocalPassword.has(id)) continue;
    // Attributed like every other identity write plugin-auth makes: on the
    // SCIM path to the connection performing the request, at boot to nobody.
    await engine.update('sys_user', { id, source: DIRECTORY_MANAGED_SOURCE }, { context: await authSystemWriteContext() });
    written += 1;
  }
  return written;
}

export interface ScimIdentitySourceBackfillResult {
  /** Distinct users that own a `sys_scim_subject` row. */
  directoryProvisioned: number;
  /** Rows this pass wrote — zero on every pass after the first. */
  marked: number;
}

/**
 * The once-at-boot pass: every user owning a `sys_scim_subject` row is put
 * through {@link markDirectoryProvisionedUsers}, a page at a time. Idempotent
 * by construction — it writes only a row whose value is wrong.
 */
export async function backfillScimProvisionedIdentitySource(
  engine: ScimIdentitySourceEngine,
  pageSize: number = SCIM_IDENTITY_SOURCE_BACKFILL_PAGE,
): Promise<ScimIdentitySourceBackfillResult> {
  const seen = new Set<string>();
  let marked = 0;
  const walk = keysetWalk<{ id?: unknown; user_id?: unknown }>(
    async (q) => {
      try {
        return (await engine.find('sys_scim_subject', {
          ...(q.where === undefined ? {} : { where: q.where }),
          orderBy: q.orderBy,
          limit: q.limit,
          fields: ['id', 'user_id'],
          context: SYSTEM_CTX,
        })) as Array<{ id?: unknown; user_id?: unknown }>;
      } catch (e) {
        // No subject table means no directory ever provisioned a user here:
        // the one read failure that is an answer. Any other failure propagates.
        if (isMissingTableError(e, 'sys_scim_subject')) return [];
        throw e;
      }
    },
    { pageSize },
  );
  for await (const page of walk.pages()) {
    const userIds: string[] = [];
    for (const row of page) {
      if (row.user_id === null || row.user_id === undefined) continue;
      const id = String(row.user_id);
      if (seen.has(id)) continue;
      seen.add(id);
      userIds.push(id);
    }
    marked += await markDirectoryProvisionedUsers(engine, userIds);
  }
  if (walk.truncated) {
    // Only a reader that cannot seek stops the walk early; a partial pass
    // must not read as a complete one.
    throw new Error(
      `[auth] the SCIM identity-source backfill stopped after ${walk.scanned} sys_scim_subject row(s): `
        + 'the read did not advance past its last id',
    );
  }
  return { directoryProvisioned: seen.size, marked };
}
