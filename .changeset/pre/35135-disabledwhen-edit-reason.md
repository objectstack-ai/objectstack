---
'@object-ui/app-shell': patch
'@object-ui/components': patch
---

fix(app-shell, components): a record Edit or Delete greyed by `userActions.*.disabledWhen` says why

Clause-②: no
Metadata-protocol: none

When an object's `userActions.edit.disabledWhen` held on a record, the record page greyed Edit and said nothing about why, on desktop and on the phone; the header overflow's Delete under `userActions.delete.disabledWhen` was just as silent. Both now give the generic reason an authored action without a declared `disabledReason` already gives ("Not available for this record", in every shipped language): on desktop as Edit's tooltip and accessible description, and as the second line of the `⋯` entry, which is where Delete sits and where a phone's off Edit goes. The approval band and the "Not editable in its current state" badge keep explaining their own locks, so an Edit they turn off gives no second reason, and a record that has not loaded yet gives none.

`page:header` now draws a `disabledReason` a host hands with one of its own header actions (`RecordContext.headerSystemActions`) when that action's `disabled` holds. A host action that hands none stays silent, as before; the generic reason is still given only to authored actions.
