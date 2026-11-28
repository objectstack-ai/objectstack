---
'@object-ui/core': minor
---

feat(core): the one hand-lock verdict folds an object's whole-record `uiReadonlyWhen`, and asks every caller for the object

Clause-②: yes (widening: one new optional authorable key, `ObjectSchema.uiReadonlyWhen`)
Metadata-protocol: added

- `fieldReadOnlyByHand(def, record, context)` now takes the object definition in a REQUIRED `context.object` (pass `null` only where a surface has none), and so does `fieldHasConditionalHandLock(def, object)`: a caller that forgot the object would silently open a locked record. The record and context arguments are required too (pass `null` for no record). Migration: add `{ object: objectDef }` to the context of every call. These helpers first shipped in the `19.0.0-next.0` prerelease (the field-level hand lock) and are in no stable release; a caller written against that prerelease's `fieldReadOnlyByHand(def, record?, context?)` must now pass `{ object }` (or `{ object: null }`) as shown above.
- New `effectiveUiReadonlyWhen(def, object)` — the field's own `uiReadonlyWhen` when it declares a hand lock of its own (`uiReadonly: true` or a `uiReadonlyWhen`; `uiReadonly: false` reads as absent and follows the object lock), else the object's — and `fieldLockPredicates(def, object)`, the predicates whose operands a surface fetches before it judges a row. New type `ObjectHandLockDef`.
