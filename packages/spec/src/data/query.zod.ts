// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from './filter.zod';

/**
 * Sort Node
 * Represents "Order By".
 */
import { lazySchema } from '../shared/lazy-schema';
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
  filter: FilterConditionSchema.optional().describe('Filter/Condition to apply to the aggregation (FILTER WHERE clause)'),
}));

/**
 * Join Type Enum
 * Standard SQL join types for combining tables.
 * 
 * Join Types:
 * - **inner**: Returns only matching rows from both tables (SQL: INNER JOIN)
 * - **left**: Returns all rows from left table, matching rows from right (SQL: LEFT JOIN)
 * - **right**: Returns all rows from right table, matching rows from left (SQL: RIGHT JOIN)
 * - **full**: Returns all rows from both tables (SQL: FULL OUTER JOIN)
 * 
 * @example
 * // SQL: SELECT * FROM orders INNER JOIN customers ON orders.customer_id = customers.id
 * {
 *   object: 'order',
 *   joins: [
 *     {
 *       type: 'inner',
 *       object: 'customer',
 *       on: ['order.customer_id', '=', 'customer.id']
 *     }
 *   ]
 * }
 * 
 * @example
 * // Salesforce SOQL-style: Find all customers and their orders (if any)
 * {
 *   object: 'customer',
 *   joins: [
 *     {
 *       type: 'left',
 *       object: 'order',
 *       on: ['customer.id', '=', 'order.customer_id']
 *     }
 *   ]
 * }
 */
export const JoinType = z.enum(['inner', 'left', 'right', 'full']);

/**
 * Join Execution Strategy
 * Hints to the query engine on how to execute the join.
 * 
 * Strategies:
 * - **auto**: Engine decides best strategy (Default).
 * - **database**: Push down join to the database (Requires same datasource).
 * - **hash**: Load both sets into memory and hash join (Cross-datasource, memory intensive).
 * - **loop**: Nested loop lookup (N+1 safe version). (Good for small right-side lookups).
 */
export const JoinStrategy = z.enum(['auto', 'database', 'hash', 'loop']);

/** Non-recursive half of {@link JoinNodeSchema} — every key except `subquery`. */
const JoinNodeBaseSchema = lazySchema(() => z.object({
  type: JoinType.describe('Join type'),
  strategy: JoinStrategy.optional().describe('Execution strategy hint'),
  object: z.string().describe('Object/table to join'),
  alias: z.string().optional().describe('Table alias'),
  on: FilterConditionSchema.describe('Join condition'),
}));

/**
 * A single join — the TYPE half of {@link JoinNodeSchema}.
 *
 * `subquery` is what makes the schema recursive (through {@link QuerySchema}),
 * so it is declared here rather than inferred: `z.lazy()` needs an annotation,
 * and the `z.ZodType<any>` this carried before #4171 made the exported
 * `JoinNode` — and `QueryAST['joins']` with it — resolve to `any`.
 */
export type JoinNode = z.infer<typeof JoinNodeBaseSchema> & {
  /** Join against a derived dataset instead of a plain object/table. */
  subquery?: QueryAST;
};

/**
 * The authoring shape of a join — the INPUT half of {@link JoinNodeSchema}
 * (#4195), the same relationship {@link QueryInput} has to {@link QueryAST}.
 *
 * Kept as its own type rather than reusing `JoinNode` because the recursive
 * knot differs: a nested `subquery` is authored, so it is a `QueryInput`, not
 * the parsed `QueryAST`.
 */
export type JoinNodeInput = z.input<typeof JoinNodeBaseSchema> & {
  /** Join against a derived dataset instead of a plain object/table. */
  subquery?: QueryInput;
};

/**
 * Join Node
 * Represents table joins for combining data from multiple objects.
 * 
 * Joins connect related data across multiple tables using ON conditions.
 * Supports both direct object joins and subquery joins.
 * 
 * @example
 * // SQL: SELECT o.*, c.name FROM orders o INNER JOIN customers c ON o.customer_id = c.id
 * {
 *   object: 'order',
 *   fields: ['id', 'amount'],
 *   joins: [
 *     {
 *       type: 'inner',
 *       object: 'customer',
 *       alias: 'c',
 *       on: ['order.customer_id', '=', 'c.id']
 *     }
 *   ]
 * }
 * 
 * @example
 * // SQL: Multi-table join
 * // SELECT * FROM orders o
 * // INNER JOIN customers c ON o.customer_id = c.id
 * // LEFT JOIN shipments s ON o.id = s.order_id
 * {
 *   object: 'order',
 *   joins: [
 *     {
 *       type: 'inner',
 *       object: 'customer',
 *       alias: 'c',
 *       on: ['order.customer_id', '=', 'c.id']
 *     },
 *     {
 *       type: 'left',
 *       object: 'shipment',
 *       alias: 's',
 *       on: ['order.id', '=', 's.order_id']
 *     }
 *   ]
 * }
 * 
 * @example
 * // Salesforce SOQL: SELECT Name, (SELECT LastName FROM Contacts) FROM Account
 * {
 *   object: 'account',
 *   fields: ['name'],
 *   joins: [
 *     {
 *       type: 'left',
 *       object: 'contact',
 *       on: ['account.id', '=', 'contact.account_id']
 *     }
 *   ]
 * }
 * 
 * @example
 * // Subquery Join: Join with a filtered/aggregated dataset
 * {
 *   object: 'customer',
 *   joins: [
 *     {
 *       type: 'left',
 *       object: 'order',
 *       alias: 'high_value_orders',
 *       on: ['customer.id', '=', 'high_value_orders.customer_id'],
 *       subquery: {
 *         object: 'order',
 *         fields: ['customer_id', 'total'],
 *         filters: ['total', '>', 1000]
 *       }
 *     }
 *   ]
 * }
 */
export const JoinNodeSchema: z.ZodType<JoinNode, JoinNodeInput> = z.lazy(() =>
  JoinNodeBaseSchema.extend({
    subquery: z.lazy(() => QuerySchema).optional().describe('Subquery instead of object'),
  })
);

/**
 * Window Function Enum
 * Advanced analytical functions for row-based calculations.
 * 
 * Window Functions:
 * - **row_number**: Sequential number within partition (SQL: ROW_NUMBER() OVER (...))
 * - **rank**: Rank with gaps for ties (SQL: RANK() OVER (...))
 * - **dense_rank**: Rank without gaps (SQL: DENSE_RANK() OVER (...))
 * - **percent_rank**: Relative rank as percentage (SQL: PERCENT_RANK() OVER (...))
 * - **lag**: Access previous row value (SQL: LAG(field) OVER (...))
 * - **lead**: Access next row value (SQL: LEAD(field) OVER (...))
 * - **first_value**: First value in window (SQL: FIRST_VALUE(field) OVER (...))
 * - **last_value**: Last value in window (SQL: LAST_VALUE(field) OVER (...))
 * - **sum/avg/count/min/max**: Aggregates over window (SQL: SUM(field) OVER (...))
 * 
 * @example
 * // SQL: SELECT *, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY amount DESC) as rank
 * //      FROM orders
 * {
 *   object: 'order',
 *   fields: ['id', 'customer_id', 'amount'],
 *   windowFunctions: [
 *     {
 *       function: 'row_number',
 *       alias: 'rank',
 *       over: {
 *         partitionBy: ['customer_id'],
 *         orderBy: [{ field: 'amount', order: 'desc' }]
 *       }
 *     }
 *   ]
 * }
 * 
 * @example
 * // SQL: Running total with SUM() OVER (...)
 * {
 *   object: 'transaction',
 *   fields: ['date', 'amount'],
 *   windowFunctions: [
 *     {
 *       function: 'sum',
 *       field: 'amount',
 *       alias: 'running_total',
 *       over: {
 *         orderBy: [{ field: 'date', order: 'asc' }],
 *         frame: {
 *           type: 'rows',
 *           start: 'UNBOUNDED PRECEDING',
 *           end: 'CURRENT ROW'
 *         }
 *       }
 *     }
 *   ]
 * }
 */
export const WindowFunction = z.enum([
  'row_number', 'rank', 'dense_rank', 'percent_rank',
  'lag', 'lead', 'first_value', 'last_value',
  'sum', 'avg', 'count', 'min', 'max'
]);

/**
 * Window Specification
 * Defines PARTITION BY and ORDER BY for window functions.
 * 
 * Window specifications control how window functions compute values:
 * - **partitionBy**: Divide rows into groups (like GROUP BY but without collapsing rows)
 * - **orderBy**: Define order for ranking and offset functions
 * - **frame**: Specify which rows to include in aggregate calculations
 * 
 * @example
 * // Partition by department, order by salary
 * {
 *   partitionBy: ['department'],
 *   orderBy: [{ field: 'salary', order: 'desc' }]
 * }
 * 
 * @example
 * // Moving average with frame specification
 * {
 *   orderBy: [{ field: 'date', order: 'asc' }],
 *   frame: {
 *     type: 'rows',
 *     start: '6 PRECEDING',
 *     end: 'CURRENT ROW'
 *   }
 * }
 */
export const WindowSpecSchema = lazySchema(() => z.object({
  partitionBy: z.array(z.string()).optional().describe('PARTITION BY fields'),
  orderBy: z.array(SortNodeSchema).optional().describe('ORDER BY specification'),
  frame: z.object({
    type: z.enum(['rows', 'range']).optional(),
    start: z.string().optional().describe('Frame start (e.g., "UNBOUNDED PRECEDING", "1 PRECEDING")'),
    end: z.string().optional().describe('Frame end (e.g., "CURRENT ROW", "1 FOLLOWING")'),
  }).optional().describe('Window frame specification'),
}));

/**
 * Window Function Node
 * Represents window function with OVER clause.
 * 
 * Window functions perform calculations across a set of rows related to the current row,
 * without collapsing the result set (unlike GROUP BY aggregations).
 * 
 * @example
 * // SQL: Top 3 products per category
 * // SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY sales DESC) as rank
 * // FROM products
 * {
 *   object: 'product',
 *   fields: ['name', 'category', 'sales'],
 *   windowFunctions: [
 *     {
 *       function: 'row_number',
 *       alias: 'category_rank',
 *       over: {
 *         partitionBy: ['category'],
 *         orderBy: [{ field: 'sales', order: 'desc' }]
 *       }
 *     }
 *   ]
 * }
 * 
 * @example
 * // SQL: Year-over-year comparison with LAG
 * {
 *   object: 'monthly_sales',
 *   fields: ['month', 'revenue'],
 *   windowFunctions: [
 *     {
 *       function: 'lag',
 *       field: 'revenue',
 *       alias: 'prev_year_revenue',
 *       over: {
 *         orderBy: [{ field: 'month', order: 'asc' }]
 *       }
 *     }
 *   ]
 * }
 */
export const WindowFunctionNodeSchema = lazySchema(() => z.object({
  function: WindowFunction.describe('Window function name'),
  field: z.string().optional().describe('Field to operate on (for aggregate window functions)'),
  alias: z.string().describe('Result column alias'),
  over: WindowSpecSchema.describe('Window specification (OVER clause)'),
}));

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
 * Full-Text Search Configuration
 * Defines full-text search parameters for text queries.
 * 
 * Supports:
 * - Multi-field search
 * - Relevance scoring
 * - Fuzzy matching
 * - Language-specific analyzers
 * 
 * @example
 * {
 *   query: "John Smith",
 *   fields: ["name", "email", "description"],
 *   fuzzy: true,
 *   boost: { "name": 2.0, "email": 1.5 }
 * }
 */
export const FullTextSearchSchema = lazySchema(() => z.object({
  query: z.string().describe('Search query text'),
  fields: z.array(z.string()).optional().describe('Fields to search in (if not specified, searches all text fields)'),
  fuzzy: z.boolean().optional().default(false).describe('Enable fuzzy matching (tolerates typos)'),
  operator: z.enum(['and', 'or']).optional().default('or').describe('Logical operator between terms'),
  boost: z.record(z.string(), z.number()).optional().describe('Field-specific relevance boosting (field name -> boost factor)'),
  minScore: z.number().optional().describe('Minimum relevance score threshold'),
  language: z.string().optional().describe('Language for text analysis (e.g., "en", "zh", "es")'),
  highlight: z.boolean().optional().default(false).describe('Enable search result highlighting'),
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
 * // Full-text search
 * {
 *   object: 'article',
 *   search: {
 *     query: "machine learning",
 *     fields: ["title", "content"],
 *     fuzzy: true,
 *     boost: { "title": 2.0 }
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
  
  /** Joins */
  joins: z.array(JoinNodeSchema).optional().describe('Explicit Table Joins'),
  
  /** Aggregations */
  aggregations: z.array(AggregationNodeSchema).optional().describe('Aggregation functions'),
  
  /** Group By Clause */
  groupBy: z.array(GroupByNodeSchema).optional().describe('GROUP BY targets (strings or `{field, dateGranularity?}` objects for date bucketing)'),
  
  /** Having Clause */
  having: FilterConditionSchema.optional().describe('HAVING clause for aggregation filtering'),
  
  /** Window Functions */
  windowFunctions: z.array(WindowFunctionNodeSchema).optional().describe('Window functions with OVER clause'),
  
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
// `JoinNode` is declared next to its schema — it IS that schema's annotation, so
// it cannot be inferred back out of it (#4171). `FieldNode` sits there too, but
// for a different reason since #4196: it is no longer recursive, it is just the
// name the docs and the engine give to "one entry of a select list".
export type WindowFunctionNode = z.infer<typeof WindowFunctionNodeSchema>;
export type WindowSpec = z.infer<typeof WindowSpecSchema>;
