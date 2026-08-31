---
name: objectstack-query
description: >
  Construct ObjectQL queries — filters, sorting, pagination, aggregation,
  relation expansion, and full-text search. Use when the user is writing a
  query DSL expression, picking pagination strategy, or designing a list
  view's filter spec. Do not use for defining objects / fields /
  relationships (see objectstack-data) or for designing the API endpoint
  that exposes a query (see objectstack-api).
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.3"
  domain: query
  tags: query, filter, sort, paginate, aggregate, ObjectQL, full-text
---

# Query Design — ObjectStack Query DSL

Expert instructions for constructing data queries using the ObjectStack
Query DSL. This skill covers filter expressions, sorting, pagination,
aggregation, full-text search, and the expand system for related records.

**Schema vs. runtime:** every callout below says which side a property is on —
⛔ **REMOVED** (tombstoned; a query carrying it fails to parse), ⚠️ **not
enforced** (validates, then silently ignored — never emit it), ✅ **Enforced**.
Each removal callout names the live replacement.

---

## Skill Boundaries

| Need | Use instead |
|:-----|:------------|
| Define objects, fields, or relationships | **objectstack-data** |
| Define REST API endpoints or auth | **objectstack-api** |
| Build views, dashboards, or apps | **objectstack-ui** |
| Create a plugin or register services | **objectstack-platform** |

---

## When to Use This Skill

- You are constructing a **filter expression** for record retrieval
- You need to **sort or paginate** query results
- You are writing **aggregation queries** (count, sum, avg, group by)
- You need to **expand related records** through lookups
- You are implementing **full-text search** across fields
- You are choosing between **offset vs keyset pagination**

---

## Core Concepts

### Query Structure (QueryAST)

Every ObjectStack query follows the `QuerySchema` structure:

```typescript
{
  object: 'account',           // Target object (required)
  fields: ['name', 'email'],   // SELECT — fields to retrieve
  where: { status: 'active' }, // WHERE — filter conditions
  orderBy: [{ field: 'created_at', order: 'desc' }],  // ORDER BY
  limit: 20,                   // LIMIT — max records
  offset: 0,                   // OFFSET — skip records
}
```

**Key rule:** `object` is the only required property. Everything else is optional.

---

## Quick Reference — Detailed Rules

For comprehensive documentation with incorrect/correct examples:

- **[Filters](./rules/filters.md)** — All operators, logical combinations, nested relations, date macros
- **[Aggregation](./rules/aggregation.md)** — GroupBy, date bucketing, aggregation functions, driver support
- **[Pagination](./rules/pagination.md)** — Offset vs keyset, best practices, performance

---

## Filter Operators

ObjectStack uses a **declarative, database-agnostic** filter DSL inspired by
Prisma, Strapi, and MongoDB.

### Implicit Equality (Shorthand)

The simplest filter — field equals value:

```typescript
{ where: { status: 'active' } }
// SQL: WHERE status = 'active'
```

### Comparison Operators

| Operator | Purpose | SQL Equivalent | Types |
|:---------|:--------|:---------------|:------|
| `$eq` | Equal | `=` | Any |
| `$ne` | Not equal | `<>` | Any |
| `$gt` | Greater than | `>` | Number, Date |
| `$gte` | Greater than or equal | `>=` | Number, Date |
| `$lt` | Less than | `<` | Number, Date |
| `$lte` | Less than or equal | `<=` | Number, Date |

```typescript
{ where: { age: { $gte: 18 } } }
// SQL: WHERE age >= 18

{ where: { created_at: { $gt: '2025-01-01' } } }
// SQL: WHERE created_at > '2025-01-01'
```

### Set & Range Operators

| Operator | Purpose | SQL Equivalent |
|:---------|:--------|:---------------|
| `$in` | In list | `IN (...)` |
| `$nin` | Not in list | `NOT IN (...)` |
| `$between` | Inclusive range | `BETWEEN ? AND ?` |

```typescript
{ where: { status: { $in: ['active', 'pending'] } } }
// SQL: WHERE status IN ('active', 'pending')

{ where: { amount: { $between: [100, 500] } } }
// SQL: WHERE amount BETWEEN 100 AND 500
```

### String Operators

| Operator | Purpose | SQL Equivalent |
|:---------|:--------|:---------------|
| `$contains` | Contains substring | `LIKE '%?%'` |
| `$notContains` | Does not contain | `NOT LIKE '%?%'` |
| `$startsWith` | Starts with prefix | `LIKE '?%'` |
| `$endsWith` | Ends with suffix | `LIKE '%?'` |

```typescript
{ where: { email: { $contains: '@company.com' } } }
// SQL: WHERE email LIKE '%@company.com%'
```

### Null & Existence Operators

| Operator | Purpose | SQL / NoSQL |
|:---------|:--------|:------------|
| `$null` | Is null check | `IS NULL` / `IS NOT NULL` |
| `$exists` | Has a value | `IS NOT NULL` / `IS NULL` |

```typescript
{ where: { deleted_at: { $null: true } } }
// SQL: WHERE deleted_at IS NULL
```

### Logical Operators

Combine conditions with `$and`, `$or`, and `$not`:

```typescript
// OR: active accounts OR accounts with high revenue
{
  where: {
    $or: [
      { status: 'active' },
      { revenue: { $gt: 1000000 } }
    ]
  }
}

// AND + OR combined
{
  where: {
    $and: [
      { type: 'enterprise' },
      { $or: [
        { region: 'us' },
        { region: 'eu' }
      ]}
    ]
  }
}

// NOT: exclude closed accounts
{
  where: {
    $not: { status: 'closed' }
  }
}
```

### Nested Relation Filters

Filter through relationships without an explicit join:

```typescript
// Filter accounts where the related contact has a verified profile
{
  object: 'account',
  where: {
    contact: {                    // Relation field name
      profile: {                  // Nested relation
        verified: true
      }
    }
  }
}
```

### Field References (Cross-Field Comparisons)

> ✅ **Enforced.** A `{ $field: '...' }` comparand compares two columns of the
> same row. The in-memory evaluator resolves the reference against the record;
> `driver-sql` pushes it down as a column-to-column predicate. Same rows.

```typescript
// ✅ Accounts whose actual revenue beat the estimate
{
  where: {
    actual_revenue: { $gt: { $field: 'estimated_revenue' } }
  }
}
```

Legal in a **comparison** position only. As an `$in` / `$nin` member or a
`$between` endpoint it is refused at parse — no evaluation path resolves a
reference there.

---

## Sorting

Sort with `orderBy` — an array of sort nodes:

```typescript
{
  object: 'account',
  orderBy: [
    { field: 'priority', order: 'desc' },
    { field: 'name', order: 'asc' },      // Secondary sort
  ]
}
```

**Rules:**
- Order of array elements defines sort priority
- Default `order` is `'asc'` — you can omit it for ascending sorts
- Sort fields should be indexed for performance (see **objectstack-data** indexing rules)

---

## Pagination

### Offset Pagination (Simple)

```typescript
{
  object: 'account',
  limit: 20,
  offset: 40,   // Skip first 40 records (page 3)
}
```

**When to use:** UI pages, small datasets (<100K records), when you need "jump to page N".

**Pitfall:** Offset pagination degrades on large offsets — the database still scans skipped rows.

### Keyset Pagination (Performant)

> ⛔ **`query.cursor` was REMOVED in `@objectstack/spec` 17.** No
> engine or driver ever read it — a query carrying `cursor` silently returned
> **page 1 forever**. The key is tombstoned (a query carrying it fails to
> parse with the prescription) and `QueryBuilder.cursor()` is gone. Do keyset
> pagination with `where` + `orderBy` + `limit`:

```typescript
// First page
{
  object: 'account',
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20,
}

// Next page — filter past the last record you've seen
{
  object: 'account',
  where: { created_at: { $lt: lastSeenCreatedAt } },
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20,
}
```

**When to use:** Infinite scroll, APIs, large datasets, real-time feeds.

**Rule:** The keyset `where` field must match the `orderBy` field (use a
unique or near-unique column such as `created_at` or `id`) so
`WHERE created_at < ?` picks up exactly where the previous page ended.

### OData Compatibility

`top` is an alias for `limit` (for OData-style APIs):

```typescript
{ object: 'account', top: 50 }
// Equivalent to: { object: 'account', limit: 50 }
```

---

## Aggregation

### Basic Aggregation Functions

| Function | Purpose | SQL |
|:---------|:--------|:----|
| `count` | Count rows | `COUNT(*)` or `COUNT(field)` |
| `sum` | Sum values | `SUM(field)` |
| `avg` | Average | `AVG(field)` |
| `min` | Minimum | `MIN(field)` |
| `max` | Maximum | `MAX(field)` |
| `count_distinct` | Unique count | `COUNT(DISTINCT field)` |

> ✅ **All six are portable.** `count_distinct` lowers to `COUNT(DISTINCT x)`
> on every SQL face and computes identically on the in-memory path, so the
> declared-but-uncompiled set is empty. The per-aggregation `distinct: true`
> flag went the other way — **removed in 17**, refused at parse; the live
> spelling for a deduplicated count is `count_distinct`.

> **Removed in 17.** `array_agg` and `string_agg` left this vocabulary:
> declared but lowered by no SQL backend, so whether they worked depended on
> which driver sat behind the object. Either one is now refused at parse. There
> is no replacement — read the rows with an ordinary `fields` query and shape
> them in the caller, or materialise the roll-up as a stored field.

### GroupBy + Aggregation

```typescript
// Total revenue per region
{
  object: 'deal',
  fields: ['region'],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total_revenue' },
    { function: 'count', alias: 'deal_count' },
  ],
  groupBy: ['region'],
  orderBy: [{ field: 'total_revenue', order: 'desc' }],
}
// SQL: SELECT region, SUM(amount) AS total_revenue, COUNT(*) AS deal_count
//      FROM deal GROUP BY region ORDER BY total_revenue DESC
```

`groupBy` entries can also be structured objects for **date bucketing** —
`{ field: 'closed_at', dateGranularity: 'quarter' }` — see
[Aggregation rules](./rules/aggregation.md) for the full pattern.

### HAVING Clause

> ✅ **Enforced.** The engine applies `having` AFTER aggregation,
> on both the native-driver path and the in-memory fallback. It references
> the **aggregated row's columns** — aggregation aliases and groupBy
> projections — with the ordinary FilterCondition operators plus
> `$and`/`$or`/`$not`. An unknown operator is rejected loudly, never ignored.

```typescript
// ✅ Only regions with more than 100k revenue
const rows = await engine.aggregate('deal', {
  groupBy: ['region'],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total_revenue' },
  ],
  having: { total_revenue: { $gt: 100000 } },
});
```

### Filtered Aggregation

> ✅ **Enforced.** A per-aggregation `filter` scopes that one measure, so a
> total and a conditional count share one call. Any aggregation carrying a
> non-empty `filter` forces the in-memory path — no driver compiles a
> conditional aggregate, and one reached directly refuses `NOT_IMPLEMENTED`;
> unfiltered aggregations keep native push-down.

```typescript
// ✅ Total and conditional counts in ONE call
const [kpis] = await engine.aggregate('order', {
  aggregations: [
    { function: 'count', alias: 'total_orders' },
    { function: 'count', alias: 'high_value_orders',
      filter: { amount: { $gt: 1000 } } },
  ],
});
// An unknown operator inside `filter` refuses INVALID_FILTER/400 — it never
// silently answers the unfiltered number.
```

---

## Expand (Related Records)

Load related records through lookup/master_detail fields:

```typescript
{
  object: 'task',
  fields: ['title', 'status'],
  expand: {
    assignee: {
      object: 'user',
      fields: ['name', 'email'],
    },
    project: {
      object: 'project',
      fields: ['name'],
      expand: {
        org: { object: 'org', fields: ['name'] }  // Nested expand
      }
    }
  }
}
```

**Rules:**
- Max expand depth is **3** by default
- The engine resolves expands via batch `$in` queries (not N+1)
- Keys in `expand` must be lookup or master_detail field names
- Each expand value is a nested `QueryAST`, but the engine applies **select
  (`fields`) and filter (`where`) only** — per-parent `limit` / `offset` /
  `orderBy` are NOT applied on this path. To paginate or sort related
  records, query the related object directly.

---

## Joins

> ⛔ **REMOVED in `@objectstack/spec` 17 (ADR-0049).** `query.joins`
> (and the `JoinNode`/`JoinType`/`JoinStrategy` vocabulary) is gone from the
> `QueryAST` schema — no engine or driver ever consumed it, so it only ever
> declared a capability that did not run. The key is tombstoned: authoring it
> is a `tsc` error, and a query carrying it (even `joins: []`) fails to parse
> with the upgrade prescription. Do not emit `joins`.

**Working alternatives** (both implemented):
- **`expand`** — load related records through lookup / master_detail fields
  (see previous section).
- **Nested relation filters** — filter a parent by conditions on a related
  object without an explicit join:

```typescript
// Orders whose customer is in the US — no join needed
{
  object: 'order',
  fields: ['id', 'amount'],
  where: { customer: { country: 'US' } },
}
```

---

## Full-Text Search

Only the **`query` + `fields`** subset of the search schema executes. The
engine expands the search string into a driver-agnostic filter: each term
becomes an `$or` of `$icontains` predicates (the case-INSENSITIVE twin of the
case-sensitive `$contains`) across the resolved searchable fields, and multiple
whitespace-separated terms are **AND-ed** (every term must hit some field).
`select`/`status` fields match by option *label*, mapped to stored values.

```typescript
{
  object: 'article',
  search: {
    query: 'machine learning',
    fields: ['title', 'content'],
  },
  limit: 10,
}
// Executes as:
// { $and: [
//   { $or: [{ title: { $icontains: 'machine' } }, { content: { $icontains: 'machine' } }] },
//   { $or: [{ title: { $icontains: 'learning' } }, { content: { $icontains: 'learning' } }] },
// ]}
```

Omit `fields` to search the object's declared `searchableFields` (or an
auto-default of name/title + short-text fields), resolved server-side.

`fields` can only **narrow** that set, never widen it: over the REST/protocol
ingress a name outside it is `400 INVALID_FIELD`, not a silent
fall-back to the full scan.

### ⛔ Searching by a related record's title — mirror the value, always

`search` scans **the queried object's own columns**. A dotted path is never a
search target: unlike `fields` (projection) / `sort` / `filters`, the search axis
does not resolve traversal, so `searchFields: ['project_id.name']` is **refused**:

```text
Unknown field 'project_id.name' on object 'task'. '$searchFields' narrows which
columns 'search' scans, so a name the object does not declare cannot narrow
anything — and the engine used to drop it and scan the default columns instead,
answering a NARROWER search with a WIDER one. 'search' scans this object's own
columns; a related record's column cannot be a search target.
```

**This is the one prescription — emit it every time.** Copy the related record's
title into a **stored field on the queried object** and search that field. A task
list searched by project name gets a `project_name` text column on `task`,
maintained on write and listed in `task.searchableFields`:

```typescript
{
  object: 'task',
  search: { query: 'apollo', fields: ['name', 'project_name'] },
  limit: 20,
}
// Expands to a single-table scan — no traversal, every driver:
// { $or: [
//   { name:         { $icontains: 'apollo' } },
//   { project_name: { $icontains: 'apollo' } },
// ]}
```

❌ The mirror must be a **stored** field — a `formula` field is virtual, no
driver materializes a column for it, so a search predicate against one has
nothing to scan. Two guards catch that: lint errors on a virtual
`searchableFields` entry, and the ingress gate refuses one by name. The
trade-off is mirror maintenance — hooks on both write paths (child re-parented,
parent renamed) plus a backfill for rows written around the hooks.

Cross-object search paths are rejected by design, not pending. Modelling side of
this (the field, the hooks, the lint wording): **objectstack-data → Search Fields
(`searchableFields`)**. To *filter* by a related record's column — a different
axis — use a [nested relation filter](#nested-relation-filters); to *display* it,
use [`expand`](#expand-related-records).

> ⚠️ **`[EXPERIMENTAL — not enforced]`:** `fuzzy`, `boost`,
> `operator`, `minScore`, `language`, and `highlight` validate against the
> schema but are never read — their `.describe()` markers now say so. Terms
> are always AND-ed; there is no relevance scoring or highlighting.

---

## Window Functions (Analytics)

> ⛔ **REMOVED from the request surface in `@objectstack/spec` 17.**
> `query.windowFunctions` is gone from the `QueryAST` schema — the engine
> never routed it to any driver, so every OVER clause it declared was
> silently dropped. The key is tombstoned (a query carrying it fails to
> parse with the prescription), and the `WindowFunction`/`WindowSpec`/
> `WindowFunctionNode` exports left with it. Do not emit `windowFunctions`.
> The one live door is the SQL driver's own `findWithWindowFunctions()`
> method (driver-level, its own flat input shape — and even there the
> builder drops the `field` argument, so `lag(revenue)` renders as `LAG()`).

**Working alternatives:**
- **Ranking / top-N per group and running totals:** model them in
  report/dashboard metadata (groupings, measures, `dateGranularity`
  bucketing, `compareTo` for period-over-period) — see **objectstack-ui**.
- **Ad-hoc analysis:** fetch the ordered rows (`orderBy` + `limit`) and
  compute ranks or running sums in application code.

---

## Common Patterns

### Cross-Object Queries: Which Tool to Use?

| Scenario | Use |
|:---------|:----|
| Load lookup fields for display | `expand` |
| Filter parent by child conditions | Nested relation filter |
| **Keyword-search by a related record's title** | **Mirror the title into a stored field on this object and search that** — `search` never traverses (see **Full-Text Search** above) |
| Simple parent→child navigation | `expand` |
| Paginate/sort a parent's related records | Query the related object directly |
| Analytical queries across objects | Report/dashboard metadata, or separate queries combined in app code (`joins` was removed — see above) |

### Pagination Pattern for APIs

```typescript
// Page-based API response
{
  object: 'account',
  where: { status: 'active' },
  fields: ['id', 'name', 'email'],
  orderBy: [{ field: 'name', order: 'asc' }],
  limit: 20,
  offset: (page - 1) * 20,
}
```

### Dashboard Aggregation Pattern

Every KPI on a dashboard shares **one** aggregate call — unconditional
measures plain, conditional ones carrying their own `filter`. `where` scopes
the whole call, so reach for it only when every measure wants the same scope:

```typescript
// KPI dashboard: one call, conditional measures scoped per aggregation
const [kpis] = await engine.aggregate('deal', {
  aggregations: [
    { function: 'count', alias: 'total_deals' },
    { function: 'sum', field: 'amount', alias: 'pipeline_value' },
    { function: 'avg', field: 'amount', alias: 'avg_deal_size' },
    { function: 'count', alias: 'won_deals',
      filter: { stage: 'closed_won' } },
  ],
});
```

---

## CRM Analytics Query Blueprint

Model analytics in dashboard/report metadata rather than hand-written query
code — the renderer issues the queries for you:

| Query Need | Pattern |
|:--|:--|
| KPI widgets | Aggregates (`sum`, `count`, `avg`) over the object, each conditional KPI scoped by the widget/dataset filter. Add `compareTo: { kind: 'previousPeriod' \| 'previousYear' }` on the widget for a one-line period-over-period delta (the bare string form was removed in 17). |
| Time-series chart | Date filters + `dateGranularity: 'day' \| 'week' \| 'month' \| 'quarter' \| 'year'` on the widget's dataset selection for server-side bucketing — never bucket by hand on the client. Pair with `compareTo` for an aligned YoY overlay. |
| Matrix report | Dataset-bound `rows` (down) + `columns` (across) + a `dateGranularity` dimension |
| Funnel summary | Multi-level grouping (`owner -> stage`) + aggregated measures |
| Operational filter | Prefer declarative operators (`$ne`, `$nin`, `$gte`) over hardcoded SQL |

For metadata app development, model analytics in report/dashboard metadata first;
only fall back to custom query code when schema limits require it.

---

## Verify your work

Most queries run at runtime (smoke-test them with `os data query` or a vitest
test), but query *metadata* — list-view filter specs and report/dashboard
datasets — is validated statically. After editing those, run:

```bash
os validate     # schema + CEL predicates + widget/dataset bindings (no artifact)
# or: os build  # the same gates, plus emits dist/
```

A dashboard widget whose `dataset` / `dimensions` / `values` don't resolve fails
here instead of rendering an empty chart (ADR-0021). In a scaffolded project the
gate is `npm run validate`. See objectstack-platform → **Verify your work**.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.

