---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the by-id OCC comparison hands a row absent from the caller's read to the write door

Clause-②: no
Metadata-protocol: none

`updateData` and `deleteData` compare a caller's version token (`If-Match`, or `expectedVersion`) before the write is authorized. On a mismatch they re-read the row as the caller. When that read returns no row, the comparison is now dropped and the request goes on to the write, whose door answers it: the answer the request gets without a token, and the answer a token on an id naming no row gets. This restores the governing text for the write doors (ruling of record 5985885287).

- **Unchanged:** a row the caller reads still answers `409 CONCURRENT_UPDATE` with that row as `currentRecord`, including a row the caller reads but may not write. A caller read that throws — a refusal or a fault — propagates as raised, as before. A matching token, or none, reads nothing more than before.
- **The write door's answers for a row absent from the caller's read:** a caller who may not update or delete the object gets that refusal (`403`); a caller who may write the object gets `404 RECORD_NOT_FOUND`, as for an id naming no row.
