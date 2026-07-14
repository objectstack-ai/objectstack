---
"@objectstack/lint": minor
---

ADR-0089 D3b: make the `visibility-root-mislayered` lint check bidirectional. `validateVisibilityPredicates` now accepts an optional `{ layer }` option — `'runtime'` (default, unchanged) flags a `data.`-rooted predicate on a `*.view.ts` / `*.page.ts` surface, and `'metadata'` flags a `record.`-rooted predicate on a `*.form.ts` metadata-editing form. Both directions of the ADR's binding-root rule are now covered. Adds the `VisibilityLayer` / `VisibilityOptions` exported types. Fully back-compat: existing single-argument callers keep the runtime behavior.
