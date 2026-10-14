---
"@objectstack/spec": minor
"@objectstack/lint": patch
---

feat(spec): export the `controlled_by_parent` exactly-one-master predicate, so a producer asks the spec instead of restating ADR-0055 §1 (#23272)

Clause-②: yes

`@objectstack/spec/data` now exports the predicate `ObjectSchema` already refuses with:

- `controlledByParentMasterRefusal(objectName, sharingModel, fields)` answers "does this object satisfy the exactly-one-master rule?". `undefined` means yes, or that the rule does not apply (another sharing model, or no field map). Otherwise it returns the refusal: the parse issue's `path` (`fields` or `sharingModel`), its `message`, the object's `shape` (`several-required-masters`, `several-masters`, `master-not-required`, `required-lookup-only` or `no-master`), and the `master_detail` and required `lookup` fields it declares. Types: `ControlledByParentMasterRefusal`, `ControlledByParentMasterShape`.
- `isControlledByParentMasterField(field)` answers "does this field count as the master?": a `master_detail` field declared `required: true`, and nothing else. The object satisfies the rule when exactly one of its fields counts.

A producer that defaults an object to `controlled_by_parent` asks `controlledByParentMasterRefusal(name, 'controlled_by_parent', fields) === undefined` with the field map it is about to write. The answer is the parse's: on every shape the v18 upgrade lists, the export and `ObjectSchema` agree on the verdict, the issue path and the message.

`@objectstack/lint`: `security-controlled-by-parent-no-relation` and `security-controlled-by-parent-ambiguous-relation` count masters with the exported field predicate instead of their own copy. Their findings, paths and texts are unchanged. A `master_detail` that names no `reference` still does not count for the lint.

No export is removed, and no accepted or refused shape changes.
