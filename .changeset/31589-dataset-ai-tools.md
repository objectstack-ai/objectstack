---
'@objectstack/service-analytics': patch
'@objectstack/spec': patch
---

feat(service-analytics): `list_datasets` and `query_dataset` — the dataset AI tools, one definition and one executor (ADR-0149 D2–D4)

Clause-②: yes (widening) — new exports `createDatasetTools`, `getDatasetToolDefinitions`, `DATASET_TOOL_DEFAULT_MAX_ROWS`, `matchDatasetTerms` and their types, and three new `AnalyticsService` methods (`datasetTools`, `hasPluginWiredAdmission`, `admitDatasetCatalogEntry`) plus `reportDatasetCatalogDefect`.
Metadata-protocol: none

An AI can now answer a business question from a governed dataset instead of guessing a field on an object.

- **Two tools, defined once.** `getDatasetToolDefinitions()` returns the two `AIToolDefinition`s — names, the descriptions that teach the model the selection rule, and the JSON Schemas projected from `@objectstack/spec`'s tool schemas. `AnalyticsService.datasetTools({ loadDatasets, maxQueryLimit?, diagnoseDelegation? })` (or `createDatasetTools`) binds the executor; the MCP bridges and the product AI's registry both call it.
- **`list_datasets`** lists the saved datasets the caller may query, with each member's label, business description and synonyms at the caller's locale. It asks the same gates a query of the dataset asks: a dataset whose object the caller may not read, or that is not API-exposed, is absent; a member over a field the caller may not read is left out and `membersWithheld: true` says so; a member over an `internal` field is left out for every caller and reported once to the server log. With `terms`, each dataset's `matches` names which word equals which member's name, label (any locale) or synonym, after the dataset schema's own normalization.
- **`query_dataset`** runs a `DatasetSelection` against one saved dataset through `queryDataset` with the caller's context — no gate added, none skipped. A missing dataset and one the caller may not query both answer `NOT_FOUND`. Rows are capped (50 by default) with `truncated`; the answer carries no SQL and adds a `provenance` block (dataset, measures with their descriptions, dimensions, the caller's `runtimeFilter`) composed from what ran — the model's input cannot set it.
- **Plugin-wired only.** Both tools refuse with `SERVICE_UNAVAILABLE` / 503 on an `AnalyticsService` built without the admission hooks `AnalyticsServicePlugin` wires, where the exposure gate would warn and pass and the read admission would return silently.
- **Member descriptions reach the Cube.** `compileDataset` writes a dataset member's `description` onto the Cube member, so `GET /api/v1/analytics/meta` publishes it for a registered dataset cube.
- The spec liveness ledger moves the four dataset member rows (`synonyms` and `description` on dimensions and measures) from `planned` to `live`.
