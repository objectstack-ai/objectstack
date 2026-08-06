// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5367] The dataset refusals this service raises, in the ADR-0112 envelope.
 *
 * ## Why this file exists
 *
 * `/analytics/dataset/query` classifies a thrown error by reading its `code` +
 * 4xx `status` (#5352 / PR #5366). Five refusals in this package were still bare
 * `throw new Error(…)`, so the route could not read them at all — and they only
 * kept answering `400 DATASET_INVALID` because the catch carried a hardcoded
 * list of message SUBSTRINGS as a transitional fallback:
 *
 * ```
 * /not declared in the dataset|not backed by a declared relationship|
 *  not supported by the v1 dataset runtime|read-scope-sql|
 *  not a selected dimension or measure|is not a subset of the selected dimensions/
 * ```
 *
 * Prime Directive #12 allows an accommodation like that only while it is
 * declared, loud, tested **and removable on a schedule**. #5366 delivered the
 * first three and nothing carried the fourth, which made the HTTP status of five
 * error families a property of their WORDING: rephrasing
 * "is not declared in the dataset's `include`" — no logic change, no test red, no
 * gate red — silently moved that refusal from 400 to 500, i.e. re-opened #5352
 * for a different family. #5367 is that schedule; this constructor is how the
 * five families leave the list.
 *
 * ## The envelope, and why it is `DATASET_INVALID` / 400
 *
 * Same shape as `filter-normalizer.ts`'s `invalidFilterError`
 * (`INVALID_FILTER` / 400) and `analytics-service.ts`'s dimension/measure gates
 * (`INVALID_FIELD` / 400): the code names the caller-shaped mistake, the status
 * says whose fault it is, and the message stays whatever the refusing site says.
 * `DATASET_INVALID` is not a new code — it is what the route's fallback list has
 * answered for these five families since #5352, registered in
 * `ERROR_CODE_LEDGER` (ADR-0112 D3). Producing it HERE, rather than deriving it
 * there from message text, is the whole change: one condition, one wire shape,
 * chosen by the producer that knows.
 *
 * The `RegisteredErrorCode` annotation is load-bearing rather than decorative —
 * it is what makes an unregistered code a compile error instead of a string that
 * only fails when some route happens to parse its own response body.
 *
 * ## What deliberately does NOT go through here
 *
 * Not every `throw` in this package is the caller's mistake, and enveloping one
 * that isn't would be the mirror-image defect — an internal fault re-labelled
 * `400`, which hides it from ops alerting and tells the author to fix something
 * they did not write. Three families are deliberately NOT `DATASET_INVALID`:
 *
 *   - **`read-scope-sql.ts`'s ten fail-closed refusals** — a SERVER fault, and
 *     since the maintainer's 2026-08-06 ruling they say so: that module's own
 *     `readScopeCompileError` gives all ten `READ_SCOPE_COMPILE_FAILED` / **500**.
 *     Its inputs are an RLS `FilterCondition` the security service compiled from
 *     an admin-authored policy and a join alias the dataset compiler generated —
 *     neither is caller input, so `400` both misattributed the fault and echoed
 *     policy field names back to the tenant. (This bullet said "stays bare,
 *     verdict pending" until that ruling; the route's message list is now gone
 *     entirely and #5367's retirement schedule is paid off.)
 *   - **Internal invariants** — e.g. `dataset-compiler.ts`'s "non-derived measure
 *     has no aggregate", which the spec refinement already guarantees. An
 *     arrival there is our bug; an undeclared `500` is the honest answer, and
 *     staying bare keeps it readable in the response (#5667's tiering) instead of
 *     withheld like a declared server fault.
 *   - **Producer/consumer drift between two of OUR tables** — the posture
 *     `objectql-strategy.ts`'s display-SQL renderer already states explicitly
 *     ("Deliberately NOT `invalidFilterError`'s 400 envelope: this is drift
 *     between two of our own tables, not a caller-shaped mistake", #5333).
 *
 * So this module is deliberately NOT "the only way this package refuses" — the
 * claim `invalidFilterError` can make about `filter-normalizer.ts`, and
 * `readScopeCompileError` about `read-scope-sql.ts`. It is the way this package
 * refuses **the caller**.
 */

import type { RegisteredErrorCode } from '@objectstack/spec/api';

/**
 * `DATASET_INVALID`, pinned against the ledger.
 *
 * Typed as `RegisteredErrorCode` so removing the ledger row (or misspelling the
 * code here) fails `tsc` rather than shipping a code `ApiErrorSchema` rejects.
 */
const DATASET_INVALID: RegisteredErrorCode = 'DATASET_INVALID';

/**
 * A dataset refusal in the ADR-0112 envelope — `DATASET_INVALID` / 400.
 *
 * Use it for a refusal the CALLER can fix by changing the request or the dataset
 * definition they authored: a selection that names something the dataset does not
 * declare, a dataset whose fields traverse an undeclared relationship, an
 * aggregate the v1 runtime does not implement. See this module's header for the
 * families that deliberately stay bare `Error`s.
 */
export function datasetInvalidError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = DATASET_INVALID;
  err.status = 400;
  return err;
}
