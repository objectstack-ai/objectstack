---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

feat(console): Change Owner on the record page, in a list's selection bar, and beside the read-only owner of the edit form

Clause-②: yes (widening)
Metadata-protocol: none

A record whose object offers Change Owner now shows a **Change Owner** action in its page header. The action appears only where three things hold: the object can have its owner changed (it has a per-person owner that is not pinned read-only), the object's `userActions.transfer` switch is on, and the server's explain engine allows this user to transfer this record. A `controlled_by_parent` detail offers the action only once its author turns the switch on. Objects with `ownership: 'none'`, `managedBy` objects and `sys_*` objects never offer it, even to a platform admin.

The action opens one dialog. You pick the new owner under the object's own label for its owner field. Where the object has an ownership queue, you can pick a queue instead. You can also ask that the new owner be notified. The dialog sends the change through `data.changeOwner` for one record and `data.changeOwnerMany` for several. Picking the record's current owner is refused in the dialog with the reason shown. A bulk change ends with a report: how many records moved, how many already had that owner, how many did not move, and each row that did not move with the server's own reason.

A list's selection bar offers **Change Owner** for the selected rows, where the object's switch is on and the explain engine allows this user to transfer the object's records (one question per object, not per row, asked once a selection is open rather than when the list opens). The rows of such an object take a selection even when the user has no bulk Delete and the view authors no bulk actions, so the entry can be reached at all; where the verdict refuses, the bar draws no Change Owner. The server judges every row again. Rows that the switch's `visibleWhen` excludes are left out of the request, and the dialog says how many were left out.

The Console's edit form now shows the owner, read-only, above the form's fields, with Change Owner beside it when it is offered. The owner field is still not part of what the form saves. Forms embedded outside the Console are unchanged: the owner line appears only where a host mounts `FormOwnerLineContext` (exported from `@object-ui/plugin-form` and `@object-ui/plugin-form/core`).

New public surface, all additive:

- `@object-ui/plugin-grid`: `ObjectGrid` takes two new optional props, `onBulkChangeOwner` (wiring it makes the rows selectable and adds the entry) and `bulkChangeOwnerOffered` (`false` holds the entry back while the rows stay selectable); the package exports the action name `CHANGE_OWNER_BULK_ACTION`.
- `@object-ui/plugin-list`: `ListView` takes and forwards both props.
- `@object-ui/plugin-form`: new exports `FormOwnerLine`, `FormOwnerLineProps`, `FormOwnerLineContext`, `FormOwnerActionTarget` and `FormOwnerLineHost`; `@object-ui/plugin-form/core` exports `FormOwnerLineContext`, `FormOwnerActionTarget` and `FormOwnerLineHost`.
- `@object-ui/plugin-detail`: `RecordOperation` gains `'transfer'`, so `useRecordVerdict` and `seedRecordVerdict` accept it.
- `@object-ui/i18n`: every console locale gains `grid.changeOwner` and the `console.changeOwner.*` block.
