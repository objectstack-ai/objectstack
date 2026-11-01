---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the by-id OCC comparison answers only for a row the caller reads; every other row gets the write door's answer

Clause-②: no
Metadata-protocol: none

`updateData` and `deleteData` compare a caller's version token (`If-Match`, or `expectedVersion`) before the write is authorized. On a mismatch they re-read the row as the caller. When that read returns no row, or refuses with a declared client-band status, the comparison is now dropped and the request goes on to the write, whose door answers it: the same status, code and sentence the request gets without a token, and the same a token on an id naming no row gets. This restores the governing text for the write doors (ruling of record 5985885287).

- **Unchanged:** a row the caller reads still answers `409 CONCURRENT_UPDATE` with that row as `currentRecord`, including a row the caller reads but may not write. A matching token, or none, reads nothing more than before. A read that faults (a server-band status, or none declared) still propagates as raised.
- **The write door's answers:** a caller who may not update or delete the object gets that refusal (`403`), token or none; a caller who may write the object gets `404 RECORD_NOT_FOUND` for a row its read does not return, as for an id naming no row.
