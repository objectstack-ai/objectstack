# ADR-0074: Audit timestamps are stored in one canonical, timezone-explicit format on SQLite

**Status**: Accepted (2026-06-26). **Read side extended (2026-09-07):** the read repair this ADR added on SQLite is, since [ADR-0053 addendum D-F1](./0053-date-and-datetime-semantics.md) (#13973), one presentation on every dialect — `created_at` / `updated_at` leave every read door as the canonical ISO-Z text on Postgres and MySQL too, where they used to leave as the client library's `Date`. The storage decision below is unchanged.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0053](./0053-date-and-datetime-semantics.md) (`datetime` is an instant stored as UTC)
**Consumers**: `@objectstack/driver-sql` (`create`/`bulkCreate`/`upsert`/`update`, `formatOutput`), `@objectstack/objectql` (optimistic locking via `updated_at`, `sys_metadata` writes), report/analytics date bucketing, and any out-of-tree consumer of `created_at`/`updated_at` (notably the objectos kernel freshness probe).
**Surfaced by**: a self-hosted objectos-ee on a UTC+8 host where the per-environment kernel never evicted after a publish/install/config toggle — `updated_at` parsed as local time landed *before* the kernel's `builtAtMs`, so the freshness probe always reported "fresh".

---

## TL;DR

SQLite has no native timestamp type. The driver's two write paths disagreed on
how they wrote the builtin `created_at`/`updated_at` audit columns:

- **INSERT** relied on the column default `defaultTo(knex.fn.now())`, which on
  SQLite is `CURRENT_TIMESTAMP` → `'2026-06-26 10:23:40'` (space-separated, no
  millis, **no zone**).
- **UPDATE** stamped `new Date().toISOString().replace('T',' ').replace('Z','')`
  → `'2026-06-26 10:23:40.246'` (space-separated, with millis, **no zone**).

Both are **timezone-naive**. A zone-less, space-separated string is not
ISO-8601, so `Date.parse` (V8) interprets it as **local** time. On any non-UTC
runtime a stored UTC wall-clock therefore shifts by the host offset when read
back as an instant — silently corrupting every `new Date(updated_at)` comparison,
not just the freshness probe that surfaced it.

**Decision.** On SQLite, every driver write path stamps audit timestamps in a
single canonical format — **full ISO-8601 with an explicit `Z`**
(`new Date().toISOString()`, e.g. `'2026-06-26T10:23:40.246Z'`) — and the read
path repairs any legacy/raw zone-naive value to that same format. INSERT and
UPDATE now agree, and the stored instant is unambiguous. Postgres/MySQL are
unchanged: they store a real zone-aware `TIMESTAMP` via native `now()` and never
had the ambiguity.

This extends ADR-0053's "`datetime` is an instant stored as UTC" to the builtin
audit columns: an instant must be stored zone-explicitly, never as a bare
wall-clock string.

## Decision detail

1. **Write — app-side stamp, not the column default.** `create`, `bulkCreate`,
   `upsert` and `update` stamp `created_at`/`updated_at` to
   `new Date().toISOString()` (SQLite only; gated on `tablesWithTimestamps`).
   A caller-provided value (a seed fixture, the `sys_metadata` writer, a service
   outbox) is preserved on insert — only an empty slot is filled.

   Stamping **app-side** (rather than changing the column DDL default to a
   `strftime('%Y-%m-%dT%H:%M:%fZ','now')` expression) is deliberate: a DDL
   default only applies to **newly created** tables, so existing tenant databases
   — exactly the ones exhibiting the bug — would keep emitting the naive
   `CURRENT_TIMESTAMP` on insert and continue to mix formats with the now-fixed
   UPDATE. App-side stamping fixes every database immediately and needs no
   schema migration. The legacy `CURRENT_TIMESTAMP` column default is left in
   place as a harmless fallback for raw inserts that bypass the driver.

2. **`created_at` is insert-only.** `upsert`'s conflict `merge()` now excludes
   `created_at`, so a merge that updates an existing row advances `updated_at`
   but never rewrites the original `created_at`.

3. **Read — tolerant reader for legacy/mixed rows.** `formatOutput` repairs a
   zone-naive `created_at`/`updated_at` string to canonical ISO-8601-`Z`,
   interpreting the stored wall-clock as UTC (what `CURRENT_TIMESTAMP` and the
   old UPDATE stamp both wrote). The repair is **idempotent** (an
   already-zone-explicit value is returned unchanged) and **total** (a
   `Field.datetime`-typed audit column stored as epoch-ms INTEGER, and any
   unrecognised shape, pass through untouched). This mirrors the existing
   read-repair the `Field.date`/numeric-scalar paths already perform, and means
   existing rows read back unambiguously **without a data migration**.

## Consequences

- **Unambiguous instants.** `new Date(created_at|updated_at)` yields the correct
  UTC instant on every host timezone. The objectos freshness probe (already
  hardened defensively on the consumer side) now also receives a correct value
  at the source.
- **No on-disk format mixing for new writes.** Because INSERT and UPDATE share
  one format, a SQL-level `ORDER BY updated_at` (e.g. objectql metadata loads)
  sorts chronologically. Lexicographic order of ISO-8601-`Z` equals chronological
  order.
- **Optimistic locking stays stable.** objectql `assertVersionMatch` compares the
  `updated_at` token app-side, on both sides through `formatOutput`; the
  idempotent reader keeps the token deterministic across reads, including for
  legacy rows.
- **Legacy rows at rest stay naive until rewritten.** Like ADR-0053's date-only
  repair, the on-disk value is only normalized when a row is next written through
  the driver; reads are repaired transparently. A raw SQL `ORDER BY` over rows
  that straddle the fix (some naive, some `Z`) can mis-order until those rows are
  rewritten — an accepted, self-healing residual, not a regression of the common
  driver-mediated path.
- **Scope.** Only the builtin `created_at`/`updated_at` audit columns are
  covered. A user-declared `datetime` field with a `defaultValue: 'NOW()'` still
  takes the naive `CURRENT_TIMESTAMP` default on SQLite; aligning those is a
  possible follow-up but was out of scope for this fix.
