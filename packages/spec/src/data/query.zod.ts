// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from './filter.zod';

import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { strictObject } from '../shared/strict-object';

/**
 * Sort Node
 * Represents "Order By" — one `{ field, order }` pair. Unknown keys are
 * REJECTED (#4721); spell the direction `order`, never `direction`.
 */
// ⚠️ Keep the block above short: `build-docs.ts` takes the FIRST JSDoc block in
// the file as this page's description, so the rationale below is line comments.
//
// ─── Why this one schema is strict while the rest of the file is not (#4721) ──
//
// `query.zod.ts` is classed `open` in the #4001 strictness ledger, and
// `SortNodeSchema` is carved out of that blanket. The carve-out is what the
// shape earns: the rest of the file is the query DIALECT, where user data flows
// through predicate values, while a sort node is a closed two-key tuple with no
// user-data face at all. Classing by FILE was the imprecise instrument here, not
// closing this schema.
//
// What the closure stops, measured on `main` before the change:
//
//     SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
//       →  { field: 'updated_at', order: 'asc' }
//
// `direction` was stripped, `order` fell back to its `asc` default, and the sort
// ran in the OPPOSITE direction under an ordinary success. Paired with `limit` —
// which is how a caller asks for "the latest N" — that is not a reordered page
// but a DIFFERENT SET OF ROWS, with no signal anywhere in the response.
//
// `direction` gets a named alias rather than a distance-based suggestion because
// it is not a typo: it is `IReportService.orderBy`'s live vocabulary
// (`contracts/report-service.ts`), a genuinely different contract that
// `plugin-auth/objectql-adapter.ts` already translates by hand. Edit distance
// can never reach a different WORD for the same intent — the `visibleWhen →
// visible` class (see `shared/strict-object.ts`) — so only a hand-written entry
// puts the prescription in the author's hands.
//
// The wire-facing half of the same door is `normalizeSortNodes`
// (`metadata-protocol/src/protocol.ts`), which rejects `direction` by name with
// `400 INVALID_SORT` before a request ever reaches this schema. Both were closed
// in one change deliberately: closing only the schema is the door asymmetry
// #1535 shipped and #4522 had to come back for.
//
// Deliberately NOT taken here: `BaseQuerySchema`'s own top level stays
// non-strict. That is #4001's to schedule.
export const SortNodeSchema = lazySchema(() => strictObject(
  {
    surface: 'this sort node',
    history:
      'Until #4721 an unknown key here was dropped silently and `order` fell back to its `asc` '
      + 'default, so a descending request came back ascending — and with `limit`, a different '
      + 'set of rows under an ordinary 200.',
    aliases: { direction: 'order' },
  },
  {
    field: z.string(),
    order: z.enum(['asc', 'desc']).default('asc'),
  },
));

// Retired-VALUE prescriptions. Declared with `//` (never `/** */`) and ABOVE the
// enum's JSDoc deliberately: `build-docs.ts` takes a file's FIRST JSDoc as the
// reference page's blurb, so a doc comment here would displace the function
// table below. (The `crypto.hash` / `HookBodyCapability` precedent,
// `data/hook-body.zod.ts`, which is the other enum-value retirement in tree.)
const AGG_RETIRED_MIDDLE =
  ' was removed from `AggregationFunction` in @objectstack/spec 17 (#6188, ADR-0049 '
  + 'enforce-or-remove) — no SQL backend ever compiled it. `SqlDriver.mapAggregateFunc` and '
  + '`RemoteTransport.aggregate` each lower the same set of functions and refuse the rest, and '
  + "the v1 dataset runtime had to subtract this one by name to stop it reaching a `COUNT(*)` "
  + 'fallback that returns a row count in place of the value asked for. On the backend family '
  + 'this platform targets it was a declaration that could only fail. ';
const AGG_RETIRED_TAIL =
  'There is no replacement in the query vocabulary: read the rows with an ordinary `fields` '
  + 'query and shape them in the caller, or model the roll-up as a stored field. It returns '
  + 'only WITH a portable lowering — ADR-0049\'s enforce leg, implementation first. '
  + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.';

const ARRAY_AGG_RETIRED =
  '`array_agg`' + AGG_RETIRED_MIDDLE
  + 'Delete the aggregation, or the dataset measure that declared it. ' + AGG_RETIRED_TAIL;

const STRING_AGG_RETIRED =
  '`string_agg`' + AGG_RETIRED_MIDDLE
  + 'Its dialect divergence is the widest of the family — the delimiter is a second argument '
  + 'in PostgreSQL, a `SEPARATOR` clause in MySQL and a differently-named function in SQL '
  + 'Server — so there was never one shape to lower it to. Delete the aggregation, or the '
  + 'dataset measure that declared it. ' + AGG_RETIRED_TAIL;

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
 * - **count_distinct**: Count DISTINCT NON-NULL values (SQL: COUNT(DISTINCT field));
 *   `field` is REQUIRED — there is no `COUNT(DISTINCT *)`
 *
 * `array_agg` and `string_agg` were REMOVED in 17 (#6188). They were declared
 * here from the day the enum was written and compiled by no SQL backend, while
 * `service-analytics` carried a hand-written subtraction list naming exactly
 * these two. `count_distinct` was deliberately kept on the other side of that
 * split (maintainer ruling, 2026-08-07): a dashboard staple with one portable
 * lowering (`COUNT(DISTINCT x)`), it took ADR-0049's ENFORCE leg — and #6409
 * closed it, lowering the function on both SQL faces (`SqlDriver` and the Turso
 * remote transport). The declaration led its implementation by decision rather
 * than by drift, and no longer leads it at all: every value of this enum is
 * compiled by the SQL family, and the values are pinned across the two faces by
 * `AGGREGATION_CASES`. Authoring a retired value is a `tsc` error and a parse
 * error carrying the prescription above.
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
  'count_distinct'
], {
  // Only the two spellings that USED to be legal get the retirement message.
  // Telling the author of `arry_agg` that their value "was removed" would
  // misinform, so everything else keeps zod's own enum error, which already
  // lists the legal functions. (`crypto.hash`, and the `managedBy: 'system'`
  // precedent one level up in object.zod.ts.)
  error: (issue) => {
    if (issue.input === 'array_agg') return ARRAY_AGG_RETIRED;
    if (issue.input === 'string_agg') return STRING_AGG_RETIRED;
    return undefined;
  },
});

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
  + '`{ field, fields, alias }` was removed in @objectstack/spec 17 (#4196, ADR-0049) — nothing '
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
 * `os migrate meta` step — callers rewrite their own queries (the protocol-17
 * semantic migrations `query-joins-retired` / `query-window-functions-retired`).
 */
const QUERY_JOINS_REMOVED =
  '`query.joins` was removed in @objectstack/spec 17 (#4286, ADR-0049) — no engine or driver '
  + 'ever read it: a query carrying `joins` behaved exactly as if the key were absent, while '
  + 'its name squatted on the reserved REST parameter set. Delete the key. Related records are '
  + "read through `expand` — `expand: { owner: { object: 'user', fields: ['name'] } }` — which "
  + 'the engine resolves via batch $in queries, and a single related column is a dotted '
  + "`fields` path (`fields: ['owner.name']`).";

/**
 * Exported (unlike the two above) because `EngineQueryOptionsSchema`
 * (`data-engine.zod.ts`) re-declared both keys and tombstones them with the
 * same prescription — one string, two rejection sites.
 */
export const QUERY_CURSOR_REMOVED =
  '`query.cursor` was removed in @objectstack/spec 17 (#4286, ADR-0049) — no driver ever '
  + 'implemented keyset pagination, so the cursor was accepted and ignored and every page came '
  + 'back identical (a caller looping "until hasMore is false" never terminates). Delete the '
  + 'key; `QueryBuilder.cursor()` was removed with it. Express the keyset as an ordinary '
  + '`where` predicate on your sort key — `where: { created_at: { $gt: last.created_at } }` '
  + 'with the matching `orderBy` — which every driver executes with canonicalised comparands. '
  + 'A first-class cursor, if ever built, will be a response-minted opaque token, not this '
  + 'caller-built record.';

/** See {@link QUERY_CURSOR_REMOVED} for why this one is exported. */
export const QUERY_DISTINCT_REMOVED =
  '`query.distinct` was removed in @objectstack/spec 17 (#4286, ADR-0049 / ADR-0078) — no '
  + "driver ever rendered SELECT DISTINCT; the flag's only observable effect was MIS-WIRED: "
  + 'the REST list path treated a distinct query as not countable and silently degraded '
  + '`total`/`hasMore` to a page-local estimate while still returning duplicate rows. Delete '
  + 'the key; `QueryBuilder.distinct()` was removed with it, and the count suppression is gone '
  + '(`total` is truthful again). For unique values of one column use the SQL/memory drivers\' '
  + '`distinct(object, field)` door; for unique combinations, `groupBy`; for a deduplicated '
  + 'count, the `count_distinct` aggregation.';

const QUERY_WINDOW_FUNCTIONS_REMOVED =
  '`query.windowFunctions` was removed in @objectstack/spec 17 (#4286, ADR-0049) — `find()` '
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

export type FullTextSearch = z.input<typeof FullTextSearchSchema>;
/** Post-parse shape of {@link FullTextSearch} — defaults applied, transforms run (ADR-0122). */
export type FullTextSearchParsed = z.infer<typeof FullTextSearchSchema>;

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
 * Updates (18 — #4286, ADR-0049 enforce-or-remove):
 * - `joins` / `windowFunctions` / `cursor` / `distinct` REMOVED (tombstoned;
 *   each rejection carries its replacement)
 * - `having` ENFORCED engine-side after aggregation
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

  /**
   * Full-Text Search.
   *
   * The bare string IS the canonical Tier-1 contract (ADR-0061 D1: "the
   * client sends only the query text; the server resolves which fields to
   * search from object metadata") — it is what every surface sends and what
   * the dogfood HTTP proof (`showcase-search.dogfood.test.ts`) pins. The
   * structured `FullTextSearchSchema` form remains for the declared Tier-2
   * knobs. The union is schema-side drift REPAIR, not a new dialect: the
   * schema declared only the object form while the executor and the ADR's own
   * conformance ledger served the string — surfaced the moment #3899 started
   * validating request bodies against this schema.
   */
  search: z.union([z.string(), FullTextSearchSchema]).optional()
    .describe('Full-text search — the query text (canonical, ADR-0061 D1), or a structured FullTextSearch configuration'),

  /**
   * Per-query narrowing of the searchable field set (ADR-0061 D1).
   * Server-validated: intersected with the object's allowed searchable
   * fields — it can only narrow, never widen. Formalized here per the ADR's
   * P1 ("formalize `$searchFields`"); the enforcement site is
   * `objectql/src/search-filter.ts` `resolveSearchFields`, proven at the
   * HTTP level by `showcase-search.dogfood.test.ts`.
   */
  searchFields: z.array(z.string()).optional()
    .describe('Narrow the search to these fields (server-intersected with the allowed searchable set — can only narrow, never widen; ADR-0061 D1)'),

  /** Order By Clause (Sorting) */
  orderBy: z.array(SortNodeSchema).optional().describe('Sorting instructions (ORDER BY)'),
  
  /** Pagination */
  limit: z.number().optional().describe('Max records to return (LIMIT)'),
  offset: z.number().optional().describe('Records to skip (OFFSET)'),
  top: z.number().optional().describe('Alias for limit (OData compatibility)'),
  /** Keyset cursor — REMOVED (#4286): express the keyset as a `where` predicate on the sort key. */
  cursor: retiredKey(QUERY_CURSOR_REMOVED),
  
  /** Joins — REMOVED (#4286): `expand` is the one spelling for related records. */
  joins: retiredKey(QUERY_JOINS_REMOVED),

  /** Aggregations */
  aggregations: z.array(AggregationNodeSchema).optional().describe('Aggregation functions'),
  
  /** Group By Clause */
  groupBy: z.array(GroupByNodeSchema).optional().describe('GROUP BY targets (strings or `{field, dateGranularity?}` objects for date bucketing)'),
  
  /** Having Clause — enforced engine-side after aggregation (#4286 step 3). */
  having: FilterConditionSchema.optional().describe('HAVING — filter over the AGGREGATED rows (aggregation aliases + groupBy projections); applied engine-side after aggregation'),

  /** Window functions — REMOVED from the request surface (#4286); the capability's door is `SqlDriver.findWithWindowFunctions()`. */
  windowFunctions: retiredKey(QUERY_WINDOW_FUNCTIONS_REMOVED),

  /** SELECT DISTINCT — REMOVED (#4286): `groupBy` / `count_distinct` / the drivers' `distinct()` door are the live spellings. */
  distinct: retiredKey(QUERY_DISTINCT_REMOVED),
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

export type SortNode = z.input<typeof SortNodeSchema>;
/** Post-parse shape of {@link SortNode} — defaults applied, transforms run (ADR-0122). */
export type SortNodeParsed = z.infer<typeof SortNodeSchema>;
export type AggregationNode = z.input<typeof AggregationNodeSchema>;
export type GroupByNode = z.input<typeof GroupByNodeSchema>;
export type DateGranularityValue = z.input<typeof DateGranularity>;
export type AggregationFunction = z.input<typeof AggregationFunction>;
// `FieldNode` is declared next to its schema rather than here: since #4196 it
// is no longer recursive, it is just the name the docs and the engine give to
// "one entry of a select list". (`JoinNode` and `WindowFunctionNode`/`WindowSpec`
// used to sit here too — removed with their clusters, #4286.)
