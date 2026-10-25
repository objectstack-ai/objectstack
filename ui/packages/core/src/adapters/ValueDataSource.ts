/**
 * ObjectUI — ValueDataSource
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A DataSource adapter for the `provider: 'value'` ViewData mode.
 * Operates entirely on an in-memory array — no network requests.
 */

import type {
  DataSource,
  BatchTransactionOperation,
  DataSourceMutationEvent,
  QueryParams,
  QueryResult,
  AggregateParams,
  AggregateResult,
} from '@object-ui/types';
import {
  asciiCaseInsensitiveContains,
  canonicalAstOperator,
  isAcceptedFilterComparand,
  isEmptyFilterValue,
  RETIRED_FILTER_OPERATORS,
} from '@objectstack/spec/data';
import { emulateBatchTransaction } from './batchTransaction.js';
import {
  describeComparand,
  isRefusedTextComparand,
  textComparandRefusalReason,
} from '../utils/text-comparand.js';
import { toFilterNodeSafely, type FilterOperatorError } from '../utils/filter-converter.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ValueDataSourceConfig<T = any> {
  /** The static data array */
  items: T[];
  /** Optional ID field name for findOne/update/delete (defaults to 'id' then '_id') */
  idField?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the ID of a record given possible field names */
function getRecordId(record: any, idField?: string): string | number | undefined {
  if (idField) return record[idField];
  return record.id ?? record._id;
}

/**
 * A filter node this matcher cannot execute.
 *
 * Recorded and EXCLUDING, never silently ignored. Answering `true` for a node
 * the matcher does not understand is how a filtered list came back UNFILTERED —
 * every row, no error, not one console line (objectui#7349). The measured
 * sibling behaviour is a refusal, not a pass: `evaluateCondition`
 * (`@object-ui/permissions`) returns `false` from its `default` arm, and
 * `ReportViewer`'s formatting switch leaves `match` false. The wire-side
 * sibling `@object-ui/data-objectstack` goes further and THROWS
 * (`MalformedFilterError`), on the stated ground that dropping one entry of an
 * `and` WIDENS the result set — but it is deciding whether to send a query at
 * all, while this matcher is deciding about a single row. So the row is
 * excluded and the reason is logged once per distinct refusal per `find()`,
 * which keeps a 10k-row scan to one line.
 */
function refuseFilterNode(refusals: Set<string>, reason: string): false {
  refusals.add(`[ObjectUI] ValueDataSource: ${reason}. Rows are excluded rather than passed through.`);
  return false;
}

/**
 * A refusal the LOWERING raised, re-seated in this adapter's own sentence
 * (objectui#10767).
 *
 * `toFilterNode` throws a {@link FilterOperatorError} for a stored view rule it
 * will not lower — an ARRAY on a single-valued operator (objectui#8557), an
 * empty or non-string `icontains` comparand (objectui#9048). For the producers
 * that call it before a WIRE query, a throw is right: they are deciding whether
 * to send a query at all. `find()` is deciding about rows, so here the same
 * refusal takes the shape every refusal takes in this file — the rows are
 * excluded and the reason is logged once — rather than surfacing as a throw
 * from a `find` that never threw on a bad filter before. The converter's own
 * `[ObjectUI]` prefix and closing period are taken off so the sentence reads
 * once, not twice; the reasoning and the prescription are its own, verbatim.
 *
 * The object arm re-seats the converter's refusal through this same function
 * since objectui#10817, for a field whose condition is an object with no own
 * keys — see {@link zeroKeyConditionRefusal}. One envelope for both arms.
 */
function loweringRefusalReason(refusal: FilterOperatorError): string {
  const body = refusal.message.replace(/^\[ObjectUI\]\s*/, '').replace(/\.\s*$/, '');
  return `filter rule refused as it is lowered: ${body}`;
}

/**
 * The operators whose comparand IS an array by declaration, in both dialects.
 *
 * `$in` / `$nin` take a member list and `$between` a two-element range; every
 * other operator reads its comparand as a single value. That split is what
 * {@link refuseArrayComparand} is checked against — an array anywhere else is
 * not a comparand this protocol has a meaning for.
 */
const DOLLAR_LIST_COMPARAND_OPERATORS = new Set(['$in', '$nin', '$between']);
const AST_LIST_COMPARAND_OPERATORS = new Set(['in', 'nin', 'between']);

/**
 * The AST operators that never read the value slot at all, so nothing sitting
 * there is a comparand. `matchesComparisonNode`'s null and emptiness arms take
 * their direction from the operator NAME and the ObjectUI client sends a truthy
 * placeholder in the third position, so the array guard must not judge it.
 * The spec discards that slot on all four: `parseFilterAST(['x', 'is_empty',
 * ['a']])` is `{ x: { $empty: true } }`.
 */
const AST_NO_COMPARAND_OPERATORS = new Set(['is_null', 'is_not_null', 'is_empty', 'is_not_empty']);

/**
 * Is this stored value EMPTY, in the sense the spec's `$empty` operator gives
 * the word (objectui#11094)?
 *
 * The answer is the spec's own `isEmptyFilterValue` (`@objectstack/spec/data`),
 * called WITHOUT an expansion. That is the by-value reading: null, `undefined`
 * (an absent key reads as `undefined` here), `''` and `[]` are empty, and
 * nothing else is.
 *
 * ## Why no field type is read
 *
 * The spec's ruled 「is empty」 table (ruling B on objectstack#20311) is keyed
 * on a field's DECLARED type and `multiple`: a text-like field is empty when
 * null or `''`, a multi-value field when null or `[]`, every other type when
 * null. A face that holds the declaration turns it into a row with
 * `expandEmptyOperator` and passes that row to `isEmptyFilterValue`. This face
 * holds none. `ValueDataSourceConfig` carries rows and an id field, and the
 * spec's `value` data source declares only `items`. So this face judges by
 * value, as ruling A on objectstack#20399 gives the faces with no field
 * declarations. `@objectstack/formula`'s matcher and `driver-memory`'s
 * reference matcher make the same call to the same function.
 *
 * ⛔ No per-type table is kept here, and none is inferred from the rows. The
 * by-value reading differs from a declared face only on a stored state the
 * declaration does not predict: `''` in a non-text column, or `[]` in a scalar
 * one. The spec calls the first a write-door defect rather than a stored state.
 */
function isEmptyStoredValue(value: unknown): boolean {
  return isEmptyFilterValue(value);
}

/**
 * An ARRAY where a single-value comparand belongs — `{ tags: ['a', 'b'] }`,
 * `{ tags: { $eq: ['a', 'b'] } }`, `['tags', '=', ['a', 'b']]` (objectui#8514).
 *
 * ## Why this is refused rather than given a deep-equality reading
 *
 * The card was filed as "reference comparison excludes even the deep-equal
 * row", which is true, and the obvious repair is to make `['a','b']` equal
 * `['a','b']`. The census says otherwise, and the spec says who owns the
 * question. `assertListComparandShapes` (`@objectstack/spec/data`) lists
 * "arrays outside `$in`/`$nin`/`$between`" among the positions its comparand
 * door deliberately does NOT judge, on the stated ground that the ruling does
 * not name it and the matrix did not measure it — it is left "to the layers
 * that already answer it". Those layers do not agree, and the two nearest to
 * this one both REFUSE:
 *
 * - `@objectstack/formula`'s `matchesFilter` — the record-at-a-time evaluator
 *   this adapter is the closest sibling of — answers `false` structurally, on
 *   the comment "a bare array value is not a valid field spec (must be
 *   `{ $in: [...] }`)".
 * - `@objectstack/driver-sql` refuses an array comparand with its own message.
 * - Only the document stores give it array-equality, as a native behaviour of
 *   the store rather than a ruled contract.
 *
 * So there is no protocol answer to implement, and inventing one HERE is the
 * lenient-consumer fallback the repo forbids (AGENTS.md #0.1): a second
 * de-facto contract, agreed with by no backend, that a `provider: 'value'` list
 * would honour and the same filter on the wire would not. Every producer in
 * this repo already spells a multi-value comparand `{ $in: [...] }` — measured
 * across every `$filter` literal under the packages' and apps' source trees,
 * where the only array-valued comparands are `$in` / `$nin` members — so
 * refusing costs no caller a working filter, and the message names the
 * spelling that works. (The glob is spelled in words because a literal one
 * would close this comment.)
 *
 * ## The rows do not move; the silence does — except on the negations
 *
 * For `{ tags: [...] }` and `{ tags: { $eq: [...] } }` this changes no result
 * set: `!==` / `===` against a fresh array already excluded every row, so the
 * repair is the diagnostic. `$ne` / `!=` are the exception and the reason this
 * guard covers the operator positions too — `value !== target` against an
 * array is always TRUE, so an array comparand there selected EVERY row, in
 * silence. That is objectui#8447's fail-open direction surviving inside the
 * arm objectui#8514 was filed about, and the same repair closes both.
 */
function refuseArrayComparand(
  refusals: Set<string>,
  field: string,
  operator: string,
): false {
  return refuseFilterNode(
    refusals,
    `filter comparand for field '${field}' on operator '${operator}' is an ARRAY, `
    + `which is a declared comparand only for $in / $nin / $between. The spec leaves `
    + `an array in any other position unruled and the sibling in-memory matcher `
    + `(@objectstack/formula) refuses it; express membership as `
    + `{ ${field}: { $in: [...] } } or its negation { ${field}: { $nin: [...] } }`,
  );
}

/**
 * An `icontains` / `$icontains` comparand that is not a NON-EMPTY STRING —
 * `{ name: { $icontains: '' } }`, `['name', 'icontains', 42]` (objectui#8748).
 *
 * ## Not this file's ruling — the published table already refuses both
 *
 * `FILTER_TEXT_CASES` (`@objectstack/spec/data`) carries the two shapes as
 * REJECTION rows rather than as row-set expectations, each with
 * `code: 'INVALID_FILTER'` and `mustMention: ['$icontains']`:
 *
 * > *an empty `$icontains` comparand is REFUSED* — "Every row contains the
 * > empty substring, so evaluating it is a predicate that constrains nothing —
 * > the widening [objectstack-ai/objectstack#5240] refused `{ field: {} }` over, one level in."
 *
 * > *a non-string `$icontains` comparand is REFUSED* — "Coercing 42 to `"42"`
 * > would answer a query nobody wrote; the declared comparand type is string."
 *
 * Measured on `origin/main` before this guard, over `FILTER_TEXT_ROWS`: the
 * empty comparand answered ALL NINE ROWS in both dialects with not one console
 * line — objectui#7349's fail-open signature, and the same widening class
 * objectui#8447 fixed one level up. The non-string comparand was quieter and
 * worse to debug: `String(42)` was evaluated and answered `[]`, which is
 * indistinguishable on screen from "evaluated, matched nothing" — which is why
 * pinning it as "42 and '42' agree" would pin nothing (they agree before this
 * guard too). What moves is the REFUSAL: the row is excluded and the operator
 * is named.
 *
 * ## Why only `icontains`, and why the row is excluded rather than thrown
 *
 * Only `$icontains` because only `$icontains` is what the table declares; the
 * sibling positive operators (`$contains` / `$startsWith` / `$endsWith`) have
 * no such row and are deliberately left alone rather than widened by analogy.
 * Excluded-and-logged because that is this face's declared refusal shape
 * (objectui#7349): the wire-side sibling `@object-ui/data-objectstack` throws
 * `MalformedFilterError` because it is deciding whether to send a query at all,
 * while this matcher is deciding about one row. Whether this face should carry
 * the throwing envelope instead is objectui#8600 Q1, and it stays closed.
 *
 * ⚠️ The PRODUCER half ships in the same change and is what makes this safe.
 * `FilterConditionField` emitted `{ [field]: { $icontains: value } }` verbatim,
 * so a builder row with the operator chosen and the value box still empty
 * produced exactly this shape — refusing it here alone would flip that list
 * from "every row" to "no rows", which this file's own `$exists` arm names as
 * the one outcome worse than the bug.
 */
/**
 * ⚠️ The DISCRIMINATION and the MESSAGE moved to `utils/text-comparand.ts`
 * (objectui#9048). Nothing about this face's answer changed — the reason string
 * is the same bytes it has been since objectui#8748, and the pins that drive
 * both faces and compare their wording verify that without transcribing it.
 *
 * What stayed here is the ENVELOPE, which is the half that does NOT transfer:
 * this matcher is deciding about one ROW and HAS a row to exclude, so it
 * excludes-and-logs (objectui#7349). Its two siblings each seat the same reason
 * in their own envelope — `filter-converter` throws `FilterOperatorError`
 * because it is a PRODUCER with no row to exclude.
 */
function refuseTextComparand(
  refusals: Set<string>,
  field: string,
  operator: string,
  target: unknown,
): false {
  return refuseFilterNode(refusals, textComparandRefusalReason(field, operator, target));
}

/**
 * The operators a `{ $field }` reference is a legal comparand ON, in both
 * dialects — the SIX scalar comparisons and nothing else.
 *
 * Not this file's choice: `FieldReferenceSchema` (`@objectstack/spec/data`)
 * declares the reference on `$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte`, and
 * objectstack#7596 REMOVED it from `$in` / `$nin` members and `$between`
 * endpoints at the schema door, on the finding that no backend ever resolved
 * one there.
 */
const DOLLAR_FIELD_REFERENCE_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']);
const AST_FIELD_REFERENCE_OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=']);

/** A comparand this matcher refused; distinguishable from a resolved `undefined`. */
const REFUSED_COMPARAND: unique symbol = Symbol('ValueDataSource:refused-comparand');

/**
 * Is this comparand shaped like a Filter Protocol FIELD REFERENCE?
 *
 * The test is `'$field' in value`, which is what `@objectstack/formula`'s
 * `resolveValue` uses, so the three faces agree on what a reference IS before
 * they differ on what to do with one. Validity of the `$field` VALUE is judged
 * by {@link resolveFieldReference}, which refuses loudly — reporting a
 * malformed reference beats letting it fall through to a comparison against
 * the object, which is the silence this card is about.
 */
function isFieldReferenceComparand(value: any): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && '$field' in value;
}

/**
 * Resolve `{ $field: 'other_column' }` against the record being matched
 * (objectui#8515), or refuse it with the reason.
 *
 * ## Why this is implemented rather than refused
 *
 * `@objectstack/spec/data` declares the shape, `@objectstack/formula`'s
 * `compileCelToFilter` emits it for a field-to-field comparison in a CEL
 * permission rule, and BOTH platform evaluation paths execute it — the
 * in-memory `matchesFilter` resolves it in `resolveValue`, and `driver-sql`
 * compiles it to a same-table column-to-column comparison (objectstack#5222),
 * held to the same rows by a shared conformance corpus. Refusing it here would
 * make this adapter the one face that answers a declared, executed shape with
 * "no rows" — the outcome the sibling card ruled worse than the bug.
 *
 * Both of this file's matchers compared the reference OBJECT against the stored
 * value: `value === target` for `$eq` (never equal — no rows) and `value > target`
 * for the orderings (an object bound — no rows). Neither said anything.
 *
 * ## The three positions this refuses instead, each for a recorded reason
 *
 * - **A `$field` that is not a STRING.** `FieldReferenceSchema` declares
 *   `z.string()`, and the spec's own lowering predicate (matching `driver-sql`'s
 *   `fieldReferenceOf`) treats a non-string `$field` as "not a field reference
 *   on any path". Downstream that means "refused as the uncompilable object it
 *   is", which is what this does — loudly, rather than by object comparison.
 * - **A DOTTED path.** This matcher addresses the left-hand side as
 *   `record[field]`, flat, so resolving a dotted path only on the right would
 *   make `['a.b', '=', x]` and `['x', '=', { $field: 'a.b' }]` disagree about
 *   what a dot means. SQL push-down refuses a dotted path too, under the
 *   maintainer's 2026-08-06 same-table ruling (no JOIN planning, no alias
 *   contract). `@objectstack/formula` DOES walk dots — that divergence is named
 *   here rather than papered over, because this adapter has no path accessor to
 *   be consistent with.
 * - **`addDays`.** The whole-day offset (objectstack#14104) is defined against
 *   the referenced column's TEMPORAL CLASS — a `date` stays a calendar day, a
 *   `datetime` keeps its time of day — and SQL push-down compiles it only
 *   between two temporal columns of the same class, refusing everything else
 *   loudly. This matcher has no field types to read a class from, so it refuses
 *   for the same reason rather than guessing. Silently IGNORING the offset is
 *   the one answer that must not happen: it would compare against an unshifted
 *   column and return WRONG rows, where today's defect returns none.
 */
function resolveFieldReference(
  record: any,
  reference: Record<string, any>,
  operator: string,
  rawOperator: string,
  field: string,
  legalOperators: ReadonlySet<string>,
  refusals: Set<string>,
): any {
  const path = reference.$field;

  if (typeof path !== 'string') {
    refuseFilterNode(
      refusals,
      `filter comparand for field '${field}' carries a non-string $field `
      + `(${describeComparand(path)}); a field reference declares `
      + `$field as a string, so this is not one on any path`,
    );
    return REFUSED_COMPARAND;
  }

  if (!legalOperators.has(operator)) {
    refuseFilterNode(
      refusals,
      `a { $field } reference is not a comparand for operator '${rawOperator}' on field `
      + `'${field}'. It is declared only on the six scalar comparisons `
      + `($eq/$ne/$gt/$gte/$lt/$lte and their AST spellings); the spec removed it from `
      + `$in / $nin members and $between endpoints because no backend resolves one there`,
    );
    return REFUSED_COMPARAND;
  }

  if ('addDays' in reference && reference.addDays !== undefined) {
    refuseFilterNode(
      refusals,
      `the { $field } reference on field '${field}' carries an addDays offset, which is `
      + `defined against the referenced column's temporal class; this matcher has no field `
      + `types to read one from, and answering without the offset would compare against an `
      + `unshifted column and return the wrong rows`,
    );
    return REFUSED_COMPARAND;
  }

  if (path.includes('.')) {
    refuseFilterNode(
      refusals,
      `the { $field } reference on field '${field}' names the dotted path '${path}'; this `
      + `matcher addresses a flat record, so a dotted reference would not mean the same `
      + `thing as the dotted field name on the other side of the comparison`,
    );
    return REFUSED_COMPARAND;
  }

  return record[path];
}

/**
 * A `{ $field }` reference sitting INSIDE a list comparand — an `$in` / `$nin`
 * member or a `$between` endpoint (objectstack#7596, ruled 2026-08-11).
 *
 * The positions were declared once and honoured by nobody; the ruling was
 * REMOVE rather than implement. The `$nin` direction is why this is loud rather
 * than left alone: an unresolved member drops an EXCLUSION the author wrote,
 * so the row passes — a filter that widens its result set in silence.
 */
function refuseListMemberFieldReference(
  refusals: Set<string>,
  field: string,
  operator: string,
): false {
  return refuseFilterNode(
    refusals,
    `a { $field } reference appears inside the list comparand of '${operator}' on field `
    + `'${field}'. A reference may be the WHOLE comparand of a scalar comparison, never a `
    + `member of $in / $nin nor an endpoint of $between — the spec removed those positions `
    + `because no evaluation path resolved them`,
  );
}

/**
 * EQUALITY between a stored value and one comparand, as every equality and
 * membership position on this face reads it (objectui#10829): the AST arm's
 * `=` / `!=` / `in` / `nin`, and the object arm's implicit equality, `$eq` /
 * `$ne` / `$in` / `$nin`. One helper, so the two arms cannot drift apart on it.
 *
 * ## Two `Date`s compare their INSTANT
 *
 * Every position used `===` (membership used `includes`), which compares a
 * `Date` by IDENTITY. The constructor `structuredClone`s the rows it is given,
 * so none of them holds the comparand's instance (only `create` / `update`,
 * which copy shallowly, can store the caller's own), and a `Date` equality
 * matched none of them, not even the one holding that exact instant. The
 * ordering arms already compared a `Date` by its number, so `>=` and `<=` both
 * held for a row that `=` rejected. So when BOTH sides are `Date` instances,
 * this compares `getTime()`, and `=`, `>=` and `<=` give one answer for one
 * instant.
 *
 * An invalid `Date` (its time is `NaN`) equals nothing, itself included, so
 * `!=` / `$ne` / `nin` / `$nin` hold for it.
 *
 * ## Everything else is `===`
 *
 * A `Date` comparand against an ISO string or an epoch-milliseconds number is
 * NOT coerced. `@objectstack/spec`'s `FILTER_COMPARAND_TYPE_CASES` declines to
 * assert a `Date` row set because what it matches "legitimately differs per
 * storage form (ADR-0053)", and this matcher has no field types to read a
 * storage form from. The ordering operators and `$between` keep their own
 * comparisons.
 *
 * Membership now reads `===` too, where `includes` read SameValueZero. The one
 * value those two disagree on is the number `NaN`: `{ x: { $in: [NaN] } }` no
 * longer matches a stored `NaN`, which agrees with `{ x: NaN }` and `$eq`,
 * where `NaN` never equalled `NaN`.
 */
function comparandEquals(value: unknown, target: unknown): boolean {
  if (value instanceof Date && target instanceof Date) {
    const instant = value.getTime();
    return !Number.isNaN(instant) && instant === target.getTime();
  }
  return value === target;
}

/**
 * Evaluate ONE comparison node — `[field, operator]` or `[field, operator, value]`.
 *
 * The operator is canonicalized through the spec's own
 * {@link canonicalAstOperator}, so this switch has ONE arm per operator rather
 * than one per spelling, and the accepted vocabulary is the published one
 * rather than a second hand-written list that drifts from it. That matters here
 * more than it reads: `viewFilterRuleToNode` (`../utils/filter-converter.ts`)
 * lowers a stored view's rules through the spec's `normalizeFilterOperator`,
 * so what actually arrives is the CANONICAL VIEW spelling — `equals`,
 * `greater_than`, `starts_with` — and 16 of the 20 `VIEW_FILTER_OPERATORS`
 * had no arm in the old spelling-keyed switch. Every one of them reached its
 * `default: return true` and selected every row.
 */
function matchesComparisonNode(
  record: any,
  node: any[],
  refusals: Set<string>,
): boolean {
  const field = node[0] as string;
  const rawOperator = node[1] as string;
  // `'not in'` (with a space) is NOT a member of the spec's
  // `VALID_AST_OPERATORS` — the wire would refuse it — but this matcher has
  // always implemented it and a test pins it. Canonicalizing it here keeps the
  // refusal arm below from deleting support that exists today; whether to
  // retire the spelling is a separate question from this card's.
  const operator =
    rawOperator === 'not in' ? 'nin' : canonicalAstOperator(rawOperator);
  const value = record[field];
  const rawTarget = node[2];

  // objectui#8514 — an array where a single-value comparand belongs. Checked
  // before the switch so `=` / `!=` cannot answer it by reference (never equal
  // / always unequal), and skipped for the operators that DECLARE an array
  // comparand and for the two that never read the slot.
  if (
    Array.isArray(rawTarget)
    && !AST_LIST_COMPARAND_OPERATORS.has(operator)
    && !AST_NO_COMPARAND_OPERATORS.has(operator)
  ) {
    return refuseArrayComparand(refusals, field, String(rawOperator));
  }

  // objectui#8515 — a `{ $field }` reference inside a list comparand. The
  // members are walked only for the three operators that HAVE a list comparand;
  // everywhere else an array was already refused above.
  if (Array.isArray(rawTarget) && rawTarget.some(isFieldReferenceComparand)) {
    return refuseListMemberFieldReference(refusals, field, String(rawOperator));
  }

  // objectui#8515 — a `{ $field }` reference as the WHOLE comparand. Resolved
  // against this record so the switch below compares two of its own values,
  // exactly as `matchesFilter` (`@objectstack/formula`) and `driver-sql` do.
  const target = isFieldReferenceComparand(rawTarget)
    ? resolveFieldReference(
      record, rawTarget, operator, String(rawOperator), field,
      AST_FIELD_REFERENCE_OPERATORS, refusals,
    )
    : rawTarget;
  if (target === REFUSED_COMPARAND) return false;

  switch (operator) {
    // -- Null-ness. Direction comes from the operator NAME; the value slot is
    // never read, so the 2-tuple `['x', 'is_not_null']` and the 3-tuple
    // `['x', 'isnotnull', null]` are the same predicate. `canonicalAstOperator`
    // folds `is_null` / `isnull` onto the first arm and their two negatives
    // onto the second.
    case 'is_null':
      return value === null || value === undefined;
    case 'is_not_null':
      return value !== null && value !== undefined;

    // -- Emptiness (objectui#11094). The spec stopped folding `is_empty` /
    // `isempty` onto `is_null` (objectstack#20570, in `@objectstack/spec`
    // 17.6.0): `canonicalAstOperator` now answers `is_empty` for those two
    // spellings and `is_not_empty` for their two negatives, and the spec
    // lowers them to `$empty: true` / `$empty: false`. So they get their own
    // arms, the twins of the `$empty` arm in `matchesDollarOperator`. Without
    // these arms, on that release a stored `is_empty` rule reached the refusal
    // below and selected no row. Direction comes from the operator NAME, as
    // for null-ness, and the meaning is the spec's emptiness test, not a null
    // test: see {@link isEmptyStoredValue}.
    case 'is_empty':
      return isEmptyStoredValue(value);
    case 'is_not_empty':
      return !isEmptyStoredValue(value);

    // objectui#10829 — equality and membership through `comparandEquals`, so
    // two `Date`s compare their instant; the ordering arms below are untouched.
    case '=':
      return comparandEquals(value, target);
    case '!=':
      return !comparandEquals(value, target);
    case '>':
      return value > target;
    case '>=':
      return value >= target;
    case '<':
      return value < target;
    case '<=':
      return value <= target;
    case 'in':
      return Array.isArray(target) && target.some((member) => comparandEquals(value, member));
    case 'nin':
      return Array.isArray(target) && !target.some((member) => comparandEquals(value, member));
    // -- Text operators. THE DIRECTION, so the next reader does not take it for
    // a typo and fold it back (objectui#7379): the `$contains` FAMILY is
    // case-SENSITIVE and `icontains` is its one case-insensitive member. That
    // is the platform's ruling (objectstack#4706 Q2 = A), not this file's
    // preference, and it is what every backend executes — `driver-sql`,
    // `driver-sqlite-wasm`, `driver-turso`, `driver-mongodb` and
    // `driver-memory` all import `FILTER_TEXT_CASES` (`@objectstack/spec/data`)
    // and answer its `$contains is case-SENSITIVE` rows. These four arms used
    // to lower-case BOTH sides, so `contains` executed `icontains`, the two
    // were one predicate, and a `provider: 'value'` list answered a filter with
    // strictly more rows than the same filter run against the wire.
    //
    // There is no `i` twin for the other three: `VALID_AST_OPERATORS` has
    // `icontains` and NOTHING else with an `i` prefix — no `istartswith`, no
    // `iendswith`, no `not_icontains` (the `$` dialect has no `$notIcontains`,
    // and the AST table mirrors the executed set rather than widening it). So
    // case-sensitive is the ONLY reading available to them, and it is the one
    // `$notContains` needs for complementarity: a folding `not_contains` beside
    // a case-exact `contains` lets one row fail an operator AND its negation.
    case 'contains':
      return typeof value === 'string' && value.includes(String(target));
    // The fold is ASCII-ONLY (objectstack#4706 Q1 = A) and it runs on BOTH
    // sides, which is why this borrows the spec's own predicate instead of
    // spelling one here. `String.prototype.toLowerCase()` — what this arm used
    // to reach for — is the FULL Unicode fold, so it matched `CAFÉ` against
    // `café`; three of the five backends are SQLite underneath, whose `lower()`
    // folds ASCII only, so a Unicode promise here is one the wire cannot keep.
    // objectui#8748 — the comparand door, checked BEFORE the fold. An empty
    // comparand made this arm a predicate that constrained nothing (all nine
    // `FILTER_TEXT_ROWS` came back, in silence); a non-string one was evaluated
    // after a `String()` coercion nobody wrote. Both are refusals in
    // `FILTER_TEXT_CASES`; see {@link refuseTextComparand}.
    case 'icontains':
      if (isRefusedTextComparand(target)) {
        return refuseTextComparand(refusals, field, String(rawOperator), target);
      }
      return typeof value === 'string' && asciiCaseInsensitiveContains(value, target);
    // objectui#8452 — this arm answers the PREDICATE, not a TYPE TEST. It used
    // to read `typeof value === 'string' && !value.includes(...)`, so a row
    // whose value is the number 5 failed `contains '5'` (right: a number cannot
    // contain a substring) AND failed `not_contains '5'` (wrong: for the very
    // same reason it cannot contain it, it does not contain it). Measured on
    // this fixture before the fix, `not_contains '5'` answered `['sx']` where
    // it now answers seven of eight rows: six rows sat outside BOTH halves of
    // the partition, so no filter answer included them and the opposite filter
    // — the one thing a user has to debug with — was silent too.
    //
    // The direction is objectstack#14079 (maintainer ruling 2026-09-05,
    // option A), quoted from `filter-text-conformance.ts`, the contract that
    // carries it: "a stored value that is not a string never satisfies a
    // positive text operator (`$contains` / `$startsWith` / `$endsWith` /
    // `$icontains` / `$like` / `$ilike`) and satisfies `$notContains` —
    // complementarity holds, on every face." `FILTER_TEXT_CASES`' `score` rows
    // pin it, and `driver-memory`'s reference matcher — the face the defect was
    // measured on — carries the same expression negated the same way.
    //
    // So this is the exact complement of the `contains` arm above, and it has
    // to STAY spelled that way: the type gate on the positive operators is the
    // other half of the same ruling, not a leftover to clean up. A `null` or an
    // absent key is admitted by the same predicate (they are not strings),
    // which is also what objectstack#13166 ruled for this operator.
    case 'not_contains':
      return !(typeof value === 'string' && value.includes(String(target)));
    case 'starts_with':
      return typeof value === 'string' && value.startsWith(String(target));
    case 'ends_with':
      return typeof value === 'string' && value.endsWith(String(target));
    case 'between':
      return Array.isArray(target) && target.length === 2 && value >= target[0] && value <= target[1];

    default:
      // Includes the spec-valid `like` / `ilike`: they carry pattern semantics
      // this in-memory matcher does not implement, and no producer in this repo
      // emits them into a filter. Refusing is the loud answer; matching every
      // row was the silent one.
      return refuseFilterNode(
        refusals,
        `filter operator '${String(rawOperator)}' is not implemented by the in-memory matcher`,
      );
  }
}

/**
 * Evaluate an AST-format filter node against a record.
 *
 * Reads the four shapes the spec's `FilterArraySchema` declares and
 * `isFilterAST` accepts, so this consumer applies the same filter the wire
 * would (objectui#7349):
 *
 *   - `['and' | 'or', ...children]`  a logical group
 *   - `[field, operator, value]`     a comparison
 *   - `[field, operator]`            a comparison whose operator needs no value
 *   - `[[…], […]]`                   a legacy flat list of conditions, implicit AND
 *
 * The last one is the shape this matcher used to ignore ENTIRELY, at top level
 * and as a child of `and` / `or` alike — and it is what `mergeFilterNodes`
 * returns for a lone surviving filter source, i.e. the common case. A flat
 * array is unambiguous: the spec's `FilterArrayFieldSchema` forbids `and` / `or`
 * as field names, so a node whose head is itself an array can only be a list.
 *
 * Anything else is refused rather than passed. An empty array stays "no
 * filter" — the spec says the same, and `find()` never calls with one.
 *
 * A spec `ViewFilterRule[]` never reaches this function as rule objects:
 * `find()` lowers the array through `toFilterNode` first (objectui#10767), so a
 * rule arrives here as the comparison tuple its operator spells. A rule object
 * that DOES arrive is one the lowering left alone — no string `field` — and is
 * refused below like any other unreadable node.
 */
function matchesASTFilter(record: any, filterNode: any, refusals: Set<string>): boolean {
  if (!Array.isArray(filterNode)) {
    return refuseFilterNode(
      refusals,
      `filter node ${JSON.stringify(filterNode) ?? String(filterNode)} is not an array`,
    );
  }
  if (filterNode.length === 0) return true;

  const head = filterNode[0];

  // Logical group. `length >= 2` mirrors `isFilterAST`: the keyword opens a
  // group and a group needs at least one condition.
  if (typeof head === 'string') {
    const keyword = head.toLowerCase();
    if (keyword === 'and' || keyword === 'or') {
      if (filterNode.length < 2) {
        return refuseFilterNode(refusals, `'${keyword}' group carries no conditions`);
      }
      const children = filterNode.slice(1);
      return keyword === 'and'
        ? children.every((sub: any) => matchesASTFilter(record, sub, refusals))
        : children.some((sub: any) => matchesASTFilter(record, sub, refusals));
    }
  }

  // Legacy flat list of conditions — implicit AND, the way the server reads it.
  if (Array.isArray(head)) {
    return filterNode.every((sub: any) => matchesASTFilter(record, sub, refusals));
  }

  // Comparison node, 2- or 3-element.
  if (typeof head === 'string' && typeof filterNode[1] === 'string' && filterNode.length <= 3) {
    return matchesComparisonNode(record, filterNode, refusals);
  }

  return refuseFilterNode(
    refusals,
    `filter node ${JSON.stringify(filterNode)} is not a shape the matcher reads`,
  );
}

/**
 * Evaluate ONE `$`-dialect operator against a record's value for a field.
 *
 * The vocabulary is the spec's own `FILTER_OPERATORS` (`@objectstack/spec/data`)
 * and each arm answers the same question its AST twin answers in
 * {@link matchesComparisonNode} — `$eq`/`=`, `$nin`/`nin`, `$startsWith`/
 * `starts_with`, `$empty`/`is_empty`, and so on, one-to-one across EVERY
 * member: every declared operator is executed here, none is refused by name.
 * How many members there are is not written here: the case table in
 * `ValueDataSource.dollarFilterVocabulary.test.ts` is held equal to
 * `FILTER_OPERATORS`, and it is what re-derives that. That pairing IS the
 * fix for objectui#8447: `find()` picks between the two matchers on nothing
 * more than whether `$filter` arrived as an array or an object, so any operator
 * one of them executes and the other waves through is a result that changes
 * with the SHAPE of the filter rather than with its meaning.
 *
 * ## What the `default` arm used to be
 *
 * `default: break` — which adds NO constraint. An operator this switch did not
 * name therefore matched EVERY row, silently, while the array arm of the very
 * same `if` refused the unknown node, excluded the row and logged it
 * (objectui#7349). Measured before the fix: `$nin`, `$startsWith`, `$null` and
 * `$exists` each returned the full set, and so did `$eq` — the most ordinary
 * operator an author can reach for, whose plain-equality sibling
 * (`{ age: 26 }`) was correct all along.
 *
 * The direction of the change is worth stating plainly, because it MOVES
 * RESULTS: a filter that silently selected everything now selects the rows it
 * names, and one this matcher cannot execute selects nothing and says so. Both
 * are louder than what they replace; neither is "match everything", which was
 * nobody's intent.
 *
 * ## What is refused, and why each one
 *
 * Nothing the spec DECLARES is on this list — `REFUSED_OPERATORS` in the
 * companion test is empty, so the `FILTER_OPERATORS` parity guard covers the
 * whole published vocabulary rather than a subset of it. What follows is
 * everything OUTSIDE that vocabulary.
 *
 * - **`$like` / `$ilike`** — declared by `StringOperatorSchema` but deliberately
 *   kept OUT of `FILTER_OPERATORS` while the faces that cannot execute them are
 *   staged in (objectstack#7536). This matcher has no pattern engine, and the
 *   spec's own note says naming them before an arm exists turns a loud refusal
 *   into a dropped predicate — i.e. every row, the defect this file just fixed.
 * - **`$regex` / `$options`** — RETIRED from the protocol (objectstack#4706).
 *   The refusal prints `RETIRED_FILTER_OPERATORS`' prescription verbatim, the
 *   way the five driver-side refusal sites do, so six faces say one thing.
 * - **Anything else**, including a nested relation constraint
 *   (`{ profile: { verified: true } }`), whose keys are field names rather than
 *   operators: this matcher does not descend into relations.
 */
function matchesDollarOperator(
  record: any,
  value: any,
  operator: string,
  rawTarget: any,
  field: string,
  refusals: Set<string>,
): boolean {
  // objectui#8514 — the `$` twin of the AST guard above, and the position that
  // carries the fail-OPEN case: `$ne` against an array is always true.
  if (Array.isArray(rawTarget) && !DOLLAR_LIST_COMPARAND_OPERATORS.has(operator)) {
    return refuseArrayComparand(refusals, field, operator);
  }

  // objectui#8515 — a `{ $field }` reference inside a list comparand.
  if (Array.isArray(rawTarget) && rawTarget.some(isFieldReferenceComparand)) {
    return refuseListMemberFieldReference(refusals, field, operator);
  }

  // objectui#8515 — a `{ $field }` reference as the WHOLE comparand.
  const target = isFieldReferenceComparand(rawTarget)
    ? resolveFieldReference(
      record, rawTarget, operator, operator, field,
      DOLLAR_FIELD_REFERENCE_OPERATORS, refusals,
    )
    : rawTarget;
  if (target === REFUSED_COMPARAND) return false;

  switch (operator) {
    // objectui#10829 — the same helper as the AST twins above.
    case '$eq':
      return comparandEquals(value, target);
    case '$ne':
      return !comparandEquals(value, target);
    case '$gt':
      return value > target;
    case '$gte':
      return value >= target;
    case '$lt':
      return value < target;
    case '$lte':
      return value <= target;
    case '$in':
      return Array.isArray(target) && target.some((member) => comparandEquals(value, member));
    case '$nin':
      return Array.isArray(target) && !target.some((member) => comparandEquals(value, member));
    case '$between':
      return Array.isArray(target) && target.length === 2
        && value >= target[0] && value <= target[1];
    // -- Text operators. Same ruling the AST arms carry (objectstack#4706 Q2):
    // the `$contains` family is case-SENSITIVE and `$icontains` is its one
    // case-insensitive member, folding ASCII only on both sides.
    case '$contains':
      return typeof value === 'string' && value.includes(String(target));
    // objectui#8748 — the `$` twin of the comparand door in the AST arm. Both
    // dialects have to refuse the same two shapes: `find()` picks between the
    // matchers on nothing more than whether `$filter` arrived as an array or an
    // object, so a door on one side only is a result that changes with the
    // SHAPE of the filter rather than with its meaning (objectui#8447).
    case '$icontains':
      if (isRefusedTextComparand(target)) {
        return refuseTextComparand(refusals, field, operator, target);
      }
      return typeof value === 'string' && asciiCaseInsensitiveContains(value, target);
    // objectui#8452 — the `$` spelling of the same cell, and the same fix: the
    // complement of the `$contains` arm above rather than a `typeof` test
    // standing in for the predicate. objectstack#14079 option A: a stored value
    // that is not a string never satisfies a positive text operator and
    // satisfies `$notContains`, so complementarity holds on every face. The two
    // dialects are pinned against each other so this one cannot drift back.
    case '$notContains':
      return !(typeof value === 'string' && value.includes(String(target)));
    case '$startsWith':
      return typeof value === 'string' && value.startsWith(String(target));
    case '$endsWith':
      return typeof value === 'string' && value.endsWith(String(target));
    // -- Null-ness. Unlike the AST spelling, direction comes from the VALUE:
    // `$null: true` is IS NULL and `$null: false` is IS NOT NULL, which is the
    // lowering `convertFiltersToAST` already performs.
    case '$null':
      return target
        ? value === null || value === undefined
        : value !== null && value !== undefined;

    // `$exists` is the exact INVERSE of `$null`, and that is the platform's own
    // reading rather than one invented here: `convertFiltersToAST`
    // (`../utils/filter-converter.ts`) lowers `$exists: true` to `is_not_null`
    // and `$exists: false` to `is_null`, three lines below where it lowers
    // `$null` the other way round. Both operators are absent from that file's
    // `convertOperatorToAST` map and both are special-cased BEFORE it, so that
    // map's silence is not a decision about either of them. Two producers in
    // this repo emit `$exists` — `FilterConditionField`'s `exists` /
    // `notExists` (kept reachable on purpose by objectui#4736) and
    // `datasetFilterCondition`'s `isEmpty` / `isNotEmpty` — so refusing it
    // would have turned "every row" into "no rows" on a filter that looks like
    // it works, which is the one outcome worse than the bug.
    case '$exists':
      return target
        ? value !== null && value !== undefined
        : value === null || value === undefined;

    // objectui#11094 — `$empty`, which `@objectstack/spec` 17.6.0 admitted to
    // `FILTER_OPERATORS` (objectstack#20446) and to which it lowers `is_empty` /
    // `is_not_empty`. `true` selects the empty rows and `false` is the exact
    // complement, by value (see {@link isEmptyStoredValue}); the AST twins are
    // the `is_empty` / `is_not_empty` arms in `matchesComparisonNode`.
    //
    // The flag is a BOOLEAN by declaration (`SpecialOperatorSchema`), so
    // anything else is refused here rather than read for its truthiness. That
    // is the answer the spec gives at its save door and on every query face,
    // and `@objectstack/formula`'s matcher denies a non-boolean flag too.
    case '$empty':
      if (target === true) return isEmptyStoredValue(value);
      if (target === false) return !isEmptyStoredValue(value);
      return refuseFilterNode(
        refusals,
        `filter operator '$empty' on field '${field}' takes a boolean flag (true or false); `
        + `received ${describeComparand(target)}`,
      );

    // objectui#8515 — the hand-authored IMPLICIT form `{ amount: { $field: 'x' } }`.
    // It is not a reference comparand: an object whose only key starts with `$`
    // reads as an OPERATOR SPEC named `$field`, which is why this arrives here
    // as an operator at all. objectstack#7597 ruled that form keeps its
    // fail-closed fate rather than being promoted, and named the spelling that
    // works — the same one `driver-sql`'s refusal names. The default arm below
    // already excluded the row; this arm only replaces "not implemented" with
    // the prescription, so an author reading the console can act on it.
    case '$field':
      return refuseFilterNode(
        refusals,
        `field '${field}' carries a bare { $field } object, which reads as an operator `
        + `named '$field' rather than as a comparand. Write the explicit comparison `
        + `{ ${field}: { $eq: { $field: ${JSON.stringify(String(rawTarget))} } } }`,
      );

    default: {
      const retired = RETIRED_FILTER_OPERATORS[operator];
      if (retired) {
        return refuseFilterNode(
          refusals,
          `filter operator '${operator}' on field '${field}' is retired. ${retired.why}`,
        );
      }
      if (!operator.startsWith('$')) {
        return refuseFilterNode(
          refusals,
          `filter condition on field '${field}' carries the non-operator key `
          + `'${operator}'; the in-memory matcher does not descend into a nested `
          + `relation constraint`,
        );
      }
      return refuseFilterNode(
        refusals,
        `filter operator '${operator}' on field '${field}' is not implemented by the `
        + `in-memory matcher`,
      );
    }
  }
}

/**
 * Evaluate ONE `$and` / `$or` group against a record (objectui#8513).
 *
 * ## The identities are the JS reducers, not a special case
 *
 * `$and` is `every` and `$or` is `some`, and the empty-array answers those two
 * reducers already give — `[].every(…)` is `true`, `[].some(…)` is `false` —
 * ARE the ruled identities. objectstack#5322 (closed `completed`, merged as
 * objectstack#5365) fixed `{ $and: [] }` as TRUE / every row and `{ $or: [] }`
 * as FALSE / no row, and `@objectstack/spec` pins all four identity answers in
 * the cross-backend `FILTER_LOGIC_CASES` table that
 * `ValueDataSource.filterLogicConformance.test.ts` drives this matcher through.
 * So there is no identity branch to write here and none to get wrong: writing
 * one would be a second statement of the rule that could drift from the table.
 *
 * A `{}` branch needs no arm either. {@link matchesFilter} answers `true` for a
 * filter with no entries, which is what makes a `{}` disjunct a TRUE branch
 * that ABSORBS its `$or` and a `{}` conjunct one that drops out of an `$and` —
 * the third and fourth identities, for free, from the same recursion.
 *
 * ## Why the members are checked BEFORE any of them is evaluated
 *
 * `every` / `some` short-circuit, so a lazy shape check would reach a malformed
 * member for some records and not for others — and `refusals` is drained once
 * per `find()`, so whether the author sees the diagnostic at all would depend
 * on which row happened to be tested first. Validating the whole member list up
 * front makes the refusal a property of the FILTER rather than of the data.
 *
 * A refused group excludes the row, the same direction every other refusal in
 * this file takes. Inside `$or` that is narrowing (one fewer way to match) and
 * inside `$and` it is exclusion outright; neither can widen a result set.
 */
function matchesLogicalGroup(
  record: any,
  keyword: '$and' | '$or',
  value: any,
  refusals: Set<string>,
): boolean {
  if (!Array.isArray(value)) {
    return refuseFilterNode(
      refusals,
      `filter combinator '${keyword}' takes an ARRAY of conditions; received `
      + `${typeof value === 'object' && value !== null ? 'an object' : typeof value}: `
      + `${JSON.stringify(value) ?? String(value)}. The spec declares `
      + `'${keyword}?: FilterCondition[]' (FilterConditionSchema, data/filter.zod.ts)`,
    );
  }

  for (const branch of value) {
    if (branch === null || typeof branch !== 'object' || Array.isArray(branch)) {
      return refuseFilterNode(
        refusals,
        `every member of filter combinator '${keyword}' must be a filter condition `
        + `OBJECT; received ${JSON.stringify(branch) ?? String(branch)}. The spec `
        + `declares '${keyword}?: FilterCondition[]' (FilterConditionSchema, `
        + `data/filter.zod.ts)`,
      );
    }
  }

  return keyword === '$and'
    ? value.every((branch: any) => matchesFilter(record, branch, refusals))
    : value.some((branch: any) => matchesFilter(record, branch, refusals));
}

/**
 * In-memory evaluation of an OBJECT-shaped (`$`-dialect) filter.
 *
 * Reads a flat key/value equality (`{ age: 26 }`) or a `FieldOperatorsSchema`
 * condition object (`{ age: { $gte: 25 } }`), one entry per field, ANDed. What
 * it cannot execute it refuses through {@link refuseFilterNode} — excluded and
 * logged once per distinct refusal per `find()` — rather than adding no
 * constraint, which is what its `default: break` used to do (objectui#8447).
 *
 * ## `$and` / `$or` are EXECUTED here; `$not` is still refused (objectui#8513)
 *
 * The three `LOGICAL_OPERATORS` are not one case and this file must not let a
 * fix flatten them into one. Before objectui#8447 made the refusal loud, they
 * failed in two OPPOSITE directions: `{ $and: [...] }` / `{ $or: [...] }` carry
 * an ARRAY, so they fell to the simple-equality branch below
 * (`record['$and'] !== [...]` is always true) and excluded EVERY row, while
 * `{ $not: {...} }` carries an OBJECT (`FilterConditionSchema`, not an array),
 * entered the operator branch with its own nested FIELD names read as operator
 * names, and matched every row. Two bugs, opposite signs, one heading.
 *
 * **`$and` / `$or` are executed** because the semantics they were waiting on
 * have been ruled and shipped: objectstack#5322 (merged objectstack#5365)
 * settled the empty-group identities, and five platform backends already answer
 * to them through the shared `FILTER_LOGIC_CASES` conformance table. Refusing a
 * shape the spec DECLARES, this repo's own `convertFiltersToAST` LOWERS, and
 * every wire face EXECUTES made this adapter the one face that answers "no
 * rows" to a filter the UI itself offers — the outcome objectui#8515 already
 * ruled worse than the bug. Executing them is therefore restoring a declared
 * invariant, not widening an accept set: no new operator, no new key, nothing
 * admitted that `FilterConditionSchema` does not already declare.
 *
 * **`$not` keeps its refusal**, deliberately and with its own message rather
 * than by falling through to the unknown-`$`-key arm below. objectstack#5146
 * (merged objectstack#5296) did rule its NULL-safe semantics — the operand
 * compiles to a TOTAL predicate before being negated — but this repo's own
 * `convertFiltersToAST` (`../utils/filter-converter.ts`) still THROWS for
 * `$not`, on a narrowing that is about the AST rather than about the ruling:
 * `FILTER_ARRAY_LOGIC_KEYWORDS` is `['and', 'or']`, so the array dialect has no
 * negation keyword, and rewriting the negation inward is silently partial
 * because `startswith` / `endswith` / `between` / `icontains` have no negated
 * counterpart in `VALID_AST_OPERATORS`. Whether that objectui-side narrowing
 * should stand now that upstream has ruled is a question objectui#8513 does not
 * decide, so `$not` is left exactly where it was — refused, loudly, and
 * distinguishable in the log from a group that executes.
 */
function matchesFilter(
  record: any,
  filter: Record<string, any>,
  refusals: Set<string>,
): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    // The two combinators this matcher executes. A group is one ENTRY of the
    // condition object, so it ANDs with its siblings exactly as a field entry
    // does — `{ status: 'open', $or: [...] }` is "status AND the group", which
    // is what `FILTER_LOGIC_CASES` measures in both key orders.
    if (key === '$and' || key === '$or') {
      if (!matchesLogicalGroup(record, key, condition, refusals)) return false;
      continue;
    }

    // Refused on its own terms, ahead of the generic `$` arm, so the log tells
    // an author which of the three combinators they hit and why this one is
    // different. See this function's doc for the reasoning; the short version
    // is that the AST this repo lowers to has no negation keyword.
    if (key === '$not') {
      return refuseFilterNode(
        refusals,
        `filter combinator '$not' is not executed by the object-dialect matcher. `
        + `Its NULL-safe semantics are ruled (objectstack#5146) but this repo's own `
        + `lowering refuses it too: FILTER_ARRAY_LOGIC_KEYWORDS is ['and', 'or'], so `
        + `the filter AST has no negation keyword, and rewriting the negation inward `
        + `would be silently partial ('startswith', 'endswith', 'between' and `
        + `'icontains' have no negated counterpart). Express the negation with a `
        + `negated operator instead ($ne, $nin, $notContains); note those follow each `
        + `operator's own answer for a missing value rather than $not's NULL-safe rule`,
      );
    }

    if (key.startsWith('$')) {
      return refuseFilterNode(
        refusals,
        `filter key '${key}' is not a field name and not one of the combinators this `
        + `matcher executes ($and / $or). The spec's LOGICAL_OPERATORS are `
        + `$and / $or / $not and nothing else`,
      );
    }

    const value = record[key];

    // objectui#10829 — a `Date` is a COMPARAND, not an operator map. It is an
    // object and not an array, so it used to enter the operator branch below,
    // where `Object.entries` of a Date is `[]`: the loop ran zero times and the
    // field added NO constraint. `{ status: 'a', created: someDate }` answered
    // the same rows as `{ status: 'a' }`, in silence, while
    // `convertFiltersToAST` lowers the same filter to
    // `['created', '=', someDate]` (objectui#8555).
    //
    // So it takes the simple-equality branch, the position every other
    // accepted comparand takes. That branch compares through
    // `comparandEquals`, the helper the AST arm's `=` uses, so the object filter
    // and its lowered array answer one row set: the rows holding the same
    // instant as a `Date`. The gate is the
    // spec's `isAcceptedFilterComparand`, the predicate the converter lowers a
    // Date through, rather than a local `instanceof Date`: an object-typed
    // value the converter lowers as a comparand is then one this matcher reads
    // as a comparand, and no such value can reach the zero-operator loop.
    if (
      condition && typeof condition === 'object' && !Array.isArray(condition)
      && !isAcceptedFilterComparand(condition)
    ) {
      // Operator-based filter — every operator on the field is ANDed.
      for (const [op, target] of Object.entries(condition)) {
        if (!matchesDollarOperator(record, value, op, target, key, refusals)) return false;
      }
    } else if (Array.isArray(condition)) {
      // objectui#8514 — the implicit-equality position this card was filed
      // about. It reaches here because the operator branch above is guarded by
      // `!Array.isArray(condition)`, and that guard STAYS: routing an array
      // into the operator loop would read its INDICES as operator names, the
      // exact shape `$not` had before objectui#8447 fixed it.
      return refuseArrayComparand(refusals, key, 'implicit equality');
    } else {
      // Simple equality — a scalar, `null`, or a `Date` (objectui#10829).
      if (!comparandEquals(value, condition)) return false;
    }
  }
  return true;
}

/**
 * The object `$filter`'s first condition that is an object with NO OWN KEYS and
 * that the converter refuses: `{ created: {} }`, alone or anywhere under `$and`
 * / `$or` (objectui#10817).
 *
 * ## What was wrong
 *
 * {@link matchesFilter} read `{ created: {} }` as an operator map whose
 * operator loop runs zero times, so the field added NO constraint.
 * `{ status: 'a', created: {} }` answered the same rows as `{ status: 'a' }`,
 * and `{ created: {} }` answered every row, with no console line. The same
 * authored filter is refused on the ObjectStack path: `@objectstack/spec` ruled
 * `{ field: {} }` REJECTED wherever it appears (objectstack#5240, recorded on
 * `FilterConditionSchema`), and `convertFiltersToAST` refuses it alone
 * (objectui#9164) and beside a key that lowers (objectui#10788). One filter,
 * two fates, and the value face took the widening one.
 *
 * ## Why the converter decides, and not a check written here
 *
 * The field is handed to {@link toFilterNodeSafely} on its own, as
 * `{ [field]: condition }`. The converter alone decides what an empty operator
 * map is, with its own throw site and its own wording, so there is no second
 * opinion to drift and no new export (`@object-ui/core` re-exports the whole
 * converter module). Only a zero-key object is routed: an object that HAS keys
 * is an operator map the matcher below already reads, and refuses per node
 * when it cannot.
 *
 * What the routing carries, on purpose, is whatever the converter decides for
 * a zero-key object. A `RegExp`, `Map` or `Set` also has no own keys, and the
 * converter refuses it as an exotic comparand (objectui#8567), so this face now
 * refuses it too instead of dropping the constraint. A `Date` has no own keys
 * either, but the converter LOWERS it, so it reaches the matcher, which reads
 * it as implicit equality and matches the rows holding the same instant as a
 * `Date` (objectui#10829). A `null` / `undefined` condition is not an object
 * and is not routed.
 *
 * ## Why up front, and why the whole filter
 *
 * {@link matchesFilter} returns on a row's first false entry and `$or` uses
 * `some`, so a refusal raised while matching would fire for some rows and not
 * for others: `{ status: 'a', created: {} }` would log only if some row had
 * status `'a'`, and `{ $or: [{ status: 'b' }, { status: 'a', created: {} }] }`
 * would still answer the `'b'` rows. `@objectstack/formula` walks the tree
 * before evaluating for the same reason. A refused filter answers NO rows and
 * logs the converter's reason once, which is exactly how the array arm answers
 * a filter its lowering refuses (objectui#10767). `find` never throws on a bad
 * filter (objectui#7349).
 *
 * The walk follows the two combinators {@link matchesFilter} executes. A
 * malformed group, `$not` and every other `$` key keep the refusals the
 * matcher already gives them.
 */
function zeroKeyConditionRefusal(
  filter: Record<string, unknown>,
): FilterOperatorError | undefined {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(condition)) continue;
      for (const member of condition) {
        if (member === null || typeof member !== 'object' || Array.isArray(member)) continue;
        const refusal = zeroKeyConditionRefusal(member as Record<string, unknown>);
        if (refusal) return refusal;
      }
      continue;
    }
    if (key.startsWith('$')) continue;
    if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) continue;
    if (Object.keys(condition).length > 0) continue;
    const lowered = toFilterNodeSafely({ [key]: condition });
    if (!lowered.ok) return lowered.refusal;
  }
  return undefined;
}

/** Apply sort ordering to an array (returns a new sorted array) */
function applySort<T>(
  data: T[],
  orderby?: QueryParams['$orderby'],
): T[] {
  if (!orderby) return data;

  // Normalize to array of { field, order }
  let sorts: Array<{ field: string; order: 'asc' | 'desc' }> = [];

  if (Array.isArray(orderby)) {
    sorts = orderby.map((item) => {
      if (typeof item === 'string') {
        if (item.startsWith('-')) {
          return { field: item.slice(1), order: 'desc' as const };
        }
        return { field: item, order: 'asc' as const };
      }
      return { field: item.field, order: (item.order ?? 'asc') as 'asc' | 'desc' };
    });
  } else if (typeof orderby === 'object') {
    sorts = Object.entries(orderby).map(([field, order]) => ({
      field,
      order: order as 'asc' | 'desc',
    }));
  }

  if (sorts.length === 0) return data;

  return [...data].sort((a: any, b: any) => {
    for (const { field, order } of sorts) {
      const av = a[field];
      const bv = b[field];
      if (av === bv) continue;
      if (av == null) return order === 'asc' ? -1 : 1;
      if (bv == null) return order === 'asc' ? 1 : -1;
      const cmp = av < bv ? -1 : 1;
      return order === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

/** Pick specific fields from a record */
function selectFields<T>(record: T, fields?: string[]): T {
  if (!fields || fields.length === 0) return record;
  const out: any = {};
  for (const f of fields) {
    if (f in (record as any)) {
      out[f] = (record as any)[f];
    }
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// ValueDataSource
// ---------------------------------------------------------------------------

/**
 * ValueDataSource — an in-memory DataSource backed by a static array.
 *
 * Used when `ViewData.provider === 'value'`. All operations are synchronous
 * (but wrapped in Promises to satisfy the DataSource interface). Supports
 * basic filter, sort, pagination, and CRUD operations.
 *
 * @example
 * ```ts
 * const ds = new ValueDataSource({
 *   items: [
 *     { id: '1', name: 'Alice', age: 30 },
 *     { id: '2', name: 'Bob', age: 25 },
 *   ],
 * });
 *
 * const result = await ds.find('users', { $filter: { age: { $gt: 26 } } });
 * // result.data === [{ id: '1', name: 'Alice', age: 30 }]
 * ```
 */
export class ValueDataSource<T = any> implements DataSource<T> {
  private items: T[];
  private idField: string | undefined;
  private mutationListeners = new Set<(event: DataSourceMutationEvent<T>) => void>();

  constructor(config: ValueDataSourceConfig<T>) {
    // Deep clone to prevent external mutation.
    //
    // `structuredClone`, NOT a `JSON.parse(JSON.stringify(...))` round-trip
    // (objectui#9175, maintainer ruling A on objectui#9061). The clone exists
    // only to stop a caller mutating rows this read-only query source already
    // handed out; it was never a serialization boundary, and the round-trip
    // quietly made it one. Everything routed through `provider: 'value'` had to
    // survive `JSON.stringify` — so a `Date` came back as a string, keys whose
    // value was `undefined` disappeared, a cycle threw, and objectui#6018's
    // pinned guarantee ("an inline value never has to be serializable at all")
    // became false the moment a renderer routed its inline rows through this
    // adapter to honour `filter` / `sort` / the objectui#7210 ceiling.
    //
    // `structuredClone` handles cycles, `Date`, `Map`/`Set`, `BigInt` and typed
    // arrays, and is already an unguarded runtime requirement of published
    // ObjectUI packages (`@object-ui/app-shell`, `@object-ui/plugin-designer`).
    // It still throws `DataCloneError` on a function or a DOM node — that is
    // deliberate and stays LOUD: ⛔ no `try`/`catch` fallback here, because
    // falling back to the round-trip would restore exactly the silent
    // flattening this replaces.
    this.items = structuredClone(config.items);
    this.idField = config.idField;
  }

  /** Notify all mutation subscribers */
  private emitMutation(event: DataSourceMutationEvent<T>): void {
    for (const listener of this.mutationListeners) {
      try { listener(event); } catch (err) { console.warn('ValueDataSource: mutation listener error', err); }
    }
  }

  // -----------------------------------------------------------------------
  // DataSource interface
  // -----------------------------------------------------------------------

  async find(_resource: string, params?: QueryParams): Promise<QueryResult<T>> {
    let result = [...this.items];

    // Filter — support both MongoDB-style objects and AST-format arrays
    if (params?.$filter) {
      // ONE collector for BOTH arms, drained after the pass: a node either
      // matcher refuses would otherwise log once PER ROW. Shared on purpose —
      // the two arms differ only in the SHAPE of `$filter`, and objectui#8447
      // was exactly the asymmetry of one arm refusing loudly while the other
      // waved everything through in silence.
      const refusals = new Set<string>();
      if (Array.isArray(params.$filter)) {
        // objectui#10767 — THE ARRAY ARM LOWERS BEFORE IT MATCHES.
        //
        // An array `$filter` is one of three things: an AST node, a legacy flat
        // list of nodes, or a spec `ViewFilterRule[]` (`[{ field, operator,
        // value }, …]`) — the ONLY form the spec's converged `filter` doors
        // accept (objectui#6206 B), and therefore the form a spec-conformant
        // page carries. `matchesASTFilter` reads the first two; a rule OBJECT
        // is none of its shapes, so it used to refuse every row of a
        // spec-conformant filter with one warning, and the four blocks whose
        // rows can be inline (`object-map` / `object-tree` / `object-calendar`
        // / `object-gantt`) rendered NOTHING for the one filter an author is
        // allowed to write.
        //
        // The lowering is the repo's ONE sink, `toFilterNode` — the same
        // function the grid, the list and every other lowering caller already
        // use before a wire query — so this adapter grows no second lowering
        // and no second operator table: the rule's operator goes through the
        // spec's own `normalizeFilterOperator` there, and arrives here as the
        // AST spelling the arm below already executes (`equals`,
        // `greater_than`, …). `QueryParams.$filter` (`@object-ui/types`) has
        // declared the array form legal for every DataSource and named the wire
        // adapter's `translateFilterToAST` as the accept set; this was the one
        // face in the family that did not read the rule array, so
        // `resolveDataSource` answered `provider: 'value'` with an adapter that
        // read FEWER filter shapes than `provider: 'object'` got.
        //
        // The matcher itself is NOT relaxed. `toFilterNode` returns an AST
        // array untouched (no rule objects, nothing to lower), `undefined` for
        // an empty array (no filter — what the object-bound arm answers too),
        // and passes an operator the spec does not know through VERBATIM, so a
        // node that is genuinely unreadable still reaches the refusals below
        // unchanged and still excludes the row with the same sentence. A rule
        // the lowering itself refuses is excluded and logged once through
        // `loweringRefusalReason` — never thrown from `find`.
        const lowered = toFilterNodeSafely(params.$filter);
        if (!lowered.ok) {
          refuseFilterNode(refusals, loweringRefusalReason(lowered.refusal));
          result = [];
        } else if (Array.isArray(lowered.node) && lowered.node.length > 0) {
          const node = lowered.node;
          result = result.filter((r) => matchesASTFilter(r, node, refusals));
        }
      } else if (Object.keys(params.$filter).length > 0) {
        // objectui#10817 — a condition that is an object with no own keys is
        // judged by the converter BEFORE any row is matched, and a refusal
        // answers the whole filter the way the array arm answers one above.
        const filter = params.$filter as Record<string, any>;
        const refusal = zeroKeyConditionRefusal(filter);
        if (refusal) {
          refuseFilterNode(refusals, loweringRefusalReason(refusal));
          result = [];
        } else {
          result = result.filter((r) => matchesFilter(r, filter, refusals));
        }
      }
      for (const message of refusals) console.warn(message);
    }

    // Search (simple text search across all string fields)
    if (params?.$search) {
      const q = params.$search.toLowerCase();
      result = result.filter((r) =>
        Object.values(r as any).some(
          (v) => typeof v === 'string' && v.toLowerCase().includes(q),
        ),
      );
    }

    const totalCount = result.length;

    // Sort
    result = applySort(result, params?.$orderby);

    // Pagination
    const skip = params?.$skip ?? 0;
    const top = params?.$top;
    if (skip > 0) result = result.slice(skip);
    if (top !== undefined) result = result.slice(0, top);

    // Select
    if (params?.$select?.length) {
      result = result.map((r) => selectFields(r, params.$select));
    }

    return {
      data: result,
      total: totalCount,
      hasMore: skip + (top ?? result.length) < totalCount,
    };
  }

  async findOne(
    _resource: string,
    id: string | number,
    params?: QueryParams,
  ): Promise<T | null> {
    const record = this.items.find(
      (r) => String(getRecordId(r, this.idField)) === String(id),
    );
    if (!record) return null;

    if (params?.$select?.length) {
      return selectFields(record, params.$select);
    }
    return { ...record };
  }

  async create(_resource: string, data: Partial<T>): Promise<T> {
    const record = { ...data } as T;
    // Auto-generate an ID if missing
    if (!getRecordId(record, this.idField)) {
      const field = this.idField ?? 'id';
      (record as any)[field] = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    this.items.push(record);
    this.emitMutation({ type: 'create', resource: _resource, record: { ...record } });
    return { ...record };
  }

  async update(
    _resource: string,
    id: string | number,
    data: Partial<T>,
  ): Promise<T> {
    const index = this.items.findIndex(
      (r) => String(getRecordId(r, this.idField)) === String(id),
    );
    if (index === -1) {
      throw new Error(`ValueDataSource: Record with id "${id}" not found`);
    }
    this.items[index] = { ...this.items[index], ...data };
    // The event carries the protocol's string id (objectui#10078): an inline
    // item may hold a numeric key, and this adapter is where it converts.
    this.emitMutation({ type: 'update', resource: _resource, id: String(id), record: { ...this.items[index] } });
    return { ...this.items[index] };
  }

  async delete(_resource: string, id: string | number): Promise<boolean> {
    const index = this.items.findIndex(
      (r) => String(getRecordId(r, this.idField)) === String(id),
    );
    if (index === -1) return false;
    this.items.splice(index, 1);
    this.emitMutation({ type: 'delete', resource: _resource, id: String(id) });
    return true;
  }

  async bulk(
    _resource: string,
    operation: 'create' | 'update' | 'delete',
    data: Partial<T>[],
  ): Promise<T[]> {
    const results: T[] = [];
    for (const item of data) {
      switch (operation) {
        case 'create':
          results.push(await this.create(_resource, item));
          break;
        case 'update': {
          const id = getRecordId(item, this.idField);
          if (id !== undefined) {
            results.push(await this.update(_resource, id, item));
          }
          break;
        }
        case 'delete': {
          const id = getRecordId(item, this.idField);
          if (id !== undefined) {
            await this.delete(_resource, id);
          }
          break;
        }
      }
    }
    return results;
  }

  /**
   * Client-side (non-atomic) cross-object batch — this in-memory adapter has
   * no server transaction, so it delegates to the shared emulation. Per-op
   * MutationEvents come from the `create`/`update`/`delete` primitives above.
   */
  batchTransaction(
    operations: BatchTransactionOperation[],
  ): Promise<{ results: any[] }> {
    return emulateBatchTransaction(this, operations);
  }

  async getObjectSchema(_objectName: string): Promise<any> {
    // Infer a minimal schema from the first item
    if (this.items.length === 0) return { name: _objectName, fields: {} };

    const sample = this.items[0];
    const fields: Record<string, any> = {};
    for (const [key, value] of Object.entries(sample as any)) {
      fields[key] = { type: typeof value };
    }
    return { name: _objectName, fields };
  }

  async getView(_objectName: string, _viewId: string): Promise<any | null> {
    return null;
  }

  async getApp(_appId: string): Promise<any | null> {
    return null;
  }

  async aggregate(_resource: string, params: AggregateParams): Promise<AggregateResult[]> {
    const { field, function: aggFn, groupBy } = params;
    const groups: Record<string, any[]> = {};

    for (const record of this.items as any[]) {
      const key = String(record[groupBy] ?? 'Unknown');
      if (!groups[key]) groups[key] = [];
      groups[key].push(record);
    }

    return Object.entries(groups).map(([key, group]) => {
      const values = group.map(r => Number(r[field]) || 0);
      let result: number;

      switch (aggFn) {
        case 'count':
          result = group.length;
          break;
        case 'avg':
          result = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          break;
        case 'min':
          result = values.length > 0 ? Math.min(...values) : 0;
          break;
        case 'max':
          result = values.length > 0 ? Math.max(...values) : 0;
          break;
        case 'sum':
        default:
          result = values.reduce((a, b) => a + b, 0);
          break;
      }

      return { [groupBy]: key, [field]: result };
    });
  }

  // -----------------------------------------------------------------------
  // Mutation subscription (P2 — Event Bus)
  // -----------------------------------------------------------------------

  onMutation(callback: (event: DataSourceMutationEvent<T>) => void): () => void {
    this.mutationListeners.add(callback);
    return () => { this.mutationListeners.delete(callback); };
  }

  // -----------------------------------------------------------------------
  // Extra utilities
  // -----------------------------------------------------------------------

  /** Get the current number of items */
  get count(): number {
    return this.items.length;
  }

  /**
   * Get a snapshot of all items (cloned).
   *
   * Same clone as the constructor and for the same reason — see the note
   * there: `structuredClone`, never a JSON round-trip (objectui#9175).
   */
  getAll(): T[] {
    return structuredClone(this.items);
  }
}
