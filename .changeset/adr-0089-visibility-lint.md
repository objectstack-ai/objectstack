---
"@objectstack/lint": minor
"@objectstack/cli": minor
---

ADR-0089 D3b: add the `validateVisibilityPredicates` lint rule for conditional-visibility keys, wired into `os validate` and `os compile` as advisory warnings.

Two rules, both `warning` (never fail the build):

- `visibility-alias-deprecated` — a `visibleOn` (view form section/field) or `visibility` (page component) key in authored source. It still works — the schema normalizes it to `visibleWhen` at parse — but the canonical key is `visibleWhen`. Fix: rename the key (same CEL value).
- `visibility-root-mislayered` — a runtime view/page visibility predicate rooted at `data.` (the metadata-editing-form root). Runtime record surfaces bind `record` + `current_user` (pages also expose `page.<var>`), so a `data.`-rooted predicate here never matches and the element renders unconditionally. Fix: use `record.`/`page.`.

The rule runs on the **pre-parse** stack (like `validate-list-view-mode`) so it can see the deprecated alias the author actually wrote before the schema folds it into `visibleWhen`.
