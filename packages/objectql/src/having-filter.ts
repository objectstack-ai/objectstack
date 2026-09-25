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
// [#7047] The ADR-0112 envelope this face's refusals used to omit. Shared with
// `filter-comparand-shape.ts` rather than re-declared here — see the note on
// {@link invalidFilterError} and on {@link unknownOperator} below.
import { invalidFilterError } from './filter-comparand-shape.js';

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
const CONDITION_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$between',
  '$in', '$nin', '$exists', '$null',
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
] as const;

/**
 * [#20099] The operators whose WHOLE comparand may be a `{ $field }` reference —
 * the six scalar comparisons `FieldReferenceSchema` names, and the only
 * positions the SQL family compiles one in. Every other position (a list
 * member, a text pattern, `$exists` / `$null`) is refused by
 * {@link assertHavingIsEvaluable} rather than compared against the reference
 * OBJECT, which matched nothing.
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
    + `return unfiltered aggregates (#4286, ADR-0078).`,
  );
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
 * `$in` / `$nin` member, a text pattern, an `$exists` / `$null` operand.
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
  const ref = String(reference.$field);
  const refClass = classes.get(ref);
  const targetClass = classes.get(field);
  if (refClass !== undefined && targetClass !== undefined && refClass !== targetClass) {
    throw offsetPairError(field, op, ref, path,
      `"${field}" is ${targetClass} but "${ref}" is ${refClass}, and a cross-class comparison answers `
      + `differently in SQL (storage-class ordering) than in memory (JS coercion) — compare same-class `
      + `columns.`);
  }
  if (refClass !== undefined && refClass !== 'date' && refClass !== 'datetime') {
    throw offsetPairError(field, op, ref, path,
      `addDays adds whole days to a date or datetime column, and "${ref}" is ${refClass} — an offset `
      + `has no meaning on it.`);
  }
  const offset = reference.addDays;
  if (!isFieldReferenceShape(offset)) return;
  const offsetRef = String(offset.$field);
  const offsetClass = classes.get(offsetRef);
  if (offsetClass !== undefined && offsetClass !== 'numeric') {
    throw offsetPairError(field, op, ref, path,
      `the addDays offset "${offsetRef}" (${offsetClass}) is not a numeric column, and a day offset `
      + `must be a number of days.`);
  }
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
 * A declared field's class, by the spec's value-class sets. `undefined` when
 * the declaration cannot tell: no field map (a registry-less host), no such
 * field, or a `formula`, whose type names no stored value class.
 */
function declaredFieldClass(
  fields: Record<string, unknown> | undefined,
  name: unknown,
): AggregatedColumnClass | undefined {
  if (!fields || typeof fields !== 'object' || typeof name !== 'string') return undefined;
  if (!Object.prototype.hasOwnProperty.call(fields, name)) return undefined;
  const type = (fields[name] as { type?: unknown } | undefined)?.type;
  if (typeof type !== 'string' || type === 'formula') return undefined;
  if (CALENDAR_DATE_TYPES.has(type)) return 'date';
  if (INSTANT_TYPES.has(type)) return 'datetime';
  if (CLOCK_TIME_TYPES.has(type)) return 'time';
  if (NUMERIC_VALUE_TYPES.has(type)) return 'numeric';
  if (BOOLEAN_VALUE_TYPES.has(type)) return 'boolean';
  // Everything else is read and compared as text, as `driver-sql` stores it.
  return 'text';
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
 */
export function aggregatedRowColumnClasses(
  groupBy: unknown,
  aggregations: unknown,
  fields: Record<string, unknown> | undefined,
): Map<string, AggregatedColumnClass | undefined> {
  const classes = new Map<string, AggregatedColumnClass | undefined>();
  for (const g of Array.isArray(groupBy) ? groupBy : []) {
    if (typeof g === 'string') {
      classes.set(g, declaredFieldClass(fields, g));
      continue;
    }
    const item = g as { alias?: unknown; field?: unknown; dateGranularity?: unknown } | null;
    const name = item?.alias ?? item?.field;
    if (typeof name !== 'string') continue;
    const granularity = item?.dateGranularity;
    classes.set(name, granularity == null
      ? declaredFieldClass(fields, item?.field)
      : granularity === 'day' ? 'date' : 'text');
  }
  for (const a of Array.isArray(aggregations) ? aggregations : []) {
    const agg = a as { alias?: unknown; function?: unknown; field?: unknown } | null;
    if (typeof agg?.alias !== 'string') continue;
    const fn = String(agg.function);
    classes.set(agg.alias, NUMERIC_RESULT_FUNCTIONS.has(fn)
      ? 'numeric'
      : VALUE_RESULT_FUNCTIONS.has(fn) ? declaredFieldClass(fields, agg.field) : undefined);
  }
  return classes;
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
 * filter. What it refuses is exactly {@link assertHavingIsEvaluable}'s list
 * minus the name check: the filter reads the object's RAW columns, whose names
 * the engine does not judge on `where` either (its registry-less tolerance —
 * see `assertFilterIsMaterializable`), so a `{ $field }` here is judged for its
 * position and its declaration, never for its name.
 *
 * Read-only.
 */
export function assertAggregationFilterIsEvaluable(filter: unknown, index: number): void {
  const clause = aggregationFilterClause(index);
  assertNodeIsEvaluable(filter, clause.root, { clause });
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
 */
export function applyHaving(rows: any[], having: FilterCondition | null | undefined): any[] {
  if (!having || typeof having !== 'object' || Object.keys(having).length === 0) return rows;
  return rows.filter((row) => matchesHaving(row, having));
}

/**
 * Evaluate one aggregated row against a HAVING FilterCondition.
 *
 * [#7158] `path` is the position of `cond` inside the clause the caller wrote —
 * `having`, `having.$and[0]`, `having.$not` — carried down so a comparand
 * refusal can NAME where the offending key sits. It defaults, so this stays the
 * two-argument function every existing caller (and `applyHaving` below) uses.
 */
export function matchesHaving(
  row: Record<string, any>,
  cond: any,
  path = 'having',
  clause: FilterClause = HAVING_CLAUSE,
): boolean {
  if (!cond || typeof cond !== 'object') return true;
  for (const [key, value] of Object.entries(cond)) {
    const here = `${path}.${key}`;
    if (key === '$and') {
      const branches = Array.isArray(value) ? value : [value];
      if (!branches.every((c, i) => matchesHaving(row, c, `${here}[${i}]`, clause))) return false;
      continue;
    }
    if (key === '$or') {
      const branches = Array.isArray(value) ? value : [value];
      if (!branches.some((c, i) => matchesHaving(row, c, `${here}[${i}]`, clause))) return false;
      continue;
    }
    if (key === '$not') {
      if (matchesHaving(row, value, here, clause)) return false;
      continue;
    }
    if (key.startsWith('$')) throw unknownOperator(key, 'logical', [], clause);
    // Aggregated rows are flat (aliases + group projections) — direct access,
    // no dotted-path resolution. [#10576] The per-aggregation filter walks the
    // same way on purpose: it reads `driver.find()` rows, which are flat too.
    // [#20099] The row itself goes down too: a `{ $field }` comparand resolves
    // against it.
    if (!checkCondition(row?.[key], value, key, here, clause, row)) return false;
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
 */
export function matchesAggregationFilter(
  row: Record<string, any>,
  filter: FilterCondition,
  index: number,
): boolean {
  const clause = aggregationFilterClause(index);
  return matchesHaving(row, filter, clause.root, clause);
}

/** One column's condition — implicit equality or an operator object. */
function checkCondition(
  value: any,
  condition: any,
  field: string,
  path: string,
  clause: FilterClause = HAVING_CLAUSE,
  row: Record<string, any> = {},
): boolean {
  // Implicit equality (primitives, null, Date, array exact-match) — loose `==`
  // to mirror the Filter Protocol's memory evaluation.
  if (
    typeof condition !== 'object'
    || condition === null
    || condition instanceof Date
    || Array.isArray(condition)
  ) {
    return value == condition;
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
    switch (op) {
      case '$eq': if (value != target) return false; break;
      case '$ne': if (value == target) return false; break;
      case '$gt': if (!(value > target)) return false; break;
      case '$gte': if (!(value >= target)) return false; break;
      case '$lt': if (!(value < target)) return false; break;
      case '$lte': if (!(value <= target)) return false; break;
      case '$between':
        if (Array.isArray(target) && (value < target[0] || value > target[1])) return false;
        break;
      case '$in': if (!Array.isArray(target) || !target.includes(value)) return false; break;
      case '$nin': if (Array.isArray(target) && target.includes(value)) return false; break;
      case '$exists': {
        const exists = value !== undefined && value !== null;
        if (exists !== !!target) return false;
        break;
      }
      case '$null':
        if (target === true && value != null) return false;
        if (target === false && value == null) return false;
        break;
      case '$contains': if (typeof value !== 'string' || !value.includes(target)) return false; break;
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
      case '$notContains': if (typeof value === 'string' && value.includes(target)) return false; break;
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
