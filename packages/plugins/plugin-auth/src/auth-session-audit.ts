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
 *
 * ## Account events: a refused sign-in, and a lockout
 *
 * A session hook cannot see a sign-in that did not succeed — no session row is
 * ever minted for it. So the password sign-in's own outcome, observed in
 * `AuthManager`'s `/sign-in/email` middleware where the ADR-0069 D2 lockout is
 * enforced, is the seam for the two account events:
 *
 *  - **`login_failed`** — one per refused `/sign-in/email` that names an
 *    existing account: refused by the credential check (the after-hook's
 *    returned error) or by the lockout gate before it (the before-hook).
 *  - **`account_locked`** — one each time the lockout is STAMPED on the
 *    account, i.e. the refused attempt that reaches the threshold.
 *
 * Both name the account the sign-in resolved to, the outcome (the action plus
 * the refusal's machine code), and the client fingerprint read by the same rule
 * the session hook applies when it stamps a session row — so a refused attempt
 * and a successful one from the same client carry the same `ip_address`.
 *
 * ⛔ Neither event carries anything the caller typed. The password is never
 * read here, and the submitted identifier is never recorded either: the row
 * names the RESOLVED account's id, and an identifier that resolves to no
 * account produces no row (an auth row without a subject is the shape this
 * module already refuses to write, above).
 */

import { getIP } from '@better-auth/core/utils/ip';
import { canonicalClientAddress } from './client-address-canonical.js';

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
    action: 'login' | 'logout' | 'login_failed' | 'account_locked';
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

/** The password sign-in endpoint — the one the ADR-0069 D2 lockout governs. */
export const SIGN_IN_EMAIL_PATH = '/sign-in/email';

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

/** The client fingerprint an account event carries. */
export interface SignInClientFingerprint {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Read the client fingerprint of a sign-in request by the rule a session row
 * is stamped by, which is where every `login` row's `ip_address` comes from:
 * `establishedAddress` — the address the server established for the request,
 * which the caller reads from `handleRequest`'s request state
 * (`readRequestClientAddress`) — else better-auth's own
 * `getIP(headers, options)` over the endpoint's headers, either in its
 * RFC 5952 text (`client-address-canonical.ts`); and the `user-agent` header.
 * A refused sign-in mints no session row to copy them from, so the same
 * resolution is applied to the same request instead. ⛔ Not a second IP rule:
 * the session hook (`auth-manager-database-hooks.ts`, `session.create.before`)
 * answers the same two sources in the same order.
 */
export function signInClientFingerprint(ctx: unknown, establishedAddress?: string): SignInClientFingerprint {
  const c = ctx as { headers?: unknown; request?: { headers?: unknown }; context?: { options?: unknown } } | null;
  const headers = (c?.headers ?? c?.request?.headers) as Headers | undefined;
  if (!headers || typeof (headers as Headers).get !== 'function') return {};
  let ipAddress = str(establishedAddress);
  if (!ipAddress) {
    try {
      const options = c?.context?.options as Parameters<typeof getIP>[1] | undefined;
      ipAddress = options ? str(getIP(headers, options)) : undefined;
    } catch {
      ipAddress = undefined;
    }
  }
  ipAddress = canonicalClientAddress(ipAddress);
  const userAgent = str(headers.get('user-agent'));
  return {
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

/** A machine error code: SCREAMING_SNAKE, bounded — never free text. */
const REFUSAL_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * The refusal's machine code (`INVALID_EMAIL_OR_PASSWORD`, `ACCOUNT_LOCKED`, …)
 * off better-auth's returned `APIError`, or undefined. Only a value shaped as
 * an error code is taken, so nothing but a constant from the refusing
 * endpoint's vocabulary can reach the row.
 */
export function refusalCodeOf(returned: unknown): string | undefined {
  const body = (returned as { body?: { code?: unknown } } | null | undefined)?.body;
  const code = typeof body?.code === 'string' ? body.code : undefined;
  return code && REFUSAL_CODE.test(code) ? code : undefined;
}

/**
 * The `login_failed` event for a refused password sign-in, or `null` when no
 * account was resolved (no subject ⇒ no row; see the module note).
 */
export function signInFailureEventFor(
  userId: string | null | undefined,
  outcome: { path: string; reason?: string; fingerprint?: SignInClientFingerprint },
): AuthSessionAuditEventInput | null {
  const subject = str(userId);
  if (!subject) return null;
  const context: Record<string, unknown> = { endpoint: outcome.path };
  if (outcome.reason) context.reason = outcome.reason;
  return {
    action: 'login_failed',
    userId: subject,
    ...(outcome.fingerprint ?? {}),
    context,
  };
}

/**
 * The `account_locked` event for the refused sign-in that stamped the ADR-0069
 * D2 lockout, or `null` when no account was resolved.
 */
export function accountLockedEventFor(
  userId: string | null | undefined,
  lock: { path: string; lockedUntil: Date; threshold: number; fingerprint?: SignInClientFingerprint },
): AuthSessionAuditEventInput | null {
  const subject = str(userId);
  if (!subject) return null;
  const until = lock.lockedUntil instanceof Date && !Number.isNaN(lock.lockedUntil.getTime())
    ? lock.lockedUntil.toISOString()
    : undefined;
  return {
    action: 'account_locked',
    userId: subject,
    ...(lock.fingerprint ?? {}),
    context: {
      endpoint: lock.path,
      ...(until ? { locked_until: until } : {}),
      threshold: lock.threshold,
    },
  };
}

/**
 * Hand one event to the sink, swallowing everything.
 *
 * Auth must never fail on bookkeeping: for a session event the sign-in has
 * already happened, the session is on disk, and the user is holding a valid
 * token; for an account event the refusal is already decided, and the audit
 * row must not change it. The sink itself
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
