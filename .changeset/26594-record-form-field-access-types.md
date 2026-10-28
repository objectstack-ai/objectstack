---
'@object-ui/types': patch
---

feat(types): `DataSource.getRecordFieldAccess` asks the server for one record's field projection

Clause-②: yes (widening)
Metadata-protocol: none

`DataSource` gains the optional `getRecordFieldAccess(resource, id)`, resolving to the new `RecordFieldAccess` type (`object`, `recordId`, `readable`, `editable`), or `null` when there is no answer. `editable` is the server's write gate judged on the stored row, so a field permission whose `when` names only some rows locks the field only on those rows. Adapters that do not speak to an ObjectStack server can leave it out.
