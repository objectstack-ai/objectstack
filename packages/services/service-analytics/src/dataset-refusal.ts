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
 * ## [#5716] The second constructor, and how to choose between them
 *
 * #5352 named six refusal families and #5367 enveloped five of them. Reading
 * every `throw` in this package afterwards turned up NINE more sites of exactly
 * the same kind — caller- or author-shaped refusals that never entered the
 * route's message list at all, so they were answering `500` with nobody's
 * regex to rescue them — plus the `objectql-strategy.ts` `planCrossObject`
 * family (PM ruling on #5716, 2026-08-06). What decides the CODE is not which
 * file throws but what the refusal is a verdict ABOUT:
 *
 *   - {@link datasetInvalidError} — a verdict about the DATASET or the whole
 *     SELECTION: an `include` path that cannot be joined, an aggregate v1 cannot
 *     lower, a `compareTo` with no window to shift, a `dateRange` that is not a
 *     date. The caller fixes the dataset definition or the selection.
 *   - {@link invalidMemberError} — a verdict about ONE MEMBER the request named:
 *     a measure the cube does not declare, a member this engine cannot join to.
 *     The caller fixes (or drops) that member.
 *
 * The member family is `INVALID_FIELD` / 400 rather than a second
 * `DATASET_INVALID` for two measured reasons. First, the three shipped analytics
 * gates already answer `INVALID_FIELD` / 400 to the NEIGHBOURING member-level
 * mistakes on the very same request keys — `measures` (#4437), `dimensions` /
 * `timeDimensions` (#5520), `where` (#5669) — so a caller who mistypes a member
 * and a caller who names one the engine cannot serve would otherwise get two
 * wire shapes for one class of mistake, which is the defect ADR-0112 exists to
 * remove. Second, these sites are NOT dataset-only: `planCrossObject` and the
 * undeclared-measure refusal fire on `/analytics/query` too, where there is no
 * dataset at all — `DATASET_INVALID` would name a document the caller never
 * sent, while `INVALID_FIELD` reads correctly on both faces.
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
 *     withheld like a declared server fault. [#5716] `native-sql-strategy.ts`'s
 *     "measure … has unrecognised type" joins this bullet after measurement, and
 *     against #5716's own list, which had it down as author-shaped: `Metric.type`
 *     is the CLOSED `AggregationMetricType` enum, `metric-type-coverage.test.ts`
 *     pins that every member of it is handled (its second case is literally "leaves
 *     no metric type to the unrecognised-type throw"), the dataset compiler maps
 *     only `SUPPORTED_AGGREGATES` into a cube, and `inferMeasure` mints six known
 *     types. So no spec-valid cube can reach it — an arrival is our own drift or a
 *     host registering an unparsed cube object, which is the same 500 tier as the
 *     line above, not the author's 400.
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

import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';

/**
 * `DATASET_INVALID`, pinned against the ledger.
 *
 * Typed as `RegisteredErrorCode` so removing the ledger row (or misspelling the
 * code here) fails `tsc` rather than shipping a code `ApiErrorSchema` rejects.
 */
const DATASET_INVALID: RegisteredErrorCode = 'DATASET_INVALID';

/**
 * [#5716] `INVALID_FIELD`, pinned against the STANDARD catalog.
 *
 * Same load-bearing annotation as `DATASET_INVALID` above, one tier over: this
 * code is platform-wide (`StandardErrorCode`), not registered per package, which
 * is precisely why the member-level refusals use it — see the module header.
 */
const INVALID_FIELD: StandardErrorCode = 'INVALID_FIELD';

/**
 * [#5716] Which request key named the member — the analytics vocabulary, spelled
 * exactly as the shipped source-field gates spell it in `err.param`.
 */
export type AnalyticsRequestKey = 'measures' | 'dimensions' | 'timeDimensions' | 'where';

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

/**
 * [#5716] A refusal about ONE MEMBER the request named — `INVALID_FIELD` / 400.
 *
 * Use it when the verdict is about a single `measures` / `dimensions` /
 * `timeDimensions` / `where` entry rather than about the dataset or the whole
 * selection: a measure the cube does not declare (#4157), a member this engine
 * cannot evaluate because it traverses a relationship the driver cannot join
 * (`planCrossObject`). The message stays whatever the refusing site says — every
 * one of these already names the member and how to fix it, and #5923's tests
 * assert that wording.
 *
 * `member` is the entry AS THE REQUEST SPELLED IT — `revenue`, not the
 * `account.balance` it resolved to — because that is the string the caller can
 * find in the body they sent; the resolved form stays in the message, which is
 * where the explanation lives. `member` / `param` / `cube` mirror the diagnostic
 * fields the three shipped gates attach
 * (`err.field`/`err.param`/`err.measure`…). `field` is deliberately
 * NOT among them: those gates resolve a member to a base COLUMN and name the
 * column that is missing, while here either there is no such column (an
 * undeclared measure) or the column exists and is perfectly fine on another
 * driver (a cross-object member). Naming one would be inventing a fact.
 */
export function invalidMemberError(
  message: string,
  meta: { member: string; param?: AnalyticsRequestKey; cube?: string },
): Error {
  const err = new Error(message) as Error & {
    code?: string;
    status?: number;
    member?: string;
    param?: string;
    cube?: string;
  };
  err.code = INVALID_FIELD;
  err.status = 400;
  err.member = meta.member;
  if (meta.param) err.param = meta.param;
  if (meta.cube) err.cube = meta.cube;
  return err;
}
