// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// HAVING — the engine-side filter over AGGREGATED rows (#4286 step 3).
//
// `query.having` was declared on the request surface since AST v2 and executed
// by nothing: `engine.aggregate()` rebuilt the driver AST without it (so a
// driver implementing HAVING would never have received it), and the in-memory
// fallback had no HAVING stage — an ADR-0078 silently-inert declaration on the
// one clause every SQL-literate author (human or model) expects to work next
// to `groupBy` / `aggregations`. ADR-0049 resolved it to ENFORCE: the engine
// applies `having` itself, uniformly, AFTER aggregation — the same
// correct-first / optimize-later two-tier shape date bucketing uses. Native
// SQL pushdown can come later behind a driver capability flag without changing
// the semantics defined here.
//
// SEMANTICS. `having` filters the AGGREGATED result rows, so the namespace it
// references is the aggregated row's own columns: aggregation aliases
// (`order_count`, `total`) and groupBy projections (the field name, or the
// item's `alias` for structured entries — after date bucketing). It is an
// ordinary FilterCondition over those columns: implicit equality, the
// comparison / set / null / existence / string operators, and `$and` / `$or` /
// `$not` composition. Operator semantics follow the Filter Protocol, with TWO
// deliberate divergences from driver-memory's matcher — the face this module
// was originally written against:
//
// 1. AN UNKNOWN OPERATOR THROWS. The memory matcher ignores operators it does
//    not know; here an ignored operator would silently return UNFILTERED
//    aggregates — the precise failure mode (#4286, ADR-0078) this module exists
//    to end. The rejection names the operator and the supported set.
//
// 2. [#5905] THE NEGATION-CARRYING OPERATORS ARE NULL-SAFE. `$ne` / `$nin` /
//    `$notContains` are satisfied by a row whose column HAS NO VALUE — "the
//    column has no value" satisfies a test for "not this value". That is the
//    ruling the maintainer took on #5298 (option A, 2026-08-06), landed by
//    PR #5962 across driver-sql, formula, service-analytics and the
//    `FILTER_LOGIC_*` conformance table. HAVING is the FIFTH evaluation face of
//    the same vocabulary and was not in that PR's inventory, which left this
//    file as the lone holdout (#5905) — and the only face no conformance table
//    covers, since `FILTER_LOGIC_CASES` does not drive the HAVING path.
//    ⚠️ [#13166] This paragraph used to end "driver-memory / driver-mongodb
//    still answer the old way only because #5499 freezes them; the divergence
//    is against a frozen face, not against the ruling." That sentence was wrong
//    TWICE, and #13166 settled both halves rather than re-tensing them — a
//    tense-only rewrite would have turned an actionable defect into
//    settled-looking prose.
//      (a) The #5499 freeze DISSOLVED on 2026-08-11 (head note of
//          `@objectstack/spec`'s `aggregation-conformance.ts`). From that date
//          it excused nothing, and the divergence was neither excused nor
//          tracked — the DEBT ledger in `scripts/check-driver-conformance.mjs`
//          is per (driver × case-set) and never carried it.
//      (b) `driver-mongodb` was never part of this divergence for THIS operator
//          family. `translateFieldOperators` passes `$nin` straight through and
//          compiles `$notContains` to `{ $not: { $regex } }`; both match a
//          missing or null field in MongoDB, so it has always answered the way
//          the ruling requires.
//    The one real holdout was `driver-memory`'s REFERENCE matcher — its own
//    live mingo path already agreed — and #13166 aligned it. So there is no
//    frozen face left for this file to be divergent against: every evaluation
//    face of the vocabulary now gives the answer this section states, and this
//    one is held to it by agreement rather than by exemption.
//
// [#7158] A THIRD divergence has been REMOVED rather than added: this face had
// no comparand-shape gate, which is what the five sibling faces refuse an
// unevaluable `$icontains` comparand with. See {@link icontainsComparandError}.
//
// [#20099] THE VERDICT IS THE FILTER'S, NOT THE DATA'S. This walker runs once
// per aggregated row, so every refusal it raises used to depend on the rows: an
// empty grouped set never reached it, a `$or` whose first branch held never
// reached its second, and a column the row does not carry left the walk at the
// no-value exit before the operator was ever read. So `{ total: { $median: 1 } }`
// was a 400 on a populated set and a 200 `[]` on an empty one. The engine now
// judges the whole clause ONCE, before any driver is asked for a row — see
// {@link assertHavingIsFilterCondition} and {@link assertHavingIsEvaluable},
// called from `ObjectQL.aggregate` beside the shared comparand-shape face and
// the comparand-TYPE door that `where` also takes. The refusals below keep their
// words; they are only raised earlier. The per-row throws stay as the floor for
// a caller that evaluates rows directly.
//
// [#20099] A `{ $field }` reference is RESOLVED against the row, as the whole
// comparand of the six scalar comparisons — the one position the Filter
// Protocol declares for it (`FieldReferenceSchema`) and the one the
// `{ $field }` `$between` refusal prescribes. See {@link compareWithReference}.
//
// [#20122] …and the per-aggregation `filter` takes the same row-independent
// walk. It shares this walker (`matchesAggregationFilter`), so its refusals
// depended on the rows exactly as `having`'s did: `{ amount: { $median: 1 } }`
// was a 400 on a populated table and a 200 on an empty one. The engine now
// judges each `aggregations[i].filter` once, before any driver is asked for a
// row — see {@link assertAggregationFilterIsEvaluable}.
//
// [#20127] In `having`, a reference carrying `addDays` is judged by the rule
// `FieldReferenceSchema.addDays` declares — "between two temporal columns of
// the same class (date/date, datetime/datetime)", the offset column numeric —
// against each aggregated column's class, read statically off the query and
// the object's declaration. See {@link aggregatedRowColumnClasses}.
//
// [#20148] In the per-aggregation `filter`, a `{ $field }` names a field the
// object declares and an `addDays` pair follows that same class rule, judged
// against the object's declared fields and refused in the words `where` gets
// for the same comparison ({@link assertAggregationFilterReferencesAreDeclared}).
// And on both positions a `Date` bound is compared as an instant
// ({@link instantsOf}), as the same bound in a `where` is.
//
// [#20176] …and, where the column's CLASS is known, every temporal comparand is
// compared by that column's storage rule — the rule the drivers apply to the
// same comparand in a `where`, `@objectstack/core`'s `temporalStorageForm`.
// [ADR-0053 D-D1 item 5, as amended] The whole-day reading of a bare-day upper
// bound on a `datetime` column is not applied here: the engine's seam lowers
// both positions before this walker sees them (`lowerFilterCondition`), and a
// caller that reaches it without a seam gets the comparison it wrote. The class
// comes from the object's declaration for the
// per-aggregation `filter` (`declaredFieldClasses`) and from the query for
// `having` (`aggregatedRowColumnClasses`, #20127's rule). See
// {@link checkCondition}. Before, both positions compared a temporal comparand
// as written, so an ISO instant against a `date` column counted 1 row where the
// same condition in a `where` counted 3.
//
// [#20873] …and on a DECLARED multi-valued field, the per-aggregation `filter`
// answers `$contains` / `$notContains` by MEMBERSHIP — the reading
// `FILTER_OPERATORS`' `$contains` docblock (`@objectstack/spec`) declares for a
// JSON-stored column and `where` already gives on every SQL dialect. Before,
// the arm failed every value that was not a string, so a stored array never
// matched: `{ owners: { $contains: 'u1' } }` counted 0 where the same `where`
// counted 2, and `$notContains` counted every row, the members included. See
// {@link storedArrayHasMember} and {@link declaredJsonStoredFields}.
//
// [#21007] …and on that same declared population, the per-aggregation `filter`
// REFUSES the scalar comparisons `where` refuses there — the equality and
// ordering family, `$between`, `$in` / `$nin` and implicit equality — with
// `where`'s code and words (`INVALID_FILTER` / 400, `@objectstack/core`'s
// `jsonColumnOperatorRefusalText`), judged once on the filter before any driver
// is asked. Before, the walker compared the whole stored array against a scalar:
// `{ owners: { $in: ['u1'] } }` counted 0 and `{ owners: { $nin: ['u1'] } }`
// counted the very rows holding `u1`, where the same `where` is a 400 on every
// SQL dialect. See {@link assertAggregationFilterSparesJsonStoredFields}.
//
// [#20981] …and on BOTH positions a non-boolean `$exists` / `$null` is refused
// `INVALID_FILTER` / 400 in the words every driver's `where` refuses it in,
// judged once before any row and per row as the floor, beside `$empty`'s gate.
// Before, `$exists` was read by truthiness (`"false"` kept the valued rows) and
// a third `$null` value constrained nothing. See
// {@link nonBooleanFlagComparandError}.

import type { FilterCondition } from '@objectstack/spec/data';
// [#20099] The reference's own declaration, so a malformed `addDays` is refused
// in the spec's words rather than in a second copy of them.
import { FieldReferenceSchema } from '@objectstack/spec/data';
// [#20099] The in-memory evaluator the SQL family's cross-field compiler is
// held to row for row (`cross-field-conformance-cases.ts`): the NULL totality
// and the whole-day `addDays` arithmetic of a reference live there once.
import { matchesFilterCondition } from '@objectstack/formula';
// [#20127] The declared value classes an aggregated column's class is read
// from — the spec's sets, so this face and the SQL compilers classify a field
// type by one list.
import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  INSTANT_TYPES,
  NUMERIC_VALUE_TYPES,
} from '@objectstack/spec/data';
// [#5702] The retired operators and the prescription a refusal prints. HAVING is
// the fifth of the five refusal sites `RETIRED_FILTER_OPERATORS`' own doc names,
// and reads the table for the same reason the four driver sites do: one
// retirement, one sentence.
import { RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
// [#6520] `$icontains`' ASCII-only fold. HAVING is the sixth JS evaluation face
// of one vocabulary, and it reads the fold from the spec for the same reason it
// reads the retirement prescriptions from there: one rule, one definition.
import { asciiCaseInsensitiveContains } from '@objectstack/spec/data';
// [#20148] The spec's reading of a `Date` against stored text for a TYPE-BLIND
// evaluator — the lift `@objectstack/formula` applies to the same pairing — so a
// `Date` bound here compares the way the same bound in a `where` does.
import { utcInstantMs } from '@objectstack/spec/data';
// [#20444] `$empty`'s value-level half — the spec's one definition of what a
// stored value counts as empty for a face that judges by value.
import { isEmptyFilterValue } from '@objectstack/spec/data';
// [#20176] The storage rule a temporal column puts a value in — ONE function,
// shared with `driver-sql`'s and `driver-memory`'s `where`.
import { temporalStorageForm, type TemporalComparandKind } from '@objectstack/core';
// [#20873] The JSON-stored population — the declared fields on which `$contains`
// asks MEMBERSHIP — from the spec's value-shape classes, the same two
// `driver-sql`'s JSON-column registry is built from.
import { STRUCTURED_JSON_TYPES, isMultiValueField } from '@objectstack/spec/data';
// [#7047] The ADR-0112 envelope this face's refusals used to omit. Shared with
// `filter-comparand-shape.ts` rather than re-declared here — see the note on
// {@link invalidFilterError} and on {@link unknownOperator} below.
import { invalidFilterError } from './filter-comparand-shape.js';
// [#21007] The operators `where` refuses on a column stored as JSON, and the
// words it refuses them in — one set and one sentence, shared with `driver-sql`
// rather than copied from it.
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';

const LOGICAL_OPERATORS = ['$and', '$or', '$not'] as const;

/**
 * [#10576] Which clause this evaluator is judging — the wording seam that lets
 * one walker serve two positions honestly.
 *
 * This module was written for `having` and its refusals said so in prose
 * ("Unsupported operator '$x' in `having`. HAVING filters the aggregated
 * rows…"). The per-aggregation `filter` (`AggregationNodeSchema.filter`, the
 * contract half of #10413) evaluates the SAME operator vocabulary with the
 * same #5298 null semantics, but over a different row population — the raw
 * source rows of one aggregation, not the aggregated result — so reusing the
 * walker verbatim would refuse an aggregation-filter mistake with a sentence
 * about a clause the caller never wrote. The clause carries the two strings
 * that differ; everything the two positions genuinely share (operators,
 * envelope, null semantics, comparand gates) stays single-sourced.
 */
interface FilterClause {
  /** Root label refusals use for position (`having`, `aggregations[2].filter`). */
  root: string;
  /** One-sentence semantics printed before the supported-operator list. */
  semantics: string;
}

const HAVING_CLAUSE: FilterClause = {
  root: 'having',
  semantics: 'HAVING filters the aggregated rows (aggregation aliases + groupBy projections)',
};

/**
 * [#10576] The clause for one `aggregations[i].filter` position. The position
 * index is baked into `root` so a refusal names WHICH aggregation carries the
 * offending key — a call can hold several, each with its own filter.
 */
export function aggregationFilterClause(index: number): FilterClause {
  return {
    root: `aggregations[${index}].filter`,
    semantics:
      'A per-aggregation `filter` narrows the SOURCE rows that one aggregation reads '
      + '(raw column namespace, the `where` operator vocabulary)',
  };
}

// [#5702] `$regex` is GONE from this vocabulary. Its arm below ran a real
// `RegExp` over the aggregated value and answered an ILLEGAL pattern with
// `return false` — "no rows", silently — which is the pair of defects #4706
// retired the operator over, on the one evaluation face no conformance table
// covers.
//
// [#6520] `$icontains` IS here now, and the sentence this comment used to carry
// — "this face would need its own ASCII-only fold" — is what stopped being true:
// the fold is the spec's `asciiCaseInsensitiveContains`, one definition shared
// by all six JS evaluation faces, so this face needs no fold of its own. The
// #5499 freeze was lifted for this operator as a sanctioned one-off (maintainer
// ruling, 2026-08-08), strictly for semantic parity.
//
// [#20444] `$empty` IS here — the emptiness flag (declared by
// `FieldOperatorsSchema`, in `FILTER_OPERATORS` since #20446), with
// its arm in {@link checkCondition} and its comparand gate beside
// `$icontains`' — judged BY VALUE, the reading ruling A on #20399 (record
// 5865693155) gives this face. See {@link emptyFlagComparandError}.
const CONDITION_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$between',
  '$in', '$nin', '$exists', '$null',
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
  '$empty',
] as const;

/**
 * [#20099] The operators whose WHOLE comparand may be a `{ $field }` reference —
 * the six scalar comparisons `FieldReferenceSchema` names, and the only
 * positions the SQL family compiles one in. Every other position (a list
 * member, a text pattern, `$exists` / `$null`) is refused by
 * {@link assertHavingIsEvaluable} rather than compared against the reference
 * OBJECT, which matched nothing. [#20981] The two flags' slot is refused as a
 * non-boolean first ({@link nonBooleanFlagComparandError}), as `$empty`'s is.
 */
const REFERENCE_COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
]);

/**
 * [#20099] A `{ $field: … }` reference by SHAPE — a non-array object carrying a
 * `$field` key, the test `@objectstack/formula`'s evaluator applies. Whether
 * the `$field` value is a string is the comparand-TYPE door's question, and it
 * runs first: `{ $field: 42 }` in a scalar slot is refused there as the plain
 * object it is.
 */
function isFieldReferenceShape(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
    && '$field' in value;
}

/** A bounded rendering of an offending value, for a human reading a 400. */
function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The refusal this face raises for an operator it will not evaluate — retired
 * (`$regex`, `$options`) or simply unknown (`$nand`, `$median`).
 *
 * ## [#7047] BOTH returns carry the ADR-0112 envelope now
 *
 * They were bare `new Error(...)`. The refusal was happening and its message was
 * already right — it printed `RETIRED_FILTER_OPERATORS[op].why` verbatim, like
 * the four driver faces — but `code` and `status` were `undefined`, so `rest`
 * served it through the unclassified-fault branch as a 500-shaped body for what
 * is a 400-class AUTHOR mistake. Measured across all five refusal faces by
 * EXECUTION rather than grep (#6993), this face was the only disagreement:
 *
 * | face | `code` | `status` |
 * |:--|:--|:--|
 * | driver-sql, driver-sqlite-wasm, driver-turso (both transports) | `INVALID_FILTER` | 400 |
 * | driver-memory (`filter-refusal.ts`), driver-mongodb | `INVALID_FILTER` | 400 |
 * | **objectql `having`** (here) | **undefined** | **undefined** |
 *
 * That is the half of #5324 the refusal itself does not fix, and the half
 * `FilterTextRejectionCase.code` exists to pin: a suite that only asserts THREW
 * stays green while the envelope is missing (#6142/#6050), which is exactly how
 * this survived the retirement PR that wrote the messages.
 *
 * Both branches, deliberately. Enveloping only the retired path would leave
 * `{ $nand: [...] }` and `{ k: { $median: 3 } }` arriving 500-shaped — the same
 * defect, one operator name away, and the more likely of the two to be typed.
 *
 * The code is `INVALID_FILTER` because this joins the contract the other four
 * faces already speak; it is not a new one. A caller swapping HAVING for a
 * driver-side `where` must not have to catch two shapes for one mistake.
 */
function unknownOperator(
  op: string,
  where: 'logical' | 'condition',
  siblings: readonly string[] = [],
  clause: FilterClause = HAVING_CLAUSE,
): Error {
  // [#5702] A RETIRED spelling gets the spec's prescription rather than the
  // vocabulary list — its author wrote a name this face ANSWERED until #4706,
  // and needs to know what replaces it, not what else exists. Retired siblings
  // are named too: `{ $regex, $options }` is one mistake with one fix.
  const retired = RETIRED_FILTER_OPERATORS[op];
  if (retired && where === 'condition') {
    const replacement = retired.to ? ` Write "${retired.to}" instead.` : '';
    const alsoRetired = siblings.filter((key) => key !== op && RETIRED_FILTER_OPERATORS[key]);
    const also = alsoRetired.length
      ? ` The same condition also carries the retired `
        + `${alsoRetired.map((key) => `'${key}'`).join(', ')} — one '${retired.to}' replaces the `
        + `whole shape, so this is ONE mistake with ONE fix, not one per key.`
      : '';
    return invalidFilterError(
      `Filter operator '${op}' in \`${clause.root}\` is RETIRED and is no longer evaluated.${replacement} `
      + `${retired.why}${also}`,
    );
  }
  const supported = where === 'logical'
    ? `${LOGICAL_OPERATORS.join(', ')} (or a column condition)`
    : CONDITION_OPERATORS.join(', ');
  return invalidFilterError(
    `Unsupported operator '${op}' in \`${clause.root}\`. ${clause.semantics} and supports: ${supported}. `
    + `An unknown operator is refused rather than ignored — ignoring it would silently `
    + `return unfiltered aggregates (ADR-0078).`,
  );
}

/**
 * [#20444] `$empty` received a comparand that is not a boolean.
 * `FieldOperatorsSchema` declares `$empty: z.boolean()`: `true` asks for the
 * empty rows, `false` for their exact complement. A third value is refused
 * rather than read — this face refuses the malformations it can see, where a
 * two-branch reading would silently constrain nothing (the hazard the `$null`
 * arm carried until [#20981] refused its third value too — see
 * {@link nonBooleanFlagComparandError}).
 */
function emptyFlagComparandError(field: string, value: unknown, path: string): Error {
  const shown = JSON.stringify(value) ?? String(value);
  return invalidFilterError(
    `Operator "$empty" on field "${field}" at ${path} requires a boolean comparand (true or false), `
    + `received ${shown}. @objectstack/spec FieldOperatorsSchema declares $empty as a boolean: true `
    + `asks for the empty rows, false for their exact complement.`,
  );
}

/**
 * [#20981] `$exists` or `$null` received a comparand that is not a boolean.
 *
 * `FieldOperatorsSchema` declares both flags `z.boolean()`, and every driver's
 * `where` refuses a third value — the #5347 ruling for `$null`, applied to
 * `$exists` by the 2026-08-06 ruling on #5298: `driver-sql` (with
 * `driver-sqlite-wasm` and Turso local), Turso's remote transport,
 * `driver-memory`, `driver-mongodb` and `service-analytics`. This face read one
 * anyway, and the engine evaluates it itself, so the answer was the same on
 * every driver. Measured through `engine.aggregate` on driver-memory and
 * driver-sql (better-sqlite3), `origin/main` `7a606a9a3`, over a text column
 * holding `'won'` on one row and no value on two:
 *
 * | comparand | `$exists` (the old `!!target` read) | `$null` (the old two-branch read) |
 * |:--|:--|:--|
 * | `"yes"`, `1`, `"false"` | the VALUED rows / the `won` group | every row and every group |
 * | `0`, `null` | the no-value rows / the null group | every row and every group |
 *
 * So `$exists` answered by truthiness — `"false"` the string kept the valued
 * side — and `$null` constrained nothing at all: the widening direction.
 *
 * ## The words are the comparand doors', not this face's
 *
 * Verbatim the diagnostic `driver-sql`'s `nonBooleanExistsComparandError` /
 * `nonBooleanNullComparandError` build — the text `driver-memory` and
 * `driver-mongodb` give on the wire — with its "this driver" clause re-aimed
 * at the backend it names, as `driver-memory`'s copy re-aims it. One condition,
 * one wording (#5240). The text has no importable home: each face spells it,
 * this package cannot depend on a driver, and neither `@objectstack/core` nor
 * the spec exports it — so this is a declared verbatim copy, the drivers'
 * `describeFilterOperand` / `safeShapePreview` rendering of the received value
 * included ({@link describeFlagOperand}), held to the drivers' first sentence
 * by `packages/rest`'s `aggregation-flag-comparand-refusal.test.ts` beside the
 * `where` twin rather than by an import.
 *
 * Unlike `driver-sql`'s `where`, the message is not withheld: no read scope is
 * merged into a per-aggregation `filter` or a `having`, and this face's other
 * comparand refusals (`$empty`, `$icontains`) name the field and the value too.
 */
function nonBooleanFlagComparandError(op: '$exists' | '$null', field: string, value: unknown, path: string): Error {
  const head = `Operator "${op}" on field "${field}" requires a boolean comparand (true or false). `
    + `Received ${describeFlagOperand(value)} at ${path}. `
    + `@objectstack/spec FieldOperatorsSchema declares ${op} as a boolean. `;
  if (op === '$exists') {
    return invalidFilterError(
      head
      + `It is refused rather than coerced for the same reason $null is: a non-boolean lands on whichever side `
      + `the backend's two-branch conditional happens to default to, and those defaults point in `
      + `OPPOSITE directions — driver-sql's \`=== false\` test compiles IS NOT NULL for anything `
      + `but false, a \`=== true\` test compiles IS NULL for anything but true. Note "false" the `
      + `STRING is truthy, so it lands on the side opposite the false it was written to mean.`,
    );
  }
  return invalidFilterError(
    head
    + `It is refused rather than coerced because the backends read a non-boolean in OPPOSITE directions — `
    + `driver-sql compiled IS NULL (anything but false), driver-memory's query path and driver-mongodb `
    + `compiled IS NOT NULL (anything but true), and driver-memory's matcher dropped the `
    + `constraint entirely. Note "false" the STRING is truthy, so it landed on the side opposite `
    + `the false it was written to mean.`,
  );
}

/**
 * [#20981] The drivers' rendering of a received comparand — `describeFilterOperand`
 * then `safeShapePreview` in parentheses (`string ("yes")`, `number (1)`,
 * `null (null)`), verbatim, so {@link nonBooleanFlagComparandError} reads byte
 * for byte as the `where` refusal of the same flag does.
 */
function describeFlagOperand(value: unknown): string {
  let kind: string;
  if (value === null) kind = 'null';
  else if (Array.isArray(value)) kind = 'array';
  else if (typeof value !== 'object') kind = typeof value;
  else {
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    kind = ctor?.name && ctor.name !== 'Object' ? ctor.name : 'object';
  }
  let shown: string;
  try {
    const json = JSON.stringify(value);
    shown = typeof json !== 'string' ? typeof value : json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    shown = typeof value;
  }
  return `${kind} (${shown})`;
}

/**
 * [#7158] `$icontains` received a comparand that is not a non-empty string.
 *
 * ## Two rejections, one constructor
 *
 * Word for word `driver-memory`'s `icontainsComparandError` (`filter-refusal.ts`)
 * and `driver-sql`'s twin of it — deliberately, because they are ONE mistake at
 * ONE position and #5240's rule (one condition keeps one wording) applies across
 * packages, not only within one:
 *
 * - **non-string** — `StringOperatorSchema` declares `$icontains: z.string()`,
 *   so coercing `42` to `"42"` would answer a query nobody wrote. Evaluated
 *   here, it answered `false` — "no rows" — which is the silent-wrong-answer
 *   shape #4706 retired `$regex` over.
 * - **empty string** — every string contains the empty substring, so the
 *   predicate constrains nothing. A predicate that constrains nothing does not
 *   narrow a query, it WIDENS it (#3948), and on an RLS read scope that is a
 *   permission bypass rather than a degraded filter. Evaluated here, it matched
 *   ALL NINE `FILTER_TEXT_ROWS` — the author wrote a constraint and got the
 *   unfiltered aggregate back, with no error.
 *
 * ## Why this face is the last to get the gate
 *
 * HAVING is the SIXTH JS evaluation face of one filter vocabulary (#6520 gave it
 * the shared ASCII fold) and was the only one with no comparand gate at all,
 * because it is the one face no conformance table drove until #7047 wrote
 * `having-filter-text-conformance.test.ts`. That file pinned the two exclusions
 * as measurements so the gap was red-on-change; this is the change.
 *
 * The `at ${path}` position is spelled from the `having` root (`having.total`,
 * `having.$and[0].name`) where the driver faces spell it from `where` — the
 * clause is the difference, and a caller reading a 400 needs to know which of
 * the two they mis-wrote. Everything after the position is verbatim.
 */
function icontainsComparandError(field: string, value: unknown, path: string): Error {
  const shown = typeof value === 'string' ? `""` : JSON.stringify(value) ?? String(value);
  return invalidFilterError(
    `Operator "$icontains" on field "${field}" at ${path} requires a NON-EMPTY string comparand, `
    + `received ${shown}. "$icontains" is a case-insensitive LITERAL substring search, so its `
    + `comparand is the text to look for — an empty one matches every row (a predicate that `
    + `constrains nothing), and a non-string one would have to be coerced into text this query `
    + `never asked for.`,
  );
}

/**
 * [#20099] `having` is not a filter condition at all — an array, a string, a
 * number, a class instance.
 *
 * `QuerySchema.having` and `EngineAggregateOptions.having` declare
 * `FilterConditionSchema`, which refuses every one of these. The walker read
 * them anyway: an array's index keys became column names (`"0"`, `"1"`), so
 * `[['total', '>', 100]]` kept no group, and anything that is not an object
 * was taken as NO condition, so `'total > 100'` kept every group.
 *
 * The array half names the `FilterArray` sugar on purpose. The spec declares
 * that input-only form on `where` alone — the transport widens that one slot,
 * and `parseFilterAST` lowers it there — so an author carrying it over from a
 * `where` is told which slot takes it rather than that it is malformed.
 */
function havingNotAConditionError(having: unknown): Error {
  const shape = 'a filter condition OBJECT over the aggregated rows — { "ALIAS": { "$gt": 100 } }';
  if (Array.isArray(having)) {
    return invalidFilterError(
      `\`having\` received an array (${preview(having)}), and \`having\` is ${shape}. The array `
      + `form — [field, operator, value] tuples and ["and", …] groups — is input-only sugar that is `
      + `lowered on \`where\` alone; \`having\` does not declare it, and it was never applied as the `
      + `filter it spells. Write the object form.`,
    );
  }
  const kind = typeof having === 'object' ? 'an object that is not a plain filter node' : `a ${typeof having}`;
  return invalidFilterError(
    `\`having\` received ${kind} (${preview(having)}), which is not a filter condition. \`having\` is `
    + `${shape}. A value of any other kind was answered as NO condition, returning every group. `
    + `Write the object form, or omit \`having\`.`,
  );
}

/**
 * [#20099] `{ field: { $field: 'other' } }` — a reference with no operator.
 *
 * Refused, not read as equality: the in-memory evaluator the SQL family is held
 * to answers this shape `false` for every row (its `$field` is an unknown
 * operator there), and `driver-sql` refuses it naming `$eq`. So the spelling is
 * given back with the operator written in. The columns are the author's own —
 * `having` carries no policy subtree — so the corrected filter names them.
 */
function bareFieldReferenceError(field: string, spec: Record<string, unknown>, path: string): Error {
  return invalidFilterError(
    `Field "${field}" at ${path} is constrained by a bare ${preview(spec)} reference with no operator. `
    + `Write the comparison explicitly — { "${field}": { "$eq": ${preview(spec)} } } — or put $ne, $gt, `
    + `$gte, $lt or $lte in place of $eq. A reference is a comparand, never a condition on its own.`,
  );
}

/**
 * [#20099] A `{ $field }` reference outside the six scalar comparisons — a
 * `$in` / `$nin` member, a text pattern. [#20981] An `$exists` / `$null`
 * operand no longer gets here: the flag gate refuses it as a non-boolean first
 * ({@link nonBooleanFlagComparandError}), as `$empty`'s gate always did.
 * Before this, the walker compared the reference OBJECT itself and matched
 * nothing (`$nin` kept everything). `$between` endpoints never get here: the
 * shared comparand-shape face refuses them first, in its own words.
 */
function fieldReferencePositionError(field: string, op: string, path: string, index?: number): Error {
  const at = index === undefined ? '' : ` at index ${index} of its value list`;
  return invalidFilterError(
    `Operator "${op}" on field "${field}" at ${path} compares against a { "$field": … } reference${at}. `
    + `A reference is evaluated only as the WHOLE comparand of a scalar comparison — $eq, $ne, $gt, `
    + `$gte, $lt or $lte — never as a list member or a text pattern. Compare against a literal here, or `
    + `write the test as one of those comparisons.`,
  );
}

/**
 * [#20099] A reference that names no column of the aggregated row.
 *
 * The aggregated row's columns are known before any row exists — the groupBy
 * projections and the aggregation aliases — so a reference that cannot resolve
 * is refused on the filter, never answered per row as "no value". The column
 * list is printed because it is the author's own query, and it is the answer.
 */
function unresolvedFieldReferenceError(
  name: string,
  path: string,
  columns: readonly string[],
): Error {
  const known = columns.length ? columns.join(', ') : '(none — the query projects no column)';
  return invalidFilterError(
    `The { "$field": "${name}" } reference at ${path} names no column of the aggregated row. A `
    + `reference in \`having\` resolves against that row's own columns — the groupBy projections and `
    + `the aggregation aliases — which here are: ${known}. A reference that cannot resolve is refused `
    + `rather than compared against nothing.`,
  );
}

/** [#20099] A reference its own declaration refuses — today, a malformed `addDays`. */
function malformedFieldReferenceError(path: string, detail: string): Error {
  return invalidFilterError(`The { "$field" } reference at ${path} is malformed: ${detail}`);
}

/**
 * [#20123] A `having` KEY that names no column of the aggregated row — the
 * twin of {@link unresolvedFieldReferenceError} for the other place a column
 * is named.
 *
 * Refused on the filter, never answered per row: {@link checkCondition} reads
 * such a key as a column with NO VALUE in every group, so a typo for an alias
 * (`{ totl: { $gt: 100 } }`) kept no group and a negated test on it
 * (`$ne`, `$exists: false`, a `$not`) kept every group — an answer
 * indistinguishable from a real one. It is the same mistake the REST
 * ingress refuses on `where` for a field the object does not have, and the
 * opening words follow that refusal's ("filters on 'X', which is not a …";
 * "the query was refused instead of answered"). The code stays this face's
 * own `INVALID_FILTER`: the name is a column of the QUERY's own projection,
 * not a field of the object, which is what `INVALID_FIELD` answers about.
 *
 * Every unknown key is named, the first with its position, and the column
 * list is printed because it is the author's own query, and it is the answer.
 */
function unknownHavingColumnError(
  unknown: ReadonlyArray<{ key: string; path: string }>,
  columns: readonly string[],
): Error {
  const [first] = unknown;
  const others = [...new Set(unknown.map((u) => u.key))].filter((key) => key !== first.key);
  const also = others.length ? ` (also: ${others.join(', ')})` : '';
  const known = columns.length ? columns.join(', ') : '(none — the query projects no column)';
  return invalidFilterError(
    `\`having\` filters on '${first.key}' at ${first.path}, which is not a column of the aggregated `
    + `row${also}. A condition on a column the row does not carry is answered as if that column had no `
    + `value in every group — a test for a value keeps no group, and a test for its absence or a `
    + `negation keeps every group — so the query was refused instead of answered. \`having\` filters `
    + `the aggregated row's own columns — the groupBy projections and the aggregation aliases — which `
    + `here are: ${known}.`,
  );
}

/**
 * [#20127] A `{ $field, addDays }` reference between aggregated columns the
 * offset has no meaning on.
 *
 * `FieldReferenceSchema.addDays` declares where the offset applies: "between
 * two temporal columns of the same class (date/date, datetime/datetime)", read
 * from an integer or a numeric column. `driver-sql` compiles exactly that on
 * `where` and refuses every other pair. `having` evaluated every pair through
 * `@objectstack/formula`, which reads a number as epoch milliseconds, so
 * `{ total: { $gt: { $field: 'max_cap', addDays: 1 } } }` answered — a day
 * added to a sum. The aggregated row now carries a class per column
 * ({@link aggregatedRowColumnClasses}), so the pair is judged here, once.
 *
 * `reason` is `driver-sql`'s own sentence for the same pair on `where`
 * (`applyCrossFieldComparison`'s `addDays` arm), with "is stored as" read as
 * "is" — an aggregated column is computed, not stored. Unlike `driver-sql`'s,
 * this diagnostic is not withheld: every column it names is the author's own
 * projection, as in {@link unresolvedFieldReferenceError}.
 */
function offsetPairError(field: string, op: string, ref: string, path: string, reason: string): Error {
  return invalidFilterError(
    `Operator "${op}" on field "${field}" at ${path} compares against another column `
    + `({ "$field": "${ref}" } with addDays), which cannot be evaluated here: ${reason} An aggregated `
    + `column's class is read off the query: a groupBy projection takes its field's declared type (a `
    + `"day" date bucket is a date, a coarser bucket a text label), count / count_distinct / sum / avg `
    + `are numeric, and min / max take the type of the field they read.`,
  );
}

/**
 * [#20127] The `addDays` pair rule, in `driver-sql`'s order: the two compared
 * columns share a class, that class is temporal, and an offset column is
 * numeric. A class the declaration cannot tell is not judged.
 */
function assertOffsetPairIsTemporal(
  field: string,
  op: string,
  reference: Record<string, unknown>,
  path: string,
  classes: ReadonlyMap<string, AggregatedColumnClass | undefined>,
): void {
  const reason = offsetPairViolation(field, reference, classes);
  if (reason !== undefined) throw offsetPairError(field, op, String(reference.$field), path, reason);
}

/**
 * [#20148] The rule {@link assertOffsetPairIsTemporal} applies, returned as the
 * reason a pair breaks it (`driver-sql`'s sentence for the same pair on
 * `where`, with "is stored as" read as "is"), or `undefined` when it holds.
 * One rule, two positions: `having` judges it against the aggregated row's
 * classes and names the columns; the per-aggregation `filter` judges it against
 * the object's declared fields and withholds them
 * ({@link assertAggregationFilterReferencesAreDeclared}).
 */
function offsetPairViolation(
  field: string,
  reference: Record<string, unknown>,
  classes: ReadonlyMap<string, AggregatedColumnClass | undefined>,
): string | undefined {
  const ref = String(reference.$field);
  const refClass = classes.get(ref);
  const targetClass = classes.get(field);
  if (refClass !== undefined && targetClass !== undefined && refClass !== targetClass) {
    return `"${field}" is ${targetClass} but "${ref}" is ${refClass}, and a cross-class comparison answers `
      + `differently in SQL (storage-class ordering) than in memory (JS coercion) — compare same-class `
      + `columns.`;
  }
  if (refClass !== undefined && refClass !== 'date' && refClass !== 'datetime') {
    return `addDays adds whole days to a date or datetime column, and "${ref}" is ${refClass} — an offset `
      + `has no meaning on it.`;
  }
  const offset = reference.addDays;
  if (!isFieldReferenceShape(offset)) return undefined;
  const offsetRef = String(offset.$field);
  const offsetClass = classes.get(offsetRef);
  if (offsetClass !== undefined && offsetClass !== 'numeric') {
    return `the addDays offset "${offsetRef}" (${offsetClass}) is not a numeric column, and a day offset `
      + `must be a number of days.`;
  }
  return undefined;
}

/**
 * [#5905] Operators whose answer for a column with NO VALUE is decided by the
 * operator's own arm below, not by the early exit in {@link checkCondition}.
 *
 * That exit exists so a POSITIVE test (`$gt`, `$in`, `$contains`, …) can never
 * be accidentally satisfied by a column the aggregated row does not carry. The
 * operators listed here are the ones for which "no value" is a real answer
 * rather than an accident:
 *
 * - `$exists` / `$null` — answering about absence IS their whole job;
 * - `$ne` / `$nin` / `$notContains` — they carry their own negation, and #5298
 *   ruled (option A) that a value-less column satisfies them, on every backend.
 *
 * `$nin` and `$notContains` were missing from this list, which is the defect
 * #5905 records: the exit fired first and answered FALSE for them, so the arms
 * below — which would have answered TRUE — were never reached.
 */
const NO_VALUE_ANSWERED_BY_OPERATOR: ReadonlySet<string> = new Set([
  '$exists', '$ne', '$null', '$nin', '$notContains',
  // [#20444] About the absence too: a column the row does not carry is EMPTY,
  // so `$empty: true` must reach its arm rather than the exit's `false`.
  '$empty',
]);

/**
 * [#20099] The aggregated row's column set — the namespace `having` filters and
 * a `{ $field }` reference in it resolves against — read off the QUERY, so it
 * is known before any row exists: every groupBy projection (the field name, or
 * a structured item's `alias` — the name `applyInMemoryAggregation` projects)
 * and every aggregation alias. Malformed entries contribute nothing; their own
 * validation is elsewhere.
 */
export function aggregatedRowColumns(groupBy: unknown, aggregations: unknown): string[] {
  const columns = new Set<string>();
  for (const g of Array.isArray(groupBy) ? groupBy : []) {
    const item = g as { alias?: unknown; field?: unknown } | null;
    const name = typeof g === 'string' ? g : (item?.alias ?? item?.field);
    if (typeof name === 'string') columns.add(name);
  }
  for (const a of Array.isArray(aggregations) ? aggregations : []) {
    const alias = (a as { alias?: unknown } | null)?.alias;
    if (typeof alias === 'string') columns.add(alias);
  }
  return [...columns];
}

/**
 * [#20127] An aggregated column's comparison class — `driver-sql`'s
 * cross-field vocabulary (`crossFieldComparisonClass`), so the words a `having`
 * refusal prints are the words the same pair gets on `where`.
 */
export type AggregatedColumnClass = 'numeric' | 'text' | 'boolean' | 'date' | 'datetime' | 'time';

/** The aggregation functions whose result is a number whatever they read. */
const NUMERIC_RESULT_FUNCTIONS: ReadonlySet<string> = new Set(['count', 'count_distinct', 'sum', 'avg']);

/** The aggregation functions whose result is one of the values they read. */
const VALUE_RESULT_FUNCTIONS: ReadonlySet<string> = new Set(['min', 'max']);

/**
 * A declared field's `type`. `undefined` when the declaration cannot tell: no
 * field map (a registry-less host), no such field, or no readable type.
 */
function declaredFieldType(
  fields: Record<string, unknown> | undefined,
  name: unknown,
): string | undefined {
  if (!fields || typeof fields !== 'object' || typeof name !== 'string') return undefined;
  if (!Object.prototype.hasOwnProperty.call(fields, name)) return undefined;
  const type = (fields[name] as { type?: unknown } | undefined)?.type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * The class a declared type carries, by the spec's value-class sets.
 * `undefined` when the type cannot tell: none, or a `formula`, whose type names
 * no stored value class.
 */
function classOfDeclaredType(type: string | undefined): AggregatedColumnClass | undefined {
  if (type === undefined || type === 'formula') return undefined;
  if (CALENDAR_DATE_TYPES.has(type)) return 'date';
  if (INSTANT_TYPES.has(type)) return 'datetime';
  if (CLOCK_TIME_TYPES.has(type)) return 'time';
  if (NUMERIC_VALUE_TYPES.has(type)) return 'numeric';
  if (BOOLEAN_VALUE_TYPES.has(type)) return 'boolean';
  // Everything else is read and compared as text, as `driver-sql` stores it.
  return 'text';
}

/**
 * A declared field's class, by the spec's value-class sets. `undefined` when
 * the declaration cannot tell: no field map (a registry-less host), no such
 * field, or a `formula`, whose type names no stored value class.
 */
function declaredFieldClass(
  fields: Record<string, unknown> | undefined,
  name: unknown,
): AggregatedColumnClass | undefined {
  return classOfDeclaredType(declaredFieldType(fields, name));
}

/**
 * [#20546] Each aggregated column's TYPE, read statically off the query and
 * the object's field declaration — the one reading {@link aggregatedRowColumnClasses}
 * classes, kept whole for a rule that needs more than the class:
 *
 * - a groupBy projection carries its field's declared type; a `day` date
 *   bucket is a `date` (its label is `YYYY-MM-DD`), and a coarser bucket a
 *   `text` label;
 * - `count` / `count_distinct` / `sum` / `avg` carry a `number`;
 * - `min` / `max` carry the type of the field they read.
 *
 * `undefined` where the declaration cannot tell. The no-operator-object arm of
 * the number-comparand door's walk reads it at `having`: the `text` class
 * lumps a `json` or `lookup` groupBy in with a real text column, and only the
 * type tells a column that holds scalar values from one that does not.
 * [#20745] The same type tells the arm's other two kinds apart — a relation
 * column and a structured-JSON column — each refused in words of its own.
 */
export function aggregatedRowColumnTypes(
  groupBy: unknown,
  aggregations: unknown,
  fields: Record<string, unknown> | undefined,
): Map<string, string | undefined> {
  const types = new Map<string, string | undefined>();
  for (const g of Array.isArray(groupBy) ? groupBy : []) {
    if (typeof g === 'string') {
      types.set(g, declaredFieldType(fields, g));
      continue;
    }
    const item = g as { alias?: unknown; field?: unknown; dateGranularity?: unknown } | null;
    const name = item?.alias ?? item?.field;
    if (typeof name !== 'string') continue;
    const granularity = item?.dateGranularity;
    types.set(name, granularity == null
      ? declaredFieldType(fields, item?.field)
      : granularity === 'day' ? 'date' : 'text');
  }
  for (const a of Array.isArray(aggregations) ? aggregations : []) {
    const agg = a as { alias?: unknown; function?: unknown; field?: unknown } | null;
    if (typeof agg?.alias !== 'string') continue;
    const fn = String(agg.function);
    types.set(agg.alias, NUMERIC_RESULT_FUNCTIONS.has(fn)
      ? 'number'
      : VALUE_RESULT_FUNCTIONS.has(fn) ? declaredFieldType(fields, agg.field) : undefined);
  }
  return types;
}

/**
 * [#20127] Each aggregated column's class, read STATICALLY — off the query and
 * the object's field declaration, never off a row — so a verdict that needs it
 * is the filter's, the same on an empty grouped set as on a populated one:
 *
 * - a groupBy projection takes its field's declared class; a `day` date bucket
 *   is a calendar DATE (its label is `YYYY-MM-DD` on every face — the bucket
 *   label contract in `@objectstack/core`'s `bucketDateKey`), and a coarser
 *   bucket (`week` / `month` / `quarter` / `year`) is a text label;
 * - `count` / `count_distinct` / `sum` / `avg` are numeric;
 * - `min` / `max` take the class of the field they read.
 *
 * A column whose class the declaration cannot tell maps to `undefined`, and a
 * rule reading this map does not judge it — the fail-open direction the
 * engine's other declared-type doors take for a registry-less host.
 *
 * [#20546] Derived from {@link aggregatedRowColumnTypes}, so the class and
 * the type of a column are one reading of the query, never two.
 */
export function aggregatedRowColumnClasses(
  groupBy: unknown,
  aggregations: unknown,
  fields: Record<string, unknown> | undefined,
): Map<string, AggregatedColumnClass | undefined> {
  const classes = new Map<string, AggregatedColumnClass | undefined>();
  for (const [column, type] of aggregatedRowColumnTypes(groupBy, aggregations, fields)) {
    classes.set(column, classOfDeclaredType(type));
  }
  return classes;
}

/**
 * [#20176] Each declared field's class — what a per-aggregation `filter` reads
 * a comparand against, since that filter narrows the object's RAW rows. The
 * same classification {@link aggregatedRowColumnClasses} gives a groupBy
 * projection of the field, and the same three temporal types the drivers index
 * for their `where` (`driver-memory`'s `indexTemporalFields`,
 * `SqlDriver.temporalFieldKind`), so this position and the driver's `where`
 * read one field by one rule. No usable field map (a registry-less host) ⇒ an
 * empty map, and every comparand is compared as written.
 */
export function declaredFieldClasses(fields: unknown): Map<string, AggregatedColumnClass | undefined> {
  const classes = new Map<string, AggregatedColumnClass | undefined>();
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return classes;
  const map = fields as Record<string, unknown>;
  for (const name of Object.keys(map)) classes.set(name, declaredFieldClass(map, name));
  return classes;
}

/**
 * [#20873] The declared fields a per-aggregation `filter` reads `$contains` /
 * `$notContains` on as MEMBERSHIP: the JSON-stored ones, a `STRUCTURED_JSON_TYPES`
 * type or a multi-valued field (`isMultiValueField`, which covers
 * `MULTI_OPTION_TYPES` and a multi-capable type flagged `multiple: true`).
 *
 * The contract (`FILTER_OPERATORS`' `$contains` docblock, `@objectstack/spec`)
 * selects the question by the COLUMN — "One operator, two questions, selected
 * by the COLUMN rather than by the caller" — because the storage shape is
 * declared metadata. So the fork reads the declaration, never the row:
 * `driver-sql` forks on its JSON-column registry the same way
 * (`SqlDriver.isJsonColumn`, built from the same two spec sets), and a declared
 * multi-valued field holding something other than an array has no member there,
 * as it has none here.
 *
 * Measured at the public door, the two halves of the population do not reach
 * this evaluator alike: the engine's text-operator declared-type door refuses
 * `$contains` / `$notContains` on a declared STRUCTURED-JSON field before any
 * row is read (`INVALID_FILTER`, in `where` and in the per-aggregation `filter`
 * alike), so the half that arrives is the multi-valued one, whose rows the
 * write door stores as an array (a scalar written to it is wrapped). The whole
 * population is named anyway, so this face, `driver-sql` and `driver-memory`
 * read one definition.
 *
 * No usable field map (a registry-less host) ⇒ an empty set, and the arms keep
 * the substring reading, as `driver-sql` does for a table it was never told
 * about.
 *
 * [#21007] The same set is the population on which the per-aggregation `filter`
 * REFUSES the scalar comparisons `where` refuses on a JSON column
 * ({@link assertAggregationFilterSparesJsonStoredFields}). Here the two halves
 * of the population DO arrive alike: no earlier door refuses `$eq` / `$in` / …
 * on a structured-JSON field, so a `json` field's `{ meta: { $eq: 'a' } }` is
 * refused here, as `where` refuses it.
 */
export function declaredJsonStoredFields(fields: unknown): Set<string> {
  const stored = new Set<string>();
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return stored;
  for (const [name, def] of Object.entries(fields as Record<string, unknown>)) {
    const type = (def as { type?: unknown } | null)?.type;
    if (typeof type !== 'string') continue;
    const multiple = (def as { multiple?: unknown }).multiple === true;
    if (STRUCTURED_JSON_TYPES.has(type) || isMultiValueField({ type, multiple })) stored.add(name);
  }
  return stored;
}

/**
 * [#20176] The storage rule a column of `cls` takes, or `undefined` for a class
 * that has none (numeric, text, boolean) and for a column whose class the
 * declaration cannot tell. [#20263] Also the kind the `having` temporal-comparand
 * door judges a comparand by, so the rule that reads it and the door that
 * refuses it name one kind.
 */
export function temporalKindOf(cls: AggregatedColumnClass | undefined): TemporalComparandKind | undefined {
  return cls === 'date' || cls === 'datetime' || cls === 'time' ? cls : undefined;
}

/**
 * [#20099] Refuse a `having` that is not a filter condition at all: anything but
 * `null` / `undefined` (no clause) and a plain object. See
 * {@link havingNotAConditionError} for what each shape used to answer.
 *
 * Called by `ObjectQL.aggregate` FIRST on the clause, before the comparand
 * faces, because every later door walks a filter node and steps silently
 * around anything that is not one.
 */
export function assertHavingIsFilterCondition(having: unknown): void {
  if (having == null) return;
  if (typeof having === 'object' && !Array.isArray(having)) {
    const proto = Object.getPrototypeOf(having);
    if (proto === Object.prototype || proto === null) return;
  }
  throw havingNotAConditionError(having);
}

/**
 * [#20099] Judge a whole `having` clause ONCE, independent of the rows — every
 * refusal the per-row walk can raise, plus the `{ $field }` reference's
 * position and name.
 *
 * `ObjectQL.aggregate` calls this after the shared comparand-shape face and the
 * comparand-TYPE door, the order `where` takes the same doors in, and before
 * `getDriver`, the middleware chain and both `applyHaving` doors. So an empty
 * grouped set refuses what a populated one refuses, a `$or` refuses a branch it
 * would have short-circuited past, and a condition on a column the row does not
 * carry is still read for its operator.
 *
 * What it refuses, in the order the per-row walk would meet it:
 * - an unknown or retired `$` key, at node or condition level — the walker's
 *   own {@link unknownOperator} words;
 * - an `$icontains` comparand that is not a non-empty string —
 *   {@link icontainsComparandError};
 * - [#20444] an `$empty` comparand that is not a boolean —
 *   {@link emptyFlagComparandError}; [#20981] and an `$exists` / `$null` one,
 *   in the drivers' words — {@link nonBooleanFlagComparandError};
 * - a bare `{ field: { $field } }` — {@link bareFieldReferenceError};
 * - a reference outside the six scalar comparisons —
 *   {@link fieldReferencePositionError};
 * - a reference its declaration refuses (a malformed `addDays`), or one naming
 *   no column of the aggregated row — {@link unresolvedFieldReferenceError};
 * - [#20127] a reference whose `addDays` pairs columns the offset has no
 *   meaning on — not two temporal columns of one class, or an offset column
 *   that is not numeric — judged against `classes` when the caller passes it
 *   ({@link offsetPairError});
 * - [#20123] and, once the whole clause has passed those, a KEY naming no
 *   column of the aggregated row, at any depth —
 *   {@link unknownHavingColumnError}. Last on purpose: a condition on a column
 *   the row does not carry is still read for its operator first (the #20099
 *   rule above), so the refusal an author meets for `{ nope: { $median: 1 } }`
 *   is the operator's, and fixing it does not reveal a second one they could
 *   have been told about already.
 *
 * Read-only; `having` is assumed to have passed
 * {@link assertHavingIsFilterCondition}.
 */
export function assertHavingIsEvaluable(
  having: unknown,
  columns: readonly string[],
  classes?: ReadonlyMap<string, AggregatedColumnClass | undefined>,
): void {
  const unknownKeys: Array<{ key: string; path: string }> = [];
  assertNodeIsEvaluable(having, 'having', { clause: HAVING_CLAUSE, columns, classes, unknownKeys });
  if (unknownKeys.length > 0) throw unknownHavingColumnError(unknownKeys, columns);
}

/**
 * [#20122] Judge one `aggregations[i].filter` ONCE, independent of the rows —
 * the same walk {@link assertHavingIsEvaluable} takes, in the words the
 * per-row walk ({@link matchesAggregationFilter}) uses for that position.
 *
 * The per-aggregation filter is evaluated by the in-memory fallback, per SOURCE
 * row of each bucket, so every refusal the walker raises used to depend on the
 * rows: an empty table never reached it (`200 []`, or `[{ n: 0 }]` without a
 * `groupBy`), a `$or` whose first branch held never reached its second (the
 * UNFILTERED count), and a column the row does not carry left the walk at the
 * no-value exit before the operator was read (a count of zero). The same
 * filter was a 400 on a populated table.
 *
 * `ObjectQL.aggregate` calls this in its per-aggregation loop, after the
 * shared doors `where` also takes there and the comparand-TYPE door, and
 * before `getDriver`, the middleware chain and the fallback that evaluates the
 * filter. The walk refuses exactly {@link assertHavingIsEvaluable}'s list
 * minus the name checks: the filter reads the object's RAW columns, not the
 * aggregated row's, so a KEY is not judged here (the REST door refuses an
 * unknown one, as it does in `where`) and a `{ $field }` is judged by the walk
 * for its position and its declaration only.
 *
 * [#20148] Its NAME, and an `addDays` pair's classes, are judged after the
 * walk when the caller hands over the object's declaration — the two
 * cross-field rules `where` gets from `driver-sql`'s compiler, against the
 * object's DECLARED fields: a `{ $field }` (and an `addDays` offset's nested
 * `{ $field }`) names a field the object declares, and an `addDays` pair
 * follows the class rule `FieldReferenceSchema.addDays` declares
 * ({@link offsetPairViolation}). Measured on the base through
 * `engine.aggregate` and `POST /data/:object/query`, on driver-memory and
 * driver-sql, each such filter counted no row (every row under `$ne`, a
 * `$not`, or a `$or` branch that held), while the same comparison in `where`
 * is refused on driver-sql. After the walk on purpose — the order `having`'s
 * key check takes (#20123): an author meets an operator's refusal first, and
 * fixing it does not reveal one they could have been told about already.
 * {@link assertAggregationFilterReferencesAreDeclared} carries the words.
 *
 * [#21007] …and, last, the column-type rule `where` applies on every SQL
 * dialect: a scalar comparison — the equality and ordering family, `$between`,
 * `$in` / `$nin`, implicit equality — aimed at a field the object declares
 * JSON-stored is refused, in `where`'s words, with the field and the operator
 * withheld from the message and handed to the host's log, as `where` does.
 * {@link assertAggregationFilterSparesJsonStoredFields} carries it. Judged here,
 * on the FILTER, because the per-row walk never meets an empty table or a
 * short-circuited `$or` branch: a refusal raised there would be the data's
 * (#20122's rule).
 *
 * Read-only.
 */
export function assertAggregationFilterIsEvaluable(
  filter: unknown,
  index: number,
  declared?: AggregationFilterDeclaration,
): void {
  const clause = aggregationFilterClause(index);
  assertNodeIsEvaluable(filter, clause.root, { clause });
  if (declared) {
    assertAggregationFilterReferencesAreDeclared(filter, clause.root, declared);
    assertAggregationFilterSparesJsonStoredFields(filter, clause.root, declared);
  }
}

/**
 * [#21007] Refuse a scalar comparison aimed at a field the object declares
 * JSON-stored ({@link declaredJsonStoredFields}: a structured-JSON type, or a
 * multi-valued field) — every operator `@objectstack/core`'s
 * `JSON_COLUMN_INCOMPATIBLE_OPERATORS` names, and implicit equality, whatever
 * the comparand (`null` and an empty list included, as `where` refuses them).
 *
 * The per-aggregation `filter` gave the three wrong answers `driver-sql`'s
 * `where` refused (#7398): the stored array never equals a scalar, so `$in` /
 * `$eq` counted nothing, `$nin` / `$ne` counted the rows they were asked to
 * exclude, and the orderings compared an array by JS coercion. Measured through
 * `POST /data/:object/query` on SQLite and PostgreSQL 16, beside the 400 the same
 * `where` answers on both. So one filter got a 400 in `where` and a wrong count
 * here; now it gets the 400 in both, in the same words.
 *
 * The WORDS are `where`'s — `jsonColumnOperatorRefusalText`, the text `driver-sql`
 * refuses with — and so is the disclosure: the message names neither the field
 * nor the operator, and the full diagnostic (both named, plus this position) goes
 * to `declared.reportWithheld`, the host's server log, as
 * {@link assertAggregationFilterReferencesAreDeclared} does for the cross-field
 * refusal. What answers on such a field is unchanged: `$contains` /
 * `$notContains` (membership), `$exists`, `$null` and `$empty`.
 *
 * The same traversal {@link assertAggregationFilterReferencesAreDeclared} takes,
 * after it: the walk has already refused every unknown `$` key, so the arms
 * here meet only declared operators. A plain object with no `$` key is not a
 * condition this rule reads; the engine's no-operator-object door refuses it
 * earlier. No usable field map (a registry-less host) ⇒ nothing is judged.
 *
 * THIS is the complete door. The per-row arm in {@link checkCondition} is a
 * backstop that fires only on a row that reaches it, and many never do: an
 * empty table has no row, and the spec's filter lowering (rule 3) rewrites a
 * negation into `$or: [{ f: { $null: true } }, { f: { $ne: v } }]` (and gives a
 * `$not` operand an `{ f: { $null: false } }` conjunct), so on a row with no
 * value the `$null` arm decides and the walker never reaches the comparison.
 * Measured with this call removed: a `json` field null in every row answered
 * `$ne` / `$nin` / `$not $in` with every row counted. Hence [#21007]'s second
 * caller, `applyInMemoryAggregation`, which a host may call with a field map
 * and no engine in front of it — it calls this same function, once per
 * aggregation, before any row is judged.
 *
 * `declared` needs only the field map and where the diagnostic goes; the
 * object's name is the reference rule's, not this one's.
 */
export function assertAggregationFilterSparesJsonStoredFields(
  filter: unknown,
  root: string,
  declared: Pick<AggregationFilterDeclaration, 'fields' | 'reportWithheld'>,
): void {
  const jsonStored = declaredJsonStoredFields(declared.fields);
  if (jsonStored.size === 0) return;
  const refuse = (field: string, op: string, bare: boolean, path: string): never => {
    const { message, diagnostic } = jsonColumnOperatorRefusalText(field, op, bare);
    declared.reportWithheld(`At ${path}: ${diagnostic}`);
    throw invalidFilterError(message);
  };
  const walk = (cond: unknown, path: string): void => {
    if (!cond || typeof cond !== 'object') return;
    for (const [key, value] of Object.entries(cond)) {
      const here = `${path}.${key}`;
      if (key === '$and' || key === '$or') {
        const branches = Array.isArray(value) ? value : [value];
        branches.forEach((c, i) => walk(c, `${here}[${i}]`));
        continue;
      }
      if (key === '$not') {
        walk(value, here);
        continue;
      }
      if (key.startsWith('$') || !jsonStored.has(key)) continue;
      if (isImplicitEquality(value)) refuse(key, '=', true, here);
      for (const op of Object.keys(value as Record<string, unknown>)) {
        if (JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op)) refuse(key, op, false, `${here}.${op}`);
      }
    }
  };
  walk(filter, root);
}

/**
 * [#21007] A column condition that is IMPLICIT equality — a comparand rather
 * than an operator map: a primitive, `null`, a `Date` or an array. The same
 * split {@link checkCondition} makes before it compares.
 */
function isImplicitEquality(condition: unknown): boolean {
  return typeof condition !== 'object'
    || condition === null
    || condition instanceof Date
    || Array.isArray(condition);
}

/**
 * [#20148] What the per-aggregation `filter`'s reference rules judge against:
 * the object's declared field map, the object's name for the server-side
 * diagnostic, and where that diagnostic goes.
 */
export interface AggregationFilterDeclaration {
  /** The object the filter reads — named in the server-side diagnostic only. */
  object: string;
  /**
   * The object's declared field map. Not a usable map (absent, an array,
   * empty) ⇒ nothing is judged: a registry-less host must not invent a verdict
   * about a declaration it cannot see, the direction every declared-type door
   * of the engine takes.
   */
  fields: unknown;
  /**
   * Handed the full diagnostic — the half the refusal withholds — just before
   * the refusal is thrown, so the host puts it in its server log.
   */
  reportWithheld: (diagnostic: string) => void;
}

/**
 * [#20148] The names a per-aggregation reference may take: every declared
 * field, plus the columns every row carries whether or not the map lists them
 * — the set the REST door's unknown-field gate reads (`resolveQueryFields`).
 */
function declaredReferenceNames(fields: Record<string, unknown>): ReadonlySet<string> {
  return new Set([...Object.keys(fields), 'id', 'created_at', 'updated_at']);
}

/**
 * [#20148] A `{ $field }` in a per-aggregation filter that `where`'s
 * cross-field rules refuse — a referent the object does not declare, or an
 * `addDays` pair the offset has no meaning on.
 *
 * The WORDS follow `where`'s. `driver-sql` refuses the same comparison in a
 * `where` with the fields, the operator and the specific reason withheld from
 * the message and written to the server log — its disclosure posture for every
 * cross-field refusal — so this refusal withholds exactly those and hands the
 * diagnostic to the host's log instead. What stays is the refusal's identity
 * (`INVALID_FILTER` / 400), WHICH aggregation carries the reference (a position
 * in the query, not in the predicate), and the capability boundary — none of
 * them derived from what the filter names.
 */
function withheldAggregationReferenceError(root: string): Error {
  // Under the REST envelope's 500-character bound (`truncateClientMessage`), so
  // the sentence saying where the withheld half went is never the part cut off.
  return invalidFilterError(
    `A { "$field" } reference in \`${root}\` cannot be evaluated. It must name a field the object `
    + `declares, and an addDays offset applies only between two date or two datetime fields, read from `
    + `an integer or a numeric field; evaluated anyway, its count would be silently wrong. The fields, the `
    + `operator and the reason are withheld from the message, as for the same comparison in a `
    + `\`where\`; the full diagnostic is in the server log.`,
  );
}

/**
 * [#20148] Judge every scalar-comparison `{ $field }` reference in one
 * per-aggregation filter against the object's declaration — the same
 * traversal {@link assertNodeIsEvaluable} takes, which has already run: `$and`
 * / `$or` / `$not` are descended, every other `$` key has been refused there,
 * and a reference is judged only as the whole comparand of the six scalar
 * comparisons, the one position that walk lets it stand.
 *
 * In `driver-sql`'s order: the referent is declared, an offset column is
 * declared, then the `addDays` pair rule. A filter KEY the object does not
 * declare (or a formula) has no class here, so the same-class half of the pair
 * rule does not judge it.
 */
function assertAggregationFilterReferencesAreDeclared(
  filter: unknown,
  root: string,
  declared: AggregationFilterDeclaration,
): void {
  const { fields } = declared;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
  const map = fields as Record<string, unknown>;
  if (Object.keys(map).length === 0) return;
  const names = declaredReferenceNames(map);
  const classes = new Map<string, AggregatedColumnClass | undefined>(
    [...names].map((name) => [name, declaredFieldClass(map, name)]),
  );
  const refuse = (field: string, op: string, path: string, ref: string, reason: string): never => {
    declared.reportWithheld(
      `Operator "${op}" on field "${field}" at ${path} compares against another field `
      + `({ "$field": "${ref}" }), which cannot be evaluated here: ${reason}`,
    );
    throw withheldAggregationReferenceError(root);
  };
  const walk = (cond: unknown, path: string): void => {
    if (!cond || typeof cond !== 'object') return;
    for (const [key, value] of Object.entries(cond)) {
      const here = `${path}.${key}`;
      if (key === '$and' || key === '$or') {
        const branches = Array.isArray(value) ? value : [value];
        branches.forEach((c, i) => walk(c, `${here}[${i}]`));
        continue;
      }
      if (key === '$not') {
        walk(value, here);
        continue;
      }
      if (key.startsWith('$')) continue;
      if (typeof value !== 'object' || value === null || value instanceof Date || Array.isArray(value)) continue;
      for (const [op, target] of Object.entries(value)) {
        if (!REFERENCE_COMPARISON_OPERATORS.has(op) || !isFieldReferenceShape(target)) continue;
        const at = `${here}.${op}`;
        const ref = String(target.$field);
        if (!names.has(ref)) {
          refuse(key, op, at, ref,
            `"${ref}" is not a declared field of "${declared.object}" — only declared fields can be referenced.`);
        }
        const offset = target.addDays;
        if (isFieldReferenceShape(offset) && !names.has(String(offset.$field))) {
          refuse(key, op, at, ref,
            `the addDays offset "${String(offset.$field)}" is not a declared field of "${declared.object}" — `
            + `only declared fields can be referenced.`);
        }
        if (offset !== undefined) {
          const reason = offsetPairViolation(key, target, classes);
          if (reason !== undefined) refuse(key, op, at, ref, reason);
        }
      }
    }
  };
  walk(filter, root);
}

/**
 * [#20122] What one row-independent walk judges against: the clause whose
 * words its refusals use, and — where the position has a closed namespace —
 * the column set a key and a `{ $field }` reference must name.
 */
interface EvaluableScope {
  clause: FilterClause;
  /**
   * The names a key and a `{ $field }` reference may take. `undefined` when
   * the position has no closed column set to judge a name against (the
   * per-aggregation filter reads the object's raw columns).
   */
  columns?: readonly string[];
  /**
   * [#20127] Each column's class, where the query and the declaration tell
   * it — what an `addDays` pair is judged against. `undefined` = not judged.
   */
  classes?: ReadonlyMap<string, AggregatedColumnClass | undefined>;
  /** [#20123] Keys naming none of `columns`, collected in walk order. */
  unknownKeys?: Array<{ key: string; path: string }>;
}

/** One node: the `$and` / `$or` / `$not` walk {@link matchesHaving} takes. */
function assertNodeIsEvaluable(cond: unknown, path: string, scope: EvaluableScope): void {
  if (!cond || typeof cond !== 'object') return;
  for (const [key, value] of Object.entries(cond)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      const branches = Array.isArray(value) ? value : [value];
      branches.forEach((c, i) => assertNodeIsEvaluable(c, `${here}[${i}]`, scope));
      continue;
    }
    if (key === '$not') {
      assertNodeIsEvaluable(value, here, scope);
      continue;
    }
    if (key.startsWith('$')) throw unknownOperator(key, 'logical', [], scope.clause);
    assertConditionIsEvaluable(value, key, here, scope);
    // [#20123] Rows carry exactly the columns the query projects, so a key
    // outside them can only ever read "no value" — see unknownHavingColumnError.
    if (scope.columns && !scope.columns.includes(key)) scope.unknownKeys?.push({ key, path: here });
  }
}

/** One column's condition: the arms {@link checkCondition} would refuse. */
function assertConditionIsEvaluable(
  condition: unknown,
  field: string,
  path: string,
  scope: EvaluableScope,
): void {
  // Implicit equality with a literal: nothing to refuse here. An array in this
  // slot is the shared comparand-shape face's, and it has already run.
  if (
    typeof condition !== 'object'
    || condition === null
    || condition instanceof Date
    || Array.isArray(condition)
  ) return;
  const spec = condition as Record<string, unknown>;
  const keys = Object.keys(spec);
  if (!keys.some((k) => k.startsWith('$'))) return;
  for (const op of keys) {
    const target = spec[op];
    if (op === '$field') throw bareFieldReferenceError(field, spec, path);
    if (op === '$icontains' && (typeof target !== 'string' || target === '')) {
      throw icontainsComparandError(field, target, `${path}.${op}`);
    }
    // [#20444] Before the vocabulary check for the same reason as the gate
    // above: the flag is a known operator, and its only malformation is a
    // comparand that is not a boolean.
    if (op === '$empty' && typeof target !== 'boolean') {
      throw emptyFlagComparandError(field, target, `${path}.${op}`);
    }
    // [#20981] …and its two siblings, by the same declaration and for the same
    // reason. Before the reference-position check below as well, as `$empty`'s
    // gate is: a `{ $field }` in a flag's slot is a non-boolean first.
    if ((op === '$exists' || op === '$null') && typeof target !== 'boolean') {
      throw nonBooleanFlagComparandError(op, field, target, `${path}.${op}`);
    }
    if (!(CONDITION_OPERATORS as readonly string[]).includes(op)) {
      throw unknownOperator(op, 'condition', keys, scope.clause);
    }
    if (REFERENCE_COMPARISON_OPERATORS.has(op)) {
      if (isFieldReferenceShape(target)) {
        assertReferenceResolves(target, `${path}.${op}`, scope.columns);
        if (scope.classes && target.addDays !== undefined) {
          assertOffsetPairIsTemporal(field, op, target, `${path}.${op}`, scope.classes);
        }
      }
      continue;
    }
    if (Array.isArray(target)) {
      const index = target.findIndex(isFieldReferenceShape);
      if (index !== -1) throw fieldReferencePositionError(field, op, `${path}.${op}`, index);
    } else if (isFieldReferenceShape(target)) {
      throw fieldReferencePositionError(field, op, `${path}.${op}`);
    }
  }
}

/**
 * [#20099] A reference in a scalar comparison: well-formed by its own
 * declaration, and naming columns the aggregated row has — the `$field`, and an
 * `addDays` offset's nested `$field` when it carries one.
 *
 * [#20122] `columns` is absent for a position with no closed column set (the
 * per-aggregation filter); there only the declaration is judged.
 */
function assertReferenceResolves(
  reference: Record<string, unknown>,
  path: string,
  columns: readonly string[] | undefined,
): void {
  const parsed = FieldReferenceSchema.safeParse(reference);
  if (!parsed.success) {
    throw malformedFieldReferenceError(path, parsed.error.issues[0]?.message ?? 'it does not parse');
  }
  if (!columns) return;
  const names = [reference.$field];
  if (isFieldReferenceShape(reference.addDays)) names.push(reference.addDays.$field);
  for (const name of names) {
    if (!columns.includes(String(name))) throw unresolvedFieldReferenceError(String(name), path, columns);
  }
}

/**
 * [#20099] Evaluate `value <op> { $field }` on one row, with the reference
 * resolved against that row.
 *
 * The comparison is `@objectstack/formula`'s `matchesFilterCondition`, not a
 * third copy of it. That evaluator is the cross-field semantics the SQL family
 * compiles to row for row (NULL-total: an ordering against a missing value is
 * false, `$eq` against one is "both have none"), and it owns the whole-day
 * `addDays` arithmetic. It is handed a three-column PROBE rather than the row:
 * a row here is flat — aggregation aliases and groupBy projections, read by
 * direct key like every other column in this walker — while that evaluator
 * walks dotted paths, so re-keying keeps a column name from ever being read as
 * a path.
 */
function compareWithReference(
  row: Record<string, any>,
  value: unknown,
  op: string,
  reference: Record<string, unknown>,
): boolean {
  const probe: Record<string, unknown> = { value, referent: row?.[String(reference.$field)] };
  const resolved: Record<string, unknown> = { $field: 'referent' };
  const offset = reference.addDays;
  if (isFieldReferenceShape(offset)) {
    probe.offset = row?.[String(offset.$field)];
    resolved.addDays = { $field: 'offset' };
  } else if (offset !== undefined) {
    resolved.addDays = offset;
  }
  return matchesFilterCondition(probe, { value: { [op]: resolved } } as FilterCondition);
}

/**
 * Filter aggregated rows by the query's `having` condition. An absent or empty
 * condition returns the rows unchanged (same vacuous-filter convention as
 * `where`).
 *
 * [#20176] `classes` is each aggregated column's class
 * ({@link aggregatedRowColumnClasses}): a temporal column's comparands are
 * compared by its storage rule. Absent ⇒ every comparand as written.
 */
export function applyHaving(
  rows: any[],
  having: FilterCondition | null | undefined,
  classes?: ReadonlyMap<string, AggregatedColumnClass | undefined>,
): any[] {
  if (!having || typeof having !== 'object' || Object.keys(having).length === 0) return rows;
  return rows.filter((row) => matchesHaving(row, having, 'having', HAVING_CLAUSE, classes));
}

/**
 * Evaluate one aggregated row against a HAVING FilterCondition.
 *
 * [#7158] `path` is the position of `cond` inside the clause the caller wrote —
 * `having`, `having.$and[0]`, `having.$not` — carried down so a comparand
 * refusal can NAME where the offending key sits. It defaults, so this stays the
 * two-argument function every existing caller (and `applyHaving` below) uses.
 *
 * [#20176] `classes` maps a column to its class — the aggregated row's for
 * `having`, the object's declared fields for a per-aggregation `filter` — and a
 * column whose class is temporal has its comparands compared by that column's
 * storage rule ({@link checkCondition}). Absent, or a column it does not name ⇒
 * compared as written.
 *
 * [#20873] `jsonStored` names the columns declared JSON-stored
 * ({@link declaredJsonStoredFields}), on which `$contains` / `$notContains` ask
 * MEMBERSHIP. Only the per-aggregation `filter` passes it. `applyHaving` does
 * not: an aggregated row has no declaration of its own for a set to be read
 * from, a `groupBy` on a multi-valued or structured-JSON field is refused before
 * any row exists, and the one aggregated column that can still carry a stored
 * array — a `min` / `max` over a multi-valued field — is itself answered three
 * ways by the backends (an array on the in-memory aggregation, the serialized
 * TEXT on SQLite's native aggregate, a `DATABASE_ERROR` on PostgreSQL), so
 * there is no single `where` answer to hold `having` to there.
 */
export function matchesHaving(
  row: Record<string, any>,
  cond: any,
  path = 'having',
  clause: FilterClause = HAVING_CLAUSE,
  classes?: ReadonlyMap<string, AggregatedColumnClass | undefined>,
  jsonStored?: ReadonlySet<string>,
): boolean {
  if (!cond || typeof cond !== 'object') return true;
  for (const [key, value] of Object.entries(cond)) {
    const here = `${path}.${key}`;
    if (key === '$and') {
      const branches = Array.isArray(value) ? value : [value];
      if (!branches.every((c, i) => matchesHaving(row, c, `${here}[${i}]`, clause, classes, jsonStored))) return false;
      continue;
    }
    if (key === '$or') {
      const branches = Array.isArray(value) ? value : [value];
      if (!branches.some((c, i) => matchesHaving(row, c, `${here}[${i}]`, clause, classes, jsonStored))) return false;
      continue;
    }
    if (key === '$not') {
      if (matchesHaving(row, value, here, clause, classes, jsonStored)) return false;
      continue;
    }
    if (key.startsWith('$')) throw unknownOperator(key, 'logical', [], clause);
    // Aggregated rows are flat (aliases + group projections) — direct access,
    // no dotted-path resolution. [#10576] The per-aggregation filter walks the
    // same way on purpose: it reads `driver.find()` rows, which are flat too.
    // [#20099] The row itself goes down too: a `{ $field }` comparand resolves
    // against it. [#20176] …and the column's storage rule, when it has one.
    // [#20873] …and whether the column is declared JSON-stored, which decides
    // the question `$contains` / `$notContains` ask of it.
    if (!checkCondition(
      row?.[key], value, key, here, clause, row, temporalKindOf(classes?.get(key)), jsonStored?.has(key) === true,
    )) return false;
  }
  return true;
}

/**
 * [#10576] Evaluate one raw source row against one `aggregations[i].filter`
 * predicate — the per-aggregation filter of `AggregationNodeSchema` (the
 * contract half of #10413's ruling), applied by the in-memory aggregation
 * fallback before the aggregation function reads the row.
 *
 * The SAME walker as `matchesHaving`, deliberately: the two positions share
 * one operator vocabulary, one ADR-0112 refusal envelope, and the #5298
 * null-safe negation semantics — a predicate moved between a driver `where`,
 * a `having`, and a per-aggregation `filter` must select rows by one rule.
 * Only the refusal WORDING differs (see {@link aggregationFilterClause}): an
 * unknown operator here is refused naming the aggregation position it sits in,
 * because ignoring it would silently answer the UNFILTERED aggregate — the
 * precise #10413 defect this key exists to close.
 *
 * [#20176] `classes` is the object's declared field classes
 * ({@link declaredFieldClasses}), so a temporal comparand here is read by the
 * column's storage rule, as the same comparand in a `where` is by the driver.
 *
 * [#20873] `jsonStored` is the object's declared JSON-stored fields
 * ({@link declaredJsonStoredFields}), so `$contains` / `$notContains` on one of
 * them ask MEMBERSHIP, as the same condition in a `where` does on every SQL
 * dialect. Absent ⇒ every column keeps the substring reading.
 */
export function matchesAggregationFilter(
  row: Record<string, any>,
  filter: FilterCondition,
  index: number,
  classes?: ReadonlyMap<string, AggregatedColumnClass | undefined>,
  jsonStored?: ReadonlySet<string>,
): boolean {
  const clause = aggregationFilterClause(index);
  return matchesHaving(row, filter, clause.root, clause, classes, jsonStored);
}

/**
 * [#20148] The two operands as UTC instants — when one of them is a `Date` and
 * both denote an instant — else `null`, and the comparison runs exactly as it
 * always did.
 *
 * A `Date` bound met the stored text of a datetime column (canonical UTC ISO on
 * every driver, ADR-0053 D-B) and JS compared the two by coercion: `<` and
 * friends read the `Date` as its epoch and the ISO string as `NaN`, and `==`
 * read the `Date` as its `toString()`. So
 * `{ opened_at: { $gt: new Date('2026-02-01') } }` counted NO row in a
 * per-aggregation `filter` (and kept no group in `having`), `$ne` / `$nin`
 * counted every row, and a `$between` of two `Date`s kept every row — while the
 * same bound in a `where` answered 4 of 6 on driver-memory and driver-sql
 * alike, each driver reading it by the column's storage rule. Where this walker
 * is TYPE-BLIND — [#20176] a column whose class it is not handed, or whose class
 * is not temporal; a temporal column's pair is put in its storage form first
 * ({@link checkCondition}), and no `Date` is left in it — it reads the pair the
 * way the spec defines for a type-blind evaluator — {@link utcInstantMs}, the
 * lift `@objectstack/formula`'s evaluator applies to the same pairing: a
 * `Date`, epoch milliseconds, a bare `YYYY-MM-DD` (its UTC midnight) or an
 * ISO / zone-naive timestamp. Anything else — a wall-clock `time` value, junk,
 * an Invalid Date — is not an instant, and the pair is left to the comparison
 * below, unchanged.
 */
function instantsOf(value: unknown, target: unknown): readonly [number, number] | null {
  if (!(value instanceof Date) && !(target instanceof Date)) return null;
  const a = utcInstantMs(value);
  const b = utcInstantMs(target);
  return a === null || b === null ? null : [a, b];
}

/** [#20148] Equality: the instants when a `Date` is in the pair, else the walker's loose `==`. */
function comparandEquals(value: unknown, target: unknown): boolean {
  const instants = instantsOf(value, target);
  return instants ? instants[0] === instants[1] : value == target;
}

/** [#20148] An ordering: the instants when a `Date` is in the pair, else the operands as they are. */
function ordered(value: unknown, target: unknown, compare: (a: any, b: any) => boolean): boolean {
  const instants = instantsOf(value, target);
  return instants ? compare(instants[0], instants[1]) : compare(value, target);
}

/** [#20148] List membership: `includes` as before, or a `Date` member naming the same instant. */
function listHolds(list: readonly unknown[], value: unknown): boolean {
  return list.includes(value) || list.some((member) => {
    const instants = instantsOf(value, member);
    return instants !== null && instants[0] === instants[1];
  });
}

/**
 * [#20873] The JSON NUMBER grammar, spelled out — the pattern `driver-sql`'s
 * `jsonMembershipCandidates` tests a `$contains` comparand against, for its
 * reason: `Number()` also accepts `'0x10'`, `' 1 '`, `'Infinity'` and `''`, none
 * of which is a JSON number, and admitting them would make the member set
 * depend on JS coercion rules no SQL dialect shares.
 */
const JSON_NUMBER_TEXT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/**
 * [#20873] Is the `$contains` comparand a MEMBER of the stored array — the
 * question `$contains` asks of a declared JSON-stored column
 * ({@link declaredJsonStoredFields}).
 *
 * The comparand is a STRING by contract (`FILTER_OPERATORS`' `$contains`
 * docblock), so a member stored as a JSON number or boolean is named by its
 * TEXT: `'1'` names the string `'1'` or the number `1`, `'true'` the string or
 * `true`, `'null'` the string or `null`, and `'1.50'` the number `1.5`. That is
 * the candidate set `driver-sql`'s `jsonMembershipCandidates` binds for every
 * dialect — `String(comparand)`, plus the canonical number when the text is a
 * JSON number, plus the literal for `true` / `false` / `null` — read here as a
 * predicate over JS values instead of as JSON text.
 *
 * Array-only, as the SQL constructs are: a value that is not an array (a
 * scalar, an object, `null`) has no member, and neither does an element that
 * is itself an object or an array.
 *
 * ⚠️ A second copy of one rule, not the shared one: `driver-sql`'s
 * `jsonMembershipCandidates` is module-private, and `driver-memory`'s twin is
 * module-private too, so neither is importable here. The one shared home would
 * be `@objectstack/spec/data`, beside `asciiCaseInsensitiveContains` and
 * `isEmptyFilterValue` — the value-level filter rules every JS face already
 * reads from there.
 */
function storedArrayHasMember(value: unknown, comparand: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const text = String(comparand);
  const number = JSON_NUMBER_TEXT.test(text) ? Number(text) : Number.NaN;
  return value.some((element) => {
    if (typeof element === 'string') return element === text;
    if (typeof element === 'number') return Number.isFinite(number) && element === number;
    if (typeof element === 'boolean' || element === null) return String(element) === text;
    return false;
  });
}

/**
 * One column's condition — implicit equality or an operator object.
 *
 * [#20176] `kind` is the column's temporal storage rule, when the caller knows
 * its class and the class is `date`, `datetime` or `time`. Then the row's value
 * AND every comparand of `$eq` / `$ne` / the four orderings / `$between` /
 * `$in` / `$nin` / implicit equality are put in that rule's storage form
 * (`temporalStorageForm`) before they are compared — the reading the drivers
 * give the same comparand in a `where`. So `'2026-02-01T00:00:00.000Z'` against
 * a `date` column is the day `'2026-02-01'`, epoch milliseconds are an instant,
 * and a `Date` against a `date` or `time` column is its UTC day or time of day.
 * A bare-day `$lte` on a `datetime` column reaches this function already lowered
 * to the next day's `$lt` by the engine's seam (ADR-0053 D-D1 item 5, as
 * amended); this function applies no whole-day rule of its own. The value
 * takes the form too because that is the pairing the drivers compare
 * (`driver-sql` wraps a legacy SQLite column in the same canon); rows a driver
 * returns are in it already.
 * Presence (`$exists`, `$null`), the text operators and a `{ $field }`
 * reference are not comparands of a value, and are read as before.
 *
 * [#20873] `jsonStored` is whether the column is declared JSON-stored. Then
 * `$contains` asks whether its comparand is a MEMBER of the stored array
 * ({@link storedArrayHasMember}) and `$notContains` its exact complement; on
 * any other column both keep the substring test.
 *
 * [#21007] …and a scalar comparison on such a column — implicit equality, or an
 * operator in `JSON_COLUMN_INCOMPATIBLE_OPERATORS` — is REFUSED, in `where`'s
 * withheld words. The COMPLETE door is
 * {@link assertAggregationFilterSparesJsonStoredFields}, which judges the filter
 * once, before any row is read, and reports the diagnostic; `engine.aggregate`
 * and `applyInMemoryAggregation` both call it. This arm is only the BACKSTOP
 * for a row that reaches it — a caller evaluating rows directly through
 * `matchesAggregationFilter`. It sits above the no-value exit, so a row with no
 * value that reaches it is refused too; but its REACH is the row's: an empty
 * row set never gets here, and neither does a row on which a short-circuited
 * `$or` / `$and` branch has already decided (the spec lowering's rule 3 puts a
 * `$null` arm ahead of every negation).
 */
function checkCondition(
  value: any,
  condition: any,
  field: string,
  path: string,
  clause: FilterClause = HAVING_CLAUSE,
  row: Record<string, any> = {},
  kind?: TemporalComparandKind,
  jsonStored = false,
): boolean {
  const form = (operand: unknown): unknown => (kind === undefined ? operand : temporalStorageForm(operand, kind));
  // Implicit equality (primitives, null, Date, array exact-match) — loose `==`
  // to mirror the Filter Protocol's memory evaluation. [#20148] A `Date` bound
  // is compared as an instant ({@link instantsOf}). [#20176] On a temporal
  // column, both sides in the column's storage form first.
  if (isImplicitEquality(condition)) {
    // [#21007] Not on a declared JSON-stored column: a stored array never equals
    // a scalar, and `where` refuses the spelling there.
    if (jsonStored) throw invalidFilterError(jsonColumnOperatorRefusalText(field, '=', true).message);
    return comparandEquals(form(value), form(condition));
  }

  const keys = Object.keys(condition);
  const isOperatorObject = keys.some((k) => k.startsWith('$'));
  if (!isOperatorObject) {
    // Plain-object implicit equality — structural compare, as the matcher does.
    return JSON.stringify(value) === JSON.stringify(condition);
  }

  for (const op of keys) {
    // [#5702] The `if (op === '$options') continue` that stood here is GONE. It
    // skipped the key because `$regex` consumed it as its flags; with `$regex`
    // retired, `$options` is a key nothing consumes, and skipping it would mean
    // silently ignoring a constraint the author wrote — the exact widening this
    // file refuses unknown operators to avoid. It now falls to `default:` and is
    // refused with the spec's prescription.
    const target = (condition as Record<string, any>)[op];
    // [#7158] The comparand-shape gate, ABOVE the no-value exit on purpose. The
    // shape of a comparand is a property of the FILTER, not of the row being
    // judged: below the exit, `{ missing_column: { $icontains: '' } }` would be
    // answered `false` for every row that lacks the column and refused only for
    // the rows that carry it — one filter, two verdicts, decided by the data.
    // See {@link icontainsComparandError}.
    if (op === '$icontains' && (typeof target !== 'string' || target === '')) {
      throw icontainsComparandError(field, target, `${path}.${op}`);
    }
    // [#20444] The flag's shape is the filter's, not the row's — above the
    // no-value exit for the #7158 reason the gate above gives.
    if (op === '$empty' && typeof target !== 'boolean') {
      throw emptyFlagComparandError(field, target, `${path}.${op}`);
    }
    // [#20981] …and `$exists` / `$null` beside it: the floor under the one-time
    // judgment (assertConditionIsEvaluable), for a caller evaluating rows
    // directly. Above the no-value exit for the same reason.
    if ((op === '$exists' || op === '$null') && typeof target !== 'boolean') {
      throw nonBooleanFlagComparandError(op, field, target, `${path}.${op}`);
    }
    // [#21007] A scalar comparison on a declared JSON-stored column — refused,
    // as `where` refuses it. The backstop under the one-time judgment
    // (assertAggregationFilterSparesJsonStoredFields), for a row that gets here.
    if (jsonStored && JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op)) {
      throw invalidFilterError(jsonColumnOperatorRefusalText(field, op, false).message);
    }
    if (value === undefined && !NO_VALUE_ANSWERED_BY_OPERATOR.has(op)) return false;
    // [#20099] A `{ $field }` reference as the whole comparand of a scalar
    // comparison is RESOLVED against this row. The arms below would compare the
    // reference OBJECT itself — `500 > { $field: 'cap' }` is false, and `$ne`
    // against it is true for every row — so the declared form answered
    // nothing, or everything, silently.
    if (REFERENCE_COMPARISON_OPERATORS.has(op) && isFieldReferenceShape(target)) {
      if (!compareWithReference(row, value, op, target)) return false;
      continue;
    }
    // [#20148] The comparison and list arms read a `Date` bound — or a `Date`
    // value — as an instant ({@link instantsOf}); every other pair compares
    // exactly as before. [#20176] On a temporal column both sides are in its
    // storage form first (`form`).
    const stored = form(value);
    switch (op) {
      case '$eq': if (!comparandEquals(stored, form(target))) return false; break;
      case '$ne': if (comparandEquals(stored, form(target))) return false; break;
      case '$gt': if (!ordered(stored, form(target), (a, b) => a > b)) return false; break;
      case '$gte': if (!ordered(stored, form(target), (a, b) => a >= b)) return false; break;
      case '$lt': if (!ordered(stored, form(target), (a, b) => a < b)) return false; break;
      // [ADR-0053 D-D1 items 5 and 9, as amended] Both upper bounds compare as
      // written. The whole-day reading of a bare day on a `datetime` column,
      // and the last supported day bounding nothing, are applied once by the
      // engine's seam (`lowerFilterCondition`), which hands this arm a `$lt` the
      // next day (or `$null: false`) and splits a literal `$between` into `$gte`
      // and that bound. A caller evaluating rows without the seam gets the
      // comparison it wrote.
      case '$lte': if (!ordered(stored, form(target), (a, b) => a <= b)) return false; break;
      case '$between': {
        if (!Array.isArray(target)) break;
        if (ordered(stored, form(target[0]), (a, b) => a < b)
          || ordered(stored, form(target[1]), (a, b) => a > b)) return false;
        break;
      }
      case '$in': if (!Array.isArray(target) || !listHolds(target.map(form), stored)) return false; break;
      case '$nin': if (Array.isArray(target) && listHolds(target.map(form), stored)) return false; break;
      // [#20981] Both flags are booleans here — the gate above refused every
      // other comparand — so each arm reads the flag itself. `$exists` read
      // `!!target` (truthiness: `"false"` asked for the valued rows), and `$null`
      // tested `=== true` / `=== false` only, so a third value constrained
      // nothing. `$exists` is "has a value" (#5298), the exact mirror of `$null`.
      case '$exists':
        if ((value !== undefined && value !== null) !== target) return false;
        break;
      case '$null':
        if ((value === undefined || value === null) !== target) return false;
        break;
      // [#20444] The staged emptiness flag, judged BY VALUE — the aggregated
      // row carries no field declaration of its own, so this face takes the
      // reading ruling A on #20399 gives it: null, a missing column, `''` and
      // `[]` are empty (the spec's `isEmptyFilterValue`, not a copy of it), and
      // `false` is the exact complement. So `0` from a `count` / `sum` is NOT
      // empty — a group with no rows to count is a zero, not a missing value —
      // and a groupBy text column holding `''` IS empty, the row a declared
      // text field takes too. The one divergence from a declared-type face is
      // `''` in a non-text column, the write-door class #20308 closed.
      case '$empty':
        if (isEmptyFilterValue(value) !== (target === true)) return false;
        break;
      // [#20873] On a declared JSON-stored column, MEMBERSHIP — the reading
      // `where` gives the same condition on every SQL dialect
      // (`SqlDriver.applyJsonMembership`). The substring test below failed
      // every value that was not a string, so a stored array never matched.
      case '$contains':
        if (jsonStored
          ? !storedArrayHasMember(value, target)
          : typeof value !== 'string' || !value.includes(target)) return false;
        break;
      // [#5905] The mirror of `$contains`, NOT its copy-with-a-negated-test.
      // `$contains` fails a non-string value because "contains" cannot hold for
      // something that is not text; `$notContains` SUCCEEDS for the same value
      // for the same reason — it cannot contain the substring. Reusing the
      // `typeof value !== 'string' ⇒ false` guard here (what this line used to
      // do) made a value-less column fail BOTH an operator and its negation,
      // the two-valued reading #5298 ruled out. This is `formula`'s shape
      // (`matches-filter.ts`: `!(typeof actual === 'string' && …)`).
      //
      // [#14079] What the other faces answer for the NON-STRING half of that
      // sentence is now a contract row, not this file's opinion. This
      // paragraph used to end "which driver-sql's polarity table already
      // follows for the same operator" — true of the NO-VALUE cell only
      // (`nullValueSatisfiesOperator` there answers `$notContains: true` for a
      // NULL column), and measured FALSE of a stored number: the SQLite
      // dialects coerced it to text and searched that, live Postgres refused
      // at query time (SQLSTATE 42883), and `driver-memory`'s reference
      // matcher failed both polarities. The maintainer ruled the cell on
      // 2026-09-05 (option A, type-gate) and `FILTER_TEXT_CASES`' `score` rows
      // pin it on every face: the reference matcher answers the predicate, and
      // the SQL compilers emit a type-gated constant for a column whose
      // declared type is in `NON_TEXT_STORED_VALUE_TYPES`. This arm was already
      // on the ruled side; nothing here moved.
      //
      // [#20873] On a declared JSON-stored column, the exact complement of the
      // membership arm above — what `where` gives on every SQL dialect
      // (`col IS NULL OR NOT (…)`). The substring test SUCCEEDED for every
      // value that was not a string, so a stored array satisfied
      // `$notContains` even when it held the comparand. A row with no value
      // still satisfies it (#5298): `null` and an absent column have no member.
      case '$notContains':
        if (jsonStored
          ? storedArrayHasMember(value, target)
          : typeof value === 'string' && value.includes(target)) return false;
        break;
      case '$startsWith': if (typeof value !== 'string' || !value.startsWith(target)) return false; break;
      case '$endsWith': if (typeof value !== 'string' || !value.endsWith(target)) return false; break;
      // [#6520] `$contains`' case-INSENSITIVE twin, over ASCII case only. Same
      // non-string guard as `$contains` — a value that is not text cannot
      // contain a substring — and the same fold every other JS face uses, from
      // the spec, so an aggregate filtered HERE and the same predicate run as a
      // `where` on any driver select the same rows.
      //
      // [#7158] The `typeof target !== 'string'` limb this arm used to carry is
      // GONE — not relaxed, HOISTED. It was the whole of this face's opinion
      // about a bad comparand, and its opinion was `return false`: "no rows",
      // silently, for a comparand the declared type does not permit. The gate
      // above now refuses that input before the arm is reached, so the limb was
      // dead code that read as a check. What survives here is the guard on the
      // COLUMN VALUE, which is a different judgement and stays: a value that is
      // not text cannot contain a substring, so it does not match — the same
      // answer `$contains` gives, about the row rather than about the filter.
      case '$icontains':
        if (typeof value !== 'string'
          || !asciiCaseInsensitiveContains(value, target)) return false;
        break;
      // [#5702] The `$regex` arm is GONE. It built `new RegExp(target, $options)`
      // and, on an illegal pattern, `return false` — an unrunnable filter
      // answered as "this row does not match", i.e. a silent empty result rather
      // than an error. Retired by #4706; refused by `default:` below.
      default:
        throw unknownOperator(op, 'condition', keys, clause);
    }
  }
  return true;
}
