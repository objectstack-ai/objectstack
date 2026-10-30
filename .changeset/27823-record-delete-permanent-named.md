---
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/plugin-view': patch
'@object-ui/plugin-detail': patch
---

fix(console): a record delete says it cannot be undone, and the success toast names the record

Clause-②: yes (widening)
Metadata-protocol: none

A record delete is permanent (there is no recycle bin), yet the one-record confirm only asked "Are you sure you want to delete this record?" and the success toast said "Record deleted" (record page) or "Task deleted successfully" (list) without saying which record went.

- **The question.** `objectActions.deleteConfirm` (the list row, the record page and the object-view grid Delete) and plugin-detail's `detail.deleteConfirmation` now end with the pack's own "This cannot be undone." sentence, the one the batch question already carried, in all ten locale packs.
- **The toast.** `recordDelete.successText` (`@object-ui/core`) names the deleted record by the same display-name resolver the confirm title reads: `Task "Website Relaunch" deleted`. A record with nothing nameable keeps `{{label}} deleted successfully`. The record page, the console list and the object-view grid all use it; `recordDelete.run` takes an optional `objectDef` so the name follows the object's declared `nameField`. A batch delete keeps its count.
- `@object-ui/i18n` gains `objectActions.deletedNamed` in all ten packs. There is no Undo: there is nothing to restore from.
