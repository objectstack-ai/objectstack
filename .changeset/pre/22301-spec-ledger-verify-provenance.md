---
'@objectstack/spec': minor
---

feat(spec): the error-code ledger lists `INVALID_REQUEST` under `@objectstack/verify`

Clause-②: yes (widening: a new owner provenance row in the published error-code ledger)

`ERROR_CODE_LEDGER['@objectstack/verify']` now lists `INVALID_REQUEST`. The verify handle's two write doors, `hooks.run` and `hooks.updateWhere`, answer it for a malformed call, such as a call naming two callers (`{ as: token, system: true }`), or a `hooks.updateWhere` the engine would write by id. They answer in-process, with a thrown `Error` carrying `code`, `status` and `statusCode`; it is a test door with no HTTP path. No code is added: `ErrorCode`, `RegisteredErrorCode` and `REGISTERED_ERROR_CODES` are unchanged, so `ApiErrorSchema` accepts exactly what it accepted before.
