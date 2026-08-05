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
 * # A STRING comparand keeps its spelling (#5528, partial)
 *
 * #5332 is about the ENCODER ({@link stringifyForCube}); the same round trip has
 * a DECODER — {@link recoverNumber}, behind {@link coerceFilterValueForSql} and
 * {@link coerceFilterValueForObjectQL} — and it was guessing "this is a number"
 * from the string's shape alone. So `{code: {$eq: '007'}}` bound the integer `7`
 * and `{price: {$eq: '1.50'}}` bound `1.5`, on both consumers: against a TEXT
 * column that is zero rows on SQLite and a type error on Postgres, reported to
 * the author as "no data" (#5526's measured table).
 *
 * Recovery is now limited to a number's own canonical spelling
 * (`String(Number(s)) === s`), which is exactly what a real number comparand
 * produces on the way out — so `7` → `'7'` → `7` still works, while a string
 * that `Number()` would rewrite is kept as the author wrote it.
 *
 * This is a STOPGAP, and named as one: `values: string[]` still has no escape,
 * so the author strings `'null'` / `'true'` / `'false'` still collide with the
 * tokens the encoder writes for the real values. Fixing the round trip itself —
 * tagged values, or an `unknown[]` internal representation — is #5526.
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
 * Row-result cover: `filter-operator-coverage.test.ts` for the operator
 * vocabulary, `native-sql-filter-logic-conformance.test.ts`, which runs the
 * SHARED combinator table (`FILTER_LOGIC_CASES`, #3774) that the SQL compiler,
 * the in-memory matcher, `formula` and `read-scope-sql` are already held to,
 * `filter-normalizer-not-null-safe.test.ts` for the two squares that table
 * deliberately does not carry (NULL handling, boolean identities), and
 * `filter-array-lowering.test.ts` for the array door (#5334).
 */

import { isFilterAST, parseFilterAST, VALID_AST_OPERATORS } from '@objectstack/spec/data';
import { StandardErrorCode } from '@objectstack/spec/api';

export interface NormalizedAnalyticsFilter {
  member: string;
  operator: string;
  values: string[];
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
};

/**
 * Stringify a filter value as the internal pipeline requires `values: string[]`.
 *
 * Booleans serialize as the tokens `'true'`/`'false'` (NOT `'1'`/`'0'`) so the
 * boolean identity survives the string roundtrip: the consuming strategies can
 * recover a real boolean for the ObjectQL engine (which compares against the
 * stored boolean type) while still binding `1`/`0` for SQL. Stringifying to
 * `'1'`/`'0'` was indistinguishable from a numeric 1/0 and made every boolean
 * equality filter / boolean group-by compare a number against a boolean — and
 * never match.
 *
 * The `v == null → ''` arm is NOT a spelling of "is null": `values` is
 * `string[]`, which has no null, so every leaf that MEANS null is emitted as
 * `notSet` / `set` with EMPTY `values` and never calls this function — the
 * `raw === null` branch, `$null` / `$exists`, and since #5332 a `null` comparand
 * of `$eq` / `$ne`, which used to arrive here and become `= ''`. What still
 * reaches this arm is a comparand position no ruling covers (`$gt: null`,
 * `$in: [null]`), where `''` is a placeholder rather than an answer; #5332 scoped
 * itself to the two spellings `filter.zod.ts` gives a null MEANING and left this
 * arm untouched.
 */
function stringifyForCube(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
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
 */
export type NormalizedFilterNode =
  | { kind: 'leaf'; member: string; operator: string; values: string[] }
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
 * Compile one `field: value | { $op: … }` entry into its leaves.
 *
 * Multiple operators on one field AND together — the rule
 * `FILTER_LOGIC_CASES` pins for every other backend, and the one a range
 * `{ $gte, $lte }` depends on.
 */
function fieldLeaves(key: string, raw: unknown): NormalizedFilterNode[] {
  const out: NormalizedFilterNode[] = [];
  const leaf = (operator: string, values: string[]): void => {
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
          leaf('gte', [stringifyForCube(v[0])]);
          leaf('lte', [stringifyForCube(v[1])]);
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
        // write). `stringifyForCube`'s wider `v == null` test is untouched — it
        // still serves the comparand positions this branch does not claim.
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
        leaf(cubeOp, Array.isArray(v) ? v.map(stringifyForCube) : [stringifyForCube(v)]);
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
    else leaf('in', raw.map(stringifyForCube));
  } else leaf('equals', [stringifyForCube(raw)]);
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
    if (raw === undefined) continue;

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
 * Normalize an analytics query's `where` into the tree the strategies compile.
 * `null` when the query carries no `where` — i.e. no constraint.
 *
 * `where` is declared a `FilterCondition` (`AnalyticsQuerySchema`), and the
 * object form is the whole of the contract downstream. An ARRAY nevertheless
 * arrives — it is the `FilterArray` authoring sugar four published contracts
 * teach, and analytics is a door into the runtime like any other — so it is
 * LOWERED here (#5334, on #5158's ruling C), giving the same three answers
 * `ObjectQL`'s six entry points give since #5329:
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
    return buildNode(condition as Record<string, unknown>);
  }

  return buildNode(where as Record<string, unknown>);
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
 * Recover a finite number from a token that is a number's OWN canonical
 * spelling — `String(Number(s)) === s` — else undefined.
 *
 * This is the decoder half of the `values: string[]` round trip
 * {@link stringifyForCube} encodes into, and it is a LAST RESORT by design:
 * ADR-0053 D-A2 demoted textual type re-derivation behind the driver-backed
 * `coerceTemporalFilterValue` hook, leaving this function only the
 * boolean/number recovery for non-temporal columns. Guessing a type from a
 * string's shape can only ever be a guess, so the narrower the guess, the fewer
 * author values it can overwrite.
 *
 * # Why canonical form, not "looks numeric" (#5528, route C of #5526)
 *
 * The test used to be the SHAPE alone (`/^-?\d+(\.\d+)?$/`), which cannot tell
 * a number that was stringified on the way out from a string the author wrote.
 * `'007'` came back as `7` and `'1.50'` as `1.5` — on BOTH consumers (the SQL
 * bind in `native-sql-strategy` and the engine comparand in
 * `objectql-strategy`) — so a widget filtered `{code: {$eq: '007'}}` compared an
 * INTEGER against a TEXT column: zero rows on SQLite (cross-type compare is
 * never equal), a type error on Postgres. Silent, and drawn as "no data".
 *
 * Zero-padded and trailing-zero strings are ordinary business shapes — order
 * numbers, work orders, SKUs, dialling codes, postcodes, `'1.50'` prices — not
 * constructed edge cases (#5526's measured table).
 *
 * The canonical-form test separates the two cases without needing a type:
 *
 *   - a comparand that REALLY was a number arrives as `String(n)` by
 *     construction, so it round-trips exactly and is still recovered
 *     (`7` → `'7'` → `7`, `1.5` → `'1.5'` → `1.5`, `-3` → `'-3'` → `-3`);
 *   - a string that survived `Number()` with information LOST — a leading zero,
 *     a trailing zero, `'-0'`, more digits than a double can hold — cannot have
 *     come from a number, so it is the author's string and stays one.
 *
 * The shape regex is kept AHEAD of the round-trip test so this change can only
 * ever NARROW what is recovered: `'1e3'`, `'1e+21'`, `'+7'`, `' 7'`, `'0x10'`,
 * `'Infinity'` and `'NaN'` were strings before and are strings still, even
 * though some of them are canonical `String(Number(…))` output.
 *
 * ⛔ **Not fixed here, on purpose.** `'null'` / `'true'` / `'false'` still
 * collide with the tokens {@link stringifyForCube} writes for the real `null`
 * and booleans, so those three author strings still decode to non-strings. That
 * collision is not a bad `if` — it is the `string[]` encoding having no escape,
 * i.e. the root cause #5526 exists to rule on (tagged encoding, or an
 * `unknown[]` internal representation). This function only stops the shapes that
 * are unambiguously lossy from being downgraded; it does not make the round trip
 * lossless.
 */
function recoverNumber(s: string): number | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  // The round-trip test: only a string that IS `n`'s canonical spelling carries
  // no writing `Number()` threw away, so only that string can be read as `n`.
  if (String(n) !== s) return undefined;
  return n;
}

/**
 * Coerce a stringified filter value back into a runtime type for SQL
 * parameter binding. Better-sqlite3 (and most drivers) cannot bind a JS
 * boolean, so booleans are recovered as `1`/`0` integers; numbers are
 * recovered as numbers — avoiding string-vs-number mismatches against typed
 * columns.
 *
 * "Numbers" means only a number's own canonical spelling — see
 * {@link recoverNumber} for why `'007'` and `'1.50'` bind as TEXT (#5528).
 */
export function coerceFilterValueForSql(s: string): unknown {
  if (s === 'true') return 1;
  if (s === 'false') return 0;
  if (s === 'null') return null;
  return recoverNumber(s) ?? s;
}

/**
 * Coerce a stringified filter value back into a runtime type for the ObjectQL
 * aggregate engine. Unlike the SQL path, the engine compares against the
 * *stored* runtime type, so a boolean field holds a real `true`/`false` — bind
 * the boolean itself, NOT `1`/`0`, or the equality never matches.
 *
 * The number recovery is the SAME canonical-form test the SQL path uses
 * ({@link recoverNumber}): the two consumers differ in how they spell a boolean,
 * never in which strings they consider numbers, so `{code: {$eq: '007'}}` binds
 * the string `'007'` on both paths (#5528).
 */
export function coerceFilterValueForObjectQL(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  return recoverNumber(s) ?? s;
}
