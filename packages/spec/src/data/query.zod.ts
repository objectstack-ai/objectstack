// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from './filter.zod';

/**
 * Sort Node
 * Represents "Order By".
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const SortNodeSchema = lazySchema(() => z.object({
  field: z.string(),
  order: z.enum(['asc', 'desc']).default('asc')
}));

/**
 * Aggregation Function Enum
 * Standard aggregation functions for data analysis.
 * 
 * Supported Functions:
 * - **count**: Count rows (SQL: COUNT(*) or COUNT(field))
 * - **sum**: Sum numeric values (SQL: SUM(field))
 * - **avg**: Average numeric values (SQL: AVG(field))
 * - **min**: Minimum value (SQL: MIN(field))
 * - **max**: Maximum value (SQL: MAX(field))
 * - **count_distinct**: Count unique values (SQL: COUNT(DISTINCT field))
 * - **array_agg**: Aggregate values into array (SQL: ARRAY_AGG(field))
 * - **string_agg**: Concatenate values (SQL: STRING_AGG(field, delimiter))
 * 
 * Performance Considerations:
 * - COUNT(*) is typically faster than COUNT(field) as it doesn't check for nulls
 * - COUNT DISTINCT may require additional memory for tracking unique values
 * - Window aggregates (with OVER clause) can be more efficient than subqueries
 * - Large GROUP BY operations benefit from proper indexing on grouped fields
 * 
 * @example
 * // SQL: SELECT region, SUM(amount) FROM sales GROUP BY region
 * {
 *   object: 'sales',
 *   fields: ['region'],
 *   aggregations: [
 *     { function: 'sum', field: 'amount', alias: 'total_sales' }
 *   ],
 *   groupBy: ['region']
 * }
 * 
 * @example
 * // Salesforce SOQL: SELECT COUNT(Id) FROM Account
 * {
 *   object: 'account',
 *   aggregations: [
 *     { function: 'count', alias: 'total_accounts' }
 *   ]
 * }
 */
export const AggregationFunction = z.enum([
  'count', 'sum', 'avg', 'min', 'max',
  'count_distinct', 'array_agg', 'string_agg'
]);

/**
 * Date Granularity Enum
 * Used to bucket date/timestamp fields into uniform periods during GROUP BY.
 *
 * Backends MAY emit `DATE_TRUNC` (PostgreSQL), `DATE_FORMAT` (MySQL),
 * `$dateTrunc` (MongoDB), or any other equivalent. When a driver does not
 * support server-side truncation the engine falls back to an in-memory bucket
 * using ISO-8601 conventions (weeks start Monday).
 */
export const DateGranularity = z.enum(['day', 'week', 'month', 'quarter', 'year']);

/**
 * GroupBy Node
 *
 * A grouping target — either a bare field name (string) for plain grouping,
 * or a structured object that adds `dateGranularity` for time-bucketed
 * grouping. The string form remains the canonical short-hand:
 *
 * ```ts
 * groupBy: ['region', { field: 'closed_at', dateGranularity: 'quarter' }]
 * ```
 *
 * This is backward-compatible: every existing `groupBy: ['region']` payload
 * continues to validate.
 */
export const GroupByNodeSchema = lazySchema(() => z.union([
  z.string(),
  z.object({
    field: z.string().describe('Field to group by'),
    dateGranularity: DateGranularity.optional().describe('Bucket date values into uniform periods (day/week/month/quarter/year)'),
    /** Optional alias for the projected group value (defaults to `field`). */
    alias: z.string().optional().describe('Alias for the projected group value'),
  }),
]));

/**
 * Aggregation Node
 * Represents an aggregated field with function.
 * 
 * Aggregations summarize data across groups of rows (GROUP BY).
 * Used with `groupBy` to create analytical queries.
 * 
 * @example
 * // SQL: SELECT customer_id, COUNT(*), SUM(amount) FROM orders GROUP BY customer_id
 * {
 *   object: 'order',
 *   fields: ['customer_id'],
 *   aggregations: [
 *     { function: 'count', alias: 'order_count' },
 *     { function: 'sum', field: 'amount', alias: 'total_amount' }
 *   ],
 *   groupBy: ['customer_id']
 * }
 * 
 * @example
 * // Salesforce SOQL: SELECT LeadSource, COUNT(Id) FROM Lead GROUP BY LeadSource
 * {
 *   object: 'lead',
 *   fields: ['lead_source'],
 *   aggregations: [
 *     { function: 'count', alias: 'lead_count' }
 *   ],
 *   groupBy: ['lead_source']
 * }
 */
export const AggregationNodeSchema = lazySchema(() => z.object({
  function: AggregationFunction.describe('Aggregation function'),
  field: z.string().optional().describe('Field to aggregate (optional for COUNT(*))'),
  alias: z.string().describe('Result column alias'),
  distinct: z.boolean().optional().describe('Apply DISTINCT before aggregation'),
  filter: FilterConditionSchema.optional().describe('[EXPERIMENTAL — not enforced] Per-aggregation filter (SQL FILTER (WHERE …)). Neither the SQL builders nor the in-memory fallback applies it (#4286); filter the whole query with `where` instead.'),
}));

// ─── Joins: REMOVED (#4286, ADR-0049) ────────────────────────────────────────
// The whole join cluster — `JoinType`, `JoinStrategy`, the internal
// `JoinNodeBaseSchema`, `JoinNodeSchema` and the `JoinNode`/`JoinNodeInput`
// types — was deleted together with the `query.joins` tombstone below: no
// engine or driver ever read a query's `joins`, and an exported schema with no
// consumer reads as a capability (the #3950 precedent). Related records are
// read through `expand`; a single related column is a dotted `fields` path
// (`fields: ['owner.name']`).

// ─── Window functions: REMOVED (#4286, ADR-0049) ─────────────────────────────
// The window cluster — `WindowFunction`, `WindowSpecSchema`,
// `WindowFunctionNodeSchema` and the `WindowFunctionNode`/`WindowSpec` types —
// was deleted together with the `query.windowFunctions` tombstone below.
// `find()` never applied a window function, and the one live door —
// `SqlDriver.findWithWindowFunctions(object, query)` — consumes its own flat
// driver-level shape (`{ function, alias, partitionBy?, orderBy? }`), NOT this
// vocabulary: the spec node declared `field`, `over` and `frame` members the
// door never read, so keeping the schemas would have documented an input no
// executor accepts (the #3950 orphaned-schema precedent, one layer over).

/**
 * One entry of a select list: a field name.
 *
 * The whole vocabulary is a column (`'name'`) or a dotted path the engine
 * resolves through a relationship field (`'owner.name'`). Related *records* are
 * selected with {@link QueryAST.expand}, not from inside this list.
 *
 * The TYPE half of {@link FieldNodeSchema} — it used to be that schema's
 * recursion annotation, back when the union carried a second
 * `{ field, fields?, alias? }` member (see the removal note on the schema).
 */
export type FieldNode = string;

/**
 * The prescription for the removed nested-select object form.
 *
 * The rejection is where an author actually meets a retirement (`retired-key.ts`
 * makes the same argument for keys), so the message carries the FROM → TO
 * mapping rather than zod's "expected string, received object".
 */
const FIELD_NODE_OBJECT_FORM_REMOVED =
  'A `fields[]` entry is a field name (string). The nested-select object form '
  + '`{ field, fields, alias }` was removed in @objectstack/spec 18 (#4196, ADR-0049) — nothing '
  + 'ever produced it and nothing ever read `.fields`/`.alias`: every consumer on this path '
  + 'treats the list as `string[]`, so the object form was dropped by the SQL and memory drivers, '
  + 'projected as a column literally named "[object Object]" by MongoDB, and refused as an unknown '
  + 'field by the REST ingress. Select related records with `expand` — '
  + "`expand: { owner: { object: 'user', fields: ['name'] } }` — or name a single related column "
  + "with a dotted path (`fields: ['owner.name']`). `alias` has no replacement here; an aliased "
  + 'projection is an `aggregations` or `windowFunctions` entry, which carry their own `alias`.';

/**
 * Field Selection Node
 * Represents "Select" attributes — one field name per entry.
 *
 * The `{ field, fields?, alias? }` member this union used to carry was REMOVED
 * (#4196): it was declared-but-inert, an ADR-0078 silently-inert declaration
 * that ADR-0049 requires be enforced or removed. `expand` already expresses
 * nested selection, and Prime Directive #12 wants one spelling per capability,
 * so the second one goes rather than being lowered into the first.
 */
export const FieldNodeSchema = z.string({
  // Only the shape that USED to be legal gets the retirement prescription —
  // telling the author of `fields: [42]` that their entry "was removed" would
  // misinform. Everything else keeps zod's own message.
  error: (issue) =>
    issue.code === 'invalid_type'
      && typeof issue.input === 'object' && issue.input !== null && !Array.isArray(issue.input)
      ? FIELD_NODE_OBJECT_FORM_REMOVED
      : undefined,
});

/**
 * The prescriptions for the two AST members removed in #4286. Like
 * {@link FIELD_NODE_OBJECT_FORM_REMOVED}, the rejection is where an author
 * meets a retirement, so each message carries the FROM → TO mapping. `QueryAST`
 * is a request shape, never stored in stack metadata, so there is no
 * `os migrate meta` step — callers rewrite their own queries (the protocol-18
 * semantic migrations `query-joins-retired` / `query-window-functions-retired`).
 */
const QUERY_JOINS_REMOVED =
  '`query.joins` was removed in @objectstack/spec 18 (#4286, ADR-0049) — no engine or driver '
  + 'ever read it: a query carrying `joins` behaved exactly as if the key were absent, while '
  + 'its name squatted on the reserved REST parameter set. Delete the key. Related records are '
  + "read through `expand` — `expand: { owner: { object: 'user', fields: ['name'] } }` — which "
  + 'the engine resolves via batch $in queries, and a single related column is a dotted '
  + "`fields` path (`fields: ['owner.name']`).";

const QUERY_WINDOW_FUNCTIONS_REMOVED =
  '`query.windowFunctions` was removed in @objectstack/spec 18 (#4286, ADR-0049) — `find()` '
  + 'never applied it: no engine or driver read the key on the query path, so every OVER '
  + 'clause it declared was silently dropped. Delete the key. Window functions are a '
  + 'SQL-driver capability behind `SqlDriver.findWithWindowFunctions(object, query)` '
  + '(embedder-level; not on the `IDataDriver` contract or the REST surface); request-level '
  + 'analytics are `aggregations` + `groupBy`.';

/**
 * Full-Text Search Configuration
 * Defines full-text search parameters for text queries.
 *
 * What actually executes (ADR-0061): the engine expands `search` into a
 * server-resolved cross-field `$or` filter, reading exactly two members —
 * `query` (the text) and `fields` (which columns to match). The remaining
 * six flags are declared search-engine affordances no executor receives;
 * they carry `[EXPERIMENTAL — not enforced]` markers so authoring one is a
 * declaration, not a silent no-op (#4286, ADR-0078).
 *
 * @example
 * {
 *   query: "John Smith",
 *   fields: ["name", "email", "description"]
 * }
 */
export const FullTextSearchSchema = lazySchema(() => z.object({
  query: z.string().describe('Search query text'),
  fields: z.array(z.string()).optional().describe('Fields to search in (if not specified, searches all text fields)'),
  fuzzy: z.boolean().optional().default(false).describe('[EXPERIMENTAL — not enforced] Fuzzy matching (tolerate typos). The ADR-0061 expansion reads only `query` + `fields`; no executor receives this flag (#4286).'),
  operator: z.enum(['and', 'or']).optional().default('or').describe('[EXPERIMENTAL — not enforced] Logical operator between terms. The ADR-0061 expansion applies its own term semantics; no executor receives this flag (#4286).'),
  boost: z.record(z.string(), z.number()).optional().describe('[EXPERIMENTAL — not enforced] Field-specific relevance boosting (field name -> boost factor). No executor scores results (#4286).'),
  minScore: z.number().optional().describe('[EXPERIMENTAL — not enforced] Minimum relevance score threshold. No executor scores results (#4286).'),
  language: z.string().optional().describe('[EXPERIMENTAL — not enforced] Language for text analysis (e.g., "en", "zh", "es"). No executor selects an analyzer (#4286).'),
  highlight: z.boolean().optional().default(false).describe('[EXPERIMENTAL — not enforced] Search result highlighting. No executor emits highlights (#4286).'),
}));

export type FullTextSearch = z.infer<typeof FullTextSearchSchema>;

/**
 * Query AST Schema
 * The universal data retrieval contract defined in `ast-structure.mdx`.
 * 
 * This schema represents ObjectQL - a universal query language that abstracts
 * SQL, NoSQL, and SaaS APIs into a single unified interface.
 * 
 * Updates (v2):
 * - Aligned with modern ORM standards (Prisma/TypeORM)
 * - Added `cursor` based pagination support
 * - Renamed `top`/`skip` to `limit`/`offset`
 * - Unified filtering syntax with `FilterConditionSchema`
 * 
 * Updates (v3):
 * - Added `search` parameter for full-text search (P2 requirement)
 * 
 * @example
 * // Simple query: SELECT name, email FROM account WHERE status = 'active'
 * {
 *   object: 'account',
 *   fields: ['name', 'email'],
 *   where: { status: 'active' }
 * }
 * 
 * @example
 * // Pagination with Limit/Offset
 * {
 *   object: 'post',
 *   where: { published: true },
 *   orderBy: [{ field: 'created_at', order: 'desc' }],
 *   limit: 20,
 *   offset: 40
 * }
 * 
 * @example
 * // Full-text search (ADR-0061: expanded into a cross-field $or)
 * {
 *   object: 'article',
 *   search: {
 *     query: "machine learning",
 *     fields: ["title", "content"]
 *   },
 *   limit: 10
 * }
 */
const BaseQuerySchema = z.object({
  /** Target Entity */
  object: z.string().describe('Object name (e.g. account)'),
  
  /** Select Clause */
  fields: z.array(FieldNodeSchema).optional().describe('Fields to retrieve — field names, optionally dotted to reach through a relationship (`owner.name`). Related *records* are selected with `expand`, not from inside this list.'),
  
  /** Where Clause (Filtering) */
  where: FilterConditionSchema.optional().describe('Filtering criteria (WHERE)'),
  
  /** Full-Text Search */
  search: FullTextSearchSchema.optional().describe('Full-text search configuration ($search parameter)'),
  
  /** Order By Clause (Sorting) */
  orderBy: z.array(SortNodeSchema).optional().describe('Sorting instructions (ORDER BY)'),
  
  /** Pagination */
  limit: z.number().optional().describe('Max records to return (LIMIT)'),
  offset: z.number().optional().describe('Records to skip (OFFSET)'),
  top: z.number().optional().describe('Alias for limit (OData compatibility)'),
  cursor: z.record(z.string(), z.unknown()).optional().describe('Cursor for keyset pagination'),
  
  /** Joins — REMOVED (#4286): `expand` is the one spelling for related records. */
  joins: retiredKey(QUERY_JOINS_REMOVED),

  /** Aggregations */
  aggregations: z.array(AggregationNodeSchema).optional().describe('Aggregation functions'),
  
  /** Group By Clause */
  groupBy: z.array(GroupByNodeSchema).optional().describe('GROUP BY targets (strings or `{field, dateGranularity?}` objects for date bucketing)'),
  
  /** Having Clause */
  having: FilterConditionSchema.optional().describe('HAVING clause for aggregation filtering'),
  
  /** Window functions — REMOVED from the request surface (#4286); the capability's door is `SqlDriver.findWithWindowFunctions()`. */
  windowFunctions: retiredKey(QUERY_WINDOW_FUNCTIONS_REMOVED),

  /** Subquery flag */
  distinct: z.boolean().optional().describe('SELECT DISTINCT flag'),
});

/**
 * QueryAST — Abstract Syntax Tree for data queries.
 *
 * The `expand` property enables recursive loading of related records through
 * lookup and master_detail fields. Each key is a relationship field name; the
 * value is a nested QueryAST that can further filter, select, sort, and expand
 * the related records (up to a default max depth of 3).
 *
 * @example
 * ```ts
 * const ast: QueryAST = {
 *   object: 'task',
 *   fields: ['title', 'assignee'],
 *   expand: {
 *     assignee: { object: 'user', fields: ['name', 'email'] },
 *     project: {
 *       object: 'project',
 *       expand: { org: { object: 'org' } }   // nested expand
 *     }
 *   }
 * };
 * ```
 */
export type QueryAST = z.infer<typeof BaseQuerySchema> & {
  expand?: Record<string, QueryAST>;
};

export type QueryInput = z.input<typeof BaseQuerySchema> & {
  expand?: Record<string, QueryInput>;
};

export const QuerySchema: z.ZodType<QueryAST, QueryInput> = lazySchema(() => BaseQuerySchema.extend({
  expand: z.lazy(() => z.record(z.string(), QuerySchema)).optional().describe(
    'Recursive relation loading map. Keys are lookup/master_detail field names; '
    + 'values are nested QueryAST objects that control select (`fields`) and filter '
    + '(`where`, AND-merged with the batch $in), plus further expansion on the related '
    + 'object. The engine resolves expand via batch $in queries (driver-agnostic) with a '
    + 'default max depth of 3; per-parent `limit`/`offset`/`orderBy` are NOT applied on '
    + 'this path.'
  ),
}));

export type SortNode = z.infer<typeof SortNodeSchema>;
export type AggregationNode = z.infer<typeof AggregationNodeSchema>;
export type GroupByNode = z.infer<typeof GroupByNodeSchema>;
export type DateGranularityValue = z.infer<typeof DateGranularity>;
// `FieldNode` is declared next to its schema rather than here: since #4196 it
// is no longer recursive, it is just the name the docs and the engine give to
// "one entry of a select list". (`JoinNode` and `WindowFunctionNode`/`WindowSpec`
// used to sit here too — removed with their clusters, #4286.)
