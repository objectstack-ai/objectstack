---
'@objectstack/runtime': patch
---

fix(runtime)!: an analytics query that selects nothing answers 400 `VALIDATION_FAILED` at the entry instead of the engine's 500

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer the two analytics REST doors give a request body that selects no measure, no dimension and no bucketed time dimension: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of `POST /api/v1/analytics/query` or `POST /api/v1/analytics/sql` whose body has `measures: []`, no `dimensions` (absent or empty) and no `timeDimensions` entry carrying a `granularity`.

- FROM: the body passed the entry check and reached the engine. `/analytics/query` ran `SELECT  FROM "<table>"` and answered `500 DATABASE_ERROR`; `/analytics/sql` echoed the same broken statement as a 200.
  Where the engine refused such a body before choosing a strategy, it answered that refusal instead, and those answers move to the 400 too: an unknown cube or a `public: false` one (`404 CUBE_NOT_FOUND`), a cube over an object the caller may not read (`403 PERMISSION_DENIED`), and an `order` key naming no selected member (`400 INVALID_FIELD`). On a deployment the ObjectQL strategy serves, `/analytics/query` answered a 200 with one row that carries no column.
- TO: both doors refuse that body with `400 VALIDATION_FAILED` and one `details.fields[]` entry at `measures` (code `min_items`) telling the caller to select at least one measure or dimension, and the analytics service is not called.

**Not moved.** A dimension-only query, a query with one measure, and a query whose only selection is a bucketed time dimension are unchanged. A time dimension that carries only a `dateRange` is a filter and does not count as a selection.

The fix for a caller: name at least one measure or dimension (or a time dimension with a `granularity`) in the query.
