---
'@objectstack/skills': patch
---

docs(skills): object-level `composite` / `repeater` are untyped JSON — a typed list is a child object

Clause-②: no
Metadata-protocol: none

The `objectstack-data` field-types table said a `composite` carries "declared sub-fields". An object field has no member that declares them: `fields`, `subFields` and `columns` are refused on the field. The two rows now say the types are untyped JSON and that a list needing typed columns is a child object with a `master_detail` field (`inlineEdit: 'grid'` edits it inline on the parent's form).

What to do: nothing. No key, value or behaviour changes.
