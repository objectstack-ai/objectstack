---
'@objectstack/spec': minor
'@objectstack/driver-sql': patch
'@objectstack/metadata-core': patch
---

feat(spec): a lookup can declare that its target's name is visible to every reader of the record (`referenceNameVisible`)

Clause-②: yes (widening)
Metadata-protocol: added

`FieldSchema` declares one optional boolean, `referenceNameVisible`, on `lookup` and `user` fields. `true` declares that a principal who can read the record carrying the field may see the referenced record's display name (the target object's `nameField` value) and its id, even when that principal cannot read the referenced record. Nothing else of the target is exposed: `$expand` on the field returns the same name and id only, the field's `displayField` does not widen it, and the name renders as text with no link to the target. The same key covers `sys_user` targets. It is declared on the referencing field only, so each application decides whose names its own pages reveal; there is no target-object switch.

Absent or `false` keeps the current posture: a lookup whose target the reader cannot read shows no name. The key is refused at parse on any other field type, `master_detail` included, and an authored `false` off-type is refused too.

This is the contract half. No runtime serves the name yet, so the describe carries the `[PLANNED — not yet served]` marker and setting the key changes no read today. The server read and `$expand` branch and the console's text-only rendering follow in later changes. Nothing to do for existing metadata.

`@objectstack/driver-sql` and `@objectstack/metadata-core` classify the new key in their closed `FieldSchema` key tables (a presentation key that names no field), so the built-in column collision warning and the field-level-security projection keep covering every key.
