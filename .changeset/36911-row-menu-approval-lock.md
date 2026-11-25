---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): the row menu offers no Edit on a row held by a locking approval

Clause-②: no
Metadata-protocol: none

A grid row whose record is held by its own pending approval with `lockRecord: true` is refused `RECORD_LOCKED` when it is updated. Its row menu still offered Edit, on the list page and on a record page's related tab. The menu now reads the same lock the grid's cells read (`POST /api/v1/approvals/records/:object/locks`), once per page, when a row's actions are first reached for. A row the lock read answered as locked offers no Edit, as the record page offers none. Delete stays, because a record held by its own approval may be deleted, and the delete cancels the request. The lock read does not report a detail line held because its master is held, so such lines keep both Edit and Delete in this menu, and the server refuses both. When the lock cannot be read, the menu stays as it was: no approvals service (501), a row the reader cannot read, a failed read, or a read not yet asked.
