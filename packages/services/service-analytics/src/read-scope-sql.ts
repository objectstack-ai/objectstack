// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { FilterCondition } from '@objectstack/spec/data';
import type { RegisteredErrorCode } from '@objectstack/spec/api';
import { likePattern, LIKE_ESCAPE_CHAR } from './like-pattern.js';

/**
 * Compile an RLS / tenant read-scope `FilterCondition` into a parameterized,
 * alias-qualified SQL predicate (ADR-0021 D-C).
 *
 * This is the single, security-critical translation point between the
 * canonical Mongo-style filter the `RLSCompiler` emits and the raw SQL the
 * analytics `NativeSQLStrategy` runs. It is deliberately:
 *
 *   - **Fail-closed.** Any operator, value shape, or identifier it cannot
 *     translate THROWS. A read-scope predicate must never be silently dropped —
 *     dropping it would run the query unscoped and leak cross-tenant data.
 *   - **Injection-safe.** Field/alias identifiers are validated against a strict
 *     snake_case pattern and every value is bound as a `?` placeholder (the
 *     strategy renumbers `?` → `$N`). No value is ever interpolated into SQL.
 *   - **Alias-qualified.** Bare fields become `"alias"."field"` so the same
 *     predicate applies to the base table or any joined table.
 *
 * Supports the operators the RLS layer and common policies emit: implicit
 * equality, `$eq/$ne/$gt/$gte/$lt/$lte/$in/$nin/$between/$contains/$notContains/
 * $startsWith/$endsWith/$null/$exists`, and `$and/$or/$not` combinators.
 *
 * ## `''` means TRUE, and that is a value — not "nothing happened"
 *
 * `compileNode` returns `''` for a node that constrains nothing (`{}`, an
 * all-TRUE `$and`). That empty string is the boolean constant TRUE, and the two
 * places where a compiler forgets it are exactly where this one used to be
 * wrong (#5297):
 *
 *   - TRUE is the AND identity, so dropping it from a `$and` is correct — but it
 *     ABSORBS a `$or`, so one TRUE disjunct makes the whole `$or` TRUE. Filtering
 *     it out of `$or` (`{$or: [{}, {a: 1}]}` → `a = 1`) silently NARROWED.
 *   - `NOT TRUE ≡ FALSE`, so `{$not: {}}` is the zero-row predicate. Emitting
 *     nothing for it made `compileScopedFilterToSql` return `''`, and
 *     `applyReadScope`'s `if (!sql) return;` then added no `WHERE` at all — a
 *     read scope that should have shown zero rows exposed the whole table. In an
 *     RLS lowering that is a permission bypass, not a rounding error.
 *
 * So a group is now compiled into its own bind buffer and only committed when it
 * survives, and FALSE has a spelling ({@link FALSE_CLAUSE}) instead of being
 * representable only as silence.
 *
 * ## Empty combinators are boolean identities (#5322)
 *
 * `{$and: []}` is TRUE (every row), `{$or: []}` is FALSE (zero rows), and
 * `{$not: {}}` is `NOT TRUE` — FALSE. This compiler used to refuse the empty
 * arrays fail-closed while the five `FILTER_LOGIC_CASES` backends reduced
 * them; the 2026-08-04 #5322 ruling aligned this file and the analytics
 * `filter-normalizer` with the reduction (see the note at the `length === 0`
 * branch in {@link compileNode} for why). Reduction happens structurally over
 * the whole tree, and it composes with the #5146 NULL-safe `$not` rewrite as
 * "reduce first": {@link nullSafeNegationOperand} maps combinator arrays
 * element-wise (an empty array stays empty, a `{}` leaf has no field to
 * guard), so the identity a constant reduces to is untouched by the rewrite
 * and the rewrite only ever guards leaves that survive it.
 *
 * ## `$not` is NULL-safe (#5146)
 *
 * SQL is three-valued and a `WHERE` keeps only TRUE, so a bare `NOT (col = ?)`
 * drops every row whose `col` is NULL — while `driver-memory` and `formula`
 * (and, since #5296, `driver-sql`) return those rows. One read scope, two
 * visible sets, chosen by which backend answered. #5146 ruled the JS answer
 * canonical; {@link nullSafeNegationOperand} here is the same rewrite
 * `sql-driver.ts` applies, so an analytics query and an ordinary `find()` scope
 * the same rows.
 *
 * ## The LIKE family compares LITERALS (#5567)
 *
 * `_` is LIKE's single-character wildcard and `%` its multi-character one, so a
 * comparand concatenated straight into a pattern position stops meaning what the
 * author wrote: `{owner_name: {$contains: '_admin'}}` also admitted `xyadmin`,
 * and `{$contains: '50%'}` also admitted `off 5012 now`. Every LIKE arm below
 * therefore binds an ESCAPED pattern plus its escape character — see
 * `like-pattern.ts` for the transform, for why the escape character is a bound
 * value rather than a SQL literal, and for its correspondence with `driver-sql`'s
 * `applyLike`.
 *
 * On THIS compiler that widening was the #5347 / #5324 shape again: a read scope
 * admitting rows the policy did not is over-reach, not a degraded filter. Note
 * the file was fail-closed everywhere else — the LIKE family was the one place an
 * author's literal was silently reinterpreted rather than refused.
 *
 * ## Every refusal here is a SERVER fault, and says so (#5367, maintainer ruling 2026-08-06)
 *
 * The ten fail-closed refusals below were bare `throw new Error(…)`, and
 * `/analytics/dataset/query` classified them by matching `read-scope-sql` in the
 * message text — the last surviving entry of the hardcoded substring list #5352
 * introduced. It answered `400 DATASET_INVALID`, which was wrong twice:
 *
 *   - **Wrong attribution.** Neither input is the caller's. `filter` is the RLS
 *     `FilterCondition` the security service compiles from an ADMIN-authored
 *     sharing rule / permission set; `alias` is a join alias the DATASET COMPILER
 *     generated. The caller's own predicate travels a different road entirely
 *     (`filter-normalizer.ts`, `INVALID_FILTER` / 400 since #5352). So the two
 *     things that can land here are an administrator's broken policy and drift
 *     between two of OUR components (#5557's `$regex` was exactly the second) —
 *     and for the caller of this request both are a server fault. `400` told them
 *     to fix a request that was never the problem, and hid the fault from the 5xx
 *     alerting that should have seen it.
 *   - **Wrong disclosure.** A 400 echoed the message verbatim, so
 *     `unsafe field identifier "…"` / `unsupported operator "$x" on "owner"`
 *     handed the caller the FIELD NAMES AND COMPARANDS OF THE RLS POLICY — the
 *     one document a tenant must not be able to read out of an error body.
 *
 * {@link readScopeCompileError} is now the only way this module refuses:
 * `READ_SCOPE_COMPILE_FAILED` / **500**. The status is what makes the retirement
 * safe — `rest-server.ts`'s envelope branch is 4xx-only, so a declared 5xx falls
 * through to the `ANALYTICS_QUERY_FAILED` envelope BY DECLARATION rather than by
 * nothing having been declared, and that route withholds the message of any
 * producer that declares a server fault (the full text goes to `logError`).
 *
 * ⚠️ The withhold is NOT inherited from `looksLikeInternalErrorLeak`. That
 * predicate is a heuristic over SQL/driver PHRASING, and measured, every message
 * below returns FALSE from it — so retiring the route's message list on its own
 * would have moved the policy content from a 400 body into a 500 body instead of
 * out of the response. Teaching the heuristic to recognise `[read-scope-sql]`
 * would have been more message sniffing, which is the mechanism #5367 exists to
 * remove; the route keys on the DECLARATION instead.
 *
 * The code is what a machine reads: `dispatcher-plugin.errorResponseBase`, the
 * sibling `/analytics/query` exit, puts a thrown `err.code` in
 * `error.details.code` (#3842), so `READ_SCOPE_COMPILE_FAILED` is legible there
 * without anyone parsing prose.
 *
 * ⚠️ Deliberately NOT a 4xx of any flavour, including a 422. Option A on the
 * decision card was `READ_SCOPE_INVALID` / 422 ("not your fault, not a crash");
 * it was rejected because no consumer reads a code on this path (so a new
 * vocabulary had no measured pull), because a 4xx cannot be fixed by the client
 * and therefore misreports the condition, and because 422 would have left the
 * disclosure question to be re-decided message by message.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/i;

/**
 * `READ_SCOPE_COMPILE_FAILED`, pinned against the ADR-0112 D3 ledger.
 *
 * Typed as `RegisteredErrorCode` so dropping the ledger row (or misspelling the
 * code here) fails `tsc` instead of shipping a code `ApiErrorSchema` rejects.
 */
const READ_SCOPE_COMPILE_FAILED: RegisteredErrorCode = 'READ_SCOPE_COMPILE_FAILED';

/**
 * [#5367] A read-scope lowering failure in the ADR-0112 envelope —
 * `READ_SCOPE_COMPILE_FAILED` / 500.
 *
 * ⛔ **The only way this module refuses.** Module-local for the same reason
 * `filter-normalizer.ts`'s `invalidFilterError` is: every refusing site lives in
 * this one file, so a shared module would buy nothing and a second spelling
 * would cost the invariant. A bare `throw new Error` added below is the defect
 * returning — and a half-enveloped module is indistinguishable from an
 * unenveloped one at the HTTP boundary (the lesson #5352 paid for when seven of
 * `filter-normalizer.ts`'s nine sites stayed bare).
 *
 * The message stays whatever the refusing site says: it is for the operator's
 * log, which after #5367 is its only destination.
 */
function readScopeCompileError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = READ_SCOPE_COMPILE_FAILED;
  err.status = 500;
  return err;
}

/**
 * The FALSE constant. `''` is this compiler's TRUE, so FALSE needs a spelling of
 * its own — `1 = 0` is already what an empty `$in` lowers to, and what
 * `driver-sql` emits for the same identity (#5243).
 */
const FALSE_CLAUSE = '1 = 0';

/** A node the compiler can walk: a plain object, not `null` and not an array. */
function isFilterNode(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function quoteIdent(name: string, kind: string): string {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw readScopeCompileError(`[read-scope-sql] unsafe ${kind} identifier "${String(name)}" — refusing to build read scope (fail-closed).`);
  }
  return `"${name}"`;
}

export function compileScopedFilterToSql(
  filter: FilterCondition,
  alias: string,
): { sql: string; params: unknown[] } {
  const quotedAlias = quoteIdent(alias, 'alias');
  const params: unknown[] = [];
  const sql = compileNode(filter, quotedAlias, params);
  return { sql, params };
}

/**
 * Compile a child node into its OWN bind buffer.
 *
 * A group can turn out to be a boolean identity only after its children have
 * been compiled — and compiling them appends to `params`. Binding straight into
 * the parent's array and then discarding the clause would leave those values
 * behind with no `?` to consume them, shifting every later placeholder onto the
 * wrong value: a read scope that binds the wrong tenant id is worse than one
 * that is merely too wide. Buffer per child, commit only what survives.
 */
function compileSub(node: unknown, qAlias: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const sql = compileNode(node, qAlias, params);
  return { sql, params };
}

/** Compile a filter node into a boolean SQL expression ('' = TRUE, no constraint). */
function compileNode(node: unknown, qAlias: string, params: unknown[]): string {
  if (!isFilterNode(node)) {
    throw readScopeCompileError('[read-scope-sql] read scope must be a filter object (fail-closed).');
  }
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) {
        throw readScopeCompileError(`[read-scope-sql] "${key}" requires an array (fail-closed).`);
      }
      if (value.length === 0) {
        // Boolean identity (#5322 ruling, 2026-08-04): the empty `$and` is the
        // AND identity — TRUE, no constraint — and the empty `$or` is the OR
        // identity — FALSE, zero rows. Until that ruling this compiler REFUSED
        // both ("requires a non-empty array (fail-closed)"), while the five
        // FILTER_LOGIC_CASES backends reduced them; #5322 took the reduction:
        // it is the only reading that lets a nested tree be evaluated at all
        // (a rejection cannot answer what `$and: []` means as the third branch
        // of a `$or`), and `{$or: []}` = zero rows is itself fail-closed for an
        // RLS scope — a disjunct list that loops to zero items hides every row
        // instead of exposing the table (#5134). Authoring-time loud rejection
        // of the literal spelling is tracked separately (#5330).
        if (key === '$or') clauses.push(FALSE_CLAUSE);
        continue;
      }
      const compiled = (value as unknown[]).map((child) => compileSub(child, qAlias));
      // A `''` branch is the constant TRUE. It ABSORBS a disjunction — one TRUE
      // disjunct makes the whole `$or` TRUE — so the group contributes nothing
      // rather than collapsing to its remaining branches, which would have
      // narrowed `{$or: [{}, {a: 1}]}` to `a = 1` (#5297).
      if (key === '$or' && compiled.some((c) => c.sql.length === 0)) continue;
      // For `$and` the same constant is the identity, so it just drops out.
      const kept = compiled.filter((c) => c.sql.length > 0);
      if (kept.length === 0) continue;
      for (const part of kept) params.push(...part.params);
      const joiner = key === '$and' ? ' AND ' : ' OR ';
      clauses.push(`(${kept.map((c) => c.sql).join(joiner)})`);
    } else if (key === '$not') {
      // NULL-safe negation (#5146): totalise the operand's leaves first, so
      // `NOT (…)` can never be UNKNOWN and this compiler admits the same rows
      // `driver-sql` / `driver-memory` / `formula` admit. A non-node operand is
      // left alone so `compileNode` still rejects it with its own message.
      const operand = isFilterNode(value) ? nullSafeNegationOperand(value) : value;
      const inner = compileSub(operand, qAlias);
      if (inner.sql.length === 0) {
        // `NOT TRUE ≡ FALSE`. Emitting nothing here is what let a `{$not: {}}`
        // read scope through `applyReadScope`'s `if (!sql) return;` and ran the
        // analytics query completely unscoped (#5297).
        clauses.push(FALSE_CLAUSE);
      } else {
        params.push(...inner.params);
        clauses.push(`NOT (${inner.sql})`);
      }
    } else if (key.startsWith('$')) {
      throw readScopeCompileError(`[read-scope-sql] unsupported top-level operator "${key}" (fail-closed).`);
    } else {
      clauses.push(compileField(key, value, qAlias, params));
    }
  }
  return clauses.join(' AND ');
}

/** Compile a single `field: value | { $op: ... }` entry. */
function compileField(field: string, value: unknown, qAlias: string, params: unknown[]): string {
  const col = `${qAlias}.${quoteIdent(field, 'field')}`;

  // Scalar / null → implicit equality.
  if (value === null) return `${col} IS NULL`;
  if (typeof value !== 'object' || value instanceof Date) {
    params.push(value);
    return `${col} = ?`;
  }
  if (Array.isArray(value)) {
    throw readScopeCompileError(`[read-scope-sql] bare array value for "${field}" — use { $in: [...] } (fail-closed).`);
  }

  const ops = value as Record<string, unknown>;
  const keys = Object.keys(ops);
  // A value object must be ALL operators; a non-$ key means a nested relation,
  // which a flat read scope cannot join — fail closed.
  if (keys.length === 0 || keys.some((k) => !k.startsWith('$'))) {
    throw readScopeCompileError(`[read-scope-sql] "${field}" has a nested/relation value which is not supported in a read scope (fail-closed).`);
  }

  const parts: string[] = [];
  for (const op of keys) {
    parts.push(compileOperator(col, op, ops[op], field, params));
  }
  return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
}

function bind(params: unknown[], v: unknown): string {
  params.push(v);
  return '?';
}

/**
 * [#5567] Bind a LIKE pattern together with its escape character: `? ESCAPE ?`.
 *
 * Both are ordinary bound values, so this whole concern stays inside the
 * predicate: `applyReadScope` (`native-sql-strategy.ts`) and `generateSql`
 * (`objectql-strategy.ts`) rewrite `?` → `$N` while pushing the matching value
 * from `params`, and they carry the escape character for free — neither consumer
 * needed a change. A SQL literal `ESCAPE '\'` would have pushed the problem up a
 * layer AND been unportable: MySQL strips one backslash inside a string literal,
 * so the literal spelling differs per dialect while a bound value does not.
 *
 * The clause is not optional decoration. SQLite honours no default escape
 * character, so the escaped pattern alone would search for a literal backslash
 * there and match nothing — the two halves are one fix (see `like-pattern.ts`).
 */
function bindLike(params: unknown[], pattern: string): string {
  // Left-to-right evaluation of the template puts the pattern in `params` before
  // the escape character, which is the order the `?` appear.
  return `${bind(params, pattern)} ESCAPE ${bind(params, LIKE_ESCAPE_CHAR)}`;
}

/**
 * [#5298] Wrap a negative-polarity value test so a row whose column has no value
 * SATISFIES it: `(col IS NULL OR <test>)`.
 *
 * The read-scope twin of `driver-sql`'s `applyNullSafeNegative`, and the reason
 * this compiler had to move in the same PR rather than a later one: an RLS rule
 * is authored once and evaluated on BOTH sides — this file lowers it for the
 * read path while `formula`'s `matchesFilterCondition` evaluates it for the
 * write-side `check`. Leaving the two on different answers for `$ne` is one
 * permission rule admitting two different row sets, which is the security
 * defect #5146 named for `$not` and #5298 ruled for the rest.
 *
 * OR-expansion rather than `IS DISTINCT FROM` / `IS NOT` / `<=>`, for the three
 * reasons recorded on the driver-side twin: `NOT LIKE` has no such form, the
 * SQLite spelling depends on an engine version nothing here pins, and the
 * measured query plans are identical either way.
 *
 * The parentheses are not optional. {@link compileField} joins a field's
 * operators with bare ` AND `, so an unwrapped `col IS NULL OR …` would bind
 * looser than that AND and silently widen the whole scope.
 */
function nullSafeNegative(col: string, test: string): string {
  return `(${col} IS NULL OR ${test})`;
}

function compileOperator(col: string, op: string, val: unknown, field: string, params: unknown[]): string {
  switch (op) {
    case '$eq': return val === null ? `${col} IS NULL` : `${col} = ${bind(params, val)}`;
    // [#5298] `$ne: null` stays `IS NOT NULL` — already total, and "has any
    // value" is false for a row that has none. Only the comparison is guarded.
    case '$ne': return val === null ? `${col} IS NOT NULL` : nullSafeNegative(col, `${col} <> ${bind(params, val)}`);
    case '$gt': return `${col} > ${bind(params, val)}`;
    case '$gte': return `${col} >= ${bind(params, val)}`;
    case '$lt': return `${col} < ${bind(params, val)}`;
    case '$lte': return `${col} <= ${bind(params, val)}`;
    case '$in': {
      if (!Array.isArray(val)) throw readScopeCompileError(`[read-scope-sql] $in for "${field}" needs an array (fail-closed).`);
      if (val.length === 0) return FALSE_CLAUSE; // IN () matches nothing — safe
      return `${col} IN (${val.map((v) => bind(params, v)).join(', ')})`;
    }
    case '$nin': {
      if (!Array.isArray(val)) throw readScopeCompileError(`[read-scope-sql] $nin for "${field}" needs an array (fail-closed).`);
      if (val.length === 0) return '1 = 1'; // NOT IN () excludes nothing
      // [#5298] NULL-safe: "not among this list" holds vacuously for a value
      // that is not there.
      return nullSafeNegative(col, `${col} NOT IN (${val.map((v) => bind(params, v)).join(', ')})`);
    }
    case '$between': {
      if (!Array.isArray(val) || val.length !== 2) throw readScopeCompileError(`[read-scope-sql] $between for "${field}" needs [min,max] (fail-closed).`);
      return `${col} BETWEEN ${bind(params, val[0])} AND ${bind(params, val[1])}`;
    }
    // [#5567] The comparand is a LITERAL, so it is escaped and the escape
    // character is bound with it. See {@link bindLike}.
    case '$contains': return `${col} LIKE ${bindLike(params, likePattern('contains', val))}`;
    // [#5298] NULL-safe: `NOT LIKE` is UNKNOWN for a NULL column, and "does not
    // contain" is true of a value that is not there.
    case '$notContains': return nullSafeNegative(col, `${col} NOT LIKE ${bindLike(params, likePattern('contains', val))}`);
    case '$startsWith': return `${col} LIKE ${bindLike(params, likePattern('starts', val))}`;
    case '$endsWith': return `${col} LIKE ${bindLike(params, likePattern('ends', val))}`;
    case '$null': return val ? `${col} IS NULL` : `${col} IS NOT NULL`;
    case '$exists': return val ? `${col} IS NOT NULL` : `${col} IS NULL`;
    default:
      throw readScopeCompileError(`[read-scope-sql] unsupported operator "${op}" on "${field}" (fail-closed).`);
  }
}

// ── [#5146] NULL-safe `$not` ─────────────────────────────────────────────────

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
 * Does a NULL column satisfy this one operator, under the semantics the JS
 * backends (`driver-memory`'s `match`, `formula`'s `matchesFilterCondition`)
 * give it? They evaluate a missing value in ordinary two-valued JS — `undefined
 * !== 'won'` is simply `true` — and #5146 ruled that answer canonical.
 *
 * This is `sql-driver.ts`'s `nullValueSatisfiesOperator` table, entry for entry,
 * with two deliberate differences that come from THIS file's emitter rather than
 * from a different reading of #5146:
 *
 *   - `$null` / `$exists` are read by TRUTHINESS here, because
 *     {@link compileOperator} writes them as `val ? … : …`. `driver-sql` reads
 *     them by identity against `false` because its emitter does. Each guard
 *     matches its own emitter — that is the invariant, not the literal test.
 *   - `$between` exists in this compiler and not in that table; it is a
 *     positive comparison, so it takes the default (a value that is not there
 *     does not lie between two bounds) exactly as the other comparisons do.
 *
 * The default is the large positive-comparison family (`$gt`/`$in`/`$contains`/
 * …), every member of which answers `false` for a value that is not there. An
 * operator this compiler does not support also lands here; it is guarded and
 * then still throws from {@link compileOperator}, so fail-closed is preserved.
 */
function nullValueSatisfiesOperator(op: string, value: unknown): boolean {
  switch (op) {
    // `$eq: null` IS the null predicate; any other comparand is a value test.
    case '$eq': return value === null;
    // Mirror image: `$ne: null` compiles to `IS NOT NULL`, which a NULL fails.
    case '$ne': return value !== null;
    // Truthiness, matching this file's emitter (see the note above).
    case '$null': return Boolean(value);
    case '$exists': return !value;
    // Negative-polarity set / substring tests hold vacuously for an absent value.
    case '$nin': return true;
    // `$notContains` is the one operator where the two JS backends disagree for
    // a null-valued field (`driver-memory` answers false, `formula` true).
    // `formula` is followed because `driver-sql` follows it, so this compiler
    // does not cast a vote on a disagreement that is filed elsewhere.
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
    // A null comparand makes these null PREDICATES too, not comparisons.
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
  if (spec === null) return 'none';
  // A scalar / Date is an implicit `=`; a NULL column fails it. A bare array is
  // REFUSED by `compileField`; classifying it here keeps that refusal reachable
  // (the unrewritten `{field: […]}` conjunct still throws its own message).
  if (typeof spec !== 'object' || spec instanceof Date || Array.isArray(spec)) return 'requireValue';
  const entries = Object.entries(spec as Record<string, unknown>);
  // `{ field: {} }` and any non-`$` key are shapes `compileField` throws on.
  // Passing them through unrewritten is what preserves the exact error; a guard
  // wrapped around them would only change which message the caller sees.
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
 * On an RLS lowering that difference is rows a policy excludes becoming visible,
 * so it is the whole reason this is a rewrite and not a suffix.
 *
 * # Why polarity is per operator
 *
 * A blanket `OR col IS NULL` would WIDEN the negative-polarity operators:
 * `{$not: {a: {$ne: 5}}}` means "a is 5", and both JS backends exclude a NULL
 * row from it. Adding an unconditional null escape there would hand back exactly
 * the rows the scope excludes. So each leaf is guarded in the direction its own
 * operator answers, per {@link nullValueSatisfiesOperator}.
 *
 * The rewrite runs ONLY inside a `$not`; an ordinary comparison's SQL is
 * untouched, so nothing outside a negation changes shape. A nested `$not` is
 * left alone on purpose — its own branch totalises its operand, and
 * `NOT <total>` is itself total, so recursing would stack a redundant guard on
 * the same column.
 */
function nullSafeNegationOperand(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const guarded: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      // A non-node element is passed through so `compileNode` still rejects it.
      out[key] = value.map((element) => (isFilterNode(element) ? nullSafeNegationOperand(element) : element));
      continue;
    }
    if (key.startsWith('$')) {
      // `$not` (handled by its own branch) and anything else `$`-prefixed keep
      // whatever this compiler does with them today — the rewrite rules on NULL,
      // not on the operator vocabulary, and an unknown one must still throw.
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
      // `col IS NULL OR (…)` — one conjunct, so the OR binds tighter than the
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
