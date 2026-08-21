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
 * [#10424] That second bullet was still doing two jobs, and the half it did
 * badly is now its own cause. "Check that the object is declared" is correct
 * advice for an absent declaration and actively wrong during a metadata-store
 * OUTAGE, where the declaration is fine and the store is not. The distinction
 * was already being computed and thrown away: `MetadataManager` defines `get`
 * as `(await getDiagnosed(…)).data`, so the `degraded` verdict that separates
 * a MISS from an OUTAGE existed and was discarded one frame below this module
 * (#5840). `'metadata_unavailable'` is what reading it buys — asserted only on
 * a positive `degraded: true`, never inferred from a service that cannot
 * answer. The DENY is untouched in all three cases: #3545 fail-closed, same
 * `PermissionDeniedError`, same `PERMISSION_DENIED`, same 403.
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
 * Which of the conditions behind an unresolved posture this is.
 *
 * `'unknown'` is the honest default and the fail-safe: every probe that
 * distinguishes the others is best-effort (see `probeUnpublishedDraft` and
 * `probeMetadataOutage` in `security-plugin.ts`), so a deployment with no
 * queryable `sys_metadata`, a metadata service that does not implement the
 * optional `getDiagnosed` (#5840), or any probe failure at all reports
 * `'unknown'` and gets the wording that covers every case. The discriminator
 * may never turn a *real* unpublished object — or a *real* outage — into a
 * claim the platform cannot support.
 *
 * [#10424] `'metadata_unavailable'` is the third member, and it is the one the
 * fail-safe rule bites hardest on. `IMetadataService.get` is ambiguous by
 * construction — its own TSDoc says `undefined` means "not found" *and* "every
 * loader that could hold it failed" — so an outage and an absent declaration
 * arrived here as the same `unresolved: true` wearing the same sentence, and
 * that sentence told the reader to go check the declaration. `getDiagnosed`
 * already computes the `degraded` verdict that separates them; this member is
 * what consuming it buys. It is asserted ONLY when the service positively
 * reports `degraded: true`. A service that cannot report the distinction is
 * NOT an outage — "I don't know" must never be published as "the store is
 * down", which would be manufacturing false information in the opposite
 * direction from the defect this fixes.
 */
export type UnresolvedPostureCause =
  | 'unpublished_draft'
  | 'metadata_unavailable'
  | 'unknown';

/**
 * Compile-time exhaustiveness for the switches below, with a RUNTIME fallback
 * to the `'unknown'` wording rather than a throw.
 *
 * Both halves are deliberate. Adding a fourth cause without wording it is a
 * type error at build time (the assignment to `never` fails). But these
 * functions run on the middleware's already-refusing path, where an
 * unhandled throw would turn a correct `403 PERMISSION_DENIED` into a `500` —
 * so the runtime half degrades to the sentence that covers every case, which
 * is exactly this module's documented fail-safe.
 */
function assertCauseExhausted(cause: never): void {
  void cause;
}

/**
 * The remedy half — the sentence that tells the reader what to actually do, and
 * (just as load-bearing) what NOT to do. Shared by both surfaces so the advice
 * cannot diverge from the diagnosis.
 */
export function unresolvedPostureRemedy(cause: UnresolvedPostureCause): string {
  const unknown =
    'Check that the object is declared and published on this runtime. This is NOT a permissions '
    + 'problem — no sharing rule, visibility setting or permission-set change grants access to an '
    + 'object whose declaration cannot be read.';
  switch (cause) {
    case 'unpublished_draft':
      return 'Publish the object to make it queryable. This is NOT a permissions problem — no sharing rule, '
        + 'visibility setting or permission-set change grants access to an unpublished object.';
    // [#10424] Points at the STORE, not at the declaration. The old sentence
    // sent an operator mid-outage to re-check a declaration that was fine, and
    // that is the whole defect: a refusal naming the wrong remedy is worse than
    // a terse one, because the next reader's diagnosis is built on it.
    case 'metadata_unavailable':
      return 'Check the metadata store — the object may well be declared and published, and simply '
        + 'unreadable right now. Do NOT change the declaration on the strength of this message. This is '
        + 'NOT a permissions problem either — no sharing rule, visibility setting or permission-set '
        + 'change restores a read the metadata store could not serve.';
    case 'unknown':
      return unknown;
    default:
      assertCauseExhausted(cause);
      return unknown;
  }
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
  const unknown =
    `[Security] Access denied: the security posture of object '${object}' could not be resolved for `
    + `operation '${operation}' — neither the live schema nor the metadata service returned a `
    + `declaration for it, so access fails closed. ${remedy}`;
  switch (cause) {
    case 'unpublished_draft':
      return `[Security] Access denied: object '${object}' is not published — a draft declaration exists but `
        + `no published one, so there is no security posture to authorize '${operation}' against. ${remedy}`;
    // [#10424] Keeps the SAME opening clause as the `'unknown'` branch, verbatim
    // through "could not be resolved for operation '…'", so anything pinning
    // that substring keeps matching; only what follows the em dash differs. The
    // divergence is the factual half: we are not claiming a declaration is
    // absent, because a degraded read cannot support that claim.
    case 'metadata_unavailable':
      return `[Security] Access denied: the security posture of object '${object}' could not be resolved for `
        + `operation '${operation}' — the metadata service reported its own read as DEGRADED, so whether a `
        + `declaration exists is UNKNOWN rather than answered, and access fails closed. ${remedy}`;
    case 'unknown':
      return unknown;
    default:
      assertCauseExhausted(cause);
      return unknown;
  }
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
  const unknown =
    `The security posture of '${object}' could not be resolved (neither the live schema nor the `
    + `metadata service returned it) — its 'private' flag and required-capability contract are `
    + `unknown, so access fails CLOSED rather than defaulting to public/uncontracted (#3545). ${remedy}`;
  switch (cause) {
    case 'unpublished_draft':
      return `'${object}' is not published — a draft declaration exists but no published one, so its 'private' `
        + `flag and required-capability contract are unknown and access fails CLOSED rather than `
        + `defaulting to public/uncontracted (#3545). ${remedy}`;
    case 'metadata_unavailable':
      return `The security posture of '${object}' could not be resolved: the metadata service reported its `
        + `own read as DEGRADED, so this is a metadata-store OUTAGE and not necessarily an absent `
        + `declaration. Its 'private' flag and required-capability contract are unknown, so access fails `
        + `CLOSED rather than defaulting to public/uncontracted (#3545). ${remedy}`;
    case 'unknown':
      return unknown;
    default:
      assertCauseExhausted(cause);
      return unknown;
  }
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
  const unknown =
    `[security] object security posture unresolvable for operation '${operation}' on `
    + `object '${object}' (user ${userId}) — denying request (fail-closed, #3545)`;
  switch (cause) {
    case 'unpublished_draft':
      return `[security] object '${object}' has a DRAFT declaration and no published one — denying operation `
        + `'${operation}' (user ${userId}) with the unpublished-object refusal (fail-closed, #3545/#10401)`;
    // [#10424] The operator-facing half of the split, and the reason the log
    // line is worth changing at all: a metadata-store outage is an INCIDENT and
    // a query against a missing object is routine, and they were the same line.
    // `DEGRADED` and `OUTAGE` are here to be grep-able.
    case 'metadata_unavailable':
      return `[security] object security posture unresolvable for operation '${operation}' on `
        + `object '${object}' (user ${userId}) — the metadata service reported a DEGRADED read, i.e. a `
        + `metadata-store OUTAGE rather than an absent declaration — denying request `
        + `(fail-closed, #3545/#10424)`;
    case 'unknown':
      return unknown;
    default:
      assertCauseExhausted(cause);
      return unknown;
  }
}
