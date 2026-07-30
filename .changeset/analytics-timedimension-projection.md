---
"@objectstack/service-analytics": patch
---

fix(analytics): project a `timeDimensions` bucket into the result rows and fields (#4033)

An analytics query that buckets by `timeDimensions` alone grouped correctly —
the echoed SQL read `date_trunc('month', due_date) AS "due_date"` — but the row
mapper and `buildFieldMeta` both enumerated `query.dimensions` only, so the
bucket never reached the caller: rows carried just the measures and `fields`
never mentioned the dimension. A trend chart got N values and no x-axis. The
same query written with `dimensions: ['due_date']` was unaffected, which is why
it went unnoticed.

Grouping, row mapping and field metadata now derive the projected set from one
`projectedDimensions()` helper — `dimensions` plus every *granular*
`timeDimensions` entry not already among them. A `timeDimensions` entry without
a granularity contributes only its `dateRange` predicate and stays out of the
projection, so no phantom column is declared.
