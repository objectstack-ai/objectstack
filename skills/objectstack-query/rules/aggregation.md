# Aggregation Rules

Guide for building ObjectStack aggregation queries.

## Aggregation Functions

| Function | SQL Equivalent | Purpose | Requires `field` |
|:---------|:---------------|:--------|:-----------------|
| `count` | `COUNT(*)` / `COUNT(field)` | Count rows | Optional |
| `sum` | `SUM(field)` | Sum numeric values | Yes |
| `avg` | `AVG(field)` | Average numeric values | Yes |
| `min` | `MIN(field)` | Minimum value | Yes |
| `max` | `MAX(field)` | Maximum value | Yes |
| `count_distinct` | `COUNT(DISTINCT field)` | Count unique values | Yes |

> ⚠️ **Driver support varies.** On SQL datasources the driver executes only
> `count` / `sum` / `avg` / `min` / `max` and **throws** (`Unsupported
> aggregate function`) on `count_distinct`; the per-aggregation
> `distinct: true` flag is also ignored there. The in-memory aggregation path
> (driver-rest, driver-memory, timezone/date-bucket fallbacks) supports all six
> functions plus `distinct`. For portable queries, stick to the first five.

> **Removed in 17 (#6188).** `array_agg` and `string_agg` are no longer part of
> the vocabulary — they were declared and lowered by no SQL backend, so a query
> using them succeeded or failed depending on which driver happened to be
> behind the object. A query carrying either is refused at parse. There is no
> replacement: read the rows with an ordinary `fields` query and shape them in
> the caller, or materialise the roll-up as a stored field.

## Basic Aggregation

```typescript
// SQL: SELECT COUNT(*) AS total_orders FROM order
{
  object: 'order',
  aggregations: [
    { function: 'count', alias: 'total_orders' }
  ]
}
```

## Aggregation with GROUP BY

```typescript
// SQL: SELECT region, SUM(amount) AS total, AVG(amount) AS average
//      FROM sale GROUP BY region
{
  object: 'sale',
  fields: ['region'],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total' },
    { function: 'avg', field: 'amount', alias: 'average' }
  ],
  groupBy: ['region']
}
```

Note: you do NOT need to repeat `groupBy` fields in `fields` — drivers
auto-select every grouped field into the result rows. Listing them in
`fields` (as above) is a readability convention, not a requirement.

## Date-Bucketed Grouping (dateGranularity)

`groupBy` entries can be structured objects that bucket a date/timestamp
field into uniform periods — this is the supported way to build time-series
aggregations (never bucket by hand in app code):

```typescript
// Revenue per quarter per region
{
  object: 'deal',
  groupBy: [
    'region',
    { field: 'closed_at', dateGranularity: 'quarter' }
  ],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'revenue' }
  ]
}
// Result rows: { region: 'us', closed_at: '2025-Q1', revenue: 42000 }, ...
```

- Granularities: `day`, `week`, `month`, `quarter`, `year` (weeks are
  ISO-8601, starting Monday).
- Optional `alias` renames the projected group value:
  `{ field: 'closed_at', dateGranularity: 'quarter', alias: 'quarter' }`
  puts the bucket under `quarter` instead of `closed_at`. **The alias renames
  the projected COLUMN only** — grouping still keys on the field, so the buckets
  themselves are unchanged. Read the result under `alias ?? field`, and reference
  that same name from `having`.
- The engine pushes bucketing down to the driver (`DATE_TRUNC` etc.) when
  the dialect supports that granularity, and transparently falls back to
  in-memory bucketing otherwise — results are correct either way, **including
  the column keys** (#6401: until then the SQL drivers ignored `alias`, so an
  aliased group came back under the field name when the query was pushed down
  and under the alias when it fell back — decided by a capability bit and the
  `timezone`, neither of which the caller can see).

## HAVING Clause

> ✅ **Enforced since #4286.** The engine applies `having` AFTER aggregation
> (both the native-driver path and the in-memory fallback), referencing the
> **aggregated row's columns** — aggregation aliases and groupBy projections.
> Ordinary FilterCondition operators plus `$and`/`$or`/`$not`; an unknown
> operator is rejected loudly, never ignored.

```typescript
// ✅ Only customers with more than 5 orders
const rows = await engine.aggregate('order', {
  groupBy: ['customer_id'],
  aggregations: [{ function: 'count', alias: 'order_count' }],
  having: { order_count: { $gt: 5 } },
});
```

`having` filters *groups*; `where` filters the *input rows* before grouping —
use `where` to shrink the scan, `having` to threshold the aggregates.

## Filtered Aggregation (FILTER WHERE)

> ⚠️ **Per-aggregation `filter` is schema-reserved — NOT executed by the
> engine yet.** The SQL driver never reads it and the in-memory path ignores
> it, so the aggregation returns the **unfiltered** number — silently wrong
> results. **Working alternative:** one aggregate call per condition, with
> the condition in the query-level `where`:

```typescript
// ❌ filter on the aggregation is silently ignored — active_count
//    would equal total!
// { function: 'count', alias: 'active_count', filter: { status: 'active' } }

// ✅ Separate aggregate calls, condition in `where`
const [totals] = await engine.aggregate('user', {
  aggregations: [{ function: 'count', alias: 'total' }],
});
const [active] = await engine.aggregate('user', {
  where: { status: 'active' },
  aggregations: [{ function: 'count', alias: 'active_count' }],
});
```

## DISTINCT Aggregation

> ⚠️ **Not available on SQL datasources.** `count_distinct` **throws** on the
> SQL driver, and the `distinct: true` flag is silently ignored there (see
> the driver-support caveat above). Both forms work only on the in-memory
> aggregation path. On SQL, get a distinct count by grouping on the field
> and counting the result rows in app code:
> `(await engine.aggregate('employee', { groupBy: ['department'], aggregations: [{ function: 'count', alias: 'n' }] })).length`.

```typescript
// In-memory drivers only:
// SQL: SELECT COUNT(DISTINCT department) FROM employee
{
  object: 'employee',
  aggregations: [
    { function: 'count_distinct', field: 'department', alias: 'dept_count' }
  ]
}

// Alternative (also in-memory only): use distinct flag
{
  object: 'employee',
  aggregations: [
    { function: 'count', field: 'department', alias: 'dept_count', distinct: true }
  ]
}
```

## Window Functions

> ⛔ **REMOVED in `@objectstack/spec` 17 (#4286, ADR-0049).** The `QueryAST`
> schema no longer declares `windowFunctions` — the engine never routed the
> property to any driver, so it was silently dropped. The key is tombstoned:
> a query carrying it fails to parse with the upgrade prescription. The one
> live door is the SQL driver's own `findWithWindowFunctions()` (driver-level,
> its own flat input shape; even there the builder drops the `field` argument,
> so `lag(revenue)` renders as `LAG()`). Do not emit `windowFunctions` in
> queries.

**Working alternatives:**

### Ranking / Top-N per Group

Model rankings in report/dashboard metadata (groupings + measures + sort),
or fetch the ordered rows and rank in app code:

```typescript
// Top products per category — order the rows, rank in app code
const rows = await engine.find('product', {
  fields: ['name', 'category', 'sales'],
  orderBy: [
    { field: 'category', order: 'asc' },
    { field: 'sales', order: 'desc' },
  ],
});
// Assign category_rank while iterating: reset the counter when category changes.
```

### Running Total

Fetch the ordered rows and accumulate in app code:

```typescript
const txns = await engine.find('transaction', {
  fields: ['date', 'amount'],
  orderBy: [{ field: 'date', order: 'asc' }],
});
let runningTotal = 0;
const withTotals = txns.map((t) => ({ ...t, running_total: (runningTotal += t.amount) }));
```

### Period-over-Period

For dashboard widgets, use the higher-level
`compareTo: { kind: 'previousPeriod' | 'previousYear', dimension? }` field on
the widget schema (see *objectstack-ui* → *Period-over-period — `compareTo`*).
The runtime issues the shifted query for you and aligns the result
bucket-for-bucket with the dataset dimension's `dateGranularity`. For ad-hoc comparisons,
run two date-bucketed aggregations (see *Date-Bucketed Grouping* above)
over the two periods and join the buckets in app code.

## Common Mistakes

### ❌ Wrong: Aggregation without alias

```typescript
// ❌ alias is required
{
  aggregations: [
    { function: 'count' }
  ]
}

// ✅ Always provide alias
{
  aggregations: [
    { function: 'count', alias: 'total' }
  ]
}
```

### ❌ Wrong: Using where to filter aggregated results

```typescript
// ❌ where filters BEFORE aggregation
{
  object: 'order',
  where: { order_count: { $gt: 5 } },  // order_count doesn't exist yet!
  aggregations: [{ function: 'count', alias: 'order_count' }],
  groupBy: ['customer_id']
}

// ✅ Right: `having` references the aggregation ALIAS, after grouping (#4286)
const rows = await engine.aggregate('order', {
  groupBy: ['customer_id'],
  aggregations: [{ function: 'count', alias: 'order_count' }],
  having: { order_count: { $gt: 5 } },
});
```

### ❌ Wrong: sum/avg on non-numeric fields

```typescript
// ❌ Cannot sum a string field
{
  aggregations: [
    { function: 'sum', field: 'name', alias: 'total' }
  ]
}

// ✅ sum/avg only work on numeric fields
{
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total' }
  ]
}
```
