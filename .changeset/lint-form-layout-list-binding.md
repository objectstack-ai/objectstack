---
"@objectstack/lint": patch
---

`validateFormLayout` now resolves the bound object for a view container's default `form` (and its `formViews.*` entries that declare no binding of their own) when that container names its object only on the `list` block (`list.data.object`, `list.object` or `list.objectName`) and nowhere on the container itself.

Before this fix, `containerObject` had no way to see a list-only binding, so `objName` stayed `undefined` for every site under such a container — and `form-field-unknown` / `form-section-group-unknown` never fired there, however wrong the section content was. This is the same fallback rung `validate-translatable-sections.ts` already carries for its own sites; it is now shared by both. `absolute-colspan-discouraged` is unaffected by this change — it was never gated on the object binding (it needs only a field's `colSpan`), so it already fired on a list-bound container's form sections before this fix.

Consequence: a view whose object binding lives only on `list` and whose default `form` (or an unbound `formViews.*` entry) references a nonexistent field or an undeclared `section.group` now gets a `warning` finding it did not get before. A stack with no such dangling reference sees no new output.
