---
'@objectstack/spec': patch
'@objectstack/objectql': patch
---

feat(objectql): restore a recycle-bin entry under its original ids, and publish `data.record.restored` (ADR-0148 D2)

Clause-②: yes (widening)
Metadata-protocol: none

`ObjectQL.restore(entryId, { context })` writes one recycle-bin entry back: every row of the entry, the master first and its master-detail details after it, under the ids they had, with `created_by` / `created_at` as they were. No insert hook runs, no default or autonumber is issued: a restore is not a create. The references the delete cleared (`set_null` lookups) are re-linked where nothing has changed them since: a single-valued field while it still holds no value, a multi-valued one while it no longer holds the member. Roll-ups recompute from the rows that are back, one `data.record.restored` event is published per row, and the entry is removed. It answers what came back (`RecycleBinRestoreResult`: the entry, the master's object and id, every row, how many references were re-linked), or `null` when no entry with that id is visible to the caller's organization or the composition registers no bin.

The entry is the unit: every row comes back or none does. A restore that would write what it should not is refused `409` before anything is written, and the entry stays:

- `RESTORE_PACKAGE_UNINSTALLED`: an object of the entry is no longer registered.
- `RESTORE_PARENT_PURGED`: a row's master-detail parent is neither live nor a row of the entry. A parent that is the record of another recycle-bin entry is refused with the same code for now, and the refusal names that entry (`parentEntryId`) and says to restore it first.
- `RESTORE_UNIQUE_VALUE_TAKEN`: a live row holds the id or a unique value of a snapshotted row, found by a probe before the write or by the store's own unique constraint at it.

The writes run in one transaction when every object involved is stored by the recycle bin's driver; otherwise each write already made is undone when a later one fails.

The restore is dispatched as the new `restore` operation on the business object, with no query AST and no id, like `purge(entryId)`. `beforeRestore` / `afterRestore` stay outside the engine's hook namespace, so registering them only warns, as before. `restore` advances the write epoch. Until `@objectstack/plugin-security` maps the verb to `allowRestoreOwnDeleted` / `manageRecycleBin`, its fail-closed backstop refuses every restore by a caller that is not the system.

`@objectstack/spec`: `DataEventType` and `RealtimeEventType` gain `data.record.restored` (`RECORD_RESTORED_EVENT`), now that the engine emits it. A pure widening: a consumer that matches the event names it knows keeps working, and one that wants restores subscribes to the new name. A consumer keyed on `data.record.created` does not see a restore.
