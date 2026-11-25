---
'@objectstack/skills': patch
---

docs(skills): the lint table and the `repeater` row name the parent field group, not `inlineEdit`, as what places a child's rows

Clause-②: no
Metadata-protocol: none

objectstack-data's `references/lint-rules.md` said three `os lint` rules trigger on `inlineEdit`. They read the parent's field groups, and the rows now say so: `relationship/line-items-inline-edit` catches a line-item `master_detail` child that no parent field group places (`fieldGroups[].relatedList`), `relationship/inline-edit-needs-bulk` a placed child whose parent or child withholds `'bulk'`, and `relationship/association-inline-edit` an association a group places. `rules/field-types.md` pointed a typed list at a child object with `inlineEdit: 'grid'`; it now points at a `master_detail` child that a parent `fieldGroups[].relatedList` names. Text only; the rule ids and the lint are unchanged, and each file pays for its new wording in its own bytes.
