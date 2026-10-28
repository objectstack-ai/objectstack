---
'@objectstack/rest': minor
---

feat(rest): `GET /data/:object/:id/field-access` serves the field projection of one record

Clause-②: yes (widening)
Metadata-protocol: added

A record's edit form can ask which fields it may write on THAT record: the route answers `{ success: true, data: { object, recordId, readable, editable } }` (`GetRecordFieldAccessResponseSchema`), with `editable` judged on the stored row by the write gate through the security service's `getRecordFieldAccess`. The record is read first exactly as `GET /data/:object/:id` reads it, so an absent row or one the caller cannot read answers that route's 404 and the projection discloses nothing more. The route takes no query parameter (a located 400 names any). Without a security service that offers the method it answers 501, and `/auth/me/permissions` remains the row-less reader.
