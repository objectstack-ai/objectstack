---
'@objectstack/service-storage': patch
---

A file field's declared `accept` / `maxSize` refusal now answers `400 ERR_FILE_CONSTRAINT` with a sentence naming the field and the constraint, instead of `500 INTERNAL_ERROR` with the sentence withheld.

Clause-②: no

- **`FileConstraintError` declares `status = 400`**, as `FileFieldBulkWriteError` in the same module already did. The data API's declared-status passthrough now answers the refusal on create and on update, e.g. `400 {"error":"File exceeds the maximum size declared for 'doc' (5005 bytes > 10 bytes)","code":"ERR_FILE_CONSTRAINT","object":"…"}`. Before, the error declared a registered `code` but no status, so it fell through to the sanitised `500 INTERNAL_ERROR`, and the field and the reason reached only the server log.
- **It carries `field` and `constraint` (`'accept' | 'maxSize'`) as members**, for in-process callers. The constructor is now `new FileConstraintError(field, constraint, message)`. The new `FileConstraint` type is exported beside it. On the HTTP wire the message names both, and its wording is unchanged.
- The accept set is unchanged: the same files are refused, and a refused write still persists no row and claims no file. `ERR_FILE_CONSTRAINT` was already in the error-code ledger.
