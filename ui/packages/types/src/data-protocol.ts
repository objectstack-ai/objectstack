/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Data Protocol Advanced Types
 * 
 * Phase 3: DriverQueryConfig and the SQL query AST, FilterSchema, and the
 * object-level validation rules.
 * 
 * @module data-protocol
 * @packageDocumentation
 */

// Import existing base types to avoid duplication
import type { SortConfig as BaseSortConfig } from './objectql.js';
// The protocol's canonical view-filter operators, by the spec's own name: this
// package no longer publishes a second name for them (objectui#6349, batch 12).
import type { ViewFilterOperator as BaseFilterOperator } from '@objectstack/spec/ui';

// Spec-owned vocabulary, bound rather than re-declared (objectstack#4115). The
// spec exports these as zod schemas, not as types, so they are derived through
// `z.infer` / `z.input` — `export type { … } from` would not compile against a
// value. See the validation-rules section below for why the rule schemas are
// derived on the `z.input` (authored/wire) side rather than `z.infer`.
import type { z } from 'zod';
import type {
  ScriptValidationSchema as SpecScriptValidationSchema,
  StateMachineValidationSchema as SpecStateMachineValidationSchema,
  CrossFieldValidationSchema as SpecCrossFieldValidationSchema,
  ConditionalValidationSchema as SpecConditionalValidationSchema,
  FormatValidationSchema as SpecFormatValidationSchema,
} from '@objectstack/spec/data';

/**
 * =============================================================================
 * Phase 3.3: DriverQueryConfig AST Implementation
 * =============================================================================
 */

/**
 * Query AST Node Types
 */
export type QueryASTNodeType =
  | 'select'
  | 'from'
  | 'where'
  | 'join'
  | 'group_by'
  | 'order_by'
  | 'limit'
  | 'offset'
  | 'subquery'
  | 'aggregate'
  | 'window'
  | 'field'
  | 'literal'
  | 'operator'
  | 'function';

/**
 * Base Query AST Node
 */
export interface QueryASTNode {
  type: QueryASTNodeType;
  [key: string]: any;
}

/**
 * SELECT clause node
 */
export interface SelectNode extends QueryASTNode {
  type: 'select';
  fields: (FieldNode | AggregateNode | WindowNode)[];
  distinct?: boolean;
}

/**
 * FROM clause node
 */
export interface FromNode extends QueryASTNode {
  type: 'from';
  table: string;
  alias?: string;
}

/**
 * WHERE clause node
 */
export interface WhereNode extends QueryASTNode {
  type: 'where';
  condition: OperatorNode;
}

/**
 * Join execution strategy hint — objectui query-AST vocabulary.
 *
 * Was bound to the spec's `JoinStrategy` zod enum until spec 17.0.0, which
 * retired `query.joins` and the whole JoinNode cluster with it (framework#4286:
 * no engine or driver ever read a join on the query path, so every join a
 * caller declared was silently dropped — `expand` is the live spelling of
 * related-record retrieval). The members below are that enum's, verbatim: this
 * repo's query AST is unchanged, it simply no longer derives from a retired
 * export.
 */
export type JoinStrategy = 'auto' | 'database' | 'hash' | 'loop';

/**
 * JOIN clause node (Phase 3.3.4)
 */
export interface JoinNode extends QueryASTNode {
  type: 'join';
  join_type: 'inner' | 'left' | 'right' | 'full' | 'cross';
  table: string;
  alias?: string;
  on: OperatorNode;
  strategy?: JoinStrategy; // Execution strategy hint for cross-datasource joins
}

/**
 * GROUP BY clause node
 */
export interface GroupByClauseNode extends QueryASTNode {
  type: 'group_by';
  fields: FieldNode[];
  having?: OperatorNode;
}

/**
 * ORDER BY clause node
 */
export interface OrderByNode extends QueryASTNode {
  type: 'order_by';
  fields: Array<{
    field: FieldNode;
    direction: 'asc' | 'desc';
  }>;
}

/**
 * LIMIT clause node
 */
export interface LimitNode extends QueryASTNode {
  type: 'limit';
  value: number;
}

/**
 * OFFSET clause node
 */
export interface OffsetNode extends QueryASTNode {
  type: 'offset';
  value: number;
}

// `SubqueryNode` (Phase 3.3.3) is retired (objectstack#25921, batch 12): no
// query builder, adapter or host constructed or read a subquery node.

/**
 * Aggregate function node (Phase 3.3.5)
 */
export interface AggregateNode extends QueryASTNode {
  type: 'aggregate';
  function: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last' | 'count_distinct' | 'array_agg' | 'string_agg';
  field?: FieldNode;
  alias?: string;
  distinct?: boolean;
  separator?: string; // For string_agg function
}

/**
 * Window function type — objectui query-AST vocabulary.
 *
 * Was bound to the spec's `WindowFunction` zod enum until spec 17.0.0, which
 * retired `query.windowFunctions` and its cluster (framework#4286: OVER clauses
 * only ever ran behind a driver-level door whose flat input shape the spec
 * vocabulary never matched, so every window function declared on the query path
 * was dropped). The members below are that enum's, verbatim.
 */
export type WindowFunction =
  | 'row_number' | 'rank' | 'dense_rank' | 'percent_rank'
  | 'lag' | 'lead' | 'first_value' | 'last_value'
  | 'sum' | 'avg' | 'count' | 'min' | 'max';

/**
 * Window frame unit — objectui query-AST vocabulary (no spec counterpart).
 */
export type WindowFrameUnit = 'rows' | 'range';

/**
 * Window frame boundary — objectui query-AST vocabulary (no spec counterpart).
 */
export type WindowFrameBoundary = 
  | 'unbounded_preceding'
  | 'unbounded_following'
  | 'current_row'
  | { type: 'preceding'; offset: number }
  | { type: 'following'; offset: number };

/**
 * Window frame specification — objectui query-AST vocabulary (no spec counterpart).
 */
export interface WindowFrame {
  unit: WindowFrameUnit;
  start: WindowFrameBoundary;
  end?: WindowFrameBoundary; // Defaults to CURRENT ROW if not specified
}

/**
 * Window function node — objectui query-AST vocabulary. Only `function` is
 * spec-owned (see `WindowFunction` above); the frame/partition shape is local.
 */
export interface WindowNode extends QueryASTNode {
  type: 'window';
  function: WindowFunction;
  field?: FieldNode; // For aggregate window functions
  alias: string;
  partitionBy?: FieldNode[];
  orderBy?: Array<{
    field: FieldNode;
    direction: 'asc' | 'desc';
  }>;
  frame?: WindowFrame;
  
  // For LAG/LEAD functions
  offset?: number;
  defaultValue?: LiteralNode;
}

/**
 * Field reference node
 */
export interface FieldNode extends QueryASTNode {
  type: 'field';
  table?: string;
  name: string;
  alias?: string;
}

/**
 * Literal value node
 */
export interface LiteralNode extends QueryASTNode {
  type: 'literal';
  value: any;
  data_type?: 'string' | 'number' | 'boolean' | 'date' | 'null';
}

/**
 * Operator node
 */
export interface OperatorNode extends QueryASTNode {
  type: 'operator';
  operator: ComparisonOperator | LogicalOperator;
  operands: (FieldNode | LiteralNode | OperatorNode | FunctionNode)[];
}

/**
 * Function call node
 */
export interface FunctionNode extends QueryASTNode {
  type: 'function';
  name: string;
  arguments: (FieldNode | LiteralNode | FunctionNode)[];
  alias?: string;
}

/**
 * Comparison operators
 */
export type ComparisonOperator =
  | '='
  | '!='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'like'
  | 'ilike'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null'
  | 'between'
  | 'contains'
  | 'starts_with'
  | 'ends_with';

/**
 * Logical operators
 */
export type LogicalOperator = 'and' | 'or' | 'not';

/**
 * Complete SQL query AST (Phase 3.3.1).
 *
 * Renamed off `QueryAST` (objectstack#4115): `@objectstack/spec/data` owns that
 * name for the **ObjectQL query descriptor** (`{ object, fields, where, orderBy,
 * expand, … }`) — a declarative request against an object. This is the compiled
 * **SQL syntax tree** (`select`/`from`/`join`/`where`/`group_by`/…) that
 * `@object-ui/core`'s `QueryASTBuilder` produces from {@link DriverQueryConfig};
 * the two are not mutually assignable in either direction. Import the spec's
 * `QueryAST` when you mean the request, this one when you mean the tree.
 */
export interface SqlQueryAST {
  select: SelectNode;
  from: FromNode;
  joins?: JoinNode[];
  where?: WhereNode;
  group_by?: GroupByClauseNode;
  order_by?: OrderByNode;
  limit?: LimitNode;
  offset?: OffsetNode;
}

/**
 * High-level query configuration — the input `QueryASTBuilder` compiles into a
 * {@link SqlQueryAST}, and the shape drivers receive on `find()`.
 *
 * Renamed off `QuerySchema` (objectstack#4115): `@objectstack/spec/data` exports
 * `QuerySchema` as the **zod schema value** for its ObjectQL `QueryAST`, so the
 * name promised a spec artifact while delivering an objectui-local TS interface
 * with a different key set (`filter`/`sort`/`joins`/`aggregations` vs the spec's
 * `where`/`orderBy`/`expand`).
 */
export interface DriverQueryConfig {
  /**
   * Target object/table
   */
  object: string;
  
  /**
   * Fields to select
   */
  fields?: string[];
  
  /**
   * Filter conditions
   */
  filter?: AdvancedFilterSchema;
  
  /**
   * Sort configuration
   */
  sort?: QuerySortConfig[];
  
  /**
   * Pagination
   */
  limit?: number;
  offset?: number;
  
  /**
   * Joins (Phase 3.3.4)
   */
  joins?: JoinConfig[];
  
  /**
   * Aggregations (Phase 3.3.5)
   */
  aggregations?: AggregationConfig[];
  
  /**
   * Group by fields
   */
  group_by?: string[];
  
  /**
   * Window functions
   */
  windows?: WindowConfig[];
  
  /**
   * Related objects to expand
   */
  expand?: string[];
  
  /**
   * Full-text search
   */
  search?: string;
}

/**
 * Sort configuration (extends base SortConfig)
 */
export interface QuerySortConfig extends BaseSortConfig {
  nulls?: 'first' | 'last';
}

/**
 * Join configuration
 */
export interface JoinConfig {
  type: 'inner' | 'left' | 'right' | 'full';
  object: string;
  on: {
    local_field: string;
    foreign_field: string;
  };
  alias?: string;
}

/**
 * Aggregation configuration
 */
export interface AggregationConfig {
  function: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct' | 'array_agg' | 'string_agg';
  field?: string;
  alias?: string;
  distinct?: boolean;
  separator?: string; // For string_agg function
}

/**
 * Window function configuration — objectui query-AST vocabulary (no spec counterpart).
 */
export interface WindowConfig {
  /** Window function name */
  function: WindowFunction;
  
  /** Field to operate on (not required for row_number, rank, etc.) */
  field?: string;
  
  /** Result alias */
  alias: string;
  
  /** PARTITION BY fields */
  partitionBy?: string[];
  
  /** ORDER BY clause */
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  
  /** Window frame specification */
  frame?: WindowFrame;
  
  /** Offset for lag/lead functions */
  offset?: number;
  
  /** Default value for lag/lead when no previous/next row */
  defaultValue?: any;
}

/**
 * =============================================================================
 * Phase 3.4: FilterSchema - Advanced Filtering
 * =============================================================================
 */

/**
 * Filter Schema - Complex filtering support (extends base)
 */
export interface AdvancedFilterSchema {
  /**
   * Logical operator for combining conditions
   */
  operator?: 'and' | 'or' | 'not';
  
  /**
   * Filter conditions
   */
  conditions?: AdvancedFilterCondition[];
  
  /**
   * Nested filter groups
   */
  groups?: AdvancedFilterSchema[];
}

/**
 * Individual filter condition (extends base)
 */
export interface AdvancedFilterCondition {
  /**
   * Field to filter on
   */
  field: string;
  
  /**
   * Comparison operator (extended)
   */
  operator: AdvancedFilterOperator;
  
  /**
   * Value to compare against
   */
  value?: any;
  
  /**
   * For BETWEEN and IN operators
   */
  values?: any[];
  
  /**
   * Case sensitivity for string comparisons
   */
  case_sensitive?: boolean;
}

/**
 * Filter operators (Phase 3.4.1-3.4.4) - Extended from base
 */
export type AdvancedFilterOperator =
  | BaseFilterOperator
  // Additional operators
  | 'like'
  | 'ilike'
  | 'is_null'
  | 'is_not_null'
  | 'between'
  | 'not_between'
  // Date-specific (Phase 3.4.2)
  | 'date_equals'
  | 'date_after'
  | 'date_before'
  | 'date_in_range'
  | 'date_today'
  | 'date_yesterday'
  | 'date_tomorrow'
  | 'date_this_week'
  | 'date_last_week'
  | 'date_next_week'
  | 'date_this_month'
  | 'date_last_month'
  | 'date_next_month'
  | 'date_this_year'
  | 'date_last_year'
  | 'date_next_year'
  // Lookup field filters (Phase 3.4.3)
  | 'lookup_equals'
  | 'lookup_contains'
  | 'lookup_starts_with'
  // Full-text search (Phase 3.4.4)
  | 'search'
  | 'search_phrase'
  | 'search_proximity';

/**
 * Date range filter (Phase 3.4.2)
 */
export interface DateRangeFilter {
  start?: Date | string;
  end?: Date | string;
  preset?: FilterBuilderDateRangePreset;
}

/**
 * Date range presets accepted by the FILTER BUILDER vocabulary in this file.
 *
 * Renamed from `DateRangePreset` in objectui#4167, because `@objectstack/spec`
 * started exporting that name in 17.0.0-rc.6 for a DIFFERENT, narrower set and
 * a different surface (objectstack#4115). Keeping both under one name is the
 * planted-premise failure that guard exists to stop — and here the two sets
 * are not even nested by accident:
 *
 *  - the spec's `DateRangePreset` is `(typeof DATE_RANGE_PRESETS)[number]`,
 *    thirteen HISTORICAL windows, and it is the dashboard filter-bar
 *    vocabulary (`dashboard.dateRange.defaultRange`, `globalFilters` of
 *    `type: 'date'`). Its `superRefine` on `GlobalFilterSchema` rejects
 *    anything outside those thirteen by name;
 *  - this one adds eight FUTURE windows (`tomorrow`, `next_week`,
 *    `next_month`, `next_quarter`, `next_year`, `next_7_days`, `next_30_days`,
 *    `next_90_days`) for {@link DateRangeFilter}'s `preset` above, where a
 *    forward-looking range ("due next week") is the point.
 *
 * So an author or agent who read the spec's thirteen off this name would have
 * been told eight windows exist that the dashboard schema rejects, and one who
 * read this file's twenty-one off the spec's name would have been told eight
 * that work here do not. The prefix says which vocabulary is being spelled;
 * `FilterBuilderCondition` (objectui#3159, batch 5) named its sibling the same
 * way for the same reason.
 *
 * Nothing in this repo consumed the old name outside {@link DateRangeFilter}
 * directly above, so the rename is a public-surface change with no internal
 * call-site churn — see the changeset for the importer-facing note.
 */
export type FilterBuilderDateRangePreset =
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'this_week'
  | 'last_week'
  | 'next_week'
  | 'this_month'
  | 'last_month'
  | 'next_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'next_quarter'
  | 'this_year'
  | 'last_year'
  | 'next_year'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'next_7_days'
  | 'next_30_days'
  | 'next_90_days';

// The filter builder configuration pair (Phase 3.4.5: `FilterBuilderConfig`,
// `FilterFieldConfig`) is retired (objectstack#25921, batch 12): no filter
// builder, adapter or host read either shape.

// RETIRED (objectui#10719): the "Phase 3.5" field-validation family —
// `AdvancedValidationSchema`, `AdvancedValidationRule`, `ValidationRuleType`,
// `ValidationFunction`, `AsyncValidationFunction`, `ValidationContext`,
// `AdvancedValidationResult` and `AdvancedValidationError` — typed only
// `@object-ui/core`'s `ValidationEngine`, which objectui#7659 retired. With the
// engine gone nothing read them, so they left this module and the root barrel
// under the same ruling (ADR-0049 enforce-or-remove). Client-side field
// validation is `FieldValidationRules` (`./form.ts`), compiled from field
// metadata by `buildValidationRules` in `@object-ui/fields`.

/**
 * =============================================================================
 * Object-Level Validation Rules
 * =============================================================================
 *
 * These are the rules an object declares in `ObjectSchema.validations`. The
 * vocabulary is **spec-owned**: the server evaluates it on the write path
 * (`objectql/src/validation/rule-validator.ts`), and objectui's
 * `ObjectValidationEngine` is a client-side PRE-CHECK of the very same rules.
 * One concept, one vocabulary — so the five spec-named variants below are
 * DERIVED from `@objectstack/spec/data` rather than re-declared
 * (objectstack#4115). Two consequences worth stating, because the hand-written
 * copies these replaced got both wrong for 15 spec majors:
 *
 * ## `z.input`, not `z.infer`
 *
 * objectui consumes AUTHORED metadata as it arrives over `/meta` — before the
 * spec's parse-time defaults and its ExpressionInput canonicalization have run.
 * `z.input` is the shape actually present in that JSON:
 *
 *  - `condition` / `when` are `string | { dialect, source }`, not the canonical
 *    envelope alone. `z.infer` would type away the bare-string form that every
 *    hand-authored rule uses.
 *  - `active` / `events` / `priority` / `severity` may be ABSENT, because the
 *    spec supplies their defaults at parse time. An absent key is not a falsy
 *    one: `active` defaults to `true`, `events` to `['insert','update']`.
 *    `ObjectValidationEngine` applies those defaults instead of reading
 *    undefined as "off".
 *
 * ## Predicate polarity
 *
 * A `script` / `cross_field` `condition` and a `conditional` `when` express the
 * **failure** condition: if the predicate evaluates TRUE, the rule is VIOLATED.
 * That is the server's semantics. A client pre-check that inverts it rejects
 * precisely the writes the server accepts, and accepts the ones it rejects.
 *
 * Drift guard: `packages/types/src/__tests__/validation-rule-spec-parity.test.ts`.
 */

/**
 * Fields every validation rule carries, derived from the spec's (unexported)
 * `BaseValidationSchema` by subtracting one variant's own discriminant and
 * payload. Deriving rather than re-listing keeps `priority` — and whatever the
 * spec adds next — from going missing here.
 */
export type BaseValidation = Omit<ScriptValidation, 'type' | 'condition'>;

/**
 * Script validation — a CEL predicate over the record.
 *
 * `condition` is the FAILURE condition (TRUE ⇒ violated), and accepts either the
 * bare-string shorthand or the `{ dialect, source }` envelope.
 */
export type ScriptValidation = z.input<typeof SpecScriptValidationSchema>;

/**
 * State-machine validation (ADR-0020) — legal transitions for one state field.
 *
 * A flat `field` plus a `transitions` map of `{ fromState: [allowedToStates] }`,
 * governing UPDATE. `initialStates` governs INSERT (the FSM entry point,
 * objectstack#3165): without it a record can be created mid-flow, because a
 * `select` field admits any declared option as an initial value.
 */
export type StateMachineValidation = z.input<typeof SpecStateMachineValidationSchema>;

/**
 * Cross-field validation — a CEL predicate spanning several fields.
 *
 * Shares `script`'s evaluation path and polarity (TRUE ⇒ violated). Only
 * `fields[0]` is read, to label which field the violation attaches to; the rest
 * are documentation.
 */
export type CrossFieldValidation = z.input<typeof SpecCrossFieldValidationSchema>;

/**
 * Format validation — one field against a `regex` and/or a named `format`.
 *
 * The named formats are the four the server implements. The hand-written copy
 * this replaces offered five more (`ipv4`/`ipv6`/`uuid`/`iso_date`/
 * `credit_card`) plus regex `flags`; none of them can survive the spec's
 * discriminated union, so a rule using them could never reach the server — the
 * client would have been enforcing a rule the server never saw.
 */
export type FormatValidation = z.input<typeof SpecFormatValidationSchema>;

/**
 * Conditional validation — evaluate `when`, then apply `then` or `otherwise`.
 *
 * PINNED DIVERGENCE (objectstack#4171, narrowed to objectstack#4075 by #3177):
 * every key comes from the spec except `then` / `otherwise`.
 *
 * Those two used to erase to `unknown`. Spec 17.0.0-rc.1 typed them — as
 * `BaseValidationRuleShape`, which is `{ type: string; name: string; message:
 * string; …; [key: string]: unknown }`. That is better than `unknown` and still
 * not enough to derive from: `type` is `string` rather than a literal union, so
 * a branch cannot narrow by discriminant, `then.condition` reads back as
 * `unknown`, and the index signature waves through any member at all — a typo'd
 * `type: 'formatt'` included. The spec's own comment on `ValidationRuleSchema`
 * says as much and names the remaining work: "it is not strictness … Removing
 * the index signature is the [objectstack-ai/objectstack#4075] family of work, not this change."
 *
 * So the branches stay re-typed to objectui's discriminated union here. What
 * changed in #3177 is the tripwire, not the divergence:
 * `validation-rule-spec-parity.test.ts` used to pin "the spec still says
 * `unknown`" — too weak a question, which fired without the burn-down having
 * become correct. It now pins the condition that actually governs (literal
 * discriminant / no index signature), so this divergence still cannot outlive
 * its reason, but the reason is stated accurately.
 *
 * Why this side of the trade matters more than it looks: renderers read plain
 * objects and never parse, so the spec's parse-time union — the thing that DOES
 * reject a malformed rule — is not on the client path at all. The compile-time
 * discriminant here is the only gate an authored (or AI-generated) rule meets
 * before it runs.
 */
export type ConditionalValidation = Omit<
  z.input<typeof SpecConditionalValidationSchema>,
  'then' | 'otherwise'
> & {
  /** Rule applied when `when` evaluates TRUE. */
  then: ObjectValidationRule;
  /** Rule applied when `when` evaluates FALSE. */
  otherwise?: ObjectValidationRule;
};

/**
 * Uniqueness validation — objectui-local, NOT spec vocabulary.
 *
 * @deprecated The spec removed this deliberately: a SELECT-then-INSERT check is
 * racy (TOCTOU) where a DB constraint is not. Enforce it in the database
 * instead — and note that `unique` is scoped vocabulary (ADR-0120), so the
 * replacement has to state a scope rather than a bare boolean:
 *
 * - A unique **index**: an `ObjectSchema.indexes` entry
 *   `{ fields, unique: 'global' | 'organization' }`. `'organization'` is one
 *   holder per organization (the driver prepends the NULL-safe organization
 *   key part); `'global'` is one holder across the installation. On THIS
 *   surface bare `unique: true` was the positional spelling of `'global'`;
 *   protocol 18 REFUSES it at parse, at `os validate` and at the metadata save
 *   door (objectstack#22103), and the server serves a stored legacy `true` as
 *   `'global'`.
 * - Field-level `unique` for a single-field constraint. The same token does
 *   NOT mean the same thing on both surfaces: at field level bare `true` is
 *   the positional spelling of `'organization'` and stays valid, though new
 *   code spells `'organization'` so the scope is legible without knowing the
 *   default.
 * - A **partial** (predicated) constraint is not declarable at all. It is
 *   built at the database layer by a runtime migration issuing
 *   `CREATE UNIQUE INDEX … WHERE`. `indexes[].partial` was retired in
 *   `@objectstack/spec` 17.0.0 (ADR-0049) and is now a tombstone the parse
 *   rejects at any value — no driver ever emitted the `WHERE` clause, so a
 *   declared partial index had been materializing as a FULL one.
 *
 * What would falsify the above: `UniqueScopeSchema` and `IndexSchema` in
 * `@objectstack/spec` are what decide it. If the scope union gains a member,
 * the `partial` tombstone is lifted, or protocol 18 lands its rejection, this
 * paragraph is the thing that goes stale — re-read those two schemas, not this
 * comment.
 *
 * `ValidationRuleSchema` rejects `type: 'unique'`, so a rule in this shape
 * cannot reach the server — `ObjectValidationEngine` only evaluates it for
 * callers that build rules by hand.
 */
export interface UniquenessValidation extends BaseValidation {
  type: 'unique';

  /** Fields that must be unique together */
  fields: string[];

  /** Optional scope expression (e.g., "tenant_id = ${current_tenant}") */
  scope?: string;

  /** Whether comparison is case-sensitive */
  caseSensitive?: boolean;
}

/**
 * Async/remote validation — objectui-local, NOT spec vocabulary.
 *
 * @deprecated The spec removed this deliberately: `debounce`/endpoint semantics
 * only mean something against keystrokes, and it is an SSRF/latency hazard on
 * the write path. Keep it in the form layer, or enforce the underlying
 * invariant with a unique index or a lifecycle hook. `ValidationRuleSchema`
 * rejects `type: 'async'`, so a rule in this shape cannot reach the server.
 */
export interface AsyncValidation extends BaseValidation {
  type: 'async';

  /** API endpoint to call */
  endpoint: string;

  /** HTTP method */
  method?: 'GET' | 'POST';

  /** Debounce delay in milliseconds */
  debounce?: number;

  /** Cache configuration */
  cache?: {
    enabled: boolean;
    ttl?: number; // Time to live in seconds
  };
}

/**
 * Range validation — objectui-local, NOT spec vocabulary.
 *
 * @deprecated The spec has never carried a `range` rule; bounds belong on the
 * field (`min`/`max`) or in a `script` predicate. `ValidationRuleSchema` rejects
 * `type: 'range'`, so a rule in this shape cannot reach the server.
 */
export interface RangeValidation extends BaseValidation {
  type: 'range';

  /** Field to validate */
  field: string;

  /** Minimum value (inclusive) */
  min?: number | string | Date;

  /** Maximum value (inclusive) */
  max?: number | string | Date;

  /** Whether min is exclusive */
  minExclusive?: boolean;

  /** Whether max is exclusive */
  maxExclusive?: boolean;
}

/**
 * Every validation rule `ObjectValidationEngine` dispatches on.
 *
 * This is NOT the spec's `ValidationRuleSchema` union and does not claim to be
 * — hence the distinct name. Two documented deltas:
 *
 *  - **Missing** `json_schema` (spec's sixth variant). objectui does not carry a
 *    JSON-Schema validator on the client; the engine warns loudly rather than
 *    reporting such a rule as passing.
 *  - **Extra** `unique` / `async` / `range` — the three @deprecated local
 *    variants above, which the spec's union rejects outright.
 */
export type ObjectValidationRule =
  | ScriptValidation
  | StateMachineValidation
  | CrossFieldValidation
  | ConditionalValidation
  | FormatValidation
  | UniquenessValidation
  | AsyncValidation
  | RangeValidation;
