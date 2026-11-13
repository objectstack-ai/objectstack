---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: `query_dataset` refuses a selection that names no measure, as the REST dataset door does

Clause-②: no (narrowing) — a `query_dataset` call whose `selection.measures` is empty, which answered 500 `DATABASE_ERROR` (or, with dimensions, group rows carrying no measure), is refused 400 `VALIDATION_FAILED` before anything is read, on the MCP tool and on the product AI's chat tool alike.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored shape changes. The refusal is the code, status and sentence the REST door POST /analytics/dataset/query already answers the same selection with, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that sent `query_dataset` a selection with `measures: []`.

FROM: the call reached the dataset query with nothing to project. The SQL driver answered `500 DATABASE_ERROR` with its own statement error, and with `dimensions` the tool served group rows carrying no measure.
TO: the call is refused `400 VALIDATION_FAILED`, `body.selection.measures must be a non-empty array of measure names.`, before the dataset is resolved or any row is read: the answer `POST /api/v1/analytics/dataset/query` gives the same selection. The fix for a caller: name at least one measure from the dataset, as `list_datasets` lists them.

The check sits in the dataset-tools executor that both faces call, the MCP `query_dataset` tool and the chat tool, so one guard covers both. A selection naming a measure is served exactly as before.
