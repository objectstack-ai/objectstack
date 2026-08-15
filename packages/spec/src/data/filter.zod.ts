// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { normalizeFilterComparandTypes } from './filter-comparand-type';
import { bareDateRangePresetComparandMessage, isDateRangePresetName } from './date-range-presets';

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
 * - **In-memory evaluation — supported, in SCALAR positions only.**
 *   `matchesFilter` (`@objectstack/formula`, `matches-filter.ts`) resolves the
 *   reference against the record, dot-paths included, when the reference is the
 *   WHOLE comparand. It does **not** descend into a list — see the LIST
 *   positions carve-out below.
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
 * ## LIST positions are NOT part of this declaration (#7596, ruled 2026-08-11)
 *
 * A reference may be the whole comparand of a scalar comparison. It may **not**
 * be a member of an `$in` / `$nin` list, nor an endpoint of a `$between` range.
 * Those positions were declared here — both `$between` endpoints carried
 * `FieldReferenceSchema`, and `$in` / `$nin` admitted anything — and **no**
 * backend ever resolved them:
 *
 * - **The memory evaluator returns a list unresolved, structurally.**
 *   `matches-filter.ts` `resolveValue` reads `$field` only off a non-array
 *   object (`!Array.isArray(raw) && '$field' in raw`), and `evalOp` resolves the
 *   whole comparand and never its members. So `$in` / `$nin` compare the raw
 *   reference OBJECT with `looseEq` against a stored value — never equal — and
 *   a `$between` endpoint becomes an ordering bound that is an object. Both fail
 *   SILENTLY: the `$in` direction matches nothing, and the `$nin` direction
 *   loses an exclusion the author wrote, which on an RLS `check` widens a scope.
 * - **Both SQL faces already refuse them**, by name and by index (#5041 installed
 *   the refusal, #5222 deliberately kept it: there is no correct in-memory
 *   semantics for SQL to be conformance-equivalent TO).
 *
 * So the declaration was honoured by nobody and refused by two backends —
 * ADR-0049's enforce-or-remove shape at a declared position. The maintainer
 * ruled REMOVE rather than implement: member resolution has zero measured
 * consumers, and per-member OR-expansion carries NULL and type-affinity
 * questions #5222 declined to guess at. The positions now refuse at the SCHEMA
 * door too, with a message naming the working alternative — see
 * {@link SetOperatorSchema} and {@link RangeOperatorSchema}.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/5041 (refusal)
 * @see https://github.com/objectstack-ai/objectstack/issues/5222 (SQL support)
 * @see https://github.com/objectstack-ai/objectstack/issues/7596 (list positions removed)
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
 * [#7596] Is `value` shaped like a {@link FieldReferenceSchema} reference?
 *
 * SHAPE only, and deliberately so — the referenced name is not consulted. The
 * point is to recognise what the author WROTE so the refusal can name it, which
 * has to happen for any `{ $field: … }`, not only for one whose referent would
 * have resolved. It mirrors `matches-filter.ts` `resolveValue`'s own test
 * (a non-array object carrying a `$field` key) so that "the shape the evaluator
 * would have looked for" and "the shape refused here" cannot drift apart.
 */
function isFieldReferenceShape(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && '$field' in value;
}

/**
 * [#7596] The author-facing refusal for a `{ $field }` reference in a LIST
 * position — every `$in` / `$nin` member, and both `$between` endpoints.
 *
 * One builder for all four positions because it is one ruling; `position`
 * carries the only part that differs, and it names the INDEX for the reason
 * `crossFieldComparisonError` (`@objectstack/driver-sql`) names it: the index is
 * the only thing distinguishing the bad member from its legitimate neighbours.
 *
 * ## Why the message says what it says
 *
 * The schema door and the driver door answer the same author, so they must not
 * contradict each other. The SQL drivers' wording ends with two escapes —
 * "compare against a literal value here, or evaluate the rule in memory
 * (matchesFilter)" — and the SECOND one is not available at a list position:
 * the memory evaluator does not resolve list members either, it just fails
 * silently instead of loudly. Repeating it here would send an author to the one
 * path whose answer is a wrong row set rather than an error. So this message
 * keeps the literal-value escape, replaces the in-memory escape with the
 * position that genuinely works (the reference as the WHOLE comparand of a
 * scalar comparison, which #5222 compiles), and states the ruling that removed
 * the position so the change is attributable from the error alone.
 */
function listPositionFieldReferenceMessage(position: string): string {
  return (
    `A { "$field": … } reference is not a valid ${position}. No evaluation path resolves a field `
    + 'reference inside a list: the in-memory evaluator (matchesFilter) leaves the list '
    + 'unresolved and compares the raw reference OBJECT, so it silently matches nothing, and '
    + 'both SQL drivers refuse the position with INVALID_FILTER / 400. Write a literal value '
    + 'here, or move the reference to a scalar comparison operator '
    + '($eq/$ne/$gt/$gte/$lt/$lte), whose WHOLE comparand a { $field } reference may be. '
    + 'Ruled 2026-08-11 on #7596: declared = enforced (ADR-0049).'
  );
}

/**
 * [#7596] `$in` / `$nin`, with the `{ $field }` member ruled out by name.
 *
 * The members stay `z.any()`: a set-membership list is genuinely heterogeneous
 * (a `lookup` id, an ISO day, a number), and this schema is field-AGNOSTIC — it
 * never sees which column the list applies to, so narrowing the member type
 * would refuse working filters, exactly the finding `RangeOperatorSchema`'s
 * "why a BARE string" section records for the sibling slot. What IS removable
 * is the one shape no backend implements, so it is removed as a check rather
 * than as a type change: everything else keeps parsing, `{ $field }` is refused
 * with the message it needs, and the generated JSON Schema still describes the
 * list as the open one it is.
 */
const setMembershipSchema = (op: '$in' | '$nin') =>
  z.array(z.any()).superRefine((members, ctx) => {
    members.forEach((member, index) => {
      if (!isFieldReferenceShape(member)) return;
      ctx.addIssue({
        code: 'custom',
        path: [index],
        message: listPositionFieldReferenceMessage(`${op} member at index ${index}`),
      });
    });
  });

/** The `describe()` both `$in` and `$nin` carry, stating the one ruled-out member shape. */
const SET_MEMBER_DESCRIPTION =
  'Membership list. Members are literal values of any type the column stores. A '
  + '{ $field } reference is NOT a member shape: no backend resolves one inside a list '
  + '(#7596) — put it in a scalar comparison ($eq/$ne/$gt/$gte/$lt/$lte) instead.';

/**
 * Set operators for membership checks.
 *
 * ## A `{ $field }` member is refused (#7596, ruled 2026-08-11)
 *
 * `$in` / `$nin` admit any member type EXCEPT a {@link FieldReferenceSchema}
 * reference, which no evaluation path resolves — the reasoning is recorded on
 * `FieldReferenceSchema` itself, and the refusal wording on
 * {@link listPositionFieldReferenceMessage}. The `$nin` direction is the one
 * that mattered: an unresolved member drops an EXCLUSION the author wrote,
 * which widens the result set rather than emptying it.
 */
export const SetOperatorSchema = lazySchema(() => z.object({
  /** In list - SQL: IN (?, ?, ?) | MongoDB: $in */
  $in: setMembershipSchema('$in').optional().describe(SET_MEMBER_DESCRIPTION),

  /** Not in list - SQL: NOT IN (...) | MongoDB: $nin */
  $nin: setMembershipSchema('$nin').optional().describe(SET_MEMBER_DESCRIPTION),
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
  'Closed interval [min, max]. Each endpoint is a number, a Date, or a string. '
  + 'A { $field } reference is NOT an endpoint shape: no backend resolves one '
  + 'inside a list (#7596) — put it in a scalar comparison '
  + '($gt/$gte/$lt/$lte), which does compile to a column-to-column bound. '
  + 'STRING is the form the '
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
 * Supported endpoint types: **Number, Date, ISO/clock STRING**.
 *
 * ## A `{ $field }` endpoint is refused (#7596, ruled 2026-08-11)
 *
 * Both endpoint unions carried `FieldReferenceSchema` until this ruling, and no
 * backend ever resolved one: `matches-filter.ts` leaves a list unresolved and
 * orders against the raw reference OBJECT, while both SQL faces refuse the
 * position loudly. ADR-0049's enforce-or-remove shape, resolved by REMOVAL —
 * the reasoning is recorded on {@link FieldReferenceSchema}, the wording on
 * `listPositionFieldReferenceMessage`.
 *
 * The reference stays legal in the four ORDERING slots
 * ({@link ComparisonOperatorSchema}) — that is #5222's shipped capability, and
 * it is also the alternative this refusal prescribes. "A range IS its two
 * ordering bounds" therefore stops being true of the COMPARAND union at exactly
 * one member: `$gt` takes a reference because a scalar comparison compiles to a
 * column-to-column bound; a `$between` endpoint does not, because nothing
 * resolves a member of a list. An author wanting a column-to-column range
 * writes the two bounds separately (`{ $gte: { $field: 'a' }, $lte: { $field: 'b' } }`),
 * which every face already answers.
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
/**
 * [#7596] One `$between` endpoint, with the `{ $field }` shape ruled out.
 *
 * ## Why the refusal rides on the union's `error` and not on a `superRefine`
 *
 * Measured on zod 4.4.3: a check attached to the TUPLE does not run once an
 * ELEMENT has failed, so a tuple-level refinement could never see the endpoint
 * it was written to explain — the author would get zod's bare
 * `invalid_union` / "Invalid input" and nothing else. The union's own `error`
 * callback runs exactly when the union rejects and sees the offending input, so
 * it replaces that generic text with {@link listPositionFieldReferenceMessage}
 * for this one shape and returns `undefined` for every other rejection, leaving
 * zod's default wording — and, importantly, the issue's `code` and `path` —
 * untouched for the endpoint shapes that were already invalid.
 *
 * `index` is baked in per endpoint rather than read from the issue: at the time
 * the union reports, the path is still relative to the union itself and the
 * tuple has not yet prefixed the position.
 */
const rangeEndpointSchema = (index: 0 | 1) =>
  z.union([z.number(), z.date(), z.string()], {
    error: (issue) =>
      isFieldReferenceShape(issue.input)
        ? listPositionFieldReferenceMessage(`$between endpoint at index ${index}`)
        : undefined,
  });

export const RangeOperatorSchema = lazySchema(() => z.object({
  /** Between (inclusive) - takes [min, max] array */
  $between: z.tuple([rangeEndpointSchema(0), rangeEndpointSchema(1)]).optional()
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
 * | `driver-memory` — query path and analytics face | INSENSITIVE, full Unicode | `new RegExp(escapeRegex(v), 'i')` — the last one standing; #6682 closed it (see "Implementation status" below) |
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
 * ### Implementation status — EVERY face answers it (#6520)
 *
 * #5701 shipped this declaration deliberately ahead of every runtime, #5702
 * (closed 2026-08-08, retuned by #6518) landed the lowerings on the SQL family,
 * and #6520 closed the remainder in one PR. Measured per face, by running
 * `{ name: { $icontains: 'acme' } }` against a fixture holding BOTH `acme corp`
 * and `ACME CORP` — not by grepping for a case arm, which is blind to the face
 * that inherits its compiler and so undercounts:
 *
 * | face | `$icontains` | how it gets there |
 * |---|---|---|
 * | `driver-sql` | ANSWERS both rows | its own `case '$icontains'`, folding through the same emitter that carries the escaping |
 * | `driver-sqlite-wasm` | ANSWERS both rows | INHERITED — `SqliteWasmDriver extends SqlDriver`; this package carries no text case arm of its own, on a different ENGINE |
 * | `driver-turso` | ANSWERS both rows, on BOTH transports | local inherits `SqlDriver`; the remote transport compiles independently and has its own arm |
 * | `driver-memory` — query path, reference matcher, analytics face | ANSWERS both rows | #6520; the pattern faces take {@link asciiCaseInsensitiveRegexSource}, the matcher {@link asciiCaseInsensitiveContains} |
 * | `driver-mongodb` | ANSWERS both rows | #6520; an ASCII-only `$regex`, never `$options: 'i'` |
 * | objectql `having` | ANSWERS both rows | #6520; {@link asciiCaseInsensitiveContains} over the aggregated row |
 * | `formula` `matchesFilterCondition` | ANSWERS both rows | #6520; the same helper, on the RLS write-side `check` |
 * | `service-analytics` (3 compilers) | ANSWERS both rows | #6520; an ASCII fold rendered into SQL on both sides of the `LIKE` |
 *
 * **So the sentence an author needs is no longer "not portable".** `$icontains`
 * is executable on every backend and every evaluation face the platform ships,
 * and it folds the SAME domain on all of them. The divergence #6520 was filed
 * over — an app whose tests run on the in-memory double and whose production
 * runs SQL getting two answers from one filter — is closed.
 *
 * One posture note that is NOT about `$icontains` and is easy to misread from
 * this table: `formula`'s evaluator answers an operator it does not know with a
 * silent `false` (fail-closed — it governs a WRITE-side `check`, so an
 * unevaluable condition DENIES), where the other JS faces throw
 * `INVALID_FILTER`. That difference is deliberate and documented on
 * `matches-filter.ts`; what #6520 changed is that no operator this array
 * DECLARES is answered that way any more.
 *
 * The `$contains`-family alignment the ruling above requires is now DONE on
 * every backend: #6518 made that family case-EXACT across the SQL dialects,
 * #6682 did the same on `driver-mongodb` (the hardcoded `$options: 'i'` is off
 * all four arms, and that driver's every face — query, count, write and the
 * aggregation `$match` — routes through the one `translateFilter`, so there is
 * no second answer) and then on `driver-memory`, whose query path and analytics
 * face lost the `i` flag their shared rule carried (`filterSubstringPattern`).
 * That last one closed the package that answered this operator two ways: its
 * reference matcher had been case-exact all along, so the fix moved the two
 * that were wrong onto the one that was right.
 *
 * `FILTER_TEXT_CASES` (`filter-text-conformance.ts`) is the standard that
 * measures all of the above, and every driver now IMPORTS it — the
 * driver-conformance ledger is empty. Read the open set from a run of that gate
 * rather than from this paragraph.
 *
 * @see FILTER_TEXT_CASES — the conformance standard for every operator here.
 * @see RETIRED_FILTER_OPERATORS — why `$regex` is not in this list.
 * @see https://github.com/objectstack-ai/objectstack/issues/4706 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/5702 (the SQL family — landed)
 * @see https://github.com/objectstack-ai/objectstack/issues/6520 (the JS faces — landed)
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
    + 'both transports); #6520 lowered it on every JS evaluation face, so it is '
    + 'portable across every backend the platform ships.]'
  ),

  /**
   * [#7536] Whole-string SQL `LIKE` pattern match — the comparand IS the
   * pattern, and the CALLER binds the wildcards. The operator every `like`
   * spelling of the AST vocabulary lowers to; unlike the `$contains` family
   * above, nothing here is escaped or wrapped on the comparand's behalf.
   */
  $like: z.string().optional().describe(
    'Whole-string pattern match with CALLER-bound wildcards: "%" matches any '
    + 'sequence (including empty), "_" matches exactly one character, and a '
    + 'backslash escapes the character after it ("\\%", "\\_", "\\\\") so it '
    + 'matches literally. The pattern must cover the WHOLE value — a pattern '
    + 'with no wildcards is an exact comparison, NOT a substring search; write '
    + '$contains for containment. A pattern ending in a lone unpaired backslash '
    + 'is refused (INVALID_FILTER). Comparison is case-SENSITIVE, same contract '
    + 'as $contains (#4706 Q2 = A); $ilike is the case-insensitive twin. '
    + '[#7536. Answered by the SQL family (driver-sql, driver-sqlite-wasm, '
    + 'driver-turso on both transports), by driver-memory and by '
    + '@objectstack/formula. driver-mongodb, objectql `having` and '
    + 'service-analytics REFUSE it in the INVALID_FILTER envelope rather than '
    + 'approximating it — see FILTER_OPERATORS for why it is staged out of that '
    + 'allowlist.]'
  ),

  /**
   * [#7536] `$like`'s case-insensitive twin — same pattern language, folding
   * ASCII case only (the #4706 Q1 = A domain `$icontains` pinned).
   */
  $ilike: z.string().optional().describe(
    'Whole-string pattern match like $like — "%" / "_" wildcards bound by the '
    + 'caller, backslash escapes — but ignoring ASCII case (A-Z against a-z) '
    + 'and ONLY ASCII case: "café" does NOT match "CAFÉ", the same #4706 Q1 = A '
    + 'boundary $icontains declares, because SQLite\'s fold is ASCII-only and '
    + 'three of the five backends are SQLite underneath. [#7536; staged with '
    + '$like — see FILTER_OPERATORS.]'
  ),
}));

// ============================================================================
// The ASCII fold — ONE implementation for every JS evaluation face (#6520)
// ============================================================================

/** `A`..`Z`, and the `a`..`z` they fold onto. The domain #4706 Q1 = A pinned. */
const ASCII_UPPER_FIRST = 0x41; // 'A'
const ASCII_UPPER_LAST = 0x5a; // 'Z'
const ASCII_CASE_DELTA = 0x20; // 'a' - 'A'

/**
 * [#6520] Fold a string's ASCII case, and NOTHING else — the `$icontains`
 * comparison domain, as a function.
 *
 * ## Why this is in the spec and not four times in four packages
 *
 * `$icontains` has six JS evaluation faces (`driver-memory`'s query path,
 * reference matcher and analytics face, `driver-mongodb`, objectql's `having`,
 * `@objectstack/formula`'s `matchesFilterCondition`) plus three SQL compilers in
 * `service-analytics`. Every one of them needs the same fold, and this repo has
 * already measured what happens when such a rule is written out per package:
 * *"a list written out here would agree with the spec on the day it was typed
 * and never again"* (`driver-memory/src/filter-refusal.ts`, on the operator
 * vocabulary) — the #3948 shape, reached through the fold instead of the word
 * list. One definition means a fold that is wrong is wrong everywhere at once,
 * which is the only way six faces can be held to one answer.
 *
 * ## Why not `toLowerCase()`
 *
 * `String.prototype.toLowerCase()` is the FULL Unicode fold: it maps `É` to `é`
 * and `МОСКВА` to `москва`. The contract says those must NOT match (#4706 Q1 =
 * A), and the reason is not preference — SQLite has no ICU in this repo's build,
 * so its `lower()` folds ASCII only, and three of the five drivers are SQLite
 * underneath. A Unicode promise here would be one the SQL family could not keep,
 * so a JS face that reaches for `toLowerCase()` does not merely differ from the
 * ruling: it re-opens the divergence the ruling closed. `FILTER_TEXT_CASES`'
 * `CAFÉ` / `café` pair is the row that catches it.
 *
 * The same trap wears a second disguise on the regex-evaluating faces: a
 * `RegExp` built with the `i` flag ALSO folds the whole Unicode range. Those
 * faces take {@link asciiCaseInsensitiveRegexSource}, not an `i` flag.
 *
 * @see asciiCaseInsensitiveContains — the containment test built on this.
 * @see https://github.com/objectstack-ai/objectstack/issues/4706 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/6520 (the JS faces)
 */
export function foldAsciiCase(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out += code >= ASCII_UPPER_FIRST && code <= ASCII_UPPER_LAST
      ? String.fromCharCode(code + ASCII_CASE_DELTA)
      : value[i];
  }
  return out;
}

/**
 * [#6520] Does `haystack` contain `needle`, ignoring ASCII case only?
 *
 * The `$icontains` predicate for every face that can compare two JS strings
 * directly — the reference matcher, objectql's `having`, `formula`. The fold
 * runs on BOTH sides, which is the half that is easy to get wrong: folding only
 * the comparand compares a folded needle against a raw haystack and matches just
 * the rows that were already lower-case. `FILTER_TEXT_CASES`' first row (an
 * upper-case row from a lower-case comparand) is the one that catches it, and
 * `driver-sql`'s emitter carries the same note over its own two-sided fold.
 */
export function asciiCaseInsensitiveContains(haystack: string, needle: string): boolean {
  return foldAsciiCase(haystack).includes(foldAsciiCase(needle));
}

/**
 * [#6520] `comparand` as a regular-expression SOURCE that matches it LITERALLY,
 * ignoring ASCII case only.
 *
 * For the faces that cannot fold the stored value because they hand a pattern to
 * an engine rather than comparing two strings: `driver-memory`'s mingo query
 * path and its analytics face, and `driver-mongodb`'s translator. Neither can
 * apply {@link foldAsciiCase} to the column, so the fold has to live in the
 * PATTERN — each ASCII letter becomes the two-member character class `[Aa]`,
 * which folds that position on both sides without touching any other character.
 *
 * Two properties, and the second is the one an `i` flag would destroy:
 *
 * - **The comparand is LITERAL.** Every regex metacharacter is escaped, so
 *   `a.b` matches `a.b` and not `axb` — the `$regex` defect #4706 retired the
 *   operator over, restated as a requirement (`FILTER_TEXT_CASES`' `.` row).
 * - **The fold is ASCII-ONLY.** `É` is not an ASCII letter, so it is emitted as
 *   itself and compares literally. A `new RegExp(source, 'i')` would fold it and
 *   fail the `CAFÉ` row — so callers pass NO flags. The returned source is
 *   already case-insensitive exactly where the contract says it should be.
 */
export function asciiCaseInsensitiveRegexSource(comparand: string): string {
  let out = '';
  for (let i = 0; i < comparand.length; i++) {
    const ch = comparand[i];
    const code = comparand.charCodeAt(i);
    if (code >= ASCII_UPPER_FIRST && code <= ASCII_UPPER_LAST) {
      out += `[${ch}${String.fromCharCode(code + ASCII_CASE_DELTA)}]`;
    } else if (code >= ASCII_UPPER_FIRST + ASCII_CASE_DELTA && code <= ASCII_UPPER_LAST + ASCII_CASE_DELTA) {
      out += `[${String.fromCharCode(code - ASCII_CASE_DELTA)}${ch}]`;
    } else {
      // Escape every regex metacharacter — the comparand is text, not a pattern.
      out += /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return out;
}

// ============================================================================
// The `$like` pattern language — ONE definition for every face (#7536)
// ============================================================================

/**
 * [#7536] Does this `$like`/`$ilike` pattern end in a LONE, unpaired backslash?
 *
 * Such a pattern is REFUSED everywhere rather than given a meaning, because the
 * backends could not be made to agree on one: Postgres raises `LIKE pattern
 * must not end with escape character` at query time, while a JS translation
 * would have to invent an answer ("literal backslash"? "dropped"?) that SQL
 * then contradicts. A shape that cannot mean one thing on every backend is
 * refused at the door — the same direction #5041/#5234 settled for
 * uncompilable comparands. The check is shared so the refusal fires on the
 * SAME patterns at every face; each face wraps it in its own ADR-0112
 * `INVALID_FILTER` envelope.
 */
export function hasDanglingLikeEscape(pattern: string): boolean {
  let backslashes = 0;
  for (let i = pattern.length - 1; i >= 0 && pattern[i] === '\\'; i--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * [#7536] A `$like`/`$ilike` pattern as a regular-expression SOURCE with the
 * SAME meaning — the one translation every JS evaluation face must share, for
 * the reason {@link foldAsciiCase} gives: a translation written per package
 * agrees with the spec on the day it is typed and never again.
 *
 * The pattern language, translated element by element:
 *
 * - `%` → `[\s\S]*` — any sequence, including empty and including newlines
 *   (SQL `LIKE` has no "dot-all" concept; `%` crosses line boundaries).
 * - `_` → `[\s\S]` — exactly one character, any character.
 * - `\x` → the character `x`, literally, whatever `x` is — this is how a
 *   caller matches a literal `%`, `_` or `\`. (Postgres and MySQL read an
 *   escaped ordinary character the same way.)
 * - every other character → itself, regex-escaped, and — when `foldAscii` is
 *   set ($ilike) — an ASCII letter becomes its two-member character class
 *   (`[Aa]`), the {@link asciiCaseInsensitiveRegexSource} fold, so the fold
 *   lives in the pattern and callers pass NO regex flags (an `i` flag folds
 *   Unicode, which is the #4706 Q1 = A boundary violation).
 * - the whole source is anchored `^…$`: `LIKE` matches the WHOLE value, so a
 *   wildcard-free pattern is an exact comparison, not a substring search.
 *
 * Throws a plain `Error` on a dangling trailing escape — gate with
 * {@link hasDanglingLikeEscape} first to refuse in your own envelope; the
 * throw here is the backstop that keeps a missed gate from minting a pattern
 * with an invented meaning.
 */
export function likePatternToRegexSource(pattern: string, foldAscii = false): string {
  if (hasDanglingLikeEscape(pattern)) {
    throw new Error(
      `LIKE pattern ${JSON.stringify(pattern)} ends with a lone unpaired backslash; ` +
        'write "\\\\\\\\" to match a literal backslash.',
    );
  }
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    let ch = pattern[i];
    let literal = false;
    if (ch === '\\') {
      // Guarded above: a trailing `\` cannot reach here.
      ch = pattern[++i];
      literal = true;
    }
    if (!literal && ch === '%') {
      out += '[\\s\\S]*';
      continue;
    }
    if (!literal && ch === '_') {
      out += '[\\s\\S]';
      continue;
    }
    const code = ch.charCodeAt(0);
    if (foldAscii && code >= ASCII_UPPER_FIRST && code <= ASCII_UPPER_LAST) {
      out += `[${ch}${String.fromCharCode(code + ASCII_CASE_DELTA)}]`;
    } else if (
      foldAscii
      && code >= ASCII_UPPER_FIRST + ASCII_CASE_DELTA
      && code <= ASCII_UPPER_LAST + ASCII_CASE_DELTA
    ) {
      out += `[${String.fromCharCode(code - ASCII_CASE_DELTA)}${ch}]`;
    } else {
      out += /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return `${out}$`;
}

/**
 * [#7536] Does `value` match the `$like`/`$ilike` `pattern`? The predicate for
 * every face that holds both strings in JS — the {@link likePatternToRegexSource}
 * translation, evaluated. `foldAscii` selects the `$ilike` fold (ASCII only).
 */
export function matchesLikePattern(value: string, pattern: string, foldAscii = false): boolean {
  return new RegExp(likePatternToRegexSource(pattern, foldAscii)).test(value);
}

/**
 * [#7536] A `$like`/`$ilike` pattern as an equivalent SQLite **GLOB** pattern.
 *
 * ## Why the SQLite family cannot just pass the pattern to `LIKE`
 *
 * `$like` is case-SENSITIVE (the #4706 Q2 = A contract its `$contains` sibling
 * already answers), and SQLite's `LIKE` folds ASCII case unconditionally.
 * #6518 measured every way out of that and landed on `GLOB`, which is
 * case-exact by definition: `PRAGMA case_sensitive_like` is CONNECTION-global,
 * so one query would redefine every other query on the connection, and
 * `CAST(col AS BLOB) LIKE ?` was measured to match NOTHING. Three of the five
 * backends are SQLite underneath (driver-sql on better-sqlite3,
 * driver-sqlite-wasm, driver-turso on both transports), so without this
 * translation `$like` would mean one thing on Postgres and another on SQLite —
 * the divergence #6518 closed for `$contains`, re-opened one operator over.
 *
 * `GLOB` has a DIFFERENT pattern language, which is the whole reason this is a
 * translation and not an escape:
 *
 * | LIKE | GLOB | note |
 * |---|---|---|
 * | `%` | `*` | any sequence, including empty |
 * | `_` | `?` | exactly one character |
 * | `\x` | `x`, escaped | the caller's literal, whatever `x` is |
 * | `*` `?` `[` | `[*]` `[?]` `[[]` | GLOB's OWN metacharacters, which are ORDINARY characters to LIKE — this is the direction a hand-written escape forgets, and forgetting it is the `%`-matches-every-row bypass (#5567) wearing GLOB's clothes |
 * | `]` | `]` | needs no escape: every `[` above becomes a class that closes itself, so no unclosed class survives for a later `]` to terminate |
 *
 * Shared from the spec rather than written per driver for the reason
 * {@link foldAsciiCase} gives: `driver-sql`'s emitter and `driver-turso`'s
 * remote transport compile the same operator independently, and a translation
 * written twice agrees on the day it is typed and never again.
 *
 * Throws on a dangling trailing escape, exactly like
 * {@link likePatternToRegexSource} — gate with {@link hasDanglingLikeEscape}.
 */
export function likePatternToGlobPattern(pattern: string): string {
  if (hasDanglingLikeEscape(pattern)) {
    throw new Error(
      `LIKE pattern ${JSON.stringify(pattern)} ends with a lone unpaired backslash; ` +
        'write "\\\\\\\\" to match a literal backslash.',
    );
  }
  const globEscape = (ch: string) => (/[*?[]/.test(ch) ? `[${ch}]` : ch);
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      // Guarded above: a trailing `\` cannot reach here.
      out += globEscape(pattern[++i]);
      continue;
    }
    if (ch === '%') { out += '*'; continue; }
    if (ch === '_') { out += '?'; continue; }
    out += globEscape(ch);
  }
  return out;
}

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
  
  // Set. Members are open (`z.any()`) EXCEPT the one shape no backend resolves:
  // a `{ $field }` reference, ruled out by name in #7596. Built from the same
  // `setMembershipSchema` factory the documentation copy uses — the two copies
  // share the code rather than a description of it, so this pair cannot drift.
  $in: setMembershipSchema('$in').optional().describe(SET_MEMBER_DESCRIPTION),
  $nin: setMembershipSchema('$nin').optional().describe(SET_MEMBER_DESCRIPTION),
  // Range. `string` is in BOTH endpoint unions for the reason
  // {@link RangeOperatorSchema} gives at length (#6571): the date-macro resolver
  // walks into arrays, so a token range resolves to two ISO/clock STRINGS, and
  // this package's own `temporal-conformance.ts` corpus spells that shape.
  // `FieldReferenceSchema` is NOT in them, for the reason the same docblock
  // gives (#7596): nothing resolves a reference inside a list. This copy is the
  // ENFORCED one — `NormalizedFilterSchema` validates against it and the
  // exported `FieldOperators` is inferred from it — so it must not drift from
  // the documentation copy above. #5685 landed the sibling ordering slots in the
  // documentation copy first and left the reachable surface still rejecting the
  // platform's own output; both spellings move together, which is why the
  // endpoint is one shared `rangeEndpointSchema` factory here too.
  $between: z.tuple([rangeEndpointSchema(0), rangeEndpointSchema(1)]).optional(),

  // String-specific. Case-SENSITIVE, except `$icontains` which folds ASCII case
  // only — see {@link StringOperatorSchema} for the contract and its boundary.
  $contains: z.string().optional(),
  $notContains: z.string().optional(),
  $startsWith: z.string().optional(),
  $endsWith: z.string().optional(),
  $icontains: z.string().optional(),
  // Pattern-matching pair (#7536): the comparand IS a LIKE pattern, wildcards
  // bound by the CALLER — see {@link StringOperatorSchema} for the language.
  // `$ilike` folds ASCII case only, `$like` is case-exact.
  $like: z.string().optional(),
  $ilike: z.string().optional(),

  // Special
  $null: z.boolean().optional(),
  $exists: z.boolean().optional(),
}));

// ============================================================================
// 3.35 Bare date-range preset names in ordering comparands — REFUSED (#8793)
// ============================================================================

/**
 * [#8793] The ordering positions a bare dashboard date-range PRESET name is
 * refused from — the #8690 C half, maintainer-ruled 2026-08-15 (delegated
 * adjudication on #8690, comment 5299879288): "refuse the declared preset
 * vocabulary (`last_7_days`/`last_30_days`/`last_90_days` as bare strings in a
 * temporal filter) at publish time, `packages/spec` + `@objectstack/lint`".
 *
 * ## The defect this closes, measured end to end (#8690)
 *
 * ```
 * $gte "last_30_days"   HTTP 200  count=0    <- silent zero (the defect)
 * $gte "{30_days_ago}"  HTTP 200  count=38   <- the spelling that works
 * ```
 *
 * `last_30_days` is a REAL declared name — in the dashboard date-filter
 * positions, where the console lowers it to `{date-macro}` bounds before any
 * query is sent. Authored as a bare comparand it was bound as written: the
 * vocabulary was declared in one layer and unrecognised in the next, with no
 * error at the boundary. The engine now refuses it on declared temporal fields
 * at QUERY time (`INVALID_FILTER` / 400, PR #8808 — the B half); this check is
 * the AUTHORING-time half, landing where an AI-generated dashboard is actually
 * produced, so the error reaches the author instead of the first viewer.
 *
 * ## Why ORDERING positions only — the boundary, stated plainly
 *
 * This schema is field-AGNOSTIC (see {@link ComparisonOperatorSchema}'s #5685
 * note): it cannot ask whether the column is temporal, so the judgement rides
 * on the POSITION instead, and only the positions with no innocent reading are
 * judged:
 *
 * - **`$gt` / `$gte` / `$lt` / `$lte` comparands and both `$between`
 *   endpoints ARE judged.** An ORDERED comparison against a declared preset
 *   name has no legitimate reading: on a temporal column the engine door
 *   refuses it, and on a text column it orders the literal string against the
 *   platform's own vocabulary word under backend collation — a comparison the
 *   #5685 ruling explicitly declines to promise, against a value the platform
 *   itself declared to mean a time window.
 * - **Equality (`{ period: 'this_quarter' }`, `$eq`, `$ne`) and membership
 *   (`$in` / `$nin`) are deliberately NOT judged.** A select/picklist column
 *   legitimately stores values that collide with preset names —
 *   `GlobalFilterSchema`'s own pins protect `type: 'select', defaultValue:
 *   'this_quarter'` for exactly this reason — and equality against such a
 *   stored value is a working filter today. On a declared temporal field the
 *   engine door still refuses these at query time, with the field's type in
 *   hand; refusing them here, blind, would trade a silent zero for false
 *   rejections. (`@objectstack/lint`'s `filter-preset-comparand` rule draws
 *   the same boundary at the same positions.)
 * - **Only the 13 DECLARED names are judged** ({@link DATE_RANGE_PRESETS}) —
 *   never a guessed superset (`last_60_days` stays a plain string here; on a
 *   temporal field the engine's own door catches it, field type in hand).
 *   `{placeholder}` spellings are another vocabulary with its own loud refusal
 *   and never collide (a preset name carries no braces). The empty-string cell
 *   stays its own card by the same ruling.
 */
const PRESET_JUDGED_ORDERING_OPS: ReadonlySet<string> = new Set(['$gt', '$gte', '$lt', '$lte']);

/** Bounded-depth guard — mirrors the engine door's own limit. */
const PRESET_WALK_MAX_DEPTH = 32;

/** Plain filter STRUCTURE, as the engine door classifies it (a `Date` is a comparand). */
function isPlainFilterNode(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}

/**
 * [#8793] Walk one condition node and report every bare preset name sitting in
 * an ordering-comparand position.
 *
 * Descends non-`$` keys only (operator specs and nested relations): the
 * `$and` / `$or` / `$not` members are re-parsed by {@link FilterConditionSchema}
 * itself, so its own refinement judges them with correctly nested issue paths —
 * descending here as well would double-report. Unrecognised `$` keys are
 * skipped WITHOUT descending, the engine door's own conservatism: a hole, not
 * a false refusal, is the right failure direction.
 */
function checkBarePresetOrderingComparands(
  node: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
  depth = 0,
): void {
  if (depth > PRESET_WALK_MAX_DEPTH) return;
  if (!isPlainFilterNode(node)) return;

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue; // $and/$or/$not re-parse; other $ keys stay unjudged
    if (!isPlainFilterNode(value)) continue; // implicit equality / arrays — not judged
    const hasOperatorKeys = Object.keys(value).some((k) => k.startsWith('$'));
    if (!hasOperatorKeys) {
      // Nested relation / deep equality — the schema does not re-parse these,
      // so the walk descends itself.
      checkBarePresetOrderingComparands(value, ctx, [...path, key], depth + 1);
      continue;
    }
    for (const [op, comparand] of Object.entries(value)) {
      if (PRESET_JUDGED_ORDERING_OPS.has(op) && isDateRangePresetName(comparand)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, key, op],
          message: bareDateRangePresetComparandMessage(comparand, op),
        });
        continue;
      }
      if (op === '$between' && Array.isArray(comparand)) {
        comparand.forEach((endpoint, index) => {
          if (!isDateRangePresetName(endpoint)) return;
          ctx.addIssue({
            code: 'custom',
            path: [...path, key, op, index],
            message: bareDateRangePresetComparandMessage(endpoint, '$between'),
          });
        });
      }
    }
  }
}

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
  // [#8793] Bare date-range preset names are refused from ordering comparands
  // at the authoring door — see the § 3.35 block above for the ruling, the
  // measured defect, and the ordering-only boundary. The refinement judges
  // this node's own field entries; `$and` / `$or` / `$not` members re-enter
  // the schema and are judged by their own pass with nested issue paths.
  ).superRefine((node, ctx) => checkBarePresetOrderingComparands(node, ctx))
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
 * [#7711] The only keys a normalized LOGICAL GROUP may carry.
 *
 * Written out as a value rather than derived from the schema because the
 * field-condition branch needs it too — it is what tells a field NAME from a
 * combinator, and a normalized field condition never spells either.
 */
const NORMALIZED_LOGICAL_KEYS = ['$and', '$or', '$not'] as const;

/**
 * [#7711] The author-facing refusal for a `$and` / `$or` member, or a `$not`
 * operand, that is neither a field condition nor a logical group.
 *
 * It names the offending keys because that is the only part a reader cannot
 * reconstruct: the two valid member shapes are fixed, the input's own keys are
 * what decided which branch it was judged by and why that branch said no.
 */
function normalizedMemberMessage(position: string, input: unknown): string {
  const isPlainObject = !!input && typeof input === 'object' && !Array.isArray(input);
  const found = !isPlainObject
    ? `got ${Array.isArray(input) ? 'an array' : input === null ? 'null' : typeof input}`
    : `got an object with key(s) ${Object.keys(input as Record<string, unknown>)
        .map((key) => JSON.stringify(key)).join(', ')}`;
  return (
    `Not a valid ${position} — ${found}. A ${position} is either a FIELD CONDITION `
    + '({ "field": { "$op": value } }, whose keys are field names and whose operator map '
    + 'must satisfy FieldOperatorsSchema — comparand shapes included), or a nested LOGICAL '
    + `GROUP carrying only ${NORMALIZED_LOGICAL_KEYS.join(' / ')} and nothing else. `
    + 'Ruled on #7711: declared = enforced (ADR-0049).'
  );
}

/**
 * [#7711] A field condition, with `$`-prefixed keys ruled out.
 *
 * The refusal is what DISCRIMINATES the member union. Without it a member is
 * judged by whichever branch happens to answer first, and `{ $not: … }` answers
 * on this one: `$not` reads as a field NAME, its operand reads as an operator
 * map, and `FieldOperatorsSchema` — not `.strict()`, by the design its own
 * docblock argues — strips every key of it and returns `{}`. So a whole negated
 * subtree used to parse green *as a field condition* and come back erased.
 * A normalized field condition's keys are field names (`amount`,
 * `account.name`); none of them starts with `$`.
 */
const normalizedFieldConditionSchema = () =>
  z.record(z.string(), FieldOperatorsSchema).refine(
    (condition) => !Object.keys(condition).some((key) => key.startsWith('$')),
    {
      message: 'A field condition\'s keys are field names, never $-prefixed operators (#7711).',
      // `abort` so this branch cannot become the union's spokesman. Measured on
      // zod 4.4.3: a union whose other options all abort returns a lone
      // CONTINUABLE failure verbatim, which made `{ $not: { c: <bad> } }` — a
      // legitimate group shape with a bad operand — report "keys are field
      // names", blaming `$not` for being spelled at all. Aborting keeps the
      // union's own `error` in charge of every rejection.
      abort: true,
    },
  );

/**
 * [#7711] One `$and` / `$or` member, or the `$not` operand.
 *
 * `position` only shapes the refusal text; the two accepted shapes are the same
 * in all three slots, which is why they are built here once rather than spelled
 * out per key as they were before.
 */
const normalizedMemberSchema = (position: string) =>
  z.union([normalizedFieldConditionSchema(), NormalizedFilterSchema], {
    error: (issue) => normalizedMemberMessage(position, issue.input),
  });

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
 *
 * ## The group branch is `.strict()`, and the field branch refuses `$`-keys (#7711)
 *
 * Each member used to be `z.union([z.record(z.string(), FieldOperatorsSchema),
 * NormalizedFilterSchema])` against a NON-strict group whose every key is
 * optional — and "all three of my optional keys are absent" is true of any
 * object whatsoever. So the second branch was a catch-all: whenever the record
 * branch REJECTED a field condition, the group branch accepted the very same
 * value, and this face answered `true` for comparands no backend resolves.
 * Measured on `main` @ `8669e5d`, all green before: `{ $and: [{ c: { $null:
 * 'not-a-boolean' } } ] }`, `{ $and: [{ c: { $between: [1, 2, 3] } }] }`,
 * `{ $and: [{ hello: 'world' }] }` — while `FieldOperatorsSchema`, which this
 * schema is documented as validating against, refuses each one.
 *
 * The green was also LOSSY, which is the part that decided the fix over the
 * alternative of deleting the "ENFORCED" claim from the two comments above:
 * a value admitted by the catch-all came back parsed to `{}`, so the accepted
 * output no longer contained the condition it was asked about. That is what
 * makes the mixed shape the strictness might have cost — a group key and a
 * field key at one level, `{ $or: [], c: { $eq: 1 } }` — a non-loss: it parsed
 * to `{ $or: [] }`, the field condition dropped on the floor, so no mixed
 * member ever survived a round-trip to begin with. Nothing legitimate spells it,
 * and the normalizer's own output is `$and`/`$or`/`$not` groups over
 * single-purpose field conditions.
 *
 * What stays accepted, deliberately: `{}` at any position, and the empty
 * combinators — `{}`, `{ $and: [] }`, `{ $or: [] }`, `{ $or: [{}] }`,
 * `{ $not: {} }` are boolean identities under the #5322 ruling documented on
 * {@link FilterConditionSchema}, not malformed members, and each still parses.
 * `{}` reaches the field-condition branch as an empty record, so the group
 * branch is free to be strict without touching them.
 *
 * Scope, stated because the neighbouring face reads similar: this narrows the
 * NORMALIZED AST only. {@link FilterConditionSchema} — the AUTHORING face every
 * driver, `read-scope-sql` and `cel-to-filter` actually consume — is untouched
 * and still admits sugar (implicit equality, relation nesting) by design, so no
 * request path's row set can move with this. At the time of the change nothing
 * in the repo called `.parse` / `.safeParse` on this schema outside this
 * package's own tests (swept with `FilterConditionSchema`'s 20+ call sites as
 * the positive control), so the narrowing has no measured internal caller.
 */
export const NormalizedFilterSchema: z.ZodType<NormalizedFilter, NormalizedFilter> = z.lazy(() =>
  z.object({
    $and: z.array(normalizedMemberSchema('$and member')).optional(),

    $or: z.array(normalizedMemberSchema('$or member')).optional(),

    $not: normalizedMemberSchema('$not operand').optional(),
  }).strict()
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
  // [#7536] `like`/`ilike` lower to their OWN operators, not `$contains`.
  // The former `'like': '$contains'` entry silently rewrote what the query
  // means: `$contains` LIKE-escapes the comparand and wraps it in `%…%`, so a
  // caller's own wildcards bound as literals (`%Industries` matched nothing)
  // and a wildcard-free comparand became a substring match nobody asked for.
  // `canonicalAstOperator` below always exempted these two spellings for
  // exactly that reason; the lowering the wire path takes now agrees with it.
  // (`ilike` had NO entry at all, so `isFilterAST` refused it — it enters the
  // vocabulary here with its lowering, per the #3948 single-table rule.)
  'like': '$like',
  'ilike': '$ilike',
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
  '$like': 'like', '$ilike': 'ilike',
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
  // `like`/`ilike` used to need a hand-written exemption here: they SHARED the
  // `$contains` lowering while not being substring matches, so the generic
  // round-trip below would have folded them onto `contains` and silently
  // wrapped the value in `%…%`. #7536 gave them their own lowerings
  // (`$like`/`$ilike`), so the generic path now answers `like`/`ilike` by
  // construction — the exemption is retired, not the rule it protected.
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
 * [#7597] Is this comparand a Filter Protocol FIELD REFERENCE — the
 * {@link FieldReferenceSchema} shape `{ $field: 'other_column' }`?
 *
 * The `$field` value must be a STRING, which is what the schema declares. The
 * predicate deliberately matches `driver-sql`'s `fieldReferenceOf`: a comparand
 * whose `$field` is not a string is not a field reference on any path, so it
 * keeps the literal lowering below and is refused downstream as the
 * uncompilable object it is — rather than being promoted here into a `$eq` the
 * drivers would then have to un-recognise.
 */
function isFieldReferenceComparand(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof (value as Record<string, unknown>).$field === 'string';
}

/**
 * Convert a single AST comparison node `[field, operator, value]` to a FilterCondition object.
 */
function convertComparison(node: [string, string, unknown]): FilterCondition {
  const [field, operator, value] = node;
  const op = operator.toLowerCase();

  // Special case: equality shorthand. `equals`/`eq` are the view vocabulary's
  // spellings of the same thing and must produce the same output, or one filter
  // would compile two different ways depending on how the author spelled it.
  //
  // [#7597] …with ONE comparand excepted: a `{ $field }` reference. The
  // implicit-equality form `{ field: comparand }` says "equals" only because a
  // LITERAL sitting in a field's value position means equality. A field
  // reference sitting there produces `{ amount: { $field: 'budget' } }` — an
  // object whose only key starts with `$`, which every consumer reads as an
  // OPERATOR SPEC named `$field`, not as a comparand. Nothing implements that
  // operator: the in-memory evaluator (`matches-filter.ts` `evalField` →
  // `evalOp`) has no arm for it and answers its fail-closed `false`, so the
  // filter silently matched NO record, while `['amount', '>', ref]` — which
  // keeps its operator — worked on both paths. Two spellings of one intent,
  // two fates, and the losing one is silent.
  //
  // So the reference comparand is lowered to the EXPLICIT `$eq` spelling, which
  // is the spelling both evaluation paths already implement (the memory
  // evaluator resolves the reference in `resolveValue`; `driver-sql` compiles it
  // to a column-to-column comparison, #5222). This is a change to what the ARRAY
  // SUGAR produces and nothing else — a hand-authored bare
  // `{ field: { $field: … } }` FilterCondition keeps exactly today's fate
  // (memory fail-closed `false`; SQL's refusal naming `$eq`), because the
  // evaluator's unknown-operator posture is #6520's decision and stands.
  //
  // All four `$eq` spellings of {@link AST_OPERATOR_MAP} are covered — the
  // condition below is that key set, and `filter.test.ts` pins the two lists
  // together so a fifth spelling cannot enter the map and miss this branch.
  if (op === '=' || op === '==' || op === 'equals' || op === 'eq') {
    return isFieldReferenceComparand(value)
      ? ({ [field]: { $eq: value } } as FilterCondition)
      : ({ [field]: value } as FilterCondition);
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
 * ## This is the comparand-type door (#7872)
 *
 * Whatever this function returns — the lowered AST form or the object
 * passthrough — has passed {@link normalizeFilterComparandTypes} first: every
 * LITERAL comparand is one of the accepted six types
 * (`string | number | bigint | boolean | null | Date`), an exact-range
 * `bigint` has been narrowed to its number (copy-on-write, so the object
 * passthrough returns the same reference unless a bigint was narrowed), and
 * everything else has been refused with the `INVALID_FILTER` / 400 envelope.
 * The object form used to pass through this function UNEXAMINED, which is how
 * five drivers came to answer an unsupported comparand type five ways
 * (#7956's divergence matrix); the door module's header carries the ruling.
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
  const lowered = lowerFilterAST(filter);
  return lowered === undefined ? undefined : normalizeFilterComparandTypes(lowered);
}

/**
 * The lowering half of {@link parseFilterAST} — exactly its historical body,
 * recursion included, split out so the comparand-type door (#7872) runs ONCE
 * over the finished condition rather than once per recursion level.
 */
function lowerFilterAST(filter: unknown): FilterCondition | undefined {
  if (filter == null) return undefined;
  if (!Array.isArray(filter)) return filter as FilterCondition;
  if (filter.length === 0) return undefined;

  const first = filter[0];

  // Logical node: ["and", cond1, cond2, ...] or ["or", cond1, cond2, ...]
  if (typeof first === 'string' && (first.toLowerCase() === 'and' || first.toLowerCase() === 'or')) {
    const logicOp = `$${first.toLowerCase()}` as '$and' | '$or';
    const children = filter.slice(1).map((child: unknown) => lowerFilterAST(child)).filter(Boolean) as FilterCondition[];
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
    const children = filter.map((child: unknown) => lowerFilterAST(child)).filter(Boolean) as FilterCondition[];
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
 * ## `$icontains` JOINED this array in #6520 — the staging is over
 *
 * It was declared by {@link StringOperatorSchema} and deliberately absent here
 * from #5701 until #6520, and that gap was the mechanism described above rather
 * than an oversight: adding the name while `driver-memory`'s matcher had no arm
 * flipped a loud refusal into the silent widening measured above.
 *
 * The gap closed the only way it could — **in ONE PR with the arms**, which is
 * the constraint the #6520 ruling made binding (maintainer, 2026-08-08: the word
 * list must not land ahead of the evaluators). #6520 gave every JS evaluation
 * face an ASCII fold ({@link foldAsciiCase}) in the same commit that added the
 * name here: `driver-memory` (query path, reference matcher and analytics face),
 * `driver-mongodb`, objectql's `having`, `@objectstack/formula`, and
 * `service-analytics`' three SQL compilers. So the claim this array makes —
 * *backends implement this operator* — is true of `$icontains` for the first
 * time.
 *
 * What that means for the NEXT operator is unchanged, and is the reason the
 * measurement above is kept: stage it in {@link FieldOperatorsSchema} alone,
 * record it in `filter-operator-vocabulary.test.ts`, and add it here only when
 * every face can answer it. That pin now asserts an EMPTY difference between the
 * declaration and enforcement surfaces, so a name added to one and not the other
 * fails in either direction.
 *
 * ## `$like` / `$ilike` are STAGED here, on purpose (#7536)
 *
 * They are declared by {@link StringOperatorSchema} and
 * {@link FieldOperatorsSchema} and deliberately ABSENT from this array, which
 * is the staging direction the `$icontains` paragraph above prescribes — and
 * for exactly the mechanism it measured. Membership here is what makes
 * `driver-memory`'s `SUPPORTED_FIELD_OPERATORS` ACCEPT a name; adding `$like`
 * before that driver's matcher has an arm would turn its loud refusal into a
 * dropped predicate, i.e. every row.
 *
 * What is implemented today, and what refuses:
 *
 * | face | `$like` / `$ilike` |
 * |---|---|
 * | `driver-sql` (and `driver-sqlite-wasm`, which inherits its compiler) | ANSWERS — `LIKE` / `GLOB` per dialect, caller-bound wildcards |
 * | `driver-turso` — local (inherits `SqlDriver`) and remote (its own compiler) | ANSWERS on both transports |
 * | `driver-memory` — query path and reference matcher | ANSWERS — it widens its own `SUPPORTED_FIELD_OPERATORS` by hand, the way `driver-turso`'s remote transport has carried `$icontains` since #5702. It is the in-memory DOUBLE: an app whose tests run there and whose production runs SQL must not get a 400 for a filter that works |
 * | `@objectstack/formula` `matchesFilterCondition` | ANSWERS — {@link matchesLikePattern}, so a write-side `check` agrees with the read-side SQL |
 * | `driver-mongodb`, `objectql` `having`, `service-analytics` | REFUSE, loudly, in the ADR-0112 `INVALID_FILTER` envelope — they derive acceptance from THIS array, which does not name the operator |
 *
 * That split is the point rather than a gap: #7536 exists because a `like`
 * predicate was being SILENTLY given `$contains`' meaning, and a face that
 * quietly answers a different question is strictly worse than one that
 * refuses. Clearing the staging means arms on the remaining faces in ONE PR,
 * the #6520 direction — tracked as the follow-up filed on #7536.
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
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
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
 * Those sites are the five that refuse unknown operators —
 * `driver-sql`'s `default:` arm, `driver-turso`'s remote transport,
 * `driver-memory`'s `filter-refusal.ts`, `driver-mongodb`'s
 * `translateFieldOperators`, and `objectql`'s `having` — and the point of one
 * table is that they stop each writing their own sentence. When this block was
 * written, wiring them was deliberately deferred behind a hard order ("#5710
 * flips the producer, then #5702 turns these strings into refusals"), because
 * `$regex` still had one live producer on the authentication path. Both gates
 * have fired since — #5710 flipped `plugin-auth`'s adapter to `$contains`,
 * #5702 wired all five sites — so that ordering is shipped history, not
 * pending advice. Census per face, by executing `{ $regex }` and a dangling
 * `{ $options }` against each (re-verified 2026-08, #6993): all five print
 * this table's `why` verbatim; the four driver faces throw it in the ADR-0112
 * envelope (`INVALID_FILTER` / 400 — `driver-sqlite-wasm` and both turso
 * transports inherit or mirror it), while `having`'s refusal is still a bare
 * `Error` carrying the sentence without `code`/`status` — the one open half,
 * tracked as #7047.
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
