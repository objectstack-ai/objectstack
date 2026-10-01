// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21007] The refusal a SCALAR comparison operator gets when it is aimed at a
 * field stored as a JSON column — a `multiple: true` field, an inherently
 * multi-value option type (`tags`, `multiselect`, `checkboxes`) or a
 * structured-JSON type (`json`, `address`, …): the operator set and the words.
 * [#21009] The text operators other than the membership pair get it too.
 *
 * ## Two faces, one rule
 *
 * `driver-sql` refuses these operators on its `where` (#7398): such a column
 * holds the serialization `["a","b"]`, so `$in` / `$eq` compare that whole text
 * against one value and match nothing, while `$nin` / `$ne` return the very rows
 * they were asked to exclude, and the orderings return a lexicographic verdict
 * over the serialization. `@objectstack/objectql` evaluates a per-aggregation
 * `filter` itself, row by row, and gave the same three wrong answers in JS —
 * `{ owners: { $nin: ['u1'] } }` counted the rows holding `u1`. It now refuses
 * the same operators on the same declared fields, before any driver is asked.
 *
 * The two faces cannot import each other (the engine does not depend on a
 * driver), and a copy each is how one refusal comes to answer one mistake in
 * two ways. So the set and the sentence live here, on the floor both already
 * stand on — beside `temporalStorageForm`, which the same two faces share for
 * the same reason. Each face keeps its own error CONSTRUCTOR (the driver's
 * carries the #8220 provenance seam, the engine's the ADR-0112 envelope); what
 * they share is what the caller reads.
 *
 * ## The words: true on every face, whole on the wire
 *
 * [#21067] Three faces print the sentence below — `driver-sql`'s `where`, the
 * engine's per-aggregation `filter`, and `driver-memory`'s filter gate (#21066)
 * — and each reached its wrong answer by a different route: SQL compared the
 * serialization, the engine compared an array in JS, and mingo compared each
 * member. So the reason the sentence gives is the one that holds on all three:
 * a scalar comparison or text operator met a multi-value or JSON field;
 * membership is `$contains`, and no value is `$null` / `$empty`. It names no
 * storage form and no backend's wrong answer; those stay in these docblocks,
 * out of what a caller reads.
 *
 * It is also sized for the door it is read through. The REST envelope cuts a
 * 4xx message of 500 characters or more to 499 plus an ellipsis, keeping the
 * head (`truncateClientMessage`, `@objectstack/types`). The withheld message is
 * one constant text, so it is held WHOLE under that bound, the remedy and the
 * "withheld" sentence included, by a pin that runs it through that function
 * (`json-column-operator-refusal.test.ts`). The diagnostic names the field four
 * times, so its length grows with the name. It is whole on the wire for a field
 * name of up to 26 characters when an author-marked refusal discloses it. Its
 * order (what was refused, why, then the remedy) leaves the presence clause
 * and then the any-of example last, so a longer name pushes those out first;
 * the any-of example survives up to 36 characters.
 *
 * ## The other half of the JSON column's contract
 *
 * `$contains` is the membership spelling on such a column (`FILTER_OPERATORS`'
 * `$contains` docblock, `@objectstack/spec`), and it is what the refusal
 * prescribes — `$contains` for one member, an `$or` of `$contains` for any-of.
 * That is why it is ABSENT from the set below, with its complement
 * `$notContains` and the null predicates. [#21009] The remainder of the text
 * family is IN the set: it has no membership reading, so it matched the
 * serialization.
 */

/**
 * [#7398] Operators whose SQL lowering compares a column's STORED SCALAR to a
 * value — every spelling either of `driver-sql`'s two comparison emitters
 * answers (`applyFilterCondition`'s plain-column switch and
 * `applyNormalizedComparison`'s normalised arms). [#21009] Or MATCHES that
 * stored scalar as text: the text family other than the membership pair.
 *
 * The bare infix forms are here for the same reason they are in `driver-sql`'s
 * `SCALAR_COMPARAND_OPERATORS`: `applyNormalizedComparison` really does
 * answer `in` / `nin` / `not_in` / `notin` / `=` / `<>` / `>` …, so a filter
 * spelled that way against a normalised column compiles, and a gate that only
 * knew the `$`-forms would leave the failure alive at a different spelling —
 * the lesson #5234 already paid for there.
 *
 * `$between` is included although the card's minimum set stopped at the four
 * ordering comparisons: it IS `>= AND <=` (`driver-sql` even decomposes a
 * calendar-day `$between` into `$gte`/`$lt` ahead of its emitter), so refusing
 * the halves and compiling the compound would be the same wrong answer at one
 * more spelling.
 *
 * Deliberately ABSENT, and this is the load-bearing half of the set: the
 * membership pair (`$contains`, `$notContains`) and the null predicates
 * (`$null`, `$exists`, `$empty`). `$contains` is the ONLY working membership
 * spelling on a JSON-array column and downstream code depends on it (#7398's
 * own tables) — `driver-sql` compiles it as a real per-dialect membership test,
 * and `$notContains` as its exact complement — while `IS NULL` asks
 * about the column's presence, which is a well-formed question whatever the
 * column holds.
 *
 * [#21007] Moved here from `driver-sql`, unchanged, so the per-aggregation
 * `filter` refuses exactly the operators `where` refuses.
 *
 * [#21009] The remainder of the text family joined the set: `$startsWith`,
 * `$endsWith`, `$icontains`, and the staged pattern pair `$like` / `$ilike`
 * that `driver-sql` answers ahead of `FILTER_OPERATORS`. None has a membership
 * reading, so on a JSON column each matched the SERIALIZATION as text, and the
 * answers were wrong the same three ways the equality family's were. Measured
 * through `POST /api/v1/data/:object/query` on a multi-value lookup holding
 * `["u1","u2"]`:
 *
 * - SQLite: `$startsWith: '['` and `$endsWith: ']'` matched EVERY row with a
 *   value, while `$startsWith: 'u1'` matched none; `$icontains: 'U1'` matched
 *   the row holding only `u10`, and `$icontains: '","'` matched every row with
 *   two members.
 * - PostgreSQL: a `json` column has no `LIKE` operator, so all five failed at
 *   query time — a `500` `DATABASE_ERROR` for a filter the caller can fix.
 * - The per-aggregation `filter` counted `0` for `$startsWith`, `$endsWith` and
 *   `$icontains` (it already refuses the staged pair as unsupported).
 *
 * Each now gets this set's `400`. ⛔ No membership reading is invented for a
 * prefix, suffix or case-folded test: the prescription stays `$contains`. The
 * infix spellings `like` / `ilike` are not members because no emitter answers
 * them as operators — the normalised arms carry no text family, and the
 * operator switch refuses them as unsupported.
 */
export const JSON_COLUMN_INCOMPATIBLE_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '=', '==',
  '$ne', '!=', '<>',
  '$gt', '>', '$gte', '>=', '$lt', '<', '$lte', '<=',
  '$in', 'in',
  '$nin', 'nin', 'not_in', 'notin',
  '$between', 'between',
  '$startsWith', '$endsWith', '$icontains', '$like', '$ilike',
]);

/** The two texts of one JSON-column refusal — see {@link jsonColumnOperatorRefusalText}. */
export interface JsonColumnOperatorRefusalText {
  /**
   * What the caller is told. It names neither the field nor the operator: on a
   * read scope the predicate is an administrator's, so both are withheld
   * (#7929 / #8197), and the sentence says where they went.
   *
   * [#21067] One constant text, shorter than the REST envelope's 4xx bound, so
   * every word of it reaches the caller.
   */
  readonly message: string;
  /**
   * The full diagnostic — the field and the operator named — for the server log,
   * and the wire text when a face discloses it to the filter's own author
   * (`driver-sql`'s `'author'` provenance arm, #8220).
   */
  readonly diagnostic: string;
}

/**
 * [#21067] Why the operator was refused, in words true on every face that
 * prints them — see the module docblock. Shared by both texts, so the message
 * and the diagnostic cannot come to give two reasons; the diagnostic passes
 * `op` and so names the operator, the bare spelling's as `=`.
 */
function refusalReason(op?: string): string {
  const operator = op === undefined
    ? 'a scalar comparison or text operator'
    : `"${op}", a scalar comparison or text operator,`;
  return `it aims ${operator} at a multi-value or JSON field, which it cannot test for one member.`;
}

/**
 * [#21067] The other half of the prescription. The refused set also catches a
 * `null` comparand — `{ f: null }`, `$eq: null`, `$ne: null` — whose caller
 * asked whether the field has a value, not which member it holds, so
 * `$contains` cannot express it. The presence spellings can, and they answer on
 * a multi-value or JSON field on every face (they are outside the set):
 * `$null` is the literal `= null`, and `$empty` also counts an empty list.
 * One constant clause, never a branch on the comparand, so the withheld message
 * stays one text.
 */
const PRESENCE_REMEDY = 'For no value, use "$null" or "$empty".';

/** The prescription, spelled with `name` in the field position. */
function containsRemedy(name: string): string {
  return (
    `Use "$contains" for membership ({ "${name}": { "$contains": "a" } }), or an $or of ` +
    `"$contains" for any-of ({ "$or": [{ "${name}": { "$contains": "a" } }, ` +
    `{ "${name}": { "$contains": "b" } }] }). ${PRESENCE_REMEDY}`
  );
}

/**
 * [#7398] The words of the refusal: a scalar-comparison operator met a field
 * stored as JSON TEXT, so the comparison can never mean what the caller wrote.
 *
 * The mechanism is one line of SQL. A `multiple: true` field is stored as the
 * serialization `["U1","U2"]`, so `members in ('U1')` is FALSE — the text
 * genuinely is not equal to that id — and `members not in ('U1')` is TRUE:
 *
 * - `$in` / `$eq` / bare equality → **0 rows**, fail-CLOSED. Silent, and a
 *   `200` with an empty array is byte-identical to a query that legitimately
 *   matched nothing, so no caller has anything to key on.
 * - `$nin` / `$ne` → **the row it was asked to exclude**, fail-OPEN. That is
 *   the dangerous half and the reason this is a refusal rather than a
 *   documented footgun: an exclusion that silently stops excluding WIDENS a
 *   result set, the direction #3948 / #4209 / #5347 all ruled outranks a
 *   narrowing one.
 * - The ordering comparisons are not even uniformly empty: `$lte` matched,
 *   because `["usr_…"` sorts below `usr_…` on the leading `[`. A lexicographic
 *   compare over a serialization is a wrong answer, not a narrow one.
 *
 * The message states the filter WAS NOT APPLIED, because "no rows" is a
 * legitimate answer to a legitimate query, so a caller must be told that this
 * one was never asked. The prescription is `$contains` (and an `$or` of
 * `$contains` for any-of). It survives redaction with PLACEHOLDER names — the
 * SHAPE is the repair, and the shape names nothing.
 *
 * `bare` is the implicit-equality spelling `{ field: value }`, whose operator
 * the diagnostic names as `=`.
 *
 * [#21007] Moved here from `driver-sql`'s `jsonColumnOperatorError`, byte for
 * byte, so `where` and the per-aggregation `filter` print one sentence. The
 * caller builds the error: this returns only the text.
 *
 * [#21009] The text family that joined the set reads these same words. Its
 * prescription holds as written — membership is `$contains`.
 *
 * [#21067] Reworded once, for two reasons. The words named `driver-sql`'s
 * mechanism ("a field this driver stores as a JSON TEXT column", and the two
 * wrong answers SQL gave), which is untrue where the engine's per-aggregation
 * `filter` and `driver-memory` print them; the reason is now
 * {@link refusalReason}'s. And the message ran to 748 characters, so the REST
 * envelope cut it at 499, partway through the sentence explaining the refusal,
 * and no caller read the sentence saying the field and the operator were
 * withheld; it is now 486, with the presence spellings a `null` comparand
 * needs (see `PRESENCE_REMEDY`). The mechanism above stays here, where the
 * next author reads it.
 */
export function jsonColumnOperatorRefusalText(
  field: string,
  op: string,
  bare: boolean,
): JsonColumnOperatorRefusalText {
  const subject = bare
    ? `The bare equality spelling { "${field}": value }`
    : `Operator "${op}" on field "${field}"`;
  return {
    message:
      `A constraint in this filter WAS NOT APPLIED: ${refusalReason()} ${containsRemedy('FIELD')} ` +
      `The field and the operator are withheld from the message; the full diagnostic is in the ` +
      `server log.`,
    diagnostic: `${subject} WAS NOT APPLIED: ${refusalReason(op)} ${containsRemedy(field)}`,
  };
}
