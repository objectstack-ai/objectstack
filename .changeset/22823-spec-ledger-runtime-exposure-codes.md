---
'@objectstack/spec': patch
---

fix(spec): the error-code ledger records `@objectstack/runtime` as an emitter of `OBJECT_API_DISABLED` and `OBJECT_API_METHOD_NOT_ALLOWED` (#22823)

The runtime dispatcher's `callData` now answers the two exposure codes for a nested-relation filter condition whose related object's `enable` block refuses a query of it, on its `query` fallback and its `aggregate` arm, so `ERROR_CODE_LEDGER['@objectstack/runtime']` lists both. That is the provenance `check:error-code-provenance` holds every emitting package to. Value-only: `REGISTERED_ERROR_CODES` is unchanged, because both codes were already registered. No export, schema or generated artifact moves.
