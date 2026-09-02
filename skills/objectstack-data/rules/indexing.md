# Index Strategy

Guide for creating efficient database indexes in ObjectStack.

## Default Behavior

ObjectStack automatically creates indexes for:
- Primary keys (`id`)
- Field-level `unique` — **not** foreign keys: declare those

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

### Composite index order

A composite index is used **left-to-right**: `['status', 'priority', 'created_at']`
serves `status`, `status + priority`, and `status + priority ORDER BY created_at`,
but not a query that filters on `priority` alone. Put the most selective column
first and the range/sort column last.

## Access methods and partial indexes

Both are real database capabilities, and neither is part of the **declaration**
surface — issue them from a database-layer migration.

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

## Index Naming Convention

ObjectStack auto-generates index names. To specify custom names:

```typescript
{
  name: 'idx_account_status_created',  // Custom name
  fields: ['status', 'created_at'],
}
```

**Auto-generated pattern:** `idx_{object}_{field1}_{field2}_{...}`

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
