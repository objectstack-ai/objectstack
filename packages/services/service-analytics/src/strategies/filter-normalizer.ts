// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter Normalization for the Analytics Layer
 *
 * The analytics endpoint accepts filters via the canonical `where`
 * field per the unified Query DSL (`spec/data/query.zod.ts`):
 *
 *   - MongoDB-style FilterCondition: `{ field: value }` /
 *     `{ field: { $op: value } }` / `{ $and: [...] }` — defined in
 *     `spec/data/filter.zod.ts` and used by `find()`, dashboard
 *     widget `filter`, RLS, etc.
 *
 * `normalizeAnalyticsFilters` flattens the FilterCondition tree into
 * the internal array form used by the SQL/Mongo pipeline strategies.
 * Strategies stay simple — they only need to know one shape — and the
 * spec is honoured: dashboard metadata is authored once in the
 * canonical MongoDB form and the server normalizes at the boundary.
 *
 * # Coverage — a dropped predicate WIDENS the query, so nothing is dropped
 *
 * Failing to map an operator is not "not supporting" it: the predicate simply
 * disappears, the compiled SQL stays valid, and the query returns rows the
 * author excluded. It reads as a chart drawn over the whole dataset (#3650's
 * symptom) and is invisible to any test that asserts the emitted SQL string.
 * `$between`, `$startsWith`, `$endsWith` and `$null` each sat broken that way
 * (#4128), so what this maps is now a complete capability claim over
 * `filter.zod.ts`'s authorable vocabulary:
 *
 *   - mapped 1:1 — `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin`
 *     `$contains` `$notContains` `$startsWith` `$endsWith`;
 *   - value-DEPENDENT, so resolved explicitly rather than through the map —
 *     `$null` and `$exists`, whose meaning flips with their boolean;
 *   - lowered — `$between`, which becomes its two bounds so each strategy's
 *     existing upper-bound handling applies the calendar-day whole-day rule
 *     (see the note at the lowering);
 *   - structural — `$and` / `$or` / `$not`, carried as tree nodes;
 *   - anything else THROWS. An operator outside the vocabulary is a caller
 *     error, and a loud one beats a silently widened read — the call
 *     driver-memory made for the same shape in #3948.
 *
 * `$or` / `$not` were the last of that family, and they were dropped for a
 * structural reason rather than an oversight: this module produced a flat
 * ARRAY, which cannot carry a disjunction. So an author's `{$or: […]}`
 * vanished from the WHERE clause and the widget drew every row. The output is
 * now a {@link NormalizedFilterNode} tree, and each strategy compiles it the
 * way its own backend expresses a disjunction.
 *
 * # `null` is TRUE, and TRUE is a VALUE — not "nothing happened" (#5325)
 *
 * {@link buildNode} returns `null` for a condition that constrains nothing
 * (`{}`, an all-`{}` `$and`). That `null` is the boolean constant TRUE, and the
 * two places a compiler forgets it are exactly where this one used to be wrong —
 * the same two squares `read-scope-sql.ts` was wrong on (#5297), because this
 * module was written from it:
 *
 *   - TRUE is the AND identity, so dropping it from a `$and` is right — but it
 *     ABSORBS a `$or`: one TRUE disjunct makes the whole disjunction TRUE.
 *     Filtering it out (`{$or: [{}, {a: 1}]}` → `a = 1`) silently NARROWED a
 *     widget's filter to its surviving branches.
 *   - `NOT TRUE ≡ FALSE`, so `{$not: {}}` is the zero-row predicate. Producing
 *     `null` for it meant no `WHERE` was emitted at all and the widget charted
 *     the ENTIRE dataset — the #3650 / #4128 silent-widening class again.
 *
 * FALSE therefore has a spelling of its own ({@link NormalizedFilterNode}'s
 * `const` kind) instead of being representable only as silence. Every compiler
 * of this tree implements it: `native-sql-strategy.compileFilterNode`,
 * `objectql-strategy.filterNodeToCondition` and its display-SQL twin
 * `renderFilterNodeSql`.
 *
 * The EMPTY combinators complete the same boolean algebra (#5322 ruling):
 * `{$and: []}` is TRUE and `{$or: []}` is FALSE — this module used to refuse
 * both fail-closed while the five `FILTER_LOGIC_CASES` backends reduced them;
 * see the note inside {@link buildNode}'s combinator branch for the history
 * and the reasoning the ruling adopted.
 *
 * # `$not` is NULL-safe (#5146)
 *
 * SQL is three-valued and a `WHERE` keeps only TRUE, so a bare `NOT (col = ?)`
 * drops every row whose `col` is NULL — while `driver-memory`, `formula` and
 * (since #5296) `driver-sql` return those rows. One widget filter, two row sets,
 * chosen by whichever backend answered. #5146 ruled the JS answer canonical, and
 * {@link nullSafeNegationOperand} applies the same leaf-wise totalisation
 * `sql-driver.ts` and `read-scope-sql.ts` apply.
 *
 * The rewrite lives HERE rather than in `native-sql-strategy` on purpose: at
 * this layer the guard is STRUCTURE (one more `{col: {$null: false}}` conjunct),
 * not a SQL trick, so it survives `filterNodeToCondition` handing the tree to
 * the ObjectQL engine and holds on any driver behind it — including one that is
 * not NULL-safe by itself. Guarding only in the SQL strategy would make "what
 * does this widget's `$not` mean" depend on which backend caught it, which is
 * what #5146 spent a round eliminating. The cost is that the engine path can
 * guard twice (this rewrite, then `driver-sql`'s own); that is idempotent —
 * `NOT (c IS NOT NULL AND (c IS NOT NULL AND c = v))` is the same predicate —
 * so it buys portability for one redundant conjunct.
 *
 * # `$ne` / `$nin` / `$notContains` are NULL-safe too (#5298)
 *
 * Same rule, same reason, one ruling later. The operators that carry their OWN
 * negation had the defect #5146 fixed for `$not`: a bare `col <> ?` is UNKNOWN
 * for a NULL column and the `WHERE` drops the row, while the JS backends return
 * it. Measured on this package's own fixture before the fix (#5977), for
 * `{stage: {$ne: 'won'}}` over rows whose `stage` is NULL:
 *
 *   | path                                   | was       | now (= JS family) |
 *   |----------------------------------------|-----------|-------------------|
 *   | `NativeSQLStrategy` (raw SQL)          | `2`       | `2,3,4`           |
 *   | `ObjectQLStrategy` display SQL echo    | `2`       | `2,3,4`           |
 *   | `ObjectQLStrategy` → engine condition  | `2,3,4`   | `2,3,4`           |
 *
 * The engine column was already right, and that is the whole argument for
 * fixing it HERE: it was right because `driver-sql` guards for itself (#5962),
 * so the Cube face's answer depended on which compiler downstream caught the
 * leaf — three emitters, two answers. `fieldLeaves` now emits the guard as
 * STRUCTURE, an `or` of `notSet` with the comparison, so all three compile the
 * same predicate and none of them needs to know the rule. That is the same
 * trade the `$not` rewrite above took, including its cost: the engine path
 * guards twice, which is idempotent (`c IS NULL OR (c IS NULL OR c <> v)`).
 *
 * Which operators get the guard is NOT a new list — it is
 * {@link nullValueSatisfiesOperator} and {@link operatorIsNullTotal}, the same
 * pair `nullGuardForFieldSpec` consults for the `$not` rewrite, asked about one
 * operator instead of a whole field spec. A leaf is guarded exactly when a NULL
 * value SATISFIES the operator and the compiled leaf is not already total, which
 * is that pair's `allowNull` verdict. Hard-coding the three names would have put
 * a second polarity table in this file, free to drift from the first — and the
 * `$eq`/`$ne` arms of the existing one already turn on the COMPARAND (`$ne:
 * null` compiles to `set`, which is total and must never be widened), so a name
 * list would have been wrong as well as duplicated.
 *
 * # A `null` COMPARAND is a null predicate, not a value (#5332)
 *
 * `{stage: null}` compiled to `IS NULL` while `{stage: {$eq: null}}` compiled to
 * `stage = ''` — one meaning, two answers, inside this one file. The cause was
 * that the `$eq` / `$ne` pair fell through to {@link MONGO_TO_CUBE_OP} like any
 * other comparison and `stringifyForCube(null)` handed it the empty STRING, so a
 * "stage is empty" widget compared a real value against columns that are NULL
 * and charted zero rows — silently, with nothing for the author to read. On a
 * text column the `$ne` direction was worse than empty: `''` is a value rows
 * genuinely store, so "stage is not empty" EXCLUDED exactly the rows it was asked
 * to keep.
 *
 * The pair is not merely similar to `{$null: true|false}` — `driver-mongodb`
 * TRANSLATES `$null` into it — so {@link fieldLeaves} now emits the same
 * `notSet` / `set` leaves for all three spellings, and the #5146 guard table
 * moved in the same commit (see {@link nullValueSatisfiesOperator}); a guard that
 * still described the old emitter would have negated an always-false conjunction
 * and answered `{$not: {stage: {$eq: null}}}` with every row.
 *
 * # A comparand keeps its own TYPE — there is no round trip any more (#5526)
 *
 * A leaf's `values` used to be `string[]`, so every comparand was encoded to a
 * string on the way in (`stringifyForCube`) and GUESSED back into a type on the
 * way out (`recoverNumber`, behind `coerceFilterValueForSql` /
 * `coerceFilterValueForObjectQL`). An encoding whose alphabet is "all strings"
 * and whose decoder is "does this string look like a number/boolean/null" has no
 * escape, so author strings COLLIDED with the tokens the encoder wrote for other
 * types. Measured on `main` (#5526's table), for `{code: {$eq: v}}`:
 *
 *   | author's `v` | bound (SQL)    | bound (engine) |
 *   |---|---|---|
 *   | `'007'`  | `7` (#5528: fixed)  | `7` (#5528: fixed)  |
 *   | `'1.50'` | `1.5` (#5528: fixed)| `1.5` (#5528: fixed)|
 *   | `'null'` | real `NULL`         | real `null`         |
 *   | `'true'` | `1`                 | `true`              |
 *
 * Every row of that table is one defect: a TEXT column storing the author's
 * spelling stops matching. `'007'` on SQLite compares an integer against a TEXT
 * column and is never equal; on Postgres `text = integer` is a type error. The
 * `'null'` row is worse than empty — a comparison against real NULL is UNKNOWN
 * for every row, so the widget can never draw anything. Zero-padded strings,
 * `'true'`/`'false'` as enum-ish codes and `'null'` as a literal label are all
 * ordinary business shapes (order numbers, SKUs, postcodes, dialling codes).
 *
 * #5528 narrowed the number half of the decoder (canonical spelling only) as a
 * STOPGAP and said so; this is the ruled fix. `values` is now `unknown[]`: the
 * comparand the author wrote travels through the tree untouched, and no
 * stringification happens at all except where a boundary genuinely demands it:
 *
 *   - {@link toSqlBindValue} — the ONLY survivor, and it is one-way (a value →
 *     its SQL bind form), never a decoder. It exists because a SQL driver cannot
 *     bind every JS type: better-sqlite3 refuses a `boolean`, a `Date` and a
 *     plain object. Nothing about it inspects a string.
 *   - the LIKE family, whose comparand `filter.zod.ts` declares a `string`
 *     (`$contains: z.string()`), so `like-pattern.ts` stringifies at the emitter
 *     — the same `String(value)` `driver-sql`'s `applyLike` applies, which is
 *     what keeps one `$contains` meaning one thing on both faces.
 *
 * The ObjectQL path needs NO conversion at all now: the engine compares against
 * the stored runtime type, and the value it receives is the author's own.
 *
 * Two shapes changed reading as a consequence, both toward fail-closed and both
 * pinned in `filter-value-type-fidelity.test.ts`:
 *
 *   - `{name: {$contains: null}}` compiled to `LIKE '%%'` — matching EVERY
 *     non-NULL row — because `stringifyForCube(null)` was `''`. It is now
 *     `LIKE '%null%'`, which is what `driver-sql` has always compiled it to.
 *   - `{amount: {$gt: null}}` compiled to `amount > ''`, a real comparison
 *     against the empty string. It now binds NULL, so the predicate is UNKNOWN
 *     and the widget draws nothing — the honest answer for an unordered
 *     comparand, and the one `driver-memory` / `formula` give. (#5332 named this
 *     comparand position as covered by no ruling and left the `''` placeholder
 *     alone; deleting the encoder decides it by construction.)
 *
 * # A `where` ARRAY is lowered here, not dropped (#5334)
 *
 * `FilterArray` — `['stage', '=', 'won']`, `['and', […], […]]`, `[[…], […]]` —
 * is INPUT-ONLY authoring sugar (`spec/data/filter.zod.ts`, #5285), and #5158's
 * ruling C says every door into the runtime LOWERS it through the one
 * `parseFilterAST` sink before anything downstream sees a filter. #5329 closed
 * the engine's six entry points that way and deleted the four drivers' array
 * dialects. Analytics is the FIFTH door: it compiles `where` itself — to SQL
 * (`NativeSQLStrategy`) or to a `FilterCondition` for the engine
 * (`ObjectQLStrategy`) — so nothing upstream lowers for it.
 *
 * Until #5334 this function answered an array with `return null`: the WHOLE
 * `where` disappeared, no error, no trace, and the widget charted the entire
 * dataset — the #3650 / #4128 silent-widening class again, reached through the
 * array spelling. {@link normalizeAnalyticsFilterTree} now gives the same three
 * answers the engine door gives, so one query means one thing on every path.
 *
 * # Every refusal here is a 400, and SAYS so (#5352)
 *
 * All of the above only helps the author if the refusal REACHES them. Each
 * refusal in this module is a caller-shaped mistake — a misspelled operator, a
 * `$between` with one bound, a `{}` where an operator belongs — and ADR-0112's
 * rule is that such an error carries its own machine-readable semantics
 * (`code` + `status`) rather than leaving each consumer to guess from the
 * message text. Until #5352 only the #5334 array refusals did; the other seven
 * were bare `throw new Error(…)`, so `/analytics/dataset/query` had nothing to
 * read and answered `500 ANALYTICS_QUERY_FAILED` — "the platform is broken" for
 * what is a typo in a widget's filter, counted as a 5xx by ops alerting. The
 * same mistake on `find()` has answered `400 INVALID_FILTER` since #3948.
 *
 * So {@link invalidFilterError} is now the ONLY way this module refuses, and
 * `rest-server.ts`'s analytics catch reads that envelope before anything else.
 * #5352 changed the SHAPE of these errors and nothing about WHICH inputs are
 * refused — the refusal set is pinned input-by-input in
 * `filter-refusal-envelope.test.ts` precisely so that stays true.
 *
 * # An `undefined` COMPARAND is refused, not read seven different ways (#6386)
 *
 * #6050 ruled on 2026-08-07 (ruling B) that `undefined` sitting where a
 * comparand belongs is REFUSED, and landed that on `driver-sql` / `driver-turso`.
 * #6125 pushed it to this package's OTHER door, `read-scope-sql.ts` (PR #6390).
 * This door — the `where` the CALLER writes — had never been named by any of
 * those rulings, and it read the one shape seven ways. Measured on `origin/main`
 * (`5faa23ca3`) by calling `normalizeAnalyticsFilterTree({ where })` directly:
 *
 *   | `where`                       | normalized to                        | reading |
 *   |---|---|---|
 *   | `{d: undefined}`              | `null`                               | the WHOLE where dropped — the query ran with NO filter |
 *   | `{stage:'won', d: undefined}` | `stage equals 'won'`                 | the `d` conjunct vanished in silence |
 *   | `{$not: {d: undefined}}`      | `NOT (d set)`, i.e. `d IS NULL`      | a predicate the author never wrote |
 *   | `{d: {$eq: undefined}}`       | `d equals [null]`                    | a value comparison, NOT `$eq: null`'s `notSet` |
 *   | `{d: {$gt: undefined}}`       | `d gt [null]`                        | ditto |
 *   | `{d: {$in: [undefined]}}`     | `d in [null]`                        | ditto |
 *   | `{d: {$ne: undefined}}`       | `d notSet OR d notEquals [null]`     | ditto |
 *
 * The first three are the whole argument. They WIDEN — which is the failure mode
 * the note at {@link MONGO_TO_CUBE_OP}'s miss branch has forbidden in this very
 * function since #4128 ("NEVER drop: a missing predicate does not narrow the
 * query, it WIDENS it … That failure mode is #3650's"). `buildNode`'s first line
 * was `if (raw === undefined) continue;`: the module did, at its entry, the exact
 * thing its own body refuses to do a few dozen lines further down.
 *
 * Row three is the strangest and is worth stating separately, because it is not
 * "one conjunct fewer": the #5146 rewrite splits the leaf into `{d: {$null:
 * false}} AND {d: undefined}`, the entry gate dropped the second half, and the
 * surviving guard was then negated — so a predicate GREW OUT of a discarded leaf.
 *
 * ⚠️ The direction is silently WRONG RESULTS, not a permission bypass. Read
 * scope is compiled by the other door (`read-scope-sql.ts` → `applyReadScope`)
 * and never passes through here, so a caller still saw only rows it was entitled
 * to — just more of them than it asked for. What was lost is the ANSWER: an
 * analytics figure, a report total, an aggregate, wrong with nothing to read.
 *
 * The refusal is {@link undefinedComparandError}, in this module's existing
 * envelope (`INVALID_FILTER` / 400) — the opposite attribution from
 * `read-scope-sql`'s 500, and deliberately so: that door compiles a platform
 * artifact, this one receives what the CALLER wrote.
 *
 * ⛔ `null` does not move, and that is the way this change could do harm: the two
 * live one `===` apart in every polarity table here. `{d: null}`, `{$eq: null}`,
 * `{$ne: null}`, `{$null: …}`, `{$exists: …}` and `$contains: null`'s `%null%`
 * (#5526) keep their exact lowering, pinned as a control group in
 * `filter-normalizer-undefined-comparand.test.ts`.
 *
 * # A field wrapper cannot MIX $-operators with non-$ members (#6444)
 *
 * The value-independent sibling of the #6386 defect, in the same function, ruled
 * Option A (refuse) by the maintainer on 2026-08-08. A field constraint object
 * that carries `$`-operator keys AND non-`$` keys at once used to compile its
 * operators and silently DROP every non-`$` sibling — `fieldLeaves`'s
 * `if (opKeys.length > 0) { …; return out; }` arm never looked at them, and the
 * nested-relation flatten sits after that early return. Measured on
 * `origin/main` (`1a53a0253`):
 *
 *   | `where`                            | normalized to                    | reading |
 *   |---|---|---|
 *   | `{d: {$eq: 1, nested: 'x'}}`       | `d equals [1]`                   | the `nested` conjunct vanished in silence |
 *   | `{amount: {gte: 10, $lte: 20}}`    | `amount lte 20`                  | the missing-`$` typo: the LOWER BOUND silently gone |
 *   | `{$not: {d: {$null: true, nested: 'x'}}}` | `NOT(d set AND d notSet)` | a contradiction that negates to TRUE — EVERY row |
 *
 * Row two is the likeliest producer — a dropped `$` is a canonical agent typo —
 * and row three is the strangest: the #5146 guard was computed while the sibling
 * still existed (`requireValue`), the sibling then vanished inside
 * `fieldLeaves`, and the surviving conjunction was contradictory, so the
 * negation widened to the whole dataset. All three WIDEN — the #3650 failure
 * mode the note at {@link MONGO_TO_CUBE_OP}'s miss branch forbids in this very
 * function.
 *
 * The refusal is {@link mixedFieldWrapperError} via
 * {@link assertUnmixedFieldWrapper}, in this module's one envelope
 * (`INVALID_FILTER` / 400, #5352). The message must do one thing more than the
 * module's other refusals: the shape has TWO legitimate repairs answering two
 * intents this module cannot tell apart — an operator missing its `$`
 * (`gte` → `$gte`) and a nested-relation member that needs a wrapper of its own
 * — so the message names the offending key(s) and shows BOTH rewrites (ruling
 * requirement, #6444).
 *
 * Option B — flattening the non-`$` siblings as nested paths next to the
 * operators — was REJECTED by the same ruling: it would compile the likely-real
 * cause (a dropped `$`) into a predicate on a non-existent member `amount.gte`,
 * turning a diagnosable mistake into a harder one.
 *
 * ⛔ What does not move: a wrapper that is ALL non-`$` keys keeps flattening to
 * the dotted member (`{d: {nested: 'x'}}` → `d.nested`); a wrapper that is ALL
 * `$`-operators compiles exactly as before; `$null` / `$exists` flag semantics
 * (#5526 / #5332 / #5347) and {@link comparand} are untouched. The sibling door
 * `read-scope-sql.ts` already fails closed on this exact shape
 * (`compileField`'s non-`$`-key check) and is not touched — this change makes
 * the two doors give one answer.
 *
 * Row-result cover: `filter-operator-coverage.test.ts` for the operator
 * vocabulary, `native-sql-filter-logic-conformance.test.ts`, which runs the
 * SHARED combinator table (`FILTER_LOGIC_CASES`, #3774) that the SQL compiler,
 * the in-memory matcher, `formula` and `read-scope-sql` are already held to,
 * `filter-normalizer-not-null-safe.test.ts` for the two squares that table
 * deliberately does not carry (NULL handling, boolean identities),
 * `filter-array-lowering.test.ts` for the array door (#5334),
 * `filter-value-type-fidelity.test.ts` for what each comparand TYPE binds on both
 * consumers (#5526, carrying #5528's cases forward as end-to-end assertions),
 * `filter-normalizer-undefined-comparand.test.ts` for the `undefined` refusal and
 * its `null` control group (#6386), and
 * `filter-normalizer-mixed-wrapper.test.ts` for the mixed `$`/non-`$` wrapper
 * refusal and its pure-shape control groups (#6444).
 */

import { isFilterAST, parseFilterAST, VALID_AST_OPERATORS } from '@objectstack/spec/data';
import { StandardErrorCode } from '@objectstack/spec/api';
import {
  isBindableComparand,
  isRenderableTextComparand,
  TEXT_PATTERN_OPERATORS,
  unbindableListMemberMessage,
  unrenderableTextComparandMessage,
} from '../comparand-shape.js';

export interface NormalizedAnalyticsFilter {
  member: string;
  operator: string;
  /** The author's comparands, at their own types — see {@link NormalizedFilterNode}. */
  values: unknown[];
}

// ── [#5334 / #5352] The refusal envelope ─────────────────────────────────────

/**
 * [#5334, generalised by #5352] A filter refusal in the ADR-0112 envelope every
 * sibling filter refusal in the repo speaks — `INVALID_FILTER` / 400.
 *
 * The twin of `driver-sql`'s and `driver-memory`'s `unsupportedFilterError`.
 * A caller that writes a filter this module cannot compile has made a
 * 400-class mistake, and a coded refusal is what lets the `/analytics` face
 * answer it as one instead of as an opaque 500.
 *
 * ⛔ **The only way this module refuses.** #5334 introduced it for the two
 * array-door refusals while the other seven sites stayed bare `Error`s, and a
 * half-enveloped module is indistinguishable from an unenveloped one at the
 * REST boundary: `error.code` was `undefined` for the operator typo that is by
 * far the commonest of the nine, so the whole family landed as
 * `500 ANALYTICS_QUERY_FAILED` (#5352). A new refusal added to this file must
 * be thrown through here; a bare `throw new Error` is the defect returning.
 *
 * It carries no `#5352`-specific wording on purpose — the envelope is the
 * contract, the message stays whatever the refusing site says.
 */
function invalidFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * The value-INDEPENDENT operators: the pipeline name depends only on the key.
 *
 * `$null` and `$exists` are deliberately absent — their meaning flips with
 * their boolean value, which a key→name map cannot express. Putting `$exists`
 * here anyway is what made `{$exists: false}` compile to `IS NOT NULL`, the
 * exact inverse of what it asks for; both are handled explicitly below.
 */
const MONGO_TO_CUBE_OP: Record<string, string> = {
  $eq: 'equals',
  $ne: 'notEquals',
  $gt: 'gt',
  $gte: 'gte',
  $lt: 'lt',
  $lte: 'lte',
  $in: 'in',
  $nin: 'notIn',
  $contains: 'contains',
  $notContains: 'notContains',
  $startsWith: 'startsWith',
  $endsWith: 'endsWith',
  // [#6520] The case-INSENSITIVE twin, ASCII fold only. A separate cube operator
  // rather than a flag on `contains`, because the two compile to different SQL
  // and one name would make the renderers guess which was meant.
  $icontains: 'icontains',
};

/**
 * The comparand a leaf carries: the author's value, at the author's type.
 *
 * [#5526] This function is what used to be `stringifyForCube`, and the whole of
 * its former body is gone: `values` is `unknown[]`, so a comparand needs no
 * encoding and there is nothing for a decoder downstream to guess at. What
 * remains is one normalisation, and it is not a type conversion:
 *
 * `undefined` becomes `null`. JSON has no `undefined`, so no authored
 * `FilterCondition` can carry one — `{$eq: undefined}` is a key the author did
 * not mean to write (#5332's reading, unchanged here) — while a `values` entry
 * that IS `undefined` is a bind error on better-sqlite3 rather than a predicate.
 * `null` is the fail-closed reading: the comparison is UNKNOWN, so the widget
 * draws nothing instead of drawing rows chosen by an accident.
 *
 * Note what this does NOT do: `{$eq: undefined}` still compiles to an `equals`
 * leaf, not to `notSet`. Only `=== null` is the null PREDICATE (#5332's identity
 * test, which this module reads at the operator branch, above this function),
 * and widening it to `== null` here would re-decide that ruling sideways.
 *
 * ## Addendum (#6386): the `undefined` arm is now UNREACHABLE from this door
 *
 * {@link assertDefinedComparands} refuses an `undefined` before any comparand is
 * read, and it covers every call site of this function — the `$between` bounds,
 * the operator value and its array members, the bare-array `$in` and the implicit
 * `=` — so nothing can arrive here holding `undefined` any more. The refusal
 * tests enumerate exactly that set of positions, which is what makes the claim
 * checkable rather than asserted.
 *
 * ⛔ It is left in place ON PURPOSE, code untouched. Both statements this
 * function makes were RULED — `undefined` → `null` by #5526, and "only `=== null`
 * is the null predicate" by #5332 — and #6386 refuses an INPUT without reopening
 * either. Deleting a now-dead arm would be a semantic edit smuggled in as a
 * cleanup: it is #5526's call whether the normalisation still earns its place
 * once its last caller is gated, and that is a separate decision from this one.
 */
function comparand(v: unknown): unknown {
  return v === undefined ? null : v;
}

/**
 * One node of the normalized filter TREE.
 *
 * A tree rather than the flat array this module used to produce, because a flat
 * array cannot express `$or` — and what it did with one was DROP it, which does
 * not narrow a query, it widens it to rows the author excluded (#3650's
 * symptom). The structure is the minimum that survives that: leaves carry the
 * pipeline's `{member, operator, values}` triple unchanged, and the combinators
 * are explicit so each strategy can compile them the way its own backend
 * expresses them — recursive SQL for the raw-SQL path, a passed-through
 * `$or`/`$not` for the engine path.
 *
 * The `const` kind is the boolean constant (#5325). The union carried only
 * `leaf | and | or | not`, so there was no way to SAY "matches nothing": a
 * `{$not: {}}` — whose meaning is exactly that — could only be expressed by
 * emitting nothing, which every compiler reads as "no constraint", i.e. the
 * opposite. TRUE keeps its existing spelling (`null` = no constraint, the AND
 * identity); FALSE needs a node because it must survive into the WHERE clause.
 *
 * [#5526] A leaf's `values` is `unknown[]`, not `string[]`. The author's
 * comparand travels at its own type: a number stays a number, a boolean a
 * boolean, and — the defect this fixed — a STRING stays the string the author
 * typed, so `'007'` is never the integer `7` and `'null'` is never real NULL.
 * The compilers of this tree convert only where their own boundary forces it
 * ({@link toSqlBindValue} for a SQL parameter, `like-pattern.ts` for the LIKE
 * family, whose comparand the spec declares a `string`); the ObjectQL engine path
 * converts nothing, because the engine compares against the stored runtime type
 * and the value it is handed is the author's own. See the module header.
 */
export type NormalizedFilterNode =
  | { kind: 'leaf'; member: string; operator: string; values: unknown[] }
  | { kind: 'const'; value: boolean }
  | { kind: 'and'; children: NormalizedFilterNode[] }
  | { kind: 'or'; children: NormalizedFilterNode[] }
  | { kind: 'not'; child: NormalizedFilterNode };

/**
 * The SQL boolean constants the compilers of this tree emit for a `const` node.
 *
 * `1 = 0` / `1 = 1` are the spellings already used on both sides of the repo —
 * `read-scope-sql.ts` compiles an empty `$in` to `1 = 0`, `driver-sql`'s
 * `applyFalseConstant` emits the same (#5134), and Knex renders an empty
 * `whereIn` that way. They need no bindings, are valid on every dialect these
 * strategies target (unlike a bare `FALSE`), and keep the statement a normal
 * SELECT so `GROUP BY` / `LIMIT` still behave.
 */
export const SQL_CONST_FALSE = '1 = 0';
export const SQL_CONST_TRUE = '1 = 1';

/** The tree's FALSE. A fresh object per call — nodes are never shared. */
function falseNode(): NormalizedFilterNode {
  return { kind: 'const', value: false };
}

/**
 * `NOT` of a node, with `null` read as the constant TRUE it is.
 *
 * `NOT TRUE ≡ FALSE` is the whole point: `{$not: {}}` used to fall off the tree
 * here, taking the WHERE clause with it (#5325). A `NOT` of a constant folds to
 * the opposite constant, so `{$not: {$not: {}}}` is TRUE again rather than a
 * `NOT (1 = 0)` that only happens to evaluate right.
 */
function notOf(inner: NormalizedFilterNode | null): NormalizedFilterNode {
  if (!inner) return falseNode();
  if (inner.kind === 'const') return { kind: 'const', value: !inner.value };
  return { kind: 'not', child: inner };
}

/** A node the normalizer can walk: a plain object, not `null` and not an array. */
function isFilterObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** `null` means "no constraint" — an empty object contributes no predicate. */
function andOf(children: NormalizedFilterNode[]): NormalizedFilterNode | null {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { kind: 'and', children };
}

/**
 * [#5234] The comparand-SHAPE gate for the analytics `where` door.
 *
 * This runs before a leaf exists, which is the whole reason it is here rather
 * than at the three emitters. {@link fieldLeaves} is the ONLY producer of leaf
 * nodes in this package, so one refusal here covers all three consumers of the
 * tree at once — `NativeSQLStrategy.buildFilterClause` (the statement that
 * executes), `ObjectQLStrategy.buildFilterClauseSql` (the `/analytics/sql` echo)
 * and `ObjectQLStrategy.convertFilter` (the engine path). Guarding the emitters
 * instead would have been three guards, three envelopes, and one of them —
 * `convertFilter`'s `String(v0)` — would still have LAUNDERED the object into
 * `'[object Object]'` before any driver could refuse it, so a strict driver
 * downstream could never see the shape it was strict about.
 *
 * Prime Directive #12, applied literally: refuse at the door, do not tolerate at
 * the consumer. `read-scope-sql.ts` is this package's OTHER door — it compiles a
 * `FilterCondition` that never passes through here — and carries the same two
 * checks in its own fail-closed envelope.
 *
 * Only the two shapes #5234 measured are refused; `$eq` and friends keep binding
 * an object as JSON (`toSqlBindValue`), which is a separate account.
 */
function assertCompilableComparand(opKey: string, field: string, value: unknown): void {
  if (TEXT_PATTERN_OPERATORS.has(opKey)) {
    // An array reaches this door as `values[0]` — i.e. every member after the
    // first is silently DROPPED — while `read-scope-sql` and `driver-sql`
    // stringify the whole array. That split is why an array is refused and not
    // merely stringified consistently.
    if (!isRenderableTextComparand(value)) {
      throw invalidFilterError(`[analytics] ${unrenderableTextComparandMessage(opKey, field, value)}`);
    }
    return;
  }
  if ((opKey === '$in' || opKey === '$nin') && Array.isArray(value)) {
    value.forEach((member, index) => {
      if (!isBindableComparand(member)) {
        throw invalidFilterError(`[analytics] ${unbindableListMemberMessage(opKey, field, member, index)}`);
      }
    });
  }
}

/**
 * [#6386, on #6050's ruling B] `undefined` in a COMPARAND position.
 *
 * ONE wording for every position (#5240 — one condition, one wording); only
 * `path` varies, because only the position does. The wording names BOTH measured
 * consequences rather than one, which is where this differs from
 * `read-scope-sql`'s twin: there all four cells failed the same way (a silent
 * NULL bind), here the same input is read two different ways depending on where
 * it sits — the key is DROPPED in the three positions `buildNode` used to skip,
 * and compiled as a comparison against `null` in the four {@link comparand}
 * normalises. An author who hits either one needs to be told which of their keys
 * is unreadable, and both halves of what it would otherwise have done.
 *
 * ## Why 400 here and 500 on the sibling door
 *
 * `read-scope-sql.ts` refuses the same shape as `READ_SCOPE_COMPILE_FAILED` /
 * 500 because a read scope is compiled by the PLATFORM from CEL and stored
 * policy — billing the caller for it would be wrong. This door is the mirror
 * image: `where` is what the caller itself passed to `AnalyticsService.query`,
 * so it is a 400-class mistake and takes the envelope every other refusal in
 * this module already carries (#5352).
 *
 * ## Why the producer named is the CALLER, and what shape to look for
 *
 * `undefined` cannot cross JSON, so neither REST door can carry it: it can only
 * come from in-process code building the object — `{ owner_id: ctx.user?.id }`,
 * the shape #6050 proved reachable on `driver-sql`. Note the platform's OWN
 * answer to that need is already fail-closed and is not this shape: a
 * `{current_user_id}` placeholder in a dataset / widget / report filter is
 * resolved by `resolveFilterTokens` (`@objectstack/core`), which throws
 * `FILTER_TOKEN_UNRESOLVED` / 400 rather than emitting `undefined`.
 */
function undefinedComparandError(field: string, path: string): Error {
  return invalidFilterError(
    `[analytics] comparand at ${path} is undefined — refusing to compile this filter. ` +
    `@objectstack/spec FieldOperatorsSchema declares no undefined comparand, and in JavaScript a key ` +
    `whose value is undefined cannot be told apart from an ABSENT key — yet the two mean OPPOSITE ` +
    `things (a predicate versus no constraint at all), so there is no reading of it that is not a ` +
    `guess. It used to compile, two ways: in a FIELD position the key was dropped outright, so a ` +
    `single-key where ran with no filter at all and the chart was drawn over every row (#3650's ` +
    `widening, which this module refuses everywhere else); in an OPERATOR or list position it ` +
    `became a comparison against null, which is UNKNOWN for every row and charts nothing. ` +
    `Write null if the null predicate was meant ({ "${field}": null } or { "${field}": { "$null": true } }), ` +
    `or omit the key entirely when the value is genuinely absent — an omitted key is the same "no ` +
    `constraint" without the ambiguity. The producer to fix is whoever BUILT this where: undefined ` +
    `cannot cross JSON, so it is in-process code spreading a possibly-absent value into a filter ` +
    `object (#6050 ruling B, pushed down to this door by #6386).`,
  );
}

/**
 * [#6386] Refuse every `undefined` sitting in a comparand position of ONE field
 * constraint.
 *
 * The positions are enumerated rather than swept, because "comparand" is a
 * POSITION and not a type:
 *
 *   - the DIRECT comparand — `{d: undefined}`, the implicit `=`. Reached for a
 *     nested relation too, because {@link fieldLeaves} recurses into one with the
 *     DOTTED member name, so `{profile: {verified: undefined}}` is refused as
 *     `"profile.verified"` — the member the leaf would have carried, not the
 *     relation. (`read-scope-sql`'s twin has no such case: it refuses nested
 *     relations outright.)
 *   - a MEMBER of the bare-array implicit `$in` — `{d: [1, undefined]}`. The
 *     array itself is a legitimate comparand here, so its elements are comparands
 *     in their own right. This is the deliberate divergence from that twin, which
 *     refuses a bare array as a whole and so must not relabel it.
 *   - an OPERATOR's comparand — `{d: {$gt: undefined}}`, `$eq`, `$ne`, the LIKE
 *     family, every other single-value operator;
 *   - a MEMBER of a list operator's array — `{d: {$in: [undefined]}}`, `$nin`,
 *     and `$between`'s two bounds.
 *
 * `$null` / `$exists` are deliberately NOT swept, exactly as on the twin: their
 * comparand is a declared BOOLEAN — a flag, not a value to compare against — so
 * `undefined` there is not a comparand at all. ⚠️ This module reads that flag by
 * IDENTITY (`=== true` / `=== false`, see {@link fieldLeaves}) where the twin
 * reads it by truthiness, so `{$null: undefined}` lowers here to `set`
 * (`IS NOT NULL`). That is the boolean-DOMAIN question #5347 / #5369 opened and
 * #6387 is measuring on the sibling door; it is a different cell and is not
 * decided as a rider on this one.
 *
 * ## Why the gate sits HERE, and what that decides for `{$not: {d: undefined}}`
 *
 * {@link fieldLeaves} is the only producer of leaf nodes in this module, so one
 * gate covers all three consumers of the tree at once — the same argument
 * {@link assertCompilableComparand} makes one function below.
 *
 * That places it DOWNSTREAM of {@link nullSafeNegationOperand}, and for row three
 * of the header's table that choice is the whole question: a gate on the far side
 * of the #5146 rewrite refuses, while a rewrite that could swallow the leaf first
 * would leave a CHANGED SHAPE for the gate to bless. Measured rather than
 * assumed, because the same trap cost PR #6390 a lap on the sibling door — and
 * the reasoning there does NOT transfer, since the two modules' polarity tables
 * are spelled differently (that one is uniformly `=== null`; this one mixes
 * `=== null` for `$eq`/`$ne` with IDENTITY reads for `$null`/`$exists`). What the
 * measurement shows here is that the rewrite never drops a leaf: every guard
 * disposition — `requireValue` pushes `{k: {$null: false}}, {k: spec}`,
 * `allowNull` pushes `{$or: [{k: {$null: true}}, {k: spec}]}`, `none` writes
 * `out[k] = spec` — carries `spec` through by reference, so the author's
 * `undefined` always reaches this gate and always throws. Pinned in
 * `filter-normalizer-undefined-comparand.test.ts` as its own block: one case per
 * rewrite path that can carry a SWEPT comparand (`requireValue`, `allowNull`, and
 * the nested-relation recursion), plus the measured reason there is no third —
 * `none` needs every operator to satisfy {@link operatorIsNullTotal}, which is
 * false for an `undefined` comparand on every operator this gate sweeps, so the
 * only field specs that reach it holding one are the `$null` / `$exists` flags it
 * deliberately does not sweep.
 */
function assertDefinedComparands(field: string, spec: unknown): void {
  const root = `"${field}"`;
  if (spec === undefined) throw undefinedComparandError(field, root);
  if (Array.isArray(spec)) {
    spec.forEach((member, index) => {
      if (member === undefined) throw undefinedComparandError(field, `${root}[${index}]`);
    });
    return;
  }
  if (!isFilterObject(spec)) return;
  for (const [op, opValue] of Object.entries(spec)) {
    if (!op.startsWith('$') || op === '$null' || op === '$exists') continue;
    const opPath = `${root}.${op}`;
    if (opValue === undefined) throw undefinedComparandError(field, opPath);
    if (!Array.isArray(opValue)) continue;
    opValue.forEach((member, index) => {
      if (member === undefined) throw undefinedComparandError(field, `${opPath}[${index}]`);
    });
  }
}

/**
 * [#6444, ruled Option A on 2026-08-08] A field wrapper mixing `$`-operator
 * keys with non-`$` sibling keys.
 *
 * ONE wording whatever the mix (#5240 — one condition, one wording); only the
 * field and the two key lists vary, because only those do. Where this message
 * has to do MORE than the module's other refusals: the shape has two
 * legitimate repairs answering two different intents, and the module cannot
 * tell which one the author held — that inability is exactly why the shape is
 * refused rather than read. So the message must present BOTH (ruling
 * requirement):
 *
 *   - an OPERATOR missing its `$` — the canonical agent typo
 *     `{amount: {gte: 10, $lte: 20}}` — repaired by the prefixed spelling
 *     (`"gte" → "$gte"`);
 *   - a NESTED-RELATION member that strayed into an operator wrapper —
 *     repaired by giving it a wrapper of its own (`{ "d": { "nested": … } }`
 *     compiles to the member `d.nested`), ANDed with the operator constraint
 *     explicitly, since one JSON object cannot spell the same field key twice.
 *
 * Option B — flattening the sibling as a nested path beside the operators —
 * was rejected by the same ruling: it would compile the missing-`$` typo into
 * a predicate on a non-existent member `amount.gte`, converting a diagnosable
 * mistake into a harder one.
 */
function mixedFieldWrapperError(field: string, opKeys: string[], nonOpKeys: string[]): Error {
  const offending = nonOpKeys.map((k) => `"${k}"`).join(', ');
  const rewrites = nonOpKeys.map((k) => `"${k}" → "$${k}"`).join(', ');
  const example = nonOpKeys[0];
  return invalidFilterError(
    `[analytics] "${field}" mixes $-operator keys (${opKeys.join(', ')}) with non-$ sibling key(s) ` +
    `${offending} in ONE field constraint — refusing to compile this filter. A $-prefixed key is an ` +
    `OPERATOR and a bare key is a NESTED-RELATION member; the two readings of ${offending} lead to ` +
    `different predicates and this module cannot tell which was meant, so any silent choice is a ` +
    `guess. If an operator missing its "$" was meant — the usual authoring slip — spell it with the ` +
    `prefix: ${rewrites}, as in { "${field}": { "$${example}": ... } }. If a nested-relation member ` +
    `was meant, give it a wrapper of its OWN with no $ siblings — { "${field}": { "${example}": ... } } ` +
    `compiles to the member "${field}.${example}" — and AND it with the operator constraint ` +
    `explicitly: { "$and": [{ "${field}": { "$op": ... } }, { "${field}": { "${example}": ... } }] }. ` +
    `This shape used to compile by silently DROPPING every non-$ sibling, and a dropped conjunct ` +
    `does not narrow the query, it WIDENS it: the chart included rows the author excluded, with ` +
    `nothing to read (#3650's failure mode, which this module refuses everywhere else). The sibling ` +
    `door in this package (read-scope-sql.ts) already fails closed on this exact shape — one shape, ` +
    `one answer (#6444).`,
  );
}

/**
 * [#6444] Refuse ONE field wrapper that mixes `$`-operator keys with non-`$`
 * sibling keys — the value-independent sibling of {@link assertDefinedComparands}.
 *
 * What made the mix silent: {@link fieldLeaves}'s operator arm iterates
 * `opKeys` only and returns, and the nested-relation flatten sits after that
 * early return — so with even one `$` key present, every non-`$` sibling was
 * simply never visited. Dropping a conjunct WIDENS (#3650), and inside a `$not`
 * it did worse than widen by one conjunct: {@link nullGuardForFieldSpec} judged
 * the wrapper while the sibling still existed (a non-`$` key never satisfies
 * {@link operatorIsNullTotal}, so the disposition was `requireValue` or
 * `allowNull`, never `none`), the sibling then vanished here, and for a
 * null-predicate operator the surviving guard was CONTRADICTORY —
 * `{$not: {d: {$null: true, nested: 'x'}}}` compiled to `NOT(d set AND d
 * notSet)`, which is TRUE for every row. That same never-`none` fact is what
 * guarantees the #5146 rewrite carries a mixed wrapper to this gate by
 * reference instead of swallowing it — pinned in
 * `filter-normalizer-mixed-wrapper.test.ts`'s rewrite block.
 *
 * ## Ordering against the neighbouring gates
 *
 * Runs in {@link fieldLeaves}'s wrapper arm, after the #5240 zero-operator
 * refusal (disjoint by construction: `{}` has no keys of either kind) and
 * after {@link assertDefinedComparands} at the function's entry — so
 * `{d: {$eq: undefined, nested: 'x'}}` is refused as an undefined comparand,
 * not as a mix. Both are refusals in the same envelope, so the REST face
 * answers 400 either way; the ordering is pinned as a measured fact, not a
 * contract.
 *
 * ## What is deliberately not judged here
 *
 * A wrapper that is ALL `$`-operators or ALL non-`$` members passes untouched —
 * this gate moves the refusal set by exactly the mixed shape. Whether a non-`$`
 * KEY is a real member of the modeled object is the schema's question at a
 * different layer, not this compiler's.
 */
function assertUnmixedFieldWrapper(field: string, wrapper: Record<string, unknown>): void {
  const keys = Object.keys(wrapper);
  const opKeys = keys.filter((k) => k.startsWith('$'));
  if (opKeys.length === 0) return;
  const nonOpKeys = keys.filter((k) => !k.startsWith('$'));
  if (nonOpKeys.length === 0) return;
  throw mixedFieldWrapperError(field, opKeys, nonOpKeys);
}

/**
 * Compile one `field: value | { $op: … }` entry into its leaves.
 *
 * Multiple operators on one field AND together — the rule
 * `FILTER_LOGIC_CASES` pins for every other backend, and the one a range
 * `{ $gte, $lte }` depends on.
 */
function fieldLeaves(key: string, raw: unknown): NormalizedFilterNode[] {
  // [#6386] `undefined` in a comparand position, refused before any leaf exists.
  // First statement of the only leaf producer, so no consumer of the tree can be
  // handed one — see {@link assertDefinedComparands} for the position list and
  // for why this side of the `$not` rewrite is the load-bearing choice.
  assertDefinedComparands(key, raw);

  const out: NormalizedFilterNode[] = [];
  const leaf = (operator: string, values: unknown[]): void => {
    out.push({ kind: 'leaf', member: key, operator, values });
  };

  if (raw === null) {
    leaf('notSet', []);
    return out;
  }

  if (typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
    const wrapper = raw as Record<string, unknown>;
    // A field constrained by ZERO operators, ruled on in #5240: REFUSE it, the
    // way `driver-sql`, `driver-memory` and `formula` now do. This module used
    // to produce no leaf for it — and "no leaf" is the constant TRUE, which is
    // load-bearing since #5325 made TRUE absorb a `$or`: left alone,
    // `{$or: [{a: {}}, {b: 2}]}` would have gone from `b = 2` to EVERY row.
    // Neither silent reading is the author's intent (the shape is an authoring
    // accident — a filter builder that recorded a field and never its operator),
    // and a loud refusal is the answer the rest of the repo already gives.
    if (Object.keys(wrapper).length === 0) {
      throw invalidFilterError(
        `[analytics] "${key}" carries a field constraint with zero operators ({}). ` +
        `Refusing rather than reading it as "every row" or "no row" — #5240 ruled this ` +
        `shape refused on every backend.`,
      );
    }
    // [#6444] A wrapper mixing $-operator keys with non-$ siblings is refused
    // BEFORE the operator arm below gets to iterate `opKeys` only and return —
    // that early return is exactly how the non-$ siblings used to vanish. See
    // {@link assertUnmixedFieldWrapper} for the two-intent message contract and
    // the `$not` interaction.
    assertUnmixedFieldWrapper(key, wrapper);
    const opKeys = Object.keys(wrapper).filter((k) => k.startsWith('$'));
    if (opKeys.length > 0) {
      for (const opKey of opKeys) {
        // `$between [min, max]` LOWERS to its two bounds rather than getting a
        // `between` operator of its own. Both strategies already carry the
        // calendar-day whole-day rule on their upper bound — NativeSQLStrategy
        // compiles a bare-day `lte` half-open (#3777), ObjectQLStrategy hands
        // `$lte` to the driver, which does the same — so a range's max
        // inherits that rule by construction instead of needing a second
        // implementation to keep in step. (The preview evaluator's `$between`
        // gap was closed the same way, sharing its `$lte` helper.)
        //
        // Before this, `$between` was simply absent from the operator map and
        // fell to the `continue` below: the predicate VANISHED from the WHERE
        // clause, so a dashboard widget carrying a range filter charted the
        // entire dataset — #3650's symptom, on the surface #3650 was about.
        // The temporal conformance matrix caught it as row results
        // (`native-sql-temporal-conformance.test.ts`).
        if (opKey === '$between') {
          const v = wrapper[opKey];
          if (!Array.isArray(v) || v.length !== 2) {
            // Never drop it: an unbounded read is the failure mode this whole
            // branch exists to prevent, and it is indistinguishable from a
            // legitimately wide query. Same stance driver-memory took for the
            // same shape (#3948).
            throw invalidFilterError(
              `[analytics] "$between" on "${key}" needs a two-element [min, max] array, got ` +
              `${JSON.stringify(v)}. Dropping the predicate would silently widen the query to every row.`,
            );
          }
          leaf('gte', [comparand(v[0])]);
          leaf('lte', [comparand(v[1])]);
          continue;
        }

        // The two null predicates read their BOOLEAN, not just their key —
        // which is why neither can live in MONGO_TO_CUBE_OP. `$null: true`
        // asks for IS NULL (`notSet`), `$null: false` for IS NOT NULL
        // (`set`); `$exists` is the mirror image. `$null` is the shape the
        // console emits for an "is empty" / "is not empty" filter
        // (`is_null`/`is_not_null` normalise to it in `filter.zod.ts`), so
        // dropping it silently meant such a widget showed every row.
        if (opKey === '$null' || opKey === '$exists') {
          const isNull = opKey === '$null' ? wrapper[opKey] === true : wrapper[opKey] === false;
          leaf(isNull ? 'notSet' : 'set', []);
          continue;
        }

        // [#5332] A `null` COMPARAND is a null PREDICATE, not a value
        // comparison: `$eq: null` is `IS NULL` (`notSet`) and `$ne: null` is
        // `IS NOT NULL` (`set`) — the same two leaves the `raw === null` branch
        // above and `{$null: true|false}` beside it already produce. `$eq: null`
        // and `$null: true` are not merely similar spellings; `driver-mongodb`
        // TRANSLATES the latter into the former (`mongodb-filter.ts`'s `$null`
        // arm), so they are one predicate in the contract, and
        // `read-scope-sql.ts`'s `compileOperator`, `driver-sql`, `driver-memory`
        // and `formula` all compile them alike.
        //
        // Without this branch the pair fell through to MONGO_TO_CUBE_OP and
        // `stringifyForCube(null)` → `''`, i.e. `stage = ''` / `stage != ''`
        // (#5332). One meaning had two answers inside ONE file, and the wrong
        // one bound a real value a NULL column can never equal: an "is empty"
        // widget charted ZERO rows with no error to read, and on a text column —
        // where `''` is a value rows genuinely store — `$ne: null` additionally
        // EXCLUDED the empty-string rows it was asked to keep.
        //
        // Identity against `null`, matching `read-scope-sql` and `driver-sql`:
        // `null` is what an authored `FilterCondition` can carry (JSON has no
        // `undefined`, and `$eq: undefined` is a key the author did not mean to
        // write). [#5526] `comparand`'s `undefined` → `null` normalisation
        // deliberately does NOT widen this test to `== null`: it makes the VALUE
        // bindable, while this branch decides what the operator MEANS, and the
        // meaning is #5332's to change, not a side effect of deleting an encoder.
        if ((opKey === '$eq' || opKey === '$ne') && wrapper[opKey] === null) {
          leaf(opKey === '$eq' ? 'notSet' : 'set', []);
          continue;
        }

        // An EMPTY set is a boolean constant, not an absent predicate (#5134).
        // `buildFilterClause` returns `null` for a value-less `in`/`notIn`, and
        // a `null` clause is read as "no constraint" by every compiler of this
        // tree — so `{stage: {$in: []}}` charted every row instead of none. It
        // also has to be a CONSTANT rather than a dropped clause for the
        // NULL-safe `$not` rewrite below to stay correct: a dropped conjunct
        // inside a negation flips the whole negation's answer, while `1 = 0`
        // negates to `1 = 1` the way `read-scope-sql.ts` already has it.
        if ((opKey === '$in' || opKey === '$nin') && Array.isArray(wrapper[opKey]) && (wrapper[opKey] as unknown[]).length === 0) {
          out.push({ kind: 'const', value: opKey === '$nin' });
          continue;
        }

        const cubeOp = MONGO_TO_CUBE_OP[opKey];
        if (!cubeOp) {
          // NEVER drop: a missing predicate does not narrow the query, it
          // WIDENS it — the compiled SQL stays valid and simply returns rows
          // the author excluded, which is indistinguishable from a
          // legitimately broad query and invisible to any test that asserts
          // the emitted SQL. That failure mode is #3650's, and skipping
          // unmapped operators is how `$between` reproduced it (#4128).
          // driver-memory made the same call for the same reason in #3948.
          throw invalidFilterError(
            `[analytics] Unsupported filter operator "${opKey}" on "${key}". ` +
            `Supported: ${Object.keys(MONGO_TO_CUBE_OP).join(', ')}, $between, $null, $exists, ` +
            `and the $and/$or/$not combinators. ` +
            `Dropping it would silently widen the query to rows the filter excludes.`,
          );
        }
        const v = wrapper[opKey];
        // [#5234] The comparand SHAPE gate runs before anything reads `v` — see
        // {@link assertCompilableComparand} for why this door and not the three
        // emitters downstream of it.
        assertCompilableComparand(opKey, key, v);
        const values = Array.isArray(v) ? v.map(comparand) : [comparand(v)];
        // [#5298] The operators that carry their own negation are NULL-safe,
        // here as everywhere else — see the module header's section on it.
        if (nullValueSatisfiesOperator(opKey, v) && !operatorIsNullTotal(opKey, v)) {
          out.push({
            kind: 'or',
            children: [
              { kind: 'leaf', member: key, operator: 'notSet', values: [] },
              { kind: 'leaf', member: key, operator: cubeOp, values },
            ],
          });
          continue;
        }
        leaf(cubeOp, values);
      }
      return out;
    }
    // Nested relation (e.g. {profile: {verified: true}}). Flatten with
    // dot-prefixed keys so cube field path resolution still works.
    for (const [nestedKey, nestedVal] of Object.entries(wrapper)) {
      out.push(...fieldLeaves(`${key}.${nestedKey}`, nestedVal));
    }
    return out;
  }

  // Implicit equality / array → in. An empty array is the same constant its
  // explicit `{$in: []}` spelling is — see the note at that branch.
  if (Array.isArray(raw)) {
    if (raw.length === 0) out.push({ kind: 'const', value: false });
    else leaf('in', raw.map(comparand));
  } else leaf('equals', [comparand(raw)]);
  return out;
}

/**
 * Compile a `FilterCondition` object into a node. `null` = no constraint (TRUE).
 *
 * Every entry of one object ANDs with its siblings, at every depth — the rule
 * `filter-logic-conformance.ts` exists to hold each backend to (#3774). The
 * combinator handling deliberately mirrors `read-scope-sql.ts`'s
 * `compileNode` — the `{}`/`{$not: {}}` identities since #5325, and the EMPTY
 * `$and`/`$or` identities since the #5322 ruling (see the note at the
 * `length === 0` branch) — so the two SQL-producing paths in this package
 * cannot drift apart about what a filter MEANS.
 */
function buildNode(cond: Record<string, unknown>): NormalizedFilterNode | null {
  const children: NormalizedFilterNode[] = [];

  for (const [key, raw] of Object.entries(cond)) {
    // [#6386] What used to be here — `if (raw === undefined) continue;` — was
    // the entry gate doing the one thing the rest of this file forbids: a key
    // dropped without trace, which does not narrow the query, it WIDENS it (see
    // the module header's table and the note at MONGO_TO_CUBE_OP's miss branch).
    // Removing it does NOT create four new refusals; every key kind now reaches
    // the branch that already had the truest thing to say about it:
    //
    //   {d: undefined}      → `fieldLeaves` → `assertDefinedComparands` (#6386)
    //   {$and|$or: undefined} → "requires an array of filter objects, got undefined"
    //   {$not: undefined}     → "requires a filter object, got undefined"
    //   {$other: undefined}   → "Unsupported top-level filter operator"
    //
    // ⚠️ An absent `where` is untouched and still means "no constraint":
    // `lowerAnalyticsWhere` answers `null` for `{where: undefined}` before this
    // function runs. The refusal is about a KEY INSIDE a `where`, where dropping
    // it silently changes which rows the author gets.
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(raw)) {
        throw invalidFilterError(
          `[analytics] "${key}" requires an array of filter objects, got ${JSON.stringify(raw)}. ` +
          `Dropping it would silently widen the query to rows the filter excludes.`,
        );
      }
      if (raw.length === 0) {
        // Boolean identity (#5322 ruling, 2026-08-04): the empty `$and` is the
        // AND identity — TRUE, no constraint — and the empty `$or` is the OR
        // identity — FALSE, zero rows. Until that ruling this function REFUSED
        // both; its error message argued, verbatim, that "An empty combinator
        // has no defensible reading — dropping it widens the query, and
        // treating it as 'match nothing' silently empties a chart" — while the
        // five FILTER_LOGIC_CASES backends already reduced them. The ruling
        // took the reduction: only a reduction can evaluate a NESTED tree (a
        // rejection must first reduce to judge `$and: []` as the third branch
        // of a `$or`, which concedes the point), and `{$or: []}` = zero rows
        // is fail-closed where it matters — a disjunct list that loops to zero
        // items hides every row instead of widening (#5134). Loud
        // AUTHORING-time rejection of the literal spellings is #5330's scope.
        // Note the guard above did NOT loosen: a non-array `$and`/`$or` still
        // throws, as do non-object branches below.
        if (key === '$or') children.push(falseNode());
        continue;
      }
      const branches = raw.map((sub) => {
        // A non-object element is refused rather than skipped: skipping it
        // NARROWS a `$or` to its remaining branches and, under the TRUE-absorbs
        // rule below, would otherwise have to be read as TRUE and widen the
        // query to every row. Neither is a defensible reading of garbage input —
        // `read-scope-sql.ts` refuses the same shape.
        if (!isFilterObject(sub)) {
          throw invalidFilterError(
            `[analytics] "${key}" branches must be filter objects, got ${JSON.stringify(sub)}. ` +
            `Skipping it would silently change which rows the filter admits.`,
          );
        }
        return buildNode(sub);
      });
      // A `null` branch is the constant TRUE. It is the AND identity, so it
      // drops out of a `$and` — but it ABSORBS a `$or`: one TRUE disjunct makes
      // the whole disjunction TRUE, so the group contributes NO constraint
      // rather than collapsing to its surviving branches. Collapsing is what
      // narrowed `{$or: [{}, {stage: 'won'}]}` to `stage = 'won'` (#5325).
      if (key === '$or' && branches.some((n) => n === null)) continue;
      const kept = branches.filter((n): n is NormalizedFilterNode => n !== null);
      if (kept.length === 0) continue;
      // `$and` folds into this object's own AND; `$or` becomes a node, since
      // OR is exactly the structure a flat list could not carry.
      if (key === '$and') children.push(...kept);
      else children.push(kept.length === 1 ? kept[0] : { kind: 'or', children: kept });
      continue;
    }

    if (key === '$not') {
      if (!isFilterObject(raw)) {
        // Same call as the branch elements above: a `$not` of garbage used to
        // vanish, which turns "exclude these rows" into "exclude nothing".
        throw invalidFilterError(
          `[analytics] "$not" requires a filter object, got ${JSON.stringify(raw)}. ` +
          `Dropping it would silently widen the query to rows the filter excludes.`,
        );
      }
      // NULL-safe negation (#5146): totalise the operand's leaves FIRST, so the
      // negation can never be UNKNOWN and this path admits the same rows
      // `driver-memory` / `formula` / `driver-sql` admit. The guard is added as
      // STRUCTURE here, which is what makes it survive into the ObjectQL engine
      // path too (see the module header).
      const inner = buildNode(nullSafeNegationOperand(raw));
      // `notOf` turns a TRUE operand into FALSE instead of nothing: `{$not: {}}`
      // is the zero-row filter, and emitting nothing for it charted every row.
      children.push(notOf(inner));
      continue;
    }

    if (key.startsWith('$')) {
      throw invalidFilterError(
        `[analytics] Unsupported top-level filter operator "${key}". ` +
        `Dropping it would silently widen the query to rows the filter excludes.`,
      );
    }

    children.push(...fieldLeaves(key, raw));
  }

  return andOf(children);
}

// ── [#5146 / #5325] NULL-safe `$not` ─────────────────────────────────────────

/**
 * What one field constraint needs so the leaves it produces are TOTAL — TRUE or
 * FALSE for every row, never UNKNOWN.
 *
 * - `'none'`         — already total (`set` / `notSet`, a boolean constant), or
 *                      a shape this normalizer refuses, which must keep refusing.
 * - `'requireValue'` — a NULL column does NOT satisfy it: `col IS NOT NULL AND (…)`.
 * - `'allowNull'`    — a NULL column DOES satisfy it: `col IS NULL OR (…)`.
 */
type NullGuard = 'none' | 'requireValue' | 'allowNull';

/**
 * Does a NULL column satisfy this one operator, under the semantics the JS
 * backends (`driver-memory`'s `match`, `formula`'s `matchesFilterCondition`)
 * give it? They evaluate a missing value in ordinary two-valued JS — `undefined
 * !== 'won'` is simply `true` — and #5146 ruled that answer canonical.
 *
 * This is `sql-driver.ts`'s and `read-scope-sql.ts`'s table, with the
 * differences that come from THIS module's emitter rather than from a different
 * reading of #5146 — each guard matches its own emitter, which is the invariant,
 * not the literal table:
 *
 *   - `$null` / `$exists` are read by IDENTITY (`=== true` / `=== false`)
 *     because {@link fieldLeaves} reads them that way, where `read-scope-sql`
 *     uses truthiness because its emitter does. Immaterial in practice: both
 *     compile to a null predicate, so they are total either way and never
 *     reach the polarity question.
 *   - `$between` exists in this vocabulary; it lowers to `gte` + `lte`, two
 *     positive comparisons, so it takes the same default they do.
 *
 * `$eq` / `$ne` DO carry `read-scope-sql`'s `value === null` arms — since #5332,
 * and only since then. While {@link fieldLeaves} stringified a `null` comparand
 * to `''`, these two arms had to describe THAT emitter: `{$eq: null}` was an
 * ordinary value comparison here, the guard said so, and the TSDoc recorded the
 * `''` comparand as a separate defect deliberately left undecided. #5332 decided
 * it — the emitter now compiles the pair to `notSet` / `set` — so the arms moved
 * with it, in the same commit. The invariant is not "copy the sibling table", it
 * is "each guard matches its OWN emitter"; the two tables agreeing again is the
 * consequence of the emitters agreeing, not the reason for the edit.
 *
 * The default is the large positive-comparison family (`$gt` / `$in` /
 * `$contains` / …), every member of which answers `false` for a value that is
 * not there. An operator this module does not support also lands here; it is
 * guarded and then still THROWS from {@link fieldLeaves}, so fail-closed is
 * preserved.
 */
function nullValueSatisfiesOperator(op: string, value: unknown): boolean {
  switch (op) {
    // [#5332] `$eq: null` IS the null predicate — a NULL column satisfies it,
    // and no other comparand does.
    case '$eq': return value === null;
    // Mirror image: `$ne: null` compiles to `set` (`IS NOT NULL`), which a NULL
    // column FAILS. Any other comparand is the two-valued JS `!==`, which an
    // absent value passes — the arm this used to be for every comparand.
    case '$ne': return value !== null;
    case '$null': return value === true;
    case '$exists': return value === false;
    // Negative-polarity set / substring tests hold vacuously for an absent value.
    case '$nin': return true;
    // `$notContains` is the one operator where the two JS backends disagree for
    // a null-valued field (`driver-memory` answers false, `formula` true).
    // `formula` is followed because `driver-sql` and `read-scope-sql` follow it,
    // so this module casts no vote on a disagreement that is filed elsewhere.
    case '$notContains': return true;
    default: return false;
  }
}

/** Is this operator's compiled leaf already total for a NULL column? */
function operatorIsNullTotal(op: string, value: unknown): boolean {
  switch (op) {
    // Compile to `set` / `notSet` — `IS NULL` / `IS NOT NULL`, two-valued by
    // construction, on every strategy that compiles this tree.
    case '$null':
    case '$exists':
      return true;
    // [#5332] A `null` comparand makes these null PREDICATES too — `notSet` /
    // `set`, not comparisons — so they are total by construction and take NO
    // guard. Left out, `{$not: {stage: {$eq: null}}}` wrapped `stage IS NOT NULL
    // AND stage IS NULL` (an always-false conjunction) and negated it to EVERY
    // row, for a filter meaning "stage is not empty".
    case '$eq':
    case '$ne':
      return value === null;
    // An EMPTY set compiles to a boolean CONSTANT (see `fieldLeaves`), and a
    // constant is total. Wrapping a guard around it would only add a redundant
    // conjunct to a predicate whose value is already decided.
    case '$in':
    case '$nin':
      return Array.isArray(value) && value.length === 0;
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
  // `{field: null}` compiles to `notSet` (`IS NULL`) — already total.
  if (spec === null) return 'none';
  // A bare array is an implicit `$in`; an EMPTY one is the FALSE constant.
  if (Array.isArray(spec)) return spec.length === 0 ? 'none' : 'requireValue';
  // A scalar / Date is an implicit `=`; a NULL column fails it.
  if (typeof spec !== 'object' || spec instanceof Date) return 'requireValue';
  const entries = Object.entries(spec as Record<string, unknown>);
  // `{field: {}}` is REFUSED by `fieldLeaves` (#5240). Passing it through
  // unrewritten is what keeps that refusal reachable — a guard wrapped around it
  // would only change which message the caller sees.
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
 * Guard one `field: spec` entry, writing either the untouched entry into `out`
 * or its guarded form into `guarded`.
 *
 * A nested relation spec (`{account: {region: 'NA'}}`) is flattened with the
 * dotted key {@link fieldLeaves} would have produced, so the guard lands on the
 * SAME member as the leaf it protects — guarding `account` when the leaf reads
 * `account.region` would test a column that does not exist.
 */
function guardFieldEntry(
  key: string,
  spec: unknown,
  out: Record<string, unknown>,
  guarded: unknown[],
): void {
  if (
    isFilterObject(spec) &&
    Object.keys(spec).length > 0 &&
    !Object.keys(spec).some((k) => k.startsWith('$'))
  ) {
    for (const [nested, value] of Object.entries(spec)) {
      guardFieldEntry(`${key}.${nested}`, value, out, guarded);
    }
    return;
  }

  const guard = nullGuardForFieldSpec(spec);
  if (guard === 'none') {
    out[key] = spec;
  } else if (guard === 'requireValue') {
    // `col IS NOT NULL AND (…)` — both conjuncts of the enclosing node.
    guarded.push({ [key]: { $null: false } }, { [key]: spec });
  } else {
    // `col IS NULL OR (…)` — one conjunct, so the OR binds tighter than the AND
    // this node's keys form.
    guarded.push({ $or: [{ [key]: { $null: true } }, { [key]: spec }] });
  }
}

/**
 * [#5146] Rewrite the operand of a `$not` so every leaf compiles to a TOTAL
 * predicate — which is what makes `NOT (…)` mean here what it means in
 * `driver-memory`, `formula` and (since #5296) `driver-sql`.
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
 * `{$not: {a: {$ne: 5}}}` means "a is 5", and both JS backends exclude a NULL
 * row from it. Adding an unconditional null escape there would hand back exactly
 * the rows the filter excludes. So each leaf is guarded in the direction its own
 * operator answers, per {@link nullValueSatisfiesOperator}.
 *
 * # Why it is a REWRITE of the condition, not of the tree
 *
 * The output is still a `FilterCondition`, so `buildNode` compiles it with no
 * new cases and — the point of doing it here rather than in the SQL strategy —
 * the guard reaches the ObjectQL engine as structure too. Running only inside a
 * `$not` keeps every other comparison's shape untouched, and a NESTED `$not` is
 * left alone on purpose: its own branch totalises its operand, and
 * `NOT <total>` is itself total, so recursing would stack a redundant guard on
 * the same column.
 */
function nullSafeNegationOperand(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const guarded: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      // A non-object element is passed through so `buildNode` still refuses it
      // with its own message.
      out[key] = value.map((element) => (isFilterObject(element) ? nullSafeNegationOperand(element) : element));
      continue;
    }
    if (key.startsWith('$')) {
      // `$not` (handled by its own branch) and anything else `$`-prefixed keep
      // whatever this module does with them today — the rewrite rules on NULL,
      // not on the operator vocabulary, and an unknown one must still throw.
      out[key] = value;
      continue;
    }
    guardFieldEntry(key, value, out, guarded);
  }
  if (guarded.length > 0) {
    const existing = Array.isArray(out.$and) ? out.$and : [];
    out.$and = [...existing, ...guarded];
  }
  return out;
}

// ── [#5334] The FilterArray door ─────────────────────────────────────────────

/**
 * [#5334] A `where` array this door cannot lower.
 *
 * Deliberately the same refusal the other doors give, in the same envelope:
 * `driver-sql` / `driver-memory` / `driver-mongodb`'s
 * `filterArrayReachedDriverError` (#5158/#5329) and the engine's own
 * `lowerWhereFilterArray`. The INFIX join form (`[condA, 'or', condB]`) is the
 * shape that makes this branch load-bearing — no schema declares it,
 * `FilterArraySchema` excludes it and `parseFilterAST` has no lowering for it,
 * so it can only be refused; silently dropping it returns the UNFILTERED
 * dataset, which is what this whole module exists to prevent.
 */
function filterArrayNotLowerableError(where: unknown[]): Error {
  return invalidFilterError(
    `[analytics] received a 'where' array that is not a filter: ${JSON.stringify(where)}. ` +
    `A filter array is a comparison [field, operator, value], a logical node ` +
    `["and"|"or", ...conditions], or a list of those — it is INPUT-ONLY sugar (spec ` +
    `'FilterArray'), lowered to a FilterCondition by @objectstack/spec parseFilterAST() at ` +
    `every door, this one included (#5158/#5334). This value cannot be lowered, and an ` +
    `unapplied filter would have charted the UNFILTERED dataset. Recognised operators: ` +
    `${[...VALID_AST_OPERATORS].sort().join(', ')}. Infix joins ([condA, "or", condB]) are ` +
    `NOT one of the shapes — write the prefix form ["or", condA, condB].`,
  );
}

/**
 * Lower an analytics query's `where` to the CANONICAL `FilterCondition` object,
 * before any node is built. `null` when the query carries no `where`.
 *
 * Extracted from {@link normalizeAnalyticsFilterTree} for #5353's second reader
 * (`inferCubeFromQuery`, which needs the lowered condition's own KEYS rather
 * than the compiled tree's leaves — see that function for why the two readers
 * want different views of one filter). The three arrival answers documented on
 * {@link normalizeAnalyticsFilterTree} are all decided HERE; that function is
 * now this lowering plus {@link buildNode}.
 *
 * Keeping the lowering in ONE place is the point of the extraction. The
 * alternative — a second `isFilterAST`/`parseFilterAST` call at the new reader —
 * is how "the shape the cube was minted from" and "the shape that reached SQL"
 * drift apart, and both refusal paths below would then have had to be
 * re-derived to stay in step.
 */
export function lowerAnalyticsWhere(
  query: { where?: unknown } | unknown,
): Record<string, unknown> | null {
  if (!query || typeof query !== 'object') return null;
  const where = (query as { where?: unknown }).where;
  if (!where || typeof where !== 'object') return null;

  if (Array.isArray(where)) {
    // (1) `[]` is "no filter", not a failed filter.
    if (where.length === 0) return null;
    // (3) Not a shape `parseFilterAST` can express.
    if (!isFilterAST(where)) throw filterArrayNotLowerableError(where);
    // (2) The declared path.
    const condition = parseFilterAST(where);
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
      // Unreachable by construction — `isFilterAST` accepted the shape, so
      // `parseFilterAST` has a lowering for it. Loud rather than silent for the
      // same reason the engine door is: the failure mode of the two spec
      // functions disagreeing is a dropped predicate, i.e. every row.
      throw invalidFilterError(
        `[analytics] filter array ${JSON.stringify(where)} passed isFilterAST() but ` +
        `parseFilterAST() lowered it to ${JSON.stringify(condition)}. Refusing rather than ` +
        `charting the dataset unfiltered (#5158/#5334).`,
      );
    }
    return condition as Record<string, unknown>;
  }

  return where as Record<string, unknown>;
}

/**
 * The FIELD KEYS a lowered `FilterCondition` names in its top-level
 * CONJUNCTION — `$and` descended through, `$or` / `$not` deliberately not.
 *
 * # Why a conjunction walker and not {@link collectFilterLeaves}
 *
 * This answers a VOCABULARY question, not a predicate question: #5353's caller
 * mints an ad-hoc cube's `dimensions` from the `where`, and the rule that bag
 * has always followed is "the `where`'s own top-level keys are field names".
 * `collectFilterLeaves` answers a different question (every member the compiled
 * predicate binds, structure discarded) and substituting it here would have
 * changed three behaviours #5353 does not ask about — see the caller's note.
 *
 * `$and` is descended because the LOWERING ITSELF introduces it: a flat filter
 * array `[[a,…],[b,…]]` is the array spelling of the object `{a…, b…}`, and
 * `parseFilterAST` lowers it to `{$and: [{a…}, {b…}]}`. Without descending, the
 * two spellings of one filter would still mint two different cubes — the whole
 * defect. Conjunction is associative and flat, so nested `$and`s are descended
 * too; recursing at all is safe here precisely because every entry of one
 * object ANDs with its siblings at every depth (`buildNode`'s rule).
 *
 * `$or` / `$not` are NOT descended, and both spellings agree on that today:
 * `{$or: […]}` and `["or", …]` each contribute no key. Reading a disjunction's
 * branches as cube dimensions is a separate question from #5353's asymmetry —
 * and answering it would force a policy on DOTTED members that #5739 owns.
 */
export function conjunctFieldKeys(condition: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const walk = (cond: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(cond)) {
      if (key === '$and' && Array.isArray(value)) {
        for (const child of value) {
          if (isFilterObject(child)) walk(child);
        }
        continue;
      }
      // Every other `$` key is a combinator this walk does not enter (`$or`,
      // `$not`) or an operator that belongs to a field ENTRY, not to the
      // condition — neither names a field here.
      if (key.startsWith('$')) continue;
      keys.push(key);
    }
  };
  walk(condition);
  return keys;
}

/**
 * Normalize an analytics query's `where` into the tree the strategies compile.
 * `null` when the query carries no `where` — i.e. no constraint.
 *
 * `where` is declared a `FilterCondition` (`AnalyticsQuerySchema`), and the
 * object form is the whole of the contract downstream. An ARRAY nevertheless
 * arrives — it is the `FilterArray` authoring sugar four published contracts
 * teach, and analytics is a door into the runtime like any other — so it is
 * LOWERED by {@link lowerAnalyticsWhere} (#5334, on #5158's ruling C), giving
 * the same three answers `ObjectQL`'s six entry points give since #5329:
 *
 * 1. `[]` — "no filter", not a failed filter: `null`, the same reading every
 *    layer gives it (the engine door DELETES the key; `parseFilterAST([])` is
 *    `undefined`). No predicate is emitted and no error is raised.
 * 2. A well-formed `FilterArray` — lowered through `parseFilterAST` and
 *    compiled by {@link buildNode}, so the author gets the SAME rows either
 *    spelling produces. `isFilterAST` gates first so the operator vocabulary is
 *    checked before `parseFilterAST`'s lenient `$${op}` fallback can turn a
 *    misspelling into a `$sounds_like` condition nothing executes.
 * 3. Anything else array-shaped — REFUSED, loudly. Before #5334 all three of
 *    these arrivals answered the same way: `return null`, which for (2) and (3)
 *    means the predicate VANISHED and the chart was drawn over every row.
 *
 * Lowering rather than refusing outright is what keeps ONE dashboard's
 * metadata meaning one thing: the same `where` on a plain `find()` already
 * lowers at the engine door (#5329), so refusing it here would have forked the
 * product by which face read the metadata.
 */
export function normalizeAnalyticsFilterTree(
  query: { where?: unknown } | unknown,
): NormalizedFilterNode | null {
  const condition = lowerAnalyticsWhere(query);
  if (!condition) return null;
  return buildNode(condition);
}

/**
 * Every leaf in the tree, structure discarded.
 *
 * For asking WHICH MEMBERS a filter touches — the cross-object envelope check
 * is the caller. Never for building a predicate: the leaves of an `$or` read
 * as a conjunction here, so compiling from this list would turn `a OR b` into
 * `a AND b`. Use {@link normalizeAnalyticsFilterTree} for that.
 */
export function collectFilterLeaves(
  node: NormalizedFilterNode | null,
): NormalizedAnalyticsFilter[] {
  if (!node) return [];
  if (node.kind === 'leaf') return [{ member: node.member, operator: node.operator, values: node.values }];
  // A boolean constant names no member — it constrains rows, not columns — so
  // it contributes nothing to the cross-object envelope check.
  if (node.kind === 'const') return [];
  if (node.kind === 'not') return collectFilterLeaves(node.child);
  return node.children.flatMap(collectFilterLeaves);
}

/**
 * [#5526] Put one comparand into a form a SQL driver can BIND. One-way, and the
 * only stringification left in this module's value path.
 *
 * This replaces `coerceFilterValueForSql` / `coerceFilterValueForObjectQL`, and
 * the difference is the whole of #5526: those two were DECODERS — they received a
 * string and guessed which type it had been before `stringifyForCube` flattened
 * it, so `'007'` became `7`, `'null'` became real NULL and `'true'` became `1`,
 * whatever the author meant. Nothing here inspects a string. A `string` comparand
 * is returned untouched, always, because a `string` is already bindable; only the
 * JS types a driver CANNOT bind are converted, each to the one form SQL has for
 * it:
 *
 *   - `boolean` → `1` / `0`. better-sqlite3 refuses a JS boolean outright
 *     ("can only bind numbers, strings, bigints, buffers, and null"), and `1`/`0`
 *     is how every dialect these strategies target spells a bit. The ObjectQL
 *     path deliberately does NOT do this — the engine compares against the
 *     STORED boolean, where `1` never matches `true` (the regression
 *     `objectql-strategy-boolean-filter.test.ts` guards).
 *   - `Date` → canonical UTC ISO text. A comparand on a temporal column has
 *     normally been through `StrategyContext.coerceTemporalFilterValue` (the
 *     driver's own storage convention, ADR-0053 D-A2) before it gets here; this
 *     arm is the fallback for the hookless / non-temporal case, where an
 *     unbindable object would otherwise reach the driver.
 *   - any other object / array → JSON text. Not a meaningful comparison on any
 *     column, but the shape `filter.zod.ts` cannot exclude, and a driver-level
 *     bind error tells the author nothing about their filter.
 *
 * `number`, `bigint`, `null` and `string` pass through — `null` included, and
 * that is deliberate: `col > NULL` is UNKNOWN, so the widget draws nothing. It is
 * the honest answer for an unordered comparand and the one the JS backends give;
 * the `''` this used to bind was a real comparison against the empty string,
 * which on a text column silently matched rows (see the module header).
 */
export function toSqlBindValue(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
