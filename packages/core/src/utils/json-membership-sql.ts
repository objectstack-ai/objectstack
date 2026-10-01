// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20987] The `$contains` MEMBERSHIP test over a JSON-stored column, as SQL
 * for each dialect: the one implementation every SQL face of the platform asks.
 *
 * ## Why it lives here
 *
 * `FILTER_OPERATORS.$contains` (`@objectstack/spec/data`) makes the operator a
 * membership test on a `multiple: true` field or a JSON-stored type, and a
 * substring test on a scalar string column. `@objectstack/driver-sql` answered
 * it (commit e04a0aff2) with the two functions below, module-private there. The
 * analytics service compiles its own SQL for the same operator in two places,
 * the ADR-0021 D-C read scope and the native `where`, and both kept answering
 * substring, so a read scope admitted rows its policy excluded.
 * `@objectstack/service-analytics` depends on no driver (importing one would
 * invert the layering), and both packages already stand on this one, so the
 * functions moved here rather than gaining a third copy.
 *
 * The two docblocks below moved with the code. What changed is the placeholder
 * plumbing: `driver-sql` emitted knex's identifier binding for the column and
 * returned a bindings array, while each analytics compiler quotes the column
 * itself and has its own value placeholder (`?`, or `$N`). So
 * {@link jsonMembershipPredicate} emits the column and each value through the
 * caller's {@link JsonMembershipEmitters}, and each caller keeps its own scheme.
 *
 * ## The `'unknown'` dialect: one `null`, two answers
 *
 * The predicate answers `null` there, before either emitter is called.
 * `driver-sql` keeps the `LIKE` residue it emitted before commit e04a0aff2, as its
 * `applyJsonMembership` says. The analytics read scope and `where` REFUSE it
 * instead, each in its own envelope: on a read scope the substring residue is
 * a scope admitting rows its policy excludes.
 */

/**
 * The dialects {@link jsonMembershipPredicate} has a construct for, plus
 * `'unknown'`, the residue: the same four names `driver-sql`'s
 * `SqlDialectName` and the analytics compilers' dialect carry.
 */
export type JsonMembershipDialect = 'sqlite' | 'postgres' | 'mysql' | 'unknown';

/**
 * The caller's placeholder plumbing for {@link jsonMembershipPredicate}.
 *
 * Both are called left to right, in the order their references appear in the
 * emitted SQL, so a caller that binds positionally pushes in placeholder order.
 * Neither is called when the dialect has no construct.
 */
export interface JsonMembershipEmitters {
  /** One reference to the JSON column: an identifier placeholder, or the already-quoted column. */
  column: () => string;
  /** One bound value: push `value` and return the placeholder that references it. */
  value: (value: string) => string;
}

/**
 * [commit e04a0aff2, director ruling 2026-09-12] The JSON scalars a `$contains` comparand
 * denotes when the column it is aimed at holds a JSON array — the comparand
 * half of {@link jsonMembershipPredicate}.
 *
 * # Why a comparand becomes a SET of candidates and not one value
 *
 * The contract declares `$contains`'s comparand a STRING
 * (`FieldOperatorsSchema.$contains` is `z.string()`), so an author filtering a
 * `multiple: true` NUMBER writes `'1'` and one filtering a `multiple: true`
 * BOOLEAN writes `'true'` — the spellings `sql-driver-17343-multi-valued-
 * boolean-membership.test.ts` already executes. A construct that asked the
 * backend for the JSON STRING `"1"` would therefore answer nothing on every
 * numeric and boolean multi-valued column in existence, which is option C
 * (retire the capability) arriving through the back door — the option the
 * ruling refused.
 *
 * So the comparand is read as the TEXT RENDERING of a member: `'1'` denotes the
 * JSON string `"1"` OR the JSON number `1`, `'true'` denotes `"true"` OR
 * `true`. At most two candidates, OR-ed, and the union is what makes the three
 * dialects answer the same rows — measured over a 13-row fixture on
 * better-sqlite3, live PostgreSQL 16.13 and live MySQL 8.0.46: 40 of 40 probes
 * identical, `$contains`/`$notContains` exact complements on every row.
 *
 * The number candidate is CANONICALISED through `JSON.stringify(Number(x))`
 * rather than passed through as written, because the three dialects normalise a
 * JSON number differently and only the driver can make them agree: `'1.50'`
 * becomes `1.5` here, and all three then answer the row holding `[1.5, 0]`.
 *
 * ⛔ Not a lenient alias layer (Prime Directive #12): both candidates are
 * readings of ONE declared comparand type against one stored shape, decided
 * here so every dialect gets the same pair — the opposite of a consumer
 * tolerating an off-spec input its siblings reject.
 */
export function jsonMembershipCandidates(value: unknown): string[] {
  // `String(value)` is the SAME rendering {@link SqlDriver.applyLike} gives the
  // comparand, so the membership reading of a comparand is never narrower than
  // the substring reading it replaces. `assertCompilableComparand` has already
  // refused every shape `String()` cannot render faithfully.
  const text = String(value);
  const candidates = [JSON.stringify(text)];
  if (text === 'true' || text === 'false' || text === 'null') {
    candidates.push(text);
    return candidates;
  }
  // The JSON number grammar, spelled out rather than reached through
  // `Number(text)`: `Number` also accepts `'0x10'`, `' 1 '`, `'Infinity'` and
  // `''`, none of which is a JSON number, and admitting them would make the
  // candidate set depend on JS coercion rules no dialect shares.
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text)) {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) {
      const canonical = JSON.stringify(parsed);
      if (canonical !== candidates[0]) candidates.push(canonical);
    }
  }
  return candidates;
}

/**
 * [commit e04a0aff2, director ruling 2026-09-12] The one place a `$contains` MEMBERSHIP
 * test over a JSON-stored column becomes SQL — the column and every value
 * emitted through the caller's {@link JsonMembershipEmitters}, left to right.
 *
 * # The defect this closes
 *
 * `$contains` is the membership spelling on a multi-valued column — the one
 * operator #7398 left working over a JSON column after refusing the equality
 * family there, and the spelling `jsonColumnOperatorError`'s own prescription
 * hands callers. Until this function it was lowered by {@link
 * textMatchPredicate} like any other text operator, so it asked each backend a
 * question about the SERIALIZATION rather than about the members, and the three
 * dialects answered three different things:
 *
 * | dialect | what `$contains` did on a JSON column | |
 * |---|---|---|
 * | SQLite | `col GLOB '*v*'` over the TEXT holding `["a","b"]` | a substring test that USUALLY looks like membership |
 * | MySQL | `CAST(col AS BINARY) LIKE ?` — the `json` column coerced | the same substring test |
 * | PostgreSQL | `col LIKE $1 ESCAPE $2` over a real `json` column | **SQLSTATE 42883** `operator does not exist: json ~~ text` → `DATABASE_ERROR` 500 |
 *
 * Measured on live PostgreSQL 16.13 before this change: every `JSON_COLUMN_TYPES`
 * member and every `multiple: true` column answers 42883, while the `varchar`
 * column beside them answers normally.
 *
 * The substring reading is not merely imprecise, it is wrong ACROSS ELEMENTS:
 * `['redwood']` answers `$contains: 'red'`, and `[10, 21]` answers
 * `$contains: '1'`. The ruling refused option B (`col::text LIKE`) for exactly
 * that reason — it would have frozen SQLite's cross-element mismatch into a
 * cross-backend contract.
 *
 * # What is emitted now, and why each cell
 *
 * Every arm asks ONE question — *is the comparand's JSON value an element of
 * the stored array?* — so the answer cannot depend on how a dialect stores or
 * renders the array:
 *
 * - **PostgreSQL → `col::jsonb @> '[<candidate>]'::jsonb`.** The ruling's own
 *   first option. The candidate is wrapped in an ARRAY rather than compared as
 *   a bare scalar, which is what makes the construct array-only for free:
 *   `'"red"'::jsonb @> '["red"]'::jsonb` is FALSE (a scalar contains no array)
 *   and so is `'{"k":"red"}'::jsonb @> '["red"]'::jsonb`, with no
 *   `jsonb_typeof` guard and no second reference to the column. The cast is
 *   needed because `@>` is a `jsonb` operator and this driver's DDL emits
 *   `json`.
 * - **MySQL → `JSON_CONTAINS(col, '[<candidate>]')`**, the same array-wrapped
 *   candidate and the same containment rule, including the same FALSE for a
 *   scalar or object root. Measured directly on live MySQL 8.0.46 — the cell
 *   the card carried only as a second-hand reading from the CI of commit 82cb69fed.
 * - **SQLite → a `json_each` scan**, because SQLite has no containment
 *   operator. `typeof(os_member.key) = 'integer'` is the array-only condition:
 *   `json_each` gives an array element an INTEGER key, an object member a TEXT
 *   key and a scalar root a NULL one, so the one predicate answers all three
 *   the way the containment operators do. The `CASE` over `os_member.type`
 *   rebuilds each element's JSON TEXT: SQLite surfaces a JSON `true` as the
 *   INTEGER 1, which `json_quote` would render `1` — indistinguishable from the
 *   number 1, and a divergence from the other two arms. Taking the TYPE NAME
 *   for those three cases is exact, because `'true'`/`'false'`/`'null'` ARE
 *   their own JSON text.
 * - **`'unknown'` → `null`**, and the caller falls back to the pre-e04a0aff2
 *   `LIKE` shape. `dialectName` is `'unknown'` for a knex client this driver
 *   does not model (mssql, oracle), where none of the three constructs above
 *   parses. Emitting the old shape is not an endorsement of it — it is the only
 *   answer that still RUNS, the same residue {@link textMatchPredicate}'s own
 *   `'unknown'` arm names.
 *
 * # The `json_valid` guard, and why only SQLite has one
 *
 * A JSON column on SQLite IS a TEXT column, so bytes that are not JSON are
 * physically storable — a row written before the field was declared
 * `multiple: true` really does hold bare text there, which is why this driver
 * keeps a whole read-side repair for the dialect (`hasLegacyStorageForm`).
 * `json_each` RAISES on such a cell, so without the guard this change would
 * turn a filter that works today into a 500 on the one dialect it works on.
 * With it the cell simply has no members.
 *
 * PostgreSQL and MySQL need no guard and would not benefit from one: both
 * REFUSE malformed bytes into a `json` column at write time — measured, `22P02`
 * and `ER_INVALID_JSON_TEXT` — so there is nothing on disk for a guard to
 * catch. The one shape that reaches them is an ADR-0015 EXTERNAL object whose
 * declared JSON field maps to a foreign `text` column holding non-JSON, where
 * both answer a loud `DATABASE_ERROR` (`22P02` /
 * `ER_INVALID_JSON_TEXT_IN_PARAM`) instead of a wrong substring match. That is
 * the fail-LOUD direction and it is stated here rather than papered over.
 *
 * @see jsonMembershipCandidates — the comparand half.
 * @see SqlDriver.isJsonColumn — the population, unchanged by this card (#17469).
 * @see commit e04a0aff2 — the landing that ruled the membership reading in.
 */
export function jsonMembershipPredicate(
  dialect: JsonMembershipDialect,
  emit: JsonMembershipEmitters,
  value: unknown,
): string | null {
  const candidates = jsonMembershipCandidates(value);
  const parts: string[] = [];
  for (const candidate of candidates) {
    if (dialect === 'sqlite') {
      parts.push(
        `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${emit.column()}) THEN ${emit.column()} ELSE '[]' END) AS os_member `
          + `WHERE typeof(os_member.key) = 'integer' AND CASE os_member.type `
          + `WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' `
          + `ELSE json_quote(os_member.value) END = ${emit.value(candidate)})`,
      );
      continue;
    }
    if (dialect === 'postgres') {
      parts.push(`${emit.column()}::jsonb @> ${emit.value(`[${candidate}]`)}::jsonb`);
      continue;
    }
    if (dialect === 'mysql') {
      parts.push(`JSON_CONTAINS(${emit.column()}, ${emit.value(`[${candidate}]`)})`);
      continue;
    }
    return null;
  }
  // Parenthesised whatever the arity, so the OR of the two candidates can never
  // re-associate with a sibling predicate when knex splices it into a larger
  // `WHERE`, and so the negated spelling below negates the WHOLE membership
  // test rather than its first candidate.
  return `(${parts.join(' OR ')})`;
}
