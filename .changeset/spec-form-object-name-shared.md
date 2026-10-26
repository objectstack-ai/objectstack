---
'@objectstack/spec': patch
'@objectstack/metadata-core': patch
'@objectstack/lint': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/spec/ui` now exports `anonymousFormObjectName`, the object an open anonymous form candidate submits into (the form's `data.object`, else the view's `list.data.object`, `form.data.object`, `object`). `@objectstack/metadata-core` re-exports the same function, and the public-form file-field lint rule in `@objectstack/lint` resolves the object through it instead of a retyped copy, so the doors and the lint cannot disagree.
