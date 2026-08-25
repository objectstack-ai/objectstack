# Index Strategy

Guide for creating efficient database indexes in ObjectStack.

## Default Behavior

ObjectStack automatically creates indexes for:
- Primary keys (`id`)
- Foreign keys (lookup/master_detail fields)
- Unique constraints

**Only declare non-default values.** `unique` defaults to `false` — omit it when using the default.

## The declaration surface is exactly three keys

A declared index has `name`, `fields` and `unique`. That is the whole surface,
and it is the whole surface *because* it is all the driver materializes:
`syncDeclaredIndexes` creates every declared index through knex's
`table.index(fields, name)` / `table.unique(fields, { indexName })`.

| Key | Required | Meaning |
|:----|:---------|:--------|
| `fields` | ✅ | The indexed columns, in order (left-to-right rule below) |
| `unique` | optional | Uniqueness **and its scope** — see ADR-0120 section below |
| `name` | optional | Custom index name; auto-generated when omitted |

> **Retired at protocol 17: `type` and `partial`.** Both were
> authorable and neither was ever read by any driver — an authored `type`
> selected no access method, and an authored `partial` produced a **full**
> index with the predicate silently discarded. Writing either is now a `tsc`
> error and a parse error carrying the migration prescription; run
> `os migrate meta --from 16` to strip them automatically. What to do instead
> is the subject of "Access methods and partial indexes" below.

## Syntax

```typescript
indexes: [
  { fields: ['status', 'created_at'] },                // plain composite
  { fields: ['email'], unique: 'organization' },       // unique per org
  { fields: ['hostname'], unique: 'global' },          // unique platform-wide
  { name: 'idx_acct_status', fields: ['status'] },     // custom name
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
4. **Subset queries** — a partial index can help, but it is a database-layer
   migration, not a declaration (see below)

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

## Incorrect vs Correct

### ❌ Incorrect — Retired and Redundant Keys

```typescript
indexes: [
  { fields: ['status'], type: 'btree', unique: false },  // ❌ `type` retired; `unique: false` redundant
  { fields: ['description'], type: 'fulltext' },              // ❌ `type` retired
  { fields: ['created_at'], partial: "status = 'active'" },   // ❌ `partial` retired
]
```

### ✅ Correct — Declare Only What the Driver Materializes

```typescript
indexes: [
  { fields: ['status'] },                         // ✅ unique: false is the default
  { fields: ['email'], unique: 'organization' },  // ✅ the scope is required
  { fields: ['description', 'notes'] },           // ✅ plain index; see below for full-text
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

## Access methods and partial indexes

Both are real database capabilities. Neither is part of the **declaration**
surface, and the keys that used to pretend otherwise (`type`, `partial`) were
retired at protocol 17 precisely because nothing consumed them.

**Access method (`btree` / `hash` / `gin` / `gist` / `fulltext`).** The driver
and dialect decide. Postgres defaults to B-tree, which is the right choice for
the equality, range and sort patterns this guide is about. The specialised
methods are dialect-specific — `gin`/`gist` are Postgres, `fulltext` is
MySQL-family — so a portable declaration could not name one anyway. When a
workload genuinely needs one, issue it from a database-layer migration against
the dialect you are actually running.

**Partial index (`CREATE INDEX … WHERE <predicate>`).** Supported on Postgres
and SQLite (≥ 3.8.9), absent on MySQL. Because it cannot be expressed
portably — and because knex's index builders have no way to emit a predicate —
it is issued as raw SQL from a runtime migration. The platform does exactly
this for its own overlay uniqueness: `metadata-protocol`'s `ensureOverlayIndex`
runs

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active
  ON sys_metadata (type, name, organization_id, COALESCE(package_id, ''))
  WHERE state = 'active';
```

with a plain-index fallback for dialects that reject the predicate. Follow that
shape: declare the coarse index (or none) in metadata, and build the partial
form in a migration.

**Benefits of a partial index, when you do build one:**
- Smaller index size
- Faster writes (fewer rows to maintain)
- Faster queries (focused data subset)

> Drift detection understands database-authored partial indexes and leaves them
> alone — it reads partiality back out of the database's own DDL, so a partial
> index you create in a migration is not reported as drift and is never
> targeted by `os migrate apply --allow-destructive`.

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
4. **Partial for subsets** — but build it in a migration, not a declaration
5. **Unique for constraints** — Enforce at DB level, and always state the scope
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

### Text Search / Containment / Geospatial

These three want a specialised access method (`fulltext`, `gin`, `gist`), which
is **not** declarable — see "Access methods and partial indexes" above. Declare
the plain index if the column is also filtered or sorted normally, and create
the specialised one from a database-layer migration on the dialect you run.

```typescript
// Declaration: plain, portable, and all the driver can build
indexes: [
  { fields: ['description'] },   // text search: add a fulltext/GIN index in a migration
  { fields: ['tags'] },          // containment (tags @> [...]): GIN, in a migration
  { fields: ['location'] },      // ST_DWithin(...): GIST, in a migration
]
```
