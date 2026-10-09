---
'@objectstack/spec': patch
'@objectstack/plugin-sharing': patch
---

docs: three contract docblocks now describe what the code decides. No type, schema or runtime change.

Clause-②: no

- **`ControlledByParentWriteDenialLeg` (`@objectstack/spec`).** The `master_chain` leg has three resolution refusals: no relation to derive from, a row that is not present, and an empty master reference. Each names the master whose own master the walk could not derive. That master is the record's own master, when it is itself `controlled_by_parent`, or any master above it. The docblock said only a master above the record's own master. The next sentence now says "past the record itself" where it said "above the first hop", so the two agree.
- **`ISharingService.canEdit` (`@objectstack/spec`) and `SharingService.canEdit` (`@objectstack/plugin-sharing`).** The caller lists no longer name the `sys_attachment` and `sys_comment` parent gates. Those gates read `checkEdit` and the master-detail write check. The `ISharingService.canEdit` sentence on how they reach the service now names `checkEdit`.

`ControlledByParentWriteDenialLeg`, `ControlledByParentWriteOutcome`, `canEdit` and `checkEdit` keep their declared shapes, and no verdict, outcome or refusal changes.
