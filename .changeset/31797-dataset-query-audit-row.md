---
'@objectstack/plugin-audit': patch
'@objectstack/rest': patch
---

feat(plugin-audit, rest): a query of an opted-in saved dataset writes one `dataset_query` row in `sys_audit_log` (#31797)

Clause-②: yes (widening) — a new `sys_audit_log.action` value, `dataset_query`, with its writer; a new `AuditPlugin` option, `datasetQueryAudit` (`datasets`, `maxBatchSize`, `flushIntervalMs`); a new `recordDatasetQuery` member on the `audit` service slot; and new exports from `@objectstack/plugin-audit` (`createDatasetQueryAuditWriter`, `buildDatasetQueryAuditRow`, `DATASET_QUERY_AUDIT_ACTION` and their types). `createReadAuditBatcher` takes an optional event type parameter and an optional `overflowMessage`, both defaulting to what it did before. No door answers differently: with no dataset named, nothing is recorded or buffered.
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches the audit ledger's actions or `AuditPlugin`'s options; `content/docs/permissions/record-view-auditing.mdx` gains a "Dataset queries" section.

**What a deployment gets.** Name saved datasets in `new AuditPlugin({ datasetQueryAudit: { datasets: [...] } })` and each query of one through `POST /analytics/dataset/query`, or through each query of its batch door, writes one run-level row: the caller (`user_id`, `actor`, `tenant_id`), the dataset's base object in `object_name`, and in `metadata` the dataset name, the dimensions and measures selected, the filtered field names and operators (never the values), the row count and the outcome. A report or dashboard is composed in the browser, so the row names the dataset, not a report.

**The rules.** Off by default and opted in per saved dataset; an inline definition (the Studio preview) writes no row. A request the door refuses before the read writes no row; a query that fails after the read started writes one row with outcome `failed`, the HTTP status and the error's machine code, never the error's text. Rows are written in batches off the request path, stamped with the query's instant, and a lost batch is reported at `error` once per cause.
