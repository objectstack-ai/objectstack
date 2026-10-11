---
'@objectstack/spec': patch
---

fix(spec): the error-code ledger records `@objectstack/metadata-protocol` as an emitter of `OBJECT_API_DISABLED` and `OBJECT_API_METHOD_NOT_ALLOWED` (#22737)

The generic data door now answers the two exposure codes for a nested-relation filter condition whose related object's `enable` block refuses a query of it, so `ERROR_CODE_LEDGER['@objectstack/metadata-protocol']` lists both. That is the provenance `check:error-code-provenance` holds every emitting package to. Value-only: `REGISTERED_ERROR_CODES` is unchanged, because both codes were already registered under `@objectstack/rest`. No export, schema or generated artifact moves.
