---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an object draft's verdict names the package namespace-prefix refusal its publish gives (#27444)

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` describes what a draft's `_diagnostics` carries; the namespace-prefix rule itself is unchanged.

A draft object saved into a package whose manifest declares a namespace, under a name without the `<namespace>_` prefix, read `_diagnostics: { valid: true }` until "Publish all" refused the whole batch with `NAMESPACE_PREFIX`. The draft read now asks the same judge the publish pre-flight and the per-item publish ask, on the package the draft is staged into, and folds its answer into `_diagnostics`: `valid: false` with an `errors[]` entry whose `code` is `NAMESPACE_PREFIX` and whose message is the sentence publish refuses with. The draft save itself is unchanged — it still stores and answers 200 `state: "draft"` — and publish refuses exactly as before.
