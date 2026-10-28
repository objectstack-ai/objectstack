---
'@objectstack/client': minor
---

feat(client): `data.fieldAccess(object, id)` reads the field projection of one record

Clause-②: yes (widening)
Metadata-protocol: added

`client.data.fieldAccess(object, id)` calls `GET /data/:object/:id/field-access` and resolves to `GetRecordFieldAccessResponse`: the fields the caller may read, and the fields the write gate admits on an update of that stored row. A field permission whose `when` names only some rows is unlocked on the rows it does not name. A row that is absent or unreadable rejects with the record read's 404.
