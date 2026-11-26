---
'@object-ui/app-shell': patch
---

fix(studio): the CEL editor refuses `==` / `!=` on a list field while you type, not first on save

Clause-②: no
Metadata-protocol: none

The object designer's CEL editors (a field's formula and stored expression, its visible / read-only / required conditions, and the condition builder's CEL box) now hand the as-you-type check each field's type and `multiple`. Writing `record.labels == 'a'` against a multi-select, tags or checkboxes field, or a select, lookup or user field declared `multiple: true`, shows the `list-equality` refusal and its `in` rewrite under the editor and holds Save, the same verdict the object draft check and publish already gave. A scalar field is judged as before. `CelPredicateField` takes a new optional `fieldDefs` prop; a mount that omits it lints exactly as before.
