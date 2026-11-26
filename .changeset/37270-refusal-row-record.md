---
'@object-ui/plugin-detail': patch
'@object-ui/plugin-grid': patch
---

fix(plugin-detail, plugin-grid): a field the server's refusal adds to the fill-in dialog reads the record the change would leave

Clause-②: no
Metadata-protocol: none

The fill-in dialog adds a row for a field a refusal names. That row now carries the record the change would leave (the stored record with the change merged in), as the dialog's other rows do, in all three hosts: the stage menu, the record page's inline Save and the list cell. An option `visibleWhen` on that row reads the change, so the stage menu's confirmation, which opens with no other row, no longer shows such a row with no options to pick.
