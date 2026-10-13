---
'@objectstack/spec': patch
---

fix(spec): the error-code ledger records `@objectstack/service-analytics` as an emitter of `OBJECT_API_DISABLED` and `OBJECT_API_METHOD_NOT_ALLOWED` (#22634)

The analytics door now answers the data door's two exposure codes for an object whose `enable` block refuses the aggregate operation, so `ERROR_CODE_LEDGER['@objectstack/service-analytics']` lists both. That is the provenance `check:error-code-provenance` holds every emitting package to. Value-only: `REGISTERED_ERROR_CODES` is unchanged, because both codes were already registered under `@objectstack/rest`. No export, schema or generated artifact moves.
