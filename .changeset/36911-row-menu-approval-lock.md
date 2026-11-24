---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): the row menu offers no Edit on a row held by a locking approval

Clause-②: no
Metadata-protocol: none

A grid row whose record is held by a pending approval with `lockRecord: true` is refused `RECORD_LOCKED` when it is updated. Its row menu still offered Edit, on the list page and on a record page's related tab. The menu now reads the same lock the grid's cells read (`POST /api/v1/approvals/records/:object/locks`), once per page, when a row's actions are first reached for. A row the lock read answered as locked offers no Edit, as the record page offers none. Delete stays, because deleting a locked record is allowed and cancels its request. When the lock cannot be read, the menu stays as it was: no approvals service (501), a row the reader cannot read, a failed read, or a read not yet asked.
