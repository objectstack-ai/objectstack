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
| String | `$icontains` | `LIKE %?%`, case-blind | `{ name: { $icontains: 'john' } }` |
| String | `$like` | `LIKE ?` — caller binds `%` / `_` | `{ code: { $like: 'PRJ-%-26' } }` |
| String | `$ilike` | `$like`, case-blind | `{ code: { $ilike: 'prj-%' } }` |
| Null | `$null` | `IS NULL` / `IS NOT NULL` | `{ deleted_at: { $null: true } }` |
| Null | `$exists` | `IS NOT NULL` / `IS NULL` | `{ metadata: { $exists: true } }` |

**Case sensitivity is part of the contract** (`filter.zod.ts`): "`$contains` /
`$notContains` / `$startsWith` / `$endsWith` compare CASE-SENSITIVELY.
`$icontains` is the case-INSENSITIVE twin" — ASCII folding only, so `café` does
not match `CAFÉ`. Use `$icontains` for anything a human typed. `$like`/`$ilike`
match the WHOLE value, so a pattern with no wildcard is an exact comparison, not
a substring search. Their reach is narrower than the rest of the table: the SQL
family, `driver-memory` and `@objectstack/formula` answer them, while
`driver-mongodb`, objectql `having` and service-analytics each keep an operator
allowlist that omits them and refuse — `Unsupported filter operator`,
`INVALID_FILTER` / 400 — rather than approximating. A pattern ending in a lone
unpaired backslash is refused by every face.

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

> ✅ **Enforced.** `{ $field: '...' }` compares two columns of the same row.
> The in-memory evaluator resolves the reference against the record; the SQL
> driver pushes it down as a column-to-column predicate. Same rows either way.

```typescript
// ✅ Projects that ran over budget
where: {
  actual_cost: { $gt: { $field: 'budget' } }
}
```

Legal in a **comparison** position only. As an `$in` / `$nin` member or a
`$between` endpoint it is refused at parse — no evaluation path resolves a
reference there.

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

### ❌ Wrong: expecting sibling keys to be an OR

`where: { role: 'admin', status: 'active' }` is an AND — sibling keys always
are. For OR, wrap them in a `$or` array (see **Logical Operators** above).

### ❌ Wrong: Using string operators on non-string fields

`{ age: { $contains: '25' } }` — the string operators are declared on strings
only; use the comparison operators for numbers and dates.

### ⚠️ Prefer `$null` to a bare `null` comparand

`where: { deleted_at: null }` works — a bare null lowers to `IS NULL` on both
paths — but it reads as "equals null" and has no `IS NOT NULL` spelling. Write
`{ deleted_at: { $null: true } }` instead; `$null: false` is `IS NOT NULL`.

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
- **Both spellings parse:** `{today}` and `${today}` are the same token
  (`DATE_MACRO_WRAPPED_RE` is `/^\$?\{([a-zA-Z0-9_]+)\}$/`, and the context
  tokens share it).

**Session tokens:** the same value positions accept `{current_user_id}` and
`{current_org_id}` (defined in `data/context-tokens.zod.ts`) — the signed-in
user's id and the active organization id.

```typescript
where: { owner: '{current_user_id}', close_date: { $gte: '{current_year_start}' } }
```

**Scope:** tokens expand on **both** sides of the wire — client-side by
`resolveDateMacros()` / `resolveContextTokens()` in `@object-ui/core`,
server-side by `resolveFilterTokens()` in `@objectstack/core`, wired into the
ObjectQL read AND write paths (`find`/`findOne`/`count`/`aggregate`/`update`/
`delete`) plus the analytics dataset executor. The driver only ever sees ISO
strings and concrete ids. So use tokens in a hand-issued engine query too:
computing "today" at module load freezes the date into the built artifact.

A **flow node's** `config.filter` takes these tokens too. What happens when one
of them drops a condition is a flow rule, not a query rule:
**objectstack-automation** — a dropped condition *widens* the query, so
`get_record` / `update_record` / `delete_record` fail the step instead of
running it.

**Unknown tokens are rejected, not ignored.** A value that is entirely `{...}`
is a placeholder by construction: `objectstack build` fails it (rule
`filter-token-unknown`) and the resolver throws — because an unresolved token
reaches SQL as a **literal**, matches nothing, and renders a widget showing 0,
indistinguishable from "there is no data". Near-misses, not tokens:
`{current_user}` (the RLS expression root), `{this_quarter_start}`, `{user_id}`
(a real `titleFormat` interpolation) and `{organization_id}` (the column name);
the error names the correction. A value that merely *contains* braces is left
untouched — `'user-{current_user_id}'` is a literal. Check a spelling while
authoring with `isDateMacroToken(tok)` / `isContextToken(tok)` from
`@objectstack/spec/data`, passing the token WITHOUT braces.

**`*_end` is a calendar DAY.** `{current_year_end}` is `2026-12-31`, so on a
`datetime` column `<= {current_year_end}` stops at midnight on the 31st. Use
the half-open `< {next_year_start}` for timestamps.
