// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9714] `POST /revoke-session` — a revoke that identifies NO record must not
 * report success.
 *
 * ## The defect, and where it is minted
 *
 * Not here: the wrong answer comes out of the pinned vendor. better-auth
 * `1.7.1` (the installed line — re-measured for #9714 after the #3002 family
 * move off `1.7.0-rc.2`), `dist/api/routes/session.mjs`, `revokeSession` runs:
 *
 * ```js
 * const token = ctx.body.token;
 * if ((await ctx.context.internalAdapter.findSession(token))?.session.userId
 *       === ctx.context.session.user.id) try {
 *   await ctx.context.internalAdapter.deleteSession(token);
 * } catch (error) { … throw INTERNAL_SERVER_ERROR … }
 * return ctx.json({ status: true });
 * ```
 *
 * The final line is unconditional. When the supplied token matches zero rows —
 * or a row belonging to someone else (1.7.1's new ownership guard, absent on
 * the rc line #8018 originally measured) — the delete is skipped and the
 * endpoint still answers `200 { status: true }`. A security control that
 * no-ops while telling the operator it worked. Measured behaviourally on this
 * repo's real pipeline (AuthManager.handleRequest → better-auth 1.7.1 →
 * ObjectQL adapter): zero-match and foreign-token both answered
 * `200 {"status":true}` with the target row untouched.
 *
 * ## The fix: a before-hook admission gate, vendor predicate reproduced
 *
 * The vendor is not ours to edit, so the correction happens at our bridge, in
 * the global `hooks.before` — the same seam and for the same reason as the
 * `/organization/remove-member` guard (`remove-member-permission-guard.ts`):
 * an after-hook can replace a body but not a status, and this fix's whole
 * point is that the transport-visible answer stops being a success.
 *
 * The admission predicate is the vendor's own, reproduced rather than
 * redesigned: `findSession(token)?.session.userId === <caller's user id>`,
 * asked through the same `ctx.context.internalAdapter.findSession` call the
 * handler itself makes one moment later. Whenever the guard admits, the
 * vendor's own condition holds on the same data, so the delete it performs is
 * the one the answer claims. Whenever the guard refuses, the vendor would have
 * no-oped. (`session-tombstone.ts` refused the route boundary because
 * re-implementing revoke means duplicating ownership checks; this guard
 * duplicates nothing — it asks the vendor's exact question through the
 * vendor's exact adapter call, and the handler still re-decides everything it
 * owns.)
 *
 * ## The refusal shape, decided deliberately
 *
 * A zero-match revoke is arguably "not found" and arguably "nothing to do".
 * This guard answers **404 `RESOURCE_NOT_FOUND`** (ADR-0112: code AND status),
 * for three reasons:
 *
 *  1. A `200 { status: false }` would still read as success to every caller
 *     that checks `res.ok` — which is exactly the class of caller (scripts, AI
 *     clients) this route now has, since the console refuses before dispatch
 *     (objectui#4670). The false-success defect would survive its own fix.
 *  2. DELETE-like semantics: a mutation naming a specific resource that cannot
 *     be identified is a failed request, and 404 is its established spelling.
 *     Idempotent-retry callers treat a 404 on the second attempt as settled.
 *  3. `RESOURCE_NOT_FOUND` is the standard-catalog member for this condition.
 *     Registering a `SESSION_NOT_FOUND` extension would be a semantic synonym
 *     of a standard member, which the ledger's #8211 admission rule refuses.
 *
 * ## No existence oracle
 *
 * A token that matches nothing and a token that matches ANOTHER USER's live
 * session answer **byte-identically** (same status, same code, same message).
 * The vendor's own skip path already treats them identically; the guard
 * preserves that. The refusal reveals only "no session of YOURS carries this
 * token" — a fact the caller is entitled to, since `list-sessions` hands the
 * owner their own token list. `revoke-session-match-guard.test.ts` pins the
 * two answers equal.
 *
 * ## What the guard deliberately does NOT decide
 *
 *  - **Unauthenticated / unresolvable callers fall through** — better-auth's
 *    `sensitiveSessionMiddleware` owns that refusal (401), and pre-empting it
 *    would turn "who are you" into "does X exist". Same posture as the
 *    `/sso/register` and `/organization/remove-member` gates.
 *  - **A non-string `token` falls through** — the endpoint's own zod body
 *    schema answers the 400.
 *  - **Session freshness stays the vendor's.** `sensitiveSessionMiddleware`
 *    also enforces freshness, after this hook; a stale-but-valid caller with a
 *    zero-match token gets this guard's 404 rather than the vendor's staleness
 *    refusal. Both are refusals; duplicating the freshness predicate here to
 *    restore the vendor's precedence would be a second spelling of a security
 *    check, which is where bypasses live.
 *  - **An adapter read failure falls through** — the guard never converts "I
 *    could not look" into "it does not exist"; the vendor's handler owns its
 *    own error path.
 *
 * ## Interaction with session tombstones (#7732)
 *
 * `hideRevokedSessionRow` makes a tombstoned row invisible to
 * `internalAdapter.findSession`, so revoking an ALREADY-REVOKED token now
 * answers 404 — consistent with that module's own doctrine ("a revoked session
 * is not a session"), and previously a silent `{ status: true }` no-op through
 * the same unconditional-success line.
 *
 * ## Scope
 *
 * `/revoke-session` only — the route #8018/#9714 measured, the one that takes
 * a caller-supplied match key. `/revoke-sessions` and `/revoke-other-sessions`
 * match by the CALLER's user id, so they cannot mis-identify; zero sessions to
 * sweep is genuinely "nothing to do", not a mis-identified record. The admin
 * plugin's `/admin/revoke-user-session` has the same defect class upstream
 * (unconditional `{ success: true }`) and is tracked separately — it is a
 * different permission surface with a different answer key, not a rider here.
 */

/** The refusal's wire code — standard catalog (ADR-0112), see header. */
export const REVOKE_SESSION_NOT_FOUND_CODE = 'RESOURCE_NOT_FOUND';

/**
 * The refusal's message. One string for zero-match and foreign-token alike —
 * the byte-equality is load-bearing (no existence oracle, see header).
 */
export const REVOKE_SESSION_NOT_FOUND_MESSAGE =
  'No session of yours matches the supplied token.';

/**
 * The vendor's own admission predicate, reproduced: does `found` (the
 * `internalAdapter.findSession` result) name a session belonging to
 * `callerUserId`?
 *
 * Shape-tolerant on purpose: `findSession` answers `{ session, user }` (or
 * `null`), and the comparison is the handler's own
 * `found?.session.userId === user.id`. Anything unreadable is "no match" —
 * which is also what the vendor's optional-chain makes of it.
 */
export function revokeTargetsCallerSession(found: unknown, callerUserId: string): boolean {
  if (!callerUserId) return false;
  const session = (found as { session?: { userId?: unknown } } | null | undefined)?.session;
  const owner = session?.userId;
  return owner != null && String(owner) === callerUserId;
}
