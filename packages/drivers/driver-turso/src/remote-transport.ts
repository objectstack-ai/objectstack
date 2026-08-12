// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Remote Transport for TursoDriver
 *
 * Implements IDataDriver CRUD operations using @libsql/client for
 * remote-only (libsql://, https://) connections. No local SQLite or
 * Knex dependency — all queries execute via HTTP/WebSocket against
 * the remote Turso database.
 *
 * This transport is used internally by TursoDriver when the connection
 * URL is a remote-only endpoint without a local file backend.
 */

import type { Client, InStatement, ResultSet } from '@libsql/client';
import { StandardErrorCode } from '@objectstack/spec/api';
import { FILTER_OPERATORS, LOGICAL_OPERATORS, RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
// [#7872] The shared comparand-type door. `serializeComparand`'s allow-list and
// `driver-sql`'s reached the identical six types twice independently — the
// measured fact the door was ruled from — so the SET and the sentence the
// refusal quotes are sourced there rather than kept as this transport's copy.
import {
  isAcceptedFilterComparand,
  ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE,
} from '@objectstack/spec/data';
// [#7536] `$like`/`$ilike`'s pattern language, from the spec's one definition —
// the dangling-escape gate and the LIKE→GLOB translation. Shared with
// `SqlDriver`'s local emitter so this transport and its local twin cannot fork
// on what a pattern means (the fork `turso-local-remote-*` suites exist to catch).
import { hasDanglingLikeEscape, likePatternToGlobPattern } from '@objectstack/spec/data';
// The DECLARED aggregate vocabulary (#5907) — read from the spec so this
// transport's "the protocol has no such function" refusal cannot drift from what
// `AggregationNodeSchema.function` admits, nor from the local driver's twin.
import { AggregationFunction } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { nanoid } from 'nanoid';

/**
 * Default ID length for auto-generated IDs.
 */
const DEFAULT_ID_LENGTH = 16;

/**
 * Columns created unconditionally by syncSchema — skip when iterating fields.
 */
const BUILTIN_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

/**
 * Pattern for valid SQL identifiers (table and column names).
 * Prevents SQL injection in DDL statements where parameterized queries
 * are not supported (e.g. PRAGMA, CREATE TABLE, ALTER TABLE).
 */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Every filter operator `buildWhereSQL` compiles — the vocabulary this
 * transport CLAIMS to speak, and (since #1004) the exact set it accepts.
 *
 * It is the spec's `FieldOperatorsSchema` list minus `$between`, which the
 * driver lowers before the filter gets here (see {@link unsupportedOperator}),
 * plus `$icontains`, which `StringOperatorSchema` declares (#5701) and this
 * transport compiles (#5702).
 *
 * `$regex` was here until #5702 and is now RETIRED: it is not a member, so it
 * reaches {@link unsupportedOperator} and is refused with the spec's
 * prescription. Its last live producer — plugin-auth's ObjectQL adapter — was
 * flipped to `$contains` by #5710 first, which is why the refusal can land at
 * all.
 */
const SUPPORTED_FILTER_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$contains',
  '$notContains',
  '$startsWith',
  '$endsWith',
  '$icontains',
  // [#7536] The pattern pair, declared by `StringOperatorSchema` and compiled
  // here. They must be listed for the same reason `$icontains` is: this
  // transport's LOCAL twin (`TursoDriver extends SqlDriver`) compiles them, and
  // a transport that refused what its own local mode answers is the local/remote
  // fork `turso-local-remote-*` parity suites exist to prevent.
  '$like',
  '$ilike',
  '$null',
  '$exists',
] as const;

/**
 * The `$`-keys a filter NODE may carry (#5769).
 *
 * `FilterConditionSchema` declares exactly three combinators; every OTHER key
 * of a node is a FIELD NAME. Taken from `@objectstack/spec`'s own
 * `LOGICAL_OPERATORS` rather than restated here — a private copy of a shared
 * vocabulary agrees with the spec on the day it is typed and never again, which
 * is the note `driver-memory`'s `SUPPORTED_FIELD_OPERATORS` already carries.
 */
const NODE_COMBINATORS: ReadonlySet<string> = new Set<string>(LOGICAL_OPERATORS);

/**
 * The `$`-keys that are FIELD operators, i.e. legal one level DOWN (#5769).
 *
 * Used only to pick which sentence a refusal prints — never whether to refuse.
 * That distinction matters because `FILTER_OPERATORS` is a runtime allowlist
 * other packages derive enforcement from (#5701): a name added there must not
 * be able to change this transport's VERDICT on a node-position key, and here
 * it cannot — both branches of {@link RemoteTransport.undeclaredCombinator}
 * throw `INVALID_FILTER`, they differ only in the repair they suggest.
 *
 * `$icontains` is added for the same reason {@link SUPPORTED_FILTER_OPERATORS}
 * carries it: `FILTER_OPERATORS` deliberately does not list it yet (#5701
 * staged the declaration ahead of the implementations), but this transport
 * compiles it, so a caller really can misplace it. `$between` comes in with the
 * spec list even though this transport never compiles it (TursoDriver lowers it
 * first) — a misplaced `$between` is still a misplaced FIELD operator, and
 * telling its author "unknown combinator" would send them looking for the wrong
 * mistake.
 *
 * The RETIRED spellings are deliberately NOT here (#5702). A node-position
 * `$regex` is not a misplaced field operator — it is not a field operator at
 * any level any more — so it takes the "names nothing this protocol declares"
 * tail, which is the true one.
 */
const MISPLACED_FIELD_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...FILTER_OPERATORS,
  '$icontains',
  // [#7536] Staged out of `FILTER_OPERATORS` exactly like `$icontains`, and
  // compiled here exactly like it — so a node-position `$like` really is a
  // MISPLACED field operator, and must get that repair rather than "names
  // nothing this protocol declares".
  '$like',
  '$ilike',
]);

/**
 * Where the wildcard goes in a LIKE pattern: `contains` → `%v%`,
 * `starts` → `v%`, `ends` → `%v`.
 */
type LikeShape = 'contains' | 'starts' | 'ends';

/**
 * The SQL comparison each range operator compiles to. One table rather than one
 * arm apiece so the four share a single comparand-binding path (#1058) — the
 * operator is the ONLY thing that differs between them.
 */
const RANGE_SQL_OPERATOR: Record<string, string> = {
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
};

/**
 * The dialect's canonical FALSE, as a predicate (#1073).
 *
 * SQLite has no boolean literal, so the empty disjunction — `$or: []`, whose
 * boolean identity element is FALSE — is spelled as a constant comparison that
 * is false for every row. It is emitted rather than omitted because omitting it
 * says TRUE, which is the opposite answer. TRUE needs no such spelling: a WHERE
 * clause that is missing a conjunct already MEANS "no constraint".
 *
 * `$not` of a vacuously-TRUE sub-filter (`$not: {}`) is the second way to reach
 * it (#1076): `NOT TRUE` is FALSE, and FALSE has to be *written*.
 */
const SQL_FALSE = '1 = 0';

/**
 * Is this comparand the spec's cross-field marker, `{ $field: 'other_column' }`?
 *
 * Recognised only to give it a message of its own — it is refused either way
 * (see {@link RemoteTransport.uncompilableComparand}). Deliberately shallow: a
 * `$field` key is the whole marker per `FieldReferenceSchema`, and anything
 * carrying one is asking for a cross-field comparison whatever else it carries.
 */
function isFieldReference(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && '$field' in value;
}

/**
 * Is this value one `serializeComparand` binds AS A VALUE, even though `typeof`
 * calls it an object?
 *
 * The ONE list both halves of the filter path consult — the ROUTER (is this
 * field's comparand an operator map, or a value?) and the SERIALIZER (can this
 * comparand be bound?). Keeping it in one place is the whole fix for #1066: the
 * two questions had drifted, so a `Date` was "a bindable value" to
 * {@link RemoteTransport.serializeComparand} (its allow-list names it as this
 * transport's one declared object conversion) and "an operator map" to
 * `buildWhereSQL`'s routing test. Since `Object.entries(new Date())` is empty,
 * that map had no operators in it, the loop never ran, and `{ closed_at: date }`
 * compiled to a WHERE-less full table scan — the mirror of #1058's silent zero
 * rows, and worse, because the caller gets back the very rows the filter was
 * written to exclude.
 *
 * `Date` is the only entry today, matching the allow-list exactly. Adding an
 * object form there means adding it here, and the `value is Date` narrowing
 * makes the compiler say so.
 */
function isBindableObjectComparand(value: unknown): value is Date {
  return value instanceof Date;
}

/**
 * Is this field's comparand an operator map (`{ $gt: 18 }`) rather than a value?
 *
 * Every non-array object EXCEPT the value forms above — including plain objects
 * with no `$` keys, which reach the operator loop and are refused there by name
 * (#1004) rather than being quietly read as equality comparands.
 */
function isOperatorMap(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isBindableObjectComparand(value)
  );
}

/**
 * Is this a filter NODE — the record shape `$and`/`$or` elements must have?
 *
 * A plain record, i.e. `{…}` / `Object.create(null)`. Not a `Date`, not a typed
 * array, not a class instance, not an array, not `null`, not a scalar.
 *
 * The narrowness is the point (#1073). A sub-filter that compiles to no SQL is
 * read as the branch's identity element (TRUE), so "compiles to nothing" has to
 * be provable from the INPUT rather than inferred from the output. Every form
 * excluded here has own-enumerable-key behaviour that would make it compile to
 * nothing *by accident* — `Object.entries(new Date())` and
 * `Object.entries(new Uint8Array([]))` are both `[]`, which is how #1066
 * happened one level down — and "accidentally empty" read as TRUE is the full
 * table scan this fix exists to prevent. Refusing them by FORM keeps the two
 * cases apart with no guessing.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ── [#5146 / #5298] NULL-safe negation ───────────────────────────────────────
//
// The THIRD implementation of one ruling, and deliberately so. `driver-sql`
// carries it as `nullSafeNegationOperand` (a module-private function over a
// knex builder's operand) and `service-analytics`'s `read-scope-sql.ts` carries
// it a second time for the RLS read lowering; that file's header records why a
// copy was preferable to an import, and the same two reasons hold here:
//
//  1. **This module imports no driver.** Its header states it outright — "No
//     local SQLite or Knex dependency" — and `driver-sql`'s entry point pulls in
//     knex. The one exportable piece is not the emitter, it is the RULING.
//  2. **Each polarity table is matched to its OWN emitter, not copied from
//     another one.** `read-scope-sql` reads `$null`/`$exists` by truthiness
//     because its emitter writes `val ? … : …`; `driver-sql` reads them by
//     identity against `false` because its emitter does. This transport reads
//     them by identity too — see the two arms below — because that is what
//     `buildWhereSQL` emits. The invariant is the agreement of guard with
//     emitter, not the sameness of the source text.
//
// What holds the three to one answer is not their text but the shared case
// table: `FILTER_LOGIC_CASES` runs the `$ne` and `$not` rows through all eleven
// harnesses, and `turso-local-remote-null-parity.test.ts` in this package runs
// the same filters through BOTH faces of this driver — which is the divergence
// #5903 actually was.

/**
 * What one field constraint needs so its compiled SQL is TOTAL — TRUE or FALSE
 * for every row, never UNKNOWN.
 *
 * - `'none'`         — already total (`IS NULL` / `IS NOT NULL`), or a shape
 *                      this compiler refuses outright, which must keep refusing.
 * - `'requireValue'` — a NULL column does NOT satisfy it: `col IS NOT NULL AND (…)`.
 * - `'allowNull'`    — a NULL column DOES satisfy it: `col IS NULL OR (…)`.
 */
type NullGuard = 'none' | 'requireValue' | 'allowNull';

/**
 * Does a NULL column satisfy this one operator, under the semantics #5146 and
 * #5298 ruled canonical — the two-valued answer the JS backends (`driver-memory`
 * `match`, `formula` `matchesFilterCondition`) give a value that is not there?
 *
 * The default is the large positive-comparison family (`$gt`, `$in`,
 * `$contains`, `$icontains`, `$startsWith`, `$endsWith`, and any operator this
 * transport refuses outright), every member of which answers `false` for a value
 * that is not there.
 */
function nullValueSatisfiesOperator(op: string, value: unknown): boolean {
  switch (op) {
    // `$eq: null` IS the null predicate (the emitter writes `IS NULL`); any
    // other comparand is a value test a NULL column fails.
    //
    // [#6050] The `|| value === undefined` half is GONE from both arms. It was
    // correct while this transport COMPILED an undefined comparand to the null
    // predicate — the table pinned its own emitter, which is the #5298
    // invariant — and it is wrong now that the comparand is refused before
    // either runs: the emitter arms below dropped their `undefined` half in the
    // same edit, so guard and emitter still read the identical value set. This
    // is deliberately not "harmless extra tolerance": a spelling that keeps
    // answering for a value nobody ruled on is exactly what #5347 tightened out
    // of `driver-sql`'s `$null` arm, and it is what let this family diverge.
    case '$eq': return value === null;
    // Mirror image: `$ne: null` compiles to `IS NOT NULL`, which a NULL fails.
    // This is the polarity-by-COMPARAND rule #5298 is explicit about — `$ne`
    // does not get one answer because of its name.
    case '$ne': return value !== null;
    // Read by IDENTITY, matching this transport's emitter, and total over the
    // declared domain because both comparands are now refused unless boolean
    // (`$null` since #1116/#5347, `$exists` since #5903 — see
    // {@link RemoteTransport.nonBooleanExistsComparand}).
    case '$null': return value === true;
    // `$null: true` and `$exists: false` are the same question, so these two
    // arms are each other's MIRROR, not each other's copy.
    case '$exists': return value === false;
    // Negative-polarity set / substring tests hold vacuously for an absent
    // value — the #5298 half of the ruling.
    case '$nin': return true;
    // `$notContains` is the one operator the two JS backends disagree on for a
    // null-valued field (`driver-memory` answers false because `typeof null !==
    // 'string'`; `formula` answers true). `formula` is followed because
    // `driver-sql` follows it, so this transport casts no vote on a
    // disagreement that is filed elsewhere.
    case '$notContains': return true;
    default: return false;
  }
}

/** Is this operator's compiled SQL already total for a NULL column? */
function operatorIsNullTotal(op: string, value: unknown): boolean {
  switch (op) {
    // Compile to `IS NULL` / `IS NOT NULL` — two-valued by construction.
    case '$null':
    case '$exists':
      return true;
    // A null comparand makes these null PREDICATES too, not comparisons — see
    // the `$eq` / `$ne` arms of the emitter. [#6050] `undefined` dropped here
    // for the reason given on {@link nullValueSatisfiesOperator}'s twin arms:
    // it is refused upstream, so the two tables and the emitter read one set.
    case '$eq':
    case '$ne':
      return value === null;
    default:
      return false;
  }
}

/**
 * The guard one field constraint needs. A constraint is the AND of its
 * operators, so it is total when every operator is, and a NULL column satisfies
 * it only when it satisfies all of them.
 */
function nullGuardForFieldSpec(spec: unknown): NullGuard {
  // `{ field: null }` compiles to `IS NULL` — already total.
  //
  // [#6050] `undefined` no longer shares this arm. The old comment's reasoning
  // ("this transport's field arm reads it as the null predicate, and a guard
  // classified from another emitter's reading would contradict what this one
  // emits") was right about the invariant and has simply run out of subject:
  // the field arm no longer reads it as anything, because
  // {@link RemoteTransport.assertDefinedComparands} refuses it before this
  // classification runs.
  if (spec === null) return 'none';
  // A scalar / Date is an implicit `=`; a NULL column fails it. A bare array is
  // REFUSED by `serializeComparand`; classifying it here keeps that refusal
  // reachable — the unrewritten `{field: […]}` conjunct still throws its own
  // message.
  if (typeof spec !== 'object' || isBindableObjectComparand(spec) || Array.isArray(spec)) return 'requireValue';
  const entries = Object.entries(spec as Record<string, unknown>);
  // `{ field: {} }` is refused by {@link RemoteTransport.emptyFieldFilter} and a
  // non-`$` key by {@link RemoteTransport.unsupportedOperator}. Passing them
  // through unrewritten is what preserves the exact message; wrapping them in a
  // guard would only change which error the caller reads.
  if (entries.length === 0) return 'none';
  let total = true;
  let nullSatisfies = true;
  for (const [op, value] of entries) {
    if (!operatorIsNullTotal(op, value)) total = false;
    if (!nullValueSatisfiesOperator(op, value)) nullSatisfies = false;
  }
  if (total) return 'none';
  return nullSatisfies ? 'allowNull' : 'requireValue';
}

/**
 * [#5146] Rewrite the operand of a `$not` so every leaf compiles to a TOTAL
 * predicate — which is what makes `NOT (…)` mean here what it means in
 * `driver-memory`, `formula`, `driver-sql` (since #5296) and this driver's own
 * LOCAL transport.
 *
 * # The defect
 *
 * SQL is three-valued: `NULL = 'won'` is UNKNOWN, `NOT UNKNOWN` is still
 * UNKNOWN, and a `WHERE` keeps only TRUE — so `{ $not: { stage: 'won' } }`
 * dropped every row whose `stage` is NULL. Measured on `origin/main`
 * (2026-08-06) against the shared fixture: LOCAL answered `['2','3','4']` and
 * REMOTE `['2']`, for one filter whose only difference was the `url` it was sent
 * to. On a CEL `!expr` read scope lowered by `cel-to-filter.ts` that is not a
 * count that differs — it is the SAME permission rule admitting a different set
 * of rows per connection mode.
 *
 * # Why the guard rides the LEAF, not the `NOT`
 *
 * For a flat operand `NOT (a IS NOT NULL AND a = ?)` and `NOT (a = ?) OR a IS
 * NULL` are the same predicate. They stop being the same as soon as the operand
 * nests: hoisting the guard above a `$not` whose operand is a `$or` re-admits
 * rows the JS backends exclude — a NULL `a` would satisfy the whole negation
 * even when the `$or`'s OTHER branch is satisfied. Totalising each leaf makes
 * the rewrite compositional instead: De Morgan is sound over two-valued leaves,
 * so `$and`, `$or` and a nested `$not` all stay correct with no special cases.
 *
 * # Why polarity is per operator
 *
 * A blanket `OR col IS NULL` would WIDEN the negative-polarity operators:
 * `{ $not: { a: { $ne: 5 } } }` means "a is 5", and both JS backends exclude a
 * NULL row from it. Adding an unconditional null escape there would hand back
 * exactly the rows the filter excludes. So each leaf is guarded in the direction
 * its OWN operator answers, per {@link nullValueSatisfiesOperator}.
 *
 * # Why it is expressed as a filter TREE, not as SQL
 *
 * The guards are emitted as ordinary `$null` constraints inside `$and` / `$or`
 * nodes and handed back to {@link RemoteTransport.buildWhereSQL}, so every
 * parenthesis is the one that compiler already writes for a combinator. This
 * transport joins a node's keys with a bare ` AND `; a hand-built `col IS NULL
 * OR …` spliced into that list would bind LOOSER than the AND and silently widen
 * the whole filter — the trap #5298's own driver-side twin records. Compiling
 * the guard as structure makes that unrepresentable.
 *
 * A non-node `$and` / `$or` element is passed through untouched so
 * {@link RemoteTransport.buildSubFilterSQL} still refuses it by name (#1073),
 * and a nested `$not` is left alone because its own branch totalises its
 * operand — `NOT <total>` is itself total, so recursing would stack a redundant
 * guard on the same column.
 */
function nullSafeNegationOperand(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const guarded: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      out[key] = value.map((element) =>
        isFilterNode(element) ? nullSafeNegationOperand(element) : element,
      );
      continue;
    }
    if (key.startsWith('$')) {
      // `$not` (totalised by its own branch) and anything else `$`-prefixed keep
      // whatever this transport does with them today — the rewrite rules on
      // NULL, not on the operator vocabulary, and an undeclared combinator must
      // still reach the #5769 gate that refuses it.
      out[key] = value;
      continue;
    }
    const guard = nullGuardForFieldSpec(value);
    if (guard === 'none') {
      out[key] = value;
    } else if (guard === 'requireValue') {
      // `col IS NOT NULL AND (…)` — both conjuncts of the enclosing node.
      guarded.push({ [key]: { $null: false } }, { [key]: value });
    } else {
      // `col IS NULL OR (…)` — ONE conjunct, so the OR binds tighter than the
      // AND this node's keys form.
      guarded.push({ $or: [{ [key]: { $null: true } }, { [key]: value }] });
    }
  }
  if (guarded.length > 0) {
    const existing = Array.isArray(out.$and) ? out.$and : [];
    out.$and = [...existing, ...guarded];
  }
  return out;
}

/** How long a refused comparand may be echoed back in an error message. */
const COMPARAND_PREVIEW_LIMIT = 120;

/**
 * The refused comparand, as written, for the error message — truncated, because
 * a filter value can be arbitrarily large and an error is read in a log.
 */
function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    // Cyclic or otherwise unserialisable — the shape is what matters here.
    text = Object.prototype.toString.call(value);
  }
  return text.length > COMPARAND_PREVIEW_LIMIT ? `${text.slice(0, COMPARAND_PREVIEW_LIMIT)}…` : text;
}

/** A human name for the refused comparand's FORM (`an array`, `an object`, …). */
function describeValue(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return 'a binary buffer';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/**
 * A filter this transport refuses to COMPILE, in the ADR-0112 envelope (#1116).
 *
 * Every refusal below — #1004's unknown operator, #1058's unbindable comparand,
 * #1066/#1071's empty operator map, #1073/#1076's non-node sub-filter, #1075's
 * non-node top-level `where`, and now #1116's non-boolean `$null` — describes
 * the SAME condition: the caller sent a filter this transport cannot compile.
 * Each of them threw a bare `Error`, so `code` and `status` were `undefined`
 * and the wire identity of the refusal was carried by ENGLISH PROSE alone.
 *
 * That is the gap this closes. `mapDataError` reads `error.code` / `error.status`
 * to build the response envelope; with neither set, these fell through to its
 * default branch and shipped `{ "error": "<message>" }` with no `code` at all —
 * while the framework twins that refuse the very same shapes (`driver-sql`,
 * `driver-sqlite-wasm`, `driver-memory`, `driver-mongodb`) all speak
 * `INVALID_FILTER` / 400 (objectstack#4436, #5368). One condition answered by
 * two spellings depending on whether the driver was local or remote is the same
 * class of local/remote fork #1075/#1076/#1116 exist to close, one layer up:
 * a caller could not branch on the refusal without string-matching it, and a
 * refusal only a human reading a log can classify is not much better than a
 * wrong answer.
 *
 * `INVALID_FILTER` is the catalogued `StandardErrorCode` for the condition and
 * the one `metadata-protocol` already emits for a filter that fails to parse
 * upstream — one condition, one wire code, however the caller reached it. The
 * enum member is referenced rather than the string literal so that a rename in
 * `@objectstack/spec` breaks this build instead of silently shipping a code the
 * schema no longer knows.
 *
 * `status: 400` is the other half: it puts the rejection on `@objectstack/rest`'s
 * `isExpectedQueryRejection` list, so a client's malformed filter stops being
 * logged as an unhandled SERVER error once per request.
 *
 * The `[RemoteTransport]` prefix on the existing messages is deliberately left
 * as it is — #1116 asked for the missing `code`/`status`, and rewording six
 * shipped refusals is a separate, user-visible change. (framework dropped its
 * `[sql-driver]` prefix when it did this same work; that this transport still
 * carries one is noted in #1116 and belongs with the rest of #1077's envelope
 * pass, not here.)
 */
function invalidFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#6409] How one declared aggregate function lowers into SQL — the twin of
 * `driver-sql`'s `SqlAggregateLowering`.
 *
 * `sql` is the function NAME; `distinct` decides whether the argument list
 * carries the `DISTINCT` keyword. `count_distinct` is the first entry in the
 * vocabulary whose lowering is not a function name at all (`COUNT(DISTINCT x)`
 * puts a keyword INSIDE the argument list), which is what a table of bare names
 * had nowhere to express.
 *
 * `distinct` also decides whether a FIELD is mandatory: `COUNT(*)` is the
 * spelling `AggregationNodeSchema` allows by making `field` optional, and
 * `COUNT(DISTINCT *)` is a syntax error — see
 * {@link refuseDistinctAggregateWithoutField}.
 */
interface RemoteAggregateLowering {
  readonly sql: string;
  readonly distinct: boolean;
}

/**
 * [#5907] The aggregate functions this TRANSPORT lowers into SQL, and what each
 * becomes.
 *
 * The twin of `driver-sql`'s `SQL_AGGREGATE_FUNCTIONS`, and separate on purpose:
 * this transport is deliberately free of knex and of `SqlDriver` (see the file
 * header), so the two faces state their own capability and the refusals below
 * read it off the table instead of a hand-kept list (#5345). They compile the
 * same six today; a face that gains one says so here, alone.
 *
 * [#6409] `count_distinct` joined both tables in one change, and it had to: the
 * two faces are chosen by `url` on ONE driver, so a lowering that landed on one
 * of them would be the #6203 shape again — one query, two answers, decided by a
 * connection string. That the tables agree is no longer asserted by reading them
 * side by side either; `AGGREGATION_CASES` runs the same aggregations through
 * both and compares the VALUES.
 */
const REMOTE_AGGREGATE_FUNCTIONS: ReadonlyMap<string, RemoteAggregateLowering> = new Map([
  ['count', { sql: 'count', distinct: false }],
  ['sum', { sql: 'sum', distinct: false }],
  ['avg', { sql: 'avg', distinct: false }],
  ['min', { sql: 'min', distinct: false }],
  ['max', { sql: 'max', distinct: false }],
  ['count_distinct', { sql: 'count', distinct: true }],
]);

/**
 * [#5907] The aggregate vocabulary the Query Protocol DECLARES, read from the
 * spec rather than restated — `AggregationNodeSchema.function` is this enum.
 */
const DECLARED_AGGREGATE_FUNCTIONS: readonly string[] = AggregationFunction.options;

/**
 * [#5907] Class 1 — a function name the Query Protocol does not declare.
 *
 * The twin of `driver-sql`'s `undeclaredAggregateFunctionError`, word for word,
 * and that is the point of this whole issue: the same `median` had to stop
 * meaning two different things depending on whether `url` put the caller on the
 * local driver or on this transport. #5240's rule — one condition, one wording —
 * is pinned across the two packages by
 * `remote-transport-aggregate-function-refusal.test.ts`, which compares the two
 * RUNTIME messages rather than two copies of a literal.
 *
 * `INVALID_QUERY` / 400: the caller wrote a name no backend can run, and 400
 * puts it on `@objectstack/rest`'s `isExpectedQueryRejection` list so a client
 * mistake stops being logged as an unhandled server fault. It is the code the
 * PROTOCOL DOOR already gives this condition — `metadata-protocol`'s
 * `invalidQueryError` refuses "a function outside the spec enum" on the
 * aggregations axis with `400 INVALID_QUERY` (#4254) — so the in-process caller
 * and the REST caller now read the same answer.
 */
function undeclaredAggregateFunctionError(func: string): Error {
  const err = new Error(
    `Aggregate function "${func}" is not a declared aggregate function. ` +
    `Declared functions: ${DECLARED_AGGREGATE_FUNCTIONS.join(', ')} ` +
    `(@objectstack/spec AggregationFunction). Fix the "function" key of the aggregations[] ` +
    `entry — the Query Protocol has no such function, so this is a query no backend can run, ` +
    `not a gap in this one (#5907).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  return err;
}

/**
 * [#5907] Class 2 — a DECLARED function this transport cannot compile.
 *
 * The twin of `driver-sql`'s `uncompilableAggregateFunctionError`; its docblock
 * carries the full rationale for `NOT_IMPLEMENTED` / 501 and for why the two
 * classes must not be collapsed. In one line: `count_distinct` is declared and
 * other backends compile it, so a caller who wrote it has made no mistake —
 * this is the backend's gap, and an error that says otherwise tells a dashboard
 * author to fix a query that is already right.
 *
 * `array_agg` / `string_agg` left this class at #6188, which answered the
 * question the message below points at: they were retired from
 * `AggregationFunction` rather than implemented, so they are now undeclared
 * names and answer 400. `count_distinct` took the other leg of that ruling.
 *
 * ⚠️ [#6409] **This class is now EMPTY here too, and the producer is kept for
 * the same reason the twin's is** — see `driver-sql`'s
 * `uncompilableAggregateFunctionError` for the argument in full. In one line:
 * this branch is not an unenforced declaration, it is the classifier that
 * decides which of two truths the NEXT declared-but-unlowered function gets
 * told, and deleting it makes this transport call a correctly-spelled name a
 * typo during exactly the window ADR-0049's enforce leg opens on purpose.
 * Emptiness is asserted positively by
 * `remote-transport-aggregate-function-refusal.test.ts`.
 */
function uncompilableAggregateFunctionError(func: string): Error {
  const err = new Error(
    `Aggregate function "${func}" is declared but not implemented by this backend. ` +
    `Compiled here: ${[...REMOTE_AGGREGATE_FUNCTIONS.keys()].join(', ')}. The name is spelled ` +
    `correctly and @objectstack/spec AggregationFunction declares it — this is a capability gap ` +
    `in the backend, not a mistake in the query, which is why it answers NOT_IMPLEMENTED/501 ` +
    `rather than a 400. Aggregate with a function this backend compiles; whether the declaration ` +
    `itself should stand is ADR-0049's enforce-or-remove question (#5907).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  return err;
}

/**
 * [#6409] `count_distinct` written with no `field` — the twin of `driver-sql`'s
 * {@link refuseDistinctAggregateWithoutField}, first sentence for first sentence
 * (#5240 — one condition, one wording).
 *
 * `AggregationNodeSchema` makes `field` optional because `COUNT(*)` is a real
 * spelling and the schema cannot say "optional for this function, required for
 * that one", so the node parses and arrives here asking for
 * `COUNT(DISTINCT *)` — which libsql, being SQLite, rejects as a syntax error.
 * Class 1 (`INVALID_QUERY` / 400): the function IS compiled here, it is this
 * aggregation node that is malformed, and the remedy is a key the caller adds.
 *
 * Refused before the statement is built, so a malformed aggregation costs no
 * round trip — the same rule the refusal harness in this package's tests
 * asserts for every other refusal on this path.
 */
function refuseDistinctAggregateWithoutField(func: string): never {
  const err = new Error(
    `Aggregate function "${func}" needs a "field" — there is nothing to deduplicate. ` +
    `COUNT(*) counts rows and is the spelling that takes no field; a distinct count has to name ` +
    `the column whose values are deduplicated. Add "field" to the aggregations[] entry (#6409).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  throw err;
}

/**
 * [#5907] Which refusal a name this transport cannot compile deserves — the
 * twin of `driver-sql`'s `refuseAggregateFunction`.
 *
 * `func` is the name the CALLER wrote — which, since #6203, is also the name
 * this transport looked up. Judging the caller's own spelling against the
 * case-sensitive enum is what keeps a miscased name from splitting the envelope:
 * on a lowercased name this transport would call `COUNT_DISTINCT` a capability
 * gap (501) while the local driver, reading the name raw, called it undeclared
 * (400) — one query, two wire identities.
 *
 * [#6203] The other half of that fork — the LOOKUP being case-insensitive here
 * and case-sensitive on the local driver — is now closed too, in this direction:
 * the `toLowerCase()` in {@link RemoteTransport.aggregate} is gone. Measured on
 * `origin/main` @ `d367f03d6`, before that removal:
 *
 * ```
 * COUNT   REMOTE -> RESOLVED "SELECT count(\"stage\") …"   LOCAL -> THREW INVALID_QUERY/400
 * Count   REMOTE -> RESOLVED "SELECT count(\"stage\") …"   LOCAL -> THREW INVALID_QUERY/400
 * ```
 *
 * `AggregationFunction` is a CASE-SENSITIVE `z.enum` and `COUNT` is a spelling
 * the Query Protocol never declared, so what this transport used to accept was a
 * dialect of its own — a lenient consumer, which PD#12 rejects. Both faces now
 * read only the declared lowercase spelling, and `COUNT` lands on class 1 above
 * on both.
 */
function refuseAggregateFunction(func: string): never {
  throw DECLARED_AGGREGATE_FUNCTIONS.includes(func)
    ? uncompilableAggregateFunctionError(func)
    : undeclaredAggregateFunctionError(func);
}

/**
 * [#6212] A `groupBy` entry asks for a date BUCKET — the twin of `driver-sql`'s
 * `refuseDateBucketedGroupBy`, first sentence for first sentence, and the same
 * NOT_IMPLEMENTED/501 class for the same reason: `DateGranularity` declares the
 * name, this backend cannot emit it, so it is a capability gap rather than a
 * mistake in the query (#5907, ADR-0112).
 *
 * This transport buckets NOTHING natively, which is exactly what `TursoDriver`
 * publishes for it — `supports.queryDateGranularity` is `{}` in remote mode (see
 * the comment there), so the engine buckets every granularity in memory and
 * never pushes a bucketed item down here. The refusal therefore only fires for a
 * caller that went around the capability bit and reached this transport
 * directly, which is the caller this message is written for.
 *
 * Before #6212 there was no refusal at all: `groupBy` was read as `string[]`,
 * a structured item was interpolated as `"[object Object]"` and died in
 * {@link RemoteTransport.assertSafeIdentifier} — a SQL-injection message for a
 * capability question.
 */
function refuseDateBucketedGroupBy(granularity: string): never {
  const err = new Error(
    `Date bucketing by '${granularity}' is not supported by this backend. ` +
    `Bucketed here: none (Turso remote transport). ` +
    `The query is spelled correctly and @objectstack/spec DateGranularity declares it — this is ` +
    `a capability gap in the backend, not a mistake in the query, which is why it answers ` +
    `NOT_IMPLEMENTED/501 rather than a 400. A driver publishes the granularities it buckets ` +
    `natively as \`supports.queryDateGranularity\`; the engine reads that record and buckets ` +
    `in memory for every granularity absent from it, which is always correct (#6212).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

/**
 * How a filtered column must be READ so it is in the same storage form the
 * comparand was coerced into — the column half of the driver's temporal seam
 * (`SqlDriver.temporalFilterColumnSql`), injected by TursoDriver.
 *
 * Takes the already-quoted column reference this transport was going to emit
 * and returns the SQL to emit instead. Returning it unchanged is the answer for
 * every column whose stored form already matches the comparand.
 */
export type FilterColumnSqlResolver = (
  object: string,
  field: string,
  columnSql: string,
) => string;

/**
 * Remote transport that executes all queries via @libsql/client.
 *
 * Handles SQL generation, filter compilation, and result mapping for
 * remote-only Turso connections. Designed to be used as a delegate
 * inside TursoDriver — not exposed directly to users.
 */
export class RemoteTransport {
  private client: Client | null = null;

  /**
   * Factory function for lazy (re)connection.
   *
   * When set, `ensureConnected()` will invoke this factory to create a
   * @libsql/client instance on-demand — recovering from cold-start failures,
   * transient network errors, or serverless recycling without requiring the
   * caller to explicitly call `connect()` again.
   */
  private connectFactory: (() => Promise<Client>) | null = null;

  /**
   * Tracks whether a lazy-connect attempt is already in progress to prevent
   * concurrent reconnection storms under high concurrency.
   */
  private connectPromise: Promise<Client> | null = null;

  /**
   * The driver's storage-form rule for a filtered column — see
   * {@link setFilterColumnSql}. Absent (the default) means "the plain
   * identifier is already correct", which is what every non-temporal column
   * and every backfilled one resolves to anyway.
   */
  private filterColumnSql: FilterColumnSqlResolver | null = null;

  /**
   * Set the @libsql/client instance used for all queries.
   */
  setClient(client: Client): void {
    this.client = client;
  }

  /**
   * Register a factory function for lazy (re)connection.
   *
   * TursoDriver calls this during construction so that the transport can
   * self-heal when the initial `connect()` call fails or when the client
   * becomes unavailable (e.g., serverless cold-start, transient error).
   */
  setConnectFactory(factory: () => Promise<Client>): void {
    this.connectFactory = factory;
  }

  /**
   * Register the driver's rule for reading a filtered column in the same
   * storage form the comparand was coerced into.
   *
   * The comparand half of that pair already goes through the driver
   * (`temporalFilterValue`, applied in `TursoDriver.toRemoteFilter` before the
   * filter reaches this class). Its own docs say coercing the value is
   * "necessary but NOT sufficient — a caller that binds `temporalFilterValue`
   * must wrap its column with this too, or it keeps half the bug": a column
   * that still holds PRE-convention values (a zone-naive `datetime('now')`
   * default, an offset-bearing string, a full ISO timestamp in a `Field.time`
   * column) only compares correctly once the column is read through the
   * driver's repair expression.
   *
   * This transport does not decide when that applies — it asks. Keeping the
   * rule on the driver side is the point of ADR-0053 D-A1: one dialect-aware
   * implementation, never a second one re-derived from the value's shape.
   */
  setFilterColumnSql(resolver: FilterColumnSqlResolver): void {
    this.filterColumnSql = resolver;
  }

  /**
   * Get the current @libsql/client instance.
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Close the client and release resources.
   */
  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  // ===================================
  // Health Check
  // ===================================

  async checkHealth(): Promise<boolean> {
    try {
      const client = await this.ensureConnected();
      await client.execute('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ===================================
  // Raw Execution
  // ===================================

  async execute(command: unknown, params?: unknown[]): Promise<unknown> {
    await this.ensureConnected();
    if (typeof command !== 'string') return command;

    const stmt: InStatement = params && params.length > 0
      ? { sql: command, args: params as any[] }
      : command;

    const result = await this.client!.execute(stmt);
    return result.rows;
  }

  // ===================================
  // CRUD Operations
  // ===================================

  async find(object: string, query: any): Promise<Record<string, unknown>[]> {
    await this.ensureConnected();

    const { sql, args } = this.buildSelectSQL(object, query);

    try {
      const result = await this.client!.execute({ sql, args });
      return this.mapRows(result);
    } catch (error: any) {
      const isUnknownColumn =
        error.message &&
        (error.message.includes('no such column') ||
          (error.message.includes('column') && error.message.includes('does not exist')));
      if (isUnknownColumn) {
        // A `$select` projection naming a column the table lacks (e.g. a
        // generic list view auto-requesting status/due_date/image on an object
        // without them) makes the WHOLE query fail. Swallowing that into an
        // empty result — the old behavior — reads to the UI as "no records
        // exist" even though the rows are there: a silent data-loss footgun
        // that left published AI-built apps looking empty. When the failure
        // came from the projection, retry once selecting all columns so the
        // real rows still come back; the unknown field is simply absent from
        // each row (it never existed). Mirrors the SqlDriver backstop — the
        // remote Turso path overrides find(), so it needs its own copy.
        if (query?.fields && Array.isArray(query.fields) && query.fields.length > 0) {
          try {
            const fallback = this.buildSelectSQL(object, { ...query, fields: undefined });
            const result = await this.client!.execute({ sql: fallback.sql, args: fallback.args });
            return this.mapRows(result);
          } catch {
            return [];
          }
        }
        return [];
      }
      throw error;
    }
  }

  /**
   * An id lookup is spelled as the query it is: `{ where: { id } }`.
   *
   * This used to carry an extra `typeof query === 'string' | 'number'` branch
   * that ran its own `WHERE id = ?`. framework#4311 removed the identical
   * undeclared branch from `SqlDriver.findOne`, which left `TursoDriver`
   * answering the SAME call two ways — remote resolved the id, local silently
   * returned `null` — a divergence no caller could see until a row went
   * missing. Neither the contract nor any caller outside these tests spelled it
   * that way, so the branch is gone here too: one driver, one spelling.
   */
  async findOne(object: string, query: any): Promise<Record<string, unknown> | null> {
    if (query && typeof query === 'object') {
      const results = await this.find(object, { ...query, limit: 1 });
      return results[0] || null;
    }

    return null;
  }

  // `findStream` retired with the contract method in spec 17.0.0
  // (objectstack#4484). It read the whole result set through `find()` before
  // yielding, so it never streamed anything either; its only caller was
  // `TursoDriver.findStream`, which went at the same time.

  /**
   * [#6212] `query` is a {@link DriverQuery}, not `any` — the same narrowing
   * `SqlDriver.aggregate` and `TursoDriver.aggregate` took, because all three are
   * one door and a caller may not be told three different things about it.
   */
  async aggregate(object: string, query: DriverQuery): Promise<Record<string, unknown>[]> {
    await this.ensureConnected();
    this.assertSafeIdentifier(object);

    const selectParts: string[] = [];

    // [#6212] `groupBy` is `GroupByNode[]` — a UNION of a bare field name and a
    // structured `{ field, dateGranularity?, alias? }` entry — so reading it as
    // `string[]` was a type assumption held up by a CAPABILITY BIT rather than by
    // the type, and only for half of the union:
    //
    // - a DATE-BUCKETED item genuinely cannot reach here through the engine,
    //   because remote mode publishes `queryDateGranularity: {}` and the engine
    //   falls back to in-memory bucketing (`TursoDriver.supports`). A caller that
    //   goes around that bit now gets {@link refuseDateBucketedGroupBy} instead
    //   of `"[object Object]"` rejected as an unsafe identifier.
    // - a PLAIN structured item (`{ field: 'region' }`, no granularity) is NOT
    //   guarded by that bit at all: objectql's aggregate dispatch treats it as
    //   supported by every driver ("plain {field} object is fine") and pushes it
    //   down. It arrived here, stringified, and died — while the LOCAL face of
    //   this same driver compiles it as a plain `GROUP BY "region"`. That is the
    //   #6203 shape again: one query, two answers, decided by a connection
    //   string. Reading `.field` converges them.
    //
    // [#6401] `alias` IS read now, and the note that used to sit here — "not
    // read, because `SqlDriver.aggregate` does not read it either" — was the
    // right call at #6212 and is discharged rather than deleted: all three SQL
    // faces read it as of #6401, so honouring it here is the convergence, not a
    // new divergence. The projected column is `alias ?? field`, matching
    // `in-memory-aggregation.ts`'s long-standing `g.alias ?? g.field`; GROUP BY
    // still keys on the FIELD, so only the column's name moves.
    const groupBy: Array<{ field: string; outKey: string }> = (
      Array.isArray(query?.groupBy) ? query.groupBy : []
    ).map((g) => {
      if (typeof g === 'string') return { field: g, outKey: g };
      if (g?.dateGranularity) refuseDateBucketedGroupBy(g.dateGranularity);
      return { field: g?.field, outKey: g?.alias ?? g?.field };
    });

    for (const { field, outKey } of groupBy) {
      this.assertSafeIdentifier(field);
      // The alias reaches the statement as a quoted identifier, so it is held
      // to the same gate as every other one — an alias is caller-supplied text
      // and `assertSafeIdentifier` is what keeps it out of the SQL grammar.
      this.assertSafeIdentifier(outKey);
      selectParts.push(outKey === field ? `"${field}"` : `"${field}" AS "${outKey}"`);
    }

    // [#6321] Was `query?.aggregations || query?.aggregate` — see the twin note
    // on `SqlDriver.aggregate`. `aggregate` is not a key the Query Protocol ever
    // declared; its only writers were the two driver packages' own fixtures.
    const aggregations = query?.aggregations || [];
    for (const agg of aggregations) {
      // [#5907] The caller's spelling is what the refusal quotes back and what
      // the declared-vocabulary check is judged against.
      //
      // [#6203] It is now also the LOOKUP KEY. This read used to be
      // `funcWritten.toLowerCase()`, which made `COUNT` compile here while the
      // local driver — same `TursoDriver`, different `url` — refused it: one
      // query, two answers, decided by a connection string. `AggregationFunction`
      // is a case-sensitive `z.enum`, so the lowercased read was accepting a
      // spelling the Query Protocol never declared; deleting it converges both
      // faces on the declared spelling rather than fossilising the dialect into
      // a second contract (PD#12). See {@link refuseAggregateFunction}.
      //
      // [#6321] The `|| agg.func` limb is gone — an undeclared spelling this
      // consumer tolerated — and so is the `|| ''` behind it, which only ever
      // fired when NEITHER key was written. Coalescing to `''` there made this
      // face quote `""` back at a caller while the local face quoted
      // `"undefined"` for the same off-contract input: one condition, two
      // wordings (#5240). `String()` stays so the quoted spelling is a string
      // whatever a JS caller put there.
      const func = String(agg.function);
      const lowering = REMOTE_AGGREGATE_FUNCTIONS.get(func);
      if (lowering === undefined) refuseAggregateFunction(func);
      const field = agg.field || '*';
      // [#6409] `COUNT(DISTINCT *)` is a syntax error, so a distinct aggregate
      // with no field is refused here rather than sent — a refused aggregation
      // must not cost a round trip, and a libsql syntax error would arrive
      // carrying this transport's own SQL instead of the caller's mistake.
      if (lowering.distinct && field === '*') refuseDistinctAggregateWithoutField(func);
      let fieldSql: string;
      if (field === '*') {
        fieldSql = '*';
      } else {
        this.assertSafeIdentifier(field);
        fieldSql = `"${field}"`;
      }
      // The default alias spells itself with the function NAME (`count_stage`)
      // while the emitted SQL uses the lowering table's VALUE, so that table is
      // what decides the statement, not a membership check beside it. Unchanged
      // by #6203: only a name already in the table reaches this line, and every
      // key there is lowercase, so the alias this produces is byte-identical to
      // the pre-#6203 one for every input that still compiles.
      //
      // [#6409] The name and the emitted SQL are no longer the same string for
      // every entry: `count_distinct` aliases itself `count_distinct_stage`
      // while emitting `count(distinct "stage")`. That the ALIAS follows the
      // declared name rather than the lowering is what keeps a caller's result
      // key predictable from their own query.
      const alias = agg.alias || `${func}_${field === '*' ? 'all' : field}`;
      this.assertSafeIdentifier(alias);
      const argSql = lowering.distinct ? `distinct ${fieldSql}` : fieldSql;
      selectParts.push(`${lowering.sql}(${argSql}) AS "${alias}"`);
    }

    if (selectParts.length === 0) selectParts.push('*');

    let sql = `SELECT ${selectParts.join(', ')} FROM "${object}"`;
    const args: any[] = [];

    const { whereClauses, args: whereArgs } = this.buildWhereSQL(object, query?.where);
    if (whereClauses) {
      sql += ` WHERE ${whereClauses}`;
      args.push(...whereArgs);
    }

    if (groupBy.length > 0) {
      // [#6401] By FIELD, never by the alias: the alias renames the projection
      // only. SQLite would happily group by the output name, which is exactly
      // the mistake that would make an aliased group silently correct here and
      // wrong on a dialect that resolves GROUP BY against the input columns.
      sql += ` GROUP BY ${groupBy.map((g) => `"${g.field}"`).join(', ')}`;
    }

    try {
      const result = await this.client!.execute({ sql, args });
      return this.mapRows(result);
    } catch (error: any) {
      if (
        error.message &&
        (error.message.includes('no such table') ||
          error.message.includes('no such column'))
      ) {
        return [];
      }
      throw error;
    }
  }

  async create(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureConnected();

    const { _id, ...rest } = data as any;
    const toInsert = { ...rest };

    if (_id !== undefined && toInsert.id === undefined) {
      toInsert.id = _id;
    } else if (toInsert.id === undefined) {
      toInsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    const columns = Object.keys(toInsert);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((col) => this.serializeValue(toInsert[col]));

    const sql = `INSERT INTO "${object}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    await this.client!.execute({ sql, args: values });

    // Fetch the inserted row to return complete record
    const result = await this.client!.execute({
      sql: `SELECT * FROM "${object}" WHERE "id" = ?`,
      args: [toInsert.id],
    });
    const rows = this.mapRows(result);
    return rows[0] || toInsert;
  }

  async update(object: string, id: string | number, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureConnected();

    const columns = Object.keys(data);
    const setClauses = columns.map((col) => `"${col}" = ?`).join(', ');
    const values = columns.map((col) => this.serializeValue(data[col]));

    const sql = `UPDATE "${object}" SET ${setClauses} WHERE "id" = ?`;
    await this.client!.execute({ sql, args: [...values, id] });

    // Fetch updated row
    const result = await this.client!.execute({
      sql: `SELECT * FROM "${object}" WHERE "id" = ?`,
      args: [id],
    });
    const rows = this.mapRows(result);
    return rows[0] || { id, ...data };
  }

  async upsert(object: string, data: Record<string, unknown>, conflictKeys?: string[]): Promise<Record<string, unknown>> {
    await this.ensureConnected();

    const { _id, ...rest } = data as any;
    const toUpsert = { ...rest };

    if (_id !== undefined && toUpsert.id === undefined) {
      toUpsert.id = _id;
    } else if (toUpsert.id === undefined) {
      toUpsert.id = nanoid(DEFAULT_ID_LENGTH);
    }

    const columns = Object.keys(toUpsert);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((col) => this.serializeValue(toUpsert[col]));
    const mergeKeys = conflictKeys && conflictKeys.length > 0 ? conflictKeys : ['id'];

    // Build ON CONFLICT ... DO UPDATE SET
    const updateCols = columns.filter((c) => !mergeKeys.includes(c));
    const updateClauses = updateCols.map((col) => `"${col}" = excluded."${col}"`).join(', ');

    let sql = `INSERT INTO "${object}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    sql += ` ON CONFLICT(${mergeKeys.map((k) => `"${k}"`).join(', ')})`;
    if (updateClauses) {
      sql += ` DO UPDATE SET ${updateClauses}`;
    } else {
      sql += ` DO NOTHING`;
    }

    await this.client!.execute({ sql, args: values });

    // Fetch the result row
    const result = await this.client!.execute({
      sql: `SELECT * FROM "${object}" WHERE "id" = ?`,
      args: [toUpsert.id],
    });
    const rows = this.mapRows(result);
    return rows[0] || toUpsert;
  }

  async delete(object: string, id: string | number): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.client!.execute({
      sql: `DELETE FROM "${object}" WHERE "id" = ?`,
      args: [id],
    });
    return result.rowsAffected > 0;
  }

  async count(object: string, query?: any): Promise<number> {
    await this.ensureConnected();

    const { whereClauses, args } = this.buildWhereSQL(object, query?.where);
    let sql = `SELECT COUNT(*) as count FROM "${object}"`;
    if (whereClauses) sql += ` WHERE ${whereClauses}`;

    const result = await this.client!.execute({ sql, args });
    if (result.rows.length > 0) {
      // Use result.columns to find the count column dynamically
      const row = result.rows[0] as any;
      const countCol = result.columns.find((c) => c.toLowerCase().includes('count'));
      return Number(countCol ? row[countCol] : row.count ?? 0);
    }
    return 0;
  }

  // ===================================
  // Bulk Operations
  // ===================================

  async bulkCreate(object: string, dataArray: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (const data of dataArray) {
      const created = await this.create(object, data);
      results.push(created);
    }
    return results;
  }

  async bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, unknown> }>): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (const { id, data } of updates) {
      const updated = await this.update(object, id, data);
      if (updated) results.push(updated);
    }
    return results;
  }

  async bulkDelete(object: string, ids: Array<string | number>): Promise<void> {
    await this.ensureConnected();
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    await this.client!.execute({
      sql: `DELETE FROM "${object}" WHERE "id" IN (${placeholders})`,
      args: ids as any[],
    });
  }

  async updateMany(object: string, query: any, data: Record<string, unknown>): Promise<number> {
    await this.ensureConnected();

    const columns = Object.keys(data);
    const setClauses = columns.map((col) => `"${col}" = ?`).join(', ');
    const setValues = columns.map((col) => this.serializeValue(data[col]));

    const { whereClauses, args: whereArgs } = this.buildWhereSQL(object, query?.where);
    let sql = `UPDATE "${object}" SET ${setClauses}`;
    if (whereClauses) sql += ` WHERE ${whereClauses}`;

    const result = await this.client!.execute({ sql, args: [...setValues, ...whereArgs] });
    return result.rowsAffected;
  }

  async deleteMany(object: string, query: any): Promise<number> {
    await this.ensureConnected();

    const { whereClauses, args } = this.buildWhereSQL(object, query?.where);
    let sql = `DELETE FROM "${object}"`;
    if (whereClauses) sql += ` WHERE ${whereClauses}`;

    const result = await this.client!.execute({ sql, args });
    return result.rowsAffected;
  }

  // ===================================
  // Transactions
  // ===================================

  async beginTransaction(): Promise<any> {
    await this.ensureConnected();
    return this.client!.transaction();
  }

  async commit(transaction: any): Promise<void> {
    await transaction.commit();
  }

  async rollback(transaction: any): Promise<void> {
    await transaction.rollback();
  }

  // ===================================
  // Schema Management
  // ===================================

  async syncSchema(object: string, schema: any): Promise<void> {
    await this.ensureConnected();

    const objectDef = schema as { name: string; fields?: Record<string, any> };
    const tableName = object;
    this.assertSafeIdentifier(tableName);

    // Check if table exists
    const checkResult = await this.client!.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      args: [tableName],
    });
    const exists = checkResult.rows.length > 0;

    if (!exists) {
      await this.client!.execute(this.buildCreateTableSQL(tableName, objectDef));
    } else {
      // ALTER TABLE — add missing columns
      if (objectDef.fields) {
        const columnsResult = await this.client!.execute({
          sql: `PRAGMA table_info("${tableName}")`,
          args: [],
        });
        const existingColumns = new Set(columnsResult.rows.map((r: any) => r.name));

        for (const [name, field] of Object.entries(objectDef.fields)) {
          if (existingColumns.has(name)) continue;
          const type = (field as any).type || 'string';
          if (type === 'formula') continue; // Virtual — no column
          this.assertSafeIdentifier(name);
          const colType = this.mapFieldTypeToSQL(field);
          await this.client!.execute(`ALTER TABLE "${tableName}" ADD COLUMN "${name}" ${colType}`);
        }
      }
    }
  }

  /**
   * Batch-synchronize multiple object schemas using batched libsql calls.
   *
   * Collects all DDL statements (CREATE TABLE / ALTER TABLE ADD COLUMN)
   * for every schema and uses `client.batch()` to minimize network
   * round-trips. The process may perform up to three batch calls:
   * one to introspect existing tables, one to introspect columns for
   * existing tables, and one to apply DDL statements.
   *
   * This method does not implement an internal fallback to sequential
   * `syncSchema()`. Any fallback behavior is expected to be handled
   * by the caller if a batch operation is not supported or fails.
   */
  async syncSchemasBatch(schemas: Array<{ object: string; schema: any }>): Promise<void> {
    await this.ensureConnected();
    if (schemas.length === 0) return;

    // Validate all identifiers up-front
    for (const s of schemas) {
      this.assertSafeIdentifier(s.object);
    }

    // Phase 1: introspect all tables in one batch
    const introspectStmts: InStatement[] = schemas.map((s) => ({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      args: [s.object],
    }));
    const introspectResults = await this.client!.batch(introspectStmts, 'read');

    // Separate new tables from existing tables
    const newSchemas: Array<{ object: string; schema: any }> = [];
    const existingSchemas: Array<{ object: string; schema: any }> = [];

    for (let i = 0; i < schemas.length; i++) {
      if (introspectResults[i].rows.length > 0) {
        existingSchemas.push(schemas[i]);
      } else {
        newSchemas.push(schemas[i]);
      }
    }

    // Phase 2a: build CREATE TABLE statements for new tables
    const ddlStatements: InStatement[] = [];

    for (const { object, schema } of newSchemas) {
      const objectDef = schema as { name: string; fields?: Record<string, any> };
      ddlStatements.push(this.buildCreateTableSQL(object, objectDef));
    }

    // Phase 2b: for existing tables, introspect columns in one batch
    if (existingSchemas.length > 0) {
      const pragmaStmts: InStatement[] = existingSchemas.map((s) => ({
        sql: `PRAGMA table_info("${s.object}")`,
        args: [],
      }));
      const pragmaResults = await this.client!.batch(pragmaStmts, 'read');

      for (let i = 0; i < existingSchemas.length; i++) {
        const { object, schema } = existingSchemas[i];
        const objectDef = schema as { name: string; fields?: Record<string, any> };
        if (!objectDef.fields) continue;

        const existingColumns = new Set(pragmaResults[i].rows.map((r: any) => r.name));

        for (const [name, field] of Object.entries(objectDef.fields)) {
          if (existingColumns.has(name)) continue;
          const type = (field as any).type || 'string';
          if (type === 'formula') continue;
          this.assertSafeIdentifier(name);
          const colType = this.mapFieldTypeToSQL(field);
          ddlStatements.push(`ALTER TABLE "${object}" ADD COLUMN "${name}" ${colType}`);
        }
      }
    }

    // Phase 3: execute all DDL in a single batch
    if (ddlStatements.length > 0) {
      await this.client!.batch(ddlStatements, 'write');
    }
  }

  async dropTable(object: string): Promise<void> {
    await this.ensureConnected();
    await this.client!.execute(`DROP TABLE IF EXISTS "${object}"`);
  }

  // ===================================
  // Internal Helpers
  // ===================================

  /**
   * Ensure the @libsql/client is initialized, attempting lazy connect if a
   * factory was registered and the client is not yet available.
   *
   * Uses a singleton promise to prevent concurrent reconnection storms:
   * multiple callers that race into this method while a connect is in flight
   * will all await the same promise.
   */
  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;

    if (this.connectFactory) {
      // De-duplicate concurrent connect attempts
      if (!this.connectPromise) {
        this.connectPromise = this.connectFactory()
          .then((client) => {
            this.client = client;
            this.connectPromise = null;
            return client;
          })
          .catch((err) => {
            this.connectPromise = null;
            throw new Error(
              `RemoteTransport: lazy connect failed: ${err instanceof Error ? err.message : String(err)}`
            );
          });
      }
      return this.connectPromise;
    }

    throw new Error('RemoteTransport: @libsql/client is not initialized. Call connect() first.');
  }

  /**
   * Validate that a string is a safe SQL identifier.
   * Prevents injection in DDL where parameterized queries are unsupported.
   */
  private assertSafeIdentifier(name: string): void {
    if (!SAFE_IDENTIFIER.test(name)) {
      throw new Error(`RemoteTransport: unsafe identifier rejected: "${name}"`);
    }
  }

  /**
   * Build a CREATE TABLE SQL string for the given object definition.
   * Shared by syncSchema() and syncSchemasBatch() to avoid duplication.
   */
  private buildCreateTableSQL(tableName: string, objectDef: { fields?: Record<string, any> }): string {
    let sql = `CREATE TABLE "${tableName}" ("id" TEXT PRIMARY KEY, "created_at" TEXT DEFAULT (datetime('now')), "updated_at" TEXT DEFAULT (datetime('now'))`;

    if (objectDef.fields) {
      for (const [name, field] of Object.entries(objectDef.fields)) {
        if (BUILTIN_COLUMNS.has(name)) continue;
        const type = (field as any).type || 'string';
        if (type === 'formula') continue; // Virtual — no column
        this.assertSafeIdentifier(name);
        const colType = this.mapFieldTypeToSQL(field);
        sql += `, "${name}" ${colType}`;
      }
    }

    sql += ')';
    return sql;
  }

  /**
   * Map ObjectStack field types to SQLite column types for DDL.
   */
  private mapFieldTypeToSQL(field: any): string {
    if (field.multiple) return 'TEXT'; // JSON array stored as text

    const type = field.type || 'string';
    switch (type) {
      case 'string':
      case 'email':
      case 'url':
      case 'phone':
      case 'password':
      case 'text':
      case 'textarea':
      case 'html':
      case 'markdown':
      case 'lookup':
      case 'auto_number':
        return 'TEXT';
      case 'integer':
      case 'int':
        return 'INTEGER';
      case 'float':
      case 'number':
      case 'currency':
      case 'percent':
      case 'summary':
        return 'REAL';
      case 'boolean':
        return 'INTEGER'; // SQLite: 0/1
      case 'date':
      case 'datetime':
      case 'time':
        return 'TEXT';
      case 'json':
      case 'object':
      case 'array':
      case 'image':
      case 'file':
      case 'avatar':
      case 'location':
        return 'TEXT'; // JSON stored as text
      case 'formula':
        return ''; // Virtual — should not be created
      default:
        return 'TEXT';
    }
  }

  /**
   * Build a SELECT SQL statement from a QueryAST-like object.
   *
   * **The ORDER BY below is rendered, not decided.** `query.orderBy` is already
   * the COMPLETE sort key list by the time it gets here — caller's keys plus
   * whatever the deterministic-paging contract requires
   * (`IDataDriver.find` / objectstack#4363) — because `TursoDriver` resolves it
   * through the inherited `SqlDriver.orderKeysFor` in `toRemoteReadQuery`
   * before handing the query over. Reusing that one method is what stops this
   * driver's two transports from giving the same paged query different ordering
   * guarantees on nothing but a URL (#5653, ADR-0053 D-A1).
   *
   * So: do NOT grow a tie-breaker rule of your own in here. Besides being the
   * second copy the fix was about, this method cannot see the distinction the
   * rule turns on — {@link findOne} spells an id lookup as
   * `find(object, { ...query, limit: 1 })`, which by this point is
   * indistinguishable from page one of a walk with page size 1, and the two
   * want opposite clauses (see `toRemoteReadQuery`). An empty or absent
   * `orderBy` is likewise an ANSWER — #4363's carve-out for an unpaged
   * unordered read — and emitting no ORDER BY for it is correct.
   */
  private buildSelectSQL(object: string, query: any): { sql: string; args: any[] } {
    const fields = query.fields && Array.isArray(query.fields) && query.fields.length > 0
      ? query.fields.map((f: string) => `"${this.mapSortField(f)}"`).join(', ')
      : '*';

    let sql = `SELECT ${fields} FROM "${object}"`;
    const allArgs: any[] = [];

    // WHERE
    const { whereClauses, args: whereArgs } = this.buildWhereSQL(object, query.where);
    if (whereClauses) {
      sql += ` WHERE ${whereClauses}`;
      allArgs.push(...whereArgs);
    }

    // ORDER BY
    if (query.orderBy && Array.isArray(query.orderBy)) {
      const orderParts = query.orderBy
        .filter((item: any) => item.field)
        .map((item: any) => `"${this.mapSortField(item.field)}" ${(item.order || 'asc').toUpperCase()}`);
      if (orderParts.length > 0) {
        sql += ` ORDER BY ${orderParts.join(', ')}`;
      }
    }

    // PAGINATION
    //
    // SQLite's grammar is `LIMIT expr [OFFSET expr]` — an OFFSET cannot stand
    // alone. This compiler emitted the two clauses independently, so
    // `find(obj, { offset: N })` with no `limit` assembled `... OFFSET ?` and
    // the server answered `near "OFFSET": syntax error` — for EVERY N, not a
    // boundary value. The local transport never had it: knex synthesises the
    // no-limit sentinel, compiling `.offset(3)` to `limit ? offset ?` bound
    // `[-1, 3]` (measured). So this is the same statement knex would have
    // built, and the two transports now answer a bare offset the same way
    // instead of one working and one throwing (#6577, surfaced by the
    // `PAGINATION_ZERO_LIMIT_CASES` control that reads with an offset alone).
    //
    // `-1` is SQLite's documented "no limit", not a magic number: a negative
    // LIMIT means unbounded, which is exactly what "the caller gave no limit"
    // has to compile to once the clause is mandatory.
    if (query.limit !== undefined) {
      sql += ` LIMIT ?`;
      allArgs.push(query.limit);
    } else if (query.offset !== undefined) {
      sql += ` LIMIT ?`;
      allArgs.push(-1);
    }
    if (query.offset !== undefined) {
      sql += ` OFFSET ?`;
      allArgs.push(query.offset);
    }

    return { sql, args: allArgs };
  }

  /**
   * The SQL to put on the LEFT of a comparison for `key`.
   *
   * `column` — the raw quoted identifier — stays the answer for predicates
   * whose result cannot depend on the stored FORM (`IS NULL`) or which are
   * asked about the raw text the user typed against (`LIKE`), matching which
   * predicates SqlDriver leaves on the plain column locally. Everything that
   * compares a VALUE goes through the driver's rule.
   */
  private comparisonColumn(object: string, key: string, column: string): string {
    return this.filterColumnSql ? this.filterColumnSql(object, key, column) : column;
  }

  /**
   * Build WHERE clause from MongoDB-style filter object.
   *
   * `object` is threaded through (and into every `$and`/`$or`/`$not` sub-filter)
   * because the storage form of a column is a property of the OBJECT's field
   * metadata — the transport cannot ask the driver about a column without
   * saying which object it belongs to.
   *
   * **Invariant (#1073): an empty `whereClauses` means the filter is vacuously
   * TRUE — never "something was dropped".** That is what makes the identity
   * elements in the `$and`/`$or`/`$not` branches below safe to apply: they read
   * `''` from a sub-filter as "this branch imposes no constraint" (and `$not`
   * inverts it to FALSE), so every OTHER way of compiling to nothing has to be
   * impossible. It is, by enumeration:
   * the operator-map branch throws when its map yields zero clauses (#1071),
   * the comparand gate throws on a value it cannot bind (#1058), an unknown
   * operator throws (#1004), a sub-filter that is not a filter NODE is refused
   * by {@link buildSubFilterSQL} rather than compiled to `''`, and — since
   * #1075 — a TOP-LEVEL filter that is not a filter node is refused by the same
   * test before the loop runs. The only remaining sources of `''` are
   * genuinely-empty inputs (`{}`, `$and: []`, an `$or` with a TRUE disjunct) —
   * all of which ARE TRUE.
   *
   * Since #5769 that list is also *reachable-from* correct: an `$or` whose TRUE
   * disjunct absorbed the group used to be the one way a MALFORMED sibling
   * could still produce `''`, because its compiled clauses were discarded along
   * with the branch. The node gate at the top of the loop below refuses the
   * sibling on the way in, so `''` now means TRUE **and** every key of every
   * node was one this transport compiles.
   *
   * `path` names this node's position for a refusal message — `where` at the
   * top, `where.$or[0]` inside a disjunct. It is read by the #5769 gate ONLY;
   * every refusal that predates it keeps its own wording and its own way of
   * naming a location, so threading this parameter changes no existing message.
   */
  private buildWhereSQL(
    object: string,
    filters: any,
    path = 'where',
  ): { whereClauses: string; args: any[] } {
    // "No filter" is spelled by ABSENCE, and that is the only spelling. All
    // five call sites hand this method `query?.where` (`query.where` in
    // `buildSelectSQL`), so a caller that supplied no filter arrives as
    // `undefined`; `null` is accepted as its equivalent because that is what a
    // JSON round-trip of an absent key produces.
    if (filters === null || filters === undefined) {
      return { whereClauses: '', args: [] };
    }

    // Everything else must be a filter NODE (#1075). This test used to be a
    // `typeof filters === 'object' && !Array.isArray(filters)` guard around the
    // loop below, so any OTHER shape fell straight through it to the `return`
    // at the bottom and compiled to NO WHERE CLAUSE — the caller asked to
    // filter and silently received the unfiltered table. Measured on the
    // shipped build: `[['stage','=','won']]`, `'stage'`, `42` and `[]` each
    // produced `SELECT * FROM "deal"` with no args, and the same emptiness on
    // `deleteMany`/`updateMany` is a whole-table write.
    //
    // The bare AST array is the shape that actually arrives: `isFilterAST()`
    // refuses an operator outside `VALID_AST_OPERATORS` (8 of the canonical
    // view operators are in that position — `before`, `after`, `equals`, …), so
    // `parseFilterAST()` never converts it and the raw array is assigned to
    // `where` (framework's `sql-driver-filter-no-silent-drop`, #3948).
    //
    // Refused rather than compiled: the spec declares `where` as an OBJECT
    // (`QueryASTSchema.where: FilterConditionSchema`, itself
    // `z.record(z.string(), z.unknown()).and(…)`), so the array dialect is not
    // this transport's language, and growing a second implementation of it here
    // is exactly the divergence ADR-0053 D-A1 forbids. `driver-sql` still
    // compiles its legacy INFIX array form; on this transport that form now
    // says so out loud instead of answering a different question.
    if (!isFilterNode(filters)) {
      throw this.uncompilableWhere(object, filters);
    }

    // `{}` — the one empty that is legal. It means "no filter at all", the
    // vacuous-TRUE control of #1073/#1074, and it keeps its early return.
    // Reaching it only AFTER the node test is what stops the accidental
    // empties from borrowing its meaning: `Object.keys()` is also `[]` for
    // `new Date()`, `new Uint8Array([])` and `[]` itself, each of which used to
    // return here as "no filter" (the #1066 mistake, one level up).
    if (Object.keys(filters).length === 0) {
      return { whereClauses: '', args: [] };
    }

    // [#6050] Refuse every `undefined` comparand in the WHOLE subtree, before a
    // single clause is emitted and before the `$not` branch below rewrites its
    // operand through the polarity tables.
    //
    // The pre-walk is what makes the gate hold for `{ $not: { d: undefined } }`.
    // Compiling key-by-key would reach `nullSafeNegationOperand` — a GUARD —
    // with the undefined still in it, and #6050's whole point is that guard and
    // emitter must never get to disagree about this value. Walking first makes
    // the disagreement unreachable rather than merely repaired, and it is the
    // same discipline `driver-sql` applies with `reduceFilterNode`.
    //
    // Idempotent by construction: `$and`/`$or`/`$not` re-enter this method
    // through `buildSubFilterSQL`, so a nested node is walked more than once and
    // answers the same both times. Cheap, and cheaper than a second gate.
    this.assertDefinedComparands(object, filters, path);

    const clauses: string[] = [];
    const args: any[] = [];

    for (const [key, value] of Object.entries(filters)) {
      // [#5769] Declared = enforced, in the NODE position.
      //
      // Everything `$`-prefixed here that is not one of the three declared
      // combinators fell through to the FIELD arms below and was compiled as a
      // COLUMN of that name — the #1051/#1076 diagnostic detour, one level up
      // from where `$not` used to land. Measured on `origin/main` against three
      // rows, with a capturing client:
      //
      //   { $eq: 'won' }                 → SELECT … WHERE "$eq" = ?          → []
      //   { $where: 'return true' }      → SELECT … WHERE "$where" = ?       → []
      //   { $or: [{}, { $where: 'x' }] } → SELECT … (no WHERE at all)        → every row
      //
      // The first two are the silent empty set: SQLite's backwards-compatible
      // rule degrades a double-quoted name that resolves to no column into a
      // STRING LITERAL, so the statement compiles, runs and matches nothing —
      // and where a build disables that rule (`SQLITE_DQS=0`) `find()`'s own
      // `no such column` backstop swallows the error into `[]` anyway. Two
      // roads, one answer, and neither is distinguishable from "no rows
      // matched".
      //
      // The third is the expensive direction, and it needs no dialect quirk at
      // all: a `{}` disjunct absorbs its `$or` to TRUE, the compiled clauses are
      // discarded with it, and the statement loses its WHERE entirely. On
      // `deleteMany`/`updateMany` that is the whole table — measured, all three
      // rows updated by a filter naming none of them.
      //
      // `SqlDriver` refuses the same shape on its validation walk
      // (`reduceFilterKey`, objectstack#5348 / PR #5368), which Turso's LOCAL
      // transport inherits. This transport was the one remaining face, and the
      // fork ran the wrong way: strict locally, silent remotely, for one filter
      // whose only difference was the `url` it was sent to.
      //
      // Placed inline in this loop rather than on a separate validation walk —
      // the opposite of `SqlDriver`'s placement, for a reason particular to
      // this compiler. `SqlDriver`'s emitter is skipped wholesale by a boolean
      // identity, so an emitter-side gate there would be conditional on a
      // node's SIBLINGS. This one is not: the `$and` and `$or` branches below
      // compile EVERY element before applying their identity rule (the third
      // measurement above is that fact — `{ $where: 'x' }` was compiled, then
      // its clause thrown away), so this loop already visits every node of the
      // tree, `$or`'s TRUE-absorbing branch included. The pinning cases for
      // exactly that are in `remote-transport-node-operator-refusal.test.ts`.
      if (key.startsWith('$')) {
        if (!NODE_COMBINATORS.has(key)) {
          throw this.undeclaredCombinator(object, key, `${path}.${key}`);
        }
        // The three declared names still have to carry the shape they are
        // declared with. `{ $and: 'x' }` fell through the `Array.isArray` tests
        // below into the very same field arm — `WHERE "$and" = ?` — so leaving
        // it out would put a hole in this gate at precisely the three keys the
        // gate is defined by. `$not` takes a single operand rather than a list
        // and is refused by shape one level down, in `buildSubFilterSQL`.
        if ((key === '$and' || key === '$or') && !Array.isArray(value)) {
          throw this.nonListCombinator(object, key, value, `${path}.${key}`);
        }
      }
      if (key === '$and' && Array.isArray(value)) {
        const subClauses: string[] = [];
        const subArgs: any[] = [];
        for (const [index, sub] of value.entries()) {
          const { whereClauses: sc, args: sa } = this.buildSubFilterSQL(object, key, index, sub, path);
          // A TRUE conjunct is AND's identity element: `x AND TRUE ≡ x`, so
          // dropping it loses nothing. This is the ONE direction the old
          // "skip whatever compiled to nothing" rule happened to get right.
          if (!sc) continue;
          subClauses.push(`(${sc})`);
          subArgs.push(...sa);
        }
        if (subClauses.length > 0) {
          clauses.push(`(${subClauses.join(' AND ')})`);
          args.push(...subArgs);
        }
        // Every conjunct TRUE (`$and: []`, `$and: [{}]`) → the conjunction is
        // TRUE → emit no clause, which is exactly how TRUE is spelled in a
        // list of AND-ed clauses.
      } else if (key === '$or' && Array.isArray(value)) {
        const subClauses: string[] = [];
        const subArgs: any[] = [];
        // `TRUE OR x ≡ TRUE`: one vacuous disjunct absorbs the disjunction,
        // whatever its siblings say. Tracked rather than folded into
        // `subClauses.length` because "no disjuncts at all" is the OPPOSITE
        // truth value — which is the asymmetry #1073 is about.
        let hasTrueDisjunct = false;
        for (const [index, sub] of value.entries()) {
          const { whereClauses: sc, args: sa } = this.buildSubFilterSQL(object, key, index, sub, path);
          if (!sc) {
            hasTrueDisjunct = true;
            continue;
          }
          subClauses.push(`(${sc})`);
          subArgs.push(...sa);
        }
        if (hasTrueDisjunct) {
          // The whole disjunction is TRUE → no clause, and deliberately no
          // args either: `subArgs` belong to clauses that are not emitted, and
          // a bind list that outruns its `?`s is a different bug again.
        } else if (subClauses.length === 0) {
          // The empty disjunction. Boolean OR's identity is FALSE, so `$or:
          // []` matches ZERO rows — it does NOT mean "no filter". Compiling it
          // away (the old behaviour) turned a query that selects nothing into
          // a full table scan, and on `deleteMany`/`updateMany` into a
          // whole-table write.
          clauses.push(SQL_FALSE);
        } else {
          clauses.push(`(${subClauses.join(' OR ')})`);
          args.push(...subArgs);
        }
      } else if (key === '$not') {
        // The third logical operator the spec declares (#1076). `$not` was
        // missing here while `$and`/`$or` were handled, so it fell through to
        // the FIELD path and was read as a column literally named `$not`:
        // `{ $not: { $eq: 'won' } }` compiled to `WHERE "$not" = ?` (SQLite:
        // `no such column`), `{ $not: null }` to `WHERE "$not" IS NULL`, and
        // `{ $not: { stage: 'won' } }` threw an error naming `$not` as a
        // FIELD — sending the reader to `describe_object` to look for a
        // column that cannot exist, the #1051 diagnostic detour.
        //
        // It is not an exotic shape: `SqlDriver.applyFilterCondition` compiles
        // it with `whereNot` (framework#2704), `driver-memory` and
        // `matchesFilterCondition` both evaluate it, and CEL `!expr` in a
        // permission / RLS read scope lowers to `{ $not: {…} }`
        // (`formula/src/cel-to-filter.ts`). Without this branch the SAME scope
        // answered correctly on a local SqlDriver and failed on Turso remote.
        //
        // Deliberately NOT guarded by a value-shape test (`&& isFilterNode`):
        // a guard would send `$not: null` / `$not: 'won'` back down the field
        // path, i.e. straight back into the bug. Every `$not` is compiled
        // here, and a value that is not a filter node is refused BY NAME.
        //
        // [#5146 → #5903] NULL semantics are NO LONGER "SQL's, whatever they
        // are". This comment used to argue the opposite — `NOT ("stage" = ?)`
        // is UNKNOWN for a NULL `stage`, so that row was dropped, and remote was
        // "pinned to the family it belongs to" so local and remote SQL agreed.
        // That premise expired the day PR #5296 landed #5146 on
        // `SqlDriver.applyFilterCondition`: LOCAL mode inherits that fix
        // (`TursoDriver extends SqlDriver`), this independent compiler inherited
        // none of it, and the two faces of ONE driver started answering one
        // filter by connection mode. #5146 ruled the JS backends' two-valued
        // answer canonical — "the column has no value" does NOT satisfy the
        // negated condition, so the row IS returned.
        //
        // The rewrite totalises every leaf of the operand BEFORE it is compiled,
        // so `NOT (…)` negates a predicate that is TRUE or FALSE for every row
        // and never UNKNOWN. Only a filter NODE is rewritten: a non-node operand
        // must reach `buildSubFilterSQL` exactly as the caller wrote it, so the
        // refusal keeps naming the shape that was sent (the branch above has no
        // `isFilterNode` guard for precisely that reason).
        const operand = isFilterNode(value) ? nullSafeNegationOperand(value) : value;
        const { whereClauses: sc, args: sa } = this.buildSubFilterSQL(object, key, null, operand, path);
        if (sc) {
          clauses.push(`NOT (${sc})`);
          args.push(...sa);
        } else {
          // The inner filter imposes no constraint — it is vacuously TRUE
          // (`$not: {}`, `$not: { $and: [] }`), and `NOT TRUE` is FALSE. The
          // #1073 invariant above is what licenses reading `''` that way: it
          // can ONLY mean TRUE, never "something was dropped". Emitting no
          // clause here would say TRUE — the exact inversion of the answer.
          clauses.push(SQL_FALSE);
        }
      } else if (isOperatorMap(value)) {
        // Field-level operators: { age: { $gt: 18 } }
        const column = `"${this.mapSortField(key)}"`;
        const field = this.comparisonColumn(object, key, column);
        // How many clauses this field's map is required to produce (#1066):
        // a comparand that compiles to NOTHING is the same failure family as
        // #1004/#1058 approached from a third direction, and the loudest of
        // the three — the predicate does not match zero rows, it DISAPPEARS,
        // widening the statement to every row in the table.
        const clausesBefore = clauses.length;
        for (const [op, opValue] of Object.entries(value as Record<string, any>)) {
          switch (op) {
            case '$eq':
              // [#6050] `=== null` only. `undefined` used to share this arm and
              // compile to `IS NULL`, which is the silent half of the
              // local/remote fork this issue closes; it is refused by
              // {@link RemoteTransport.assertDefinedComparands} before the loop
              // starts, so the arm now spells exactly the comparand it serves.
              if (opValue === null) {
                clauses.push(`${column} IS NULL`);
              } else {
                const bind = this.serializeComparand(object, key, op, opValue);
                clauses.push(`${field} = ?`);
                args.push(bind);
              }
              break;
            case '$ne':
              // [#6050] `=== null` only, the mirror of the `$eq` arm above and
              // the exact spelling `driver-sql`'s `$ne` emitter now carries —
              // the two compilers of one driver agree on the value set, which
              // is what #5298's invariant asks of a deliberate copy.
              if (opValue === null) {
                // [#5298] UNCHANGED, and deliberately: `IS NOT NULL` is already
                // TOTAL, and both sides of the ruling agree a row with no value
                // does NOT have "any value". Polarity follows the COMPARAND, not
                // the operator's name — only the value COMPARISON below becomes
                // NULL-safe.
                clauses.push(`${column} IS NOT NULL`);
              } else {
                const bind = this.serializeComparand(object, key, op, opValue);
                clauses.push(this.nullSafeNegative(column, `${field} <> ?`));
                args.push(bind);
              }
              break;
            case '$gt':
            case '$gte':
            case '$lt':
            case '$lte': {
              const bind = this.serializeComparand(object, key, op, opValue);
              clauses.push(`${field} ${RANGE_SQL_OPERATOR[op]} ?`);
              args.push(bind);
              break;
            }
            // `$in` / `$nin` take the one comparand form that IS a container:
            // the array is the operator's own shape, and each ELEMENT is a
            // comparand in its own right — so the element is what must be
            // bindable. An element that is not (`$in: [{ $field: 'x' }]`)
            // degrades exactly like a scalar operator's object comparand did,
            // just one row of the IN list at a time.
            case '$in': {
              const inVals = opValue as any[];
              const binds = inVals.map((v: any, i: number) =>
                this.serializeComparand(object, key, `${op}[${i}]`, v),
              );
              clauses.push(`${field} IN (${binds.map(() => '?').join(', ')})`);
              args.push(...binds);
              break;
            }
            case '$nin': {
              const ninVals = opValue as any[];
              const binds = ninVals.map((v: any, i: number) =>
                this.serializeComparand(object, key, `${op}[${i}]`, v),
              );
              // [#5298] NULL-safe: "not among this list" holds vacuously for a
              // value that is not there, which is what every JS backend answers.
              clauses.push(
                this.nullSafeNegative(column, `${field} NOT IN (${binds.map(() => '?').join(', ')})`),
              );
              args.push(...binds);
              break;
            }
            // ── Text predicates ──────────────────────────────────────────
            // All five are asked about the raw stored text, not about an
            // instant, so they stay on the plain `column` — which is what
            // SqlDriver does with the LIKE family locally.
            //
            // Their comparand goes through the same gate (#1058) before
            // `pushLike` stringifies it: `String({ $field: 'x' })` is
            // `'[object Object]'`, so an uncompilable value here produced the
            // same valid-SQL-matching-nothing as the scalar operators did —
            // and refusing it in one family while tolerating it in the other
            // would leave the failure mode alive at a different spelling.
            case '$contains':
              this.pushLike(clauses, args, column, this.serializeComparand(object, key, op, opValue), 'contains');
              break;
            // [#5702] `$icontains` — the case-insensitive twin, and what
            // `RETIRED_FILTER_OPERATORS` prescribes in place of `$regex`. Same
            // `pushLike`, so the escape rule cannot fork between the two; the
            // fold is applied to BOTH operands (see {@link pushLike}).
            case '$icontains':
              if (typeof opValue !== 'string' || opValue === '') {
                throw this.icontainsComparand(object, key, opValue);
              }
              this.pushLike(
                clauses,
                args,
                column,
                this.serializeComparand(object, key, op, opValue),
                'contains',
                false,
                false,
                true,
              );
              break;
            case '$notContains':
              // [#5298] NULL-safe: `NOT LIKE` is UNKNOWN for a NULL column, and
              // "does not contain" is true of a value that is not there. The
              // guard is applied INSIDE `pushLike` so the LIKE family keeps its
              // single emission point.
              this.pushLike(
                clauses,
                args,
                column,
                this.serializeComparand(object, key, op, opValue),
                'contains',
                true,
                true,
              );
              break;
            case '$startsWith':
              this.pushLike(clauses, args, column, this.serializeComparand(object, key, op, opValue), 'starts');
              break;
            case '$endsWith':
              this.pushLike(clauses, args, column, this.serializeComparand(object, key, op, opValue), 'ends');
              break;
            // [#7536] `$like` / `$ilike` — the caller's OWN pattern, matched
            // against the whole value. Deliberately NOT `pushLike`: that method
            // escapes the comparand and wraps it in a shape's wildcards, which
            // is the rewrite these two operators exist to avoid. They go through
            // {@link RemoteTransport.pushLikePattern} instead, which shares the
            // spec's LIKE→GLOB translation with the local twin so both
            // transports answer one pattern language.
            case '$like':
            case '$ilike': {
              if (typeof opValue !== 'string') {
                throw this.likePatternComparand(object, key, op, opValue);
              }
              if (hasDanglingLikeEscape(opValue)) {
                throw this.danglingLikeEscape(object, key, op, opValue);
              }
              this.pushLikePattern(clauses, args, column, opValue, op === '$ilike');
              break;
            }
            // ── Existence ────────────────────────────────────────────────
            // `{ $null: true }` → IS NULL, `{ $null: false }` → IS NOT NULL;
            // `$exists` is its inverse. Both compare the presence of a value,
            // which no storage form can change, so both read the plain column
            // (same reasoning as the `$eq: null` arm above).
            case '$null':
              // A THIRD value is not a third answer (#1116). The emitter below
              // asks `opValue === false`, so every non-boolean — `'yes'`, `1`,
              // `0`, `null`, `undefined`, `{}` and the string `'false'` — fell
              // to the `NULL` side and compiled to `IS NULL`. Refused instead,
              // per objectstack#5347 / #5368; see
              // {@link nonBooleanNullComparand} for why.
              if (typeof opValue !== 'boolean') {
                throw this.nonBooleanNullComparand(object, key, opValue);
              }
              // Written as a TOTAL choice over the two booleans rather than as
              // `=== false ? … : …`. The two spell the same thing only while
              // the guard above holds; the bisecting spelling has a DEFAULT
              // side, and a default side is what silently resumed answering
              // for a third value. framework tightened its twin the same way
              // and for the same reason (objectstack#5368).
              clauses.push(`${column} IS ${opValue ? 'NULL' : 'NOT NULL'}`);
              break;
            case '$exists':
              // [#5369 → #5903] The fence this arm used to carry is DOWN. It
              // read: "deliberately NOT given the same guard — whether `exists`
              // means 'key present' or 'has a value' is #5299's open question,
              // and tightening it here ALONE would manufacture a local/remote
              // fork rather than close one." Both halves of that reasoning have
              // since been answered, in the caller's favour:
              //
              //  - #5298's four-point ruling (2026-08-06) settled the semantics
              //    on **has a value** — field existence is a property of the
              //    SCHEMA, not of a record — so `$exists` and `$null` are strict
              //    mirrors. This arm's `IS NULL` / `IS NOT NULL` was already
              //    that reading and does not move.
              //  - PR #5962 landed the non-boolean refusal on `driver-sql`, so
              //    LOCAL mode now refuses what this arm still answered. The fork
              //    the fence was protecting against EXISTS TODAY, pointing the
              //    other way: measured on `origin/main`, `{ $exists: 'yes' }`
              //    threw `INVALID_FILTER` locally and returned the valued rows
              //    remotely. Closing it is what this guard does.
              //
              // Refused for the reason `$null` is (#5347-A): `opValue === false`
              // is a BISECTION, so every non-boolean — `'yes'`, `1`, `0`, `null`,
              // `undefined`, `{}` and the string `'false'` — landed on the
              // `NOT NULL` side and answered as if `true` had been written.
              if (typeof opValue !== 'boolean') {
                throw this.nonBooleanExistsComparand(object, key, opValue);
              }
              // Left as the `=== false` identity test rather than rewritten to a
              // total two-way choice the way the `$null` arm above was. The two
              // are not the same edit: `$null`'s emitter had `true` on its
              // DEFAULT side, so a third value read as "the caller asked for
              // null"; here `false` is the value being tested FOR, and with the
              // guard holding there is no third value left for a default to
              // catch. Its polarity twin in {@link nullValueSatisfiesOperator}
              // is spelled `value === false` for exactly the same reason —
              // `$null: true` and `$exists: false` are one question asked twice.
              clauses.push(`${column} IS ${opValue === false ? 'NULL' : 'NOT NULL'}`);
              break;
            default:
              // Declared = enforced. This arm used to compile ANY unknown
              // operator to `column = ?` against its comparand — so a
              // `$startsWith` prefix, an `$exists` boolean or a typo'd
              // operator each produced valid SQL that matched nothing, which
              // reads exactly like "no rows matched" (#1004). An operator this
              // transport cannot compile is a programming error and must say
              // so.
              throw this.unsupportedOperator(object, key, op, Object.keys(value as object));
          }
        }
        if (clauses.length === clausesBefore) {
          throw this.emptyFieldFilter(object, key, value);
        }
      } else if (value === null) {
        // [#6050] `=== null` only — `{ field: undefined }` is refused by
        // {@link RemoteTransport.assertDefinedComparands} before this loop, and
        // it was THE shape the issue opened on: `{ owner_id: ctx.user?.id }`
        // with a missing id landed here and compiled `owner_id IS NULL`,
        // matching every env-wide row. `null` keeps this arm untouched.
        //
        // Null equality MUST use `IS NULL` — `col = NULL` is always UNKNOWN
        // in SQL, so it matches zero rows. Env-wide metadata (and drafts) are
        // stored with `organization_id IS NULL`; emitting `= ?` here is what
        // made every env-wide draft read come back empty even though the row
        // was written. (Knex special-cases this; this hand-rolled builder did not.)
        const column = `"${this.mapSortField(key)}"`;
        clauses.push(`${column} IS NULL`);
      } else {
        // Simple equality: { name: 'Alice' }, and every comparand that is a
        // VALUE despite being an object — today `Date` (#1066), which lands
        // here rather than in the operator-map branch above and compiles to
        // exactly what its explicit `{ $eq: date }` spelling always did.
        //
        // What can still arrive here and NOT be bindable is an array (the one
        // object form the router leaves alone, since `$in`'s array is an
        // OPERATOR's shape, not a comparand). It is no more bindable in
        // implicit-equality position than in explicit `$eq` position, so it
        // takes the same gate (#1058); a plain object was read as an operator
        // map above and a bad one already threw (#1004).
        const column = `"${this.mapSortField(key)}"`;
        const bind = this.serializeComparand(object, key, '$eq', value);
        clauses.push(`${this.comparisonColumn(object, key, column)} = ?`);
        args.push(bind);
      }
    }

    return {
      whereClauses: clauses.join(' AND '),
      args,
    };
  }

  /**
   * Append one parameterized text-match predicate for the `$contains` family
   * and `$icontains`.
   *
   * The comparand's metacharacters are escaped so it matches literally:
   * unescaped, a value of `%` expands to `%%%` and matches every row — a filter
   * bypass, and a P0 the framework already paid for
   * (`sql-driver-like-escape.test.ts`).
   *
   * # [#6518] Why this emits `GLOB`, not `LIKE`
   *
   * `$contains` / `$notContains` / `$startsWith` / `$endsWith` are
   * case-SENSITIVE by contract (#4706 Q2 = A). SQLite's `LIKE` folds ASCII case
   * unconditionally, and libSQL is SQLite — so this transport used to answer
   * `{name: {$contains: 'acme'}}` with the `ACME Corp` row too, which is
   * over-matching rather than a near miss. The fold cannot be switched off per
   * statement (`PRAGMA case_sensitive_like` is connection-global, so one query
   * would silently redefine every other query on the same connection), and
   * `CAST(col AS BLOB) LIKE ?` was measured to match NOTHING at all. `GLOB` is
   * SQLite's case-exact pattern operator and is what both SQLite faces now
   * emit — `SqlDriver.applyLike`'s `textMatchPredicate` reaches the identical
   * decision for the local transport, and `turso-local-remote-*` parity suites
   * are what hold the two to the same rows.
   *
   * The escaped character class moves WITH the operator, which is the part a
   * second implementation gets wrong: GLOB's metacharacters are `*`, `?` and
   * `[` (escaped as self-closing classes `[*]`, `[?]`, `[[]`, because GLOB has
   * no `ESCAPE` clause in SQLite's grammar), while `%` and `_` are ordinary
   * characters to it. So this method no longer emits an `ESCAPE` clause at all.
   *
   * `fold` still wraps BOTH operands, now in `lower()` around `GLOB` — folding
   * only the comparand would compare a folded needle against a raw column and
   * silently match just the rows that were already lower-case. `lower()` on
   * SQLite folds ASCII ONLY, which is the contract (#4706 Q1 = A) rather than a
   * limitation to work around: measured, `lower('CAFÉ')` is `'cafÉ'`, so
   * `$icontains: 'café'` answers the `café` row and not the `CAFÉ` one.
   *
   * This is still the ONE place the family is built, which is the point: five
   * operators sharing one escape rule cannot drift between `$contains` and
   * `$startsWith` because there is only one of it. It restates the framework's
   * rule (which lives in `SqlDriver`, whose emitter is a private module
   * function with no reusable export), so the two must be read together; the
   * row-level suite in `remote-transport-text-predicates.test.ts` is what pins
   * them to the same answers.
   */
  private pushLike(
    clauses: string[],
    args: any[],
    column: string,
    value: unknown,
    shape: LikeShape,
    negate = false,
    nullSafe = false,
    fold = false,
  ): void {
    const escaped = String(value).replace(/[*?[]/g, '[$&]');
    const pattern = shape === 'starts' ? `${escaped}*` : shape === 'ends' ? `*${escaped}` : `*${escaped}*`;
    const lhs = fold ? `lower(${column})` : column;
    const rhs = fold ? 'lower(?)' : '?';
    const predicate = `${lhs} ${negate ? 'NOT GLOB' : 'GLOB'} ${rhs}`;
    clauses.push(nullSafe ? this.nullSafeNegative(column, predicate) : predicate);
    args.push(pattern);
  }

  /**
   * [#7536] Append one parameterized `$like` / `$ilike` predicate.
   *
   * The sibling of {@link RemoteTransport.pushLike}, and a separate method for
   * the reason that one's docblock makes unavoidable: `pushLike` ESCAPES the
   * comparand's metacharacters and WRAPS it in the shape's wildcards, because
   * its operators take text. `$like` takes a pattern, so both of those steps
   * are exactly wrong here — the `%` and `_` in it are the caller's wildcards,
   * and the match is against the whole value, not a substring of it.
   *
   * `GLOB` for the same reason the sibling emits it (#6518): libSQL is SQLite,
   * SQLite's `LIKE` folds ASCII case unconditionally, and `$like` is
   * case-SENSITIVE by contract. Because GLOB speaks a different pattern
   * language, the comparand is TRANSLATED rather than escaped —
   * `likePatternToGlobPattern` is the spec's one definition of that
   * translation, shared with `SqlDriver`'s local emitter so the two transports
   * cannot answer one pattern two ways.
   *
   * `fold` wraps BOTH operands in `lower()`, the `$ilike` fold: folding only the
   * pattern would compare a folded needle against a raw column and match just
   * the rows that were already lower-case. `lower()` on SQLite folds ASCII only,
   * which IS the contract (#4706 Q1 = A) rather than a limitation.
   */
  private pushLikePattern(
    clauses: string[],
    args: any[],
    column: string,
    pattern: string,
    fold: boolean,
  ): void {
    const lhs = fold ? `lower(${column})` : column;
    const rhs = fold ? 'lower(?)' : '?';
    clauses.push(`${lhs} GLOB ${rhs}`);
    args.push(likePatternToGlobPattern(pattern));
  }

  /**
   * [#7536] The error for a `$like` / `$ilike` comparand that is not a string.
   *
   * The remote twin of `driver-sql`'s `likePatternComparandError`. Coercion is
   * worse here than for the text operators: `String({})` is `[object Object]`,
   * whose `[` OPENS a GLOB character class, so the query would run a pattern the
   * caller never wrote instead of merely comparing text they never wrote.
   */
  private likePatternComparand(object: string, field: string, op: string, value: unknown): Error {
    return invalidFilterError(
      `[RemoteTransport] Operator "${op}" on '${object}.${field}' requires a string comparand. ` +
        `Received ${typeof value} (${preview(value)}). "${op}" takes a PATTERN — "%" matches any ` +
        `sequence, "_" matches one character, a backslash escapes either — so a non-string ` +
        `comparand cannot be coerced without inventing wildcards. For a literal substring search ` +
        `write "$contains", whose comparand IS text. @objectstack/spec StringOperatorSchema ` +
        `declares ${op} as a string.`,
    );
  }

  /**
   * [#7536] The error for a `$like` / `$ilike` pattern ending in a lone
   * unpaired backslash — refused because no meaning survives every backend
   * (Postgres rejects such a pattern outright; GLOB has no escape character at
   * all). `hasDanglingLikeEscape` is the spec's shared test, so this transport
   * refuses the same patterns as its local twin and the JS faces.
   */
  private danglingLikeEscape(object: string, field: string, op: string, pattern: string): Error {
    return invalidFilterError(
      `[RemoteTransport] Operator "${op}" on '${object}.${field}' has a pattern ending in a lone ` +
        `unpaired backslash (${JSON.stringify(pattern)}). A backslash escapes the character after ` +
        `it, so a trailing one escapes nothing and the backends disagree about what it means. ` +
        `Write "\\\\\\\\" to match a literal backslash, or drop the trailing one.`,
    );
  }

  /**
   * [#5298] Wrap a negative-polarity value test so a row whose column has no
   * value SATISFIES it: `(col IS NULL OR <test>)`.
   *
   * The remote twin of `driver-sql`'s `applyNullSafeNegative` and
   * `read-scope-sql`'s `nullSafeNegative`, and the only shape all three use:
   * OR-expansion, never `IS DISTINCT FROM` / `IS NOT` / `<=>`. The three reasons
   * are recorded on the driver-side twin and every one of them applies here with
   * force — `NOT LIKE` has no such form at all, so `$notContains` would need the
   * OR shape anyway and this compiler would carry two shapes for one ruling; the
   * SQLite spelling depends on an engine version nothing pins (this transport
   * talks to whatever libSQL the remote endpoint runs, which is further outside
   * this repo's control than the local `sql.js`/`better-sqlite3` pair); and the
   * measured query plans are identical either way, because `<>`, `NOT IN` and
   * `NOT LIKE` were already full scans.
   *
   * **The parentheses are not optional.** {@link RemoteTransport.buildWhereSQL}
   * joins a node's clauses with a bare ` AND `, so an unwrapped `col IS NULL OR
   * …` would bind LOOSER than that AND: `a = ? AND b IS NULL OR b <> ?` parses as
   * `(a = ? AND b IS NULL) OR b <> ?`, which returns rows the caller's `a`
   * predicate excludes. A silently WIDENED filter is the bypass class this file
   * keeps paying for (#1004, #1058, #1073), reached from a fourth direction.
   *
   * `column` is the PLAIN quoted column, never the {@link comparisonColumn}
   * rewrite: whether a value is there is not something a storage form can
   * change, which is the same reasoning the `$null` / `$exists` arms already use.
   */
  private nullSafeNegative(column: string, test: string): string {
    return `(${column} IS NULL OR ${test})`;
  }

  /**
   * The error for a `$null` whose comparand is not a boolean (#1116).
   *
   * `@objectstack/spec`'s `FieldOperatorsSchema` declares `$null: z.boolean()`,
   * and nothing between an authored `where` and this transport validates against
   * it — so a non-boolean really does arrive here. The emitter asked
   * `opValue === false`, which is a BISECTION: `false` on one side, everything
   * else on the other. Measured on real SQLite (`makeLibsqlSqliteStub`) against
   * one row with `stage: 'won'` and one with `stage: null`:
   *
   * | filter | compiled to | rows |
   * |---|---|---|
   * | `{ $null: true }`    | `IS NULL`     | the NULL row  |
   * | `{ $null: false }`   | `IS NOT NULL` | the valued row |
   * | `{ $null: 'yes' }` / `1` / `0` / `null` / `undefined` / `{}` / `'false'` | `IS NULL` | the NULL row |
   *
   * Every third value answered as if `true` had been written. The trap in that
   * list is the STRING `'false'`: it is truthy, so the one spelling most likely
   * to arrive from a JSON round-trip or a template concatenation compiled to the
   * exact OPPOSITE of what its author meant.
   *
   * Refused rather than coerced, per the maintainer's ruling on the identical
   * shape in objectstack#5347 — landed across framework's four backends in
   * objectstack#5368. The reasoning is not "this transport picked the wrong
   * side": there is no side to pick. The backends read a non-boolean in
   * OPPOSITE directions (this transport, `driver-sql`, `driver-sqlite-wasm` and
   * Turso LOCAL said `IS NULL`; `driver-memory`'s query path and
   * `driver-mongodb` said `IS NOT NULL`; `driver-memory`'s reference matcher
   * dropped the constraint entirely and matched BOTH rows — a widening, i.e. a
   * bypass on an RLS read scope). Three answers to one declared operator, none
   * of them a rule anyone wrote down; all three are just what a two-branch
   * conditional does with a third value. So the transport stops guessing.
   *
   * Until #5368 this transport was one of two faces of the SAME `TursoDriver`
   * giving different answers to one filter depending only on whether `url` sent
   * it down the local or the remote path. This closes it from the remote side;
   * the local side inherits `SqlDriver`'s refusal the moment `.objectstack-sha`
   * moves past `9c5abf4e9`.
   *
   * The leading sentence is copied VERBATIM from the framework twins (identical
   * word-for-word across `driver-sql`, `driver-memory` and `driver-mongodb`), so
   * a caller who hits this on Turso reads the same sentence they would read on
   * Postgres. Only the location is spelled in this transport's own convention —
   * it names `'object.field'` rather than threading a `filter.…` path.
   */
  private nonBooleanNullComparand(object: string, field: string, value: unknown): Error {
    // `describeValue` calls `null` "an object" and `undefined` "a undefined" —
    // both are the two comparands most likely to arrive here, so they are named
    // outright, exactly as {@link uncompilableSubFilter} does one level up.
    const shown = value === null ? 'null' : value === undefined ? 'undefined' : describeValue(value);
    return invalidFilterError(
      `[RemoteTransport] Operator "$null" on field "${field}" requires a boolean comparand (true or ` +
        `false). Received ${shown} (${preview(value)}) at '${object}.${field}'.$null. ` +
        `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather than ` +
        `coerced because the backends read a non-boolean in OPPOSITE directions — this transport ` +
        `(with driver-sql, driver-sqlite-wasm and Turso local) compiled IS NULL (anything but false), ` +
        `driver-memory's query path and driver-mongodb compiled IS NOT NULL (anything but true), and ` +
        `driver-memory's matcher dropped the constraint entirely. Note "false" the STRING is truthy, ` +
        `so it landed on the side opposite the false it was written to mean ` +
        `(objectstack#5347, objectstack#5368, #1116).`,
    );
  }

  /**
   * [#5702] The error for an `$icontains` whose comparand is not a NON-EMPTY
   * string.
   *
   * The remote twin of `driver-sql`'s `icontainsComparandError`, and the two
   * rejections it covers are one mistake at one position:
   *
   * - **empty string** — `LOWER(col) LIKE '%%'` is TRUE of every row with a
   *   value, i.e. a predicate that constrains nothing. A dropped constraint
   *   WIDENS a result set, and on an RLS read scope that is a permission bypass
   *   rather than a degraded filter (#3948) — the widening class this file has
   *   already paid for from three other directions (#1004, #1058, #1073).
   * - **non-string** — `StringOperatorSchema` declares `$icontains: z.string()`.
   *   `pushLike` reaches its comparand through `String(value)`, so a number
   *   would compile to a text search nobody wrote.
   *
   * Guarded in the ARM rather than inside `pushLike`, because `pushLike` serves
   * the four operators whose comparand rules #1058 already settled; adding a
   * fifth rule inside it would make one method answer two different questions.
   */
  private icontainsComparand(object: string, field: string, value: unknown): Error {
    const shown = typeof value === 'string' ? 'the empty string' : describeValue(value);
    return invalidFilterError(
      `[RemoteTransport] Operator "$icontains" on '${object}.${field}' requires a NON-EMPTY string ` +
        `comparand. Received ${shown} (${preview(value)}). "$icontains" is a case-insensitive ` +
        `LITERAL substring search, so its comparand is the text to look for: an empty one matches ` +
        `every row that has a value (a predicate that constrains nothing), and a non-string one ` +
        `would be coerced into text this query never asked for. @objectstack/spec ` +
        `StringOperatorSchema declares $icontains as a string.`,
    );
  }

  /**
   * The error for an `$exists` whose comparand is not a boolean (#5369, landed
   * on this face by #5903).
   *
   * The twin of {@link nonBooleanNullComparand} one method up, and written as a
   * separate method rather than folded into a shared two-name helper on purpose:
   * each operator's message names its OWN emitter's default direction, and one
   * loop over `['$null', '$exists']` is where those two messages would start
   * drifting into one imprecise sentence.
   *
   * The leading sentence is `driver-sql`'s `nonBooleanExistsComparandError`,
   * verbatim, so a caller who hits this on Turso remote reads exactly what they
   * would read on Postgres or on Turso LOCAL. Only the location is spelled in
   * this transport's own convention — it names `'object.field'` rather than
   * threading a `filter.…` path, matching every other refusal in this file.
   *
   * Measured on `origin/main` before this gate, against the shared conformance
   * fixture (rows 1-2 valued, rows 3-4 NULL): `{ d: { $exists: v } }` for `v` in
   * `'yes'`, `1`, `0`, `null`, `{}` each returned `['1','2']` — the answer for
   * `$exists: true` — while the same five filters threw `INVALID_FILTER` on
   * LOCAL mode. Five wrong answers and one right one, chosen by `url`.
   */
  private nonBooleanExistsComparand(object: string, field: string, value: unknown): Error {
    // `describeValue` calls `null` "an object" and `undefined` "a undefined" —
    // both are among the comparands most likely to arrive here, so they are
    // named outright, exactly as the `$null` twin does.
    const shown = value === null ? 'null' : value === undefined ? 'undefined' : describeValue(value);
    return invalidFilterError(
      `[RemoteTransport] Operator "$exists" on field "${field}" requires a boolean comparand (true or ` +
        `false). Received ${shown} (${preview(value)}) at '${object}.${field}'.$exists. ` +
        `@objectstack/spec FieldOperatorsSchema declares $exists as a boolean. It is refused rather ` +
        `than coerced for the same reason $null is (objectstack#5347): a non-boolean lands on ` +
        `whichever side the backend's two-branch conditional happens to default to, and those ` +
        `defaults point in OPPOSITE directions — this transport's \`=== false\` test compiled ` +
        `IS NOT NULL for anything but false, a \`=== true\` test compiles IS NULL for anything but ` +
        `true. Note "false" the STRING is truthy, so it landed on the side opposite the false it was ` +
        `written to mean (objectstack#5369, objectstack#5903).`,
    );
  }

  /**
   * The error for an operator this transport does not compile.
   *
   * `$between` gets its own sentence because it is not missing by oversight:
   * `TursoDriver.toRemoteFieldSpec` lowers it to `$gte`/`$lte` (#1003) so the
   * calendar-day upper-bound rule is applied in exactly one place. Growing a
   * `$between` arm here would be that second implementation, silently without
   * the rule — so reaching this point means the lowering step was bypassed, and
   * saying which step it was is the whole value of the message.
   */
  private unsupportedOperator(
    object: string,
    field: string,
    op: string,
    siblings: readonly string[] = [],
  ): Error {
    const target = `'${object}.${field}'`;
    // [#5702] A RETIRED spelling is not an unknown name — it is one this
    // transport ANSWERED until #4706 retired it, so its author needs the
    // replacement rather than the vocabulary list. The prescription is the
    // spec's `RETIRED_FILTER_OPERATORS[op].why`, printed verbatim so that this
    // transport, `SqlDriver`, `driver-memory` and `driver-mongodb` say ONE
    // thing about the same retirement. Every retired SIBLING is named too:
    // `{ $regex, $options }` is one mistake with one fix.
    const retired = RETIRED_FILTER_OPERATORS[op];
    if (retired) {
      const replacement = retired.to ? ` Write "${retired.to}" instead.` : '';
      const alsoRetired = siblings.filter((key) => key !== op && RETIRED_FILTER_OPERATORS[key]);
      const also = alsoRetired.length
        ? ` The same field constraint also carries the retired ` +
          `${alsoRetired.map((key) => `"${key}"`).join(', ')} — one "${retired.to}" replaces the ` +
          `whole shape, so this is ONE mistake with ONE fix, not one per key.`
        : '';
      return invalidFilterError(
        `[RemoteTransport] Filter operator "${op}" on ${target} is RETIRED and is no longer ` +
          `compiled in remote mode.${replacement} ${retired.why}${also}`,
      );
    }
    if (op === '$between') {
      return invalidFilterError(
        `[RemoteTransport] $between on ${target} must be lowered to $gte/$lte before it reaches the ` +
          `transport — TursoDriver.toRemoteFieldSpec does that so the calendar-day upper-bound rule is ` +
          `applied exactly once (#1003). Refusing rather than compiling a second, rule-free range.`,
      );
    }
    if (!op.startsWith('$')) {
      return invalidFilterError(
        `[RemoteTransport] Filter on ${target} has an object comparand whose key "${op}" is not an ` +
          `operator. A field's filter must be a scalar (equality) or an object of $-operators ` +
          `(${SUPPORTED_FILTER_OPERATORS.join(', ')}).`,
      );
    }
    return invalidFilterError(
      `[RemoteTransport] Unsupported filter operator "${op}" on ${target} in remote mode. Supported: ` +
        `${SUPPORTED_FILTER_OPERATORS.join(', ')}. Refusing rather than compiling it to an equality — a ` +
        `silent degradation is indistinguishable from "no rows matched" (#1004).`,
    );
  }

  /**
   * The error for a `$`-key in a NODE position that is not a declared
   * combinator (#5769).
   *
   * The leading sentence is `driver-sql`'s and `driver-memory`'s, verbatim —
   * they are word-for-word identical to each other because #5240 ruled that one
   * condition speaks one wording, and this is the same condition on a third
   * backend. Only the tail differs, and it says what THIS transport used to do
   * with the key, because what it used to do is not what the others used to do:
   * they handed it to knex or to mingo, this one quoted it into SQL as a column
   * name.
   *
   * ## Two tails, one verdict
   *
   * A node-position `$eq` and a node-position `$where` are not the same
   * mistake. The first is a real operator ONE LEVEL too high — the author wrote
   * `{ $eq: 'won' }` where `{ stage: { $eq: 'won' } }` was meant, which is the
   * single most likely way to arrive here from a hand-written or AI-authored
   * filter — and the repair is to name the field. The second names nothing this
   * protocol declares at any level, and its repair is to stop using it. Telling
   * a misplaced `$eq`'s author "$eq is not a combinator" is true and useless.
   *
   * Both are refused, with the same `INVALID_FILTER` / 400 and the same first
   * sentence; only the closing direction differs. Nothing branches on the
   * distinction — see {@link MISPLACED_FIELD_OPERATORS} for why it must stay
   * that way.
   */
  private undeclaredCombinator(object: string, key: string, path: string): Error {
    const shared =
      `[RemoteTransport] Unsupported filter combinator "${key}" at ${path} on '${object}'. A filter ` +
      `node's $-prefixed keys are the declared logical operators $and, $or and $not ` +
      `(@objectstack/spec LOGICAL_OPERATORS); every other key is a field name. It is refused rather ` +
      `than compiled as a COLUMN of that name, which is what this transport used to do — SQLite ` +
      `degrades a double-quoted name that matches no column into a string literal, so the statement ` +
      `compiled, ran and matched nothing, and a caller could not tell "no rows matched" from "the ` +
      `filter never compiled"`;
    if (MISPLACED_FIELD_OPERATORS.has(key)) {
      return invalidFilterError(
        `${shared}. "${key}" IS a field operator, one level down: write ` +
          `{ <field>: { "${key}": <value> } } — e.g. { stage: { "${key}": … } } — rather than putting ` +
          `it at the condition level (objectstack#5769, objectstack#5348).`,
      );
    }
    return invalidFilterError(
      `${shared}. The Filter Protocol declares no "${key}" at any level; on a read it cost an empty ` +
        `page, and on deleteMany/updateMany the predicate is constantly false or constantly true ` +
        `depending on which side of the comparison the literal lands (objectstack#5769, ` +
        `objectstack#5348).`,
    );
  }

  /**
   * The error for `$and` / `$or` carrying something other than a list (#5769).
   *
   * Split from {@link undeclaredCombinator} because the key is not the mistake:
   * `$and` is declared, it is spelled correctly, and its VALUE is wrong. Told
   * "unsupported combinator", its author would go looking for a typo that is
   * not there.
   *
   * It belongs to #5769 all the same, because the OLD ending was identical:
   * both branches below tested `Array.isArray` before claiming the key, so a
   * non-list `$and` fell straight through them into the field arms and compiled
   * to `WHERE "$and" = ?` — measured on `origin/main`, the same silent empty set
   * as `{ $eq: 'won' }`. `SqlDriver` refuses it on its walk
   * (`assertFilterNodeList`), so local and remote now agree here too.
   *
   * The requirement sentence is `driver-sql`'s, so the two read alike.
   */
  private nonListCombinator(object: string, key: string, value: unknown, path: string): Error {
    const shown = value === null ? 'null' : value === undefined ? 'undefined' : describeValue(value);
    return invalidFilterError(
      `[RemoteTransport] Filter combinator "${key}" at ${path} on '${object}' requires an array of ` +
        `filter conditions, but received ${shown} (${preview(value)}). @objectstack/spec ` +
        `FilterConditionSchema declares "${key}" as FilterCondition[]. Refusing rather than falling ` +
        `through to the field path, which read '${key}' as a COLUMN NAME and compiled a predicate ` +
        `against a column that cannot exist (objectstack#5769).`,
    );
  }

  /**
   * Compile ONE sub-filter of a logical operator — an element of `$and` / `$or`
   * (#1073), or the whole operand of `$not` (#1076).
   *
   * The gate that gives `buildWhereSQL`'s empty return its meaning. A filter
   * NODE that compiles to no SQL is vacuously TRUE and the caller applies the
   * operator's rule to it (drop it under `$and`, absorb the group under `$or`,
   * invert it to FALSE under `$not`); ANYTHING ELSE that compiles to no SQL is a
   * shape this transport failed to compile, and must not borrow that meaning —
   * `$or: [null]` silently became `$or: []` before this, and would silently
   * become "match every row" after it, which is worse.
   *
   * So the two are separated by FORM, before compilation: a non-node operand is
   * refused here, and everything that gets past is a node whose `''` is provably
   * TRUE (see the invariant on {@link buildWhereSQL}).
   *
   * `index` is the element's position for the array operators, and `null` for
   * `$not`, which takes a single operand rather than a list.
   *
   * `path` is the ENCLOSING node's position; this method extends it with the
   * branch it is descending into, so a #5769 refusal raised further down can
   * name the disjunct it came from (`where.$or[1].$where`) rather than only the
   * key. Nothing else reads it — see {@link buildWhereSQL}.
   */
  /**
   * [#6050] Refuse every `undefined` sitting in a COMPARAND position anywhere in
   * one filter subtree.
   *
   * Ruled REFUSED on 2026-08-07 (ruling B on #6050) — the disposition #5347-A
   * gave a non-boolean `$null`, applied to the one value JavaScript cannot tell
   * apart from an absent key. Measured on `origin/main` (`cba7454df`) against
   * the shared conformance fixture, the SAME `TursoDriver` answered these two
   * ways depending only on the `url` it was constructed with:
   *
   * | filter | LOCAL (`SqlDriver`) | REMOTE (here) |
   * |---|---|---|
   * | `{ d: undefined }`             | bare knex `Undefined binding(s)` | `['3','4']` |
   * | `{ d: { $eq: undefined } }`    | bare knex `Undefined binding(s)` | `['3','4']` |
   * | `{ $not: { d: undefined } }`   | bare knex `Undefined binding(s)` | `['1','2']` |
   * | `{ $not: { d: { $ne: undefined } } }` | `[]`                      | `['3','4']` |
   * | `{ d: { $in: [undefined] } }`  | bare knex `Undefined binding(s)` | `[]` |
   *
   * This transport's half was the SILENT half, and it is the dangerous one:
   * `undefined` cannot survive a JSON round trip, so it only ever arrives from
   * in-process code — `{ owner_id: ctx.user?.id }` with a missing id compiled to
   * `owner_id IS NULL` and returned every env-wide row, which is a read the
   * caller's own filter was written to prevent.
   *
   * ⛔ `null` is untouched, in every position: `{ f: null }` / `{ $eq: null }`
   * stay `IS NULL`, `{ $ne: null }` stays `IS NOT NULL`, `$null` is unchanged.
   * `null` IS a declared comparand. `undefined` is not, and `{ f: undefined }`
   * versus `{}` — a predicate versus no constraint at all — is a distinction the
   * language does not preserve, so any compilation of it is a guess.
   *
   * The positions, enumerated rather than swept (comparand is a POSITION, not a
   * type): the direct comparand, an operator's comparand, and each MEMBER of a
   * list operator's array. `$null` / `$exists` are skipped — their comparand is
   * a declared BOOLEAN and {@link RemoteTransport.nonBooleanNullComparand} /
   * {@link RemoteTransport.nonBooleanExistsComparand} already refuse `undefined`
   * there by naming the declared domain, which is the better message for that
   * mistake and the one #5240 says must stay the only one.
   *
   * Node positions are recursed, never judged: a `$not` operand or an `$and`
   * element that is not a filter node keeps reaching its own refusal
   * ({@link RemoteTransport.uncompilableSubFilter}) with the shape the caller
   * actually sent.
   */
  private assertDefinedComparands(object: string, node: Record<string, unknown>, path: string): void {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(value)) continue;
        value.forEach((element, index) => {
          if (isFilterNode(element)) {
            this.assertDefinedComparands(object, element, `${path}.${key}[${index}]`);
          }
        });
        continue;
      }
      if (key === '$not') {
        if (isFilterNode(value)) this.assertDefinedComparands(object, value, `${path}.${key}`);
        continue;
      }
      // Any other `$`-key is an undeclared combinator, refused by name in the
      // compile loop (#5769). Leaving it alone here keeps that message.
      if (key.startsWith('$')) continue;

      const here = `${path}.${key}`;
      if (value === undefined) throw this.undefinedComparand(object, key, here);
      // `isOperatorMap` and NOT `isFilterNode`, because this must walk exactly
      // what the compile loop below ROUTES to its operator arms — a `Date` is a
      // value comparand on both tests, but a class instance is an operator map
      // to the router and not a filter node, and its entries do reach the
      // operator loop (#1066's routing seam).
      if (!isOperatorMap(value)) continue;
      for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
        if (op === '$null' || op === '$exists') continue;
        const opPath = `${here}.${op}`;
        if (opValue === undefined) throw this.undefinedComparand(object, key, opPath);
        if (!Array.isArray(opValue)) continue;
        opValue.forEach((member, index) => {
          if (member === undefined) throw this.undefinedComparand(object, key, `${opPath}[${index}]`);
        });
      }
    }
  }

  /**
   * The error for an `undefined` comparand (#6050).
   *
   * The requirement sentence is `driver-sql`'s
   * ({@link undefinedComparandError}), word for word from "Comparand at" to
   * "matched every env-wide row instead of failing" — one condition, one
   * wording, whichever transport the caller happened to reach (#5240). Only the
   * `[RemoteTransport]` prefix and the `'<object>'` qualifier are added, exactly
   * as {@link RemoteTransport.undeclaredCombinator} adds them to its own shared
   * sentence.
   */
  private undefinedComparand(object: string, field: string, path: string): Error {
    return invalidFilterError(
      `[RemoteTransport] Comparand at ${path} on '${object}' is undefined. @objectstack/spec ` +
        `FieldOperatorsSchema declares no undefined comparand, and in JavaScript ` +
        `{ "${field}": undefined } cannot be told apart from omitting the key — yet the two mean ` +
        `OPPOSITE things (a predicate versus no constraint at all), so there is no reading of it ` +
        `that is not a guess. Write null if you meant the null predicate ({ "${field}": null } or ` +
        `{ "${field}": { "$null": true } }), or omit the key when the value is genuinely absent ` +
        `(e.g. \`if (id !== undefined) where.${field} = id\`). It is refused rather than compiled ` +
        `because the backends disagreed: driver-sql handed it to knex and got a bare "Undefined ` +
        `binding(s)" Error carrying no code, while Turso's remote transport compiled it to IS NULL ` +
        `— so \`{ owner_id: ctx.user?.id }\` with a missing id silently matched every env-wide row ` +
        `instead of failing (#6050).`,
    );
  }

  private buildSubFilterSQL(
    object: string,
    branch: '$and' | '$or' | '$not',
    index: number | null,
    sub: unknown,
    path = 'where',
  ): { whereClauses: string; args: any[] } {
    if (!isFilterNode(sub)) throw this.uncompilableSubFilter(object, branch, index, sub);
    return this.buildWhereSQL(object, sub, index === null ? `${path}.${branch}` : `${path}.${branch}[${index}]`);
  }

  /**
   * The error for a logical operator's operand that is not a filter node.
   *
   * Same family as {@link emptyFieldFilter}, one level up: the old code pushed a
   * sub-clause only `if (sc)`, so a `null`, a bare string, a nested AST array or
   * a `Date` in a logical array left NO trace — the branch compiled as if that
   * element had never been written. In `$or` that silently NARROWS the result
   * (the missing disjunct's rows disappear); in `$and` it silently WIDENS it.
   * Both are "valid SQL, zero errors, wrong answer" (#1004, #1058, #1066).
   *
   * Under `$not` (#1076) the same non-node operand has a THIRD ending, and it is
   * why the branch above compiles every `$not` rather than only the well-shaped
   * ones: left to fall through, `$not: null` became `WHERE "$not" IS NULL` and
   * `$not: 'won'` became `WHERE "$not" = ?` — a predicate on a column that
   * cannot exist, reported (if at all) as a missing FIELD.
   */
  private uncompilableSubFilter(
    object: string,
    branch: '$and' | '$or' | '$not',
    index: number | null,
    sub: unknown,
  ): Error {
    const shown = sub === null ? 'null' : sub === undefined ? 'undefined' : describeValue(sub);
    const location = index === null ? branch : `${branch}[${index}]`;
    const requirement =
      branch === '$not'
        ? `$not takes exactly ONE condition, and it must be a plain object of conditions (spec ` +
          `FilterConditionSchema declares \`$not: FilterConditionSchema\`). Refusing rather than ` +
          `reading '${branch}' as a COLUMN NAME — that is the bug this branch exists to close: it ` +
          `compiled a predicate against a column that cannot exist, and named it as a field of ` +
          `'${object}' when it complained (#1051, #1076). A negation of "no condition" is written ` +
          `\`{ $not: {} }\`, which matches zero rows.`
        : `Every element of ${branch} must be a plain object of conditions (spec ` +
          `FilterConditionSchema). Refusing rather than skipping it — a dropped element leaves ` +
          `valid SQL that answers a DIFFERENT question: narrower in $or, wider in $and (#1004, ` +
          `#1058, #1066, #1073). An intentionally unconstrained branch is written \`{}\`.`;
    return invalidFilterError(
      `[RemoteTransport] ${location} on '${object}' is ${shown}, not a filter condition: ` +
        `${preview(sub)}. ${requirement}`,
    );
  }

  /**
   * The error for a TOP-LEVEL `where` that is not a filter condition (#1075).
   *
   * The same refusal as {@link uncompilableSubFilter}, one level UP — and the
   * level where the consequence is largest, because there is no surrounding
   * filter left to constrain the statement: the WHERE clause does not lose a
   * conjunct, it never exists. `find`/`count` hand back the rows the filter was
   * written to exclude, and `deleteMany`/`updateMany` run against every row in
   * the table.
   *
   * An ARRAY gets its own sentence because it is the shape that actually
   * arrives rather than a typo. `parseFilterAST()` converts a filter AST to the
   * object form ONLY when `isFilterAST()` accepts it; an operator outside
   * `VALID_AST_OPERATORS` — `before`, `after`, `equals` and five more canonical
   * view operators — makes it refuse, and the raw array is then assigned to
   * `where` unconverted (framework#3948, whose fix made `driver-sql` and
   * `driver-memory` throw on the shapes they could not compile). `driver-sql`
   * does still compile its own legacy INFIX array form, so a caller may find
   * one that works locally and throws here: that is deliberate. The spec
   * declares `where` as an object (`QueryASTSchema.where: FilterConditionSchema`
   * — `z.record(z.string(), z.unknown())` and friends), and re-implementing an
   * undeclared array dialect inside this transport would be the second,
   * drifting implementation ADR-0053 D-A1 exists to prevent. Answering out loud
   * is the repairable failure; answering with the whole table is not.
   */
  private uncompilableWhere(object: string, filters: unknown): Error {
    const requirement = Array.isArray(filters)
      ? `A query's \`where\` must be a plain object of conditions (spec QueryASTSchema declares ` +
        `\`where: FilterConditionSchema\`, a record) — this transport does not compile the filter ` +
        `AST array form. Convert it first (\`parseFilterAST\`), or write the object spelling: ` +
        `[["stage","=","won"]] is { stage: 'won' }.`
      : `A query's \`where\` must be a plain object of conditions (spec QueryASTSchema declares ` +
        `\`where: FilterConditionSchema\`, a record).`;
    return invalidFilterError(
      `[RemoteTransport] where on '${object}' is ${describeValue(filters)}, not a filter condition: ` +
        `${preview(filters)}. ${requirement} Refusing rather than compiling it to NO WHERE clause — ` +
        `a filter that vanishes WIDENS the statement to the whole table, so a read returns exactly ` +
        `the rows the filter was written to exclude and deleteMany/updateMany touch every row ` +
        `(#1004, #1058, #1066, #1073, #1075). "No filter" is written \`{}\`, or by omitting \`where\`.`,
    );
  }

  /**
   * The error for a field filter that compiles to no predicate at all.
   *
   * The third face of #1004's rule, and the one that fails OPEN. An unknown
   * operator (#1004) and an unbindable comparand (#1058) both produced valid SQL
   * that matched NOTHING; an operator map with no operators in it produces no
   * SQL — the WHERE clause loses a conjunct, and a statement missing a conjunct
   * is WIDER than the one that was asked for. On a read that is rows the caller
   * filtered out; on `deleteMany`/`updateMany` it is rows the caller never meant
   * to touch.
   *
   * `{}` is the spelling that gets here on purpose. A bare `Date` used to get
   * here by accident — `Object.entries(new Date())` is empty — which is what
   * #1066 was; that is now routed to implicit equality, so anything still
   * reaching this point genuinely carries no operator. A top-level `where: {}`
   * is a different statement ("no filter at all") and keeps its early return.
   */
  private emptyFieldFilter(object: string, field: string, value: unknown): Error {
    return invalidFilterError(
      `[RemoteTransport] Filter on '${object}.${field}' is an object comparand that compiles to NO ` +
        `predicate: ${preview(value)}. An operator map must carry at least one operator ` +
        `(${SUPPORTED_FILTER_OPERATORS.join(', ')}); to compare against a value, write the value ` +
        `itself. Refusing rather than dropping the condition — a predicate that vanishes WIDENS the ` +
        `statement to the whole table, so the caller gets back exactly the rows the filter was ` +
        `written to exclude (#1004, #1058, #1066).`,
    );
  }

  /**
   * A filter comparand in the form this transport can BIND — or an error.
   *
   * The read half of {@link serializeValue}'s job, split off because the two
   * halves want opposite answers for the same input (#1058). On the WRITE path
   * an object is a JSON column's value and `JSON.stringify` is exactly right.
   * On the FILTER path it is a value the transport cannot compile: stringifying
   * it produced valid SQL that binds the JSON TEXT of the object, and in
   * SQLite's type ordering every number sorts below every string, so
   * `"amount" > '{"$field":"budget"}'` is false for every row — zero rows, zero
   * errors, indistinguishable from "nothing matched".
   *
   * That is the failure mode #1004 already refused in the OPERATOR position
   * (`default:` above). It stayed open in the VALUE position, so the same
   * mistake threw or degraded depending only on how deeply it was nested:
   * `{ amount: { $field: 'budget' } }` threw, `{ amount: { $gt: { $field:
   * 'budget' } } }` returned an empty page. Declared = enforced applies to both
   * halves of a comparison.
   *
   * The accepted set is an ALLOW-list of what libsql binds and SQLite compares
   * meaningfully — `string` / `number` / `bigint` / `boolean` / `null`, plus
   * `Date` as the one declared conversion (→ ISO 8601, the storage form
   * `TursoDriver.toRemoteWriteForms` wrote). Everything else — plain objects,
   * arrays, `Uint8Array`, functions — is refused by name. An allow-list is the
   * point: a deny-list would silently re-admit whatever value form is invented
   * next, which is precisely how this bug survived #1004.
   *
   * The object half of that allow-list is {@link isBindableObjectComparand},
   * shared with `buildWhereSQL`'s routing test so a form cannot be a VALUE here
   * and an OPERATOR MAP there (#1066).
   */
  private serializeComparand(object: string, field: string, op: string, value: unknown): any {
    // [#6050] `undefined` no longer maps silently to a `null` bind. That
    // mapping is how `{ $gt: undefined }` became `col > NULL` (UNKNOWN for
    // every row — a filter that answers the empty page and reports nothing);
    // the comparand is refused upstream, and if one ever reached here it now
    // falls to the allow-list below and is named rather than laundered.
    if (value === null) return null;
    if (isBindableObjectComparand(value)) return value.toISOString();
    // [#7872] The remaining scalar membership (string / number / bigint /
    // boolean — null and Date answered above) is the shared door's set, asked
    // of the one predicate every face now shares instead of this transport's
    // own copy of it.
    if (isAcceptedFilterComparand(value)) return value;
    throw this.uncompilableComparand(object, field, op, value);
  }

  /**
   * The error for a comparison value this transport cannot bind.
   *
   * `{ $field: … }` gets its own sentence for the same reason `$between` does in
   * {@link unsupportedOperator}: it is not a typo but a spec-declared construct
   * (`FieldReferenceSchema`, `data/filter.zod.ts`) that asks for a cross-field
   * comparison — `amount > budget` rather than `amount > 1000`. No executor
   * cloud runs compiles it (#1051), so the repair is never "use a different
   * operator" (every one fails identically); it is to compare against a literal,
   * or to compare the two columns after the rows come back. `service-ai` refuses
   * the same shape by name at the tool boundary (#1059) — this is the same
   * refusal for every OTHER entry point (REST filters, RLS pushdown, internal
   * calls), which is why both exist.
   */
  private uncompilableComparand(object: string, field: string, op: string, value: unknown): Error {
    const target = `'${object}.${field}'`;
    const shown = `${op} ${preview(value)}`;
    if (isFieldReference(value)) {
      return invalidFilterError(
        `[RemoteTransport] Cross-field comparison is not supported in remote mode: ${target} ${shown} ` +
          `compares a column against another column instead of against a value. The query DSL declares ` +
          `this form (spec FieldReferenceSchema) but no executor compiles it, so it is refused here ` +
          `rather than bound as the marker's JSON text — which is valid SQL that matches nothing ` +
          `(#1058). Compare against a literal, or select both columns and compare after retrieval.`,
      );
    }
    return invalidFilterError(
      `[RemoteTransport] Filter comparand ${target} ${shown} is ${describeValue(value)}, which this ` +
        `transport cannot bind. A comparison value must be ` +
        `${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE}. Refusing rather than binding its JSON text ` +
        `— that compiles to valid SQL matching zero rows, which is indistinguishable from ` +
        `"no rows matched" (#1004, #1058).`,
    );
  }

  /**
   * Map camelCase field names to snake_case DB columns.
   */
  private mapSortField(field: string): string {
    if (field === 'createdAt') return 'created_at';
    if (field === 'updatedAt') return 'updated_at';
    return field;
  }

  /**
   * Serialize a WRITTEN value for @libsql/client args.
   * - `Date` → ISO 8601 string (avoids libsql HTTP transport coercing the
   *   value to a REAL column and round-tripping it as `"<epoch>.0"`).
   * - JSON objects/arrays are stringified.
   * - booleans are kept as-is (libsql handles them).
   *
   * INSERT / UPDATE / UPSERT payloads only. A comparison value goes through
   * {@link serializeComparand}, which refuses the object forms this one
   * stringifies: on the write path an object is a JSON column's value, on the
   * filter path it is a value that cannot be compiled (#1058).
   */
  private serializeValue(value: unknown): any {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * Convert a ResultSet from @libsql/client into plain Record objects.
   */
  private mapRows(result: ResultSet): Record<string, unknown>[] {
    return result.rows.map((row) => {
      const record: Record<string, unknown> = {};
      for (const col of result.columns) {
        record[col] = (row as any)[col];
      }
      return record;
    });
  }
}
