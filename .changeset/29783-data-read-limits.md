---
'@objectstack/types': patch
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
'@objectstack/service-analytics': patch
---

feat(data): a host-configured default and maximum page size for list, report and analytics reads, and a per-query row budget, refused with a code that names the limit

Clause-②: yes (widening)
Metadata-protocol: none

What Clause-② widens: the published error-code vocabulary. `ErrorCode` (the union `ApiErrorSchema.code` parses against) gains one registered member, `QUERY_ROW_BUDGET_EXCEEDED`. A page size over the maximum answers the existing standard `MAX_RECORDS_EXCEEDED` (400), which gains its first producer. No metadata an author writes changes, and no existing code, status or response shape moves.

A deployment can now bound how many rows one data API read returns and walks. Three environment variables, each a positive integer; all three unset is today's behaviour exactly, so a self-hosted deployment that sets none of them answers as before:

- **`OS_DATA_DEFAULT_PAGE_SIZE`** — the page a read gets when it names no `limit`. Unset with a maximum set, the maximum is the default.
- **`OS_DATA_MAX_PAGE_SIZE`** — the largest `limit` a read may name.
- **`OS_DATA_QUERY_ROW_BUDGET`** — the most rows one query may walk: its `offset` plus the rows it returns.

**Over a limit is refused, never clamped.** A clamp answers a different page from the one asked for, and a caller paging by its own `limit` would skip the rows in between. So a `limit` over the maximum answers `400 MAX_RECORDS_EXCEEDED`, and an `offset` plus `limit` over the budget answers `400 QUERY_ROW_BUDGET_EXCEEDED`. Both messages name the configured number, and both are refused before the driver is asked. Each refusal writes one `warn` line with the surface, the object (or analytics cube), the row count and the limit, and never a row value.

**A read that names no limit:**

- A list read (`GET /data/:object`, `POST /data/:object/query`, grouped or not) runs with the default page size as its `limit`. Its answer already says when more rows exist (`hasMore`, `total`), so this is an ordinary first page.
- An analytics read (`query()` behind `/analytics/query`, and `queryDataset()`, the dataset door reports and dashboards read through) has no `hasMore`, so it is never cut silently. It runs with one row more than the default page size, and an answer with more rows than the default is refused with `MAX_RECORDS_EXCEEDED`, telling the caller to name a `limit` and page with `offset`.
- With a row budget and no page size, an unpaged read runs with one row more than the budget leaves after its `offset`; an answer over the budget is refused with `QUERY_ROW_BUDGET_EXCEEDED`, and one that fits is served whole.

The budget counts the rows a query walks through its window. Rows a database scans inside an aggregate or behind an unindexed filter are not visible to the data API and are not what it counts. The analytics doors judge the caller's own window; the dataset executor's internal passes (totals, measure-scoped queries) are not judged separately.

A value that is not a positive integer, or a default above the maximum, fails at construction of the protocol and of the analytics service, naming the variable, so a typo never leaves the guard silently off.

`@objectstack/types` exports the rule (`resolveQueryReadLimits`, `planQueryReadWindow`, `assertQueryReadRows`, `QueryReadLimitError` with one subclass per code, `QueryPageSizeExceededError` and `QueryRowBudgetExceededError`, and the variable and code names). `QUERY_ROW_BUDGET_EXCEEDED` is registered in the error-code ledger, and the error catalog's `MAX_RECORDS_EXCEEDED` entry names the page-size cause.
