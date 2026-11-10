---
'@objectstack/lint': patch
'@objectstack/spec': patch
---

fix(lint): `field-no-consumers` stops reporting a field that only a row-level security predicate or an inline grid's line-position derivation reads

Clause-②: yes (widening)
Metadata-protocol: none

`field-no-consumers` reported two kinds of field that something in the stack does read:

- A field named only by a permission set's row-level security predicate. `rowLevelSecurity[].using` filters every read the policy governs and `rowLevelSecurity[].check` judges every row a write produces, so both now count as reads of the fields they name, on the object the policy names. Every other path under `permissions` (a field-level grant, an object grant) still counts as a carrier only.
- The child field an inline grid stamps each line's position into on drag-reorder and orders its lines by (`position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`, the first of them in the child's field order). It now counts as read on every inline grid: a relationship field that sets `inlineEdit`, with authored or derived columns, and every `subforms` / `details` entry. The child's other sort-named fields are still reported.

`@objectstack/spec` adds `deriveInlineGridSortField(def)` to `@objectstack/spec/data`: it returns the field an inline grid uses as its line position, by the renderer's own rule, or `undefined` when the child declares none. The list of names stays private to the spec.

`os explain field-no-consumers` lists both reads. Nothing to change in your metadata: fields that were reported only for these reasons stop being reported.
