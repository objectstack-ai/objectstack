---
"@objectstack/spec": patch
---

docs(spec): `deriveRecordFlowSurface`'s docblock no longer calls its override list closed, and names `editMode`

Clause-②: no

- **The override sentence.** The shipped docblock said the explicit overrides of the derived default were `navigation.mode` / `navigation.size`, `FormView.type` / `modalSize` or an assigned page — "the sanctioned per-object overrides — no new authorable key". The same package declares `ObjectSchema.editMode` (`'modal' | 'page'`), and the renderer applies it. The docblock now says what the function reads (`def.fields`, `flow`, `opts`, nothing else) and lists `editMode` beside the other explicit config the renderer lets win over this default. The function still does not read `editMode`.
- **Unchanged:** no behaviour, no schema, no export changes. `deriveRecordSurface` and `deriveRecordFlowSurface` return what they returned before.
