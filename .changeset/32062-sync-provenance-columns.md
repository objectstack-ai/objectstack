---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/service-automation': patch
---

feat(objectql)!: every row a sync-in pull writes records where it came from, and nothing else may write those columns

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none (no skills/ page names the `_sync_` columns or the synced bucket's injected columns)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is added, removed, renamed or re-shaped, and every metadata document that parsed before parses the same. What changes is the registered shape of a `managedBy: 'synced'` object (five platform columns and one index the platform adds) and the answer a data write gets when it names a `_sync_` column: no authored value has to be rewritten, so there is nothing for a migration to prescribe and no tombstone. -->

ADR-0153 D4, the provenance half (#32062, slice 5).

- **Five `_sync_` columns on every `managedBy: 'synced'` object.** `resolveInjectedSystemColumns` (`@objectstack/spec/data`) now plans `_sync_source`, `_sync_external_id`, `_sync_pulled_at`, `_sync_run_id` and `_sync_deleted_at` on that bucket only (`plan.sync`), and the registry injects them as hidden, read-only system columns, with an index on (`organization_id`, `_sync_source`, `_sync_external_id`) placed after the tenant index. New exports: `SYNC_PROVENANCE_COLUMNS`, `SYNC_PROVENANCE_PREFIX`, `SyncProvenanceColumn`, `SYNC_PROVENANCE_FIELD_DEFS`. A synced object that declares `systemFields: false` gets none of them.
- **Both pulls stamp them.** A connector pull and a datasource pull write `_sync_source` (the mapping), `_sync_external_id` (the row's `upsertKey` value as text; a key of several fields is a JSON array of the values in `upsertKey` order, such as `["10","A-1"]`), `_sync_pulled_at` and `_sync_run_id` (the `sys_sync_run` row; not written when no run ledger is composed) on every row. `_sync_deleted_at` exists but stays empty until delete marking (D3) lands. A mapping whose `fieldMapping` targets a `_sync_` column is refused with `400 mapping_target_refused` when it runs (it was refused before as an unknown target). A connector pull whose target object's definition cannot be read is now refused the same way before it calls the connector, instead of writing rows it cannot stamp; the datasource pull already refused it.
- **BREAKING: a `_sync_` column in any other write is refused.** The engine refuses an insert or update naming a `_sync_` key with `400 ERR_SYNC_PROVENANCE_WRITE_REFUSED`, before middleware, defaults and hooks run, whatever the caller's context, `isSystem` included. A `_sync_` key a `beforeInsert` or `beforeUpdate` hook assigns, changes or removes is refused the same way before the driver is called, on any write, the pull's own included, so the pull's stamps are stored exactly as it wrote them. Only the pull's own write is admitted (`markSyncPullWrite`, exported from `@objectstack/objectql` with `SYNC_PULL_WRITE`, `SyncProvenanceWriteRefusedError` and `SYNC_PROVENANCE_WRITE_REFUSED_CODE`). The mark is consumed by that write, so a hook or flow it triggers writes as any other system caller and is refused the same way. Fix: leave the `_sync_` columns out of the write and out of your hooks; the next pull of the mapping stamps them.
- Load-time diagnostics leave the injected `_sync_` columns out when they judge a served synced object, so it is not flagged for the reserved prefix; an author field under a `_sync_` name is still refused.
