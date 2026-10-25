/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE `icontains` comparand ruling this package owns, in one place
 * (objectui#9048).
 *
 * ## Why this module exists rather than a third copy
 *
 * `@objectstack/spec`'s `FILTER_TEXT_CASES` carries two REJECTION rows for the
 * case-insensitive contains operator — an empty comparand and a non-string one
 * — each with `code: 'INVALID_FILTER'` and `mustMention: ['$icontains']`.
 * Before this module the SAME discrimination and the SAME message were written
 * out twice inside this package: `ValueDataSource`'s `refuseTextComparand`
 * (objectui#8748, the reference implementation) and `filter-converter`'s
 * (objectui#9001, whose own docblock calls itself "a PORT of a shipped,
 * reviewed implementation"). objectui#9048's triage ruled on that directly:
 *
 * > three implementations of one refusal, of which one is correct ⇒ the useful
 * > dispatch is not "add a third guard" but "make the dialects share the one
 * > that works"
 *
 * So the contract's half — WHICH comparands are refused, and WHAT the author is
 * told — lives here once, and each face keeps only its own ENVELOPE. That split
 * is not a tidy-up: it is the half that does and the half that does not
 * transfer, and both docblocks already said so before this module existed.
 * `ValueDataSource` excludes-and-logs because it is deciding about one ROW and
 * HAS a row to exclude; `filter-converter` is a PRODUCER deciding whether to
 * send a query at all and has none, so it throws `FilterOperatorError`
 * (`INVALID_FILTER` / 400).
 *
 * ## Not exported from `@object-ui/core`'s entry, deliberately
 *
 * `src/index.ts` names its re-exports one file at a time and does NOT name this
 * one, so nothing here reaches the published surface. The package's sibling
 * `@object-ui/data-objectstack` carries the same defect on its own ARRAY-form
 * producer and CANNOT reach this module — `@object-ui/core`'s `exports` map has
 * exactly one entry (`"."`), so a second package can only import what
 * `src/index.ts` re-exports. Closing that half is a published-surface addition
 * and a maintainer's call, not this module's; see objectui#9048 for the exact
 * export it would need.
 *
 * ## Scope
 *
 * Only the case-insensitive contains operator, because only that operator is
 * what the published table declares. The sibling positive operators
 * (`$contains` / `$startsWith` / `$endsWith`) have no such row and keep the
 * answer they have always given on every face — widening by analogy is the
 * table's decision, not this module's.
 */

/**
 * A comparand as it appears INSIDE a refusal message.
 *
 * `JSON.stringify` alone is not safe here even though it is what the message
 * wants: it THROWS on a BigInt and on a cyclic object. Both faces are hurt by
 * that and in mirror-image ways, which is why the guard travels with the text
 * rather than being re-derived per face. On the THROWING face the call sits
 * inside a `throw new FilterOperatorError(...)` expression, so a `TypeError`
 * raised while the message is being built escapes in the refusal's place, and
 * `classifyLoadError` reads a bare `TypeError` as a network fault: the author
 * would be told to check their connection about a filter this layer had already
 * judged. On the EXCLUDE-AND-LOG face a refusal that throws while explaining
 * itself turns the one path that stays quiet about a bad filter into the one
 * path that takes the caller down.
 *
 * No JSON-sourced filter can carry either shape, so this is about the in-memory
 * callers who hand a literal to a data source or to the converter.
 * `?? String(target)` keeps `undefined` and a symbol readable — `JSON.stringify`
 * returns `undefined` for both.
 */
export function describeComparand(target: unknown): string {
  try {
    return JSON.stringify(target) ?? String(target);
  } catch {
    return String(target);
  }
}

/**
 * THE CONTRACT HALF, now the spec's own (objectui#11073).
 *
 * `isRefusedTextComparand` (the discrimination: a non-string or empty
 * comparand) and `textComparandRefusalReason` (the half of the message the
 * contract owns, no face's envelope on it) were written here once, for both
 * faces. `@objectstack/spec` 17.5.0 publishes the SAME two functions from
 * `@objectstack/spec/data`, byte for byte the implementation this module carried
 * — measured against the published `dist` when the bump landed, message text
 * included. So they are re-exported rather than kept as a copy under the spec's
 * own names, which `pnpm check:spec-symbols` refuses (a hand-written copy under
 * a spec name is one release away from drifting). Both faces still import them
 * from here, so the ONE-place property this module exists for is unchanged; the
 * one place is now the spec. `describeComparand` above stays local: the spec
 * does not export it.
 */
export { isRefusedTextComparand, textComparandRefusalReason } from '@objectstack/spec/data';
