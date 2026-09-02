---
name: objectstack-query
description: >
  Construct ObjectQL queries — filters, sorting, pagination, aggregation,
  relation expansion, and full-text search. Use when the user is writing a
  query DSL expression or picking a pagination strategy. Do not use for
  defining objects / fields / relationships (see objectstack-data), for
  designing the API endpoint that exposes a query (see objectstack-api), or
  for a list view's filter rules / dashboard datasets (see objectstack-ui).
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.4"
  domain: query
  tags: query, filter, sort, paginate, aggregate, ObjectQL, full-text
---

# Query Design — ObjectStack Query DSL

## Calling Convention — `object` is the FIRST ARGUMENT

| Surface | Shape | Legal option keys |
|:--|:--|:--|
| engine `find` / `findOne` | `engine.find('task', {…}, { context })` | `context`, `where`, `fields`, `orderBy`, `limit`, `offset`, `search`, `searchFields`, `expand` |
| engine `aggregate` | `engine.aggregate('deal', {…})` | `context`, `where`, `groupBy`, `aggregations`, `having`, `timezone` |
| engine `count` | `engine.count('task', {…})` | `context`, `where` |
| protocol / REST | `findData({ object: 'task', query: {…} })` | `object` sits OUTSIDE the query |
| nested `expand` value | a `QueryAST` — `{ object, fields, where }` | (see **Expand**) |

`ENGINE_FIND_OPTION_KEYS` / `ENGINE_AGGREGATE_OPTION_KEYS` are **closed sets**:
an unlisted key is refused by name (`find('task') does not recognise option
'bogus'`), never ignored. A standalone `{ object: 'account', limit: 20 }` literal
is therefore a **`QueryAST`** — legal as `findData`'s `query` or an `expand`
value — not an engine option bag. `top` folds to `limit`, `filter` to `where`,
before that check.

### Which filter dialect?

| Writing… | Dialect | Owner |
|:--|:--|:--|
| an ObjectQL `where` | the `$` operators below | this skill |
| a list view / nav-item `filter` | `[{ field, operator, value }]` over the 20-operator `VIEW_FILTER_OPERATORS` enum (`equals`, `icontains`, `is_null`, `before`, `between`, …) — unknown operators are refused at parse | **objectstack-ui** |
| a dataset measure `filter` | the measure's own filter | **objectstack-ui** |

## Execution Context (`context`)

The RLS / system-read escape hatch. A hook, job or endpoint that reads without
one runs as whatever identity the caller carried — org-scoping hooks then return
**fewer rows**, indistinguishable from "there is no data".

```typescript
const SYS = { isSystem: true } as const;
const [row] = await engine.find('project', { where: { name }, limit: 1, context: SYS });
```

Pass any SUBSET of the execution envelope (identity, tenant, transaction):
`{ isSystem: true }` for a system read, `{ flowRunId }` for provenance alone. On
the READ methods it may sit in the query bag (above) OR in the trailing options
argument, `engine.find(obj, query, { context })`; the trailing one wins when
both are given. Writes take only the trailing argument.

## Removed Keys → Live Replacement

| Removed key | Live replacement |
|:--|:--|
| `query.cursor` | keyset paging — `where` on the sort key + `orderBy` + `limit` |
| `query.joins` | `expand`, or a nested relation filter |
| `query.distinct` | `groupBy` the fields — each unique combination is one row |
| `query.windowFunctions` | report/dashboard metadata (**objectstack-ui**), or rank / accumulate in app code |
| aggregation `distinct: true` | `count_distinct` |
| aggregation `array_agg` / `string_agg` | none — read the rows with `fields` and shape them in the caller, or materialise the roll-up as a stored field |

All six are tombstoned in `@objectstack/spec` 17: `tsc` types them `never`, and a
query carrying one fails to parse with the upgrade prescription. The retirement
procedure and the full tombstone register are **objectstack-upgrade**.

## Quick Reference — Detailed Rules

- **[Filters](./rules/filters.md)** — all operators, logical combinations, nested relations, date macros and session tokens
- **[Aggregation](./rules/aggregation.md)** — groupBy, date bucketing, functions, `having`, per-measure `filter`
- **[Pagination](./rules/pagination.md)** — offset vs keyset, best practices, performance

## Filter Operators

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
```

### Set & Range Operators

| Operator | Purpose | SQL Equivalent |
|:---------|:--------|:---------------|
| `$in` | In list | `IN (...)` |
| `$nin` | Not in list | `NOT IN (...)` |
| `$between` | Inclusive range | `BETWEEN ? AND ?` |

```typescript
{ where: { status: { $in: ['active', 'pending'] } } }
{ where: { amount: { $between: [100, 500] } } }
```

### String Operators

| Operator | Purpose | SQL Equivalent |
|:---------|:--------|:---------------|
| `$contains` | Contains substring | `LIKE '%?%'` |
| `$notContains` | Does not contain | `NOT LIKE '%?%'` |
| `$startsWith` | Starts with prefix | `LIKE '?%'` |
| `$endsWith` | Ends with suffix | `LIKE '%?'` |
| `$icontains` | Contains, case-blind | `LIKE '%?%'` folded |
| `$like` | Whole-value pattern, caller binds `%` / `_` | `LIKE ?` |
| `$ilike` | `$like`, case-blind | `ILIKE ?` |

`$contains` / `$notContains` / `$startsWith` / `$endsWith` compare
**CASE-SENSITIVELY**; `$icontains` is the case-INSENSITIVE twin (ASCII folding
only). So the user-facing cases want `$icontains`:

```typescript
{ where: { email: { $icontains: '@company.com' } } }
```

Full table, `$like` portability and the `$ilike` boundary: **[filter rules](./rules/filters.md)**.

### Null & Existence Operators

| Operator | Purpose | SQL / NoSQL |
|:---------|:--------|:------------|
| `$null` | Is null check | `IS NULL` / `IS NOT NULL` |
| `$exists` | Has a value | `IS NOT NULL` / `IS NULL` |

```typescript
{ where: { deleted_at: { $null: true } } }
```

### Logical Operators

Combine conditions with `$and`, `$or`, and `$not`:

```typescript
// OR: active accounts OR accounts with high revenue
{ where: { $or: [{ status: 'active' }, { revenue: { $gt: 1000000 } }] } }

// AND + OR combined
{
  where: {
    $and: [
      { type: 'enterprise' },
      { $or: [{ region: 'us' }, { region: 'eu' }] },
    ]
  }
}

// NOT: exclude closed accounts
{ where: { $not: { status: 'closed' } } }
```

### Nested Relation Filters

Filter through relationships without an explicit join:

```typescript
// Accounts whose related contact has a verified profile
{ object: 'account', where: { contact: { profile: { verified: true } } } }
```

### Cross-field comparisons

`{ $field: '...' }` compares two columns of the same row, in a **comparison**
position only — see **[filter rules → Field References](./rules/filters.md)**.

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

## Pagination

```typescript
// Offset paging — page 3
{ object: 'account', limit: 20, offset: 40 }
```

**When to use:** UI pages, small datasets, "jump to page N". It degrades on
large offsets — the database still scans the skipped rows.

For **keyset** paging (infinite scroll, APIs, large datasets, real-time feeds),
filter past the last row you saw with a `where` on the sort key, and always
`orderBy` that same field in that same direction — the pattern, the direction
rule and the pitfalls are **[pagination rules](./rules/pagination.md)**.

## Aggregation

The six functions (`count`, `sum`, `avg`, `min`, `max`, `count_distinct`), date
bucketing, `having`, and the per-measure `filter` are
**[aggregation rules](./rules/aggregation.md)**. The call shape:

```typescript
// Total revenue per region
const rows = await engine.aggregate('deal', {
  groupBy: ['region'],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total_revenue' },
    { function: 'count', alias: 'deal_count' },
  ],
});
// SQL: SELECT region, SUM(amount) AS total_revenue, COUNT(*) AS deal_count
//      FROM deal GROUP BY region
```

`fields` and `orderBy` are NOT in `ENGINE_AGGREGATE_OPTION_KEYS` — do not put
them in an `aggregate` bag. Grouped fields are auto-selected into the result
rows; read each measure under its `alias`, and reference that same name from
`having`. `groupBy` entries may be objects for date bucketing —
`{ field: 'closed_at', dateGranularity: 'quarter' }`.

## Expand (Related Records)

Load related records through lookup / master_detail fields. **Keep the foreign
key in `fields`** — the relation is carried by that column:

```typescript
const tasks = await engine.find('task', {
  fields: ['title', 'status', 'assignee', 'project'],   // the FK columns stay
  expand: {
    assignee: { object: 'user', fields: ['name', 'email'] },
    project: {
      object: 'project',
      fields: ['name'],
      expand: { org: { object: 'org', fields: ['name'] } },   // nested expand
    },
  },
});
```

**Rules:**
- **The projection must RETAIN the foreign-key column.** `fields: ['title']`
  with `expand: { project: … }` resolves **nothing**: the engine reads the FK
  off each record and skips the relation when it is absent, so the call returns
  rows with no related data and no error.
- Max expand depth is **3** by default
- The engine resolves expands via batch `$in` queries (not N+1)
- Keys in `expand` must be lookup or master_detail field names
- Each expand value is a nested `QueryAST`, but the engine applies **select
  (`fields`) and filter (`where`) only** — per-parent `limit` / `offset` /
  `orderBy` are NOT applied on this path. To paginate or sort related
  records, query the related object directly.

## Full-Text Search

The canonical form is a **bare string** with a sibling `searchFields`:

```typescript
const rows = await engine.find('article', {
  search: 'machine learning',
  searchFields: ['title', 'content'],
  limit: 10,
});
// Executes as:
// { $and: [
//   { $or: [{ title: { $icontains: 'machine' } }, { content: { $icontains: 'machine' } }] },
//   { $or: [{ title: { $icontains: 'learning' } }, { content: { $icontains: 'learning' } }] },
// ]}
```

Each term becomes an `$or` of `$icontains` predicates across the resolved
searchable fields, and whitespace-separated terms are **AND-ed** (every term
must hit some field). `select`/`status` fields match by option *label*, mapped
to stored values.

**One knob, three spellings:** emit `searchFields` (the engine option). The
protocol normalizes `$searchFields` onto it, and the object form
`search: { query, fields }` spells the same narrowing `fields`.

Omit it to search the object's declared `searchableFields` (or an auto-default
of name/title + short-text fields), resolved server-side. It can only **narrow**
that set, never widen it: over the REST/protocol ingress a name outside it is
`400 INVALID_FIELD`, not a silent fall-back to a full scan. The object form
`search: { query, fields }` stays available for the Tier-2 knobs below.

> ⚠️ **Validates, then silently ignored — never emit these.** `fuzzy`, `boost`,
> `operator`, `minScore`, `language` and `highlight` are the whole set; their
> `.describe()` markers say so. Terms are always AND-ed; there is no relevance
> scoring or highlighting.

**`search` never traverses.** A dotted path is refused —
`searchFields: ['project_id.name']` names a column `task` does not declare.
Mirror the related record's title into a **stored** field on the queried object
and search that; the field, the write hooks and the lint wording are
**objectstack-data → Search Fields (`searchableFields`)**. To *filter* by a
related record's column use a nested relation filter; to *display* it, `expand`.

## Common Patterns

### Cross-Object Queries: Which Tool to Use?

| Scenario | Use |
|:---------|:----|
| Load lookup fields for display | `expand` |
| Filter parent by child conditions | Nested relation filter |
| **Keyword-search by a related record's title** | **Mirror the title into a stored field on this object and search that** — `search` never traverses |
| Paginate/sort a parent's related records | Query the related object directly |
| Analytical queries across objects | Report/dashboard metadata, or separate queries combined in app code |

### Pagination Pattern for APIs

```typescript
const page = await engine.find('account', {
  where: { status: 'active' },
  fields: ['id', 'name', 'email'],
  orderBy: [{ field: 'name', order: 'asc' }],
  limit: 20,
  offset: (pageNumber - 1) * 20,
});
```

### Dashboard Aggregation Pattern

Every KPI on a dashboard shares **one** aggregate call — unconditional measures
plain, conditional ones carrying their own `filter`. `where` scopes the whole
call, so reach for it only when every measure wants the same scope:

```typescript
const [kpis] = await engine.aggregate('deal', {
  aggregations: [
    { function: 'count', alias: 'total_deals' },
    { function: 'sum', field: 'amount', alias: 'pipeline_value' },
    { function: 'avg', field: 'amount', alias: 'avg_deal_size' },
    { function: 'count', alias: 'won_deals', filter: { stage: 'closed_won' } },
  ],
});
```

Dashboards and reports themselves — KPI widgets, `compareTo`, `dateGranularity`
bucketing, matrix rows/columns — are metadata, not hand-written queries: model
them in **objectstack-ui** and the renderer issues the queries.

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

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.
