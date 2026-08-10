// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { FilterCondition } from '@objectstack/spec/data';
import type { RegisteredErrorCode } from '@objectstack/spec/api';
import { likePattern, LIKE_ESCAPE_CHAR, asciiLowerSqlExpr } from './like-pattern.js';
import {
  isBindableComparand,
  isRenderableTextComparand,
  unbindableListMemberMessage,
  unrenderableTextComparandMessage,
} from './comparand-shape.js';

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
 * sibling `/analytics/query` exit, puts a thrown `err.code` on the wire at
 * `error.code` (#3842), so `READ_SCOPE_COMPILE_FAILED` is legible there without
 * anyone parsing prose.
 *
 * ⚠️ At `error.code` — NOT `error.details.code`, which is where this note
 * pointed until #6123 corrected it. `errorResponseBase` only STAGES the code in
 * a `details` object; `buildApiError` then runs `splitSemanticCode`
 * (`@objectstack/runtime`, `src/error-envelope.ts:117`), which PROMOTES it into
 * the declared `ApiErrorSchema` field and returns the now-empty `details` as
 * `undefined` — so the key is omitted from the body and `error.details.code` is
 * never present to read. The measured 500 body is exactly:
 *
 * ```json
 * {"success":false,"error":{"code":"READ_SCOPE_COMPILE_FAILED",
 *  "message":"Internal server error","httpStatus":500}}
 * ```
 *
 * Pinned end-to-end in `@objectstack/runtime`'s
 * `analytics-query-read-scope-withhold.test.ts`, which asserts the code at
 * `error.code` against a real `AnalyticsService` on a real mounted route.
 *
 * ⚠️ Deliberately NOT a 4xx of any flavour, including a 422. Option A on the
 * decision card was `READ_SCOPE_INVALID` / 422 ("not your fault, not a crash");
 * it was rejected because no consumer reads a code on this path (so a new
 * vocabulary had no measured pull), because a 4xx cannot be fixed by the client
 * and therefore misreports the condition, and because 422 would have left the
 * disclosure question to be re-decided message by message.
 *
 * ## An `undefined` comparand is refused, not bound (#6125, PM ruling 2026-08-07)
 *
 * That makes ELEVEN refusing sites; the envelope above is what all eleven carry,
 * and {@link undefinedComparandError} is the eleventh. #6050 ruled on 2026-08-07
 * that `undefined` in a comparand position is refused everywhere (ruling B), and
 * implemented it on `driver-sql` / `driver-turso` — the surfaces where the shape
 * was PROVEN reachable. This module was measured in the same round and answered
 * a fourth way again: legal SQL, one bound NULL, and not a single log line.
 *
 * The #6125 ruling scoped the push-down to THIS file and kept its own envelope
 * (`READ_SCOPE_COMPILE_FAILED` / 500 — see above): a read scope is compiled by
 * the platform from CEL and stored metadata, so telling the caller to fix their
 * request would name the wrong author. `@objectstack/formula` reads the same
 * value as a THIRD semantics ("the key is absent from the record") and is
 * deliberately left alone — deciding it here would settle #5299's
 * key-missing-vs-value-null question as a side effect — and `driver-memory` /
 * `driver-mongodb` stay pin-only under the #5499 freeze.
 *
 * The eleventh message was measured against `looksLikeInternalErrorLeak` before
 * being added, because the section above turns on that predicate answering FALSE
 * for this family: it does for all four positions, so the new refusal is
 * withheld from the response BY DECLARATION exactly like the other ten, and no
 * message-sniffing list learns a twelfth phrase.
 *
 * ## A non-boolean `$null` / `$exists` is refused too (#6387, applying #5347 / #5369)
 *
 * TWELVE refusing sites, and {@link nonBooleanFlagComparandError} is the
 * twelfth's — ONE message for BOTH operators, because both failed the same way
 * (see that function for the measured table and the #5240 argument). #5347 and
 * #5369 refused a non-boolean comparand for these two operators on `driver-sql`;
 * #6387 measured that neither ruling had been pushed down here, where the
 * emitter still read them by plain TRUTHINESS. The consequence was sharper than
 * on the driver face: `{ $exists: "false" }`, written to scope to rows with NO
 * owner, compiled to `IS NOT NULL` — the rows that HAVE one. In a module whose
 * contract is fail-closed, that is a WIDENING, which is why this cell was graded
 * above #6125's silent-zero-rows one even though its reachability is narrower
 * (measured: not reachable from stored metadata — the CEL lowering emits `$null`
 * only with hard-coded booleans and `$exists` never; reachable only from an
 * in-process `getReadScope` producer).
 *
 * The twelfth site is one gate over TWO triggers, exactly like `quoteIdent`'s
 * alias-vs-field split, and the refusal-envelope inventory lists it as two rows
 * over one site for that reason. The message was measured against
 * `looksLikeInternalErrorLeak` too — FALSE, like the other eleven — so it is
 * withheld from the response BY DECLARATION and teaches no sniffing list a new
 * phrase.
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

  // [#6125] `undefined` in a comparand position, refused before anything binds —
  // and after `quoteIdent`, so an unsafe identifier (the injection vector) keeps
  // its own message and its precedence. See {@link assertDefinedComparands} for
  // why this one call site covers the whole tree.
  assertDefinedComparands(field, value);

  // [#6387] …and the two comparands that are NOT positions but DOMAINS: `$null`
  // and `$exists` take a declared boolean. Deliberately a second call rather
  // than a widened first one — the two gates gate different things, and their
  // domains are disjoint by construction (`assertDefinedComparands` skips these
  // two operators by name), so neither can shadow the other's message.
  assertBooleanFlagComparands(field, value);

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

/**
 * [#5234] The comparand-SHAPE gate for this door.
 *
 * `compileScopedFilterToSql` takes a `FilterCondition` that never passes through
 * `filter-normalizer`'s `fieldLeaves`, so this module needs the two checks in
 * its own right — same rule, stated once in `comparand-shape.ts`, wrapped in
 * THIS module's envelope. The envelope difference is the point: a read scope is
 * compiled from a policy, not authored by the caller, so an uncompilable
 * comparand here is a 500 fail-closed refusal (see the header) rather than a 400.
 *
 * The direction matters more here than anywhere else this rule lands. A
 * read-scope `{$nin: [{…}]}` compiled to `NOT IN ('[object Object]')`, which
 * excludes NOTHING — the scope's exclusion silently did not happen, which is
 * over-reach on a tenant/RLS predicate rather than a loose filter. That is the
 * same reading #5347 / #5324 made on this very file, and the reason the #5234
 * issue's "fail-closed, so lower risk" framing does not survive contact with the
 * `$nin` / `$notContains` half.
 */
function assertCompilableMembers(op: string, field: string, members: unknown[]): void {
  members.forEach((member, index) => {
    if (!isBindableComparand(member)) {
      throw readScopeCompileError(`[read-scope-sql] ${unbindableListMemberMessage(op, field, member, index)}`);
    }
  });
}

/** [#5234] See {@link assertCompilableMembers}; this is the LIKE-family half. */
function assertRenderableText(op: string, field: string, val: unknown): void {
  if (isRenderableTextComparand(val)) return;
  throw readScopeCompileError(`[read-scope-sql] ${unrenderableTextComparandMessage(op, field, val)}`);
}

/**
 * [#6125, PM ruling 2026-08-07] `undefined` in a COMPARAND position.
 *
 * ONE wording for all four positions #6125 measured (#5240 — one condition, one
 * wording); only `path` varies, because only the position does. What the four
 * had in common is why a shared sentence is right rather than merely shorter:
 * every one of them compiled to legal SQL with the JS value `undefined` in the
 * bind list, which the external driver renders as NULL — and every comparison
 * against NULL is UNKNOWN, so the scope matched ZERO rows and said nothing.
 *
 * Re-measured on `origin/main` (`d8e8d9cbc`) with the refusal disabled, alias
 * `t`, field `d` — the same four rows #6125's table recorded on `cba7454df`:
 *
 * | read scope | compiled to | bind list |
 * |---|---|---|
 * | `{ d: undefined }`            | `"t"."d" = ?`                                 | `[undefined]` |
 * | `{ d: { $gt: undefined } }`   | `"t"."d" > ?`                                 | `[undefined]` |
 * | `{ d: { $in: [undefined] } }` | `"t"."d" IN (?)`                              | `[undefined]` |
 * | `{ $not: { d: undefined } }`  | `NOT (("t"."d" IS NOT NULL AND "t"."d" = ?))` | `[undefined]` |
 *
 * ⚠️ `[undefined]`, not `[null]` — one correction to the issue's table. Nothing
 * in this package coerces it: `applyReadScope` (`native-sql-strategy.ts`) pushes
 * `scopeParams[i]` into the driver's bind array verbatim while it renumbers
 * `?` → `$N`. So the NULL is the DRIVER's reading of a JS `undefined`, which is
 * also why the same cell reads as a bare `Undefined binding(s)` crash on the
 * drivers that refuse to guess (#6050's LOCAL column). Two failure modes from
 * one bind, decided by which driver the datasource happens to be — the reason
 * this is refused at the compiler and not repaired at any one consumer.
 *
 * ⛔ What deliberately does NOT move: `null`. `{ d: null }`, `{ $eq: null }`,
 * `{ $ne: null }`, `$null` and `$exists` keep their exact lowering — `null` IS a
 * declared comparand and IS the null predicate, and the whole point of this
 * refusal is the JS value that cannot be told apart from an ABSENT key. ⚠️ Read
 * `$null` / `$exists` there as "with their declared BOOLEAN comparand": #6387
 * later refused every other comparand for those two, `{ $null: null }` included,
 * on the separate domain grounds {@link assertBooleanFlagComparands} states. The
 * `null` this paragraph promises not to move is `null` in a COMPARAND position,
 * which is untouched by both changes and still pinned row for row. Pinned
 * as its own control group in `read-scope-undefined-comparand.test.ts`, because
 * refusing `null` along with `undefined` is the way this change could do harm.
 *
 * ## Why the direction here is not #6050's direction
 *
 * On `driver-sql` the same shape was over-reach: `{ owner_id: ctx.user?.id }`
 * with a missing id compiled to `IS NULL` on Turso's remote transport and
 * matched every env-wide row. Here it is fail-CLOSED — zero rows, never extra
 * rows — so this is not a latent permission bypass and was not graded as one.
 * It is refused anyway because a read scope that answers a question nobody asked,
 * with no log line, is indistinguishable from one that worked: the value of this
 * change is turning silence into noise, which is exactly the grading #6125's
 * ruling recorded.
 */
function undefinedComparandError(field: string, path: string): Error {
  return readScopeCompileError(
    `[read-scope-sql] comparand at ${path} is undefined — refusing to build read scope (fail-closed). ` +
      `@objectstack/spec FieldOperatorsSchema declares no undefined comparand, and in JavaScript a key ` +
      `whose value is undefined cannot be told apart from an ABSENT key — yet the two mean OPPOSITE ` +
      `things (a predicate versus no constraint at all), so there is no reading of it that is not a ` +
      `guess. It used to compile: undefined went into the bind list, the driver read it as SQL NULL, ` +
      `every comparison against NULL is UNKNOWN, and the scope matched ZERO rows in silence. Write null if the null ` +
      `predicate was meant ({ "${field}": null } or { "${field}": { "$null": true } }), or omit the key ` +
      `when the value is genuinely absent. The producer to fix is whoever BUILT this read scope — an ` +
      `admin-authored sharing rule / permission set, its CEL lowering, or the in-process code that ` +
      `assembled the FilterCondition — never the caller of this query, who cannot author it (#6050 ` +
      `ruling B, pushed down to this compiler by #6125).`,
  );
}

/**
 * [#6125] Refuse every `undefined` sitting in a comparand position of ONE field
 * constraint.
 *
 * The positions are enumerated rather than swept, because "comparand" is a
 * POSITION and not a type:
 *
 *   - the DIRECT comparand — `{ d: undefined }`, the implicit `=`;
 *   - an OPERATOR's comparand — `{ d: { $gt: undefined } }`, `$eq`, `$ne`, the
 *     LIKE family, every other single-value operator;
 *   - a MEMBER of a list operator's array — `{ d: { $in: [undefined] } }`,
 *     `$nin`, `$between`. The array itself IS `$in`'s legitimate comparand;
 *     each element is a comparand in its own right, which is the same split
 *     {@link assertCompilableMembers} already makes.
 *
 * Three positions are deliberately NOT swept, each because this module already
 * refuses the enclosing shape with a TRUER diagnosis — #5240's rule read in the
 * direction that matters here, since a second wording for a shape that is
 * refused either way only sends the operator to the wrong repair:
 *
 *   - `$null` / `$exists`. Their comparand is a declared BOOLEAN — a flag, not a
 *     value to compare against — so `undefined` there is not a comparand at all.
 *     `driver-sql`'s twin skips them for the same reason. ✅ [#6387] And it now
 *     skips them the way that twin does: to a boolean-DOMAIN gate,
 *     {@link assertBooleanFlagComparands}, which #6387 pushed down from #5347 /
 *     #5369. When this note was written that gate did not exist here, so
 *     `{ $null: undefined }` lowered by truthiness to `IS NOT NULL` and
 *     `{ $null: "false" }` — the STRING, which is truthy — landed on the side
 *     opposite the `false` it was written to mean. Both are refused today, and
 *     `undefined` is refused there rather than here on purpose: outside the
 *     declared domain is a truer diagnosis for a flag than "this comparand
 *     position is undefined".
 *   - a bare ARRAY in direct comparand position (`{ d: [1, undefined] }`).
 *     {@link compileField} refuses the array as a whole ("use `{ $in: [...] }`"),
 *     and inspecting its members here would relabel a shape refused either way.
 *   - a NON-`$` key inside the constraint object (`{ owner: { manager_id:
 *     undefined } }`). That is a nested relation, which {@link compileField}
 *     refuses outright; answering "the comparand is undefined" would send the
 *     operator to write `null` there, and `{ owner: { manager_id: null } }` does
 *     not compile either. This is the one deliberate divergence from
 *     `driver-sql`'s twin, and it comes from THIS module refusing nested
 *     relations — not from a different reading of #6050.
 *
 * ## Why the call site is {@link compileField} and not a pre-pass
 *
 * `driver-sql` refuses on its separate validating walk because its emitter
 * short-circuits: a boolean identity can resolve an enclosing node before a
 * malformed sibling is ever visited, so a gate in the emitter would be
 * conditional on evaluation order. THIS compiler has no such blind spot —
 * {@link compileNode} `.map()`s every `$and`/`$or` child into its own buffer
 * BEFORE any identity is applied (the `$or` TRUE-absorption and the `$and`
 * identity filter both read the fully-compiled list), and
 * {@link nullSafeNegationOperand} rewrites a `$not` operand without dropping a
 * single leaf. Every comparand therefore reaches `compileField`, which is also
 * the only path to {@link bind} — one gate, on the one road.
 *
 * The other half of `driver-sql`'s "runs FIRST" argument does not transfer
 * either, and that is worth stating rather than copying: there, the refusal had
 * to precede the `$not` rewrite because the polarity tables spelled `=== null`
 * while the `$ne` emitter spelled `== null`, so the two disagreed about
 * `undefined` itself. Here {@link nullValueSatisfiesOperator},
 * {@link operatorIsNullTotal} and every arm of {@link compileOperator} spell it
 * `=== null` alike, so the tables and the emitter agree that `undefined` is "a
 * value" — the rewrite for a `{ $not: … }` operand runs, produces a leaf, and
 * that leaf is refused. Nothing inconsistent is being outrun; the silent NULL
 * bind is.
 */
function assertDefinedComparands(field: string, spec: unknown): void {
  const root = `"${field}"`;
  if (spec === undefined) throw undefinedComparandError(field, root);
  if (!isFilterNode(spec)) return;
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
 * [#6387, applying #5347 / #5369] `$null` / `$exists` whose comparand is not a
 * boolean.
 *
 * ## ONE wording for BOTH operators (#5240), and why that is right here
 *
 * `driver-sql` gives its twins two messages, because each names the direction
 * ITS OWN emitter defaulted to and those directions differ. This module had one
 * emitter rule covering both — plain TRUTHINESS — so both operators failed the
 * same way, in the same sentence, and #5240's rule applies in the direction it
 * usually does: one condition, one wording. Only the operator NAME and the
 * `path` vary, and `read-scope-boolean-flag-comparand.test.ts` pins that "only
 * those vary" so a later change cannot give one of them a bespoke phrasing.
 *
 * ## What it used to do — measured on `origin/main` (`5faa23ca3`), alias `t`
 *
 * The emitter read `val ? … : …`, so every non-boolean was sorted by JS
 * truthiness into one of the two declared answers:
 *
 * | read scope | compiled to | |
 * |---|---|---|
 * | `{ owner_id: { $null: "false" } }`  | `"t"."owner_id" IS NULL`     | ⛔ the OPPOSITE of what was written |
 * | `{ owner_id: { $null: "true" } }`   | `"t"."owner_id" IS NULL`     | |
 * | `{ owner_id: { $null: 0 } }`        | `"t"."owner_id" IS NOT NULL` | |
 * | `{ owner_id: { $null: null } }`     | `"t"."owner_id" IS NOT NULL` | |
 * | `{ owner_id: { $null: undefined } }`| `"t"."owner_id" IS NOT NULL` | |
 * | `{ owner_id: { $exists: "false" } }`| `"t"."owner_id" IS NOT NULL` | ⛔ the OPPOSITE of what was written |
 * | `{ owner_id: { $exists: 0 } }`      | `"t"."owner_id" IS NULL`     | |
 * | `{ owner_id: { $exists: "no" } }`   | `"t"."owner_id" IS NOT NULL` | |
 *
 * The string `"false"` is TRUTHY, so the two rows marked ⛔ are the ones that
 * matter: a scope written to say "rows with NO owner" compiled to "rows that
 * HAVE one". Unlike #6125's cell — which was fail-CLOSED, zero rows, merely
 * silent — this direction ADMITS the rows the policy meant to exclude, in a
 * module whose own contract is "a read-scope predicate must never be silently
 * dropped". That is why the disposition needed no new judgement: #5347 (`$null`)
 * and #5369 (`$exists`) already refused this shape on `driver-sql`, and their
 * stated reason transfers word for word.
 *
 * ## ⚠️ Reachability, measured — and the half that came back NEGATIVE
 *
 * #6387 asked for a decisive answer to "can `{ $null: <non-boolean> }` travel
 * from STORED metadata to this compiler". Measured on `5faa23ca3`, it cannot —
 * three independent gates close that road, and this is recorded because the
 * issue's severity argument rested on it:
 *
 *   1. `RowLevelSecurityPolicySchema` declares `using` / `check` as `z.string()`
 *      — a CEL predicate, not a `FilterCondition`. A stored object is rejected
 *      at write ("expected string, received object").
 *   2. The CEL lowering never emits this shape. `@objectstack/formula`'s
 *      `cel-to-filter.ts` emits `$null` at exactly two sites, both with a
 *      HARD-CODED boolean (`== null` → `{ $null: true }`, `!= null` →
 *      `{ $null: false }`), and emits `$exists` nowhere at all. An unresolved
 *      `current_user.*` yields `unresolved-variable` → the policy drops → the
 *      deny sentinel, never a stray comparand.
 *   3. Even bypassing the schema, a raw object predicate throws inside
 *      `sqlPredicateToCel` (`expression.replace is not a function`), and
 *      `getReadFilter`'s catch turns that into `RLS_DENY_FILTER`. A JSON STRING
 *      of a FilterCondition stores fine and then fails to parse as CEL → `null`
 *      → deny. Both roads end fail-closed.
 *
 * The other read-scope producers cannot emit it either: the Layer 0 tenant
 * filter, `plugin-sharing`'s `buildReadFilter` (`{owner: id}` / `$in` / `$or` /
 * `{id:'__deny_all__'}`), the controlled-by-parent filter (`{fk: {$in: […]}}`)
 * and `RLS_DENY_FILTER` contain no `$null` or `$exists` at all.
 *
 * ⚠️ What IS open, and why this gate is still worth having: `getReadScope` is a
 * DOCUMENTED public option on `AnalyticsPluginOptions` (`plugin.ts`), so a host
 * that supplies its own read scope — from JSON config, or from JS where the
 * `FilterCondition` type is not checked — is a live producer with no gate
 * between it and here. #6387 also confirmed the issue's other measurement:
 * `plugin-security` performs no `FilterConditionSchema` / `safeParse` anywhere
 * on this path. So the shape is not reachable from stored metadata TODAY, and
 * nothing structural stops the next producer; refusing it at the compiler is
 * what makes "declared boolean" mean enforced boolean regardless of who writes
 * the scope. Graded on that measurement, not on the issue's opening wording.
 */
function nonBooleanFlagComparandError(op: string, field: string, path: string): Error {
  return readScopeCompileError(
    `[read-scope-sql] comparand for "${op}" at ${path} is not a boolean — refusing to build read scope ` +
      `(fail-closed). @objectstack/spec FieldOperatorsSchema declares both $null and $exists as ` +
      `z.boolean(), and this compiler used to read the comparand by TRUTHINESS instead — so a ` +
      `non-boolean was silently sorted into one of the two declared answers rather than refused. The ` +
      `string "false" is TRUTHY, which is the case that matters: it landed on the side OPPOSITE the ` +
      `false it was written to mean, turning "rows with no ${field}" into "rows that have one" — a ` +
      `read scope that ADMITS the rows the policy excludes. Write the boolean itself (true or false), ` +
      `not a string, a number, null or undefined. The producer to fix is whoever BUILT this read ` +
      `scope — an admin-authored sharing rule / permission set, its CEL lowering, or the in-process ` +
      `code (a getReadScope option) that assembled the FilterCondition — never the caller of this ` +
      `query, who cannot author it (#5347 / #5369, pushed down to this compiler by #6387).`,
  );
}

/**
 * [#6387] Refuse a non-boolean `$null` / `$exists` comparand on ONE field
 * constraint.
 *
 * `hasOwnProperty` rather than `in`, so an inherited key can never trip the
 * gate, and rather than `Object.hasOwn` to match `driver-sql`'s twin
 * (`reduceFilterKey`) line for line. `{ $null: undefined }` DOES count: the key
 * is own and enumerable, and `undefined` is one of the comparands #6387
 * measured a flip on — it lowered to `IS NOT NULL`, which
 * `read-scope-undefined-comparand.test.ts` pinned as "the cell #6125
 * deliberately left alone". This is the ruling that picks it up. Refusing it
 * here rather than in {@link assertDefinedComparands} keeps that gate's claim
 * honest — `undefined` is refused as a value OUTSIDE the declared BOOLEAN
 * DOMAIN, which is a truer diagnosis than "a comparand position is undefined"
 * for a flag that was never a comparand position.
 *
 * ## Why this call site, and not the `$not` pre-pass
 *
 * Same reason {@link assertDefinedComparands} sits here: {@link compileField} is
 * the one road every field constraint travels, because {@link compileNode}
 * `.map()`s every child into its own buffer BEFORE any boolean identity is
 * applied, so no sibling can absorb a malformed one. It runs AFTER
 * {@link nullSafeNegationOperand} for a `$not` operand — harmless, and worth
 * stating: that rewrite consults {@link nullValueSatisfiesOperator}, which now
 * reads these two by identity, so a non-boolean is classified before it is
 * refused. The classification is DISCARDED either way (the leaf still reaches
 * `compileField` and still throws), and the rewrite's own synthesised leaves
 * (`{ $null: false }`, `{ $null: true }`) are literal booleans by construction.
 */
function assertBooleanFlagComparands(field: string, spec: unknown): void {
  if (!isFilterNode(spec)) return;
  for (const op of ['$null', '$exists'] as const) {
    if (!Object.prototype.hasOwnProperty.call(spec, op)) continue;
    if (typeof spec[op] === 'boolean') continue;
    throw nonBooleanFlagComparandError(op, field, `"${field}".${op}`);
  }
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
      assertCompilableMembers(op, field, val);
      return `${col} IN (${val.map((v) => bind(params, v)).join(', ')})`;
    }
    case '$nin': {
      if (!Array.isArray(val)) throw readScopeCompileError(`[read-scope-sql] $nin for "${field}" needs an array (fail-closed).`);
      if (val.length === 0) return '1 = 1'; // NOT IN () excludes nothing
      assertCompilableMembers(op, field, val);
      // [#5298] NULL-safe: "not among this list" holds vacuously for a value
      // that is not there.
      return nullSafeNegative(col, `${col} NOT IN (${val.map((v) => bind(params, v)).join(', ')})`);
    }
    case '$between': {
      if (!Array.isArray(val) || val.length !== 2) throw readScopeCompileError(`[read-scope-sql] $between for "${field}" needs [min,max] (fail-closed).`);
      assertCompilableMembers(op, field, val);
      return `${col} BETWEEN ${bind(params, val[0])} AND ${bind(params, val[1])}`;
    }
    // [#5567] The comparand is a LITERAL, so it is escaped and the escape
    // character is bound with it. See {@link bindLike}.
    // [#5234] …and it must be a value `String()` can render, which is asserted
    // BEFORE `likePattern` sees it — see {@link assertRenderableText}.
    case '$contains': assertRenderableText(op, field, val); return `${col} LIKE ${bindLike(params, likePattern('contains', val))}`;
    /**
     * [#6520] `$icontains` on the READ-SCOPE lowering — the one compiler in this
     * package where a wrong answer is an ADR-0021 scope over-reach rather than a
     * loose chart filter, which is why the fold is the spec's ruled one and not
     * `LOWER()`.
     *
     * `assertRenderableText` first, exactly as its case-exact twin above: the
     * comparand has to be something `String()` renders faithfully before a
     * pattern is built from it (#5234).
     *
     * The fold wraps BOTH the column and the bound pattern. Folding one side
     * only would compare a folded needle against a raw column — matching just
     * the rows already lower-case — and on a read scope that is a row set the
     * policy author never wrote, in the narrowing direction here but in the
     * WIDENING direction under a `$not`.
     */
    case '$icontains': {
      assertRenderableText(op, field, val);
      // The two binds are spelled out rather than taken from `bindLike`, because
      // only the PATTERN placeholder is folded and the `ESCAPE` one must not be.
      // Left-to-right, so the values land in `params` in placeholder order —
      // the ordering invariant `bindLike`'s own comment states.
      const patternRef = asciiLowerSqlExpr(bind(params, likePattern('contains', val)));
      return `${asciiLowerSqlExpr(col)} LIKE ${patternRef} ESCAPE ${bind(params, LIKE_ESCAPE_CHAR)}`;
    }
    // [#5298] NULL-safe: `NOT LIKE` is UNKNOWN for a NULL column, and "does not
    // contain" is true of a value that is not there.
    case '$notContains': assertRenderableText(op, field, val); return nullSafeNegative(col, `${col} NOT LIKE ${bindLike(params, likePattern('contains', val))}`);
    case '$startsWith': assertRenderableText(op, field, val); return `${col} LIKE ${bindLike(params, likePattern('starts', val))}`;
    case '$endsWith': assertRenderableText(op, field, val); return `${col} LIKE ${bindLike(params, likePattern('ends', val))}`;
    // [#6387] `val` is a boolean here — {@link assertBooleanFlagComparands}
    // refused anything else at {@link compileField}, before this emitter runs.
    // So `=== true` is an exhaustive TWO-WAY choice over the declared domain,
    // not the "anything truthy is IS NULL" rule it used to be. That old rule is
    // what put the STRING `"false"` on the side opposite the `false` it was
    // written to mean; the identity spelling cannot, and it is the spelling
    // {@link nullValueSatisfiesOperator} now mirrors (#5146 / #5298).
    case '$null': return val === true ? `${col} IS NULL` : `${col} IS NOT NULL`;
    case '$exists': return val === true ? `${col} IS NOT NULL` : `${col} IS NULL`;
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
 * with ONE deliberate difference that comes from THIS file's emitter rather than
 * from a different reading of #5146:
 *
 *   - `$between` exists in this compiler and not in that table; it is a
 *     positive comparison, so it takes the default (a value that is not there
 *     does not lie between two bounds) exactly as the other comparisons do.
 *
 * ⚠️ [#6387] There used to be a SECOND difference, and its removal is half of
 * that change rather than a tidy-up. `$null` / `$exists` were read here by
 * TRUTHINESS — `Boolean(value)` / `!value` — because {@link compileOperator}
 * wrote them as `val ? … : …`, while `driver-sql` read them by identity because
 * its emitter did. That was correct under the invariant #5146 / #5298 state:
 * each polarity table pins the spelling of ITS OWN emitter, not the other
 * file's. So when the emitter stopped guessing at a non-boolean, these two arms
 * had to move WITH it in the same change — leaving them truthy would have
 * broken the invariant silently, at its own definition, with nothing red. The
 * divergence is gone now because its cause is: both emitters read the declared
 * boolean domain, so both tables spell it by identity, and the two files agree
 * on every arm for the first time.
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
    // [#6387] Identity, matching this file's emitter (see the note above).
    // `assertBooleanFlagComparands` refuses anything but `true` / `false` before
    // this table is consulted, so each arm is an exhaustive TWO-WAY choice over
    // the declared domain — and the strict spelling is chosen over the lenient
    // one it replaces for the reason #5347 gave: `Boolean(value)` and
    // `value === true` are equivalent only while the gate upstream holds, and
    // the lenient spelling would quietly resume answering for shapes nobody
    // ruled on if that gate were ever moved. A NULL column satisfies `$null`
    // exactly when the author asked for null…
    case '$null': return value === true;
    // …and satisfies `$exists` exactly when the author asked for "no value".
    // `$null: true` and `$exists: false` are the same question, so these two
    // arms are correctly each other's MIRROR, not each other's copy (#5369).
    case '$exists': return value === false;
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
