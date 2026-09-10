// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17130] The row-scope fail-closed refusals, in the ADR-0112 envelope.
 *
 * ## What was wrong
 *
 * The row-level read scope is established in two stages, and only the second
 * one declared itself:
 *
 *   1. **resolution** — ask the wired provider which rows this caller may see
 *      (`plugin.ts`'s `security` bridge, then `AnalyticsService.resolveReadScopes`).
 *      Both stages refuse fail-closed when the provider cannot answer, and both
 *      refused with a bare `throw new Error(…)`.
 *   2. **lowering** — compile the `FilterCondition` that came back into SQL
 *      (`read-scope-sql.ts`), which has answered `READ_SCOPE_COMPILE_FAILED` /
 *      500 through its own module-local constructor since #5367.
 *
 * A bare refusal is the one kind `queryDataset`'s catch classifies by WORDING:
 * `hasDeclaredErrorEnvelope` re-throws anything its producer classified, and
 * only what nobody classified reaches {@link isMissingSourceError} — six
 * substrings, three of which (`not registered`, `unknown object`,
 * `is not a registered object`) are exactly what a registry or security
 * refusal reaches for. A hit there is not a wrong status code, it is
 * `{rows: [], fields: [], totals: []}` — a fail-closed security gate served to
 * the caller as a confident empty chart, with one `warn` and no exception.
 *
 * The two messages happen to match none of the six today. ⛔ That is a
 * coincidence, not a construction, and #17130 exists to remove it rather than
 * to keep picking lucky strings. Declaring the envelope answers the
 * classification question at the producer, where it is known, so no reword of
 * these messages — and no message the resolution stage grows later — can ever
 * reach the sniffer again.
 *
 * ## Why `READ_SCOPE_COMPILE_FAILED` and not a new code
 *
 * The condition is the one `read-scope-sql.ts`'s ten refusals already carry:
 * **the row-level read scope could not be established, so the query is refused
 * fail-closed, and neither input is the caller's.** Resolution and lowering are
 * two stages of one pipeline with one outcome; giving them two wire spellings
 * would be the defect ADR-0112 exists to remove — the same argument
 * `dataset-refusal.ts` records for putting member-level refusals on the
 * neighbouring gates' `INVALID_FIELD` rather than minting a second code.
 *
 * The 500 is what #5367's maintainer ruling (2026-08-06) settled for this
 * family, and both halves of that ruling apply here verbatim:
 *
 *   - **Attribution.** The inputs are a `security` service the deployment wired
 *     and a provider contract it failed to honour. A 4xx would tell the caller
 *     to fix a request that was never the problem, and hide the fault from the
 *     5xx alerting that should see it.
 *   - **Disclosure.** The route withholds the message of any producer that
 *     declares a server fault, so `read-scope resolution failed for "x"` stops
 *     at the operator's log instead of telling a tenant that this deployment's
 *     security service is broken. ⛔ Note the direction: declaring the envelope
 *     REMOVES disclosure that a bare 500 leaks today. Nothing here makes any
 *     refusal likelier to degrade — every path this changes moves from
 *     "classified by its words" to "classified by its declaration".
 *
 * So no ledger row is added: `READ_SCOPE_COMPILE_FAILED` is already registered
 * to `@objectstack/service-analytics` in `error-code-ledger.zod.ts`
 * (ADR-0112 D3), which is what keeps this a Clause-② `no`.
 *
 * ## Why a second constructor rather than importing `readScopeCompileError`
 *
 * That one is deliberately module-local — *"the only way this module refuses"*
 * — and its messages are `[read-scope-sql]`-prefixed lowering diagnostics. This
 * file is the resolution stage's counterpart, and it is a MODULE rather than a
 * private helper for one reason: the stage spans two files (`plugin.ts` raises
 * the bridge's refusal, `analytics-service.ts` the pre-pass's), and two
 * spellings of one envelope is how a half-enveloped surface starts — the lesson
 * #5352 paid for when seven of `filter-normalizer.ts`'s nine sites stayed bare.
 *
 * ⛔ One code, two constructors, one condition. A third refusal in this stage
 * belongs here too, not in a new spelling of the same thing.
 */

import type { RegisteredErrorCode } from '@objectstack/spec/api';

/**
 * `READ_SCOPE_COMPILE_FAILED`, pinned against the ADR-0112 D3 ledger.
 *
 * Typed as `RegisteredErrorCode` so dropping the ledger row (or misspelling the
 * code here) fails `tsc` rather than shipping a code `ApiErrorSchema` rejects —
 * the same load-bearing annotation `read-scope-sql.ts` and `dataset-refusal.ts`
 * carry.
 */
const READ_SCOPE_COMPILE_FAILED: RegisteredErrorCode = 'READ_SCOPE_COMPILE_FAILED';

/**
 * A row-scope RESOLUTION failure in the ADR-0112 envelope —
 * `READ_SCOPE_COMPILE_FAILED` / 500.
 *
 * Use it where a wired row-scope provider could not be asked or could not
 * answer, and the query is therefore refused fail-closed. ⛔ Not for a caller's
 * mistake (that is `dataset-refusal.ts`) and ⛔ not for an ABSENT provider,
 * which is a different state entirely: a deployment with no security service is
 * one where `/data` has no row-level policy either, it is reported loudly at
 * init, and it must keep running unscoped exactly as before.
 *
 * The message stays whatever the refusing site says — it is for the operator's
 * log, which after this change is its only destination.
 */
export function readScopeUnresolvedError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = READ_SCOPE_COMPILE_FAILED;
  err.status = 500;
  return err;
}
