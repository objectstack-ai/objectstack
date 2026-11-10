---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/service-automation': minor
'@objectstack/runtime': minor
'@objectstack/cloud-connection': minor
---

feat(sync-in): a job pulls a mapping's `datasourceSource` — the federated object it names is read in windows and copied into the `synced` target (ADR-0153 D1, D2, D8)

Clause-②: yes (widening)
Metadata-protocol: semantic
Skills-docs: none — no published skill teaches `connectorSource` or `datasourceSource` today (`git grep` over `skills/` finds neither); the sync-in guide and skills are ADR-0153's P3 guide + skills child

A mapping's `datasourceSource` now does what it declares. A `job` whose `pull` names such a mapping is scheduled, and each run reads the federated object the mapping names and writes its rows into the mapping's `synced` target through the import runner, as a connector pull does. Before this release that job was not scheduled, and the key warned its author that nothing read it.

- **Two read paths (ADR-0153 D1).** A built-in driver (the SQL dialects, `memory`, `mongodb`, `turso`) is read in aligned windows, each whole and paged by the key the object's `external.columnMap` maps onto `id`. A plugin driver is read through the engine's floor in windows bounded on both sides and halved while they come back over the datasource's row cap. Every read names its own `limit`, so a deployment's default page size never cuts a window.
- **Judged again before the first read.** The target is `managedBy: 'synced'`; the source is a federated object on a non-managed datasource; its `columnMap` maps a column onto `id` (`source_key_missing`); `watermark.field` is a `datetime`, `date` or `scale: 0` number field; a `fieldMapping` entry copies it unchanged onto a target field of its type (`watermark_field_unmapped`). The build already refuses each of these; the run-time judgment covers a stack the build never saw. Each refusal is a `ConnectorPullError` with `code`, `status` and `reason`.
- **Whose rows (ADR-0153 D8, the read half).** Under a walled tenancy posture (`isolated`, `group`), a source that declares its own `organization_id` is read for the job's organization only, on every read. A shared source (`tenancy: { enabled: false }` or `systemFields: { tenant: false }`) is read whole. A source that states no scope is refused (`source_organization_scope_unstated`), and so is a walled source pulled in no organization (`job_organization_missing`). Under `single` the source is read as configured.
- **No committed position is kept yet.** The read position is stored on `sys_sync_run` (ADR-0153 D7), which lands separately. Until then every run reads from `watermark.start`, so an incremental pull reads what a `full` one reads; the keyed upsert makes the re-read harmless. `datasourceSource.full`, `deletePolicy` and `deletedField` still warn their author that they change nothing yet.
- **The pull result names its source.** `ConnectorSourcePullResult` (`@objectstack/spec/contracts`) is now a union told apart by `source`: the connector arm (`connector`, `action`, `watermark`; `source` optional, read as `'connector'`), and the datasource arm (`source: 'datasource'`, `object`, `datasource`, `readPath`, and `watermark: { field, from, committed? }`). An implementation that answers the connector shape still compiles. A caller that reads `connector` or `action` narrows on `source` first. `ConnectorSourcePullConnectorResult`, `ConnectorSourcePullDatasourceResult` and `ConnectorSourcePullResultBase` are new exports.
- **The windowed read**, two corrections: on a window read in several pages, an absent high-water value reads as the window's own start, and a commit never goes below where the run started. An unreadable watermark value in an over-cap answer is refused as `watermark_not_exact`, the data's fault, rather than `sync_bounds_not_pushed`.
- `@objectstack/objectql` exports `resolveExternalRowCap`. `@objectstack/service-automation` now depends on `@objectstack/plugin-security` at run time, to read a federated object's organization scope with the one reading the organization wall uses.
- A pull job whose mapping declares no source is refused at bind naming both keys, `connectorSource` and `datasourceSource`, and the install-local door's remedy names both.
