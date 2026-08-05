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

export type FieldReference = z.infer<typeof FieldReferenceSchema>;

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
 * Comparison operators for numeric and date comparisons.
 * Supported data types: Number, Date
 */
export const ComparisonOperatorSchema = lazySchema(() => z.object({
  /** Greater than - SQL: > | MongoDB: $gt */
  $gt: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
  
  /** Greater than or equal to - SQL: >= | MongoDB: $gte */
  $gte: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
  
  /** Less than - SQL: < | MongoDB: $lt */
  $lt: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
  
  /** Less than or equal to - SQL: <= | MongoDB: $lte */
  $lte: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
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
 * Range operator for interval checks (closed interval).
 * SQL: BETWEEN ? AND ? | MongoDB: $gte AND $lte
 */
export const RangeOperatorSchema = lazySchema(() => z.object({
  /** Between (inclusive) - takes [min, max] array */
  $between: z.tuple([
    z.union([z.number(), z.date(), FieldReferenceSchema]),
    z.union([z.number(), z.date(), FieldReferenceSchema])
  ]).optional(),
}));

// ============================================================================
// 3.3 String-Specific Operators
// ============================================================================

/**
 * String pattern matching operators.
 * Note: Case sensitivity should be handled at backend level.
 */
export const StringOperatorSchema = lazySchema(() => z.object({
  /** Contains substring - SQL: LIKE %?% | MongoDB: $regex */
  $contains: z.string().optional(),
  
  /** Does not contain substring - SQL: NOT LIKE %?% | MongoDB: $not: $regex */
  $notContains: z.string().optional(),
  
  /** Starts with prefix - SQL: LIKE ?% | MongoDB: $regex */
  $startsWith: z.string().optional(),
  
  /** Ends with suffix - SQL: LIKE %? | MongoDB: $regex */
  $endsWith: z.string().optional(),
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
  
  // Comparison (numeric/date)
  $gt: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
  $gte: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
  $lt: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
  $lte: z.union([z.number(), z.date(), FieldReferenceSchema]).optional(),
  
  // Set & Range
  $in: z.array(z.any()).optional(),
  $nin: z.array(z.any()).optional(),
  $between: z.tuple([
    z.union([z.number(), z.date(), FieldReferenceSchema]),
    z.union([z.number(), z.date(), FieldReferenceSchema])
  ]).optional(),
  
  // String-specific
  $contains: z.string().optional(),
  $notContains: z.string().optional(),
  $startsWith: z.string().optional(),
  $endsWith: z.string().optional(),
  
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
 * ## Deliberately NOT declared here
 *
 * The boolean identities of the EMPTY combinators (`{ $and: [] }` = TRUE,
 * `{ $or: [] }` = FALSE, `{ $not: {} }` = FALSE) are RULED — #5322
 * (maintainer, 2026-08-04) took the identity over the analytics compilers'
 * fail-closed throw — but not yet stated here as contract: on main today
 * `read-scope-sql` and `filter-normalizer` still refuse an empty `$and`/`$or`,
 * and the ruling's implementation PR #5365 (aligns both compilers, enrolls the
 * four cases in `FILTER_LOGIC_CASES`) is sequenced to land after this one. The
 * declaration flips to stated contract with that PR, not here — declaring it
 * first would out-run enforcement. Likewise `{ field: {} }` (a field
 * constrained by zero operators): #5240 ruled it REJECTED and #5327 gated
 * driver-sql / driver-sqlite-wasm / driver-memory / formula; `driver-mongodb`
 * still answers it (tracked by #5376), and the schema-side narrowing stays
 * with the spec lane. Declaring either before it is enforced everywhere would
 * be exactly the `declared ≠ enforced` shape this file exists to prevent.
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
        $gt?: T[K] extends number | Date ? T[K] : never;
        $gte?: T[K] extends number | Date ? T[K] : never;
        $lt?: T[K] extends number | Date ? T[K] : never;
        $lte?: T[K] extends number | Date ? T[K] : never;
        $in?: T[K][];
        $nin?: T[K][];
        $between?: T[K] extends number | Date ? [T[K], T[K]] : never;
        $contains?: T[K] extends string ? string : never;
        $notContains?: T[K] extends string ? string : never;
        $startsWith?: T[K] extends string ? string : never;
        $endsWith?: T[K] extends string ? string : never;
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
export type FieldOperators = z.infer<typeof FieldOperatorsSchema>;
export type QueryFilter = z.infer<typeof QueryFilterSchema>;

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
 * All supported operator keys.
 * Useful for validation and parsing.
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
