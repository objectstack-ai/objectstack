---
'@object-ui/types': patch
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
---

fix(console): Hide column in the column-header menu is a list draft, like the eye in View settings

Clause-②: yes (widening) — one new optional runtime slot `DataTableSchema.onColumnHide(columnKey)` (refused by name on the zod mirror, like `onColumnsReorder`) and one new optional `ObjectGrid` prop `onColumnHide(field)`; nothing removed or renamed
Metadata-protocol: none

On a Console object list, picking "Hide column" in a column header's menu hid the column inside the table only: nothing above the table heard of it, so the list drew neither Discard nor Save and only a reload brought the column back. The same choice made with the eye in View settings was already a draft.

The table now reports the hidden column to its host (`DataTableSchema.onColumnHide`, supplied by `ObjectGrid` from its new `onColumnHide` prop), and `ListView` writes it through the same writer as the hide-fields eye: the host hears it on `onHiddenFieldsChange` (the Console holds it in the list's draft, so Discard brings the column back and Save keeps it hidden), and a column the reader added leaves their added fields, as unticking it does. A table with no host handler hides the column in its own state, as before.
