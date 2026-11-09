---
'@object-ui/types': patch
'@object-ui/data-objectstack': patch
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-view': patch
'@object-ui/plugin-detail': patch
---

feat(ui): undo a business-record delete from its toast, through the recycle bin

Clause-②: yes (widening)
Metadata-protocol: none

A delete of one business record (an object without the `sys_`, `cloud_` or `ai_` prefix) enters the recycle bin (ADR-0148). When the server answers with its `recycleBinEntryId` and the caller holds `allowRestoreOwnDeleted` on the object (read through `objectPermissionGrants`, so `manageRecycleBin` and `modifyAllRecords` grant it too), the "deleted" toast on the console list, the plugin list and the record page now carries an Undo action. Undo restores that entry under its original ids (`POST {data}/:object/recycle-bin/:entryId/restore`), never re-creates the record, refreshes the view and toasts "{label} "{name}" restored". On the record page, Undo also returns to the record.

A refused restore toasts one sentence per reason, in the session language: another record now holds the same unique value, the parent record was purged, the package was uninstalled, the parent is itself in the recycle bin, the entry is gone, no permission, or no recycle bin on this deployment. An unknown code keeps the server's message. Without the grant, without an entry id, or for a batch delete, the toast is unchanged.

The delete confirmation for a business record (one record and a selection, on the console list, the plugin list, the record page and the plugin detail view) is now the question alone ("Are you sure you want to delete this record?", "Delete N selected records?"). It no longer says "This cannot be undone." Platform objects keep today's copy.

`@object-ui/types`: `DataSource.delete` options gain `onRecycleBinEntry?`, and `DataSource` gains an optional `restoreRecycleBinEntry?`. `delete` still returns a boolean. `@object-ui/data-objectstack` implements both. `@object-ui/core` exports `recycleBinRestoreRefusalText`, `RECYCLE_BIN_RESTORE_REFUSAL_KEYS` and the `RecycleBinRefusalLabels` type, and `recordDelete` gains `successToast`, `undo` and `entersRecycleBin`. `@object-ui/i18n` adds `objectActions.deleteConfirmQuestion`, `restoredNamed`, `restoreSuccess` and `restoreFailed`, `detail.deleteConfirmQuestion`, the `console.objectView.bulkDeleteQuestion` family and the seven `recycleBin.refusal.*` sentences to every pack.
