// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Unified Query DSL Specification
 * 
 * Based on industry best practices from:
 * - Prisma ORM
 * - Strapi CMS
 * - TypeORM
 * - LoopBack Framework
 * 
 * Version: 1.0.0
 * Status: Draft
 * 
 * Objective: Define a JSON-based, database-agnostic query syntax standard
 * for data filtering interactions between frontend and backend APIs.
 * 
 * Design Principles:
 * 1. Declarative: Frontend describes "what data to get", not "how to query"
 * 2. Database Agnostic: Syntax contains no database-specific directives
 * 3. Type Safe: Structure can be statically inferred by TypeScript
 * 4. Convention over Configuration: Implicit syntax for common queries
 */

/**
 * Field Reference
 * Represents a reference to another field/column instead of a literal value.
 * Used for joins (ON clause) and cross-field comparisons.
 *
 * @example
 * // user.id = order.owner_id
 * { "$eq": { "$field": "order.owner_id" } }
 *
 * ## Execution support (#5041)
 *
 * This shape is declared here and really is produced — `compileCelToFilter`
 * (`@objectstack/formula`) emits `{ $field: path }` for a field-to-field
 * comparison in a CEL permission/RLS rule. Its execution support is NOT
 * uniform across evaluation paths, and a producer must know which path its
 * filter will run on:
 *
 * - **In-memory evaluation — supported.** `matchesFilter`
 *   (`@objectstack/formula`, `matches-filter.ts`) resolves the reference
 *   against the record, dot-paths included.
 * - **SQL push-down — refused, loudly.** `@objectstack/driver-sql` (and
 *   `driver-sqlite-wasm`, which inherits its filter compiler) does not compile
 *   a field reference to a column-to-column comparison. Rather than bind the
 *   reference object as a literal value — which produced a bare driver
 *   `TypeError` outside the ADR-0112 envelope, and, inside an `$in`/`$between`
 *   list, a silent zero-row answer — the driver rejects the filter with
 *   `INVALID_FILTER` (HTTP 400) naming the field, the operator and the
 *   reference.
 *
 * The declaration is deliberately retained: the shape has a real producer and
 * a real implementation, so it is not a dead key. Compiling it to SQL
 * column-to-column comparison is tracked as its own capability in #5222, where
 * the two open semantic questions ride with it — dot-path relation references,
 * and the validation boundary for the referenced column name.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/5041 (refusal)
 * @see https://github.com/objectstack-ai/objectstack/issues/5222 (SQL support)
 */
import { lazySchema } from '../shared/lazy-schema';
export const FieldReferenceSchema = lazySchema(() => z.object({
  $field: z.string().describe('Field Reference/Column Name')
}));

export type FieldReference = z.input<typeof FieldReferenceSchema>;

// ============================================================================
// 3.1 Comparison Operators
// ============================================================================

/**
 * Comparison operators for equality and inequality checks.
 * Supported data types: Any
 */
export const EqualityOperatorSchema = lazySchema(() => z.object({
  /** Equal to (default) - SQL: = | MongoDB: $eq */
  $eq: z.any().optional(),
  
  /** Not equal to - SQL: <> or != | MongoDB: $ne */
  $ne: z.any().optional(),
}));

/**
 * The comparand contract shared by `$gt` / `$gte` / `$lt` / `$lte` (#5685).
 *
 * Module-private on purpose: it is documentation attached to four slots, not an
 * authorable surface of its own, so it stays out of the exported API surface.
 * The reasoning behind every sentence is in {@link ComparisonOperatorSchema}'s
 * docblock.
 */
const ORDERING_COMPARAND_DESCRIPTION =
  'Comparand is a number, a Date, a string, or a { $field } reference. '
  + 'STRING is the form the platform itself produces: the date-macro resolver '
  + 'returns only strings ("{current_year_start}" -> "2026-01-01"), and the '
  + 'guaranteed spellings are an ISO calendar day (YYYY-MM-DD), a UTC ISO-8601 '
  + 'instant, or a wall-clock time of day (HH:MM[:SS[.fff]]) for a Field.time '
  + 'column. Those are ASCII and fixed-width, so lexicographic order IS '
  + 'chronological order and every backend agrees; the driver reconciles the '
  + 'comparand with the column (a bare calendar day used as an upper bound '
  + 'becomes the half-open next-day boundary). Ordering NON-temporal text is '
  + 'permitted but NOT promised: the order is the backend collation\'s '
  + '(byte-wise on SQLite, the database locale on Postgres, UTF-16 code units '
  + 'in the JS matchers), and those coincide only for ASCII.';

/**
 * Ordering-comparison operators.
 *
 * Supported comparand types: **Number, Date, ISO/clock STRING, FieldReference**.
 *
 * ## Why `string` is in the union (#5685)
 *
 * Until this was written down the four slots read `number | Date |
 * FieldReference` — and the platform's own producers put a STRING in them and
 * nothing else. The declaration did not merely under-describe reality, it
 * contradicted it:
 *
 * - `resolveFilterTokens` (`@objectstack/core`, `filter-tokens.ts`) is the
 *   evaluator for the `{token}` grammar, and **every** branch returns a string
 *   — `asYmd(…)` for a calendar day, `.toISOString()` for the sub-day tokens.
 *   Its own module example is exactly this shape:
 *   `{ close_date: { $gte: '{current_year_start}' } }` →
 *   `{ close_date: { $gte: '2026-01-01' } }`.
 * - `date-macros.zod.ts` states the same rule from the other end: "the DRIVER
 *   only ever sees ISO date / timestamp strings, never `{tokens}`".
 * - Three first-party callers send strings today —
 *   `lifecycle-service.ts` (`{ created_at: { $lt: keepCutoff } }`, a
 *   `.toISOString()`), `plugin-email`'s `outbox-sweep.ts` (same shape), and
 *   `plugin-auth`'s better-auth adapter, which lowers a `gt`/`gte`/`lt`/`lte`
 *   clause with the producer's own untyped `condition.value`.
 *
 * The mismatch was already COSTING something, and the receipt is in the tree:
 * `@objectstack/objectql`'s `filter-comparand-shape.ts` (#5869) had to state,
 * as its reason for not using this schema as its gate, that the schema is
 * "stricter than the runtime in ways the runtime deliberately allows — `$gt` is
 * declared `number | Date | FieldReference`, while `['created_at', '>',
 * '2026-01-01']` lowers to a STRING bound that every backend accepts and that
 * **the showcase apps rely on**". A second package building around this
 * declaration, and writing down that it is wrong, is the measurement that says
 * the pull is real rather than hypothetical.
 *
 * An author — an AI author in particular — reading `number | Date` concluded
 * that a date window must be a `Date` object or an epoch number, which is the
 * one form the platform's own date-macro path can never hand them. This is the
 * declaration aligning to a contract the rest of the stack already keeps, not
 * a new capability: every evaluation surface ALREADY compares strings
 * (`driver-sql` binds `>`/`>=`/`<`/`<=`, `formula`'s `matchesFilter` and
 * `driver-memory`'s matcher fall through to the JS operators).
 *
 * ## Why a BARE string, and not an ISO-shaped refinement (#5685 rider ①)
 *
 * A tempting narrowing is "accept only an ISO date / date-time string". It was
 * measured and rejected, for three reasons:
 *
 * 1. **This schema is field-AGNOSTIC.** It never sees which column the operator
 *    is applied to, so any value-shape refinement here is a guess about the
 *    column. Comparand-vs-column correctness is a field-TYPED judgement and it
 *    already has an owner: `SqlDriver.coerceFilterValue` dispatches on
 *    `temporalFieldKind` — `storageDatetimeValue` for `datetime`, `toDateOnly`
 *    for `date`, `canonicalTimeOfDay` for `time`, passthrough otherwise.
 * 2. **An ISO refinement would reject a form this platform DECLARES.**
 *    `field-value.zod.ts`'s `CLOCK_TIME_TYPES` defines a `Field.time` value as
 *    `HH:MM[:SS[.fff]]` and says in as many words that it is "not
 *    `Date.parse`-able". `SqlDriver.temporalFilterValue` canonicalises exactly
 *    that in the COMPARAND position (`'14:30'` → `'14:30:00'`, the #3979
 *    contract pair). A `$gte: '09:00'` on a `time` column is a supported
 *    comparison an ISO refinement would refuse.
 * 3. **date-only and full-timestamp are already reconciled by the driver**, so
 *    narrowing buys no safety there. A bare `YYYY-MM-DD` anchors to midnight
 *    UTC for a lower bound and is rewritten to the half-open
 *    `< next-day-midnight` for an upper bound (`calendarDayUpperBoundRewrite`,
 *    the #3777 convention).
 *
 * ## What widening ADMITS, stated plainly
 *
 * `string` also admits ordering comparisons on NON-temporal text columns
 * (`{ code: { $gt: 'M' } }`). That is real SQL and every backend answers it —
 * but **the ORDER is the backend's, not this contract's**: `driver-sql` binds a
 * plain `>` decided by the dialect's collation (byte-wise on SQLite, the
 * database locale on Postgres, the column collation on MySQL), while `formula`
 * and `driver-memory` use the JS operators, i.e. UTF-16 code-unit order. Those
 * answers coincide for ASCII and diverge outside it — the same split
 * {@link StringOperatorSchema} had to rule on for case sensitivity.
 *
 * **The comparand form this contract guarantees is therefore the ISO/clock one**
 * — `YYYY-MM-DD`, a UTC ISO-8601 instant, or `HH:MM[:SS[.fff]]`. All three are
 * ASCII and fixed-width, so lexicographic order IS chronological order and every
 * backend agrees. Ordering arbitrary natural-language text is permitted, not
 * promised: it is the collation's answer, and it may differ per backend.
 */
export const ComparisonOperatorSchema = lazySchema(() => z.object({
  /** Greater than - SQL: > | MongoDB: $gt */
  $gt: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional()
    .describe(`Greater than. ${ORDERING_COMPARAND_DESCRIPTION}`),

  /** Greater than or equal to - SQL: >= | MongoDB: $gte */
  $gte: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional()
    .describe(`Greater than or equal to. ${ORDERING_COMPARAND_DESCRIPTION}`),

  /** Less than - SQL: < | MongoDB: $lt */
  $lt: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional()
    .describe(`Less than. ${ORDERING_COMPARAND_DESCRIPTION}`),

  /** Less than or equal to - SQL: <= | MongoDB: $lte */
  $lte: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional()
    .describe(`Less than or equal to. ${ORDERING_COMPARAND_DESCRIPTION}`),
}));

// ============================================================================
// 3.2 Set & Range Operators
// ============================================================================

/**
 * Set operators for membership checks.
 */
export const SetOperatorSchema = lazySchema(() => z.object({
  /** In list - SQL: IN (?, ?, ?) | MongoDB: $in */
  $in: z.array(z.any()).optional(),
  
  /** Not in list - SQL: NOT IN (...) | MongoDB: $nin */
  $nin: z.array(z.any()).optional(),
}));

/**
 * The endpoint contract shared by both of `$between`'s bounds (#6571).
 *
 * Module-private on purpose, exactly like {@link ORDERING_COMPARAND_DESCRIPTION}:
 * it is documentation attached to a slot, not an authorable surface of its own,
 * so it stays out of the exported API surface. The reasoning behind every
 * sentence is in {@link RangeOperatorSchema}'s docblock.
 */
const RANGE_ENDPOINT_DESCRIPTION =
  'Closed interval [min, max]. Each endpoint is a number, a Date, a string, or '
  + 'a { $field } reference — the SAME union the ordering comparisons take, '
  + 'because a range IS its two ordering bounds. STRING is the form the '
  + 'platform itself produces: the date-macro resolver walks INTO arrays, so '
  + '{ $between: ["{current_year_start}", "{current_year_end}"] } resolves to '
  + 'two strings. The guaranteed spellings are an ISO calendar day '
  + '(YYYY-MM-DD), a UTC ISO-8601 instant, or a wall-clock time of day '
  + '(HH:MM[:SS[.fff]]) for a Field.time column; those are ASCII and '
  + 'fixed-width, so lexicographic order IS chronological order and every '
  + 'backend agrees. The driver reconciles each endpoint with the column '
  + 'independently (a bare calendar day used as the MAX becomes the half-open '
  + 'next-day boundary). Ranging over NON-temporal text is permitted but NOT '
  + 'promised: the order is the backend collation\'s, and those coincide only '
  + 'for ASCII.';

/**
 * Range operator for interval checks (closed interval).
 * SQL: BETWEEN ? AND ? | MongoDB: $gte AND $lte
 *
 * Supported endpoint types: **Number, Date, ISO/clock STRING, FieldReference**.
 *
 * ## Why `string` is in BOTH endpoint unions (#6571)
 *
 * This is the same contradiction {@link ComparisonOperatorSchema} carried until
 * #5685, in the one slot where it bites hardest. Until this was written down
 * both endpoints read `number | Date | FieldReference` — and the platform's own
 * producers put a STRING in them:
 *
 * - **The date-macro resolver descends into arrays.** `resolveFilterTokens`
 *   (`@objectstack/core`, `filter-tokens.ts`) evaluates the `{token}` grammar,
 *   and its `walk` has an explicit array arm (`if (Array.isArray(node)) return
 *   node.map(walk)`), so a tuple comparand is resolved member by member. Every
 *   branch of that resolver returns a string — `asYmd(…)` for a calendar day,
 *   `.toISOString()` for the sub-day tokens. So
 *   `{ close_date: { $between: ['{current_year_start}', '{current_year_end}'] } }`
 *   becomes `{ close_date: { $between: ['2026-01-01', '2026-12-31'] } }`, whose
 *   two endpoints were **exactly the type this schema declared it refused**.
 * - **This package's own conformance corpus spells it.**
 *   `temporal-conformance.ts` — the shared cross-driver expectation table, in
 *   `packages/spec` itself — states three `$between` cases with string
 *   endpoints: `{ at: { $between: ['2026-04-29', '2026-07-28'] } }` with its
 *   `{90_days_ago}`/`{today}` token twin, the degenerate single-day range, and
 *   `{ at: { $between: ['08:00:00', '18:00:00'] } }` on a `Field.time` column.
 *   A declaration contradicted by the conformance table one directory over is
 *   not under-describing reality; it is disagreeing with it.
 * - **The driver already normalises both ends per column type.**
 *   `SqlDriver.coerceFilterValue` recurses through arrays member-wise
 *   (`value.map(v => this.coerceFilterValue(table, field, v))`), and
 *   `calendarDayBetweenRewrite` coerces the min and rewrites a bare-calendar-day
 *   max into the half-open `< next-day(max)` bound — knex's `whereBetween` being
 *   inclusive on both ends, it inherits the same rule `$lte` has (#3777).
 *
 * A closed interval is the natural spelling of a **date window**, which makes
 * this the slot an author — an AI author in particular — is most likely to
 * reach for with the resolver's own output in hand, and the old declaration
 * told them that output was invalid.
 *
 * ## Why a BARE string, and not an ISO-shaped refinement (#6571 rider ①)
 *
 * Identical to {@link ComparisonOperatorSchema}'s finding, and re-measured for
 * the tuple: this schema is field-**agnostic** (it never sees which column the
 * range applies to), an ISO refinement would reject the `HH:MM[:SS[.fff]]` form
 * `field-value.zod.ts`'s `CLOCK_TIME_TYPES` declares and the conformance case
 * above exercises, and date-only vs full-timestamp is already reconciled
 * downstream by `calendarDayBetweenRewrite`. Endpoint-vs-column correctness is
 * a field-TYPED judgement that already has an owner; re-guessing it here would
 * refuse working ranges.
 *
 * ## What widening ADMITS, stated plainly
 *
 * `string` also admits ranges over NON-temporal text (`{ code: { $between:
 * ['A', 'M'] } }`). That is real SQL and every backend answers it — but **the
 * ORDER is the backend's, not this contract's**: `driver-sql` emits
 * `whereBetween`, decided by the dialect's collation, while the JS matchers use
 * UTF-16 code-unit order. Those coincide for ASCII and diverge outside it.
 * Nothing here promises the two endpoints are ordered relative to each other
 * either — an inverted `[max, min]` range is a well-formed filter that matches
 * nothing, at every backend.
 */
export const RangeOperatorSchema = lazySchema(() => z.object({
  /** Between (inclusive) - takes [min, max] array */
  $between: z.tuple([
    z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]),
    z.union([z.number(), z.date(), z.string(), FieldReferenceSchema])
  ]).optional()
    .describe(`Between (inclusive). ${RANGE_ENDPOINT_DESCRIPTION}`),
}));

// ============================================================================
// 3.3 String-Specific Operators
// ============================================================================

/**
 * String pattern matching operators.
 *
 * ## Case sensitivity IS part of the contract (#5701, maintainer ruling 2026-08-06)
 *
 * **`$contains` / `$notContains` / `$startsWith` / `$endsWith` compare
 * CASE-SENSITIVELY. `$icontains` is the case-INSENSITIVE twin, and its folding
 * domain is ASCII (`A-Z` against `a-z`) and nothing else.**
 *
 * ### This SUPERSEDES a recorded decision (Prime Directive #13)
 *
 * Until 2026-08-06 this docblock read, in full:
 *
 *   > Note: Case sensitivity should be handled at backend level.
 *
 * That sentence was not an omission — it was a written-down NON-guarantee, and
 * the #4706 ruling (Q2 = A, transcribed on #5701) withdraws it. It is quoted
 * here rather than deleted because reversing a recorded decision is itself a
 * decision, and the next author needs to find the reversal from the sentence
 * they remember.
 *
 * What that non-guarantee actually bought, measured surface by surface before
 * the ruling:
 *
 * | surface | `$contains` case behaviour | mechanism |
 * |---|---|---|
 * | `formula` `matchesFilterCondition` | SENSITIVE | `actual.includes(v)` |
 * | `driver-memory` — query path and analytics face | INSENSITIVE, full Unicode | `new RegExp(escapeRegex(v), 'i')` |
 * | `driver-memory` — reference matcher (`memory-matcher`) | SENSITIVE | `value.includes(target)` |
 * | `driver-mongodb` | INSENSITIVE, full Unicode | hardcoded `$options: 'i'` |
 * | `driver-sql` family | the DIALECT's | `LIKE '%v%'` — ASCII-insensitive on SQLite (so also turso and sqlite-wasm), sensitive on Postgres, collation-dependent on MySQL |
 *
 * One declared operator, three different answers, selected by which backend ran
 * the query — and `driver-memory` alone accounts for two of them, so the answer
 * could change without changing driver. An author could not tell from the
 * operator name which one they were getting, and neither could a generated
 * filter. That is what a written-down "handled at backend level" costs once
 * there is more than one backend.
 *
 * ### Why the folding domain is ASCII and not Unicode
 *
 * A Unicode fold cannot be delivered by every backend, so promising one would
 * repeat the defect this retires rather than fix it. Measured on this repo's
 * `better-sqlite3` (SQLite 3.53.4, no ICU): `LOWER(col) LIKE LOWER(?)` folds
 * ASCII only, so `café` does not match `CAFÉ` and `москва` does not match
 * `МОСКВА`, while the JS matchers' `toLowerCase()` folds both. Pinning the
 * contract at ASCII is the one domain all five backends can actually deliver.
 *
 * **The boundary, stated plainly for authors: `café` does NOT match `CAFÉ`.**
 * Outside `A-Z`/`a-z`, `$icontains` compares literally, exactly like
 * `$contains`. An application whose users search non-ASCII text should not read
 * `$icontains` as "accent- and case-blind search" — it is not one.
 *
 * ### Implementation status — answered by the SQL family, refused by the rest
 *
 * #5701 shipped this declaration deliberately ahead of every runtime, and
 * #5702 (closed 2026-08-08, retuned by #6518) landed the lowerings on the SQL
 * family. Measured per backend, by running `{ name: { $icontains: 'acme' } }`
 * against a fixture holding BOTH `acme corp` and `ACME CORP` — not by grepping
 * for a case arm, which is blind to the face that inherits its compiler and so
 * undercounts:
 *
 * | driver | `$icontains` | how it gets there |
 * |---|---|---|
 * | `driver-sql` | ANSWERS both rows | its own `case '$icontains'`, folding through the same emitter that carries the escaping |
 * | `driver-sqlite-wasm` | ANSWERS both rows | INHERITED — `SqliteWasmDriver extends SqlDriver`; this package carries no text case arm of its own, on a different ENGINE |
 * | `driver-turso` | ANSWERS both rows, on BOTH transports | local inherits `SqlDriver`; the remote transport compiles independently and has its own arm |
 * | `driver-memory` | REFUSES — `INVALID_FILTER` / 400 | no arm; its `SUPPORTED_FIELD_OPERATORS` derives from {@link FILTER_OPERATORS}, which deliberately omits it |
 * | `driver-mongodb` | REFUSES — `INVALID_FILTER` / 400 | no arm; falls to its translator's `default:` |
 *
 * The other JS evaluators sit on the refusing side too: objectql's `having`
 * face records the omission in its own source, and `formula`'s `matchesFilter`
 * has no `$icontains` arm.
 *
 * **So the sentence an author needs is no longer "no backend answers this".**
 * It is: `$icontains` is EXECUTABLE on the SQL family and refused — loudly,
 * fail-closed, never silently — everywhere else, so a filter that uses it is
 * not portable across backends today. An app whose tests run on the in-memory
 * double and whose production runs SQL gets two different answers from one
 * filter: that divergence, and the remaining implementations, are #6520.
 *
 * **The vocabulary gate below is still closed, and #5702 is no longer what it
 * waits for.** `$icontains` stays out of {@link FILTER_OPERATORS} on purpose —
 * that array is a runtime allowlist, and listing an operator the in-memory
 * `match()` cannot evaluate makes it answer `true` for a NON-match (measured;
 * see that array's docblock). It joins when the JS faces get arms, in #6520.
 *
 * The `$contains`-family alignment the ruling above requires is likewise part
 * done rather than pending: #6518 made that family case-EXACT across the SQL
 * dialects, while `driver-memory`'s query path and `driver-mongodb` still fold
 * the whole Unicode range — the two rows #6682 tracks.
 *
 * `FILTER_TEXT_CASES` (`filter-text-conformance.ts`) is the standard that
 * measures all of the above, and the driver-conformance ledger still carries a
 * DEBT row for each of the two backends left, so what is open stays counted
 * rather than assumed.
 *
 * @see FILTER_TEXT_CASES — the conformance standard for every operator here.
 * @see RETIRED_FILTER_OPERATORS — why `$regex` is not in this list.
 * @see https://github.com/objectstack-ai/objectstack/issues/4706 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/5702 (the SQL family — landed)
 * @see https://github.com/objectstack-ai/objectstack/issues/6520 (the JS faces — open)
 */
export const StringOperatorSchema = lazySchema(() => z.object({
  /** Contains substring, CASE-SENSITIVELY - SQL: LIKE %?% (case-exact) */
  $contains: z.string().optional(),

  /** Does not contain substring, CASE-SENSITIVELY - SQL: NOT LIKE %?% (case-exact) */
  $notContains: z.string().optional(),

  /** Starts with prefix, CASE-SENSITIVELY - SQL: LIKE ?% (case-exact) */
  $startsWith: z.string().optional(),

  /** Ends with suffix, CASE-SENSITIVELY - SQL: LIKE %? (case-exact) */
  $endsWith: z.string().optional(),

  /**
   * Contains substring, IGNORING ASCII case (#5701). The replacement for the
   * retired `$regex` — see {@link RETIRED_FILTER_OPERATORS}.
   */
  $icontains: z.string().optional().describe(
    'Contains substring, ignoring case — but ONLY ASCII case (A-Z against a-z). '
    + 'Every other character compares literally, so "café" does NOT match "CAFÉ" '
    + 'and "москва" does not match "МОСКВА". The domain is ASCII because that is '
    + 'the one fold all five backends can deliver: SQLite (and therefore turso and '
    + 'sqlite-wasm) folds ASCII only, so a Unicode promise here would be a '
    + 'guarantee three of the five could not keep. The comparand is matched '
    + 'LITERALLY — "%", "_" and regex metacharacters are ordinary characters, not '
    + 'wildcards. Case-SENSITIVE containment is $contains. [#5701 declared it; #5702 '
    + 'lowered it on the SQL family (driver-sql, driver-sqlite-wasm, driver-turso on '
    + 'both transports). driver-memory and driver-mongodb still REFUSE it with '
    + 'INVALID_FILTER / 400, so a filter using it is not portable across backends yet '
    + '— #6520.]'
  ),
}));

// ============================================================================
// 3.5 Special Operators
// ============================================================================

/**
 * Special check operators for null and existence.
 */
export const SpecialOperatorSchema = lazySchema(() => z.object({
  /** Is null check - SQL: IS NULL (true) / IS NOT NULL (false) | MongoDB: field: null */
  $null: z.boolean().optional(),
  
  /** Field exists check (primarily for NoSQL) - MongoDB: $exists */
  $exists: z.boolean().optional(),
}));

// ============================================================================
// Combined Field Operators
// ============================================================================

/**
 * All field-level operators combined.
 * These can be applied to individual fields in a filter.
 */
export const FieldOperatorsSchema = lazySchema(() => z.object({
  // Equality
  $eq: z.any().optional(),
  $ne: z.any().optional(),
  
  // Ordering. `string` is in the union for the reason {@link ComparisonOperatorSchema}
  // gives at length (#5685): the date-macro resolver and all three first-party
  // callers produce ISO/clock STRINGS in these slots and nothing else. This copy
  // is the ENFORCED one — `NormalizedFilterSchema` validates against it and the
  // exported `FieldOperators` is inferred from it — so it must not drift from the
  // documentation copy above.
  $gt: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional(),
  $gte: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional(),
  $lt: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional(),
  $lte: z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]).optional(),
  
  // Set & Range
  $in: z.array(z.any()).optional(),
  $nin: z.array(z.any()).optional(),
  // Range. `string` is in BOTH endpoint unions for the reason
  // {@link RangeOperatorSchema} gives at length (#6571): the date-macro resolver
  // walks into arrays, so a token range resolves to two ISO/clock STRINGS, and
  // this package's own `temporal-conformance.ts` corpus spells that shape. This
  // copy is the ENFORCED one — `NormalizedFilterSchema` validates against it and
  // the exported `FieldOperators` is inferred from it — so it must not drift
  // from the documentation copy above. #5685 landed the sibling ordering slots
  // in the documentation copy first and left the reachable surface still
  // rejecting the platform's own output; both spellings move together.
  $between: z.tuple([
    z.union([z.number(), z.date(), z.string(), FieldReferenceSchema]),
    z.union([z.number(), z.date(), z.string(), FieldReferenceSchema])
  ]).optional(),

  // String-specific. Case-SENSITIVE, except `$icontains` which folds ASCII case
  // only — see {@link StringOperatorSchema} for the contract and its boundary.
  $contains: z.string().optional(),
  $notContains: z.string().optional(),
  $startsWith: z.string().optional(),
  $endsWith: z.string().optional(),
  $icontains: z.string().optional(),

  // Special
  $null: z.boolean().optional(),
  $exists: z.boolean().optional(),
}));

// ============================================================================
// 3.4 Logical Operators & Recursive Filter Structure
// ============================================================================

/**
 * Recursive filter type that supports:
 * 1. Implicit equality: { field: value }
 * 2. Explicit operators: { field: { $op: value } }
 * 3. Logical combinations: { $and: [...], $or: [...], $not: {...} }
 * 4. Nested relations: { relation: { field: value } }
 */
export type FilterCondition = {
  [key: string]: 
    | any  // Implicit equality: key: value
    | z.infer<typeof FieldOperatorsSchema>  // Explicit operators: key: { $op: value }
    | FilterCondition;  // Nested relation: key: { nested: ... }
} & {
  /** Logical AND - combines all conditions that must be true */
  $and?: FilterCondition[];
  
  /** Logical OR - at least one condition must be true */
  $or?: FilterCondition[];

  /**
   * Logical NOT - negates the condition, **NULL-safely** (#5146).
   *
   * A row whose compared column is NULL does NOT satisfy the negated condition
   * and IS returned. In SQL terms the operand is negated as
   * `NOT (…) OR col IS NULL` rather than as a bare `NOT (…)`.
   *
   * See {@link FilterConditionSchema} for why this is part of the contract
   * rather than each backend's own choice.
   */
  $not?: FilterCondition;
};

/**
 * Zod schema for recursive filter validation.
 * Uses z.lazy() to handle recursive structure.
 *
 * Annotated with BOTH type arguments (#4195). `z.ZodType<T>` leaves `Input`
 * at its `unknown` default, and that `unknown` propagates: every schema that
 * embeds this one reports `unknown` for the corresponding key of its own
 * `z.input`, so the authoring surface underneath goes unchecked. Nothing here
 * carries a `.default()` or a `.transform()`, so input and output are the same
 * type and the second argument is simply the first.
 *
 * ## `$not` is NULL-safe (#5146, maintainer ruling 2026-08-04)
 *
 * **A row whose compared column is NULL does NOT satisfy the negated condition
 * and IS returned** — `NOT (…) OR col IS NULL`, not a bare `NOT (…)`.
 *
 * This is written down here because it was not, and the omission had a cost.
 * The schema declared `$not` beside `$and` / `$or` and said nothing about what
 * it MEANS, so each backend answered from its own host language: the SQL
 * compilers negated in three-valued logic (`NULL = 'won'` is UNKNOWN,
 * `NOT UNKNOWN` is UNKNOWN, a `WHERE` keeps only TRUE) and dropped every
 * NULL-column row, while `driver-memory` and `formula` evaluated in ordinary
 * two-valued JS (`undefined !== 'won'`) and returned them. One declared
 * operator, two answers, chosen by which driver happened to run the query.
 *
 * That is a permission defect, not a rounding difference. A CEL `!expr` in an
 * RLS rule lowers to `{ $not: {…} }` (`packages/formula/src/cel-to-filter.ts`),
 * so the SAME read scope admitted a different set of rows per backend. #5146
 * ruled the two-valued answer canonical: it is the majority, and nobody writing
 * `!(stage == 'won')` expects rows with no stage to be hidden by it.
 *
 * Note the guard belongs on each LEAF inside the negation, not hoisted next to
 * the `$not`: a top-level `NOT (…) OR col IS NULL` re-admits rows that satisfy
 * a nested `$or` through a different branch, which widens the scope. Following
 * each operator's own answer for a missing value is also what keeps `$ne` /
 * `$nin` from being widened — `{ $not: { stage: { $ne: 'won' } } }` still means
 * "the column IS that value".
 *
 * Conformance status, re-measured at the 2026-08-05 sync of this PR (main @
 * `cdfbee2f0`): EVERY surface answers this way today. `driver-sql` (PR #5296),
 * `driver-sqlite-wasm`, `driver-memory`, `formula` and `driver-mongodb`
 * already did; `read-scope-sql` was aligned by #5326 (closing #5297) and the
 * analytics `filter-normalizer` by #5335 (closing #5325). The gap an earlier
 * revision of this paragraph tracked is closed — declaring the rule here is
 * what turned it into a tracked bug instead of an invisible one, per Prime
 * Directive #10, and this sentence is kept as the record that the tracking
 * worked.
 *
 * ## Empty combinators are boolean identities (#5322, maintainer ruling 2026-08-04)
 *
 * `{ $and: [] }` is TRUE — the AND identity, no constraint. `{ $or: [] }` is
 * FALSE — the OR identity, zero rows. A `{}` disjunct is TRUE and ABSORBS its
 * `$or`; `{ $not: {} }` is `NOT TRUE` — FALSE. The ruling took the reduction
 * over the analytics compilers' fail-closed throw for two reasons: only a
 * reduction can evaluate a NESTED tree (a rejection must first reduce to
 * judge an empty combinator sitting inside a `$or` branch, which concedes the
 * point), and `{ $or: [] }` = zero rows is fail-closed exactly where it
 * matters — an RLS scope whose disjunct list loops to zero items hides every
 * row instead of exposing the table (#5134). An earlier revision of this
 * paragraph kept the identities OUT of the contract because two compilers
 * still refused them; that gap closed with PR #5365 (both
 * `service-analytics` compilers reduce, and the four cases are enrolled in
 * `filter-logic-conformance.ts` against every backend — the five drivers
 * already reduced: `driver-sql` #5243, `driver-mongodb` #5323). Loud
 * AUTHORING-time rejection of the literal spellings is a separate, optional
 * lint concern (#5330), not a runtime semantic.
 *
 * ## Deliberately NOT declared here
 *
 * `{ field: {} }` (a field constrained by zero operators): #5240 ruled it
 * REJECTED and #5327 gated driver-sql / driver-sqlite-wasm / driver-memory /
 * formula; `driver-mongodb` still answers it (tracked by #5376), and the
 * schema-side narrowing stays with the spec lane. Declaring it before it is
 * enforced everywhere would be exactly the `declared ≠ enforced` shape this
 * file exists to prevent.
 */
export const FilterConditionSchema: z.ZodType<FilterCondition, FilterCondition> = z.lazy(() =>
  z.record(z.string(), z.unknown()).and(
    z.object({
      $and: z.array(FilterConditionSchema).optional(),
      $or: z.array(FilterConditionSchema).optional(),
      $not: FilterConditionSchema.optional(),
    })
  )
);

// ============================================================================
// Query Filter Wrapper
// ============================================================================

/**
 * Top-level query filter wrapper.
 * This is typically used as the "where" clause in a query.
 * 
 * @example
 * ```typescript
 * const filter: QueryFilter = {
 *   where: {
 *     status: "active",                    // Implicit equality
 *     age: { $gte: 18 },                   // Explicit operator
 *     $or: [                               // Logical combination
 *       { role: "admin" },
 *       { email: { $contains: "@company.com" } }
 *     ],
 *     profile: {                           // Nested relation
 *       verified: true
 *     }
 *   }
 * }
 * ```
 */
export const QueryFilterSchema = lazySchema(() => z.object({
  where: FilterConditionSchema.optional(),
}));

// ============================================================================
// TypeScript Type Exports
// ============================================================================

/**
 * Type-safe filter operators for use in TypeScript.
 * 
 * @example
 * ```typescript
 * type UserFilter = Filter<User>;
 * 
 * const filter: UserFilter = {
 *   age: { $gte: 18 },
 *   email: { $contains: "@example.com" }
 * };
 * ```
 */
export type Filter<T = any> = {
  [K in keyof T]?: 
    | T[K]  // Implicit equality
    | {
        $eq?: T[K];
        $ne?: T[K];
        // Ordering (#5685). The TYPED half of what {@link ComparisonOperatorSchema}
        // declares — and unlike that field-agnostic schema, `T` is known here, so
        // this stays type-precise instead of admitting `string` everywhere:
        //   - a `Date` field also takes the ISO STRING the date-macro resolver
        //     produces (`{ close_date: { $gte: '2026-01-01' } }`), which the old
        //     `T[K] extends number | Date ? T[K]` guard rejected outright;
        //   - a `string` field (a `Field.time` `'09:00'`, an autonumber code) is
        //     orderable at every backend, where the old guard collapsed it to
        //     `never` and made the operator unwritable;
        //   - a `number` field stays numbers-only — nothing here wants `'5'`.
        $gt?: T[K] extends number ? number : T[K] extends Date | string ? T[K] | string : never;
        $gte?: T[K] extends number ? number : T[K] extends Date | string ? T[K] | string : never;
        $lt?: T[K] extends number ? number : T[K] extends Date | string ? T[K] | string : never;
        $lte?: T[K] extends number ? number : T[K] extends Date | string ? T[K] | string : never;
        $in?: T[K][];
        $nin?: T[K][];
        // Range (#6571). The TYPED half of what {@link RangeOperatorSchema}
        // declares, and the exact mirror of the ordering guard above — a range
        // IS its two ordering bounds, so the two must agree slot for slot:
        //   - a `Date` field also takes the ISO STRINGS the date-macro resolver
        //     produces for a token range (it walks into arrays), which the old
        //     `T[K] extends number | Date ? [T[K], T[K]]` guard rejected outright;
        //   - a `string` field (a `Field.time` `'08:00:00'`, an autonumber code)
        //     is rangeable at every backend, where the old guard collapsed it to
        //     `never` and made the operator unwritable — the very shape
        //     `temporal-conformance.ts` pins for `Field.time`;
        //   - a `number` field stays numbers-only — nothing here wants `['5','9']`.
        // Each endpoint is widened independently, so a half-resolved range
        // (`[new Date(...), '2026-12-31']`) type-checks, which is what a partial
        // macro resolution actually hands the author.
        $between?: T[K] extends number
          ? [number, number]
          : T[K] extends Date | string
            ? [T[K] | string, T[K] | string]
            : never;
        $contains?: T[K] extends string ? string : never;
        $notContains?: T[K] extends string ? string : never;
        $startsWith?: T[K] extends string ? string : never;
        $endsWith?: T[K] extends string ? string : never;
        /** Case-insensitive containment, ASCII fold only — see {@link StringOperatorSchema}. */
        $icontains?: T[K] extends string ? string : never;
        $null?: boolean;
        $exists?: boolean;
      }
    | (T[K] extends object ? Filter<T[K]> : never);  // Nested relation
} & {
  $and?: Filter<T>[];
  $or?: Filter<T>[];
  $not?: Filter<T>;
};

/**
 * Scalar types supported by the filter system.
 */
export type Scalar = string | number | boolean | Date | null;

// Export inferred types
export type FieldOperators = z.input<typeof FieldOperatorsSchema>;
export type QueryFilter = z.input<typeof QueryFilterSchema>;

// ============================================================================
// Normalization Utilities (Internal Representation)
// ============================================================================

/**
 * Normalized filter AST structure.
 * This is the internal representation after converting all syntactic sugar
 * to explicit operators.
 * 
 * Stage 1: Normalization Pass
 * Input:  { age: 18, role: "admin" }
 * Output: { $and: [{ age: { $eq: 18 } }, { role: { $eq: "admin" } }] }
 * 
 * This simplifies adapter implementation by providing a consistent structure.
 */
export type NormalizedFilter = {
  /** All conditions must hold. Each entry is a field condition or a nested group. */
  $and?: Array<Record<string, FieldOperators> | NormalizedFilter>;
  /** At least one condition must hold. */
  $or?: Array<Record<string, FieldOperators> | NormalizedFilter>;
  /** Negated condition. */
  $not?: Record<string, FieldOperators> | NormalizedFilter;
};

/**
 * Zod schema for the normalized filter AST.
 *
 * Every key is recursive, so there is no non-recursive half to infer from and
 * {@link NormalizedFilter} is written out above instead — it is this schema's
 * annotation. Annotating with `z.ZodType<any>` (as this did before #4171) made
 * the exported `NormalizedFilter` resolve to `any`, so the adapters that walk
 * this AST were writing against a type that constrained nothing.
 *
 * Both type arguments are given (#4195): this AST is produced by the normalizer
 * rather than authored, and carries no `.default()` or `.transform()`, so input
 * and output are the same type. Leaving `Input` at its `unknown` default would
 * make `z.input` of anything embedding it `unknown` for no reason.
 */
export const NormalizedFilterSchema: z.ZodType<NormalizedFilter, NormalizedFilter> = z.lazy(() =>
  z.object({
    $and: z.array(
      z.union([
        // Field condition: { field: { $op: value } }
        z.record(z.string(), FieldOperatorsSchema),
        // Nested logical group
        NormalizedFilterSchema,
      ])
    ).optional(),
    
    $or: z.array(
      z.union([
        z.record(z.string(), FieldOperatorsSchema),
        NormalizedFilterSchema,
      ])
    ).optional(),
    
    $not: z.union([
      z.record(z.string(), FieldOperatorsSchema),
      NormalizedFilterSchema,
    ]).optional(),
  })
);

// ============================================================================
// AST Array Format Detection & Validation
// ============================================================================

/**
 * Operator mapping from AST infix operators to FilterCondition `$`-prefixed
 * operators. **This is the single source of truth for the AST vocabulary** —
 * {@link VALID_AST_OPERATORS} is derived from its keys, so an operator cannot be
 * accepted by `isFilterAST()` without also having a lowering, which is how the
 * two lists silently disagreed before (#3948).
 *
 * Keys are matched case-insensitively (`convertComparison` lowercases), so only
 * lowercase spellings belong here — but underscores are NOT stripped, so a
 * spelling that exists in both `snake_case` and squashed form needs both.
 *
 * Must lower every member of `VIEW_FILTER_OPERATORS` and every key of
 * `VIEW_FILTER_OPERATOR_ALIASES` (`ui/view.zod.ts`) — those are the spellings an
 * author can declare on a `ViewFilterRule` and that stored view metadata
 * carries. `ui/` imports `data/`, so this file cannot import that vocabulary to
 * derive from it; `filter-view-operator-parity.test.ts` asserts the coverage
 * instead. Do not hand-add a view operator without running it.
 *
 * Typed with `satisfies` rather than an `Record< string, string >` annotation so
 * the KEY SET survives inference: {@link FilterArrayOperator} is
 * `keyof typeof AST_OPERATOR_MAP`, which is how the authoring type for a
 * comparison node's operator position stays derived from this one table instead
 * of becoming the third hand-written copy of the vocabulary (#3948 is what two
 * copies cost). Lookups by a runtime `string` go through
 * {@link astOperatorLowering}.
 */
const AST_OPERATOR_MAP = {
  '=': '$eq',
  '==': '$eq',
  'equals': '$eq',
  'eq': '$eq',
  '!=': '$ne',
  '<>': '$ne',
  'ne': '$ne',
  'neq': '$ne',
  'not_equals': '$ne',
  'notequals': '$ne',
  '>': '$gt',
  'gt': '$gt',
  'greater_than': '$gt',
  'greaterthan': '$gt',
  '>=': '$gte',
  'gte': '$gte',
  'greater_than_or_equal': '$gte',
  'greaterthanorequal': '$gte',
  'greaterorequal': '$gte',
  '<': '$lt',
  'lt': '$lt',
  'less_than': '$lt',
  'lessthan': '$lt',
  '<=': '$lte',
  'lte': '$lte',
  'less_than_or_equal': '$lte',
  'lessthanorequal': '$lte',
  'lessorequal': '$lte',
  // Date comparisons. Canonical `VIEW_FILTER_OPERATORS` members with no infix
  // spelling of their own; a stored view legitimately carries them, and before
  // #3948 they had no lowering, so `isFilterAST()` refused the filter and it was
  // dropped rather than applied.
  'before': '$lt',
  'after': '$gt',
  'in': '$in',
  'nin': '$nin',
  'not_in': '$nin',
  'notin': '$nin',
  'contains': '$contains',
  'notcontains': '$notContains',
  'not_contains': '$notContains',
  'like': '$contains',
  'startswith': '$startsWith',
  'starts_with': '$startsWith',
  'endswith': '$endsWith',
  'ends_with': '$endsWith',
  'between': '$between',
  'is_null': '$null',
  'is_not_null': '$null',
  'isnull': '$null',
  'isnotnull': '$null',
  'is_empty': '$null',
  'is_not_empty': '$null',
  'isempty': '$null',
  'isnotempty': '$null',
} satisfies Record<string, string>;

/**
 * `$`-operator lowering for one infix spelling, or `undefined` when the spelling
 * is not in the vocabulary.
 *
 * {@link AST_OPERATOR_MAP} keeps its literal key set (see its note), so it can
 * no longer be indexed by an arbitrary runtime `string`. This is the one place
 * that widens it back, so the widening is visible instead of scattered.
 */
function astOperatorLowering(op: string): string | undefined {
  return (AST_OPERATOR_MAP as Record<string, string>)[op];
}

/**
 * Set of valid AST comparison operators (case-insensitive).
 * Used by `isFilterAST()` to validate AST structure beyond `Array.isArray`.
 *
 * Derived from {@link AST_OPERATOR_MAP} rather than restated. The two were
 * separate hand-written lists that happened to agree; nothing enforced it, and
 * an operator in one but not the other is invisible — a name in the Set with no
 * lowering hits `convertComparison`'s `$${op}` fallback and reaches the driver
 * as an unknown `$`-operator, while a name in the Map but not the Set makes
 * `isFilterAST()` refuse the filter entirely. #3948.
 */
export const VALID_AST_OPERATORS = new Set(Object.keys(AST_OPERATOR_MAP));

/**
 * Canonical infix spelling for every accepted AST operator.
 *
 * `VALID_AST_OPERATORS` accepts many spellings of one comparison (`>`, `gt`,
 * `greater_than`, `greaterthan`, `after`). A driver's array-format handler wants
 * to `switch` on ONE of them, and each driver growing its own alias list is how
 * the vocabularies drifted apart in the first place. Fold here instead.
 *
 * Returns the input lowercased and unchanged when it is not a known operator, so
 * a caller's own `default:` still reports it.
 */
const CANONICAL_INFIX: Record<string, string> = {
  '$eq': '=', '$ne': '!=', '$gt': '>', '$gte': '>=', '$lt': '<', '$lte': '<=',
  '$in': 'in', '$nin': 'nin', '$contains': 'contains',
  '$notContains': 'not_contains', '$startsWith': 'starts_with',
  '$endsWith': 'ends_with', '$between': 'between',
};

export function canonicalAstOperator(op: string): string {
  const lower = String(op).toLowerCase();
  // Null predicates carry a DIRECTION that the shared `$null` lowering erases,
  // so they cannot round-trip through CANONICAL_INFIX — fold them by name.
  if (lower === 'is_null' || lower === 'isnull' || lower === 'is_empty' || lower === 'isempty') {
    return 'is_null';
  }
  if (
    lower === 'is_not_null' || lower === 'isnotnull'
    || lower === 'is_not_empty' || lower === 'isnotempty'
  ) {
    return 'is_not_null';
  }
  // `like`/`ilike` share the `$contains` lowering but are NOT substring matches
  // at the driver: driver-sql passes them to SQL verbatim, so the caller binds
  // the wildcards. Folding them onto `contains` would silently wrap the value in
  // `%…%` and change what the query means.
  if (lower === 'like' || lower === 'ilike') return lower;
  const dollar = astOperatorLowering(lower);
  if (!dollar) return lower;
  return CANONICAL_INFIX[dollar] ?? lower;
}

/**
 * Detect whether a value is a valid Filter AST array structure.
 *
 * A valid AST is one of:
 * - Comparison node: `[field: string, operator: string, value: unknown]` where operator is a known operator
 * - Logical node: `["and" | "or", ...children]` where children are valid AST nodes
 * - Legacy flat array: `[[cond], [cond], ...]` where all elements are sub-arrays (each a valid AST node)
 *
 * This replaces the naïve `Array.isArray(filter)` check, preventing accidental
 * misidentification of arbitrary arrays as filter ASTs.
 *
 * @example
 * isFilterAST(["status", "=", "active"])              // true
 * isFilterAST(["and", ["a", "=", 1], ["b", ">", 2]]) // true
 * isFilterAST([["a", "=", 1], ["b", "=", 2]])         // true (legacy)
 * isFilterAST([1, 2, 3])                               // false
 * isFilterAST("not an array")                           // false
 * isFilterAST({ status: "active" })                     // false
 */
export function isFilterAST(filter: unknown): boolean {
  if (!Array.isArray(filter) || filter.length === 0) return false;

  const first = filter[0];

  // Logical node: ["and", ...] or ["or", ...]
  if (typeof first === 'string') {
    const lower = first.toLowerCase();
    if (lower === 'and' || lower === 'or') {
      return filter.length >= 2 && filter.slice(1).every((child: unknown) => isFilterAST(child));
    }

    // Comparison node: [field, operator, value]
    if (filter.length >= 2 && typeof filter[1] === 'string') {
      return VALID_AST_OPERATORS.has(filter[1].toLowerCase());
    }
  }

  // Legacy flat array: [[cond], [cond], ...]
  if (filter.every((item: unknown) => isFilterAST(item))) {
    return filter.length > 0;
  }

  return false;
}

// ============================================================================
// AST Array → FilterCondition Conversion
// ============================================================================

/**
 * Convert a single AST comparison node `[field, operator, value]` to a FilterCondition object.
 */
function convertComparison(node: [string, string, unknown]): FilterCondition {
  const [field, operator, value] = node;
  const op = operator.toLowerCase();

  // Special case: equality shorthand. `equals`/`eq` are the view vocabulary's
  // spellings of the same thing and must produce the same output, or one filter
  // would compile two different ways depending on how the author spelled it.
  if (op === '=' || op === '==' || op === 'equals' || op === 'eq') {
    return { [field]: value } as FilterCondition;
  }

  // Null / empty predicates — direction comes from the operator NAME, not the
  // (filler) value: the ObjectUI client sends a truthy placeholder value for
  // both `isnull` and `isnotnull`, so keying off `value` would collapse them.
  if (op === 'is_null' || op === 'isnull' || op === 'is_empty' || op === 'isempty') {
    return { [field]: { $null: true } } as FilterCondition;
  }
  if (
    op === 'is_not_null' || op === 'isnotnull'
    || op === 'is_not_empty' || op === 'isnotempty'
  ) {
    return { [field]: { $null: false } } as FilterCondition;
  }

  const mapped = astOperatorLowering(op);
  if (mapped) {
    return { [field]: { [mapped]: value } } as FilterCondition;
  }

  // Fallback: use the operator as-is with $ prefix
  return { [field]: { [`$${op}`]: value } } as FilterCondition;
}

/**
 * Parse a filter from AST array format to FilterCondition object format.
 *
 * The AST array format is used by the ObjectUI client and the `FilterBuilder`:
 * - Comparison: `[field, operator, value]` → `{ field: value }` or `{ field: { $op: value } }`
 * - Logical AND: `["and", cond1, cond2, ...]` → `{ $and: [...] }`
 * - Logical OR: `["or", cond1, cond2, ...]` → `{ $or: [...] }`
 *
 * If the input is already a FilterCondition object (not an array), it is returned as-is.
 * If the input is `null` or `undefined`, it is returned as-is.
 *
 * @example
 * // Simple condition
 * parseFilterAST(["status", "=", "active"])
 * // → { status: "active" }
 *
 * @example
 * // Compound AND
 * parseFilterAST(["and", ["priority", "=", "high"], ["status", "=", "active"]])
 * // → { $and: [{ priority: "high" }, { status: "active" }] }
 *
 * @example
 * // Object passthrough
 * parseFilterAST({ status: "active" })
 * // → { status: "active" }
 */
export function parseFilterAST(filter: unknown): FilterCondition | undefined {
  if (filter == null) return undefined;
  if (!Array.isArray(filter)) return filter as FilterCondition;
  if (filter.length === 0) return undefined;

  const first = filter[0];

  // Logical node: ["and", cond1, cond2, ...] or ["or", cond1, cond2, ...]
  if (typeof first === 'string' && (first.toLowerCase() === 'and' || first.toLowerCase() === 'or')) {
    const logicOp = `$${first.toLowerCase()}` as '$and' | '$or';
    const children = filter.slice(1).map((child: unknown) => parseFilterAST(child)).filter(Boolean) as FilterCondition[];
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { [logicOp]: children } as FilterCondition;
  }

  // Comparison node: [field, operator, value]
  if (filter.length >= 2 && typeof first === 'string') {
    return convertComparison(filter as [string, string, unknown]);
  }

  // Legacy flat array: [[field, op, val], [field, op, val], ...]
  // All elements are sub-arrays → treat as implicit AND
  if (filter.every((item: unknown) => Array.isArray(item))) {
    const children = filter.map((child: unknown) => parseFilterAST(child)).filter(Boolean) as FilterCondition[];
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { $and: children } as FilterCondition;
  }

  return undefined;
}

// ============================================================================
// FilterArray — the INPUT-ONLY authoring sugar (#5158, maintainer ruling C)
// ============================================================================

/**
 * Canonical operator spellings a {@link FilterArrayComparison} may carry.
 *
 * Derived from {@link AST_OPERATOR_MAP} — the same table `VALID_AST_OPERATORS`
 * is derived from — so the authoring type cannot drift from the lowering the
 * way two hand-written lists did in #3948.
 *
 * **Canonical, not exhaustive-of-what-parses.** Every door folds case before
 * looking an operator up, so already-stored metadata and older authoring tools
 * legitimately carry camelCase spellings (`startsWith`, `notEquals`,
 * `greaterThan`) that this type does not name. {@link FilterArraySchema}
 * accepts them; this type steers new producers to the canonical form. That
 * split is the established pattern next door — `ViewFilterOperator` names the
 * canonical vocabulary while `VIEW_FILTER_OPERATOR_ALIASES` (`ui/view.zod.ts`)
 * carries the deprecated bridge — not a new convention.
 */
export type FilterArrayOperator = keyof typeof AST_OPERATOR_MAP;

/**
 * The two keywords that open a {@link FilterArrayGroup}. Matched
 * case-insensitively at every door, so a field genuinely named `and` or `or`
 * cannot occupy a comparison node's field position — see
 * {@link FilterArraySchema}.
 */
export const FILTER_ARRAY_LOGIC_KEYWORDS = ['and', 'or'] as const;

/** `'and' | 'or'` — see {@link FILTER_ARRAY_LOGIC_KEYWORDS}. */
export type FilterArrayLogicKeyword = typeof FILTER_ARRAY_LOGIC_KEYWORDS[number];

/**
 * One comparison: `[field, operator, value]`.
 *
 * The two-element form is real and deliberate — the null predicates take their
 * direction from the operator NAME, so `['deleted_at', 'is_null']` carries no
 * value to give. `convertComparison` ignores the value position for those, and
 * every door accepts the short form.
 */
export type FilterArrayComparison =
  | [field: string, operator: FilterArrayOperator, value: unknown]
  | [field: string, operator: FilterArrayOperator];

/** `['and' | 'or', ...conditions]` — at least one condition, or it joins nothing. */
export type FilterArrayGroup =
  [logic: FilterArrayLogicKeyword, first: FilterArray, ...rest: FilterArray[]];

/** `[[…], […]]` — a bare list of conditions, combined with implicit AND. */
export type FilterArrayList = [first: FilterArray, ...rest: FilterArray[]];

/**
 * **Input-only** authoring sugar for a filter: the nested tuple/group array form
 * that React block props (`filters={['status', '=', stage]}`), the client
 * `FilterBuilder`, and the wire `$filter` face accept.
 *
 * ## It is sugar, and it is INPUT-only
 *
 * A `FilterArray` is not a storage shape and not a protocol shape. It is
 * lowered to a {@link FilterCondition} at the single sink
 * {@link parseFilterAST} (`@objectstack/spec/data`) the moment it arrives, and
 * only the lowered `FilterCondition` travels any further. `where` on a query
 * (`QuerySchema`, `data/query.zod.ts`) is a `FilterCondition` and **stays** one:
 * this shape is deliberately NOT part of that union, so nothing downstream — no
 * driver, no transport, no stored row — ever has to understand two filter
 * dialects. `filter-array-declaration.test.ts` pins that exclusion.
 *
 * Why it is declared here at all: four published contracts (three READMEs,
 * `llms.txt`, four skills, this package's own react-blocks prop table) have been
 * teaching authors to write `FilterArray` while the protocol never declared it —
 * a name with no definition, which is a pure trap for an AI author following the
 * contract it was given. #5158's ruling C keeps the ergonomics and gives the
 * name a definition, rather than widening the wire contract (rejected option A)
 * or tearing up the published contracts (rejected option B).
 *
 * ## Producers, measured
 *
 * - `FilterBuilder` (`@objectstack/client`) — emits comparison tuples and
 *   `['and', ...]` groups.
 * - React block props declared `FilterArray` in `ui/react-blocks.ts`
 *   (`ListView.filters`, `ObjectChart.filter`).
 * - The wire `$filter` face — `metadata-protocol` runs {@link isFilterAST} and
 *   converts through {@link parseFilterAST}, or answers `400 INVALID_FILTER`.
 *
 * @example
 * // Comparison
 * const f: FilterArray = ['status', '=', 'active'];
 * @example
 * // Group
 * const g: FilterArray = ['and', ['stage', '=', 'won'], ['amount', '>', 1000]];
 * @example
 * // Bare list, implicit AND
 * const l: FilterArray = [['stage', '=', 'won'], ['amount', '>', 1000]];
 *
 * @see parseFilterAST — the single lowering sink; the ONLY way this shape
 *   becomes something the runtime stores or executes.
 * @see FilterCondition — what it lowers to, and what `where` actually holds.
 * @see https://github.com/objectstack-ai/objectstack/issues/5158
 */
export type FilterArray = FilterArrayComparison | FilterArrayGroup | FilterArrayList;

/** Field position: non-empty, and never a logic keyword (that reading is taken). */
const FilterArrayFieldSchema = z.string().min(1).refine(
  (field) => !(FILTER_ARRAY_LOGIC_KEYWORDS as readonly string[]).includes(field.toLowerCase()),
  {
    message:
      `'and' / 'or' in the first position open a logical group, so they cannot name a field. `
      + `Write the comparison inside the group: ["and", ["field", "=", value]].`,
  },
);

/** Operator position: the vocabulary `isFilterAST` gates on, folded the same way. */
const FilterArrayOperatorSchema = z.string().refine(
  (op) => VALID_AST_OPERATORS.has(op.toLowerCase()),
  {
    error: (issue) =>
      `Unknown filter operator '${String(issue.input)}'. Recognised operators: `
      + `${[...VALID_AST_OPERATORS].sort().join(', ')}.`,
  },
);

/** Logic keyword position, folded case-insensitively like every door folds it. */
const FilterArrayLogicSchema = z.string().refine(
  (kw) => (FILTER_ARRAY_LOGIC_KEYWORDS as readonly string[]).includes(kw.toLowerCase()),
  { message: `A logical group opens with 'and' or 'or'.` },
);

/**
 * Zod schema for {@link FilterArray} — the authoring gate for the input-only
 * sugar. Recursive, so the type above is written out by hand and this is
 * annotated with it (the #4171 rule: a `z.ZodType< any >` annotation would throw
 * the type away silently). Both type arguments are given (#4195) — no
 * `.default()`, no `.transform()`, so input and output are the same shape.
 *
 * ## Relationship to `isFilterAST`
 *
 * {@link isFilterAST} stays the RUNTIME detector at the doors; this is the
 * stricter AUTHORING gate. They share one operator vocabulary and one case
 * fold, and differ in exactly TWO places — each a shape `isFilterAST` tolerates
 * by accident and no measured producer emits, both pinned in
 * `filter-array-declaration.test.ts` so the list cannot silently grow:
 *
 * | shape | `isFilterAST` | this schema |
 * |---|---|---|
 * | `['a', '=', 1, 2]` (trailing elements) | accepts, `convertComparison` drops the tail | rejects |
 * | `['', '=', 1]` (empty field name) | accepts | rejects |
 *
 * An empty `[]` is refused by both, and is called out because the flat-list
 * branch would otherwise swallow it: `[]` means "no filter", which is the
 * absence of this shape rather than an instance of it.
 *
 * Nothing consumes this schema as a door predicate today. It is the declaration
 * the published contracts were already citing, and the gate an authoring/publish
 * lint can hold producers to.
 */
export const FilterArraySchema: z.ZodType<FilterArray, FilterArray> = z.lazy(() =>
  z.union([
    // Comparison — three-element form, then the two-element null-predicate form.
    z.tuple([FilterArrayFieldSchema, FilterArrayOperatorSchema, z.unknown()]),
    z.tuple([FilterArrayFieldSchema, FilterArrayOperatorSchema]),
    // Logical group: the keyword plus at least one condition.
    z.tuple([FilterArrayLogicSchema, FilterArraySchema], FilterArraySchema),
    // Legacy flat list of conditions, implicit AND. `.min(1)` because an empty
    // array means "no filter", not "a filter that matches nothing".
    z.array(FilterArraySchema).min(1),
  ]).describe(
    'Input-only authoring sugar for a filter: [field, operator, value], '
    + '["and"|"or", ...conditions], or a bare list of those. Lowered to a '
    + 'FilterCondition at the single sink parseFilterAST (@objectstack/spec/data) '
    + 'the moment it arrives; it is never stored and never travels the wire as '
    + 'an array. A query "where" is a FilterCondition and does not accept this '
    + 'shape (#5158).'
  )
) as z.ZodType<FilterArray, FilterArray>;

// ============================================================================
// Constants & Metadata
// ============================================================================

/**
 * The operator keys every backend is expected to EVALUATE.
 *
 * ## This list is a runtime allowlist, not a word list (#5701)
 *
 * It reads like documentation and is used like a gate. Two consumers derive
 * enforcement from it rather than restating it — which is the right design, and
 * is exactly why an entry here is a claim about implementations, not about
 * vocabulary:
 *
 * - `driver-memory`'s `SUPPORTED_FIELD_OPERATORS` (`filter-refusal.ts`) is
 *   `new Set([...FILTER_OPERATORS, '$regex', '$options'])` — the set its shape
 *   gate ACCEPTS. Its matcher's `default:` arm then `break`s, on the documented
 *   assumption that the gate already refused anything unimplemented.
 * - `service-analytics`' `objectql-echo-operator-coverage.test.ts` asserts its
 *   compiler renders a predicate for every member.
 *
 * So a name added here before any backend implements it does not merely
 * document an intention. Measured on this branch by adding `$icontains` to this
 * array and rebuilding: `SUPPORTED_FIELD_OPERATORS.has('$icontains')` became
 * `true`, driver-memory's gate stopped refusing it, and
 * `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned **`true`**
 * — the predicate silently dropped, every row matched. A dropped predicate does
 * not narrow a query, it WIDENS it, and on an RLS read scope that is a
 * permission bypass rather than a degraded feature (#3948).
 *
 * ## `$icontains` is DECLARED but deliberately NOT here yet
 *
 * {@link StringOperatorSchema}, {@link FieldOperatorsSchema} and {@link Filter}
 * declare `$icontains` (#5701, the contract half of the #4706 ruling). This
 * array does not, and the difference is deliberate rather than an oversight:
 * those three are declaration and TYPE surfaces with no runtime allowlist
 * reader (verified — `NormalizedFilterSchema` is their only consumer, and
 * nothing parses a filter through it at runtime), so declaring there is inert.
 * Adding it HERE would flip driver-memory from a loud refusal to the silent
 * widening measured above, on a face that still cannot answer the operator.
 *
 * **`$icontains` joins this array in the PR that gives the JS faces an arm
 * (#6520), not before** — #5702 implemented the SQL family and correctly did
 * NOT add it here, because the array is read by the faces that still refuse.
 * `filter-operator-vocabulary.test.ts` pins the difference between
 * the two surfaces at exactly `{ $icontains }`, so this staging cannot silently
 * grow a second member, and clearing it is what makes that pin fail.
 *
 * Retired operators (`$regex`, `$options`) are not here either, and never were.
 * Their prescriptions live in {@link RETIRED_FILTER_OPERATORS}.
 */
export const FILTER_OPERATORS = [
  // Equality
  '$eq', '$ne',
  // Comparison
  '$gt', '$gte', '$lt', '$lte',
  // Set & Range
  '$in', '$nin', '$between',
  // String
  '$contains', '$notContains', '$startsWith', '$endsWith',
  // Special
  '$null', '$exists',
] as const;

/**
 * Logical operator keys.
 */
export const LOGICAL_OPERATORS = ['$and', '$or', '$not'] as const;

/**
 * All operator keys (field + logical).
 */
export const ALL_OPERATORS = [...FILTER_OPERATORS, ...LOGICAL_OPERATORS] as const;

export type FilterOperatorKey = typeof FILTER_OPERATORS[number];
export type LogicalOperatorKey = typeof LOGICAL_OPERATORS[number];
export type OperatorKey = typeof ALL_OPERATORS[number];

// ============================================================================
// Retired Operators — the prescriptions a refusal prints (#5701)
// ============================================================================

/** The prescription for one retired filter operator. */
export interface RetiredFilterOperatorGuidance {
  /**
   * The operator that replaces it, when one does. Absent when the retirement
   * has no successor and the fix is to restructure the query.
   */
  readonly to?: string;
  /**
   * The upgrade prescription, written as an instruction. This string IS the
   * migration doc for whoever hits it — a refusal is expected to print it
   * verbatim rather than paraphrase, so that five refusal sites say one thing.
   */
  readonly why: string;
}

/**
 * Filter operators that were REMOVED from the protocol, and what to write
 * instead (#5701, the #4706 ruling's contract half).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is **data**: a lookup table, no behaviour (Prime Directive #2). It does
 * not reject anything, and this file's schemas are unchanged by its existence —
 * {@link FilterConditionSchema} still accepts any `$`-key, because narrowing it
 * to a closed vocabulary is structurally impossible here (a nested relation
 * constraint `{ profile: { verified: true } }` and an operator object are the
 * same shape) and would reach every filter consumer at once. The #4706 ruling
 * took that trade explicitly: the spec declares, the existing refusal sites
 * enforce.
 *
 * Those sites are the five that already refuse unknown operators today —
 * `driver-sql`'s `default:` arm, `driver-turso`'s remote transport,
 * `driver-memory`'s `filter-refusal.ts`, `driver-mongodb`'s
 * `translateFieldOperators`, and `objectql`'s `having` — and the point of one
 * table is that they stop each writing their own sentence. Wiring them to it is
 * **#5702**, deliberately not this PR: `$regex` still has one live producer
 * (`plugin-auth`'s ObjectQL adapter, on the authentication path), so a refusal
 * landing before #5710 flips that producer would break sign-in. Hard order:
 * **#5710 flips the producer, then #5702 turns these strings into refusals.**
 *
 * ## Why `$regex` was retired rather than implemented (#4706)
 *
 * It was never in {@link FILTER_OPERATORS} — it was an undeclared operator that
 * one producer emitted and four consumers grew arms for, each reading it
 * differently. `driver-sql` compiled it to a substring `LIKE` with the value
 * LIKE-escaped, so it was not a regex at all: `a.b` matched only the literal
 * `a.b`. `driver-memory` ran it as a real `RegExp`, so the same filter matched
 * `axb` too, and an invalid pattern was caught and answered `false` — zero rows,
 * in silence. Implementing a real regex on all five was rejected as
 * structurally impossible: turso's remote transport speaks a wire protocol with
 * no way to register a SQLite `REGEXP` function.
 *
 * The replacement is the case-insensitive containment the one real producer
 * actually wanted: {@link StringOperatorSchema}'s `$icontains`.
 */
export const RETIRED_FILTER_OPERATORS: Readonly<
  Record<string, RetiredFilterOperatorGuidance>
> = Object.freeze({
  $regex: {
    to: '$icontains',
    why:
      '`$regex` was never declared by the Filter Protocol and is retired (#4706). It could not '
      + 'mean one thing across the backends: driver-sql compiled it to a LIKE-escaped substring '
      + 'match (so "a.b" matched only the literal "a.b"), driver-memory evaluated it as a real '
      + 'RegExp (so it also matched "axb", and an invalid pattern silently matched nothing), and '
      + 'a real regex is not implementable on all five — driver-turso\'s remote transport cannot '
      + 'register a SQLite REGEXP function over its wire protocol. Write `$icontains` for the '
      + 'case-insensitive substring search this was almost always used for (ASCII case fold; the '
      + 'comparand is matched literally, so "." and "%" are ordinary characters), or `$contains` '
      + 'for a case-sensitive one. A pattern that genuinely needs a regex has no filter-level '
      + 'replacement — narrow with the declared operators and match in application code.',
  },
  $options: {
    to: '$icontains',
    why:
      '`$options` was never a predicate — it was the regex-flags companion to `$regex`, which is '
      + 'retired (#4706). Its only real use was `$options: "i"` for a case-insensitive match: '
      + 'write `$icontains` instead, which says that in the operator name and folds ASCII case on '
      + 'every backend. On its own, with no `$regex` beside it, it never constrained anything.',
  },
});
