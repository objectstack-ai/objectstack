---
'@objectstack/spec': minor
---

feat(spec): the error-code ledger lists `INVALID_REQUEST` under `@objectstack/verify`

Clause-②: yes (widening: a new owner provenance row in the published error-code ledger)

`ERROR_CODE_LEDGER['@objectstack/verify']` now lists `INVALID_REQUEST`. The verify handle's two update doors answer it for a malformed call, such as `{ system: true }` on an insert or delete, or a `hooks.updateWhere` the engine would write by id. They answer in-process, with a thrown `Error` carrying `code`, `status` and `statusCode`; it is a test door with no HTTP path. No code is added: `ErrorCode`, `RegisteredErrorCode` and `REGISTERED_ERROR_CODES` are unchanged, so `ApiErrorSchema` accepts exactly what it accepted before.
