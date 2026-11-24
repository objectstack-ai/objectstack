# Aggregation Rules

A block pairing ❌ with ✅ is left out of `check:skill-examples`: its ❌ half is wrong on purpose.

Answering a user's question over MCP (`aggregate_records`), not writing a query in code: see **objectstack-ask**.

## Aggregation Functions

| Function | SQL Equivalent | Purpose | Requires `field` |
|:---------|:---------------|:--------|:-----------------|
| `count` | `COUNT(*)` / `COUNT(field)` | Count rows | Optional |
| `sum` | `SUM(field)` | Sum numeric values | Yes |
| `avg` | `AVG(field)` | Average numeric values | Yes |
| `min` | `MIN(field)` | Minimum value | Yes |
| `max` | `MAX(field)` | Maximum value | Yes |
| `count_distinct` | `COUNT(DISTINCT field)` | Count unique values | Yes |

> ✅ **All six are portable.** `count_distinct` lowers to `COUNT(DISTINCT x)`
> on `driver-sql` and turso's remote transport, and `driver-mongodb` /
> `driver-memory` compute it too, so the declared-but-uncompiled set is empty.
> `distinct: true`, `array_agg` and `string_agg` are removed keys — see the
> removal table in `SKILL.md`.

## Basic Aggregation

<!-- os:check -->
```typescript
import type { QueryInput } from '@objectstack/spec/data';
// SQL: SELECT COUNT(*) AS total_orders FROM order
const query: QueryInput = {
  object: 'order',
  aggregations: [
    { function: 'count', alias: 'total_orders' }
  ]
};
```

## Aggregation with GROUP BY

<!-- os:check -->
```typescript
import type { IDataEngine } from '@objectstack/spec/contracts';
declare const engine: IDataEngine;
// SQL: SELECT region, SUM(amount) AS total, AVG(amount) AS average
//      FROM sale GROUP BY region
const rows = await engine.aggregate('sale', {
  groupBy: ['region'],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'total' },
    { function: 'avg', field: 'amount', alias: 'average' },
  ],
});
```

Never list the grouped fields in `fields`: drivers auto-select every grouped
field into the result rows, and `fields` is not one of the keys
`engine.aggregate()` accepts — it is rejected by name (see the calling
convention in `SKILL.md`).

## Date-Bucketed Grouping (dateGranularity)

`groupBy` entries can be structured objects that bucket a date/timestamp
field into uniform periods — this is the supported way to build time-series
aggregations (never bucket by hand in app code):

<!-- os:check -->
```typescript
import type { QueryInput } from '@objectstack/spec/data';
// Revenue per quarter per region
const query: QueryInput = {
  object: 'deal',
  groupBy: [
    'region',
    { field: 'closed_at', dateGranularity: 'quarter' }
  ],
  aggregations: [
    { function: 'sum', field: 'amount', alias: 'revenue' }
  ]
};
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
- The engine pushes bucketing down to the driver (`to_char` / `date_format` /
  `strftime` / `$dateToString`, never `date_trunc`) when the dialect supports
  that granularity, and transparently falls back to in-memory bucketing
  otherwise — results are correct either way, **including the column keys**.

## HAVING Clause

> ✅ **Enforced.** The engine applies `having` AFTER aggregation
> (both the native-driver path and the in-memory fallback), referencing the
> **aggregated row's columns** — aggregation aliases and groupBy projections.
> Ordinary FilterCondition operators plus `$and`/`$or`/`$not`; an unknown
> operator is rejected loudly, never ignored.

<!-- os:check -->
```typescript
import type { IDataEngine } from '@objectstack/spec/contracts';
declare const engine: IDataEngine;
// ✅ Only customers with more than 5 orders
const rows = await engine.aggregate('order', {
  groupBy: ['customer_id'],
  aggregations: [{ function: 'count', alias: 'order_count' }],
  having: { order_count: { $gt: 5 } },
});
```

`having` filters *groups*; `where` filters the *input rows* before grouping —
use `where` to shrink the scan, `having` to threshold the aggregates. `avg` /
`min` / `max` over no values is `null`, and no value fails every ordering test
([filter rules](./filters.md)): `having: { average: { $lte: 0 } }` drops it.

## Filtered Aggregation (FILTER WHERE)

> ✅ **Enforced.** A per-aggregation `filter` scopes that one measure, so a
> total and a conditional count share ONE call. A driver that declares
> `supports.aggregationFilter` (`driver-sql`; `driver-turso` outside remote
> mode) runs it in the database whenever the aggregate itself is pushed down
> (a date bucket the driver does not bucket natively keeps the whole call in
> memory; so does one under a non-UTC `timezone`, unless the driver declares
> `supports.zonedDateBucketing` — PostgreSQL via `driver-sql` — and the zone
> resolves to an area/location: `Asia/Taipei` buckets in the database,
> `+08:00` or `EST5EDT` never), compiled as that datasource's
> `where` is: it answers what the same condition answers there (text by the
> database collation) and is refused where it is — a `{ $field }` comparison on
> a column the object does not declare, `INVALID_FILTER` / 400. On any other driver the
> engine reads the scoped rows and evaluates the filter itself. A column with
> no value fails its ordering tests either way ([filter rules](./filters.md)).

<!-- os:check -->
```typescript
import type { IDataEngine } from '@objectstack/spec/contracts';
declare const engine: IDataEngine;
// ✅ Total and conditional count in one call
const [row] = await engine.aggregate('user', {
  aggregations: [
    { function: 'count', alias: 'total' },
    { function: 'count', alias: 'active_count', filter: { status: 'active' } },
  ],
});
// An unknown operator inside `filter` refuses INVALID_FILTER/400 — it never
// silently answers the unfiltered number.
```

## DISTINCT Aggregation

> ✅ **`count_distinct` runs everywhere** — `COUNT(DISTINCT field)` on the SQL
> faces, the same answer in memory. `field` is REQUIRED; there is no
> `COUNT(DISTINCT *)`. The per-aggregation `distinct: true` flag is NOT its
> equivalent — it is a removed key.

<!-- os:check -->
```typescript
import type { QueryInput } from '@objectstack/spec/data';
// SQL: SELECT COUNT(DISTINCT department) FROM employee
const query: QueryInput = {
  object: 'employee',
  aggregations: [
    { function: 'count_distinct', field: 'department', alias: 'dept_count' }
  ]
};
```

## Window Functions

`windowFunctions` is a removed key (see the removal table in `SKILL.md`). Two
working alternatives:

### Ranking / Top-N per Group

Model rankings in report/dashboard metadata (groupings + measures + sort),
or fetch the ordered rows and rank in app code:

<!-- os:check -->
```typescript
import type { IDataEngine } from '@objectstack/spec/contracts';
declare const engine: IDataEngine;
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

<!-- os:check -->
```typescript
import type { IDataEngine } from '@objectstack/spec/contracts';
declare const engine: IDataEngine;
const txns = await engine.find('transaction', {
  fields: ['date', 'amount'],
  orderBy: [{ field: 'date', order: 'asc' }],
});
let runningTotal = 0;
const withTotals = txns.map((t) => ({ ...t, running_total: (runningTotal += t.amount) }));
```

### Period-over-Period

Dashboard widgets declare it: **objectstack-ui → Period-over-period —
`compareTo`**. For ad-hoc comparisons, run two date-bucketed aggregations (see
*Date-Bucketed Grouping* above) over the two periods and join the buckets in
app code.

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

// ✅ Right: `having` references the aggregation ALIAS, after grouping
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
