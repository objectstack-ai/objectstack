---
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
'@objectstack/spec': patch
---

fix(driver-sql,driver-turso)!: an upsert whose conflict lands on another organization's row is refused with `UNIQUE_VIOLATION` and writes nothing, and an upsert never changes a row's organization (#21185)

Clause-②: no (narrowing)

<!-- adr-0087: registered driver-upsert-cross-organization-conflict-refused -->

**BREAKING for `upsert` callers on the SQL drivers and on `TursoDriver`.**

**What changed.** `upsert` resolves its conflict against the whole table, and the
primary key and a `unique: 'global'` column are installation-wide, so the row a
tenant-scoped call (`options.tenantId` on an object with a tenant column) collided
with could belong to another organization. The merge wrote the payload onto that
row, tenant column included. Now:

- **A tenant-scoped upsert merges only into a row of the organization the row is
  written under**, for any conflict target, the primary key included. A conflict
  that lands on a row of another organization, or on a row with no organization,
  is refused with `code: 'UNIQUE_VIOLATION'`, `status: 409`, and nothing is
  written. That is the answer `create()` gets for the same collision: from the
  caller's organization the call is an insert, and that insert collides. The
  refusal names no organization and no value of the row it collided with.
- **The tenant column is insert-only** (`insertOnlyUpsertColumns`), like `id`,
  `created_at` and `auto_number` columns: an upsert with no tenant context merges
  into the row it lands on and keeps that row's organization.

Mechanism, per face: on SQLite, PostgreSQL and the remote (libSQL) face, the merge
statement carries the organization predicate (`DO UPDATE … WHERE`), so another
organization's row is never written. On MySQL, whose `ON DUPLICATE KEY UPDATE`
takes no `WHERE`, the statement and a read of the landed row run in one
transaction (a savepoint inside a caller's transaction), and the read's failure
rolls the write back. The remote face now also stamps the caller's organization on
the row it inserts, as the local faces do.

## FROM → TO

| you relied on | now |
|:--|:--|
| a tenant-scoped `upsert` merging into a row of another organization | refused with `UNIQUE_VIOLATION` / 409, nothing written |
| an `upsert` payload's tenant value moving the row it merges into | the row keeps its organization; to move a row between organizations, use `update()` |

**What is not affected.** A tenant-scoped upsert whose conflict lands on a row of
its own organization merges as before, on every target. An upsert that inserts
lands under the caller's organization, or under the organization the payload
names explicitly, as before.
