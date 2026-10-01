---
'@objectstack/spec': patch
---

fix(spec): protocol 18's migration rationale now covers the form view's inline grid columns and the identity-only currency `scale` refusal (#20901)

**`@objectstack/spec`**

- **`MIGRATIONS_BY_MAJOR[18].rationale` gains one fragment, `form-view-subform-columns-closed`.** It is the paragraph `os migrate meta --step` shows for the protocol 17 → 18 hop. The new sentences say that a form view's `subforms[].columns` now takes the strict `InlineGridColumnSchema` a relationship field's `inlineColumns` takes, that the conversion `form-view-subform-columns-canonicalized` respells a `{ field }` column as `{ name }` in stored rows and assembled artifacts while an author writing `field` is refused, and that `defineStack` refuses `scale` on a column that declares no `type` when its `name` is a `currency` field of a child object declared in the same stack (`inline-grid-column-identity-only-currency-scale-refused`).
- Text only: no schema, conversion or migration entry changes, and `conversionIds` and `semantic` for step 18 are unchanged.
