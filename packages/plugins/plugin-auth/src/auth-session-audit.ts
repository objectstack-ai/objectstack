// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8144, sub-issue A of #7675] `login` / `logout` in the compliance ledger —
 * the AUTH half.
 *
 * ## What was missing
 *
 * `sys_audit_log.action` declares `login` and `logout`; nothing in the repo
 * ever wrote either. The only trace a sign-in left was an unattributed `update
 * sys_user` row (`user_id` null) diffing `last_login_at`, so the shipped
 * `auth_events` list view was empty by construction. The maintainer ruling of
 * 2026-08-12 on #7675 named the fix and the seam:
 *
 *   > **补 writer(3 个)**:`login` / `logout`(auth 事件已有钩点,顺带解决那条
 *   > `user_id` null 的未归因 `last_login_at` diff 行)…
 *
 * ## The hook points, and why these two
 *
 * Both are better-auth `databaseHooks` on the session model, composed in
 * `AuthManager.composeDatabaseHooks`:
 *
 *  - **`session.create.after` ⇒ `login`.** A session row IS a sign-in, whatever
 *    minted it — `/sign-in/email`, sign-up auto-sign-in, SSO, OAuth callback,
 *    magic link, email OTP, passkey. Branching on `/sign-in/email` in the
 *    endpoint middleware instead (where `stampLastLogin` lives) would have
 *    audited exactly one of those and silently missed every federated login,
 *    which on a real deployment is most of them.
 *  - **`session.delete.after` under `/sign-out` ⇒ `logout`.** Ending a session
 *    is the only thing a sign-out does, and the deleted row is handed to the
 *    hook, so the actor is known even though the request no longer has a
 *    session.
 *
 * ## Why logout is scoped to `/sign-out`
 *
 * A session row is deleted for many reasons that are not a logout: an admin
 * revoke, `/revoke-session` on another device, ban, user erasure, and
 * better-auth's own collection of an expired row inside `GET /get-session`.
 * Recording those as `logout` would not be a vague audit record, it would be a
 * **wrong** one — it names an action the subject did not take. The revoke
 * families already have their own trail (ADR-0069 D4 tombstones,
 * `session-tombstone.ts`), which is why that module left this question open:
 * "whether `logout` earns an audit record at all is #7675's question, not this
 * one."
 *
 * ## Why the endpoint path comes from the hook's `context` argument
 *
 * `deleteWithHooks` resolves `getCurrentAuthContext()` once, at entry, and
 * hands the result to every `delete.after` hook — but it runs those hooks
 * inside `queueAfterTransactionHook`, i.e. deferred. Calling
 * `currentAuthEndpointPath()` from inside the deferred callback asks the
 * AsyncLocalStorage a question it may no longer be able to answer, and on
 * WebContainer (whose `node:async_hooks` does not propagate across `await`)
 * it never could. The captured argument is the same value, taken at a moment it
 * is guaranteed present. No context at all ⇒ the cause is unknown ⇒ no row:
 * losing the record is the safe direction, inventing one is not.
 */

/**
 * The audit sink's shape, declared LOCALLY so plugin-auth takes no runtime
 * dependency on plugin-audit — the mirror of `MessagingEmitSurface` /
 * `AuditI18nSurface` in `plugin-audit/src/audit-writers.ts`, which declare
 * messaging and i18n the same way for the same reason. The real implementation
 * is `createAuthEventAuditSink` in that package, registered under the `audit`
 * service slot; absent (audit plugin not installed) ⇒ no rows, no error.
 *
 * `action` is a closed literal union on purpose. Every `sys_audit_log` field is
 * `readonly` and `validateRecord` skips readonly/system fields on both
 * branches (#8203), so the declared enum validates nothing in either
 * direction — a misspelled action would be accepted silently, at both ends.
 * This union is the only thing standing between an author and that row.
 */
export interface AuthEventAuditSurface {
  recordAuthEvent(event: {
    action: 'login' | 'logout';
    userId: string;
    sessionId?: string;
    organizationId?: string;
    ipAddress?: string;
    userAgent?: string;
    actor?: string;
    context?: Record<string, unknown>;
  }): Promise<unknown>;
}

/** The event this module hands the sink, before it becomes a ledger row. */
export type AuthSessionAuditEventInput = Parameters<
  AuthEventAuditSurface['recordAuthEvent']
>[0];

/**
 * better-auth's session row, as the `databaseHooks` see it: camelCase field
 * names, mapped back from the `sys_session` columns by the ObjectQL adapter
 * (`auth-schema-config.ts` owns that mapping).
 */
interface BetterAuthSessionRow {
  id?: unknown;
  userId?: unknown;
  activeOrganizationId?: unknown;
  ipAddress?: unknown;
  userAgent?: unknown;
  /** Set by better-auth's admin plugin on an impersonation session. */
  impersonatedBy?: unknown;
}

/** The endpoint whose whole job is ending the caller's own session. */
export const SIGN_OUT_PATH = '/sign-out';

/** A non-empty string, or undefined — never `''`, never `String(undefined)`. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Map a created session row to the `login` event, or `null` when the row names
 * no subject (nothing to attribute — and an unattributed auth row is the defect
 * this card exists to remove, so it is better not written).
 *
 * `path` is the better-auth endpoint that minted the session; it is recorded as
 * context, never used to gate — every session creation is a login.
 */
export function loginEventFor(
  session: BetterAuthSessionRow | null | undefined,
  path?: string,
): AuthSessionAuditEventInput | null {
  const userId = str(session?.userId);
  if (!userId) return null;
  // An impersonation session belongs to its subject but was STARTED by an
  // admin. `user_id` keeps the subject (the session really is theirs, and the
  // lookup must still join); `actor` names the principal that acted, which is
  // exactly what that field is for. Dropping the row instead would hide the
  // single most sensitive session creation in the system.
  const impersonatedBy = str(session?.impersonatedBy);
  const context: Record<string, unknown> = {};
  if (path) context.endpoint = path;
  if (impersonatedBy) context.impersonated_by = impersonatedBy;
  return {
    action: 'login',
    userId,
    sessionId: str(session?.id),
    organizationId: str(session?.activeOrganizationId),
    ipAddress: str(session?.ipAddress),
    userAgent: str(session?.userAgent),
    ...(impersonatedBy ? { actor: impersonatedBy } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
  };
}

/**
 * Map a deleted session row to the `logout` event, or `null` when this delete
 * is not a sign-out (see the module note: a revoke, a ban, an erasure and the
 * expired-row collector all reach the same hook, and none of them is a logout).
 */
export function logoutEventFor(
  session: BetterAuthSessionRow | null | undefined,
  path?: string,
): AuthSessionAuditEventInput | null {
  if (path !== SIGN_OUT_PATH) return null;
  const userId = str(session?.userId);
  if (!userId) return null;
  return {
    action: 'logout',
    userId,
    sessionId: str(session?.id),
    organizationId: str(session?.activeOrganizationId),
    ipAddress: str(session?.ipAddress),
    userAgent: str(session?.userAgent),
    context: { endpoint: path },
  };
}

/**
 * Hand one event to the sink, swallowing everything.
 *
 * Auth must never fail on bookkeeping: the sign-in has already happened, the
 * session is on disk, and the user is holding a valid token. The sink itself
 * reports a lost row at `error` (once per process) — that is where the
 * durability report belongs, and duplicating it here would double every line.
 */
export async function emitAuthSessionAuditEvent(
  sink: AuthEventAuditSurface | undefined,
  event: AuthSessionAuditEventInput | null,
): Promise<void> {
  if (!sink || !event || typeof sink.recordAuthEvent !== 'function') return;
  try {
    await sink.recordAuthEvent(event);
  } catch {
    /* never break the auth response — the sink already reported it */
  }
}
