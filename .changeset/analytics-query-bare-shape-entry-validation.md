---
"@objectstack/spec": major
"@objectstack/runtime": minor
---

fix(spec,runtime)!: `AnalyticsQueryRequest` is the bare `AnalyticsQuery`; the dispatcher validates `/analytics` bodies at the entry (#3878)

**Spec.** `AnalyticsQueryRequestSchema` used to describe a
`{ cube, query: {...}, format }` ENVELOPE — the dialect of the retired degraded
analytics shim (#3891), which the real engine never understood: an envelope
body inferred a column-less cube and died as an SQL syntax error
(`SELECT  FROM …`) instead of a shape error. The schema now describes what the
engine and every real caller actually use — the **bare `AnalyticsQuery`**:

```
FROM  { "cube": "orders", "query": { "measures": ["count"] }, "format": "json" }
TO    { "cube": "orders", "measures": ["count"], "dimensions": [...], "where": {...} }
```

`cube` + `measures` are required at the top level; `dimensions` / `where` /
`timeDimensions` / `order` / `limit` / `offset` / `timezone` sit beside them.
The schema is `.strict()`; `query` and `format` are tombstoned (`retiredKey`)
so both `tsc` and the parse answer with this exact migration. `format` was
never implemented (every response is the JSON envelope) — for CSV/XLSX use the
export surface. The removal is registered as two step-17 semantic migrations
(`analytics-query-request-envelope-retired`,
`analytics-query-request-format-retired`) — it is an HTTP-wire change with no
stored metadata to rewrite.

**Runtime.** `POST /api/v1/analytics/query` and `/analytics/sql` now validate
the body against that schema AT THE ENTRY and answer
**400 `VALIDATION_FAILED`** with per-field details — including the envelope
prescription above, and a bespoke hint that `filters` is not a contract field
(the filter field is `where`, the same canonical FilterCondition `find()`
takes). Previously a malformed body reached the engine and failed as a 500 SQL
syntax error, or had its off-contract filter key silently ignored. A valid
body is forwarded to the analytics service byte-identical (validation only —
parsing would inject the schema's `timezone: 'UTC'` default and override
org-timezone resolution). An uninstalled analytics capability still answers
404 before any body inspection (#3891).
