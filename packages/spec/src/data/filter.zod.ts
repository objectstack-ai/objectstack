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
  
  /** Logical NOT - negates the condition */
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
 */
const AST_OPERATOR_MAP: Record<string, string> = {
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
};

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
  const dollar = AST_OPERATOR_MAP[lower];
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

  const mapped = AST_OPERATOR_MAP[op];
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
