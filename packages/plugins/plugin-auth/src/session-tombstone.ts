// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7732] Session tombstones — make ADR-0069 D4's revoke-audit trail real for
 * the one cause an audit most wants: an interactive revoke.
 *
 * ## The defect this closes
 *
 * `sys_session.revoked_at` / `revoke_reason` are declared `readonly` and
 * documented "System-managed", and `revoked_at`'s description names all four
 * causes it is meant to capture: *idle / absolute-max / concurrent-cap /
 * admin*. Three of them honour that. `auth-manager.ts` expires the row in place
 * — `expires_at` into the past plus both columns — from
 * `enforceSessionControls` (idle / absolute-max) and `enforceConcurrentCap`.
 *
 * The fourth never did. An admin or user-initiated revoke reaches better-auth's
 * `internalAdapter.deleteSession` / `deleteUserSessions`, which **delete the
 * row**. A deleted row carries no `revoke_reason`, so the `admin` cause was
 * unrecordable by construction and D4's trail was inert exactly where it
 * matters.
 *
 * Two rules close it, and both live at the better-auth → ObjectQL adapter:
 *
 *  1. **A delete under an interactive-revoke endpoint is a revocation, not a
 *     deletion** — the row is stamped in place instead
 *     ({@link INTERACTIVE_REVOKE_REASON}), in the same shape the automatic path
 *     already writes.
 *  2. **A revoked session is not a session** — a tombstoned row is invisible to
 *     better-auth's own session reads ({@link hideRevokedSessionRow}), which is
 *     what makes rule 1 worth anything. See "Retention" below.
 *
 * ## Why the seam is HERE, at the adapter
 *
 * Verified against better-auth `1.7.0-rc.2`, the version this package pins:
 *
 *  - **better-auth already implements this exact substitution, one layer up,
 *    and we cannot reach it.** `internalAdapter.endPreservedSessions` replaces
 *    the physical delete with `updateMany({ expiresAt: now })` while keeping
 *    the delete hooks running (`deleteManyWithHooks(..., { fn, executeMainFn:
 *    false })`). It is gated on `secondaryStorage` being configured
 *    (`deleteSession`: `if (secondaryStorage) { … if (preserveSessionInDatabase)
 *    … }`), and ObjectStack deliberately does not wire one — handing better-auth
 *    a `secondaryStorage` moves the session OF RECORD into the cache and makes
 *    every D4 control inert (#4772 / #4785, pinned in
 *    `session-of-record.test.ts`). So the shape upstream chose is right and
 *    unreachable; this module is that shape at the only layer we own.
 *  - **`databaseHooks.session.delete.before` returning `false` was refused.**
 *    It aborts the delete, which is what we want — but `getWithHooks` then skips
 *    every `delete.after` hook, and `@better-auth/oauth-provider` (enabled by
 *    default here) registers `session.delete.before`/`after` to prepare and
 *    dispatch **OIDC back-channel logout**. Suppressing back-channel logout on
 *    an admin revoke — the single revocation that most needs downstream relying
 *    parties told — trades an audit row for a security hole. Upstream's own
 *    preserve path is careful about exactly this ("the session-delete hooks
 *    still run, so OAuth token revocation and back-channel logout fire on
 *    session end"). Substituting the physical write at the adapter keeps the
 *    whole hook lifecycle intact.
 *  - **The route boundary was refused** for the reason `adopt-membership.ts`
 *    records: re-implementing `revoke-session` / `revoke-user-sessions` means
 *    duplicating better-auth's ownership and freshness checks, and duplicated
 *    security checks are where bypasses live.
 *
 * ## How the cause is known
 *
 * better-auth dispatches every endpoint inside
 * `runWithEndpointContext(internalContext, …)` (`api/dispatch.mjs`), where
 * `internalContext.path` is the endpoint's own declared path. So
 * `getCurrentAuthContext().path` names the route the current adapter write is
 * serving — request-scoped, from the endpoint object rather than from a hook
 * that may not have run, and equally available to a programmatic `auth.api.*`
 * call because those route through the same dispatcher.
 *
 * No context (WebContainer's `AsyncLocalStorage`, which does not propagate
 * across `await` — the caveat `auth-actor-attribution.ts` documents; or a raw
 * engine write that never touches this adapter) resolves to `undefined`, and
 * every rule below then degrades to **today's behaviour: a plain delete**. The
 * audit row is lost, nothing is retained, and no session outlives its
 * revocation. Losing the record is the safe direction; keeping a session alive
 * would not be.
 *
 * ## Retention — why hiding, and not just stamping
 *
 * Measured, not assumed. better-auth 1.7.0-rc.2 has **no scheduled sweeper** of
 * session rows: the only expiry-driven collection in the whole library is
 * inside `GET /get-session`, which on finding a row whose `expiresAt` has passed
 * calls `internalAdapter.deleteSession(token)` to "clean up the session"
 * (`api/routes/session.mjs`). That single line is what makes the automatic
 * path's stamps best-effort today — and it would eat an interactive tombstone
 * the moment the revoked client polled once, which for a browser session is
 * seconds. Stamping alone therefore satisfies the letter of D4 and leaves the
 * trail as inert as it was.
 *
 * The collector only fires on a row it can see:
 *
 * ```js
 * const session = await ctx.context.internalAdapter.findSession(token);
 * if (!session || session.session.expiresAt < new Date()) {
 *   deleteSessionCookie(ctx);
 *   if (session) { … await ctx.context.internalAdapter.deleteSession(…); }
 *   return ctx.json(null);
 * }
 * ```
 *
 * So hiding the tombstone from the adapter's session reads ends the session
 * *harder* than expiring it — `findSession` answers `null`, the request is
 * unauthenticated, and `deleteSession` is never called, so the record survives.
 * It also removes, for free, two problems a "refuse the delete" rule would have
 * created: the `delete.before`/`after` hooks would otherwise **re-fire on every
 * stale-cookie poll** (re-dispatching back-channel logout — the same repeat
 * upstream guards against by restricting `endPreservedSessions` to live rows),
 * and a later `revoke-sessions` sweep would re-stamp an older tombstone and
 * overwrite the revocation time it was recording.
 *
 * ⚠️ **The cost, stated plainly: revoked rows are now retained indefinitely.**
 * There is no retention window, no TTL and no sweeper for `sys_session` — in
 * this repo or in better-auth. That is not a new *class* of growth (a session
 * abandoned without sign-out is already immortal for the same reason: nothing
 * ever presents its cookie again, so the one collector never runs on it), but a
 * retention policy for `sys_session` is genuinely unowned and is called out on
 * #7732 rather than invented here.
 *
 * ## Erasure is not collection
 *
 * One consequence of hiding has to be handled rather than accepted: user
 * deletion sweeps sessions with `deleteUserSessions(userId)`, and rows it cannot
 * see are rows it cannot erase. {@link SESSION_ERASURE_PATHS} lists the three
 * endpoints whose job is to remove the subject itself; under those, tombstones
 * are visible again and are physically deleted. Keeping an audit row about a
 * user the deployment has erased is the wrong trade.
 *
 * ## Deliberately NOT in the revoke ledger
 *
 * `POST /admin/ban-user` and `POST /admin/update-user` (with `banned: true`)
 * both drop the user's sessions, and both are admin-initiated. They stay plain
 * deletes: a ban already records itself, with far more detail, on
 * `sys_user.banned` / `ban_reason` / `ban_expires`, and #7732 scoped this fix
 * to the three interactive-revoke families. `POST /sign-out` stays a plain
 * delete too — signing yourself out is not a revocation, it has no cause in
 * `revoke_reason`'s vocabulary, and whether `logout` earns an audit record at
 * all is #7675's question, not this one. `/admin/stop-impersonating` ends an
 * impersonation session, not a real one.
 */

import type { IDataEngine } from '@objectstack/core';
import { SystemObjectName } from '@objectstack/spec/system';

/**
 * Endpoint path → the `revoke_reason` a session ended there should record.
 *
 * Paths are better-auth's own (`endpoint.path`), i.e. without the
 * `/api/v1/auth` base — that is what `getCurrentAuthContext().path` carries.
 *
 * ## The two values, and why not one
 *
 * `revoked_at`'s declared description names the interactive cause `admin`;
 * `revoke_reason` is free text (`Field.text({ maxLength: 64 })`) whose
 * description gives an open-ended list — `idle_timeout, absolute_max,
 * concurrent_cap, …`. There is no closed enum to violate, and
 * `sys-session.object.ts` is untouched by this change.
 *
 * Within that, admin-initiated and self-initiated revokes get **distinct**
 * values, because the field is the only thing in the row that says who ended
 * the session. Recording `admin` for a user clicking "sign out my other
 * devices" would not be a vague audit record, it would be a **wrong** one — it
 * names an actor class that took no action, which is worse for an auditor than
 * no record at all. `admin` therefore means exactly the two `/admin/*` routes,
 * and `user_revoked` means the session's own owner did it.
 */
export const INTERACTIVE_REVOKE_REASON: Readonly<Record<string, string>> = {
  // Self-service — the session owner acting on their own sessions.
  '/revoke-session': 'user_revoked',
  '/revoke-sessions': 'user_revoked',
  '/revoke-other-sessions': 'user_revoked',
  // Admin acting on someone else's sessions (better-auth `admin` plugin).
  '/admin/revoke-user-session': 'admin',
  '/admin/revoke-user-sessions': 'admin',
};

/**
 * Endpoints that ERASE the subject rather than ending a session.
 *
 * Under these, a tombstone stops being a record worth keeping and becomes data
 * about a user the deployment is removing: it is visible to better-auth's
 * session reads again, and its physical delete goes through untouched.
 */
export const SESSION_ERASURE_PATHS: ReadonlySet<string> = new Set([
  '/delete-user',
  '/delete-user/callback',
  '/admin/remove-user',
]);

/** Columns a tombstone write touches, in the shape `auth-manager.ts` writes. */
export interface SessionTombstonePatch {
  id: unknown;
  expires_at: Date;
  revoked_at: Date;
  revoke_reason: string;
}

/**
 * The better-auth endpoint path currently being served, or `undefined`.
 *
 * Never throws: `getCurrentAuthContext()` rejects when no endpoint context is
 * in scope, and the import itself is dynamic so this module stays loadable in
 * environments where `@better-auth/core`'s async-hooks shim is unavailable.
 */
export async function currentAuthEndpointPath(): Promise<string | undefined> {
  try {
    const { getCurrentAuthContext } = await import('@better-auth/core/context');
    const ctx: any = await getCurrentAuthContext();
    const path = ctx?.path;
    return typeof path === 'string' && path.length > 0 ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Is this row one the platform has already tombstoned? */
export function isRevokedSessionRow(row: unknown): boolean {
  return (row as { revoked_at?: unknown } | null | undefined)?.revoked_at != null;
}

/**
 * Should a `sys_session` row this read matched be hidden from better-auth?
 *
 * True for a tombstoned row on every path except {@link SESSION_ERASURE_PATHS}.
 * `objectName` is the resolved protocol object, so nothing but `sys_session` is
 * ever considered.
 */
export async function hideRevokedSessionRow(objectName: string, row: unknown): Promise<boolean> {
  if (objectName !== SystemObjectName.SESSION) return false;
  if (!isRevokedSessionRow(row)) return false;
  const path = await currentAuthEndpointPath();
  return !(path && SESSION_ERASURE_PATHS.has(path));
}

/**
 * {@link hideRevokedSessionRow} over a result set, resolving the endpoint path
 * once for the whole batch rather than once per row.
 */
export async function filterRevokedSessionRows<T>(objectName: string, rows: T[]): Promise<T[]> {
  if (objectName !== SystemObjectName.SESSION) return rows;
  if (!rows.some((row) => isRevokedSessionRow(row))) return rows;
  const path = await currentAuthEndpointPath();
  if (path && SESSION_ERASURE_PATHS.has(path)) return rows;
  return rows.filter((row) => !isRevokedSessionRow(row));
}

/**
 * Reconcile one physical `sys_session` delete with ADR-0069 D4.
 *
 * Returns `true` when the caller should go ahead and delete the row, `false`
 * when this call has been answered some other way (a tombstone was written, or
 * an existing tombstone was left alone).
 *
 * `row` must be the row already fetched by the caller — the adapter reads it to
 * resolve the id anyway, so this costs no extra query.
 */
export async function reconcileSessionDelete(
  engine: IDataEngine,
  objectName: string,
  row: { id?: unknown; revoked_at?: unknown } | null | undefined,
): Promise<boolean> {
  if (objectName !== SystemObjectName.SESSION || !row?.id) return true;

  const path = await currentAuthEndpointPath();
  const reason = path ? INTERACTIVE_REVOKE_REASON[path] : undefined;
  if (!reason) return true;

  // Already tombstoned: keep the revocation this row is recording. Upstream
  // restricts `endPreservedSessions` to live rows for the same reason — a
  // later sweep must not re-date an earlier ending.
  if (isRevokedSessionRow(row)) return false;

  const now = Date.now();
  const patch: SessionTombstonePatch = {
    id: row.id,
    // A second in the past, matching `enforceSessionControls` /
    // `enforceConcurrentCap`, so every `expiresAt < now` liveness check in the
    // library is strictly true even at millisecond resolution.
    expires_at: new Date(now - 1000),
    revoked_at: new Date(now),
    revoke_reason: reason,
  };
  await (engine as any).update(objectName, patch);
  return false;
}
