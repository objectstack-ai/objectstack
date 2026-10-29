---
'@objectstack/types': patch
'@objectstack/rest': patch
---

fix(types): a write to a registered object whose table is missing answers `500 DATABASE_ERROR`, as the read does, instead of `404 OBJECT_NOT_FOUND` "is not registered"

Clause-②: no (an existing refusal is re-classified to an existing catalog code; nothing accepted today is refused)
Metadata-protocol: none

A registered object whose table was never created (a datasource that was never provisioned, schema drift) answered its two data doors differently. `GET /api/v1/data/:object` answered `500 DATABASE_ERROR`, which the SQL driver declares at its read exits. `POST /api/v1/data/:object` answered `404 OBJECT_NOT_FOUND` with "Object '…' is not registered", because the write paths leave the driver's own error undeclared and the shared data-error classification read its missing-relation line (`no such table: …`, Postgres `42P01 relation "…" does not exist`) as an unregistered object whenever the relation named the request's object.

No unregistered name reaches a driver: the protocol's registry gate and the engine's name resolution both refuse one first, with the structured `OBJECT_NOT_FOUND` that the classification still answers `404`. So a driver's missing-relation line always means a registered object's storage is missing. The classification now answers it the sanitised, logged `500 DATABASE_ERROR` in every case, and the insert, update and delete doors agree with the read.

- **What changes for a caller.** A write to such an object gets `500 {"error":"Internal data error","code":"DATABASE_ERROR"}` instead of a `404`. A bulk-import row that fails this way carries the same verdict. The driver text is withheld from the client and written to the server log, where the `404` used to leave no line.
- **Unchanged.** An unregistered object is still `404 OBJECT_NOT_FOUND` on every door. A missing relation that names some other table was already `500 DATABASE_ERROR`.
