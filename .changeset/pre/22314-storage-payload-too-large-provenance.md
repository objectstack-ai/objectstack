---
'@objectstack/spec': minor
---

feat(spec): the error-code ledger lists `PAYLOAD_TOO_LARGE` under `@objectstack/service-storage`

Clause-②: yes (widening: a new owner provenance row in the published error-code ledger)

`ERROR_CODE_LEDGER['@objectstack/service-storage']` now lists `PAYLOAD_TOO_LARGE` (`413`), the code `@objectstack/rest` already registers for its import row ceilings. The storage upload doors answer it for an upload over the File Storage settings' `max_upload_mb`: the presigned upload's declared `size`, the chunked upload's declared `totalSize`, the local raw PUT body and each chunk's running total.

No code is added. `ErrorCode`, `RegisteredErrorCode` and `REGISTERED_ERROR_CODES` are unchanged, so `ApiErrorSchema` accepts exactly what it accepted before. What widens is the per-package list a reader consults to learn which packages answer a code: a code emitted by several packages is listed under each of them.
