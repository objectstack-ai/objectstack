---
'@objectstack/skills': patch
---

docs(skills): the data and automation skills teach three data-model checks publish now runs

Clause-②: no
Metadata-protocol: none

Published prose and evals only; the checks already run.

- `objectstack-data` `rules/relationships.md`: a roll-up whose child object has no `lookup` or `master_detail` field referencing the parent, or whose `relationshipField` is no field of the child, is refused at publish (`rollup/child-without-parent-reference`).
- `objectstack-data` `rules/field-types.md`: only `lookup`, `master_detail`, `user` and `tree` read `reference`; on any other type but `summary`, publish refuses it (`field/reference-on-non-reference-type`).
- `objectstack-automation` `references/state-machines-and-approvals.md`: `lockRecord` locks the record and its `master_detail` child rows only; a `lookup` child drawn as a body table stays editable while pending, reported as the warning `approval-detail-editable-while-pending`.

No file grew past its ceiling: each addition is paid for by shorter wording in the same file.
