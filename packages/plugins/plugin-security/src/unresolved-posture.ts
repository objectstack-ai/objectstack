// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10401] The ONE wording for "this object has no resolvable security posture",
 * shared by the two surfaces that state it: the middleware's fail-closed throw
 * (`security-plugin.ts`, the #3545 branch) and the explain engine's
 * `object_crud` layer detail (`explain-engine.ts`).
 *
 * ## Why the wording is a module rather than two string literals
 *
 * They were two literals, and the pair is exactly the drift this file removes:
 * enforcement and explanation are supposed to describe one decision, and a
 * reader who is told two different things about the same refusal cannot tell
 * which one is the platform's actual position. Both sentences are now derived
 * from the same {@link unresolvedPostureRemedy}, so a future edit to the remedy
 * cannot land on one surface only.
 *
 * ## What was wrong with the sentence (the reason this file exists)
 *
 * The deny itself is correct and stays fail-closed — #3545's stance is
 * untouched here, and nothing in this file widens access. What was wrong was
 * the EXPLANATION. One string, "the security posture of object 'X' could not be
 * resolved", covered two conditions with two different remedies:
 *
 *   • the object exists only as an unpublished DRAFT — the remedy is *publish
 *     it*, and the author's declaration is perfectly fine;
 *   • the declaration genuinely cannot be read — the remedy is to check that
 *     the object is declared at all, or to look at a metadata-store outage.
 *
 * …and because it described an internal *security* step, every reader — human
 * and model alike — read it as a permissions problem and went looking for a
 * sharing rule to change. Measured downstream (objectstack-ai/cloud#1481): an
 * end-user AI turn spent seven tool calls oscillating between a metadata plane
 * that said the object existed and this refusal, then told the user the object
 * was "missing its sharing/visibility setting" — confident and wrong, on a free
 * plan whose daily allowance that one turn exhausted.
 *
 * Hence both sentences below end by saying, in words, that permissions are not
 * the lever. A refusal that names the wrong remedy is worse than a terse one:
 * it is actively load-bearing for the next reader's diagnosis.
 *
 * ## Why the `[Security] Access denied` prefix survives
 *
 * It is a MATCHER, not house style — `isPermissionDeniedError`, `mapDataError`
 * and the rest-server sanitiser all read it as "this is a 403" (see the
 * `errors.ts` header). The refusal keeps `PermissionDeniedError`'s
 * `PERMISSION_DENIED` / 403 contract unchanged, so nothing on the wire moves;
 * only what the message SAYS about the cause and the remedy changes.
 *
 * The cause is carried in the message rather than in `details` for the reason
 * `errors.ts` already records: `details` is not a reliable carrier across both
 * transports, so each of these sentences has to stand on its own.
 */

/**
 * Which of the two conditions behind an unresolved posture this is.
 *
 * `'unknown'` is the honest default and the fail-safe: the draft probe that
 * distinguishes the two is best-effort (see `probeUnpublishedDraft` in
 * `security-plugin.ts`), so a deployment with no queryable `sys_metadata` — or
 * any probe failure at all — reports `'unknown'` and gets the wording that
 * covers both cases. The discriminator may never turn a *real* unpublished
 * object into a claim the platform cannot support.
 */
export type UnresolvedPostureCause = 'unpublished_draft' | 'unknown';

/**
 * The remedy half — the sentence that tells the reader what to actually do, and
 * (just as load-bearing) what NOT to do. Shared by both surfaces so the advice
 * cannot diverge from the diagnosis.
 */
export function unresolvedPostureRemedy(cause: UnresolvedPostureCause): string {
  return cause === 'unpublished_draft'
    ? 'Publish the object to make it queryable. This is NOT a permissions problem — no sharing rule, '
      + 'visibility setting or permission-set change grants access to an unpublished object.'
    : 'Check that the object is declared and published on this runtime. This is NOT a permissions '
      + 'problem — no sharing rule, visibility setting or permission-set change grants access to an '
      + 'object whose declaration cannot be read.';
}

/**
 * The end-user/API-facing refusal thrown by the middleware's #3545 branch.
 *
 * The `'unknown'` branch keeps the pre-#10401 opening clause verbatim — "the
 * security posture of object 'X' could not be resolved for operation 'Y'" — so
 * any surface pinning that substring keeps matching; what follows it is new.
 */
export function unresolvedPostureDenialMessage(
  object: string,
  operation: string,
  cause: UnresolvedPostureCause,
): string {
  const remedy = unresolvedPostureRemedy(cause);
  return cause === 'unpublished_draft'
    ? `[Security] Access denied: object '${object}' is not published — a draft declaration exists but `
      + `no published one, so there is no security posture to authorize '${operation}' against. ${remedy}`
    : `[Security] Access denied: the security posture of object '${object}' could not be resolved for `
      + `operation '${operation}' — neither the live schema nor the metadata service returned a `
      + `declaration for it, so access fails closed. ${remedy}`;
}

/**
 * The explain engine's `object_crud` layer detail for the same condition.
 *
 * Reports on the existing layer (no new layer kind) for the reason the call
 * site records: the posture is what that layer's grant is computed FROM, so
 * naming the real cause there beats a misleading "no set grants it" when the
 * sets were never the problem.
 */
export function unresolvedPostureExplainDetail(
  object: string,
  cause: UnresolvedPostureCause,
): string {
  const remedy = unresolvedPostureRemedy(cause);
  return cause === 'unpublished_draft'
    ? `'${object}' is not published — a draft declaration exists but no published one, so its 'private' `
      + `flag and required-capability contract are unknown and access fails CLOSED rather than `
      + `defaulting to public/uncontracted (#3545). ${remedy}`
    : `The security posture of '${object}' could not be resolved (neither the live schema nor the `
      + `metadata service returned it) — its 'private' flag and required-capability contract are `
      + `unknown, so access fails CLOSED rather than defaulting to public/uncontracted (#3545). ${remedy}`;
}

/**
 * The operator-facing log line for the same condition, so a persistent
 * metadata-store outage and a routine "somebody queried a draft" are
 * distinguishable in the logs and not only in the response body.
 */
export function unresolvedPostureLogLine(
  object: string,
  operation: string,
  userId: string,
  cause: UnresolvedPostureCause,
): string {
  return cause === 'unpublished_draft'
    ? `[security] object '${object}' has a DRAFT declaration and no published one — denying operation `
      + `'${operation}' (user ${userId}) with the unpublished-object refusal (fail-closed, #3545/#10401)`
    : `[security] object security posture unresolvable for operation '${operation}' on `
      + `object '${object}' (user ${userId}) — denying request (fail-closed, #3545)`;
}
