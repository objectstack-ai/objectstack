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

Clause-②: no
Metadata-protocol: none

A record whose object offers Change Owner now shows a **Change Owner** action in its page header. The action appears only where three things hold: the object can have its owner changed (it has a per-person owner that is not pinned read-only), the object's `userActions.transfer` switch is on, and the server's explain engine allows this user to transfer this record. A `controlled_by_parent` detail offers the action only once its author turns the switch on. Objects with `ownership: 'none'`, `managedBy` objects and `sys_*` objects never offer it, even to a platform admin.

The action opens one dialog. You pick the new owner under the object's own label for its owner field. Where the object has an ownership queue, you can pick a queue instead. You can also ask that the new owner be notified. The dialog sends the change through `data.changeOwner` for one record and `data.changeOwnerMany` for several. Picking the record's current owner is refused in the dialog with the reason shown. A bulk change ends with a report: how many records moved, how many already had that owner, how many did not move, and each row that did not move with the server's own reason.

A list's selection bar offers **Change Owner** for the selected rows, where the object's switch is on and the explain engine allows this user to transfer the object's records (one question per object, not per row, asked once a selection is open rather than when the list opens). The server judges every row again. Rows that the switch's `visibleWhen` excludes are left out of the request, and the dialog says how many were left out.

The Console's edit form now shows the owner, read-only, above the form's fields, with Change Owner beside it when it is offered. The owner field is still not part of what the form saves. Forms embedded outside the Console are unchanged: the owner line appears only where a host mounts `FormOwnerLineContext` (exported from `@object-ui/plugin-form` and `@object-ui/plugin-form/core`).

`ObjectGrid` takes a new optional prop, `onBulkChangeOwner`. `ListView` forwards it. `@object-ui/plugin-grid` also exports the action name `CHANGE_OWNER_BULK_ACTION`. In `@object-ui/plugin-detail`, the record verdict's operation type gains `'transfer'`. Every console locale has the new strings.
