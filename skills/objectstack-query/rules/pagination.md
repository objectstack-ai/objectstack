# Pagination Rules

Guide for implementing pagination in ObjectStack queries.

## Strategies Overview

| Strategy | Best For | Pros | Cons |
|:---------|:---------|:-----|:-----|
| Offset | UI page navigation, small datasets | Simple, random page access | Slow on large offsets, drift on inserts |
| Keyset (manual `where`) | Infinite scroll, real-time feeds | Consistent results, O(1) performance | No random page access |

> ⛔ **The `cursor` query property was REMOVED in `@objectstack/spec`
> 17.** No engine or driver ever read it: a query carrying `cursor`
> silently returned **page 1 forever**. The key is tombstoned — a query
> carrying it fails to parse with the prescription — and
> `QueryBuilder.cursor()` is gone. Implement keyset pagination with a
> `where` filter on the sort key (pattern below).

## Offset Pagination

```typescript
// Page 1 (first 20 records)
{
  object: 'post',
  where: { published: true },
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20,
  offset: 0
}

// Page 3 (records 41–60)
{
  object: 'post',
  where: { published: true },
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20,
  offset: 40
}
```

### OData Compatibility

`top` is an alias for `limit` (for OData-style APIs):

```typescript
// These are equivalent
{ limit: 20 }
{ top: 20 }
```

## Keyset Pagination (Manual)

Keyset pagination uses the last record's sort key value to fetch the next
page. Because the `cursor` property was removed (see above), express the
keyset as a `where` filter on the sort field:

```typescript
// First page
{
  object: 'post',
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20
}

// Next page — filter past the last record's sort key value
{
  object: 'post',
  where: { created_at: { $lt: '2025-01-15T10:30:00Z' } },  // last seen value
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20
}
```

**⚠️ CRITICAL:** The keyset `where` field MUST match the `orderBy` field, and
the comparison direction must match the sort order (`$lt` for `desc`, `$gt`
for `asc`).

```typescript
// ❌ Wrong: keyset filter doesn't match orderBy
{
  where: { name: { $gt: 'John' } },  // name is not the sort key!
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20
}

// ✅ Correct: keyset filter matches the orderBy field and direction
{
  where: { created_at: { $lt: '2025-01-15T10:30:00Z' } },
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20
}
```

Prefer a unique (or near-unique) sort key such as `created_at` or `id`;
duplicate key values can skip or repeat rows at page boundaries.

## Sorting with Pagination

**⚠️ CRITICAL:** Always combine `orderBy` with pagination for stable results.

```typescript
// ❌ Wrong: no orderBy — results are non-deterministic
{
  object: 'user',
  limit: 20,
  offset: 0
}

// ✅ Correct: explicit ordering guarantees stable pages
{
  object: 'user',
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20,
  offset: 0
}
```

### Multi-field Sorting

```typescript
// Sort by status (asc), then by created date (newest first)
{
  object: 'task',
  orderBy: [
    { field: 'status', order: 'asc' },
    { field: 'created_at', order: 'desc' }
  ],
  limit: 50
}
```

## REST API Pagination Pattern

When building paginated REST endpoints:

```typescript
// GET /api/v1/posts?limit=20&offset=40
// Maps to:
{
  object: 'post',
  limit: 20,
  offset: 40,
  orderBy: [{ field: 'created_at', order: 'desc' }]
}

// Response includes pagination metadata
{
  data: [...],
  pagination: {
    total: 150,
    limit: 20,
    offset: 40,
    hasMore: true
  }
}
```

## Common Mistakes

### ❌ Wrong: Using the removed `cursor` property

```typescript
// ❌ cursor was removed in protocol 17 — the tombstone rejects this query outright
{
  object: 'post',
  limit: 20,
  cursor: { created_at: '2025-01-15T10:30:00Z' }
}

// ✅ Express the keyset as a where filter on the sort key
{
  object: 'post',
  where: { created_at: { $lt: '2025-01-15T10:30:00Z' } },
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20
}
```

### ❌ Wrong: Large offset values

```typescript
// ❌ Performance degrades with large offsets (DB must scan & discard rows)
{
  object: 'post',
  limit: 20,
  offset: 100000  // Very slow on large tables
}

// ✅ Use manual keyset pagination for deep pagination
{
  object: 'post',
  where: { created_at: { $lt: '2024-06-01T00:00:00Z' } },
  orderBy: [{ field: 'created_at', order: 'desc' }],
  limit: 20
}
```

### ❌ Wrong: Forgetting limit (unbounded queries)

```typescript
// ❌ No limit — returns ALL records
{
  object: 'user',
  where: { status: 'active' }
}

// ✅ Always set a limit for list queries
{
  object: 'user',
  where: { status: 'active' },
  limit: 100,
  orderBy: [{ field: 'name', order: 'asc' }]
}
```

## DISTINCT Queries

> ⛔ **`query.distinct` was REMOVED in `@objectstack/spec` 17.** No driver ever
> rendered `SELECT DISTINCT`. The key is tombstoned — a query carrying it fails
> to parse with the prescription — and `QueryBuilder.distinct()` is gone. Group
> by the fields instead: each unique combination becomes one result row.

```typescript
// ❌ tombstoned — this query is refused at parse
// { object: 'order', fields: ['customer_id', 'product_category'], distinct: true }

// ✅ groupBy collapses duplicates
const rows = await engine.aggregate('order', {
  groupBy: ['customer_id', 'product_category'],
  aggregations: [{ function: 'count', alias: 'n' }],
});
```
