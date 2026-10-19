---
"@objectstack/spec": patch
---

docs(spec): `deriveRecordFlowSurface`'s docblock no longer calls its override list closed, and names `editMode`

Clause-②: no

- **The override sentence.** The shipped docblock said the explicit overrides of the derived default were `navigation.mode` / `navigation.size`, `FormView.type` / `modalSize` or an assigned page — "the sanctioned per-object overrides — no new authorable key". The same package declares `ObjectSchema.editMode` (`'modal' | 'page'`), and the renderer applies it. The docblock now says what the function reads (`def.fields`, `flow`, `opts`, nothing else) and lists only the explicit config the console renderer measurably lets win over this default: `navigation.mode` / `navigation.size`, an assigned page, and `editMode`. The function still does not read `editMode`. `FormView.type` / `modalSize` are no longer listed: an authored `FormView.modalSize` does not reach the console's create/edit modal, and `FormView.type` changes that modal's layout, not its surface.
- **Unchanged:** no behaviour, no schema, no export changes. `deriveRecordSurface` and `deriveRecordFlowSurface` return what they returned before.
