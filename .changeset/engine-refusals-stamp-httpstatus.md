---
'@objectstack/objectql': minor
---

Engine refusals now declare their HTTP status under both spellings: `httpStatus` beside the existing `status`, same number, at every producer in the package.

`status` is unchanged and stays. It is what every HTTP door in this repo reads — `resolveThrownHttpError` (`@objectstack/types`) resolves `.status` then `.statusCode` and knows no other spelling — so nothing about what the REST or dispatcher doors answer changes.

What changes is what a consumer holding the **thrown** error can read. ADR-0112 D5 records the destination as "the HTTP status lives on the transport and (optionally) `error.httpStatus`", and `httpStatus` is the key the client SDK already stamps on every wire failure. A consumer that caught an engine refusal locally had no status at all: `os migrate summary-nulls --json --recompute-undefined-on-empty customer.nope` emitted `{ error, code: 'INVALID_FIELD' }` with no status field, while the same refusal arriving over the wire carried `httpStatus: 400`. It now carries `httpStatus: 400` on both paths.

Additive on thrown errors, so no caller that reads `status` needs to change. The 20 producers: the `INVALID_SORT` / `INVALID_FIELD` / `VALIDATION_ERROR` / `INVALID_METADATA` / `DELETE_RESTRICTED` refusals in `engine.ts`, the `INVALID_FILTER` / `INVALID_FIELD` refusals in `filter-comparand-shape.ts`, `resolveRecomputeScope` in `summary-backfill.ts`, and the eight error classes declaring a `readonly status` (`DuplicateRecordError`, `HookUnscopedDataAccessError`, `MultiUpdateHookKeyDivergenceError`, `EmptyCredentialWriteError`, `SystemWriteOrganizationRequiredError`, `NamespaceConflictError`, `ArtifactObjectNameConflictError`, `ObjectOwnershipConflictError`).
