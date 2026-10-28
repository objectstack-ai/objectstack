---
'@object-ui/plugin-detail': patch
---

Clause-②: no
Metadata-protocol: none

fix(plugin-detail): the record page's in-place edit reads the stored row's field locks. `record:details` and `record:highlights` now ask the server's record-scoped field projection (`DataSource.getRecordFieldAccess`, `GET /data/{object}/{id}/field-access`) when the page's inline-edit session may edit, so a field permission whose `when` locks a field only from some state onward disables it only on the rows it names, as the record form's edit dialog already does. The answer is asked again after a write to the record. A data source without the method keeps the row-blind `/auth/me/permissions` answer, and a list view's column-wide inline edit keeps it too.
