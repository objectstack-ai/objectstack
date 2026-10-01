// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * matchesFilterCondition — evaluate a Mongo-style {@link FilterCondition} against
 * ONE in-memory record (ADR-0058 D4/D6).
 *
 * This is the third backend for the canonical filter shape, completing the
 * round-trip: `compileCelToFilter` lowers CEL → FilterCondition; the engine runs
 * it as a `where`; `read-scope-sql` lowers it to SQL; and THIS evaluates it
 * against a single record for write-side validation — the RLS `check` clause
 * (post-image of an insert/update), where there is no query to push down to.
 *
 * Security posture: **fail closed.** Anything it cannot evaluate — a malformed
 * node, an unknown operator, a nested relation object a flat record can't
 * satisfy — returns `false` (the write is denied), never `true`. The operator
 * vocabulary mirrors `read-scope-sql.ts` so the in-memory and SQL backends agree.
 *
 * ## The unknown-operator posture: silent `false`, DECIDED not inherited (#6520)
 *
 * The #6993 census measured that this face answers an operator it does not know
 * with a silent `false` — no throw, no `code`, no message — where the other five
 * JS evaluation faces (`driver-memory`'s three surfaces, `driver-mongodb`,
 * objectql's `having`) all REFUSE with `INVALID_FILTER` / 400. #6520 was asked
 * to decide whether to keep that or upgrade it, and KEPT it. The reasons, in the
 * order they carry weight:
 *
 * 1. **The direction of the error is opposite here.** Those five faces compile
 *    READ predicates, where dropping a constraint WIDENS the result set — on an
 *    RLS read scope that is a permission bypass (#3948), so they must be loud.
 *    This one evaluates a WRITE-side `check`: an unevaluable condition denies the
 *    write. Silence costs a diagnostic, not a boundary.
 * 2. **Callers depend on this being TOTAL.** `plugin-security`'s `explain-engine`
 *    calls it per record to answer "does THIS row satisfy the filter?", and
 *    several driver doubles use it as a list filter. Throwing turns a per-record
 *    verdict into an aborted operation for those callers — a real behaviour
 *    change on the read/explain path, which is not what a `$icontains` parity PR
 *    should be deciding.
 * 3. **The measured defect is gone without it.** The census's actual complaint
 *    was that a spec-DECLARED operator (`$icontains`) got the silent `false`.
 *    Every operator in `FILTER_OPERATORS` now has an arm in {@link evalOp}, so
 *    the silent answer is reachable only for a name the protocol does not
 *    declare or has retired. [#7536] That claim is maintained rather than
 *    merely inherited: `$like` / `$ilike` are DECLARED by
 *    `StringOperatorSchema` while deliberately staged out of
 *    `FILTER_OPERATORS`, and they got arms here in the PR that declared them —
 *    the test is "can an author write it", not "is it in the allowlist", and by
 *    that test a silent `false` for `$like` would have been the same defect
 *    under a new name.
 *
 *    [#20444] The claim was FALSE for a while, and is true again because of an
 *    arm, not a rewording. `$empty` was declared by `FieldOperatorsSchema` /
 *    `SpecialOperatorSchema` (#20311) and staged out of `FILTER_OPERATORS` like
 *    `$like`, but its arms were placed in per-lane cards rather than in the
 *    declaring PR — so from that declaration until this face's arm landed, an
 *    RLS `check` written with `$empty` was answered by the silent `false`
 *    below, for every record and both flags: the defect this paragraph names.
 *    It now has its arm in {@link evalOp}, judged by the stored value (this
 *    face's reading, ruling A on #20399). Today the declared-but-staged names
 *    are `$like` and `$ilike` (`$empty` left the staging in #20446), and each
 *    is answered here; a name the
 *    protocol declares NEXT is owed an arm here by the PR that lets an author
 *    write it, or by the lane card its staging names.
 *
 * What stays open, deliberately and on the record: a RETIRED spelling
 * (`$regex` / `$options`) still gets the silent `false` here while the other five
 * faces print `RETIRED_FILTER_OPERATORS`' prescription naming `$icontains`. That
 * is the residue of #4706's second indictment on this face. It is a narrower
 * question than the one this section answers and it changes an accept/reject
 * surface, so #6520 left it to the maintainer rather than folding it into a
 * parity PR.
 *
 * ONE shape is refused instead of answered (#5240): `{ field: {} }`, a field
 * constrained by zero operators, throws `INVALID_FILTER` rather than returning
 * `false`. It is the shape the four backends could not agree on, so no answer
 * here is defensible; the operation fails, which is the #4775 posture for a
 * `check` that cannot be evaluated. Note this is not merely a louder denial:
 * where such a constraint sat under an `$or` beside a satisfied branch, or under
 * a `$not`, the old `false` was ABSORBED and the write was allowed. Those writes
 * now fail. See {@link emptyFieldConstraintError}.
 *
 * [#19886] A second shape is refused the same way: an ARRAY where a single
 * comparable value is expected — under `$ne`, or in the equality position
 * (`{ field: [...] }`, `{ field: { $eq: [...] } }`). It is the one position
 * where this face's answer was not merely silent but the WRONG way round for a
 * write gate: a strict comparison never equals an array, so `$ne` matched EVERY
 * record, and a negated equality (`$not` around `{ field: [...] }`) did too. On
 * the ADR-0058 D4 `check` that admitted every write the policy was written to
 * refuse, measured through the real `plugin-security` on three drivers. The
 * query faces the read side runs on — driver-sql's unbindable-comparand
 * refusal and driver-memory's array-comparand refusal — already refuse the
 * shape with `INVALID_FILTER` / 400; this face now gives the same envelope. See
 * {@link arrayComparandError}.
 *
 * [#20355] A third shape is refused when the caller hands over the object's
 * declared columns ({@link MatchesFilterOptions.fields}): a `{ $field }`
 * comparison between two columns that share no COMPARISON CLASS — text against
 * a number, text against a file field, anything against a formula field. The
 * rule is the spec's `crossFieldComparisonVerdict`, the same one driver-sql's
 * read applies, so one access policy gets one answer on both sides of the
 * write. See {@link findCrossFieldClassRefusal}.
 */

import type { FilterCondition } from '@objectstack/spec/data';
// [#20355] The cross-field comparison class, defined once in the spec (#20347)
// and read by every judge of a column-to-column comparison: driver-sql's read,
// the authoring door in `@objectstack/lint`, and this evaluator's write check.
import {
  crossFieldComparisonVerdict,
  type CrossFieldColumnVerdict,
  type CrossFieldComparisonFieldMeta,
  type CrossFieldComparisonVerdict,
} from '@objectstack/spec/data';
// [#6520] `asciiCaseInsensitiveContains` is `$icontains`' fold, defined once in
// the spec and shared by every JS evaluation face — so a `check` evaluated here
// and the same predicate compiled to SQL by `read-scope-sql.ts` fold the same
// domain.
import { nextUtcCalendarDay, utcInstantMs, asciiCaseInsensitiveContains, isUnboundedAbove } from '@objectstack/spec/data';
// [#7536] `$like`/`$ilike`'s pattern language, likewise defined once in the
// spec: this face evaluates the pattern in JS, `driver-sql` compiles the same
// one to `LIKE`/`GLOB`, and a translation written twice would agree on the day
// it was typed and never again.
import { matchesLikePattern } from '@objectstack/spec/data';
// [#20444] `$empty`'s value-level half — the spec's one definition of what a
// stored value counts as empty for a face that reads no field declaration.
import { isEmptyFilterValue } from '@objectstack/spec/data';
import { StandardErrorCode } from '@objectstack/spec/api';

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators — is REFUSED,
 * not evaluated.
 *
 * The shape had three answers in the repo: `driver-sql` refused it at the top
 * level but dropped it inside `$and`/`$or`/`$not` (a predicate that emits
 * nothing matches every row), `driver-memory` answered "matches nothing" by
 * accident of structural equality, and THIS evaluator answered `false` from the
 * explicit `keys.length === 0` arm below. Ruled on #5240: refused in all four
 * backends, with the same `INVALID_FILTER` code, so an authoring accident — a
 * filter builder that recorded a field and never its operator — fails loudly at
 * the producer instead of quietly changing a row count per backend.
 *
 * # Why this one throw does not weaken the fail-closed posture
 *
 * "Fail closed" is about what an UNEVALUABLE condition does to an ANSWER: it
 * must never widen access. Throwing is the strongest form of that — there is no
 * answer to widen — and it lands on the posture #4775 already settled for this
 * surface: a `check` that cannot be evaluated fails the operation. What changes
 * is the shape of the failure, and one case where the outcome flips outright:
 * a `check` whose broken constraint sat under an `$or` beside a satisfied
 * branch, or under a `$not`, used to evaluate to ALLOW. Those writes now fail.
 * That is a real, observable behaviour change and it is the point of the ruling
 * — the alternative is a permission rule whose meaning depends on which of four
 * backends evaluated it.
 */
function emptyFieldConstraintError(field: string, path: string): Error {
  const err = new Error(
    `Field constraint at ${path} carries zero operators ({ "${field}": {} }). A field constraint ` +
      `must name at least one operator (e.g. { "${field}": { "$eq": "value" } }) or be a direct ` +
      `comparand (e.g. { "${field}": "value" }). It is refused rather than evaluated because the ` +
      `backends disagreed on what it means — driver-sql dropped it inside $and/$or/$not (matching ` +
      `EVERY row) while refusing it at the top level, and driver-memory / this evaluator ` +
      `answered "matches nothing".`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#19886] An ARRAY where one comparable value is expected — under `$ne`, or in
 * the equality position (a bare-array field spec, or `$eq`) — is REFUSED, not
 * evaluated, with the envelope the other faces already give the same shape
 * (`INVALID_FILTER` / 400).
 *
 * # Why refused rather than answered
 *
 * The answer this face used to give was unsafe on the surface it exists for.
 * `looseEq` is a strict comparison, and no stored scalar is ever `===` an array,
 * so:
 *
 * | shape                                   | old answer, every record |
 * |:----------------------------------------|:-------------------------|
 * | `{ f: { $ne: [...] } }`                 | `true`                   |
 * | `{ f: [...] }` / `{ f: { $eq: [...] } }`| `false`                  |
 * | `{ $not: { f: [...] } }`                | `true`                   |
 *
 * The positive equality row only failed closed by accident, and inverted the
 * moment it was negated. There is no answer here that is right in every
 * polarity — which is the #5240 argument for refusing rather than choosing.
 *
 * # What stays exactly as it was
 *
 * `$in` / `$nin` (the list operators — this is what they are FOR), scalars,
 * `null`, `Date`, and `{ $field }` references between single-valued columns.
 * The shape refusal reads the AUTHORED comparand, never a resolved one. The
 * two record-side refusals that reuse this error are judged per record in
 * {@link evalOp}: [stage 2d] a `{ $field }` column holding a list or an object
 * ({@link assertComparableReference}), and [stage 2e] a list or an object stored
 * under an ordering operator ({@link ORDERING_OPERATORS}).
 *
 * # Why the message names nothing from the filter
 *
 * This face's callers evaluate access policies — the write gate's `check`, and
 * the explain engine's record attribution — and the caller who receives the
 * 400 is usually not the author of the predicate. The comparand may be a
 * resolved membership set (other users' ids), which must not be echoed to them.
 * So the field, the operator and the value are withheld, the posture
 * driver-sql's withheld-diagnostic ruling took for the same reason, and the
 * message carries the refusal's identity and the remedy only.
 */
function arrayComparandError(): Error {
  const err = new Error(
    'A single-value comparison in this filter received an array as its comparand: an array ' +
      'under "$ne", or an array in the equality position ({ "field": [ ... ] } or "$eq"), or ' +
      'under an ordering operator ("$gt", "$gte", "$lt", "$lte"), or as a member of an "$in" / ' +
      '"$nin" list, or a column that holds a list or an object on either side of a { "$field" } ' +
      'comparison or on the compared side of an ordering operator or "$between". A list is not ' +
      'one comparable value. For "one of these values" use "$in", and ' +
      'for "none of these values" use "$nin" — the list operators the filter protocol declares; ' +
      'an ordering comparison takes one bound. It is refused rather than evaluated, because this ' +
      'evaluator compares strictly and no stored value ever equals an array: "$ne" matched EVERY ' +
      'record, and so did a negated equality or a negated "$in", which on a row-level write check ' +
      'admitted every write the check was written to refuse, and an ordering operator compared ' +
      'the array as a string. The field, the operator and the value are withheld from this ' +
      'message because the filter may be an access policy the caller did not write; in a ' +
      'row-level policy, look for a comparison against a list literal, a current_user membership ' +
      'key, or a json or multiple field, and rewrite it with "in" (for example ' +
      '"!(record.status in [\'closed\', \'archived\'])").',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#19886] The operators whose array comparand this face refuses: the six that
 * compare ONE value. The equality slot and its negation were ruled first
 * (stage 2a); [stage 2d] the four ordering operators joined them, because an
 * ordering comparison against an array did not refuse or fail closed — it
 * compared the array's JavaScript string form (`['m']` ordered as `'m'`), an
 * answer no declared contract gives and no SQL backend shares.
 */
const ARRAY_REFUSED_OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'] as const;

/**
 * [#19886 stage 2d] The list operators, whose MEMBERS are each one comparable
 * value. A member that is itself an array matched no record under `$in`, so
 * `$nin` and a negated `$in` matched EVERY record — the `$ne` bypass one level
 * down.
 */
const LIST_MEMBER_OPERATORS = ['$in', '$nin'] as const;

/**
 * [#19886 stage 2e] The ordering operators, whose STORED operand is judged on
 * the record: a list or a plain object there is refused with
 * {@link arrayComparandError}, per record, whatever the comparand — the mirror
 * of stage 2d's array-comparand refusal with the list on the record's side.
 *
 * `record.tags > 'a'` on a `json` column or a `multiple` lookup lowers to
 * `{ tags: { $gt: 'a' } }`, a legal shape; the list arrives on the post-image.
 * `order` then compared the list's JavaScript string form: `['m'] > 'a'` is
 * `'m' > 'a'`, and `{ a: 1 } < 'a'` is `'[object Object]' < 'a'` — both `true`.
 * Measured through the real plugin-security write check on driver-sql and
 * driver-memory, such a `check` admitted and stored the list-holding write.
 * `$between` is `>=` and `<=` over the same `order`, and coerced the same way.
 *
 * The norm it follows is the production read driver's: driver-sql refuses every
 * ordering comparison, and `$between`, against a column it stores as JSON text,
 * by DECLARED type (#7398, `JSON_COLUMN_INCOMPATIBLE_OPERATORS`), because such a
 * comparison "can never mean what the caller wrote". This evaluator has no
 * schema, so it judges the VALUE: a record whose json column holds one scalar is
 * compared as before. `null` (no value; `order` is never reached) and `Date` (a
 * comparand, not an object map) are untouched, and so is equality — a scalar
 * `$eq` / `$ne` / implicit equality against a stored list keeps the answer stage
 * 2a pinned.
 *
 * What this does NOT align: driver-memory's read, a frozen test driver, compares
 * a stored list element by element and keeps returning those rows, so its write
 * check and its read part here (declared on #15104, as for stage 2d's `$field`
 * half). And a list written into a scalar column (`amount: [500]` into a
 * `number`) under an ordering check is refused here too, where it was admitted
 * and stored stringified.
 */
const ORDERING_OPERATORS = ['$gt', '$gte', '$lt', '$lte', '$between'] as const;

/** One comparable value: not a list, and not a plain object (a `Date` is a value). */
function isNonScalarValue(value: unknown): boolean {
  return Array.isArray(value) || isOperatorMap(value);
}

/** A `{ $field }` reference comparand — the same test {@link resolveValue} applies. */
function isFieldReference(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) && '$field' in (raw as Record<string, unknown>);
}

/** A plain object — an operator map rather than a comparand (`Date` is a comparand). */
function isOperatorMap(spec: unknown): spec is Record<string, unknown> {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec) || spec instanceof Date) return false;
  const proto = Object.getPrototypeOf(spec);
  return proto === Object.prototype || proto === null;
}

/**
 * [#20355] What a caller that knows the record's object may tell the evaluator.
 */
export interface MatchesFilterOptions {
  /**
   * The declared columns of the object `record` belongs to, keyed by field
   * name — each column's declared `type` and `multiple`, the slice the spec's
   * cross-field classification reads.
   *
   * Supplied, every `{ $field }` comparison between two columns named here is
   * judged by that classification before any record is read, and one the
   * platform defines no answer for is refused ({@link findCrossFieldClassRefusal}).
   * Omitted, the evaluator judges values only, as it always has: it has no
   * schema of its own, and a caller without one (an aggregated row, a probe
   * record) is not asked for one.
   */
  readonly fields?: Readonly<Record<string, CrossFieldComparisonFieldMeta>>;
}

/** True iff `record` satisfies `filter`. A null/empty filter matches everything. */
export function matchesFilterCondition(
  record: Record<string, unknown>,
  filter: FilterCondition | null | undefined,
  options?: MatchesFilterOptions,
): boolean {
  if (filter == null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) return false;
  // [#5240] Shape first, then evaluate. The refusal is raised by a walk of the
  // WHOLE tree, up front, rather than from inside `evalField` — because the
  // evaluator short-circuits (`every`/`some`, and a node returns on its first
  // false entry), so a refusal raised mid-evaluation would fire or not fire
  // depending on the RECORD being tested. A malformed permission rule must be
  // refused for every record or none. Evaluation below is untouched.
  assertFilterShape(filter as Record<string, unknown>, 'filter');
  // [#20355] The comparison-class rule is judged the same way, and for the same
  // reason: it reads the declared columns, never the record, so a policy is
  // refused for every record or for none.
  if (options?.fields) {
    const refusal = findCrossFieldClassRefusal(filter, options.fields);
    if (refusal) throw crossFieldClassError(refusal);
  }
  return evalNode(record, filter as Record<string, unknown>);
}

/**
 * [#20355] One `{ $field }` comparison between two declared columns that share
 * no comparison class, as {@link findCrossFieldClassRefusal} found it.
 */
export interface CrossFieldClassRefusal {
  /** The constrained column — the key the comparison sits under. */
  readonly field: string;
  /** The comparison operator (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`). */
  readonly operator: string;
  /** The referenced column — the `{ $field }` value. */
  readonly reference: string;
  /** The classification's answer: two classes, or a column with none. */
  readonly verdict: Extract<CrossFieldComparisonVerdict, { verdict: 'cross-class' | 'no-class' }>;
  /**
   * The comparison and both declarations in words. SERVER-SIDE ONLY: it names
   * the columns of a predicate the caller may not have written, so it goes to
   * a log, never into an error message (see {@link crossFieldClassError}).
   */
  readonly diagnostic: string;
}

/**
 * [#20355] The first `{ $field }` comparison in `filter` whose two columns are
 * both declared in `fields` and share no comparison class — `null` when there
 * is none. Pure: it reads the filter and the declarations, never a record.
 *
 * ## The rule, and why it is the spec's
 *
 * A column-to-column comparison has one meaning only between two columns of
 * ONE comparison class, and a file field, a formula field or a column holding
 * a list or an object has no class at all (`@objectstack/spec/data`
 * `crossFieldComparisonVerdict`, lifted from driver-sql's #5222 boundary by
 * #20347). Across classes the backends answer differently: SQLite orders
 * every TEXT above every INTEGER, while this evaluator's JS comparison coerces
 * (`'open' > 5` is false), so a comparison that is well defined nowhere gets a
 * different answer on each path.
 *
 * Measured through the real plugin-security and ObjectQL on driver-sql, on
 * SQLite and on PostgreSQL, before this rule: an RLS policy
 * `record.status != record.amount` (text vs number), `record.status !=
 * record.photo` (text vs image), `record.status != record.is_open` (text vs a
 * formula field) or `record.status != record.meta` (text vs json) answered the
 * read it scopes with `INVALID_FILTER` / 400, because driver-sql refuses to
 * compile the comparison; and the insert its `check` judges — or its `using`,
 * standing in as the check — was ADMITTED and stored, because this evaluator
 * compared the two raw values (`'open' !== 5`). One policy, two answers, the
 * permissive one on the write side. The write check now refuses the
 * comparison exactly where the read does, by the same classification.
 *
 * ## What it judges, and what it leaves
 *
 * The six operators a `{ $field }` comparand is declared for
 * ({@link ARRAY_REFUSED_OPERATORS}: the ones that compare ONE value), at any
 * depth under `$and` / `$or` / `$not`, whether or not the reference carries an
 * `addDays` offset — driver-sql asks the class question before it reads the
 * offset. Only a comparison whose BOTH columns are keys of `fields` is judged:
 * a dotted path, or a column the object does not declare, is a different
 * question with its own answer elsewhere (the RLS compiler's field guard
 * refuses an undeclared column before a filter ever reaches this evaluator).
 * A declared type outside `FieldType` is not judged either
 * (`unjudged`) — it is not a declaration the classification covers, and the
 * metadata schema refuses it at authoring.
 */
export function findCrossFieldClassRefusal(
  filter: FilterCondition | Record<string, unknown> | null | undefined,
  fields: Readonly<Record<string, CrossFieldComparisonFieldMeta>>,
): CrossFieldClassRefusal | null {
  const declared = (name: string): CrossFieldComparisonFieldMeta | undefined =>
    Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined;
  const walk = (node: unknown): CrossFieldClassRefusal | null => {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return null;
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(val)) continue;
        for (const child of val) {
          const found = walk(child);
          if (found) return found;
        }
        continue;
      }
      if (key === '$not') {
        const found = walk(val);
        if (found) return found;
        continue;
      }
      if (key.startsWith('$') || !isOperatorMap(val)) continue;
      const target = declared(key);
      if (!target) continue;
      for (const op of ARRAY_REFUSED_OPERATORS) {
        const raw = val[op];
        if (!isFieldReference(raw) || typeof raw.$field !== 'string') continue;
        const ref = declared(raw.$field);
        if (!ref) continue;
        const verdict = crossFieldComparisonVerdict(target, ref);
        if (verdict.verdict !== 'cross-class' && verdict.verdict !== 'no-class') continue;
        return {
          field: key,
          operator: op,
          reference: raw.$field,
          verdict,
          diagnostic: describeCrossFieldClassRefusal(key, target, op, raw.$field, ref, verdict),
        };
      }
    }
    return null;
  };
  return walk(filter);
}

/** How one declared column stands in a refused comparison, in words. */
function describeColumn(name: string, meta: CrossFieldComparisonFieldMeta, verdict: CrossFieldColumnVerdict): string {
  const declared = `"${name}" (type '${meta.type}'${meta.multiple === true ? ', multiple' : ''})`;
  if (verdict.kind === 'class') return `${declared} is compared as ${verdict.class}`;
  if (verdict.reason === 'file') return `${declared} is a file field, which has no comparison class`;
  if (verdict.reason === 'formula') return `${declared} is a formula field, which has no stored column to compare`;
  return `${declared} holds a list or an object, which has no comparison class`;
}

function describeCrossFieldClassRefusal(
  field: string,
  target: CrossFieldComparisonFieldMeta,
  op: string,
  reference: string,
  ref: CrossFieldComparisonFieldMeta,
  verdict: CrossFieldClassRefusal['verdict'],
): string {
  const parts =
    verdict.verdict === 'cross-class'
      ? [
          describeColumn(field, target, { kind: 'class', class: verdict.left }),
          describeColumn(reference, ref, { kind: 'class', class: verdict.right }),
        ]
      : [
          ...(verdict.left.kind === 'no-class' ? [describeColumn(field, target, verdict.left)] : []),
          ...(verdict.right.kind === 'no-class' && reference !== field
            ? [describeColumn(reference, ref, verdict.right)]
            : []),
        ];
  return (
    `the comparison { "${field}": { "${op}": { "$field": "${reference}" } } } compares two columns that ` +
    `share no comparison class: ${parts.join(', and ')}`
  );
}

/**
 * [#20355] The refusal carried on the error, under a SYMBOL key — the same
 * non-travel reason driver-sql's withheld diagnostic uses one: `JSON.stringify`,
 * a spread, `Object.keys` and the structured-clone boundary all skip it, so no
 * error mapper can put the column names back on the wire. `Symbol.for` so a
 * duplicated copy of this package resolves the same key.
 */
const CROSS_FIELD_CLASS_REFUSAL = Symbol.for('objectstack.formula.crossFieldClassRefusal');

/**
 * [#20355] A `{ $field }` comparison between two columns of no shared
 * comparison class is REFUSED, with the envelope the read gives the same
 * comparison: `INVALID_FILTER` / 400.
 *
 * The message names nothing from the filter, for the reason
 * {@link arrayComparandError} names nothing: on the write gate the filter is an
 * access policy, and the caller who receives the 400 is usually not its author
 * — driver-sql withholds the same comparison's columns on the read for the
 * same reason (#7929). The columns, the operator and both declarations travel
 * on the error for the server log ({@link crossFieldClassRefusalCarriedBy}).
 *
 * The remedy leads, and the whole message stays under the REST door's client
 * message bound (`CLIENT_MESSAGE_MAX` in `@objectstack/rest`: a 4xx message of
 * 500 characters or more is cut to 499 plus an ellipsis). The bound cuts the
 * TAIL, so a remedy written last never reached the wire. The order is: the
 * remedy; what is refused (two columns with no shared class, and the classes);
 * why it is refused; why the columns are withheld. The text is fixed, so its
 * length is too — a sentence added here must be paid for by a shorter one.
 */
function crossFieldClassError(refusal: CrossFieldClassRefusal): Error {
  const err = new Error(
    'In a row-level policy, compare a field only with a field of the same class, or fix the declaration ' +
      'of the one that is declared with the wrong type. This filter compares two columns that share no ' +
      'class (number, text, boolean, date, datetime, time; file, formula, list and object fields have ' +
      'none). SQL and this evaluator answer it differently, so it is refused, as on the read path. The ' +
      'columns and operator are withheld, as the caller may not have written the policy; the server log ' +
      'names them.',
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  Object.defineProperty(err, CROSS_FIELD_CLASS_REFUSAL, { value: refusal, enumerable: false });
  return err;
}

/**
 * [#20355] The comparison-class refusal an error carries, or `null` for any
 * other error — the read half of {@link crossFieldClassError}, for a caller that
 * logs the refused comparison server-side (the RLS write gate names the policy
 * beside it).
 */
export function crossFieldClassRefusalCarriedBy(err: unknown): CrossFieldClassRefusal | null {
  if (err === null || (typeof err !== 'object' && typeof err !== 'function')) return null;
  const refusal = (err as Record<symbol, unknown>)[CROSS_FIELD_CLASS_REFUSAL];
  return refusal && typeof refusal === 'object' ? (refusal as CrossFieldClassRefusal) : null;
}

/**
 * [#5240] Walk the whole condition tree and refuse any zero-operator field
 * constraint. [#19886] The same walk refuses an array comparand under `$ne`
 * or in the equality position ({@link arrayComparandError}), at any depth under
 * `$and` / `$or` / `$not`. Shapes this evaluator already answers fail-closed in
 * every polarity (a non-node `$and` element, an unknown `$`-operator) are left
 * to it — this walk adds those two refusals and changes nothing else.
 */
function assertFilterShape(node: unknown, path: string): void {
  if (node == null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(val)) val.forEach((child, i) => assertFilterShape(child, `${here}[${i}]`));
      continue;
    }
    if (key === '$not') {
      assertFilterShape(val, here);
      continue;
    }
    if (key.startsWith('$')) continue;
    if (isEmptyFieldConstraint(val)) throw emptyFieldConstraintError(key, here);
    // [#19886] The equality position, spelled bare: `{ field: [...] }`.
    if (Array.isArray(val)) throw arrayComparandError();
    // [#19886] …and spelled with an operator: a one-value operator carrying an
    // array ([stage 2d] the ordering operators included), or a list operator
    // one of whose members is itself an array.
    if (isOperatorMap(val)) {
      for (const op of ARRAY_REFUSED_OPERATORS) {
        if (Array.isArray(val[op])) throw arrayComparandError();
      }
      for (const op of LIST_MEMBER_OPERATORS) {
        const list = val[op];
        if (Array.isArray(list) && list.some((member) => Array.isArray(member))) throw arrayComparandError();
      }
    }
  }
}

/**
 * [#5240] Is this field spec `{}` — a field constrained by ZERO operators?
 *
 * A plain object with no own enumerable keys, and nothing else: a `Date` also
 * enumerates to nothing but is a COMPARAND (`evalField` treats it as implicit
 * equality), not a constraint.
 */
function isEmptyFieldConstraint(spec: unknown): boolean {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec) || spec instanceof Date) return false;
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(spec as Record<string, unknown>).length === 0;
}

function evalNode(record: Record<string, unknown>, node: Record<string, unknown>): boolean {
  // A node is the AND of all its entries.
  for (const [key, val] of Object.entries(node)) {
    if (key === '$and') {
      if (!Array.isArray(val) || !val.every((c) => evalNode(record, c as Record<string, unknown>))) return false;
    } else if (key === '$or') {
      if (!Array.isArray(val) || val.length === 0 || !val.some((c) => evalNode(record, c as Record<string, unknown>))) return false;
    } else if (key === '$not') {
      if (val == null || typeof val !== 'object') return false;
      if (evalNode(record, val as Record<string, unknown>)) return false;
    } else if (key.startsWith('$')) {
      return false; // unknown top-level operator → fail closed
    } else {
      if (!evalField(record, key, val)) return false;
    }
  }
  return true;
}

function evalField(record: Record<string, unknown>, field: string, spec: unknown): boolean {
  const actual = getPath(record, field);
  // `{ field: null }` → IS NULL.
  if (spec === null) return actual == null;
  // Scalar / Date → implicit equality.
  if (typeof spec !== 'object' || spec instanceof Date) return looseEq(actual, spec);
  // A bare array value is not a valid field spec (must be `{ $in: [...] }`).
  // [#19886] Refused up front by `assertFilterShape` on the public entry point,
  // so this arm is a floor for a recursive call on a subtree, not this face's
  // answer to the shape — the same standing as the `keys.length === 0` arm below.
  if (Array.isArray(spec)) return false;

  const ops = spec as Record<string, unknown>;
  const keys = Object.keys(ops);
  // Must be all-operators; a non-`$` key means a nested relation a flat record
  // cannot satisfy → fail closed.
  //
  // [#5240] `keys.length === 0` no longer reaches this arm on the public entry
  // point: `assertFilterShape` refuses `{ field: {} }` before evaluation starts.
  // The clause stays because this function is also reachable from a recursive
  // `evalNode` on a subtree, and a total function must stay total — but it is a
  // floor, no longer this backend's ANSWER to the shape.
  if (keys.length === 0 || keys.some((k) => !k.startsWith('$'))) return false;
  for (const op of keys) {
    if (!evalOp(actual, op, ops[op], record)) return false;
  }
  return true;
}

function evalOp(actual: unknown, op: string, raw: unknown, record: Record<string, unknown>): boolean {
  // [#19886 stage 2d] A `{ $field }` comparison whose column holds a list or an
  // object ON THIS RECORD — either side. See {@link assertComparableReference}.
  if (isFieldReference(raw)) assertComparableReference(actual, op, raw, record);
  // [#19886 stage 2e] An ordering comparison whose STORED operand holds a list
  // or an object on this record, whatever the comparand. See
  // {@link ORDERING_OPERATORS}.
  if ((ORDERING_OPERATORS as readonly string[]).includes(op) && isNonScalarValue(actual)) {
    throw arrayComparandError();
  }
  const v = resolveValue(raw, record);
  // [#14104] An offset reference whose base is NULL is FALSE for every
  // operator — see {@link NO_OFFSET_BASE}. Before the switch, so `$ne`'s
  // complement arm and `$eq`'s null arm never see it.
  if (v === NO_OFFSET_BASE) return false;
  switch (op) {
    case '$eq': return v === null ? actual == null : looseEq(actual, v);
    case '$ne': return v === null ? actual != null : !looseEq(actual, v);
    case '$gt': return actual != null && v != null && order(actual, v, (a, b) => a > b);
    case '$gte': return actual != null && v != null && order(actual, v, (a, b) => a >= b);
    case '$lt': return actual != null && v != null && order(actual, v, (a, b) => a < b);
    case '$lte': return actual != null && v != null && lteBound(actual, v);
    case '$in': return Array.isArray(v) && v.some((x) => looseEq(actual, x));
    case '$nin': return Array.isArray(v) && !v.some((x) => looseEq(actual, x));
    case '$between':
      return Array.isArray(v) && v.length === 2 && actual != null && v[0] != null && v[1] != null
        && order(actual, v[0], (a, b) => a >= b) && lteBound(actual, v[1]);
    case '$contains': return typeof actual === 'string' && typeof v === 'string' && actual.includes(v);
    /**
     * [#6520] `$contains`' case-INSENSITIVE twin, folding ASCII case and nothing
     * else — `asciiCaseInsensitiveContains` is the spec's shared definition, the
     * same one `driver-memory`'s matcher and objectql's `having` call.
     *
     * NOT `actual.toLowerCase().includes(v.toLowerCase())`, which is the obvious
     * line and the wrong one: it folds the whole Unicode range, so an RLS
     * `check` written with `$icontains` would ALLOW a write here that the read
     * scope's SQL — folding ASCII only — then hides. One predicate, two answers,
     * across the write gate and the read gate, is the #3948 shape reached
     * through case folding (#4706 Q1 = A).
     */
    case '$icontains':
      return typeof actual === 'string' && typeof v === 'string' && v !== ''
        && asciiCaseInsensitiveContains(actual, v);
    /**
     * [#7536] `$like` / `$ilike` — the caller's own SQL `LIKE` pattern, matched
     * against the WHOLE value. `matchesLikePattern` is the spec's one
     * translation of that pattern language, the same one `driver-sql` and
     * `driver-turso` compile to `LIKE` / `GLOB`.
     *
     * Answered here rather than left to the `default: return false` below, and
     * that is a decision this face had to make rather than inherit. The silent
     * default is fail-CLOSED and correct for a spelling the protocol does not
     * have — but `$like` IS declared now, and a declared operator that silently
     * denies is the defect the #6993 census measured for `$icontains`: an RLS
     * write-side `check` written with `$like` would deny every write while the
     * read scope's SQL happily matched rows. One predicate, two answers, across
     * the write gate and the read gate — the #3948 shape.
     *
     * A malformed pattern (a dangling trailing escape) makes
     * `matchesLikePattern` throw. It is caught and answered FALSE here, not
     * propagated: this evaluator is total by contract (its header's
     * "unknown-operator posture"), and on a write-side `check` the fail-closed
     * answer is the safe one. The driver faces refuse that same pattern loudly
     * at authoring time, which is where a caller can act on it.
     */
    case '$like':
    case '$ilike':
      if (typeof actual !== 'string' || typeof v !== 'string') return false;
      try {
        return matchesLikePattern(actual, v, op === '$ilike');
      } catch {
        return false;
      }
    case '$notContains': return !(typeof actual === 'string' && typeof v === 'string' && actual.includes(v));
    case '$startsWith': return typeof actual === 'string' && typeof v === 'string' && actual.startsWith(v);
    case '$endsWith': return typeof actual === 'string' && typeof v === 'string' && actual.endsWith(v);
    case '$null': return v === true ? actual == null : actual != null;
    /**
     * [#5298/#5369] `$exists` means "the field HAS A VALUE", not "the key is
     * present" — so it is the exact mirror of `$null` and reads `!= null`, not
     * `!== undefined`.
     *
     * This used to read `actual !== undefined`, which made `{ x: null }` answer
     * TRUE for `$exists: true` while `driver-sql` compiled the same operator to
     * `IS NOT NULL` and answered FALSE. On an RLS rule that is one `check`
     * clause allowing a write the read side would then hide.
     *
     * The ruling picked "has a value" over "key is present" for a reason the SQL
     * side makes unavoidable: a column IS the schema, so there is no such thing
     * as an absent key in a row, and a backend cannot honour a semantics its
     * storage model has no way to represent. Field existence is a property of
     * the SCHEMA, not of the record — so the record-level operator can only be
     * asking about the value. Declaring "key is present" would be the spec
     * promising something two of its backends can never deliver.
     *
     * With that, `$exists` and `$null` are strict complements on every backend:
     * `$exists: true` ≡ `$null: false`, `$exists: false` ≡ `$null: true`. A
     * missing key and an explicit `null` are the same fact here, which is also
     * what `getPath` already returns for both (`undefined`).
     */
    case '$exists': return v === true ? actual != null : actual == null;
    /**
     * [#20444] `$empty` — the emptiness flag (declared by
     * `FieldOperatorsSchema`; staged out of `FILTER_OPERATORS` like `$like`
     * until #20446 added it there and lowered `is_empty` / `is_not_empty` to
     * it, so a policy's stored 「is empty」 reaches this arm too).
     * Ruling A on #20399 (record 5865693155) gives this face the BY-VALUE
     * reading, because it judges a record, not a declaration: null, a missing
     * key, `''` and `[]` are empty, through the spec's `isEmptyFilterValue`
     * rather than a copy of it, and `false` is the exact complement.
     *
     * That differs from the declared-type faces (the SQL family, the document
     * drivers, and the read-scope compiler that lowers the same policy for the
     * read) only on a stored state the declaration does not predict: `''` in a
     * non-text column — the write-door class #20308 closed — or `[]` in a
     * scalar one. On every value a field's own type can hold, the write
     * `check` and the read agree.
     *
     * Read off `raw`, not the resolved `v`: the flag is a boolean by
     * declaration, never a value of another column, so a `{ $field }` in its
     * slot is not resolved into one. Anything but `true` / `false` answers
     * `false` — the write is denied — which is this face's standing answer to
     * an unevaluable condition (the header's "unknown-operator posture"); the
     * spec's save door and every query face refuse such a flag loudly.
     */
    case '$empty':
      if (raw === true) return isEmptyFilterValue(actual);
      if (raw === false) return !isEmptyFilterValue(actual);
      return false;
    /**
     * An operator this evaluator does not know answers `false` — the write is
     * DENIED — rather than throwing. [#6520] examined this arm and KEPT it; the
     * reasoning is on this module's header under "the unknown-operator posture",
     * because it is a decision rather than an omission.
     *
     * What #6520 did change is the arm's REACH: every operator `FILTER_OPERATORS`
     * declares now has a case above it (`$empty` among them since #20446) — and
     * so does every declared-but-staged one (`$like`, `$ilike`) — so this line is only
     * reachable for a spelling the protocol does not have (a typo) or one it
     * retired (`$regex` / `$options`). No DECLARED operator is answered silently
     * here any more, which was the defect the #6993 census measured.
     */
    default: return false; // unknown operator → fail closed
  }
}

/**
 * [#19886 stage 2d] A `{ $field }` comparison whose column holds a LIST — or an
 * object — on the record being judged is refused with
 * {@link arrayComparandError}, whichever side the column is on.
 *
 * `record.status != record.tags` lowers to `{ status: { $ne: { $field: 'tags' } } }`
 * (the field-to-field branch of `cel-to-filter.ts`), and `tags` — a `json`
 * column or a `multiple` lookup — holds a list on the post-image. `looseEq`
 * never equals a list, so `$ne` matched every record and a negated `$eq` did
 * too: measured through the real plugin-security write check on driver-sql and
 * driver-memory, every write such a `check` was written to refuse was admitted
 * and stored. The mirrored spelling (`record.tags != record.status`) puts the
 * list on the constrained side and answered the same way, so both sides are
 * judged. An ordering operator compared the list's string form instead.
 *
 * ## Why here, and why per record
 *
 * The lowering cannot see this. It knows the predicate's text, not the object's
 * field types — the RLS field guard carries column NAMES only — so the
 * reference lowers exactly as a legal scalar-to-scalar comparison does. This
 * evaluator is the first place that sees the VALUES, and a value is known per
 * record. So unlike the refusals {@link assertFilterShape} raises, which judge
 * the authored shape and answer every record alike, this one answers the record
 * being judged. On the write gate that record is the post-image: a write whose
 * compared column holds a list is refused (`INVALID_FILTER` / 400) and nothing
 * is stored. A record whose json column holds one scalar compares it, as before.
 *
 * It pulls the write gate toward the read side's answer: driver-sql refuses a
 * cross-field comparison against any JSON-stored or `multiple` column, on
 * either side, by DECLARED type (#5222, `crossFieldComparisonClass`), for the
 * same six operators.
 *
 * The offset form (`{ $field, addDays }`) is judged on its BASE column, before
 * the offset arithmetic that would otherwise turn a list into the "no
 * deadline" sentinel — which a `$not` inverts.
 */
function assertComparableReference(
  actual: unknown,
  op: string,
  raw: Record<string, unknown>,
  record: Record<string, unknown>,
): void {
  if (!(ARRAY_REFUSED_OPERATORS as readonly string[]).includes(op)) return;
  const referent = getPath(record, String(raw.$field));
  if (isNonScalarValue(referent) || isNonScalarValue(actual)) throw arrayComparandError();
}

/**
 * The inclusive-upper-bound comparison, with the calendar-day rule the rest of
 * the platform applies (ADR-0053 D-D, #3777): a bare `YYYY-MM-DD` bound means
 * "through that whole day", so it is evaluated half-open against the next day
 * rather than against that day's midnight.
 *
 * Without this, a `check` policy of the shape `{ signed_on: { $lte: '{today}' } }`
 * evaluated on a `datetime` post-image **denied every write made after 00:00** —
 * the write-side twin of the read-side data loss #3777 fixed, and the reason
 * this evaluator had to stop being the one backend that disagreed. The four
 * other backends (SQL compiler, memory, mongo, the analytics preview) already
 * share this rule via the same primitive.
 *
 * String ordering makes `< nextDay` equivalent to `<= day` for a plain
 * `YYYY-MM-DD` value, so no field-type lookup is needed — which matters here,
 * because this evaluator sees a bare record and has no schema to consult.
 * A full-ISO or non-string bound keeps exact-instant semantics.
 *
 * [#20600] `9999-12-31`, the last supported day, has no next day to compare
 * against (`UNBOUNDED_ABOVE`): every instant the platform stores is on or
 * before it, so a value that denotes an instant ({@link utcInstantMs}) is
 * inside the bound, and any other value keeps the comparison as written — no
 * schema here says it is temporal, and the check must not admit a value the
 * operands do not justify. The five-digit `'10000-01-01'` this compared
 * against before sorted below every `'2026-…'` value, so the bound DENIED
 * every write it should have admitted.
 */
function lteBound(actual: unknown, bound: unknown): boolean {
  if (bound == null) return false;
  const nextDay = nextUtcCalendarDay(bound);
  if (isUnboundedAbove(nextDay)) return utcInstantMs(actual) !== null || order(actual, bound, (a, b) => a <= b);
  if (nextDay != null) return order(actual, nextDay, (a, b) => a < b);
  return order(actual, bound, (a, b) => a <= b);
}

/**
 * Apply an ordering comparison, lifting the pair to instants when exactly one
 * side is a JS `Date` — the cross-type case JS relational operators answer
 * `false` to unconditionally (they coerce with hint `number`, so the `Date`
 * becomes its epoch and the ISO string becomes `NaN`).
 *
 * This is not a hypothetical pairing on this surface: the RLS `check`
 * post-image is the caller's RAW write payload (`{ ...opCtx.data }` in
 * `plugin-security`, built before any driver `formatInput` converges it), so an
 * SDK write of `new Date()` lands here as a `Date` while the policy's comparand
 * is the platform's wire text — and the mirror pairing arrives too, because a
 * CEL `today()` lowers to a `Date` against a record holding canonical text.
 * Measured against the shared matrix, 10 of 16 cases dropped every
 * `Date`-valued row; fail-closed makes that a **denied write**, the write-side
 * twin of #4047's missing rows and the same failure direction D-D2 recorded
 * for the bare-day upper bound.
 *
 * Deliberately narrow. The lift triggers only when one operand is a `Date`
 * AND {@link utcInstantMs} can read both as instants, so every comparison that
 * worked before is byte-identical: string-vs-string keeps ISO lexicographic
 * ordering, number-vs-number stays numeric, and a `Field.time` wall clock —
 * which denotes no instant — is left alone rather than being given an invented
 * calendar day. Anything that cannot be lifted falls through to the original
 * comparison, so the security posture never becomes more permissive than the
 * operands actually justify.
 */
function order(actual: unknown, bound: unknown, cmp: (a: never, b: never) => boolean): boolean {
  if (actual instanceof Date || bound instanceof Date) {
    const a = utcInstantMs(actual);
    const b = utcInstantMs(bound);
    if (a !== null && b !== null) return cmp(a as never, b as never);
  }
  return cmp(actual as never, bound as never);
}

/**
 * [#14104] The resolved comparand of a `{ $field, addDays }` reference whose
 * referenced column is NULL — or whose offset cannot be read as a number, or
 * whose base cannot be read as a date. The ruling states it in words rather
 * than inheriting it from SQL: "a NULL `due_date` makes the comparison FALSE
 * (no deadline, never on time)" — for EVERY operator, `$ne` included. A
 * `null` return would have handed `$eq` its `actual == null` arm (a both-NULL
 * row would MATCH) and `$ne` its complement, so the absence is carried as a
 * sentinel that {@link evalOp} answers `false` for before any operator runs.
 * The SQL twin is the `(<base> IS NOT NULL AND …)` conjunct
 * `SqlDriver.applyCrossFieldComparison` writes; the shared corpus pins the
 * two to the same rows.
 */
const NO_OFFSET_BASE: unique symbol = Symbol('matches-filter:no-offset-base');

/**
 * Resolve a `{ $field: 'path' }` reference against the record; else passthrough.
 *
 * [#14104] A reference carrying `addDays` — an integer literal or a nested
 * `{ $field }` reference to a numeric column (dot-paths walked, as for `$field`)
 * — resolves to the referenced value shifted by that many WHOLE days. A NULL
 * offset contributes zero days; a NULL base resolves to {@link NO_OFFSET_BASE}.
 * `resolveValue`'s own test of "is this a reference" is unchanged (`'$field' in
 * raw`, any extra key ignored) so the three faces keep agreeing on what a
 * reference IS; only what is done with one grew.
 */
function resolveValue(raw: unknown, record: Record<string, unknown>): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && '$field' in (raw as Record<string, unknown>)) {
    const ref = raw as Record<string, unknown>;
    const base = getPath(record, String(ref.$field));
    if (!('addDays' in ref) || ref.addDays === undefined) return base;
    return addWholeDays(base, resolveDayOffset(ref.addDays, record));
  }
  return raw;
}

/**
 * [#14104] The `addDays` operand as a whole number of days: a literal, or the
 * value of the referenced column. `null`/`undefined` (a duty with no grace) is
 * ZERO days by the ruling; a fractional value is truncated toward zero, the
 * same reading every SQL dialect's arm applies (`cast(… as integer)` on
 * SQLite, `trunc` on Postgres, `truncate` on MySQL); a value that is not a
 * number at all is `NaN`, which {@link addWholeDays} turns into the
 * fail-closed sentinel.
 */
function resolveDayOffset(spec: unknown, record: Record<string, unknown>): number {
  const value = spec && typeof spec === 'object' && !Array.isArray(spec) && '$field' in (spec as Record<string, unknown>)
    ? getPath(record, String((spec as Record<string, unknown>).$field))
    : spec;
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

const DAY_MS = 86_400_000;
const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * [#14104] `base` shifted by `days` whole days, in the shape it arrived in, so
 * the comparison that follows reads exactly as it would against a stored
 * value of the same column:
 *
 *   - a bare calendar day (`YYYY-MM-DD`, the `Field.date` storage form) stays a
 *     calendar day — which is what keeps {@link lteBound}'s half-open rule
 *     ("through that whole day") in force for a `$lte` against a shifted day;
 *   - an ISO instant string (the `Field.datetime` canonical form) stays an ISO
 *     string with its time of day intact;
 *   - a `Date` stays a `Date`; an epoch number stays a number.
 *
 * `null`/`undefined` (no deadline) and anything that cannot be read as a
 * date — or a `NaN` offset — resolve to {@link NO_OFFSET_BASE}: the comparison
 * is false rather than guessed.
 */
function addWholeDays(base: unknown, days: number): unknown {
  if (base == null || !Number.isFinite(days)) return NO_OFFSET_BASE;
  if (typeof base === 'string' && CALENDAR_DAY_RE.test(base)) {
    const ms = Date.parse(`${base}T00:00:00.000Z`);
    if (Number.isNaN(ms)) return NO_OFFSET_BASE;
    return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
  }
  if (base instanceof Date) {
    const ms = base.getTime();
    return Number.isNaN(ms) ? NO_OFFSET_BASE : new Date(ms + days * DAY_MS);
  }
  if (typeof base === 'number') {
    return Number.isFinite(base) ? base + days * DAY_MS : NO_OFFSET_BASE;
  }
  if (typeof base === 'string') {
    const ms = Date.parse(base);
    if (Number.isNaN(ms)) return NO_OFFSET_BASE;
    return new Date(ms + days * DAY_MS).toISOString();
  }
  return NO_OFFSET_BASE;
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return record[path];
  let cur: unknown = record;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Equality that treats Dates by time-value; otherwise strict. */
function looseEq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && (typeof b === 'string' || typeof b === 'number')) return a.getTime() === new Date(b).getTime();
  if (b instanceof Date && (typeof a === 'string' || typeof a === 'number')) return new Date(a).getTime() === b.getTime();
  return a === b;
}
