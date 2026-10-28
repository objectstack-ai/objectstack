---
'@objectstack/client': patch
---

fix(client): `data.find` refuses a `select` that names no field before the request, with the list door's own answer, instead of sending `?select=`

Clause-②: no — the calls refused are exactly the ones the list door already refuses (`400 VALIDATION_ERROR`); the caller gets the same `code`, `httpStatus` and message, only without the round trip. Nothing is widened and no call that was served is refused.
Metadata-protocol: none

An empty array is truthy, so `client.data.find(object, { select: [] })` (or `{ fields: [] }`) put `?select=` on the wire and came back as a `400 VALIDATION_ERROR` from a door the caller cannot see. Both `ObjectStackClient.data.find` and `environment(id).data.find` now refuse that call, and a `select` whose every member is blank, before any request:

- The error carries `code: 'VALIDATION_ERROR'`, `httpStatus: 400` and the door's sentence (`Query parameter 'select' names no field; …`), so an existing `err.code` branch fires the same way.
- The parameter is never dropped: an absent projection reads every column, which is the widening the door refuses.
- A `select` naming at least one field is sent exactly as before, blank members included (the door keeps the named ones).
