---
'@objectstack/runtime': patch
---

fix(runtime): an analytics query that selects nothing answers 400 `VALIDATION_FAILED` at the entry instead of the engine's 500

Clause-②: no
Metadata-protocol: none

`POST /api/v1/analytics/query` with `measures: []`, no `dimensions` and no `timeDimensions` entry carrying a `granularity` used to pass the entry check and reach the engine, which ran `SELECT  FROM "<table>"` and answered `500 DATABASE_ERROR`; `POST /api/v1/analytics/sql` echoed the same broken statement as a 200. Both doors now refuse that body with `400 VALIDATION_FAILED` and one `details.fields[]` entry at `measures` (code `min_items`) telling the caller to select at least one measure or dimension, and the analytics service is not called. A dimension-only query, a query with one measure, and a query whose only selection is a bucketed time dimension are unchanged.
