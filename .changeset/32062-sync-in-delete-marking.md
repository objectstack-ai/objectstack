---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/runtime': minor
---

feat(service-automation)!: a sync-in pull marks the rows the source deleted, and an incremental source states how it learns of a delete

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none (no skills/ page names `deletePolicy`, `deletedField` or `_sync_deleted_at`; the guide that teaches them is `content/docs/automation/jobs.mdx`, updated here)

<!-- adr-0087: registered incremental-source-delete-policy-stated -->

ADR-0153 D3, delete marking (#32062, slice 6).

- **A pull marks a row the source deleted, and never deletes it.** Under `deletePolicy: 'mark'`, the reading when the key is absent, a pull stamps the platform column `_sync_deleted_at` on a row of a `synced` object that the source deleted, and clears it when a later pull reads the row again. `deletePolicy: 'ignore'` leaves every row as it is. Two detections:
  - `deletedField`, on any pull that declares it: a read record whose value in that source field is truthy has its copy marked; every other read record's copy is cleared.
  - Absence, on a full pull whose read was complete: every row of the mapping (`_sync_source`) the run did not read is marked. A `datasourceSource` with `full: true` is complete when its windows read to their end and no source row in the job's organization has a NULL watermark; it marks only rows whose copied watermark is at or above `watermark.start`. A `connectorSource` without a `watermark` is complete only under `paging: { style: 'none' }` (one response is the whole set); with no `paging`, or a paging style the pull does not follow yet, it marks nothing by absence. A refused or interrupted pull marks nothing by absence; a row the import runner refused was read, so it is not marked.
- **`sys_sync_run` records it.** New columns: `marked_deleted_count`, `deletes` (`judged`, `by deletedField`, `ignored`, or `unjudged, …` with the reason: `null watermark`, `no paging declared`, `pages not followed`, `rows refused`) and `skipped_null_watermark` (a datasource source's rows with a NULL watermark, counted under the organization predicate; through a plugin driver's row cap a count above the cap is recorded as the cap plus one). The end-of-pull log line says what the run marked and cleared. `job_run_id`'s and `trigger`'s descriptions now say when each is empty.
- **BREAKING: an incremental source states how it learns of a delete.** A `connectorSource` with a `watermark`, or a `datasourceSource` without `full: true`, never sees an absent row, so under `deletePolicy` absent or `'mark'` with no `deletedField` it is refused at parse (`MappingSchema`, so `defineStack` and `os validate`) and again when the pull runs (`400 VALIDATION_ERROR`, reason `delete_policy_unhonourable`). Fix: name the source's soft-delete field (`deletedField: 'is_deleted'`), or write `deletePolicy: 'ignore'`, which is what every pull did before this release. New export: `incrementalSourceDeleteRefusal` (`@objectstack/spec/data`), the rule both doors ask.
- **BREAKING: a `synced` target that withholds the provenance columns** (`systemFields: false`) is refused under `deletePolicy` absent or `'mark'` (`400 mapping_target_refused`): no row of it can carry the mark. Fix: let the platform add its columns, or write `deletePolicy: 'ignore'`.
- A datasource source's `deletedField` must name a field of the source object (`400 source_binding_invalid` otherwise).
- The liveness rows for `deletePolicy` and `deletedField` on both sources are `live`, and `os validate` no longer warns that nothing reads them. `paging` stays `planned`: the connector paging loop is a later change.
- A connector pull whose target definition cannot be read now says whether the object is not registered or the metadata read failed.
- A connector pull keeps the job run id and trigger only when the run record can hold them: a trigger other than `schedule` or `manual`, or a run id longer than 255 characters, is left out instead of failing the run record's open.
- `JobHandlerContext` (`@objectstack/runtime`) declares `trigger` and `runId`: the handler run form spreads the job service's context into the handler's, so every `handler` job already receives `trigger`, and `runId` under the database job adapter. The jobs guide lists both.
