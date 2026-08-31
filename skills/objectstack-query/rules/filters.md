# Filter Rules

Comprehensive guide for building ObjectStack query filters.

## Operator Reference

| Category | Operator | SQL Equivalent | Example |
|:---------|:---------|:---------------|:--------|
| Equality | `$eq` | `=` | `{ status: { $eq: 'active' } }` |
| Equality | `$ne` | `<>` | `{ status: { $ne: 'deleted' } }` |
| Comparison | `$gt` | `>` | `{ age: { $gt: 18 } }` |
| Comparison | `$gte` | `>=` | `{ amount: { $gte: 100 } }` |
| Comparison | `$lt` | `<` | `{ price: { $lt: 50 } }` |
| Comparison | `$lte` | `<=` | `{ score: { $lte: 100 } }` |
| Set | `$in` | `IN (...)` | `{ status: { $in: ['active', 'pending'] } }` |
| Set | `$nin` | `NOT IN (...)` | `{ role: { $nin: ['guest'] } }` |
| Range | `$between` | `BETWEEN ? AND ?` | `{ age: { $between: [18, 65] } }` |
| String | `$contains` | `LIKE %?%` | `{ name: { $contains: 'john' } }` |
| String | `$notContains` | `NOT LIKE %?%` | `{ email: { $notContains: 'spam' } }` |
| String | `$startsWith` | `LIKE ?%` | `{ code: { $startsWith: 'PRJ-' } }` |
| String | `$endsWith` | `LIKE %?` | `{ file: { $endsWith: '.pdf' } }` |
| Null | `$null` | `IS NULL` / `IS NOT NULL` | `{ deleted_at: { $null: true } }` |
| Null | `$exists` | `IS NOT NULL` / `IS NULL` | `{ metadata: { $exists: true } }` |

## Implicit Equality (Shorthand)

The most common filter — equality — has a shorthand:

```typescript
// ✅ Implicit equality (preferred for simple cases)
where: { status: 'active' }

// ✅ Explicit equality (same result)
where: { status: { $eq: 'active' } }
```

## Logical Operators

### AND (implicit)

All top-level conditions are AND-combined by default:

```typescript
// ✅ Implicit AND — all conditions must match
where: {
  status: 'active',
  role: 'admin',
  age: { $gte: 18 }
}

// ✅ Explicit $and — same result
where: {
  $and: [
    { status: 'active' },
    { role: 'admin' },
    { age: { $gte: 18 } }
  ]
}
```

### OR

```typescript
// ✅ Find admins OR managers
where: {
  $or: [
    { role: 'admin' },
    { role: 'manager' }
  ]
}

// ✅ Equivalent using $in
where: {
  role: { $in: ['admin', 'manager'] }
}
```

### NOT

```typescript
// ✅ Exclude deleted records
where: {
  $not: { status: 'deleted' }
}
```

### Combining Logical Operators

```typescript
// ✅ Active users who are admin OR have high score
where: {
  status: 'active',            // AND
  $or: [
    { role: 'admin' },
    { score: { $gte: 90 } }
  ]
}
```

## Field References

> ⚠️ **`$field` is schema-reserved — NOT executed by the engine yet.** It
> exists only in the filter schema; no engine or driver code interprets it,
> so the `{ $field: '...' }` object binds as a **literal value** and the
> query silently returns zero rows.

```typescript
// ❌ Schema-valid but NOT executed — matches nothing
where: {
  actual_cost: { $gt: { $field: 'budget' } }
}
```

**Working alternatives:**
- Define a **formula field** that computes the cross-field comparison
  (e.g. a boolean `over_budget`), then filter on it:
  `where: { over_budget: true }` (see **objectstack-data**).
- Fetch both fields and compare in **application code**.

## Nested Relation Filters

Filter by a related object's fields:

```typescript
// ✅ Find orders where the customer is in the US
where: {
  customer: {
    country: 'US'
  }
}

// ✅ Deeper nesting
where: {
  customer: {
    organization: {
      industry: 'Technology'
    }
  }
}
```

## Common Mistakes

### ❌ Wrong: Multiple operators on different fields inside $or

```typescript
// ❌ This is an AND, not an OR
where: {
  role: 'admin',
  status: 'active'
}
// Correct only if you want both conditions

// ✅ For OR, wrap in $or array
where: {
  $or: [
    { role: 'admin' },
    { status: 'active' }
  ]
}
```

### ❌ Wrong: Using string operators on non-string fields

```typescript
// ❌ $contains only works on string fields
where: {
  age: { $contains: '25' }  // age is a number
}

// ✅ Use comparison operators for numbers
where: {
  age: { $eq: 25 }
}
```

### ❌ Wrong: Using $between with wrong tuple length

```typescript
// ❌ $between requires exactly [min, max]
where: {
  price: { $between: [10, 50, 100] }
}

// ✅ Correct: exactly two elements
where: {
  price: { $between: [10, 50] }
}
```

### ❌ Wrong: Null check with equality

```typescript
// ❌ Don't use equality to check for null
where: {
  deleted_at: null
}

// ✅ Use $null operator
where: {
  deleted_at: { $null: true }
}
```

## Date Filtering Patterns

For **ad-hoc queries in application code**, compute the date yourself:

```typescript
// Records created in the last 7 days (compute date in application code)
where: {
  created_at: { $gte: new Date('2025-01-01') }
}

// Records within a date range
where: {
  created_at: {
    $between: [new Date('2025-01-01'), new Date('2025-03-31')]
  }
}
```

### Date Macros (declarative filter metadata)

Filters that travel as JSON metadata — list views, dashboards, reports,
pages — cannot run code, so they use **date macro tokens** instead
(defined in `@objectstack/spec` `data/date-macros.zod.ts`):

```typescript
// List-view / dashboard filter values
where: {
  signal_at:    { $gte: '{30_days_ago}' },
  published_at: { $gte: '{last_quarter_start}' }
}
```

- **Fixed tokens:** `{today}`, `{yesterday}`, `{tomorrow}`, `{now}`, plus
  period boundaries like `{current_month_start}`, `{last_quarter_end}`,
  `{next_year_start}` (and bare aliases like `{month_start}`).
- **Parameterised tokens:** `{N_<unit>_ago}` / `{N_<unit>_from_now}` with
  units `minute|hour|day|week|month|year` — e.g. `{30_days_ago}`,
  `{2_weeks_from_now}`.

**Session tokens:** the same value positions accept `{current_user_id}` and
`{current_org_id}` (defined in `data/context-tokens.zod.ts`) — the signed-in
user's id and the active organization id.

```typescript
where: { owner: '{current_user_id}', close_date: { $gte: '{current_year_start}' } }
```

**Scope:** tokens are expanded on **both** sides of the wire, so the same
filter behaves the same wherever it runs — client-side by `resolveDateMacros()`
/ `resolveContextTokens()` in `@object-ui/core`, and server-side by
`resolveFilterTokens()` in `@objectstack/core` (wired into the ObjectQL read
AND write paths — `find`/`findOne`/`count`/`aggregate`/`update`/`delete` — plus
the analytics dataset executor). The driver only ever sees ISO date/timestamp
strings and concrete ids, never `{tokens}`. You may therefore use tokens in a
query issued directly against the engine — and you should: computing "today" at
module load freezes the date into the built artifact.

This includes a **flow node's** `config.filter`. The flow template engine runs
first there, but it hands a recognised filter placeholder through untouched for
the engine to expand. Flow variables still win — `{record.owner}` resolves as
always, and a flow variable named after a placeholder shadows it.

**A flow filter that loses a condition refuses to run.** In a filter, a token
that resolves to nothing does not narrow the query — it removes the condition,
which matches *more* rows, and a `delete_record` with every condition gone
means the whole object. So `get_record` / `update_record` / `delete_record`
fail the step, naming the offending template, rather than executing a widened
query. That covers a mistyped field (`{record.ownr}`), an input the run never
received, and a lookup hop (`{record.account.name}` — the trigger record
carries a scalar id; add the relation to the start node's `config.expand`).

Two of those three are caught earlier: `objectstack validate` **fails** on a
`{record.<path>}` filter token naming an unknown field, or hopping through a
relation the start node does not `expand`, because the runtime has already
committed to refusing that node. The same reference outside a filter — in a
message body, an `http` url, a write payload — stays a warning, since there it
renders a blank rather than widening a query. An unresolved *flow variable*
(`{someInput}`) is not statically checkable and still surfaces at run time.

**Unknown tokens are rejected, not ignored.** `{current_user}` (the RLS
expression root) and `{this_quarter_start}` are near-misses, not tokens:
`objectstack build` fails on them and the runtime resolver throws. A filter
value that is entirely `{...}` is always read as a placeholder, so a literal
value of that shape is not expressible.

**`*_end` is a calendar DAY.** `{current_year_end}` is `2026-12-31`, so on a
`datetime` column `<= {current_year_end}` stops at midnight on the 31st. Use
the half-open `< {next_year_start}` for timestamps.
