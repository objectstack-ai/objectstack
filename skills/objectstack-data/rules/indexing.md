# Index Strategy

Guide for creating efficient database indexes in ObjectStack.

## Default Behavior

ObjectStack automatically creates indexes for:
- Primary keys (`id`)
- Foreign keys (lookup/master_detail fields)
- Unique constraints

**Only declare non-default values.** `type` defaults to `'btree'` and `unique` defaults to `false` — omit them when using defaults.

## Index Types

| Type | Default? | When to Use | Performance |
|:-----|:---------|:------------|:------------|
| `btree` | ✅ Yes | Equality and range queries (`=`, `<`, `>`, `BETWEEN`) | Excellent |
| `hash` | No | Exact equality only (`=`) — rare use case | Fast for `=`, poor for ranges |
| `fulltext` | No | Text search columns (descriptions, notes) | Text search only |
| `gin` | No | Array / JSONB containment, full-text search | JSONB, arrays, tags |
| `gist` | No | Geospatial / range types | Location, geometry |

## Syntax

```typescript
indexes: [
  { fields: ['status', 'created_at'] },                // btree (default)
  { fields: ['email'], unique: 'organization' },       // btree + unique per org
  { fields: ['hostname'], unique: 'global' },          // btree + unique platform-wide
  { fields: ['description'], type: 'fulltext' },       // non-default type
  { fields: ['tags'], type: 'gin' },                   // non-default type
  { fields: ['location'], type: 'gist' },              // non-default type
]
```

## Unique scope — always state it (ADR-0120)

A unique index must say **which boundary** the value is unique within. There are
exactly two, and the same words work on a field and on a declared index:

| Scope | Meaning | Materializes as |
|-------|---------|-----------------|
| `unique: 'organization'` | One holder **per organization** | `(COALESCE(organization_id, '__global__'), …fields)` |
| `unique: 'global'` | One holder across the **whole installation** | exactly the listed columns |

```typescript
// ✅ per organization — do NOT list organization_id yourself
{ fields: ['department', 'code'], unique: 'organization' }

// ✅ platform-wide — a hostname, an external id, an engine dedup key
{ fields: ['source', 'dedup_key'], unique: 'global' }

// ❌ scope unstated — this is the DEPRECATED spelling of 'global'.
//    It reads like "per organization" and does the opposite.
//    `os lint` reports unique/unscoped-declared-index; protocol 18 rejects it.
{ fields: ['code'], unique: true }
```

Notes an author has to know:

- **`'organization'` is NULL-safe.** Rows with no organization — and *every* row
  on a single-organization deployment — form one platform bucket that is unique
  among itself. A plain `(organization_id, x)` composite enforces nothing there,
  because SQL `UNIQUE` treats every `NULL` as distinct.
- **On a FIELD, `unique: true` means `'organization'`** and stays valid forever;
  `'organization'` is just the preferred spelling in new code. Only on a
  *declared index* is bare `true` deprecated.
- **You never write the posture.** The same declaration is correct under every
  tenancy posture — state the business boundary, not the deployment shape.
- **`'tenant'` and `'org'` are rejected.** The word is `'organization'`.

## When to Add Indexes

### ✅ Always Index

1. **Foreign keys** — Automatic, but verify
2. **Filter fields** — Columns used in WHERE clauses
3. **Sort fields** — Columns used in ORDER BY
4. **Unique constraints** — Enforce uniqueness at DB level
5. **Composite filters** — Fields commonly filtered together

### ⚠️ Consider Indexing

1. **Join columns** — Non-foreign-key join fields
2. **Frequent aggregations** — GROUP BY columns
3. **Range queries** — Date ranges, numeric ranges
4. **Partial data** — Use partial indexes for subset queries

### ❌ Avoid Indexing

1. **Low cardinality** — Boolean fields (unless combined with others)
2. **Rarely queried** — Fields almost never filtered/sorted
3. **High write volume** — Every insert/update maintains indexes
4. **Large text** — Full-text index only when needed
5. **Calculated fields** — Index source fields instead

## Examples

### Composite Index (Multi-Column)

```typescript
indexes: [
  // Most specific first (status), then sort key
  { fields: ['status', 'created_at'] },

  // Can satisfy queries like:
  // - WHERE status = 'active'
  // - WHERE status = 'active' ORDER BY created_at DESC
  // - WHERE status = 'active' AND created_at > '2026-01-01'
]
```

### Unique Index

```typescript
indexes: [
  // Single column, one holder per organization
  { fields: ['email'], unique: 'organization' },

  // Composite, one holder per organization — the organization key part is
  // supplied by the driver; do not list organization_id yourself
  { fields: ['department', 'username'], unique: 'organization' },

  // Single column, one holder across the whole installation
  { fields: ['hostname'], unique: 'global' },
]
```

### Partial Index

```typescript
indexes: [
  // Only index active records
  {
    fields: ['created_at'],
    partial: "status = 'active'",
  },

  // Only index non-deleted records
  {
    fields: ['email'],
    unique: 'organization',
    partial: "deleted_at IS NULL",
  },
]
```

### Full-Text Index

```typescript
indexes: [
  {
    fields: ['description', 'notes'],
    type: 'fulltext',
  },
]
```

### GIN Index (JSONB/Array)

```typescript
indexes: [
  // JSONB field
  {
    fields: ['metadata'],
    type: 'gin',
  },

  // Array field
  {
    fields: ['tags'],
    type: 'gin',
  },
]
```

### Geospatial Index (GIST)

```typescript
indexes: [
  {
    fields: ['location'],
    type: 'gist',
  },
]
```

## Incorrect vs Correct

### ❌ Incorrect — Redundant Default Values

```typescript
indexes: [
  { fields: ['status'], type: 'btree', unique: false },  // ❌ Redundant defaults
  { fields: ['email'], type: 'btree', unique: 'organization' },  // ❌ Redundant type
]
```

### ✅ Correct — Omit Defaults

```typescript
indexes: [
  { fields: ['status'] },               // ✅ btree and unique: false are defaults
  { fields: ['email'], unique: 'organization' },  // ✅ btree is default; the scope is required
]
```

### ❌ Incorrect — Over-Indexing

```typescript
indexes: [
  { fields: ['is_active'] },        // ❌ Boolean, low cardinality
  { fields: ['is_deleted'] },       // ❌ Boolean, low cardinality
  { fields: ['is_verified'] },      // ❌ Boolean, low cardinality
  { fields: ['status'] },           // ❌ Already indexed elsewhere
  { fields: ['created_at'] },       // ❌ Already indexed elsewhere
]
```

### ✅ Correct — Strategic Indexing

```typescript
indexes: [
  // Composite for common query pattern
  { fields: ['is_active', 'created_at'] },

  // Single index covers multiple queries
  { fields: ['status', 'priority'] },
]
```

### ❌ Incorrect — Wrong Order in Composite

```typescript
indexes: [
  // Querying by created_at with status filter
  { fields: ['created_at', 'status'] },  // ❌ Wrong order
]
```

### ✅ Correct — Most Selective First

```typescript
indexes: [
  // Status is more selective (filters more), goes first
  { fields: ['status', 'created_at'] },  // ✅ Correct order
]
```

## Composite Index Strategy

### Order Matters

```typescript
// Index: ['status', 'priority', 'created_at']

// ✅ Can use index
WHERE status = 'active'
WHERE status = 'active' AND priority = 'high'
WHERE status = 'active' AND priority = 'high' ORDER BY created_at

// ❌ Cannot use index efficiently
WHERE priority = 'high'  // Skips first column
WHERE created_at > '2026-01-01'  // Skips first two columns
```

### Left-to-Right Rule

Composite indexes are used **left-to-right**. Querying only the second or third column doesn't use the index.

### Selectivity Rule

Place most **selective** (unique) fields first, then range/sort fields last.

```typescript
// Good order: selective → range
{ fields: ['tenant_id', 'status', 'created_at'] }

// Bad order: range → selective
{ fields: ['created_at', 'status', 'tenant_id'] }
```

## Partial Indexes

Use partial indexes to index only a subset of rows:

```typescript
// Only index active records (common query)
{
  fields: ['created_at'],
  partial: "status = 'active'",
}

// Only index high-value accounts
{
  fields: ['annual_revenue'],
  partial: "annual_revenue > 1000000",
}

// Only index non-deleted records
{
  fields: ['email'],
  unique: 'organization',
  partial: "deleted_at IS NULL",
}
```

**Benefits:**
- Smaller index size
- Faster writes (fewer rows to maintain)
- Faster queries (focused data subset)

## Performance Trade-offs

### Index Benefits
- ✅ Faster SELECT queries
- ✅ Faster ORDER BY operations
- ✅ Faster JOIN operations
- ✅ Enforce uniqueness at DB level

### Index Costs
- ❌ Slower INSERT/UPDATE/DELETE (index maintenance)
- ❌ Increased storage (each index duplicates data)
- ❌ Query planner overhead (more indexes = more choices)

### General Guidelines

| Table Size | Max Indexes | Reasoning |
|:-----------|:------------|:----------|
| < 1K rows | 2-3 | Low volume, indexes may not help |
| 1K - 100K rows | 3-5 | Balance read/write performance |
| 100K - 1M rows | 5-8 | Read optimization critical |
| > 1M rows | 8-12 | Consider partitioning + indexes |

## Index Naming Convention

ObjectStack auto-generates index names. To specify custom names:

```typescript
{
  name: 'idx_account_status_created',  // Custom name
  fields: ['status', 'created_at'],
}
```

**Auto-generated pattern:** `idx_{object}_{field1}_{field2}_{...}`

## Monitoring Index Usage

Use database tools to monitor index usage:

```sql
-- PostgreSQL: Find unused indexes
SELECT
  schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY schemaname, tablename;

-- MySQL: Check index cardinality
SHOW INDEX FROM your_table;
```

## Best Practices

1. **Index foreign keys** — Always (automatic in ObjectStack)
2. **Composite for common queries** — Combine frequently filtered columns
3. **Order matters** — Most selective field first
4. **Partial for subsets** — Index only relevant rows
5. **Unique for constraints** — Enforce at DB level
6. **Monitor usage** — Remove unused indexes
7. **Limit total indexes** — Balance read/write performance
8. **Avoid over-indexing** — More indexes ≠ better performance
9. **Test with production data** — Index effectiveness depends on data volume
10. **Use EXPLAIN** — Verify query plans before deploying indexes

## Common Query Patterns

### Filter by Status + Sort by Date

```typescript
// Query: WHERE status = 'active' ORDER BY created_at DESC LIMIT 50
indexes: [
  { fields: ['status', 'created_at'] },
]
```

### Multi-Tenant Queries

```typescript
// Query: WHERE tenant_id = X AND ...
indexes: [
  { fields: ['tenant_id', 'status', 'created_at'] },
]
```

### Text Search

```typescript
// Query: WHERE description ILIKE '%keyword%'
indexes: [
  { fields: ['description'], type: 'fulltext' },
]
```

### Array/JSONB Containment

```typescript
// Query: WHERE tags @> ['urgent']
indexes: [
  { fields: ['tags'], type: 'gin' },
]
```

### Location-Based Queries

```typescript
// Query: WHERE ST_DWithin(location, point, distance)
indexes: [
  { fields: ['location'], type: 'gist' },
]
```
